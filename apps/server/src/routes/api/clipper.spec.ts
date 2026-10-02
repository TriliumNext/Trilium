import { attributes as attributeService, BBranch, becca, becca_easy_mocking, BNote, cls, note_service as noteService } from "@triliumnext/core";
import type { Request } from "express";
import { beforeAll, describe, expect, it, vi } from "vitest";

import clipperRoute, { processContent } from "./clipper";

const { buildNote } = becca_easy_mocking;

vi.mock("../../services/image.js", () => ({
    default: {
        saveImageToAttachment() {
            return {
                attachmentId: "foo",
                title: "encodedTitle",
            };
        },
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

    it("skips over non-data images", async () => {
        for (const url of [ "foo", "" ]) {
            const processed = await cls.init(() => processContent(
                [{"imageId":"OKZxZA3MonZJkwFcEhId","src":"inline.png","dataUrl": url}],
                note, `<img src="OKZxZA3MonZJkwFcEhId">`
            ));
            expect(processed).toStrictEqual(`<img src="OKZxZA3MonZJkwFcEhId" >`);
        }
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

    it("creates a standalone note with labels", async () => {
        const result = await cls.init(() => clipperRoute.createNote({
            body: {
                title: "Clipped",
                content: "<p>body</p>",
                images: [],
                clipType: "note",
                pageUrl: "https://example.com/page",
                labels: { source: "web" }
            }
        } as unknown as Request));
        expect(result.noteId).toBeTruthy();
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

    it("clips into the day's inbox when the journal has #enableDailyInbox", async () => {
        const journal = buildNote({
            title: "Daily inbox journal",
            "#calendarRoot": "",
            "#enableDailyInbox": ""
        });
        new BBranch({
            noteId: journal.noteId,
            parentNoteId: "root",
            branchId: `root_${journal.noteId}`
        });
        const calendarLookup = vi.spyOn(attributeService, "getNoteWithLabel").mockImplementation((name: string) =>
            name === "calendarRoot" ? journal : null);

        const result = await cls.init(() => clipperRoute.createNote({
            body: {
                title: "Clipped into the day",
                content: "<p>x</p>",
                images: [],
                clipType: "note",
                pageUrl: "https://example.com/daily-inbox"
            }
        } as unknown as Request));

        const clipped = becca.getNoteOrThrow(result.noteId);
        const inbox = clipped.getParentNotes()[0];
        expect(inbox.getOwnedLabelValue("dailyInbox")).toBeTruthy();
        expect(inbox.title).toBe("Inbox");
        expect(inbox.getParentNotes()[0].hasLabel("dateNote")).toBe(true);
        calendarLookup.mockRestore();
    });

    it("clips into the hoisted workspace journal rather than the global one", async () => {
        const { workspace, workspaceCalendar, globalJournal } = await cls.init(() => {
            const globalJournal = noteService.createNewNote({
                parentNoteId: "root",
                title: "Global journal",
                content: "",
                type: "text"
            }).note;
            globalJournal.setLabel("calendarRoot");
            globalJournal.setLabel("enableDailyInbox");

            const workspace = noteService.createNewNote({
                parentNoteId: "root",
                title: "Workspace",
                content: "",
                type: "text"
            }).note;
            workspace.setLabel("workspace");

            const workspaceCalendar = noteService.createNewNote({
                parentNoteId: workspace.noteId,
                title: "Workspace journal",
                content: "",
                type: "text"
            }).note;
            workspaceCalendar.setLabel("workspaceCalendarRoot");
            workspaceCalendar.setLabel("enableDailyInbox");

            return { workspace, workspaceCalendar, globalJournal };
        });

        const result = await cls.init(() => {
            cls.set("hoistedNoteId", workspace.noteId);
            return clipperRoute.createNote({
                body: {
                    title: "Clipped into the workspace",
                    content: "<p>x</p>",
                    images: [],
                    clipType: "note",
                    pageUrl: "https://example.com/workspace-clip"
                }
            } as unknown as Request);
        });

        const clipped = becca.getNoteOrThrow(result.noteId);
        expect(clipped.hasAncestor(workspaceCalendar.noteId)).toBe(true);
        expect(clipped.hasAncestor(globalJournal.noteId)).toBe(false);
        expect(clipped.getParentNotes()[0].getOwnedLabelValue("dailyInbox")).toBeTruthy();
    });

    it("does not clip into a journal that belongs to a nested workspace", async () => {
        const { outer, nestedCalendar, globalJournal } = await cls.init(() => {
            const globalJournal = noteService.createNewNote({
                parentNoteId: "root",
                title: "Global journal beside a nested workspace",
                content: "",
                type: "text"
            }).note;
            globalJournal.setLabel("calendarRoot");

            const outer = noteService.createNewNote({
                parentNoteId: "root",
                title: "Outer workspace",
                content: "",
                type: "text"
            }).note;
            outer.setLabel("workspace");

            const inner = noteService.createNewNote({
                parentNoteId: outer.noteId,
                title: "Inner workspace",
                content: "",
                type: "text"
            }).note;
            inner.setLabel("workspace");

            const nestedCalendar = noteService.createNewNote({
                parentNoteId: inner.noteId,
                title: "Inner journal",
                content: "",
                type: "text"
            }).note;
            nestedCalendar.setLabel("workspaceCalendarRoot");

            return { outer, nestedCalendar, globalJournal };
        });

        const lookup = vi.spyOn(attributeService, "getNoteWithLabel").mockImplementation((name: string) =>
            name === "calendarRoot" ? globalJournal : null);

        const intoGlobal = await cls.init(() => {
            cls.set("hoistedNoteId", outer.noteId);
            return clipperRoute.createNote({
                body: {
                    title: "Clipped past the nested journal",
                    content: "<p>x</p>",
                    images: [],
                    clipType: "note",
                    pageUrl: "https://example.com/nested-workspace-clip"
                }
            } as unknown as Request);
        });

        const clipped = becca.getNoteOrThrow(intoGlobal.noteId);
        expect(clipped.hasAncestor(globalJournal.noteId)).toBe(true);
        expect(clipped.hasAncestor(nestedCalendar.noteId)).toBe(false);

        lookup.mockImplementation(() => null);
        const atRoot = await cls.init(() => {
            cls.set("hoistedNoteId", outer.noteId);
            return clipperRoute.createNote({
                body: {
                    title: "Clipped with no journal at all",
                    content: "<p>x</p>",
                    images: [],
                    clipType: "note",
                    pageUrl: "https://example.com/nested-workspace-root"
                }
            } as unknown as Request);
        });
        expect(becca.getNoteOrThrow(atRoot.noteId).getParentNotes().map((parent) => parent.noteId)).toEqual([ "root" ]);
        lookup.mockRestore();
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
