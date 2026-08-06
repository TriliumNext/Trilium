import { BAttribute, becca, becca_easy_mocking, checkImageAttachments, collectCanvasImageFileIds, findBookmarks, findLlmChatLinks, findMindMapLinks, saveLinks } from "@triliumnext/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { randomString } from "./utils.js";

const { buildNote } = becca_easy_mocking;

vi.mock("./sql.js", () => ({
    default: {
        transactional: (cb: Function) => cb(),
        execute: () => {},
        replace: () => {},
        upsert: () => {},
        getMap: () => ({}),
        getManyRows: () => [],
        getValue: () => null
    }
}));

vi.mock("./ws.js", () => ({
    default: { sendMessageToAllClients: () => {} }
}));

vi.mock("./entity_changes.js", () => ({
    default: { putEntityChange: () => {} }
}));

describe("collectCanvasImageFileIds", () => {
    it("collects fileIds from image elements in the scene JSON", () => {
        const content = JSON.stringify({
            elements: [
                { type: "image", fileId: "file-1" },
                { type: "rectangle" },
                { type: "image", fileId: "file-2" }
            ]
        });
        expect(collectCanvasImageFileIds(content)).toEqual(new Set([ "file-1", "file-2" ]));
    });

    it("returns an empty set for malformed content (e.g. note type just changed)", () => {
        expect(collectCanvasImageFileIds("not json")).toEqual(new Set());
        expect(collectCanvasImageFileIds(JSON.stringify({}))).toEqual(new Set());
    });

    it("returns an empty set when the JSON shape is unexpected (null / non-array elements)", () => {
        expect(collectCanvasImageFileIds(JSON.stringify(null))).toEqual(new Set());
        expect(collectCanvasImageFileIds(JSON.stringify({ elements: 5 }))).toEqual(new Set());
        expect(collectCanvasImageFileIds(JSON.stringify({ elements: "oops" }))).toEqual(new Set());
    });
});

describe("findBookmarks", () => {
    it("extracts bookmark IDs from empty anchor tags", () => {
        const content = `<p>Hello</p><a id="chapter-1"></a><p>World</p>`;
        expect(findBookmarks(content)).toEqual(["chapter-1"]);
    });

    it("extracts multiple bookmarks", () => {
        const content = `<a id="intro"></a><p>Text</p><a id="conclusion"></a>`;
        expect(findBookmarks(content)).toEqual(["intro", "conclusion"]);
    });

    it("returns empty array when no bookmarks exist", () => {
        const content = `<p>No bookmarks here</p>`;
        expect(findBookmarks(content)).toEqual([]);
    });

    it("ignores anchor tags with href (regular links, not bookmarks)", () => {
        const content = `<a href="#root/abc123" id="some-id">link</a>`;
        expect(findBookmarks(content)).toEqual([]);
    });

    it("handles bookmarks with various valid ID characters", () => {
        const content = `<a id="my_bookmark-2.0"></a>`;
        expect(findBookmarks(content)).toEqual(["my_bookmark-2.0"]);
    });

    it("does not produce duplicates", () => {
        const content = `<a id="same"></a><a id="same"></a>`;
        expect(findBookmarks(content)).toEqual(["same"]);
    });

    it("matches self-closing bookmark anchors (CKEditor empty elements)", () => {
        const content = `<p>Text</p><a id="my-bookmark"></a><p>More</p>`;
        // CKEditor may also output without closing tag
        const contentNoClose = `<p>Text</p><a id="my-bookmark"><p>More</p>`;
        expect(findBookmarks(content)).toEqual(["my-bookmark"]);
        expect(findBookmarks(contentNoClose)).toEqual(["my-bookmark"]);
    });
});

/** Helper to mock `save` on all attachments created via `buildNote`. */
function mockAttachmentSaves(note: ReturnType<typeof buildNote>) {
    for (const att of note.getAttachments()) {
        att.save = vi.fn();
    }
}

describe("checkImageAttachments", () => {
    beforeEach(() => {
        becca.reset();
    });

    describe("HTML content", () => {
        it("keeps referenced attachments alive", () => {
            const note = buildNote({ title: "Test", attachments: [{ title: "test.png", role: "image", mime: "image/png" }] });
            mockAttachmentSaves(note);
            const [att] = note.getAttachments();

            const content = `<p>Hello</p><img src="api/attachments/${att.attachmentId}/image/test.png">`;
            checkImageAttachments(note, content);

            expect(att.save).not.toHaveBeenCalled();
        });

        it("keeps attachments referenced from a link preview's picture attributes alive", () => {
            const note = buildNote({
                title: "Test",
                attachments: [
                    { title: "image.jpg", role: "image", mime: "image/jpeg" },
                    { title: "favicon.ico", role: "favicon", mime: "image/x-icon" }
                ]
            });
            mockAttachmentSaves(note);
            const [ image, favicon ] = note.getAttachments();
            image.utcDateScheduledForErasureSince = "2025-01-01 00:00:00.000Z";
            favicon.utcDateScheduledForErasureSince = "2025-01-01 00:00:00.000Z";

            // A link preview carries both of its pictures in data attributes, not in an <img src>:
            // the card image, and the favicon an inline mention shows on its own.
            const content = `<section class="link-embed" data-url="https://example.com"`
                + ` data-image="api/attachments/${image.attachmentId}/image/image.jpg"`
                + ` data-favicon="api/attachments/${favicon.attachmentId}/image/favicon.ico"></section>`;
            checkImageAttachments(note, content);

            expect(image.utcDateScheduledForErasureSince).toBeNull();
            expect(favicon.utcDateScheduledForErasureSince).toBeNull();
        });

        it("keeps a mention's favicon alive, which is all an inline mention carries", () => {
            const note = buildNote({ title: "Test", attachments: [{ title: "favicon.ico", role: "favicon", mime: "image/x-icon" }] });
            mockAttachmentSaves(note);
            const [ favicon ] = note.getAttachments();
            favicon.utcDateScheduledForErasureSince = "2025-01-01 00:00:00.000Z";

            const content = `<span class="link-mention" data-url="https://example.com"`
                + ` data-favicon="api/attachments/${favicon.attachmentId}/image/favicon.ico"></span>`;
            checkImageAttachments(note, content);

            expect(favicon.utcDateScheduledForErasureSince).toBeNull();
        });

        it("rewrites every reference to a foreign attachment, not just the first", () => {
            // A deduplicated favicon is referenced once per link to its site, so content pasted
            // into another note arrives holding many references to the one attachment. Rewriting
            // only the first left the rest pointing at the other note's picture — which a later
            // save would fix one more of, announcing each with its own toast.
            const source = buildNote({
                title: "Source",
                attachments: [{ id: "foreignAtt1", title: "example.com.ico", role: "favicon", mime: "image/x-icon" }]
            });
            const [ foreign ] = source.getAttachments();
            foreign.blobId = "sharedBlob";

            const target = buildNote({
                title: "Target",
                attachments: [{ id: "localAtt1", title: "example.com.ico", role: "favicon", mime: "image/x-icon" }]
            });
            mockAttachmentSaves(target);
            const [ local ] = target.getAttachments();
            local.blobId = "sharedBlob";

            // The attachment is owned by another note, which is what makes it "unknown" here.
            const getAttachments = vi.spyOn(becca, "getAttachments").mockReturnValue([ foreign ]);

            try {
                const mention = (attachmentId: string) =>
                    `<span class="link-mention" data-favicon="api/attachments/${attachmentId}/image/example.com.ico"></span>`;
                const { content } = checkImageAttachments(
                    target,
                    `<p>${mention("foreignAtt1")} and ${mention("foreignAtt1")} and ${mention("foreignAtt1")}</p>`
                );

                expect(content).not.toContain("foreignAtt1");
                expect(content.match(/localAtt1/g)).toHaveLength(3);
            } finally {
                getAttachments.mockRestore();
            }
        });

        it("schedules an unreferenced favicon for erasure, its own role notwithstanding", () => {
            // The role exists so an icon can be told apart from the user's own pictures, not so it
            // can escape the cleanup: nothing else manages a favicon, so deleting the preview that
            // referenced it has to be what eventually takes it away.
            const note = buildNote({ title: "Test", attachments: [{ title: "favicon.ico", role: "favicon", mime: "image/x-icon" }] });
            mockAttachmentSaves(note);
            const [ favicon ] = note.getAttachments();

            checkImageAttachments(note, "<p>the preview that referenced it is gone</p>");

            expect(favicon.utcDateScheduledForErasureSince).toBeTruthy();
        });

        it("schedules unreferenced attachments for erasure", () => {
            const note = buildNote({ title: "Test", attachments: [{ title: "test.png", role: "image", mime: "image/png" }] });
            mockAttachmentSaves(note);
            const [att] = note.getAttachments();

            checkImageAttachments(note, "<p>No images here</p>");

            expect(att.save).toHaveBeenCalled();
            expect(att.utcDateScheduledForErasureSince).toBeTruthy();
        });

        it("leaves non-embeddable roles untouched even when unreferenced", () => {
            const note = buildNote({ title: "Test", attachments: [{ title: "OneNote source.html", role: "importSource", mime: "text/html" }] });
            mockAttachmentSaves(note);
            const [att] = note.getAttachments();

            checkImageAttachments(note, "<p>No images here</p>");

            expect(att.save).not.toHaveBeenCalled();
            expect(att.utcDateScheduledForErasureSince).toBeFalsy();
        });

        it("cancels erasure when attachment is re-referenced", () => {
            const note = buildNote({ title: "Test", attachments: [{ title: "test.png", role: "image", mime: "image/png" }] });
            mockAttachmentSaves(note);
            const [att] = note.getAttachments();
            att.utcDateScheduledForErasureSince = "2025-01-01 00:00:00.000Z";

            const content = `<img src="api/attachments/${att.attachmentId}/image/test.png">`;
            checkImageAttachments(note, content);

            expect(att.save).toHaveBeenCalled();
            expect(att.utcDateScheduledForErasureSince).toBeNull();
        });

        it("detects attachment IDs in href reference links", () => {
            const note = buildNote({ title: "Test", attachments: [{ title: "test.png", role: "file", mime: "image/png" }] });
            mockAttachmentSaves(note);
            const [att] = note.getAttachments();

            const content = `<a href="#root/${note.noteId}?viewMode=attachments&attachmentId=${att.attachmentId}">file</a>`;
            checkImageAttachments(note, content);

            expect(att.save).not.toHaveBeenCalled();
        });
    });

    describe("Markdown content", () => {
        it("keeps referenced attachments alive via markdown image syntax", () => {
            const note = buildNote({ title: "Test", type: "code", mime: "text/x-markdown", attachments: [{ title: "test.png", role: "image", mime: "image/png" }] });
            mockAttachmentSaves(note);
            const [att] = note.getAttachments();

            const content = `# Hello\n\n![test](api/attachments/${att.attachmentId}/image/test.png)`;
            checkImageAttachments(note, content);

            expect(att.save).not.toHaveBeenCalled();
        });

        it("schedules unreferenced attachments for erasure", () => {
            const note = buildNote({ title: "Test", type: "code", mime: "text/x-markdown", attachments: [{ title: "test.png", role: "image", mime: "image/png" }] });
            mockAttachmentSaves(note);
            const [att] = note.getAttachments();

            checkImageAttachments(note, "# No images\n\nJust text.");

            expect(att.save).toHaveBeenCalled();
            expect(att.utcDateScheduledForErasureSince).toBeTruthy();
        });

        it("cancels erasure when attachment is re-referenced", () => {
            const note = buildNote({ title: "Test", type: "code", mime: "text/x-markdown", attachments: [{ title: "test.png", role: "image", mime: "image/png" }] });
            mockAttachmentSaves(note);
            const [att] = note.getAttachments();
            att.utcDateScheduledForErasureSince = "2025-01-01 00:00:00.000Z";

            const content = `![img](api/attachments/${att.attachmentId}/image/test.png)`;
            checkImageAttachments(note, content);

            expect(att.save).toHaveBeenCalled();
            expect(att.utcDateScheduledForErasureSince).toBeNull();
        });

        it("detects attachment IDs in markdown link syntax", () => {
            const note = buildNote({ title: "Test", type: "code", mime: "text/x-markdown", attachments: [{ title: "test.png", role: "file", mime: "image/png" }] });
            mockAttachmentSaves(note);
            const [att] = note.getAttachments();

            const content = `[my file](#root/${note.noteId}?viewMode=attachments&attachmentId=${att.attachmentId})`;
            checkImageAttachments(note, content);

            expect(att.save).not.toHaveBeenCalled();
        });

        it("handles multiple attachments in markdown content", () => {
            const imgAtt = { title: "test.png", role: "image", mime: "image/png" };
            const note = buildNote({ title: "Test", type: "code", mime: "text/x-markdown", attachments: [imgAtt, imgAtt, imgAtt] });
            mockAttachmentSaves(note);
            const [att1, att2, att3] = note.getAttachments();

            const content = [
                `![img1](api/attachments/${att1.attachmentId}/image/a.png)`,
                "Some text",
                `![img2](api/attachments/${att2.attachmentId}/image/b.png)`
            ].join("\n");

            checkImageAttachments(note, content);

            expect(att1.save).not.toHaveBeenCalled();
            expect(att2.save).not.toHaveBeenCalled();
            expect(att3.save).toHaveBeenCalled();
            expect(att3.utcDateScheduledForErasureSince).toBeTruthy();
        });
    });

    describe("Spreadsheet content", () => {
        /** Wraps a drawing source URL into the JSON shape a spreadsheet note persists. */
        function spreadsheetContent(source: string) {
            return JSON.stringify({
                version: 1,
                workbook: {
                    resources: [{
                        name: "SHEET_DRAWING_PLUGIN",
                        data: JSON.stringify({ "sheet-1": { data: { img1: { imageSourceType: "URL", source } }, order: ["img1"] } })
                    }]
                }
            });
        }

        it("keeps an attachment referenced by the workbook drawing source alive", () => {
            const note = buildNote({ title: "Sheet", type: "spreadsheet", mime: "application/json", attachments: [{ title: "image.png", role: "image", mime: "image/png" }] });
            mockAttachmentSaves(note);
            const [att] = note.getAttachments();

            checkImageAttachments(note, spreadsheetContent(`api/attachments/${att.attachmentId}/image/image.png`));

            expect(att.save).not.toHaveBeenCalled();
        });

        it("schedules an inserted-then-removed image for erasure", () => {
            const note = buildNote({ title: "Sheet", type: "spreadsheet", mime: "application/json", attachments: [{ title: "image.png", role: "image", mime: "image/png" }] });
            mockAttachmentSaves(note);
            const [att] = note.getAttachments();

            checkImageAttachments(note, spreadsheetContent("api/attachments/someOtherId/image/image.png"));

            expect(att.save).toHaveBeenCalled();
            expect(att.utcDateScheduledForErasureSince).toBeTruthy();
        });

        it("never schedules the preview thumbnail for erasure even though it is unreferenced", () => {
            const note = buildNote({ title: "Sheet", type: "spreadsheet", mime: "application/json", attachments: [{ title: "spreadsheet-export.png", role: "image", mime: "image/png" }] });
            mockAttachmentSaves(note);
            const [thumbnail] = note.getAttachments();

            // Content with no drawing images at all — the thumbnail is the only "image" attachment.
            checkImageAttachments(note, JSON.stringify({ version: 1, workbook: { resources: [] } }));

            expect(thumbnail.save).not.toHaveBeenCalled();
            expect(thumbnail.utcDateScheduledForErasureSince).toBeFalsy();
        });

        it("cancels erasure when the image is re-referenced", () => {
            const note = buildNote({ title: "Sheet", type: "spreadsheet", mime: "application/json", attachments: [{ title: "image.png", role: "image", mime: "image/png" }] });
            mockAttachmentSaves(note);
            const [att] = note.getAttachments();
            att.utcDateScheduledForErasureSince = "2025-01-01 00:00:00.000Z";

            checkImageAttachments(note, spreadsheetContent(`api/attachments/${att.attachmentId}/image/image.png`));

            expect(att.save).toHaveBeenCalled();
            expect(att.utcDateScheduledForErasureSince).toBeNull();
        });
    });

    describe("Canvas content", () => {
        /** Wraps image fileIds into the JSON shape a canvas note persists (one element per fileId). */
        function canvasContent(...fileIds: string[]) {
            return JSON.stringify({
                type: "excalidraw",
                version: 2,
                elements: fileIds.map((fileId) => ({ type: "image", fileId })),
                files: {},
                appState: {}
            });
        }

        it("keeps an image referenced by the scene (attachment titled with its fileId) alive", () => {
            const note = buildNote({ title: "Canvas", type: "canvas", mime: "application/json", attachments: [{ title: "fileId-1", role: "image", mime: "image/png" }] });
            mockAttachmentSaves(note);
            const [att] = note.getAttachments();

            checkImageAttachments(note, canvasContent("fileId-1"));

            expect(att.save).not.toHaveBeenCalled();
        });

        it("schedules an inserted-then-removed image for erasure", () => {
            const note = buildNote({ title: "Canvas", type: "canvas", mime: "application/json", attachments: [{ title: "fileId-1", role: "image", mime: "image/png" }] });
            mockAttachmentSaves(note);
            const [att] = note.getAttachments();

            // Scene no longer references fileId-1 (the image was deleted from the canvas).
            checkImageAttachments(note, canvasContent("fileId-2"));

            expect(att.save).toHaveBeenCalled();
            expect(att.utcDateScheduledForErasureSince).toBeTruthy();
        });

        it("never schedules the SVG export preview for erasure even though it is unreferenced", () => {
            const note = buildNote({ title: "Canvas", type: "canvas", mime: "application/json", attachments: [{ title: "canvas-export.svg", role: "image", mime: "image/svg+xml" }] });
            mockAttachmentSaves(note);
            const [exportPreview] = note.getAttachments();

            checkImageAttachments(note, canvasContent());

            expect(exportPreview.save).not.toHaveBeenCalled();
            expect(exportPreview.utcDateScheduledForErasureSince).toBeFalsy();
        });

        it("cancels erasure when the image is re-referenced (e.g. undo)", () => {
            const note = buildNote({ title: "Canvas", type: "canvas", mime: "application/json", attachments: [{ title: "fileId-1", role: "image", mime: "image/png" }] });
            mockAttachmentSaves(note);
            const [att] = note.getAttachments();
            att.utcDateScheduledForErasureSince = "2025-01-01 00:00:00.000Z";

            checkImageAttachments(note, canvasContent("fileId-1"));

            expect(att.save).toHaveBeenCalled();
            expect(att.utcDateScheduledForErasureSince).toBeNull();
        });

        it("does not perform foreign-attachment copying (no forceFrontendReload)", () => {
            const note = buildNote({ title: "Canvas", type: "canvas", mime: "application/json", attachments: [{ title: "fileId-1", role: "image", mime: "image/png" }] });
            mockAttachmentSaves(note);

            const result = checkImageAttachments(note, canvasContent("fileId-1"));

            expect(result.forceFrontendReload).toBe(false);
        });
    });

    describe("Mind map content", () => {
        /** Wraps picture URLs into the JSON shape a mind map persists (one node per URL). */
        function mindMapContent(...urls: string[]) {
            return JSON.stringify({
                nodeData: {
                    id: "root",
                    topic: "Root",
                    children: urls.map((url, index) => ({
                        id: `node-${index}`,
                        topic: `Node ${index}`,
                        image: { url, width: 240, height: 180 }
                    }))
                }
            });
        }

        it("keeps a picture referenced by a node alive, and schedules one taken off a node for erasure", () => {
            const note = buildNote({ title: "Map", type: "mindMap", mime: "application/json", attachments: [{ title: "photo.png", role: "image", mime: "image/png" }] });
            mockAttachmentSaves(note);
            const [att] = note.getAttachments();

            checkImageAttachments(note, mindMapContent(`api/attachments/${att.attachmentId}/image/photo.png`));
            expect(att.save).not.toHaveBeenCalled();

            checkImageAttachments(note, mindMapContent("api/attachments/someOtherId/image/photo.png"));
            expect(att.save).toHaveBeenCalled();
            expect(att.utcDateScheduledForErasureSince).toBeTruthy();

            // Put back on a node (e.g. undo), it is kept again.
            checkImageAttachments(note, mindMapContent(`api/attachments/${att.attachmentId}/image/photo.png`));
            expect(att.utcDateScheduledForErasureSince).toBeNull();
        });

        it("never schedules the SVG export preview for erasure even though it is unreferenced", () => {
            const note = buildNote({ title: "Map", type: "mindMap", mime: "application/json", attachments: [{ title: "mindmap-export.svg", role: "image", mime: "image/svg+xml" }] });
            mockAttachmentSaves(note);
            const [preview] = note.getAttachments();

            // A map with no pictures at all — the preview is the only "image" attachment.
            checkImageAttachments(note, mindMapContent());

            expect(preview.save).not.toHaveBeenCalled();
            expect(preview.utcDateScheduledForErasureSince).toBeFalsy();
        });
    });

    describe("foreign attachment copying", () => {
        it("replaces foreign attachment IDs in HTML content", () => {
            const note = buildNote({ title: "Test" });
            const foreignNote = buildNote({ title: "Foreign", attachments: [{ id: "foreignAtt1", title: "test.png", role: "image", mime: "image/png" }] });
            const foreignAtt = foreignNote.getAttachments()[0];
            foreignAtt.copy = () => {
                const copyNote = buildNote({ title: "CopyHolder", attachments: [{ title: "test.png", role: "image", mime: "image/png" }] });
                const copy = copyNote.getAttachments()[0];
                copy.blobId = foreignAtt.blobId;
                copy.setContent = vi.fn();
                return copy;
            };
            foreignAtt.getContent = () => Buffer.from("image data");
            note.getAttachments = () => [];
            becca.getAttachments = vi.fn().mockReturnValue([foreignAtt]);

            const content = `<img src="api/attachments/foreignAtt1/image/test.png">`;
            const result = checkImageAttachments(note, content);

            expect(result.forceFrontendReload).toBe(true);
            expect(result.content).not.toContain("foreignAtt1");
        });

        /**
         * Copies for real, so the role the copy ends up with is the one production put there, and
         * hands the copy back to the test. Only the writing is stood in for: `setContent` and `save`
         * reach blobs and the DB, which this spec has no room for.
         */
        function captureRealCopy(foreign: ReturnType<typeof buildNote>["getAttachments"] extends () => (infer A)[] ? A : never) {
            const copies: typeof foreign[] = [];
            const realCopy = foreign.copy.bind(foreign);
            foreign.copy = () => {
                const copy = realCopy();
                copy.setContent = vi.fn();
                copy.save = vi.fn();
                copies.push(copy);
                return copy;
            };
            foreign.getContent = () => Buffer.from("picture data");
            return copies;
        }

        it("hands a preview's picture over as the reader's own when it is pasted as a plain image", () => {
            // "Copy reference to clipboard" on a link preview's favicon puts a bare <img> on the
            // clipboard. Carried into another note that way it is a picture someone placed, not a
            // preview's any more — and keeping the role would leave it deduplicated by title against
            // that note's own previews, denied OCR and compression, and filed under "System".
            const source = buildNote({
                title: "Source",
                attachments: [{ id: "foreignFavicon", title: "example.com.ico", role: "favicon", mime: "image/x-icon" }]
            });
            const [ foreign ] = source.getAttachments();
            const copies = captureRealCopy(foreign);

            const target = buildNote({ title: "Target" });
            target.getAttachments = () => [];
            const getAttachments = vi.spyOn(becca, "getAttachments").mockReturnValue([ foreign ]);

            try {
                checkImageAttachments(target, `<img src="api/attachments/foreignFavicon/image/example.com.ico">`);

                expect(copies).toHaveLength(1);
                expect(copies[0].role).toBe("image");
            } finally {
                getAttachments.mockRestore();
            }
        });

        it("keeps a preview's pictures its own when the whole preview is pasted", () => {
            // The same copy, reached the other way: the pictures still belong to a preview in the new
            // note, and demoting them would give every link to the site its own icon again.
            const source = buildNote({
                title: "Source",
                attachments: [
                    { id: "foreignCover", title: "https://example.com", role: "coverImage", mime: "image/jpeg" },
                    { id: "foreignIcon", title: "example.com", role: "favicon", mime: "image/x-icon" }
                ]
            });
            const [ cover, icon ] = source.getAttachments();
            const coverCopies = captureRealCopy(cover);
            const iconCopies = captureRealCopy(icon);

            const target = buildNote({ title: "Target" });
            target.getAttachments = () => [];
            const getAttachments = vi.spyOn(becca, "getAttachments").mockReturnValue([ cover, icon ]);

            try {
                checkImageAttachments(
                    target,
                    `<section class="link-embed" data-url="https://example.com"`
                    + ` data-image="api/attachments/foreignCover/image/cover.jpg"`
                    + ` data-favicon="api/attachments/foreignIcon/image/example.com.ico"></section>`
                );

                expect([ ...coverCopies, ...iconCopies ].map((copy) => copy.role)).toStrictEqual([ "coverImage", "favicon" ]);
            } finally {
                getAttachments.mockRestore();
            }
        });

        it("reuses an equivalent local picture under the role the copy would have taken", () => {
            // The equivalent-attachment lookup matches on role, so it has to ask for the role the copy
            // is going to land on. Asking for the foreign one would never match the note's own picture,
            // and every save would copy the bytes again.
            const source = buildNote({
                title: "Source",
                attachments: [{ id: "foreignIcon", title: "example.com.ico", role: "favicon", mime: "image/x-icon" }]
            });
            const [ foreign ] = source.getAttachments();
            foreign.blobId = "sharedBlob";
            const copies = captureRealCopy(foreign);

            const target = buildNote({
                title: "Target",
                attachments: [{ id: "localPicture", title: "example.com.ico", role: "image", mime: "image/x-icon" }]
            });
            mockAttachmentSaves(target);
            target.getAttachments()[0].blobId = "sharedBlob";

            const getAttachments = vi.spyOn(becca, "getAttachments").mockReturnValue([ foreign ]);

            try {
                const { content } = checkImageAttachments(
                    target,
                    `<img src="api/attachments/foreignIcon/image/example.com.ico">`
                );

                expect(copies).toHaveLength(0);
                expect(content).toContain("localPicture");
            } finally {
                getAttachments.mockRestore();
            }
        });

        it("replaces foreign attachment IDs in markdown content", () => {
            const note = buildNote({ title: "Test", type: "code", mime: "text/x-markdown" });
            const foreignNote = buildNote({ title: "Foreign", attachments: [{ id: "foreignAtt2", title: "test.png", role: "image", mime: "image/png" }] });
            const foreignAtt = foreignNote.getAttachments()[0];
            foreignAtt.copy = () => {
                const copyNote = buildNote({ title: "CopyHolder", attachments: [{ title: "test.png", role: "image", mime: "image/png" }] });
                const copy = copyNote.getAttachments()[0];
                copy.blobId = foreignAtt.blobId;
                copy.setContent = vi.fn();
                return copy;
            };
            foreignAtt.getContent = () => Buffer.from("image data");
            note.getAttachments = () => [];
            becca.getAttachments = vi.fn().mockReturnValue([foreignAtt]);

            const content = `![test](api/attachments/foreignAtt2/image/test.png)`;
            const result = checkImageAttachments(note, content);

            expect(result.forceFrontendReload).toBe(true);
            expect(result.content).not.toContain("foreignAtt2");
        });
    });
});

describe("saveLinks", () => {
    beforeEach(() => {
        becca.reset();
        // Restore getAttachments in case a previous test replaced it with a mock
        becca.getAttachments = vi.fn().mockReturnValue([]);
    });

    function makeLinkRelation(noteId: string, name: string, targetNoteId: string) {
        const attr = new BAttribute({
            attributeId: randomString(10),
            noteId,
            type: "relation",
            name,
            value: targetNoteId
        });
        attr.markAsDeleted = vi.fn();
        return attr;
    }

    // `checkImageAttachments` exempts the canvas, spreadsheet and mind map rendered images by title,
    // but not the mermaid one. That looks like an oversight until you notice `saveLinks` bails out
    // before it for mermaid, so its SVG is never reachable by orphan erasure at all. Pinned here: if
    // mermaid ever gains a `saveLinks` branch, it needs an exemption first, and this test is what
    // will say so — as it did for mind maps, which now carry pictures and so have both.
    it.each([
        [ "mermaid", "text/mermaid", "mermaid-export.svg", "flowchart TD\n A --> B" ],
        [ "mindMap", "application/json", "mindmap-export.svg", `{"nodeData":{}}` ]
    ] as const)("never schedules the %s rendered image for erasure, though nothing references it", (type, mime, title, content) => {
        const note = buildNote({ title: "Diagram", type, mime, attachments: [{ title, role: "image", mime: "image/svg+xml" }] });
        mockAttachmentSaves(note);
        const [rendered] = note.getAttachments();

        // The content never mentions the attachment — for a text note this would schedule erasure.
        saveLinks(note, content);

        expect(rendered.save).not.toHaveBeenCalled();
        expect(rendered.utcDateScheduledForErasureSince).toBeFalsy();
    });

    it("schedules a picture taken off a mind map's nodes for erasure", () => {
        const note = buildNote({ title: "Map", type: "mindMap", mime: "application/json", attachments: [{ title: "photo.png", role: "image", mime: "image/png" }] });
        mockAttachmentSaves(note);
        const [picture] = note.getAttachments();

        saveLinks(note, JSON.stringify({ nodeData: { id: "root", topic: "Root" } }));

        expect(picture.utcDateScheduledForErasureSince).toBeTruthy();
    });

    it("does not delete existing imageLink relations on markdown notes that reference images", () => {
        const note = buildNote({ title: "Test", type: "code", mime: "text/x-markdown" });
        const targetNote = buildNote({ title: "Image Note", type: "image" });
        becca.notes[targetNote.noteId] = targetNote;

        const imageLink = makeLinkRelation(note.noteId, "imageLink", targetNote.noteId);
        note.getRelations = () => [imageLink];
        note.getAttachments = () => [];

        const content = `![diagram](api/images/${targetNote.noteId}/diagram.png)`;
        saveLinks(note, content);

        expect(imageLink.markAsDeleted).not.toHaveBeenCalled();
    });

    it("does not delete existing internalLink relations on markdown notes using #root links", () => {
        const note = buildNote({ title: "Test", type: "code", mime: "text/x-markdown" });
        const targetNote = buildNote({ title: "Other Note" });
        becca.notes[targetNote.noteId] = targetNote;

        const internalLink = makeLinkRelation(note.noteId, "internalLink", targetNote.noteId);
        note.getRelations = () => [internalLink];
        note.getAttachments = () => [];

        const content = `See [Other Note](#root/${targetNote.noteId})`;
        saveLinks(note, content);

        expect(internalLink.markAsDeleted).not.toHaveBeenCalled();
    });

    it("does not delete existing internalLink relations on markdown notes using wiki-links", () => {
        const note = buildNote({ title: "Test", type: "code", mime: "text/x-markdown" });
        const targetNote = buildNote({ title: "Linked Note" });
        becca.notes[targetNote.noteId] = targetNote;

        const internalLink = makeLinkRelation(note.noteId, "internalLink", targetNote.noteId);
        note.getRelations = () => [internalLink];
        note.getAttachments = () => [];

        const content = `See [[${targetNote.noteId}]] for details.`;
        saveLinks(note, content);

        expect(internalLink.markAsDeleted).not.toHaveBeenCalled();
    });

    it("detects both wiki-links and #root links in the same content", () => {
        const note = buildNote({ title: "Test", type: "code", mime: "text/x-markdown" });
        const targetA = buildNote({ title: "Note A" });
        const targetB = buildNote({ title: "Note B" });
        becca.notes[targetA.noteId] = targetA;
        becca.notes[targetB.noteId] = targetB;

        const linkA = makeLinkRelation(note.noteId, "internalLink", targetA.noteId);
        const linkB = makeLinkRelation(note.noteId, "internalLink", targetB.noteId);
        note.getRelations = () => [linkA, linkB];
        note.getAttachments = () => [];

        const content = `Link to [[${targetA.noteId}]] and [Note B](#root/${targetB.noteId})`;
        saveLinks(note, content);

        expect(linkA.markAsDeleted).not.toHaveBeenCalled();
        expect(linkB.markAsDeleted).not.toHaveBeenCalled();
    });

    describe("llmChat notes", () => {
        function makeChatContent(messages: unknown[]) {
            return JSON.stringify({ version: 1, messages });
        }

        it("detects [[noteId]] wiki-links in assistant text blocks", () => {
            const note = buildNote({ title: "Chat", type: "llmChat", mime: "application/json" });
            const targetA = buildNote({ title: "Note A" });
            const targetB = buildNote({ title: "Note B" });
            becca.notes[targetA.noteId] = targetA;
            becca.notes[targetB.noteId] = targetB;

            const linkA = makeLinkRelation(note.noteId, "internalLink", targetA.noteId);
            const linkB = makeLinkRelation(note.noteId, "internalLink", targetB.noteId);
            note.getRelations = () => [linkA, linkB];

            const content = makeChatContent([
                { id: "1", role: "user", content: "Show me notes" },
                {
                    id: "2", role: "assistant", content: [
                        { type: "text", content: `Here are your notes: [[${targetA.noteId}]] and [[${targetB.noteId}]]` }
                    ]
                }
            ]);
            saveLinks(note, content);

            expect(linkA.markAsDeleted).not.toHaveBeenCalled();
            expect(linkB.markAsDeleted).not.toHaveBeenCalled();
        });

        it("detects noteId in tool call inputs", () => {
            const note = buildNote({ title: "Chat", type: "llmChat", mime: "application/json" });
            const target = buildNote({ title: "Target Note" });
            becca.notes[target.noteId] = target;

            const link = makeLinkRelation(note.noteId, "internalLink", target.noteId);
            note.getRelations = () => [link];

            const content = makeChatContent([
                {
                    id: "1", role: "assistant", content: [
                        {
                            type: "tool_call", toolCall: {
                                id: "tc1", toolName: "get_note",
                                input: { noteId: target.noteId },
                                result: "{}"
                            }
                        }
                    ]
                }
            ]);
            saveLinks(note, content);

            expect(link.markAsDeleted).not.toHaveBeenCalled();
        });

        it("detects parentNoteId in tool call inputs", () => {
            const note = buildNote({ title: "Chat", type: "llmChat", mime: "application/json" });
            const parent = buildNote({ title: "Parent Note" });
            becca.notes[parent.noteId] = parent;

            const link = makeLinkRelation(note.noteId, "internalLink", parent.noteId);
            note.getRelations = () => [link];

            const content = makeChatContent([
                {
                    id: "1", role: "assistant", content: [
                        {
                            type: "tool_call", toolCall: {
                                id: "tc1", toolName: "create_note",
                                input: { parentNoteId: parent.noteId, title: "New" },
                                result: "{}"
                            }
                        }
                    ]
                }
            ]);
            saveLinks(note, content);

            expect(link.markAsDeleted).not.toHaveBeenCalled();
        });

        it("detects links from both text blocks and tool calls", () => {
            const note = buildNote({ title: "Chat", type: "llmChat", mime: "application/json" });
            const targetA = buildNote({ title: "Note A" });
            const targetB = buildNote({ title: "Note B" });
            becca.notes[targetA.noteId] = targetA;
            becca.notes[targetB.noteId] = targetB;

            const linkA = makeLinkRelation(note.noteId, "internalLink", targetA.noteId);
            const linkB = makeLinkRelation(note.noteId, "internalLink", targetB.noteId);
            note.getRelations = () => [linkA, linkB];

            const content = makeChatContent([
                {
                    id: "1", role: "assistant", content: [
                        {
                            type: "tool_call", toolCall: {
                                id: "tc1", toolName: "get_note",
                                input: { noteId: targetA.noteId },
                                result: "{}"
                            }
                        },
                        { type: "text", content: `See [[${targetB.noteId}]] for details.` }
                    ]
                }
            ]);
            saveLinks(note, content);

            expect(linkA.markAsDeleted).not.toHaveBeenCalled();
            expect(linkB.markAsDeleted).not.toHaveBeenCalled();
        });

        it("deletes links that are no longer in the chat content", () => {
            const note = buildNote({ title: "Chat", type: "llmChat", mime: "application/json" });
            const removedTarget = buildNote({ title: "Removed" });
            becca.notes[removedTarget.noteId] = removedTarget;

            const staleLink = makeLinkRelation(note.noteId, "internalLink", removedTarget.noteId);
            note.getRelations = () => [staleLink];

            const content = makeChatContent([
                { id: "1", role: "user", content: "Hello" },
                { id: "2", role: "assistant", content: [{ type: "text", content: "Hi there!" }] }
            ]);
            saveLinks(note, content);

            expect(staleLink.markAsDeleted).toHaveBeenCalled();
        });

        it("ignores user messages (does not extract links from them)", () => {
            const note = buildNote({ title: "Chat", type: "llmChat", mime: "application/json" });
            const target = buildNote({ title: "Target" });
            becca.notes[target.noteId] = target;

            const staleLink = makeLinkRelation(note.noteId, "internalLink", target.noteId);
            note.getRelations = () => [staleLink];

            const content = makeChatContent([
                { id: "1", role: "user", content: `Check [[${target.noteId}]]` }
            ]);
            saveLinks(note, content);

            expect(staleLink.markAsDeleted).toHaveBeenCalled();
        });

        it("handles invalid JSON content gracefully", () => {
            const note = buildNote({ title: "Chat", type: "llmChat", mime: "application/json" });
            note.getRelations = () => [];

            expect(() => saveLinks(note, "not valid json")).not.toThrow();
        });

        it("handles empty messages array", () => {
            const note = buildNote({ title: "Chat", type: "llmChat", mime: "application/json" });
            note.getRelations = () => [];

            expect(() => saveLinks(note, JSON.stringify({ version: 1, messages: [] }))).not.toThrow();
        });
    });
});

describe("findMindMapLinks", () => {
    type FoundLink = { name: "internalLink" | "imageLink" | "includeNoteLink" | "relationMapLink"; value: string };

    /** A map whose nodes carry the given links, one per node, nested a level deep. */
    function buildMap(...links: (string | undefined)[]) {
        const [ rootLink, ...childLinks ] = links;
        return JSON.stringify({
            nodeData: {
                id: "root",
                topic: "Root",
                hyperLink: rootLink,
                children: childLinks.map((hyperLink, index) => ({
                    id: `n${index}`,
                    topic: `Node ${index}`,
                    hyperLink,
                    children: []
                }))
            }
        });
    }

    it("collects the notes the nodes link to, wherever in the map they sit", () => {
        const links: FoundLink[] = [];

        findMindMapLinks(buildMap("#root/abc123", "#root/parent/def456", undefined, "#root"), links);

        expect(links).toEqual([
            { name: "internalLink", value: "abc123" },
            // The whole path is stored, but it is the note at the end of it that is linked.
            { name: "internalLink", value: "def456" },
            { name: "internalLink", value: "root" }
        ]);
    });

    it("takes nothing from a node pointing outside Trilium", () => {
        const links: FoundLink[] = [];

        findMindMapLinks(buildMap(
            "https://example.com",
            "mailto:someone@example.com",
            // An address of its own that happens to carry a note path is still a page elsewhere.
            "https://example.com/#root/abc123"
        ), links);

        expect(links).toEqual([]);
    });

    it("survives content it cannot read", () => {
        const links: FoundLink[] = [];

        findMindMapLinks("not valid json", links);
        findMindMapLinks(JSON.stringify({ nodeData: { id: "root", hyperLink: 42 } }), links);

        expect(links).toEqual([]);
    });
});

describe("findLlmChatLinks", () => {
    it("extracts wiki-links from assistant text blocks", () => {
        const links: { name: "internalLink" | "imageLink" | "includeNoteLink" | "relationMapLink"; value: string }[] = [];
        const content = JSON.stringify({
            messages: [{
                role: "assistant",
                content: [{ type: "text", content: "See [[abc123]] and [[def456]]" }]
            }]
        });
        findLlmChatLinks(content, links);

        expect(links).toEqual([
            { name: "internalLink", value: "abc123" },
            { name: "internalLink", value: "def456" }
        ]);
    });

    it("extracts noteId and parentNoteId from tool call inputs", () => {
        const links: { name: "internalLink" | "imageLink" | "includeNoteLink" | "relationMapLink"; value: string }[] = [];
        const content = JSON.stringify({
            messages: [{
                role: "assistant",
                content: [
                    {
                        type: "tool_call",
                        toolCall: { id: "t1", toolName: "get_note", input: { noteId: "noteA" } }
                    },
                    {
                        type: "tool_call",
                        toolCall: { id: "t2", toolName: "create_note", input: { parentNoteId: "noteB", title: "X" } }
                    }
                ]
            }]
        });
        findLlmChatLinks(content, links);

        expect(links).toEqual([
            { name: "internalLink", value: "noteA" },
            { name: "internalLink", value: "noteB" }
        ]);
    });

    it("skips user and system messages", () => {
        const links: { name: "internalLink" | "imageLink" | "includeNoteLink" | "relationMapLink"; value: string }[] = [];
        const content = JSON.stringify({
            messages: [
                { role: "user", content: "Check [[abc123]]" },
                { role: "system", content: "You have [[def456]]" }
            ]
        });
        findLlmChatLinks(content, links);

        expect(links).toEqual([]);
    });

    it("returns nothing for invalid JSON", () => {
        const links: { name: "internalLink" | "imageLink" | "includeNoteLink" | "relationMapLink"; value: string }[] = [];
        findLlmChatLinks("broken json {", links);

        expect(links).toEqual([]);
    });

    it("returns nothing when messages is missing", () => {
        const links: { name: "internalLink" | "imageLink" | "includeNoteLink" | "relationMapLink"; value: string }[] = [];
        findLlmChatLinks(JSON.stringify({ version: 1 }), links);

        expect(links).toEqual([]);
    });

    it("handles legacy string content in assistant messages", () => {
        const links: { name: "internalLink" | "imageLink" | "includeNoteLink" | "relationMapLink"; value: string }[] = [];
        const content = JSON.stringify({
            messages: [{ role: "assistant", content: "Some text with [[abc123]]" }]
        });
        findLlmChatLinks(content, links);

        // Legacy string content is not an array of blocks, so it's skipped
        expect(links).toEqual([]);
    });
});
