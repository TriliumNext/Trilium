import { beforeAll, describe, expect, it, vi } from "vitest";

import becca from "../../becca/becca";
import noteService from "../../services/notes";
import { getSql } from "../../services/sql/index";
import { createTextNote } from "../../test/api_fixtures";
import { CoreApiTester } from "../../test/api_tester";

/**
 * Drives the shared core note routes through {@link CoreApiTester} (no Express),
 * so this spec runs under both the node and standalone (WASM) suites.
 */
let api: CoreApiTester;

function noteIsDeleted(noteId: string): number | null {
    const row = getSql().getRowOrNull<{ isDeleted: number }>(
        "SELECT isDeleted FROM notes WHERE noteId = ?",
        [ noteId ]
    );
    return row ? row.isDeleted : null;
}

describe("Notes API (core)", () => {
    beforeAll(() => {
        api = CoreApiTester.build();
    });

    describe("reading", () => {
        it("returns note metadata for an existing note", async () => {
            const res = await api.get<{ noteId: string; type: string }>("/api/notes/root");
            expect(res.status).toBe(200);
            expect(res.body.noteId).toBe("root");
            expect(res.body.type).toBeTruthy();
        });

        it("returns timestamp metadata", async () => {
            const res = await api.get("/api/notes/root/metadata");
            expect(res.status).toBe(200);
            expect(res.body).toMatchObject({
                dateCreated: expect.any(String),
                utcDateCreated: expect.any(String),
                dateModified: expect.any(String),
                utcDateModified: expect.any(String)
            });
        });

        it("returns the note blob", async () => {
            const res = await api.get<{ blobId: string; content: string }>("/api/notes/root/blob");
            expect(res.status).toBe(200);
            expect(res.body.blobId).toBeTruthy();
            expect(typeof res.body.content).toBe("string");
        });

        it("404s for a missing note", async () => {
            const res = await api.get("/api/notes/missingNote123");
            expect(res.status).toBe(404);
        });
    });

    describe("creating", () => {
        it("creates a child note under root", async () => {
            interface CreateResponse {
                note: { noteId: string; title: string };
                branch: { parentNoteId: string };
            }
            const res = await api.post<CreateResponse>(
                "/api/notes/root/children?target=into",
                { body: { title: "Created via API", type: "text", content: "<p>body</p>" } }
            );

            expect(res.status).toBe(200);
            expect(res.body.note.noteId).toBeTruthy();
            expect(res.body.note.title).toBe("Created via API");
            expect(res.body.branch.parentNoteId).toBe("root");
        });

        it("400s when the target query param is invalid", async () => {
            const res = await api.post("/api/notes/root/children", {
                body: { title: "no target", type: "text" }
            });
            expect(res.status).toBe(400);
        });
    });

    describe("updating", () => {
        it("changes a note title and returns the updated note", async () => {
            const { noteId } = await createTextNote(api, { title: "Before" });

            const res = await api.put<{ title: string }>(`/api/notes/${noteId}/title`, {
                body: { title: "After" }
            });
            expect(res.status).toBe(200);
            expect(res.body.title).toBe("After");
        });

        it("updates note content", async () => {
            const { noteId } = await createTextNote(api, { content: "<p>old</p>" });

            const update = await api.put(`/api/notes/${noteId}/data`, {
                body: { content: "<p>new</p>" }
            });
            expect(update.status).toBe(204);

            const blob = await api.get<{ content: string }>(`/api/notes/${noteId}/blob`);
            expect(blob.body.content).toContain("new");
        });
    });

    describe("deleting and undeleting", () => {
        it("soft-deletes a note, then undeletes it", async () => {
            const { noteId } = await createTextNote(api, { title: "To delete" });
            expect(noteIsDeleted(noteId)).toBe(0);

            const del = await api.delete(`/api/notes/${noteId}`, {
                query: { taskId: "test-delete", last: "true" }
            });
            expect(del.status).toBe(204);
            expect(noteIsDeleted(noteId)).toBe(1);

            const undel = await api.put(`/api/notes/${noteId}/undelete`);
            expect(undel.status).toBe(204);
            expect(noteIsDeleted(noteId)).toBe(0);
        });

        it("400s when deleting without a taskId", async () => {
            const { noteId } = await createTextNote(api, { title: "Needs taskId" });
            const res = await api.delete(`/api/notes/${noteId}`);
            expect(res.status).toBe(400);
        });

        it("erases a note immediately when eraseNotes is set", async () => {
            const { noteId } = await createTextNote(api, { title: "Erase now" });

            const del = await api.delete(`/api/notes/${noteId}`, {
                query: { taskId: "test-erase", eraseNotes: "true", last: "true" }
            });
            expect(del.status).toBe(204);
            // Erasing removes the row entirely rather than just flagging it deleted.
            expect(noteIsDeleted(noteId)).toBeNull();
        });
    });

    describe("creating with targets", () => {
        it("creates a sibling note after a target branch", async () => {
            const anchor = await createTextNote(api, { title: "Anchor" });

            interface CreateResponse {
                note: { noteId: string };
                branch: { parentNoteId: string };
            }
            const res = await api.post<CreateResponse>(
                "/api/notes/root/children",
                { query: { target: "after", targetBranchId: anchor.branchId }, body: { title: "After sibling", type: "text", content: "" } }
            );
            expect(res.status).toBe(200);
            expect(res.body.note.noteId).toBeTruthy();
            expect(res.body.branch.parentNoteId).toBe("root");
        });
    });

    describe("revisions and conversion", () => {
        it("force-saves a revision and returns its id", async () => {
            const { noteId } = await createTextNote(api, { title: "Snapshot me" });
            const res = await api.post<{ revisionId: string }>(`/api/notes/${noteId}/revision`, {
                body: { description: "manual" }
            });
            expect(res.status).toBe(200);
            expect(res.body.revisionId).toBeTruthy();
        });

        it("400s force-saving a revision of a protected note without a protected session", async () => {
            const { noteId } = await createTextNote(api, { title: "Protected revision" });
            becca.notes[noteId].isProtected = true;

            const res = await api.post(`/api/notes/${noteId}/revision`, { body: {} });
            expect(res.status).toBe(400);

            becca.notes[noteId].isProtected = false;
        });

        it("returns a null attachment for a note ineligible for conversion", async () => {
            const { noteId } = await createTextNote(api, { title: "Not an image" });
            const res = await api.post<{ attachment: unknown }>(`/api/notes/${noteId}/convert-to-attachment`);
            expect(res.status).toBe(200);
            expect(res.body.attachment).toBeNull();
        });
    });

    describe("title and type", () => {
        it("400s changing the title of a protected note without a protected session", async () => {
            const { noteId } = await createTextNote(api, { title: "Locked" });
            becca.notes[noteId].isProtected = true;

            const res = await api.put(`/api/notes/${noteId}/title`, { body: { title: "Nope" } });
            expect(res.status).toBe(400);

            becca.notes[noteId].isProtected = false;
        });

        it("leaves the note untouched when the title is unchanged", async () => {
            const { noteId } = await createTextNote(api, { title: "Same title" });
            const res = await api.put<{ title: string }>(`/api/notes/${noteId}/title`, {
                body: { title: "Same title" }
            });
            expect(res.status).toBe(200);
            expect(res.body.title).toBe("Same title");
        });

        it("sets the note type and mime", async () => {
            const { noteId } = await createTextNote(api, { title: "Type me" });
            const res = await api.put(`/api/notes/${noteId}/type`, {
                body: { type: "code", mime: "text/x-python" }
            });
            expect(res.status).toBe(204);

            const note = await api.get<{ type: string; mime: string }>(`/api/notes/${noteId}`);
            expect(note.body.type).toBe("code");
            expect(note.body.mime).toBe("text/x-python");
        });
    });

    describe("structural operations", () => {
        it("sorts child notes", async () => {
            const parent = await createTextNote(api, { title: "Sort parent" });
            await createTextNote(api, { parentNoteId: parent.noteId, title: "Zebra" });
            await createTextNote(api, { parentNoteId: parent.noteId, title: "Alpha" });

            const res = await api.put(`/api/notes/${parent.noteId}/sort-children`, {
                body: { sortBy: "title", sortDirection: "asc", foldersFirst: false, sortNatural: false, sortLocale: "" }
            });
            expect(res.status).toBe(204);

            const children = becca.notes[parent.noteId].getChildNotes();
            expect(children[0].title).toBe("Alpha");
        });

        it("protects a note recursively", async () => {
            const { noteId } = await createTextNote(api, { title: "Protect target" });

            // The actual (un)protect requires an active protected session, which the
            // in-process tester does not have, so stub the recursive worker and assert
            // the handler drives it (with subtree) and reports task success.
            const spy = vi.spyOn(noteService, "protectNoteRecursively").mockImplementation(() => {});
            try {
                const res = await api.put(`/api/notes/${noteId}/protect/1`, { query: { subtree: "1" } });
                expect(res.status).toBe(204);
                expect(spy).toHaveBeenCalledWith(becca.notes[noteId], true, true, expect.anything());
            } finally {
                spy.mockRestore();
            }
        });

        it("duplicates a subtree under a parent", async () => {
            const original = await createTextNote(api, { title: "Original subtree" });
            await createTextNote(api, { parentNoteId: original.noteId, title: "Child" });

            interface DuplicateResponse {
                note: { noteId: string; title: string };
            }
            const res = await api.post<DuplicateResponse>(
                `/api/notes/${original.noteId}/duplicate/root`
            );
            expect(res.status).toBe(200);
            expect(res.body.note.noteId).not.toBe(original.noteId);
            expect(res.body.note.title).toContain("Original subtree");
        });
    });

    describe("erase and preview operations", () => {
        it("erases deleted notes now", async () => {
            const { noteId } = await createTextNote(api, { title: "Will be erased" });
            await api.delete(`/api/notes/${noteId}`, { query: { taskId: "erase-deleted", last: "true" } });

            const res = await api.post("/api/notes/erase-deleted-notes-now");
            expect(res.status).toBe(204);
            expect(noteIsDeleted(noteId)).toBeNull();
        });

        it("erases unused attachments now", async () => {
            const res = await api.post("/api/notes/erase-unused-attachments-now");
            expect(res.status).toBe(204);
        });

        it("previews a subtree to be deleted and surfaces broken relations", async () => {
            // parent → child, with an outside note holding a relation to the child;
            // deleting the parent recurses into the child and breaks the outside relation.
            const parent = await createTextNote(api, { title: "Preview parent" });
            const child = await createTextNote(api, { parentNoteId: parent.noteId, title: "Preview child" });
            const outside = await createTextNote(api, { title: "Preview outside" });

            const rel = await api.put(
                `/api/notes/${outside.noteId}/relations/refToChild/to/${child.noteId}`,
                { body: {} }
            );
            expect(rel.status).toBeLessThan(300);

            const res = await api.post<{ noteIdsToBeDeleted: string[]; brokenRelations: Array<{ noteId: string }> }>(
                "/api/delete-notes-preview",
                { body: { branchIdsToDelete: [ parent.branchId ], deleteAllClones: true } }
            );
            expect(res.status).toBe(200);
            expect(res.body.noteIdsToBeDeleted).toEqual(expect.arrayContaining([ parent.noteId, child.noteId ]));
            expect(res.body.brokenRelations.some((attr) => attr.noteId === outside.noteId)).toBe(true);
        });

        it("skips missing branches in the delete preview", async () => {
            const res = await api.post<{ noteIdsToBeDeleted: string[] }>(
                "/api/delete-notes-preview",
                { body: { branchIdsToDelete: [ "missingBranch123" ], deleteAllClones: false } }
            );
            expect(res.status).toBe(200);
            expect(res.body.noteIdsToBeDeleted).toEqual([]);
        });

        it("skips weak branches (e.g. bookmarks) in the delete preview", async () => {
            const note = await createTextNote(api, { title: "Weakly linked" });

            // A clone under _lbBookmarks produces a weak branch, which the preview ignores.
            interface CloneResponse { branchId: string }
            const clone = await api.put<CloneResponse>(
                `/api/notes/${note.noteId}/clone-to-note/_lbBookmarks`,
                { body: {} }
            );
            expect(clone.status).toBe(200);
            expect(clone.body.branchId).toBeTruthy();

            const res = await api.post<{ noteIdsToBeDeleted: string[] }>(
                "/api/delete-notes-preview",
                { body: { branchIdsToDelete: [ clone.body.branchId ], deleteAllClones: true } }
            );
            expect(res.status).toBe(200);
            expect(res.body.noteIdsToBeDeleted).toEqual([]);
        });
    });
});
