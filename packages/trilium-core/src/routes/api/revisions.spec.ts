import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import becca from "../../becca/becca";
import * as cls from "../../services/context";
import { getSql } from "../../services/sql/index";
import { unwrapStringOrBuffer } from "../../services/utils/binary";
import { createTextNote } from "../../test/api_fixtures";
import { CoreApiTester } from "../../test/api_tester";

/**
 * Drives the shared core revision routes through {@link CoreApiTester} (no Express),
 * so this spec runs under both the node and standalone (WASM) suites.
 */
let api: CoreApiTester;

interface ForceSaveResponse {
    revisionId: string;
}

/**
 * Creates a fresh note and forces a manual revision on it, returning the
 * note id and the new revision id so tests can read/restore/erase it.
 */
async function createNoteWithRevision(
    options?: { title?: string; content?: string }
): Promise<{ noteId: string; revisionId: string }> {
    const { noteId } = await createTextNote(api, options);
    const res = await api.post<ForceSaveResponse>(`/api/notes/${noteId}/revision`, {
        body: { description: "manual snapshot" }
    });
    expect(res.status).toBe(200);
    expect(res.body.revisionId).toBeTruthy();

    return { noteId, revisionId: res.body.revisionId };
}

function revisionExists(revisionId: string): boolean {
    const row = getSql().getRowOrNull<{ revisionId: string }>(
        "SELECT revisionId FROM revisions WHERE revisionId = ?",
        [ revisionId ]
    );
    return row !== null;
}

describe("Revisions API (core)", () => {
    beforeAll(() => {
        api = CoreApiTester.build();
    });

    describe("force-saving a revision", () => {
        it("creates a revision for an existing note", async () => {
            const { noteId } = await createTextNote(api, { title: "Has revisions" });

            const res = await api.post<ForceSaveResponse>(`/api/notes/${noteId}/revision`, {
                body: { description: "first snapshot" }
            });
            expect(res.status).toBe(200);
            expect(res.body.revisionId).toBeTruthy();
        });

        it("404s when the note does not exist", async () => {
            const res = await api.post("/api/notes/missingNote123/revision", {
                body: { description: "nope" }
            });
            expect(res.status).toBe(404);
        });
    });

    describe("reading", () => {
        it("lists revisions for a note", async () => {
            const { noteId, revisionId } = await createNoteWithRevision({ title: "Listed" });

            const res = await api.get<Array<{ revisionId: string; noteId: string }>>(
                `/api/notes/${noteId}/revisions`
            );
            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
            expect(res.body.some((rev) => rev.revisionId === revisionId)).toBe(true);
            expect(res.body[0].noteId).toBe(noteId);
        });

        it("returns an empty list for a note without revisions", async () => {
            const { noteId } = await createTextNote(api, { title: "No revisions" });

            const res = await api.get<unknown[]>(`/api/notes/${noteId}/revisions`);
            expect(res.status).toBe(200);
            expect(res.body).toEqual([]);
        });

        it("returns a single revision by id", async () => {
            const { noteId, revisionId } = await createNoteWithRevision({
                title: "Single",
                content: "<p>snapshot body</p>"
            });

            const res = await api.get<{ revisionId: string; noteId: string; type: string }>(
                `/api/revisions/${revisionId}`
            );
            expect(res.status).toBe(200);
            expect(res.body.revisionId).toBe(revisionId);
            expect(res.body.noteId).toBe(noteId);
            expect(res.body.type).toBeTruthy();
        });

        it("returns the revision blob", async () => {
            const { revisionId } = await createNoteWithRevision({ content: "<p>blob body</p>" });

            const res = await api.get<{ blobId: string; content: string }>(
                `/api/revisions/${revisionId}/blob`
            );
            expect(res.status).toBe(200);
            expect(res.body.blobId).toBeTruthy();
            expect(typeof res.body.content).toBe("string");
            expect(res.body.content).toContain("blob body");
        });

        it("404s for a missing revision", async () => {
            const res = await api.get("/api/revisions/missingRevision123");
            expect(res.status).toBe(404);
        });
    });

    describe("updating the description", () => {
        it("updates an existing revision's description", async () => {
            const { revisionId } = await createNoteWithRevision({ title: "Describe me" });

            const res = await api.patch(`/api/revisions/${revisionId}`, {
                body: { description: "edited description" }
            });
            expect(res.status).toBe(204);

            const row = getSql().getRowOrNull<{ description: string }>(
                "SELECT description FROM revisions WHERE revisionId = ?",
                [ revisionId ]
            );
            expect(row?.description).toBe("edited description");
        });

        it("404s when updating a missing revision", async () => {
            const res = await api.patch("/api/revisions/missingRevision123", {
                body: { description: "whatever" }
            });
            expect(res.status).toBe(404);
        });
    });

    describe("restoring", () => {
        it("restores a revision and creates a new pre-restore snapshot", async () => {
            const { noteId, revisionId } = await createNoteWithRevision({
                title: "Original",
                content: "<p>original body</p>"
            });

            // Mutate the note away from the snapshotted state.
            const update = await api.put(`/api/notes/${noteId}/data`, {
                body: { content: "<p>changed body</p>" }
            });
            expect(update.status).toBe(204);

            const restore = await api.post(`/api/revisions/${revisionId}/restore`);
            expect(restore.status).toBe(204);

            const blob = await api.get<{ content: string }>(`/api/notes/${noteId}/blob`);
            expect(blob.body.content).toContain("original body");

            // Restoring snapshots the pre-restore state, so there is now more than one revision.
            const revisions = await api.get<unknown[]>(`/api/notes/${noteId}/revisions`);
            expect(revisions.body.length).toBeGreaterThan(1);
        });

        it("no-ops for a missing revision", async () => {
            const res = await api.post("/api/revisions/missingRevision123/restore");
            expect(res.status).toBe(204);
        });
    });

    describe("erasing", () => {
        it("erases a single revision", async () => {
            const { revisionId } = await createNoteWithRevision({ title: "Erase one" });
            expect(revisionExists(revisionId)).toBe(true);

            const res = await api.delete(`/api/revisions/${revisionId}`);
            expect(res.status).toBe(204);
            expect(revisionExists(revisionId)).toBe(false);
        });

        it("erases all revisions of a note", async () => {
            const { noteId, revisionId } = await createNoteWithRevision({ title: "Erase all" });
            expect(revisionExists(revisionId)).toBe(true);

            const res = await api.delete(`/api/notes/${noteId}/revisions`);
            expect(res.status).toBe(204);
            expect(revisionExists(revisionId)).toBe(false);

            const list = await api.get<unknown[]>(`/api/notes/${noteId}/revisions`);
            expect(list.body).toEqual([]);
        });
    });

    describe("edited notes on a date", () => {
        it("returns notes edited on the given date", async () => {
            const { noteId } = await createTextNote(api, { title: "Edited today" });

            const row = getSql().getRowOrNull<{ dateModified: string }>(
                "SELECT dateModified FROM notes WHERE noteId = ?",
                [ noteId ]
            );
            const date = (row?.dateModified ?? "").substring(0, 10);
            expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);

            const res = await api.get<Array<{ noteId: string; notePath: string[] | null }>>(
                `/api/edited-notes/${date}`
            );
            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
            expect(res.body.some((note) => note.noteId === noteId)).toBe(true);
        });

        it("returns an empty list for a date with no edits", async () => {
            const res = await api.get<unknown[]>("/api/edited-notes/1970-01-01");
            expect(res.status).toBe(200);
            expect(res.body).toEqual([]);
        });

        it("includes the root note (none_root branch) when it matches the date", async () => {
            const row = getSql().getRowOrNull<{ dateModified: string }>(
                "SELECT dateModified FROM notes WHERE noteId = 'root'"
            );
            const date = (row?.dateModified ?? "").substring(0, 10);

            const res = await api.get<Array<{ noteId: string; notePath: string[] | null }>>(
                `/api/edited-notes/${date}`
            );
            expect(res.status).toBe(200);
            expect(res.body.some((note) => note.noteId === "root")).toBe(true);
        });

        it("narrows results to the hoisted subtree", async () => {
            const parent = await createTextNote(api, { title: "Hoisted parent" });
            const child = await createTextNote(api, { parentNoteId: parent.noteId, title: "Hoisted child" });

            const row = getSql().getRowOrNull<{ dateModified: string }>(
                "SELECT dateModified FROM notes WHERE noteId = ?",
                [ child.noteId ]
            );
            const date = (row?.dateModified ?? "").substring(0, 10);

            // Pretend the parent is hoisted so the handler filters by ancestry.
            const spy = vi.spyOn(cls, "getHoistedNoteId").mockReturnValue(parent.noteId);
            try {
                const res = await api.get<Array<{ noteId: string }>>(`/api/edited-notes/${date}`);
                expect(res.status).toBe(200);
                expect(res.body.some((note) => note.noteId === child.noteId)).toBe(true);
                // root was edited some other day, but even if present it is filtered out by the hoist.
                expect(res.body.every((note) => note.noteId !== "root")).toBe(true);
            } finally {
                spy.mockRestore();
            }
        });
    });

    describe("typed revisions", () => {
        /**
         * Snapshots a note after coercing it to a given type, so we can drive the
         * type-specific branches of the `getRevision` handler.
         */
        async function createTypedRevision(
            type: string,
            mime: string,
            content: string
        ): Promise<string> {
            const { noteId } = await createTextNote(api, { content });
            const typeRes = await api.put(`/api/notes/${noteId}/type`, { body: { type, mime } });
            expect(typeRes.status).toBe(204);

            const res = await api.post<{ revisionId: string }>(`/api/notes/${noteId}/revision`, {
                body: { description: "typed" }
            });
            expect(res.status).toBe(200);
            return res.body.revisionId;
        }

        it("truncates string content of a file revision", async () => {
            const revisionId = await createTypedRevision("file", "text/plain", "x".repeat(15000));

            const res = await api.get<{ content: string; type: string }>(`/api/revisions/${revisionId}`);
            expect(res.status).toBe(200);
            expect(res.body.type).toBe("file");
            expect(res.body.content.length).toBeLessThanOrEqual(10000);
        });

        it("base64-encodes the content of an image revision", async () => {
            const revisionId = await createTypedRevision("image", "image/png", "binary-image-bytes");

            const res = await api.get<{ content: string; type: string }>(`/api/revisions/${revisionId}`);
            expect(res.status).toBe(200);
            expect(res.body.type).toBe("image");
            // Base64 output, decodes back to the original content.
            expect(Buffer.from(res.body.content, "base64").toString()).toContain("binary-image-bytes");
        });
    });

    describe("excess revisions", () => {
        it("erases excess revision snapshots across notes", async () => {
            const { noteId } = await createTextNote(api, { title: "Excess" });
            await api.post(`/api/notes/${noteId}/revision`, { body: {} });

            const res = await api.post("/api/revisions/erase-all-excess-revisions");
            expect(res.status).toBe(204);
        });
    });

    describe("description validation", () => {
        it("400s when the description is not a string", async () => {
            const { revisionId } = await createNoteWithRevision({ title: "Bad description" });

            const res = await api.patch(`/api/revisions/${revisionId}`, {
                body: { description: 123 }
            });
            expect(res.status).toBe(400);
        });
    });

    describe("restoring with attachments", () => {
        it("restores a revision whose snapshot referenced attachments", async () => {
            const { noteId } = await createTextNote(api, { title: "Has attachment" });

            // Attach an image to the note, then reference it from the note content.
            const saveRes = await api.post(`/api/notes/${noteId}/attachments`, {
                body: { role: "image", mime: "image/png", title: "pic.png", content: "image-bytes" }
            });
            expect(saveRes.status).toBe(204);

            const attRow = getSql().getRowOrNull<{ attachmentId: string }>(
                "SELECT attachmentId FROM attachments WHERE ownerId = ? AND isDeleted = 0",
                [ noteId ]
            );
            const attachmentId = attRow?.attachmentId as string;
            expect(attachmentId).toBeTruthy();

            await api.put(`/api/notes/${noteId}/data`, {
                body: { content: `<img src="attachments/${attachmentId}">` }
            });

            const snapshot = await api.post<{ revisionId: string }>(`/api/notes/${noteId}/revision`, {
                body: {}
            });
            const revisionId = snapshot.body.revisionId;

            // Move the note away from the snapshot, then restore it.
            await api.put(`/api/notes/${noteId}/data`, { body: { content: "<p>changed</p>" } });

            const restore = await api.post(`/api/revisions/${revisionId}/restore`);
            expect(restore.status).toBe(204);

            // The restored content rewrites attachment references to the new attachment ids.
            const blob = await api.get<{ content: string }>(`/api/notes/${noteId}/blob`);
            expect(blob.body.content).toContain("attachments/");
        });
    });

    describe("download (GET /api/revisions/:revisionId/download)", () => {
        afterEach(() => vi.restoreAllMocks());

        it("sends revision content with a content-disposition filename", async () => {
            const { revisionId } = await createNoteWithRevision({
                title: "Downloadable",
                content: "<p>download me</p>"
            });

            const res = await api.get<Buffer>(`/api/revisions/${revisionId}/download`);

            expect(res.status).toBe(200);
            expect(res.headers["Content-Disposition"]).toMatch(/Downloadable/);
            expect(res.headers["Content-Type"]).toBeTruthy();
            expect(unwrapStringOrBuffer(res.body as never)).toContain("download me");
        });

        it("appends the creation date when the filename has no extension", async () => {
            // A file note with an octet-stream mime yields a download title without an
            // extension, so the date is appended to the bare filename.
            const { noteId } = await createTextNote(api, { title: "No extension title", content: "data" });
            await api.put(`/api/notes/${noteId}/type`, {
                body: { type: "file", mime: "application/octet-stream" }
            });
            const { revisionId } = (await api.post<{ revisionId: string }>(
                `/api/notes/${noteId}/revision`, { body: {} }
            )).body;

            const res = await api.get(`/api/revisions/${revisionId}/download`);
            expect(res.status).toBe(200);
            expect(res.headers["Content-Disposition"]).toMatch(/\d{8}/);
        });

        it("401s when the revision content is not available", async () => {
            const { revisionId } = await createNoteWithRevision({ title: "Protected download" });

            // A real protected revision needs a protected session to set up; instead
            // override the lookup (getRevisionOrThrow builds a fresh BRevision per call)
            // to report its content as unavailable.
            const revision = becca.getRevisionOrThrow(revisionId);
            revision.isContentAvailable = () => false;
            vi.spyOn(becca, "getRevisionOrThrow").mockReturnValue(revision);

            const res = await api.get<string>(`/api/revisions/${revisionId}/download`);
            expect(res.status).toBe(401);
            expect(res.headers["Content-Type"]).toBe("text/plain");
        });

        it("500s when the revision is missing a creation date", async () => {
            const { revisionId } = await createNoteWithRevision({ title: "No date" });

            // Force the defensive "missing creation date" guard in getRevisionFilename
            // (real revisions always have a creation date).
            const revision = becca.getRevisionOrThrow(revisionId);
            revision.dateCreated = undefined as never;
            vi.spyOn(becca, "getRevisionOrThrow").mockReturnValue(revision);

            const res = await api.get(`/api/revisions/${revisionId}/download`);
            expect(res.status).toBe(500);
        });
    });
});
