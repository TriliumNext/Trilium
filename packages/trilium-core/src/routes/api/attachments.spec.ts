import { beforeAll, describe, expect, it } from "vitest";

import { getSql } from "../../services/sql/index";
import { createTextNote } from "../../test/api_fixtures";
import { CoreApiTester } from "../../test/api_tester";

/**
 * Drives the shared core attachment routes through {@link CoreApiTester} (no
 * Express), so this spec runs under both the node and standalone (WASM) suites.
 */
let api: CoreApiTester;

interface AttachmentPojo {
    attachmentId: string;
    ownerId: string;
    role: string;
    mime: string;
    title?: string;
    blobId: string;
}

interface ConvertResponse {
    note: { noteId: string };
    branch: { parentNoteId: string };
}

/**
 * Saves an attachment on the given note and returns it back by reading the
 * note's attachment list (the save route itself returns 204 with no body).
 */
async function saveAttachment(
    noteId: string,
    { title = "Saved attachment", content = "attachment body" } = {}
): Promise<AttachmentPojo> {
    const save = await api.post(`/api/notes/${noteId}/attachments`, {
        body: { role: "file", mime: "text/plain", title, content }
    });
    expect(save.status).toBe(204);

    const list = await api.get<AttachmentPojo[]>(`/api/notes/${noteId}/attachments`);
    const attachment = list.body.find((a) => a.title === title);
    expect(attachment).toBeTruthy();
    return attachment as AttachmentPojo;
}

function attachmentIsDeleted(attachmentId: string): number | null {
    const row = getSql().getRowOrNull<{ isDeleted: number }>(
        "SELECT isDeleted FROM attachments WHERE attachmentId = ?",
        [ attachmentId ]
    );
    return row ? row.isDeleted : null;
}

describe("Attachments API (core)", () => {
    beforeAll(() => {
        api = CoreApiTester.build();
    });

    describe("reading", () => {
        it("returns an empty attachment list for a fresh note", async () => {
            const { noteId } = await createTextNote(api, { title: "No attachments" });

            const res = await api.get<AttachmentPojo[]>(`/api/notes/${noteId}/attachments`);
            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
            expect(res.body).toHaveLength(0);
        });

        it("404s when listing attachments of a missing note", async () => {
            const res = await api.get("/api/notes/missingNote123/attachments");
            expect(res.status).toBe(404);
        });

        it("returns a single attachment by id", async () => {
            const { noteId } = await createTextNote(api, { title: "Owner" });
            const saved = await saveAttachment(noteId, { title: "By id" });

            const res = await api.get<AttachmentPojo>(`/api/attachments/${saved.attachmentId}`);
            expect(res.status).toBe(200);
            expect(res.body.attachmentId).toBe(saved.attachmentId);
            expect(res.body.ownerId).toBe(noteId);
            expect(res.body.title).toBe("By id");
        });

        it("404s for a missing attachment", async () => {
            const res = await api.get("/api/attachments/missingAttachment123");
            expect(res.status).toBe(404);
        });

        it("returns all attachments of the owning note via /all", async () => {
            const { noteId } = await createTextNote(api, { title: "Owner of two" });
            const first = await saveAttachment(noteId, { title: "First" });
            await saveAttachment(noteId, { title: "Second" });

            const res = await api.get<AttachmentPojo[]>(
                `/api/attachments/${first.attachmentId}/all`
            );
            expect(res.status).toBe(200);
            expect(res.body.map((a) => a.title).sort()).toEqual([ "First", "Second" ]);
        });

        it("returns the attachment blob", async () => {
            const { noteId } = await createTextNote(api, { title: "Blob owner" });
            const saved = await saveAttachment(noteId, {
                title: "Blob attachment",
                content: "blob content here"
            });

            const res = await api.get<{ blobId: string; content: string }>(
                `/api/attachments/${saved.attachmentId}/blob`
            );
            expect(res.status).toBe(200);
            expect(res.body.blobId).toBeTruthy();
            expect(res.body.content).toContain("blob content here");
        });

        it("returns a preview of the attachment blob", async () => {
            const { noteId } = await createTextNote(api, { title: "Preview owner" });
            const saved = await saveAttachment(noteId, {
                title: "Preview attachment",
                content: "preview body"
            });

            const res = await api.get<{ blobId: string }>(
                `/api/attachments/${saved.attachmentId}/blob`,
                { query: { preview: "true" } }
            );
            expect(res.status).toBe(200);
            expect(res.body.blobId).toBeTruthy();
        });
    });

    describe("uploading", () => {
        it("uploads a non-image file as a 'file' attachment", async () => {
            const { noteId } = await createTextNote(api, { title: "Upload target" });

            const res = await api.post<{ uploaded: boolean; url: string }>(
                `/api/notes/${noteId}/attachments/upload`,
                {
                    file: {
                        originalname: "notes.txt",
                        mimetype: "text/plain",
                        buffer: "file upload content"
                    }
                }
            );
            expect(res.status).toBe(200);
            expect(res.body.uploaded).toBe(true);
            expect(res.body.url).toContain(`#root/${noteId}`);
            expect(res.body.url).toContain("viewMode=attachments");
        });

        it("uploads an image file as an image attachment", async () => {
            const { noteId } = await createTextNote(api, { title: "Image upload target" });
            // Minimal 1x1 transparent PNG.
            const png = Buffer.from(
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
                "base64"
            );

            const res = await api.post<{ uploaded: boolean; url: string }>(
                `/api/notes/${noteId}/attachments/upload`,
                {
                    file: {
                        originalname: "pixel.png",
                        mimetype: "image/png",
                        buffer: png
                    }
                }
            );
            expect(res.status).toBe(200);
            expect(res.body.uploaded).toBe(true);
            expect(res.body.url).toContain("/image/");
        });

        it("reports a missing upload when no file is present", async () => {
            const { noteId } = await createTextNote(api, { title: "No file target" });

            const res = await api.post<{ uploaded: boolean; message: string }>(
                `/api/notes/${noteId}/attachments/upload`
            );
            expect(res.status).toBe(200);
            expect(res.body.uploaded).toBe(false);
            expect(res.body.message).toBeTruthy();
        });
    });

    describe("saving", () => {
        it("creates an attachment that can be read back", async () => {
            const { noteId } = await createTextNote(api, { title: "Save target" });
            const saved = await saveAttachment(noteId, { title: "Round trip" });

            expect(saved.attachmentId).toBeTruthy();
            expect(saved.role).toBe("file");
            expect(saved.mime).toBe("text/plain");
        });

        it("404s when saving an attachment on a missing note", async () => {
            const res = await api.post("/api/notes/missingNote123/attachments", {
                body: { role: "file", mime: "text/plain", title: "x", content: "y" }
            });
            expect(res.status).toBe(404);
        });
    });

    describe("renaming", () => {
        it("renames an attachment and returns the new title on read", async () => {
            const { noteId } = await createTextNote(api, { title: "Rename owner" });
            const saved = await saveAttachment(noteId, { title: "Old title" });

            const rename = await api.put(`/api/attachments/${saved.attachmentId}/rename`, {
                body: { title: "New title" }
            });
            expect(rename.status).toBe(204);

            const res = await api.get<AttachmentPojo>(`/api/attachments/${saved.attachmentId}`);
            expect(res.body.title).toBe("New title");
        });

        it("400s when renaming to an empty title", async () => {
            const { noteId } = await createTextNote(api, { title: "Bad rename owner" });
            const saved = await saveAttachment(noteId, { title: "Keep me" });

            const res = await api.put(`/api/attachments/${saved.attachmentId}/rename`, {
                body: { title: "   " }
            });
            expect(res.status).toBe(400);
        });
    });

    describe("converting to a note", () => {
        it("converts an attachment into a child note", async () => {
            const { noteId } = await createTextNote(api, { title: "Convert owner" });
            const saved = await saveAttachment(noteId, { title: "Becomes a note" });

            const res = await api.post<ConvertResponse>(
                `/api/attachments/${saved.attachmentId}/convert-to-note`
            );
            expect(res.status).toBe(200);
            expect(res.body.note.noteId).toBeTruthy();
            expect(res.body.branch.parentNoteId).toBe(noteId);

            // The converted attachment is soft-deleted.
            expect(attachmentIsDeleted(saved.attachmentId)).toBe(1);
        });

        it("404s when converting a missing attachment", async () => {
            const res = await api.post("/api/attachments/missingAttachment123/convert-to-note");
            expect(res.status).toBe(404);
        });
    });

    describe("deleting", () => {
        it("soft-deletes an attachment", async () => {
            const { noteId } = await createTextNote(api, { title: "Delete owner" });
            const saved = await saveAttachment(noteId, { title: "To delete" });
            expect(attachmentIsDeleted(saved.attachmentId)).toBe(0);

            const del = await api.delete(`/api/attachments/${saved.attachmentId}`);
            expect(del.status).toBe(204);
            expect(attachmentIsDeleted(saved.attachmentId)).toBe(1);

            const res = await api.get(`/api/attachments/${saved.attachmentId}`);
            expect(res.status).toBe(404);
        });

        it("is a no-op (204) when deleting a missing attachment", async () => {
            const res = await api.delete("/api/attachments/missingAttachment123");
            expect(res.status).toBe(204);
        });
    });
});
