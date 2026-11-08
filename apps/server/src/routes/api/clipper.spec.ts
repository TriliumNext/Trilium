import { BBranch, becca, becca_easy_mocking, BNote, branches, cls, options } from "@triliumnext/core";
import type { Request } from "express";
import { beforeAll, describe, expect, it, vi } from "vitest";

import clipperRoute, { processContent } from "./clipper";

const { buildNote } = becca_easy_mocking;

const resolveYouTubePreview = vi.hoisted(() => vi.fn());
const storeFavicon = vi.hoisted(() => vi.fn());
const saveImageToAttachment = vi.hoisted(() => vi.fn(() => ({ attachmentId: "foo", title: "encodedTitle" })));

vi.mock("@triliumnext/core", async (importOriginal) => ({
    ...await importOriginal<typeof import("@triliumnext/core")>(),
    resolveYouTubePreview,
    storeFavicon
}));

vi.mock("../../services/image.js", () => ({
    default: {
        saveImageToAttachment,
        // The clipping is read as soon as this answers, so the picture has to be stored by
        // then; nothing here defers, so there is nothing for the wait to do.
        awaitImageWrite: async () => {}
    }
}));

let note!: BNote;

describe("processContent", () => {
    beforeAll(() => {
        note = buildNote({
            content: "Hi there"
        });
        note.saveAttachment = () => {};
    });

    it("processes basic note", async () => {
        const processed = await cls.init(() => processContent([], note, "<p>Hello world.</p>"));
        expect(processed).toStrictEqual("<p>Hello world.</p>");
    });

    it("processes plain text", async () => {
        const processed = await cls.init(() => processContent([], note, "Hello world."));
        expect(processed).toStrictEqual("<p>Hello world.</p>");
    });

    it("replaces images", async () => {
        const processed = await cls.init(() => processContent(
            [{"imageId":"OKZxZA3MonZJkwFcEhId","src":"inline.png","dataUrl":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAkAAAAQCAYAAADESFVDAAAAF0lEQVQoU2P8DwQMBADjqKLRIGAgKggAzHs/0SoYCGwAAAAASUVORK5CYII="}],
            note, `<img src="OKZxZA3MonZJkwFcEhId">`
        ));
        expect(processed).toStrictEqual(`<img src="api/attachments/foo/image/encodedTitle" >`);
    });

    it("shrinks a screenshot by its width alone, and any other image to fit", async () => {
        const PNG = "data:image/png;base64,iVBORw0KGgo=";
        saveImageToAttachment.mockClear();
        await cls.init(() => processContent([
            { imageId: "screenshotImage00000", src: "inline.png", dataUrl: PNG, screenshot: true },
            { imageId: "pictureImage00000000", src: "inline.png", dataUrl: PNG, screenshot: "yes" }
        ], note, `<img src="screenshotImage00000"><img src="pictureImage00000000">`));

        expect(saveImageToAttachment.mock.calls.map((call) => (call as unknown[]).slice(3)))
            .toEqual([ [ "width" ], [ true ] ]);
    });

    it("skips over non-data images", async () => {
        for (const url of [ "foo", "" ]) {
            const processed = await cls.init(() => processContent(
                [{"imageId":"OKZxZA3MonZJkwFcEhId","src":"inline.png","dataUrl": url}],
                note, `<img src="OKZxZA3MonZJkwFcEhId">`
            ));
            expect(processed).toStrictEqual(`<img src="OKZxZA3MonZJkwFcEhId" >`);
        }
    });

    it("turns embedded YouTube players into link previews", async () => {
        resolveYouTubePreview.mockImplementation(async (_noteId: string, url: string) => ({
            url,
            embedType: "youtube",
            title: "Tom & \"Jerry\"",
            siteName: "YouTube",
            image: "api/attachments/thumb/image/cover.jpg"
        }));

        const processed = await cls.init(() => processContent([], note, [
            `<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1"></iframe>`,
            `<iframe src="https://www.youtube-nocookie.com/embed/jNQXAC9IVRw"></iframe>`,
            `<iframe src="https://player.vimeo.com/video/76979871"></iframe>`
        ].join("")));

        expect(resolveYouTubePreview.mock.calls).toEqual([
            [ note.noteId, "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ" ],
            [ note.noteId, "https://www.youtube.com/watch?v=jNQXAC9IVRw", "jNQXAC9IVRw" ]
        ]);
        expect(processed).toStrictEqual([ "dQw4w9WgXcQ", "jNQXAC9IVRw" ].map((id) =>
            `<section class="link-embed" data-url="https://www.youtube.com/watch?v=${id}"`
            + ` data-embed-type="youtube" data-title="Tom &amp; &quot;Jerry&quot;"`
            + ` data-site-name="YouTube" data-image="api/attachments/thumb/image/cover.jpg"></section>`
        ).join(""));
    });

    it("keeps a YouTube player as a bare link preview when its metadata cannot be stored", async () => {
        resolveYouTubePreview.mockRejectedValue(new Error("offline"));

        const processed = await cls.init(() => processContent([], note,
            `<p>Watch:</p><iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>`));

        expect(processed).toStrictEqual(`<p>Watch:</p><section class="link-embed"`
            + ` data-url="https://www.youtube.com/watch?v=dQw4w9WgXcQ" data-embed-type="youtube"></section>`);
    });
});

// These exercise the route handlers against the real in-memory DB.
describe("clipper route handlers", () => {
    it("returns the handshake metadata", () => {
        const result = clipperRoute.handshake();
        expect(result.appName).toBe("trilium");
        expect(result.protocolVersion).toBeTruthy();
    });

    it("reports open-in-browser when not running under Electron", () => {
        const req = { params: { noteId: "root" } } as unknown as Request<{ noteId: string }>;
        expect(clipperRoute.openNote(req)).toEqual({ result: "open-in-browser" });
    });

    it("creates a clipping note, then appends to it when clipped from the same URL", async () => {
        const pageUrl = "https://example.com/article";
        const first = await cls.init(() => clipperRoute.addClipping({
            body: { title: "Article", content: "<p>first</p>", images: [], pageUrl }
        } as unknown as Request));
        expect(first.noteId).toBeTruthy();

        const second = await cls.init(() => clipperRoute.addClipping({
            body: { title: "Article", content: "<p>second</p>", images: [], pageUrl }
        } as unknown as Request));
        // Same pageUrl → appends to the existing clipping note.
        expect(second.noteId).toBe(first.noteId);

        const found = await cls.init(() => clipperRoute.findNotesByUrl({ params: { noteUrl: pageUrl } } as unknown as Request<{ noteUrl: string }>));
        expect(found.noteId).toBe(first.noteId);
    });

    it("labels a clipping note, refreshed by each clipping that brings labels", async () => {
        const pageUrl = "https://example.com/described";
        const clip = (labels?: Record<string, string>) => cls.init(() => clipperRoute.addClipping({
            body: { title: "Described", content: "<p>x</p>", images: [], pageUrl, labels }
        } as unknown as Request));

        const { noteId } = await clip({ pageDescription: "Tom & <b>Jerry</b>" });
        const clipping = becca.getNoteOrThrow(noteId);
        expect(clipping.getLabelValue("pageDescription")).toBe("Tom & Jerry");

        await clip({ pageDescription: "Updated" });
        expect(clipping.getLabelValue("pageDescription")).toBe("Updated");

        await clip();
        expect(clipping.getLabelValue("pageDescription")).toBe("Updated");
    });

    it("appends to a clipping note moved out of the inbox without cloning it back", async () => {
        const pageUrl = "https://example.com/moved";
        const first = await cls.init(() => clipperRoute.addClipping({
            body: { title: "Moved", content: "<p>first</p>", images: [], pageUrl }
        } as unknown as Request));
        const clipping = becca.getNoteOrThrow(first.noteId);
        const [ inboxBranch ] = clipping.getParentBranches();
        expect(inboxBranch).toBeDefined();

        const folder = buildNote({ title: "Reading list" });
        new BBranch({ noteId: folder.noteId, parentNoteId: "root", branchId: `root_${folder.noteId}` });
        cls.init(() => branches.moveBranchToNote(inboxBranch, folder.noteId));
        expect(clipping.getParentNotes().map((p) => p.noteId)).toEqual([ folder.noteId ]);

        const second = await cls.init(() => clipperRoute.addClipping({
            body: { title: "Moved", content: "<p>second</p>", images: [], pageUrl }
        } as unknown as Request));
        expect(second.noteId).toBe(first.noteId);
        expect(clipping.getContent()).toBe("<p>first</p><br><p>second</p>");
        expect(clipping.getParentNotes().map((p) => p.noteId)).toEqual([ folder.noteId ]);
    });

    describe("saving tabs", () => {
        const PLAIN_LIST = `<ul><li><a href="https://a.com/">A</a></li></ul>`;
        const FAVICON = "data:image/png;base64,iVBORw0KGgo=";

        function saveTabs(tabs: unknown) {
            return cls.init(async () => {
                const { noteId } = await clipperRoute.createNote({
                    body: { title: "2 browser tabs", content: PLAIN_LIST, clipType: "tabs", tabs }
                } as unknown as Request);
                const note = becca.getNoteOrThrow(noteId);
                expect(note.hasLabel("pageUrl")).toBe(false);
                return note.getContent();
            });
        }

        it("saves the tabs as link mentions with their favicons", async () => {
            cls.init(() => options.setOption("textNoteAutoLinkPreviewsEnabled", "true"));
            storeFavicon.mockReset();
            storeFavicon.mockImplementation(async (_noteId: string, pageUrl: string) =>
                (pageUrl.startsWith("https://a.com") ? "api/attachments/fav/image/a.com.png" : undefined));

            const content = await saveTabs([
                { url: "https://a.com/1", title: "Tom & \"Jerry\"", favicon: FAVICON },
                { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", title: "Video", favicon: "chrome://favicon" },
                { url: "https://b.com/", favicon: FAVICON },
                { title: "No URL" },
                null
            ]);

            expect(content).toBe("<ul>"
                + `<li><span class="link-mention" data-url="https://a.com/1" data-embed-type="opengraph"`
                + ` data-title="Tom &amp; &quot;Jerry&quot;"`
                + ` data-favicon="api/attachments/fav/image/a.com.png"></span></li>`
                + `<li><span class="link-mention" data-url="https://www.youtube.com/watch?v=dQw4w9WgXcQ"`
                + ` data-embed-type="youtube" data-title="Video"></span></li>`
                + `<li><span class="link-mention" data-url="https://b.com/" data-embed-type="opengraph"></span></li>`
                + "</ul>");
            const stored = storeFavicon.mock.calls.map(([ , pageUrl, bytes ]) =>
                [ pageUrl, Buffer.from(bytes).toString("base64") ]);
            expect(stored).toEqual([ [ "https://a.com/1", "iVBORw0KGgo=" ], [ "https://b.com/", "iVBORw0KGgo=" ] ]);
        });

        it("keeps the plain list when previews are off or the extension sent no usable tabs", async () => {
            cls.init(() => options.setOption("textNoteAutoLinkPreviewsEnabled", "true"));
            expect(await saveTabs(undefined)).toBe(PLAIN_LIST);
            expect(await saveTabs([ { title: "No URL" } ])).toBe(PLAIN_LIST);

            cls.init(() => options.setOption("textNoteAutoLinkPreviewsEnabled", "false"));
            expect(await saveTabs([ { url: "https://a.com/", title: "A" } ])).toBe(PLAIN_LIST);
        });
    });

    describe("saving files", () => {
        const PDF = Buffer.from("%PDF-1.7 bytes");

        function createFile(body: object) {
            return cls.init(() => clipperRoute.createFile({ body } as unknown as Request));
        }

        it("saves a PDF as a file note, a new one each time", async () => {
            const body = {
                title: "  Annual report  ",
                fileName: "../report.pdf",
                pageUrl: "https://example.com/report.pdf",
                dataUrl: `data:application/pdf;base64,${PDF.toString("base64")}`,
                labels: { pageDescription: "Tom & <b>Jerry</b>" }
            };
            const { noteId } = await createFile(body);

            const note = becca.getNoteOrThrow(noteId);
            expect(note.title).toBe("Annual report");
            expect(note.type).toBe("file");
            expect(note.mime).toBe("application/pdf");
            expect(Buffer.from(note.getContent())).toEqual(PDF);
            expect(note.getLabelValue("clipType")).toBe("file");
            expect(note.getLabelValue("pageUrl")).toBe("https://example.com/report.pdf");
            expect(note.getLabelValue("originalFileName")).toBe("report.pdf");
            expect(note.getLabelValue("pageDescription")).toBe("Tom & Jerry");

            const second = await createFile(body);
            expect(second.noteId).not.toBe(noteId);
        });

        it("titles the note after the file, or the page without one", async () => {
            const dataUrl = `data:application/pdf;base64,${PDF.toString("base64")}`;
            const named = await createFile({ title: " ", fileName: "report.pdf", pageUrl: "https://example.com/a", dataUrl });
            expect(becca.getNoteOrThrow(named.noteId).title).toBe("report.pdf");

            const unnamed = await createFile({ pageUrl: "https://example.com/b", dataUrl });
            const note = becca.getNoteOrThrow(unnamed.noteId);
            expect(note.title).toBe("Clipped file from https://example.com/b");
            expect(note.hasLabel("originalFileName")).toBe(false);
        });

        it("rejects a file that is not a base64 data URL", async () => {
            await expect(createFile({ title: "x", dataUrl: "https://example.com/report.pdf" }))
                .rejects.toThrow("The file must be sent as a base64 data URL.");
            await expect(createFile({ title: "x" })).rejects.toThrow("The file must be sent as a base64 data URL.");
        });
    });

    it("creates a standalone note with labels", async () => {
        const result = await cls.init(() => clipperRoute.createNote({
            body: {
                title: "Clipped",
                content: "<p>body</p>",
                images: [],
                clipType: "note",
                pageUrl: "https://example.com/page",
                labels: {
                    source: "web",
                    pageDescription: "Tom & <b>Jerry</b><script>alert(1)</script>"
                }
            }
        } as unknown as Request));
        const note = becca.getNoteOrThrow(result.noteId);
        expect(note.getLabelValue("source")).toBe("web");
        expect(note.getLabelValue("pageDescription")).toBe("Tom & Jerry");
    });

    it("clips to the top level when there is no clipper inbox and no journal", async () => {
        const result = await cls.init(() => clipperRoute.createNote({
            body: { title: "No journal", content: "<p>x</p>", images: [], clipType: "note", pageUrl: "https://example.com/nj" }
        } as unknown as Request));

        // Without a #calendarRoot the clipping must not have a calendar built around it.
        const clipped = becca.getNoteOrThrow(result.noteId);
        expect(clipped.getParentNotes().map((p) => p.noteId)).toEqual([ "root" ]);
    });

    it("clips into the day note once a journal exists", async () => {
        const journal = buildNote({ title: "Journal", "#calendarRoot": "" });
        // The day note is created beneath it, so it needs a path back to the root.
        new BBranch({ noteId: journal.noteId, parentNoteId: "root", branchId: `root_${journal.noteId}` });

        const result = await cls.init(() => clipperRoute.createNote({
            body: { title: "With journal", content: "<p>x</p>", images: [], clipType: "note", pageUrl: "https://example.com/wj" }
        } as unknown as Request));

        const clipped = becca.getNoteOrThrow(result.noteId);
        expect(clipped.getParentNotes().map((p) => p.noteId)).not.toEqual([ "root" ]);
    });

    it("creates a new note for each clipping that names no page", async () => {
        const save = () => cls.init(() => clipperRoute.createNote({
            body: { title: "Tabs", content: "<p>tabs</p>", clipType: "tabs" }
        } as unknown as Request));

        const first = await save();
        const second = await save();

        expect(second.noteId).not.toBe(first.noteId);
        for (const { noteId } of [ first, second ]) {
            const note = becca.getNoteOrThrow(noteId);
            expect(note.hasLabel("pageUrl")).toBe(false);
            expect(note.getContent()).toBe("<p>tabs</p>");
        }
    });

    it("returns a null noteId when no clipping matches the URL", async () => {
        const found = await cls.init(() => clipperRoute.findNotesByUrl({ params: { noteUrl: "https://nope.example/none" } } as unknown as Request<{ noteUrl: string }>));
        expect(found.noteId).toBeNull();
    });

    it("returns a null noteId for an empty URL", async () => {
        const found = await cls.init(() => clipperRoute.findNotesByUrl({ params: { noteUrl: "" } } as unknown as Request<{ noteUrl: string }>));
        expect(found.noteId).toBeNull();
    });
});
