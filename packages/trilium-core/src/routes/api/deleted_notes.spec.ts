import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import protectedSessionService from "../../services/protected_session";
import { getSql } from "../../services/sql/index";
import { createTextNote } from "../../test/api_fixtures";
import { CoreApiTester } from "../../test/api_tester";

/**
 * Drives the shared core deleted-notes routes through {@link CoreApiTester} (no Express), so this
 * spec runs under both the node and standalone (WASM) suites. These routes read soft-deleted rows
 * directly via SQL — they must never resolve through Becca (which excludes deleted notes).
 */
interface DeletedNoteMetadata {
    noteId: string;
    title: string;
    type: string;
    mime: string;
    blobId: string;
    isProtected: boolean;
}

interface BlobResponse {
    blobId: string;
    content: string | null;
    contentLength: number;
    isStubbed: boolean;
}

let api: CoreApiTester;

async function createDeletedNote(title: string, content = "<p>deleted body</p>"): Promise<string> {
    const { noteId } = await createTextNote(api, { title, content });
    const del = await api.delete(`/api/notes/${noteId}`, {
        query: { taskId: `deleted-notes-${noteId}`, last: "true" }
    });
    expect(del.status).toBe(204);
    return noteId;
}

describe("Deleted notes API (core)", () => {
    beforeAll(() => {
        api = CoreApiTester.build();
    });

    describe("metadata", () => {
        it("returns metadata for a soft-deleted note", async () => {
            const noteId = await createDeletedNote("Deleted metadata note");

            const res = await api.get<DeletedNoteMetadata>(`/api/deleted-notes/${noteId}/metadata`);

            expect(res.status).toBe(200);
            expect(res.body.noteId).toBe(noteId);
            expect(res.body.title).toBe("Deleted metadata note");
            expect(res.body.type).toBe("text");
            expect(typeof res.body.blobId).toBe("string");
            expect(res.body.isProtected).toBe(false);
        });

        it("returns 404 for a live (non-deleted) note", async () => {
            const { noteId } = await createTextNote(api, { title: "Still alive" });

            const res = await api.get(`/api/deleted-notes/${noteId}/metadata`);

            expect(res.status).toBe(404);
        });

        it("returns 404 for an unknown note", async () => {
            const res = await api.get("/api/deleted-notes/missingNote123/metadata");

            expect(res.status).toBe(404);
        });
    });

    describe("blob", () => {
        it("returns the decoded content of a soft-deleted text note", async () => {
            const noteId = await createDeletedNote("Deleted blob note", "<p>gone but readable</p>");

            const res = await api.get<BlobResponse>(`/api/deleted-notes/${noteId}/blob`);

            expect(res.status).toBe(200);
            expect(res.body.content).toBe("<p>gone but readable</p>");
            expect(typeof res.body.blobId).toBe("string");
        });

        it("returns 404 for a live (non-deleted) note", async () => {
            const { noteId } = await createTextNote(api, { title: "Alive blob" });

            const res = await api.get(`/api/deleted-notes/${noteId}/blob`);

            expect(res.status).toBe(404);
        });
    });

    describe("protected notes", () => {
        let protectedNoteId: string;

        beforeAll(async () => {
            protectedNoteId = await createDeletedNote("Secret deleted note");
            // Flag it protected directly in the DB (avoids needing a real protected session to create it),
            // matching how the deleted note surfaces with current_isProtected set.
            getSql().execute("UPDATE notes SET isProtected = 1 WHERE noteId = ?", [protectedNoteId]);
        });

        afterEach(() => {
            vi.restoreAllMocks();
        });

        it("masks the title when no protected session is available", async () => {
            vi.spyOn(protectedSessionService, "isProtectedSessionAvailable").mockReturnValue(false);

            const res = await api.get<DeletedNoteMetadata>(`/api/deleted-notes/${protectedNoteId}/metadata`);

            expect(res.status).toBe(200);
            expect(res.body.isProtected).toBe(true);
            expect(res.body.title).toBe("[protected]");
        });

        it("decrypts the title when a protected session is available", async () => {
            vi.spyOn(protectedSessionService, "isProtectedSessionAvailable").mockReturnValue(true);
            vi.spyOn(protectedSessionService, "decryptString").mockReturnValue("Decrypted deleted title");

            const res = await api.get<DeletedNoteMetadata>(`/api/deleted-notes/${protectedNoteId}/metadata`);

            expect(res.status).toBe(200);
            expect(res.body.title).toBe("Decrypted deleted title");
        });
    });
});
