import { BAttribute, becca, becca_easy_mocking, checkImageAttachments, collectCanvasImageFileIds, findBookmarks, findLlmChatLinks, saveLinks } from "@triliumnext/core";
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

    // `checkImageAttachments` exempts the canvas and spreadsheet rendered images by title, but not
    // the mermaid and mindMap ones. That looks like an oversight until you notice `saveLinks` bails
    // out before it for those two types, so their SVGs are never reachable by orphan erasure at all.
    // Pinned here: if either type ever gains a `saveLinks` branch, it needs an exemption first, and
    // this test is what will say so.
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
