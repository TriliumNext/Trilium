import { beforeAll, describe, expect, it } from "vitest";

import { getSql } from "../../services/sql/index";
import { createTextNote } from "../../test/api_fixtures";
import { CoreApiTester } from "../../test/api_tester";

/**
 * Drives the shared core branch routes through {@link CoreApiTester} (no Express),
 * so this spec runs under both the node and standalone (WASM) suites.
 */
let api: CoreApiTester;

interface BranchRow {
    parentNoteId: string;
    prefix: string | null;
    isExpanded: number;
    isDeleted: number;
}

function getBranchRow(branchId: string): BranchRow | null {
    return getSql().getRowOrNull<BranchRow>(
        "SELECT parentNoteId, prefix, isExpanded, isDeleted FROM branches WHERE branchId = ?",
        [ branchId ]
    );
}

describe("Branches API (core)", () => {
    beforeAll(() => {
        api = CoreApiTester.build();
    });

    describe("moving", () => {
        it("moves a branch under a different parent and returns the new clone", async () => {
            const parent = await createTextNote(api, { title: "Move target parent" });
            const child = await createTextNote(api, { title: "Branch to move" });

            const res = await api.put<{ success: boolean; branch?: { parentNoteId: string } }>(
                `/api/branches/${child.branchId}/move-to/${parent.branchId}`
            );

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.branch?.parentNoteId).toBe(parent.noteId);
            // The original branch is replaced by a clone under the new parent.
            expect(getBranchRow(child.branchId)?.isDeleted).toBe(1);
        });

        it("400s when moving a non-existent branch", async () => {
            const parent = await createTextNote(api, { title: "Has a valid parent branch" });
            const res = await api.put(`/api/branches/missingBranch123/move-to/${parent.branchId}`);
            expect(res.status).toBe(400);
        });

        it("reorders a branch before a sibling", async () => {
            const parent = await createTextNote(api, { title: "Reorder parent" });
            const parentId = parent.noteId;
            const first = await createTextNote(api, { parentNoteId: parentId, title: "First" });
            const second = await createTextNote(api, { parentNoteId: parentId, title: "Second" });

            const res = await api.put<{ success: boolean }>(
                `/api/branches/${second.branchId}/move-before/${first.branchId}`
            );
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });

        it("reorders a branch after a sibling", async () => {
            const parent = await createTextNote(api, { title: "Reorder after parent" });
            const parentId = parent.noteId;
            const first = await createTextNote(api, { parentNoteId: parentId, title: "First" });
            const second = await createTextNote(api, { parentNoteId: parentId, title: "Second" });

            const res = await api.put<{ success: boolean }>(
                `/api/branches/${first.branchId}/move-after/${second.branchId}`
            );
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });

        it("404s when moving before a non-existent branch", async () => {
            const child = await createTextNote(api, { title: "Movable child" });
            const res = await api.put(
                `/api/branches/${child.branchId}/move-before/missingBranch123`
            );
            expect(res.status).toBe(404);
        });

        it("moves a branch before a sibling under a different parent (clone path)", async () => {
            const parentA = await createTextNote(api, { title: "Cross before A" });
            const parentB = await createTextNote(api, { title: "Cross before B" });
            const moving = await createTextNote(api, { parentNoteId: parentA.noteId, title: "Crosser" });
            const target = await createTextNote(api, { parentNoteId: parentB.noteId, title: "Before target" });

            const res = await api.put<{ success: boolean }>(
                `/api/branches/${moving.branchId}/move-before/${target.branchId}`
            );
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            // original branch under parentA is replaced by a clone under parentB
            expect(getBranchRow(moving.branchId)?.isDeleted).toBe(1);
        });

        it("moves a branch after a sibling under a different parent (clone path)", async () => {
            const parentA = await createTextNote(api, { title: "Cross after A" });
            const parentB = await createTextNote(api, { title: "Cross after B" });
            const moving = await createTextNote(api, { parentNoteId: parentA.noteId, title: "Crosser after" });
            const first = await createTextNote(api, { parentNoteId: parentB.noteId, title: "After first" });
            // a second sibling after the target so the position-shift loop body runs
            await createTextNote(api, { parentNoteId: parentB.noteId, title: "After second" });

            const res = await api.put<{ success: boolean }>(
                `/api/branches/${moving.branchId}/move-after/${first.branchId}`
            );
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(getBranchRow(moving.branchId)?.isDeleted).toBe(1);
        });

        it("returns a 200 validation failure when the move would create a cycle (before)", async () => {
            const parent = await createTextNote(api, { title: "Cycle before parent" });
            const child = await createTextNote(api, { parentNoteId: parent.noteId, title: "Cycle before child" });

            // moving the parent's branch before its own descendant would create a cycle
            const res = await api.put<{ success: boolean; message: string }>(
                `/api/branches/${parent.branchId}/move-before/${child.branchId}`
            );
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(false);
        });

        it("returns a 200 validation failure when the move would create a cycle (after)", async () => {
            const parent = await createTextNote(api, { title: "Cycle after parent" });
            const child = await createTextNote(api, { parentNoteId: parent.noteId, title: "Cycle after child" });

            const res = await api.put<{ success: boolean; message: string }>(
                `/api/branches/${parent.branchId}/move-after/${child.branchId}`
            );
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(false);
        });
    });

    describe("expanding", () => {
        it("sets and clears the expanded flag on a branch", async () => {
            const { branchId } = await createTextNote(api, { title: "Expandable" });

            const expand = await api.put(`/api/branches/${branchId}/expanded/1`);
            expect(expand.status).toBe(204);
            expect(getBranchRow(branchId)?.isExpanded).toBe(1);

            const collapse = await api.put(`/api/branches/${branchId}/expanded/0`);
            expect(collapse.status).toBe(204);
            expect(getBranchRow(branchId)?.isExpanded).toBe(0);
        });

        it("expands a subtree and returns the affected branch ids", async () => {
            const parent = await createTextNote(api, { title: "Subtree root" });
            await createTextNote(api, { parentNoteId: parent.noteId, title: "Subtree child" });

            const res = await api.put<{ branchIds: string[] }>(
                `/api/branches/${parent.branchId}/expanded-subtree/1`
            );
            expect(res.status).toBe(200);
            expect(Array.isArray(res.body.branchIds)).toBe(true);
            expect(res.body.branchIds).toContain(parent.branchId);
        });
    });

    describe("prefixes", () => {
        it("sets a prefix on a single branch", async () => {
            const { branchId } = await createTextNote(api, { title: "Prefixable" });

            const res = await api.put(`/api/branches/${branchId}/set-prefix`, {
                body: { prefix: "Chapter 1" }
            });
            expect(res.status).toBe(204);
            expect(getBranchRow(branchId)?.prefix).toBe("Chapter 1");
        });

        it("clears the prefix when given whitespace", async () => {
            const { branchId } = await createTextNote(api, { title: "Prefix clearable" });

            await api.put(`/api/branches/${branchId}/set-prefix`, { body: { prefix: "keep" } });
            const clear = await api.put(`/api/branches/${branchId}/set-prefix`, {
                body: { prefix: "   " }
            });
            expect(clear.status).toBe(204);
            expect(getBranchRow(branchId)?.prefix).toBeNull();
        });

        it("404s when setting a prefix on a missing branch", async () => {
            const res = await api.put("/api/branches/missingBranch123/set-prefix", {
                body: { prefix: "nope" }
            });
            expect(res.status).toBe(404);
        });

        it("sets a prefix on a batch of branches and skips unknown ids", async () => {
            const a = await createTextNote(api, { title: "Batch A" });
            const b = await createTextNote(api, { title: "Batch B" });

            const res = await api.put<{ success: boolean; count: number }>(
                "/api/branches/set-prefix-batch",
                {
                    body: {
                        branchIds: [ a.branchId, b.branchId, "missingBranch123" ],
                        prefix: "batch"
                    }
                }
            );
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.count).toBe(2);
            expect(getBranchRow(a.branchId)?.prefix).toBe("batch");
            expect(getBranchRow(b.branchId)?.prefix).toBe("batch");
        });

        it("400s when branchIds is not an array", async () => {
            const res = await api.put("/api/branches/set-prefix-batch", {
                body: { branchIds: "not-an-array", prefix: "x" }
            });
            expect(res.status).toBe(400);
        });

        it("400s when the prefix is not a string", async () => {
            const { branchId } = await createTextNote(api, { title: "Bad prefix type" });
            const res = await api.put("/api/branches/set-prefix-batch", {
                body: { branchIds: [ branchId ], prefix: 123 }
            });
            expect(res.status).toBe(400);
        });
    });

    describe("deleting", () => {
        it("deletes a branch and reports whether the note was deleted", async () => {
            const { branchId } = await createTextNote(api, { title: "To delete" });
            expect(getBranchRow(branchId)?.isDeleted).toBe(0);

            const res = await api.delete<{ noteDeleted: boolean }>(`/api/branches/${branchId}`, {
                query: { taskId: "test-branch-delete", last: "true" }
            });
            expect(res.status).toBe(200);
            expect(res.body.noteDeleted).toBe(true);
            expect(getBranchRow(branchId)?.isDeleted).toBe(1);
        });

        it("404s when deleting a non-existent branch", async () => {
            const res = await api.delete("/api/branches/missingBranch123", {
                query: { taskId: "test-branch-delete-missing", last: "true" }
            });
            expect(res.status).toBe(404);
        });

        it("erases the note immediately when eraseNotes is set", async () => {
            const { noteId, branchId } = await createTextNote(api, { title: "To erase" });

            const res = await api.delete<{ noteDeleted: boolean }>(`/api/branches/${branchId}`, {
                query: { taskId: "test-branch-erase", last: "true", eraseNotes: "true" }
            });
            expect(res.status).toBe(200);
            expect(res.body.noteDeleted).toBe(true);

            // erasing removes the note row entirely
            const noteRow = getSql().getRowOrNull("SELECT noteId FROM notes WHERE noteId = ?", [ noteId ]);
            expect(noteRow).toBeNull();
        });
    });
});
