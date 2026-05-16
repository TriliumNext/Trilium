import { beforeEach, describe, expect, it, vi } from "vitest";
import becca from "../becca/becca.js";
import { buildNote } from "../test/becca_easy_mocking.js";
import { randomString } from "./utils.js";
import BAttribute from "../becca/entities/battribute.js";
import { checkImageAttachments, findBookmarks, saveLinks } from "./notes.js";

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

        it("schedules unreferenced attachments for erasure", () => {
            const note = buildNote({ title: "Test", attachments: [{ title: "test.png", role: "image", mime: "image/png" }] });
            mockAttachmentSaves(note);
            const [att] = note.getAttachments();

            checkImageAttachments(note, "<p>No images here</p>");

            expect(att.save).toHaveBeenCalled();
            expect(att.utcDateScheduledForErasureSince).toBeTruthy();
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
});
