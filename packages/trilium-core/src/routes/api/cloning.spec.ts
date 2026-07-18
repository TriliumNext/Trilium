import { beforeAll, describe, expect, it } from "vitest";

import { getSql } from "../../services/sql/index";
import { createTextNote } from "../../test/api_fixtures";
import { CoreApiTester } from "../../test/api_tester";

/**
 * Drives the shared core cloning routes through {@link CoreApiTester} (no Express),
 * so this spec runs under both the node and standalone (WASM) suites.
 *
 * The cloning service never throws for invalid input — it always returns a JSON
 * payload with `{ success: boolean }`, so the "error" paths here assert on
 * `res.body.success` (status stays 200) rather than on HTTP status codes.
 */
interface CloneResult {
    success: boolean;
    message?: string;
    branchId?: string;
    notePath?: string;
}

let api: CoreApiTester;

function branchRow(branchId: string) {
    return getSql().getRowOrNull<{
        noteId: string;
        parentNoteId: string;
        prefix: string | null;
        isDeleted: number;
    }>(
        "SELECT noteId, parentNoteId, prefix, isDeleted FROM branches WHERE branchId = ?",
        [ branchId ]
    );
}

describe("Cloning API (core)", () => {
    beforeAll(() => {
        api = CoreApiTester.build();
    });

    describe("clone-to-note", () => {
        it("clones a note under another parent note and persists the branch", async () => {
            const child = await createTextNote(api, { title: "Cloneable" });
            const target = await createTextNote(api, { title: "Clone target" });

            const res = await api.put<CloneResult>(
                `/api/notes/${child.noteId}/clone-to-note/${target.noteId}`,
                { body: { prefix: "myPrefix" } }
            );

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.branchId).toBeTruthy();
            expect(res.body.notePath).toContain(child.noteId);

            const row = branchRow(res.body.branchId!);
            expect(row).toMatchObject({
                noteId: child.noteId,
                parentNoteId: target.noteId,
                prefix: "myPrefix",
                isDeleted: 0
            });
        });

        it("reports failure when the parent note does not exist", async () => {
            const child = await createTextNote(api, { title: "Orphan clone" });

            const res = await api.put<CloneResult>(
                `/api/notes/${child.noteId}/clone-to-note/missingParent123`,
                { body: {} }
            );

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(false);
            expect(res.body.message).toBeTruthy();
        });
    });

    describe("clone-to-branch", () => {
        it("clones a note into the parent of an existing branch", async () => {
            const child = await createTextNote(api, { title: "Branch cloneable" });
            const target = await createTextNote(api, { title: "Branch target" });

            const res = await api.put<CloneResult>(
                `/api/notes/${child.noteId}/clone-to-branch/${target.branchId}`,
                { body: { prefix: "branchPrefix" } }
            );

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.branchId).toBeTruthy();

            const row = branchRow(res.body.branchId!);
            expect(row).toMatchObject({
                noteId: child.noteId,
                parentNoteId: target.noteId,
                prefix: "branchPrefix",
                isDeleted: 0
            });
        });

        it("reports failure for a missing parent branch", async () => {
            const child = await createTextNote(api, { title: "No branch" });

            const res = await api.put<CloneResult>(
                `/api/notes/${child.noteId}/clone-to-branch/missingBranch123`,
                { body: {} }
            );

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(false);
            expect(res.body.message).toBeTruthy();
        });
    });

    describe("clone-after", () => {
        it("clones a note after an existing sibling branch", async () => {
            const host = await createTextNote(api, { title: "Clone-after host" });
            const sibling = await createTextNote(api, {
                parentNoteId: host.noteId,
                title: "Existing sibling"
            });
            // Cloning into `host` only succeeds if the child isn't already there,
            // so the cloned note lives elsewhere (under root).
            const child = await createTextNote(api, { title: "After cloneable" });

            const res = await api.put<CloneResult>(
                `/api/notes/${child.noteId}/clone-after/${sibling.branchId}`
            );

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.branchId).toBeTruthy();

            const row = branchRow(res.body.branchId!);
            expect(row).toMatchObject({
                noteId: child.noteId,
                parentNoteId: host.noteId,
                isDeleted: 0
            });
        });

        it("refuses to clone the root note", async () => {
            const sibling = await createTextNote(api, { title: "Root guard sibling" });

            const res = await api.put<CloneResult>(
                `/api/notes/root/clone-after/${sibling.branchId}`
            );

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(false);
            expect(res.body.message).toBeTruthy();
        });

        it("reports failure for a missing after-branch", async () => {
            const child = await createTextNote(api, { title: "After missing" });

            const res = await api.put<CloneResult>(
                `/api/notes/${child.noteId}/clone-after/missingAfter123`
            );

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(false);
            expect(res.body.message).toBeTruthy();
        });
    });

    describe("toggle-in-parent", () => {
        it("adds and then removes a note from a parent", async () => {
            const child = await createTextNote(api, { title: "Toggleable" });
            const target = await createTextNote(api, { title: "Toggle target" });

            interface ToggleAddResult {
                success: boolean;
                branch: { branchId: string; parentNoteId: string; noteId: string } | null;
            }
            const add = await api.put<ToggleAddResult>(
                `/api/notes/${child.noteId}/toggle-in-parent/${target.noteId}/true`
            );
            expect(add.status).toBe(200);
            expect(add.body.success).toBe(true);
            expect(add.body.branch).toMatchObject({
                noteId: child.noteId,
                parentNoteId: target.noteId
            });

            const addedBranchId = add.body.branch!.branchId;
            expect(branchRow(addedBranchId)?.isDeleted).toBe(0);

            const remove = await api.put<CloneResult>(
                `/api/notes/${child.noteId}/toggle-in-parent/${target.noteId}/false`
            );
            expect(remove.status).toBe(200);
            expect(remove.body.success).toBe(true);
            expect(branchRow(addedBranchId)?.isDeleted).toBe(1);
        });

        it("refuses to remove the only parent of a note", async () => {
            const child = await createTextNote(api, { title: "Single parent" });

            const res = await api.put<CloneResult>(
                `/api/notes/${child.noteId}/toggle-in-parent/root/false`
            );

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(false);
            expect(res.body.message).toBeTruthy();
        });
    });
});
