import type {
    NoteBlocksResponse, SaveDraftRequest, SaveDraftResponse
} from "@triliumnext/commons";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import becca from "../../becca/becca";
import BNote from "../../becca/entities/bnote";
import * as cls from "../../services/context";
import { getSql } from "../../services/sql/index";
import { decodeUtf8, encodeBase64, unwrapStringOrBuffer } from "../../services/utils/binary";
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

function blobExists(blobId: string): boolean {
    return getSql().getRowOrNull("SELECT blobId FROM blobs WHERE blobId = ?", [ blobId ]) !== null;
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

        it("returns a null path for a note that hangs nowhere in the tree", async () => {
            const orphan = cls.getContext().init(() => new BNote({
                noteId: "orphanEdited1", title: "Orphan", type: "text", mime: "text/html", blobId: "",
                dateCreated: "1999-01-01 10:00:00.000+0000", dateModified: "1999-01-01 10:00:00.000+0000"
            }).save());

            try {
                const res = await api.get<Array<{ noteId: string; notePath: string[] | null }>>(
                    "/api/edited-notes/1999-01-01"
                );
                expect(res.body.find((note) => note.noteId === orphan.noteId)?.notePath).toBeNull();
            } finally {
                delete becca.notes[orphan.noteId];
                getSql().execute("DELETE FROM notes WHERE noteId = ?", [ orphan.noteId ]);
            }
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

        it("leaves out the content of a binary file revision", async () => {
            const revisionId = await createTypedRevision("file", "application/octet-stream", "bytes");

            const res = await api.get<{ content?: string; type: string }>(`/api/revisions/${revisionId}`);
            expect(res.status).toBe(200);
            expect(res.body.type).toBe("file");
            expect(res.body.content).toBeUndefined();
        });

        it("base64-encodes the content of an image revision", async () => {
            const revisionId = await createTypedRevision("image", "image/png", "binary-image-bytes");

            const res = await api.get<{ content: string; type: string }>(`/api/revisions/${revisionId}`);
            expect(res.status).toBe(200);
            expect(res.body.type).toBe("image");
            // Base64 output, decodes back to the original content.
            expect(Buffer.from(res.body.content, "base64").toString()).toContain("binary-image-bytes");
        });

        it("returns SVG image revision content as raw text, not base64", async () => {
            // SVG is text-based and is rendered client-side from a URL-encoded data URI, so it must not
            // be base64-encoded (regression from the Uint8Array compatibility refactor — see getRevision).
            const svg = "<svg xmlns='http://www.w3.org/2000/svg'><rect/></svg>";
            const revisionId = await createTypedRevision("image", "image/svg+xml", svg);

            const res = await api.get<{ content: string; type: string; mime: string }>(`/api/revisions/${revisionId}`);
            expect(res.status).toBe(200);
            expect(res.body.type).toBe("image");
            expect(res.body.mime).toBe("image/svg+xml");
            // Returned verbatim, not base64-encoded.
            expect(res.body.content).toBe(svg);
        });
    });

    describe("excess revisions", () => {
        /**
         * A note carrying one revision per description, their creation times spaced a day apart:
         * snapshots are trimmed oldest first, and several saved within the same millisecond would
         * leave that order — and with it the outcome — up to the database.
         */
        async function createNoteWithRevisions(title: string, descriptions: (string | undefined)[]) {
            const { noteId } = await createTextNote(api, { title });
            const revisionIds: string[] = [];

            for (const [ index, description ] of descriptions.entries()) {
                const res = await api.post<ForceSaveResponse>(`/api/notes/${noteId}/revision`, {
                    body: { description }
                });
                expect(res.status).toBe(200);

                getSql().execute("UPDATE revisions SET utcDateCreated = ? WHERE revisionId = ?", [
                    `2026-02-${String(index + 1).padStart(2, "0")} 00:00:00.000Z`,
                    res.body.revisionId
                ]);
                revisionIds.push(res.body.revisionId);
            }

            return { noteId, revisionIds };
        }

        function revisionIdsOf(noteId: string) {
            return getSql().getColumn<string>(
                "SELECT revisionId FROM revisions WHERE noteId = ? ORDER BY utcDateCreated ASC", [ noteId ]);
        }

        async function eraseExcess(body?: Record<string, unknown>) {
            const res = await api.post<{ erasedCount: number }>(
                "/api/revisions/erase-all-excess-revisions", body ? { body } : undefined);
            expect(res.status).toBe(200);
            return res.body.erasedCount;
        }

        it("erases excess revision snapshots across notes, reporting how many went", async () => {
            const { noteId } = await createTextNote(api, { title: "Excess" });
            await api.post(`/api/notes/${noteId}/revision`, { body: {} });

            // No limit is configured in a fresh database, so nothing is excess and the sweep is a
            // no-op — the case the button guards against, answered rather than refused.
            expect(await eraseExcess()).toBe(0);
            expect(revisionIdsOf(noteId).length).toBe(1);
        });

        it("skips deleted notes", async () => {
            const { noteId } = await createTextNote(api, { title: "Excess deleted" });
            const del = await api.delete(`/api/notes/${noteId}`, { query: { taskId: "excess-deleted", last: "true" } });
            expect(del.status).toBe(204);
            expect(becca.getNote(noteId)).toBeNull();

            expect(await eraseExcess()).toBe(0);
        });

        it("purges the content the erased snapshots held, rather than leaving it for later", async () => {
            const { noteId } = await createTextNote(api, { title: "Excess orphan" });
            const content = `<p>${"excess-orphan-".repeat(80)}</p>`;

            // Snapshot content the live note no longer holds, so the blob is the snapshot's alone.
            expect((await api.put(`/api/notes/${noteId}/data`, { body: { content } })).status).toBe(204);
            const saved = await api.post<ForceSaveResponse>(`/api/notes/${noteId}/revision`, { body: {} });
            expect(saved.status).toBe(200);
            expect((await api.put(`/api/notes/${noteId}/data`, { body: { content: "<p>moved on</p>" } })).status).toBe(204);

            const blobId = getSql().getValue<string>(
                "SELECT blobId FROM revisions WHERE revisionId = ?", [ saved.body.revisionId ]);
            expect(blobExists(blobId)).toBe(true);

            await eraseExcess({ snapshotsToKeep: 0 });

            expect(revisionIdsOf(noteId)).toEqual([]);
            expect(blobExists(blobId)).toBe(false);
        });

        it("keeps only the newest snapshots the override asks for", async () => {
            const { noteId, revisionIds } = await createNoteWithRevisions("Excess override",
                [ undefined, undefined, undefined, undefined ]);

            // Other notes of the shared database are swept too, so the total can only be a floor;
            // what this note keeps is the exact statement.
            expect(await eraseExcess({ snapshotsToKeep: 1 })).toBeGreaterThanOrEqual(3);
            expect(revisionIdsOf(noteId)).toEqual([ revisionIds[3] ]);
        });

        it("spares named snapshots without counting them against the limit", async () => {
            const { noteId, revisionIds } = await createNoteWithRevisions("Excess named",
                [ undefined, "release", undefined, "before the refactor", undefined ]);

            await eraseExcess({ snapshotsToKeep: 1, keepNamedSnapshots: true });

            // Both named snapshots survive, and the one automatic snapshot the limit allows is the
            // newest of them — the named ones did not eat into that allowance.
            expect(revisionIdsOf(noteId)).toEqual([ revisionIds[1], revisionIds[3], revisionIds[4] ]);
        });

        it("erases nothing at all when the override keeps every snapshot", async () => {
            const { noteId, revisionIds } = await createNoteWithRevisions("Excess kept",
                [ undefined, undefined ]);

            expect(await eraseExcess({ snapshotsToKeep: -1 })).toBe(0);
            expect(revisionIdsOf(noteId)).toEqual(revisionIds);
        });

        it("400s on options it cannot honour, rather than erasing by some other rule", async () => {
            const { noteId, revisionIds } = await createNoteWithRevisions("Excess rejected", [ undefined ]);

            for (const body of [
                { snapshotsToKeep: -2 },
                { snapshotsToKeep: 1.5 },
                { snapshotsToKeep: "2" },
                { keepNamedSnapshots: "yes" }
            ]) {
                const res = await api.post("/api/revisions/erase-all-excess-revisions", { body });
                expect(res.status).toBe(400);
            }

            expect(revisionIdsOf(noteId)).toEqual(revisionIds);
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

        it("gives a restored note back its links to its own attachments", async () => {
            const { noteId } = await createTextNote(api, { title: "Links its attachment" });
            await api.post(`/api/notes/${noteId}/attachments`, {
                body: { role: "file", mime: "text/plain", title: "notes.txt", content: "hello" }
            });
            const getAttachmentId = () => getSql().getValue<string>(
                "SELECT attachmentId FROM attachments WHERE ownerId = ? AND isDeleted = 0", [ noteId ]);
            const link = (attachmentId: string) => `<p><a class="reference-link" href="#root/`
                + `${noteId}?viewMode=attachments&amp;attachmentId=${attachmentId}">notes.txt</a></p>`;
            const attachmentId = getAttachmentId();
            await api.put(`/api/notes/${noteId}/data`, { body: { content: link(attachmentId) } });
            const snapshot = await api.post<{ revisionId: string }>(
                `/api/notes/${noteId}/revision`, { body: {} });
            await api.put(`/api/notes/${noteId}/data`, { body: { content: "<p>changed</p>" } });

            const restore = await api.post(`/api/revisions/${snapshot.body.revisionId}/restore`);
            expect(restore.status).toBe(204);
            const restoredId = getAttachmentId();
            expect(restoredId).not.toBe(attachmentId);
            const blob = await api.get<{ content: string }>(`/api/notes/${noteId}/blob`);
            expect(blob.body.content).toBe(link(restoredId));
        });

        it("restores a binary revision together with its attachments", async () => {
            const { noteId } = await createTextNote(api, { title: "Binary with attachment" });
            await api.put(`/api/notes/${noteId}/type`, { body: { type: "file", mime: "application/octet-stream" } });
            cls.getContext().init(() => becca.getNoteOrThrow(noteId).setContent(new Uint8Array([ 1, 2, 3 ])));
            await api.post(`/api/notes/${noteId}/attachments`, {
                body: { role: "file", mime: "text/plain", title: "kept.txt", content: "kept" }
            });
            const snapshot = await api.post<{ revisionId: string }>(`/api/notes/${noteId}/revision`, { body: {} });

            const restore = await api.post(`/api/revisions/${snapshot.body.revisionId}/restore`);
            expect(restore.status).toBe(204);

            const attachments = await api.get<Array<{ title: string }>>(`/api/notes/${noteId}/attachments`);
            expect(attachments.body.map((attachment) => attachment.title)).toEqual([ "kept.txt" ]);
            expect([ ...new Uint8Array(becca.getNoteOrThrow(noteId).getContent() as Uint8Array) ]).toEqual([ 1, 2, 3 ]);
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

    describe("drafts", () => {
        const paragraphs = [ "a", "b", "c", "d" ]
            .map((id) => `<p data-trilium-block-id="${id}">${id.toUpperCase()}</p>`).join("");

        function saveDraft(noteId: string, body: Partial<SaveDraftRequest>) {
            return api.post<SaveDraftResponse>(`/api/notes/${noteId}/revisions/draft`, {
                body: { type: "text", mime: "text/html", ...body }
            });
        }

        it("keeps an excerpt's draft as the note it was read from, with its blocks", async () => {
            const { noteId } = await createTextNote(api, { content: paragraphs });
            const note = becca.getNoteOrThrow(noteId);
            const url = `/api/notes/${noteId}/blocks`;
            const read = await api.get<NoteBlocksResponse>(url, { query: { block: "b:c" } });
            const draft = read.body.content.replace(">B<", ">B, edited here<");
            const base = { note: read.body.note, hash: read.body.hash };

            // Another writer edits a paragraph of the range before the excerpt saves.
            const other = paragraphs.replace(">C<", ">C, edited elsewhere<");
            await api.put(`/api/notes/${noteId}/data`, { body: { content: other } });
            const conflict = await api.put(url, {
                query: { block: "b:c" }, body: { content: draft, base: { hash: read.body.hash } }
            });
            expect(conflict.status).toBe(409);
            expect(note.getContent()).toBe(other);

            // Load other version: the draft goes to a revision, and the note keeps the other one.
            const kept = await saveDraft(noteId, {
                revisionId: "draftExcerpt1", fragment: { content: draft, block: "b:c", base }
            });
            expect(kept.body).toStrictEqual({
                revisionId: "draftExcerpt1", isKept: true, isFragment: false
            });
            expect(note.getContent()).toBe(other);
            const revision = becca.getRevisionOrThrow("draftExcerpt1");
            expect(revision.source).toBe("draft");
            expect(revision.description).toBeTruthy();

            expect((await api.post("/api/revisions/draftExcerpt1/restore")).status).toBe(204);
            expect(note.getContent()).toBe(paragraphs.replace(">B<", ">B, edited here<"));
        });

        it("keeps a paragraph that another writer moved into the range of a draft", async () => {
            const content = `<p>Before</p>${paragraphs}<p>After</p>`;
            const { noteId } = await createTextNote(api, { content });
            const note = becca.getNoteOrThrow(noteId);
            const read = await api.get<NoteBlocksResponse>(`/api/notes/${noteId}/blocks`, {
                query: { block: "a:b" }
            });
            // The other writer moves the end of the range past the paragraph after it.
            const b = `<p data-trilium-block-id="b">B</p>`;
            const c = `<p data-trilium-block-id="c">C</p>`;
            const moved = content.replace(b, "").replace(c, `${c}${b}`);
            await api.put(`/api/notes/${noteId}/data`, { body: { content: moved } });

            const draft = read.body.content.replace(">A<", ">A, edited<");
            await saveDraft(noteId, {
                revisionId: "draftMoved1",
                fragment: {
                    content: draft, block: "a:b",
                    base: { note: read.body.note, hash: read.body.hash }
                }
            });
            expect(becca.getRevisionOrThrow("draftMoved1").getContent())
                .toBe(content.replace(">A<", ">A, edited<"));
            expect(note.getContent()).toBe(moved);
        });

        it("keeps the draft alone without the note it was read from, with no restore", async () => {
            const { noteId } = await createTextNote(api, { content: paragraphs });
            const note = becca.getNoteOrThrow(noteId);
            const read = await api.get<NoteBlocksResponse>(`/api/notes/${noteId}/blocks`, {
                query: { block: "b:c" }
            });
            const draft = `<p data-trilium-block-id="b">B, edited</p>`
                + `<p data-trilium-block-id="c">C</p>`;
            // The note as it is now still holds the range, and is not the note read.
            const other = paragraphs.replace(">D<", ">D, edited elsewhere<");
            await api.put(`/api/notes/${noteId}/data`, { body: { content: other } });

            const bases = [
                undefined,
                { note: "<p>Another note</p>", hash: read.body.hash },
                { note: read.body.note, hash: "another" }
            ];
            for (const [ index, base ] of bases.entries()) {
                const revisionId = `draftFragment${index}`;
                const kept = await saveDraft(noteId, {
                    revisionId, fragment: { content: draft, block: "b:c", base }
                });
                expect(kept.body).toStrictEqual({ revisionId, isKept: true, isFragment: true });
                const revision = becca.getRevisionOrThrow(revisionId);
                expect(revision.source).toBe("fragment");
                expect(revision.getContent()).toBe(draft);
            }

            expect((await api.post("/api/revisions/draftFragment0/restore")).status).toBe(400);
            expect(note.getContent()).toBe(other);
        });

        it("makes one revision of a repeated draft, in the format it was written in", async () => {
            const { noteId } = await createTextNote(api, { content: "<p>Text</p>" });
            const body = {
                revisionId: "draftRepeat1", type: "code", mime: "text/x-markdown",
                content: "# Draft"
            } as const;

            const first = await saveDraft(noteId, body);
            const second = await saveDraft(noteId, body);
            expect(second.body).toStrictEqual(first.body);
            expect(first.body.isKept).toBe(true);
            const revisions = becca.getNoteOrThrow(noteId).getRevisions();
            expect(revisions.map((revision) => revision.revisionId))
                .toStrictEqual([ "draftRepeat1" ]);
            expect(revisions[0]).toMatchObject({ type: "code", mime: "text/x-markdown" });
            expect(revisions[0].getContent()).toBe("# Draft");

            const { noteId: otherNoteId } = await createTextNote(api, { content: "<p>Other</p>" });
            expect((await saveDraft(otherNoteId, body)).status).toBe(400);
            expect((await saveDraft(noteId, { revisionId: "a b", content: "x" })).status).toBe(400);
            expect((await saveDraft(noteId, { revisionId: "draftBoth", content: "x",
                fragment: { content: "x", block: "a" } })).status).toBe(400);
            expect((await api.post(`/api/notes/${noteId}/revisions/draft`)).status).toBe(400);
            expect((await saveDraft(noteId, { revisionId: "draftRows", content: "x",
                attachments: [ { title: "x" } as never ] })).status).toBe(400);

            const unavailable = vi.spyOn(becca.getNoteOrThrow(noteId), "isContentAvailable")
                .mockReturnValue(false);
            expect((await saveDraft(noteId, { revisionId: "draftLocked", content: "x" })).status)
                .toBe(400);
            unavailable.mockRestore();
            expect(revisionExists("draftLocked")).toBe(false);
        });

        it("keeps no draft of a note that keeps no revisions, and says so", async () => {
            const labels = [ [ "disableVersioning", "" ], [ "versioningLimit", "0" ] ];
            for (const [ name, value ] of labels) {
                const { noteId } = await createTextNote(api, { content: "<p>Text</p>" });
                cls.getContext().init(() => becca.getNoteOrThrow(noteId).setLabel(name, value));

                const revisionId = `draftNone${name}`;
                const kept = await saveDraft(noteId, { revisionId, content: "<p>x</p>" });
                expect(kept.body).toMatchObject({ isKept: false });
                expect(revisionExists(revisionId)).toBe(false);
            }
        });

        it("keeps the drawing of a draft, which a restore gives back to the note", async () => {
            const { noteId } = await createTextNote(api, { content: "<p>Host</p>" });
            const note = becca.getNoteOrThrow(noteId);
            const title = "drawing.excalidraw";
            await api.post(`/api/notes/${noteId}/attachments`, {
                body: { role: "file", mime: "application/json", title, content: "saved" }
            });
            const [ drawing ] = note.getAttachments();
            const embed = `<figure class="include-note" `
                + `data-attachment-id="${drawing.attachmentId}"></figure>`;

            await saveDraft(noteId, {
                revisionId: "draftDrawing1",
                content: `<p>Draft</p>${embed}`,
                attachments: [ {
                    attachmentId: drawing.attachmentId, role: "file", mime: "application/json",
                    title, content: "drawn in the draft"
                } ]
            });
            const revision = becca.getRevisionOrThrow("draftDrawing1");
            const [ copy ] = revision.getAttachments();
            expect(copy.getContent()).toBe("drawn in the draft");
            expect(revision.getContent()).toBe(`<p>Draft</p><figure class="include-note" `
                + `data-attachment-id="${copy.attachmentId}"></figure>`);
            expect(drawing.getContent()).toBe("saved");

            expect((await api.post("/api/revisions/draftDrawing1/restore")).status).toBe(204);
            expect(note.getAttachments()).toHaveLength(1);
            const [ restored ] = note.getAttachments();
            expect(restored.ownerId).toBe(noteId);
            expect(restored.getContent()).toBe("drawn in the draft");
            expect(note.getContent()).toBe(`<p>Draft</p><figure class="include-note" `
                + `data-attachment-id="${restored.attachmentId}"></figure>`);
        });

        it("adds the new attachments of a draft, and links its preview to the copies", async () => {
            const { noteId } = await createTextNote(api, { content: "<p>Host</p>" });
            const note = becca.getNoteOrThrow(noteId);
            const title = "drawing.excalidraw";
            await api.post(`/api/notes/${noteId}/attachments`, {
                body: { role: "file", mime: "application/json", title, content: "saved" }
            });
            const [ drawing ] = note.getAttachments();
            const link = (attachmentId: string) =>
                `<a href="#root/${noteId}?viewMode=attachments&amp;attachmentId=${attachmentId}">`
                + "x</a>";

            await saveDraft(noteId, {
                revisionId: "draftNewRows1",
                content: `<p>${link(drawing.attachmentId as string)}${link("elsewhere1")}</p>`,
                attachments: [
                    { role: "file", mime: "application/json", title, content: "by title" },
                    {
                        role: "image", mime: "image/png", title: "new.png",
                        content: encodeBase64("png bytes"), encoding: "base64"
                    }
                ]
            });
            const copies = new Map(becca.getRevisionOrThrow("draftNewRows1").getAttachments()
                .map((copy) => [ copy.title, copy ]));
            expect(copies.get(title)?.getContent()).toBe("by title");
            expect(decodeUtf8(copies.get("new.png")?.getContent() ?? "")).toBe("png bytes");
            expect(becca.getRevisionOrThrow("draftNewRows1").getContent()).toBe("<p><a href="
                + `"api/attachments/${copies.get(title)?.attachmentId}/download">x</a>`
                + `${link("elsewhere1")}</p>`);
            expect(note.getAttachments().map((attachment) => attachment.getContent()))
                .toStrictEqual([ "saved" ]);
        });

        it("keeps the drawing of a draft that another writer deleted meanwhile", async () => {
            const { noteId } = await createTextNote(api, { content: "<p>Host</p>" });
            const note = becca.getNoteOrThrow(noteId);
            const title = "drawing.excalidraw";
            await api.post(`/api/notes/${noteId}/attachments`, {
                body: { role: "file", mime: "application/json", title, content: "saved" }
            });
            const [ drawing ] = note.getAttachments();
            const embed = (id?: string) =>
                `<figure class="include-note" data-attachment-id="${id}"></figure>`;
            cls.getContext().init(() => drawing.markAsDeleted());

            await saveDraft(noteId, {
                revisionId: "draftDeleted1",
                content: `<p>Draft</p>${embed(drawing.attachmentId)}`,
                attachments: [ {
                    attachmentId: drawing.attachmentId, role: "file", mime: "application/json",
                    title, content: "drawn in the draft"
                } ]
            });
            const revision = becca.getRevisionOrThrow("draftDeleted1");
            const [ copy ] = revision.getAttachments();
            expect(copy.getContent()).toBe("drawn in the draft");
            expect(revision.getContent()).toBe(`<p>Draft</p>${embed(copy.attachmentId)}`);

            expect((await api.post("/api/revisions/draftDeleted1/restore")).status).toBe(204);
            const [ restored ] = note.getAttachments();
            expect(restored.getContent()).toBe("drawn in the draft");
            expect(note.getContent()).toBe(`<p>Draft</p>${embed(restored.attachmentId)}`);
        });
    });

    describe("attachment references of a revision", () => {
        it("points each form at the copies of a Markdown note, and back on restore", async () => {
            const created = await api.post<{ note: { noteId: string } }>(
                "/api/notes/root/children?target=into",
                { body: { title: "Markdown", type: "code", mime: "text/x-markdown", content: "x" } }
            );
            const { noteId } = created.body.note;
            const note = becca.getNoteOrThrow(noteId);
            await api.post(`/api/notes/${noteId}/attachments`, {
                body: { role: "image", mime: "image/png", title: "pic.png", content: "bytes" }
            });
            const [ attachment ] = note.getAttachments();
            const references = (id: string) => `![pic](api/attachments/${id}/image/pic.png)\n`
                + `[doc](#root/${noteId}?viewMode=attachments&attachmentId=${id})\n`
                + `<figure class="include-note" data-attachment-id="${id}"></figure>`;
            cls.getContext().init(() => note.setContent(references(attachment.attachmentId ?? "")));

            const revision = cls.getContext().init(() => note.saveRevision());
            const [ copy ] = revision.getAttachments();
            expect(revision.getContent()).toBe(references(copy.attachmentId ?? ""));

            const restore = await api.post(`/api/revisions/${revision.revisionId}/restore`);
            expect(restore.status).toBe(204);
            const [ restored ] = note.getAttachments();
            expect(restored.attachmentId).not.toBe(attachment.attachmentId);
            expect(note.getContent()).toBe(references(restored.attachmentId ?? ""));
        });

        it("gives the restored note the relations of its restored content", async () => {
            const { noteId: firstId } = await createTextNote(api, { title: "Embedded first" });
            const { noteId: secondId } = await createTextNote(api, { title: "Embedded second" });
            const { noteId } = await createTextNote(api, { content: "<p>Host</p>" });
            const embed = (id: string) =>
                `<figure class="include-note" data-note-id="${id}"></figure>`;
            const includes = () => becca.getNoteOrThrow(noteId).getRelations("includeNoteLink")
                .map((relation) => relation.value);

            await api.put(`/api/notes/${noteId}/data`, { body: { content: embed(firstId) } });
            const { body: { revisionId } } = await api.post<ForceSaveResponse>(
                `/api/notes/${noteId}/revision`, { body: {} }
            );
            await api.put(`/api/notes/${noteId}/data`, { body: { content: embed(secondId) } });
            expect(includes()).toStrictEqual([ secondId ]);

            await api.post(`/api/revisions/${revisionId}/restore`);
            expect(includes()).toStrictEqual([ firstId ]);
        });
    });
});
