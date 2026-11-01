import { describe, expect, it } from "vitest";

import { getBecca } from "../becca/becca.js";
import type BBranch from "../becca/entities/bbranch.js";
import type BNote from "../becca/entities/bnote.js";
import branchService from "./branches.js";
import { getContext } from "./context.js";
import noteService from "./notes.js";
import { getSql } from "./sql/index.js";

let counter = 0;

/**
 * Creates a fresh text note under the given parent in the real in-memory DB.
 * Each call uses a unique title since the same fixture DB is shared between
 * the `it()`s in this file.
 */
function createNote(parentNoteId: string): { note: BNote; branch: BBranch } {
    counter++;
    return getContext().init(() =>
        noteService.createNewNote({
            parentNoteId,
            title: `branches-spec-${counter}`,
            content: "<p>hello</p>",
            type: "text"
        })
    );
}

describe("branches service (real DB)", () => {
    describe("moveBranchToNote", () => {
        it("is a no-op when the branch already lives under the target parent", () => {
            const { branch } = createNote("root");

            const res = getContext().init(() => branchService.moveBranchToNote(branch, "root"));

            expect(res).toEqual({ success: true });
            // The original branch must remain, no clone created.
            expect(branch.isDeleted).toBe(false);
        });

        it("moves a branch to a new parent, deleting the old branch and computing the position", () => {
            const parent = createNote("root");
            const child = createNote("root");

            // Seed an existing child under the target parent so we can verify
            // the new position is derived from MAX(notePosition) + 10.
            const sibling = createNote(parent.note.noteId);
            const maxPos = getSql().getValue<number>(
                "SELECT MAX(notePosition) FROM branches WHERE parentNoteId = ? AND isDeleted = 0",
                [parent.note.noteId]
            );

            const res = getContext().init(() =>
                branchService.moveBranchToNote(child.branch, parent.note.noteId)
            ) as { success: boolean; branch: BBranch };

            expect(res.success).toBe(true);
            expect(res.branch).toBeDefined();
            expect(res.branch.parentNoteId).toBe(parent.note.noteId);
            expect(res.branch.noteId).toBe(child.note.noteId);
            expect(res.branch.notePosition).toBe(maxPos + 10);

            // The freshly created branch is reachable through getBecca().
            expect(getBecca().getBranchFromChildAndParent(child.note.noteId, parent.note.noteId)).toBe(res.branch);
            // The note is now a child of the target parent.
            expect(parent.note.getChildNotes().some((n) => n.noteId === child.note.noteId)).toBe(true);
            // The original branch (under root) has been deleted.
            expect(child.branch.isDeleted).toBe(true);
            // The pre-existing sibling branch is untouched.
            expect(sibling.branch.isDeleted).toBe(false);
        });

        it("refuses to move protected structural notes and returns the validation tuple", () => {
            // The root branch cannot be relocated; validateParentChild rejects it.
            const rootBranch = getBecca().getBranchFromChildAndParent("root", "none");
            expect(rootBranch).not.toBeNull();

            const someParent = createNote("root");

            const res = getContext().init(() =>
                branchService.moveBranchToNote(rootBranch!, someParent.note.noteId)
            ) as [number, { success: boolean; message?: string }];

            expect(Array.isArray(res)).toBe(true);
            expect(res[0]).toBe(200);
            expect(res[1].success).toBe(false);
            expect(typeof res[1].message).toBe("string");

            // No clone was created under the candidate parent.
            expect(getBecca().getBranchFromChildAndParent("root", someParent.note.noteId)).toBeNull();
        });

        it("refuses a move that would create a tree cycle", () => {
            const ancestor = createNote("root");
            const descendant = createNote(ancestor.note.noteId);

            // Moving the ancestor under its own descendant is a cycle.
            const res = getContext().init(() =>
                branchService.moveBranchToNote(ancestor.branch, descendant.note.noteId)
            ) as [number, { success: boolean; message?: string }];

            expect(Array.isArray(res)).toBe(true);
            expect(res[0]).toBe(200);
            expect(res[1].success).toBe(false);
            expect(ancestor.branch.isDeleted).toBe(false);
        });
    });

    describe("moveBranchToBranch", () => {
        it("moves the branch and expands a collapsed target parent branch", () => {
            const targetParent = createNote("root");
            const child = createNote("root");

            targetParent.branch.isExpanded = false;

            const res = getContext().init(() =>
                branchService.moveBranchToBranch(child.branch, targetParent.branch, "ignored-branch-id")
            ) as { success: boolean; branch: BBranch };

            expect(res.success).toBe(true);
            expect(res.branch.parentNoteId).toBe(targetParent.note.noteId);
            // Target parent branch is expanded so the new placement is visible.
            expect(targetParent.branch.isExpanded).toBe(true);
        });

        it("leaves an already-expanded target parent branch untouched", () => {
            const targetParent = createNote("root");
            const child = createNote("root");

            targetParent.branch.isExpanded = true;

            const res = getContext().init(() =>
                branchService.moveBranchToBranch(child.branch, targetParent.branch, "ignored-branch-id")
            ) as { success: boolean; branch: BBranch };

            expect(res.success).toBe(true);
            expect(targetParent.branch.isExpanded).toBe(true);
        });

        it("expands the target on the no-op path since the result still reports success", () => {
            const targetParent = createNote("root");
            const child = createNote(targetParent.note.noteId);

            targetParent.branch.isExpanded = false;

            const res = getContext().init(() =>
                branchService.moveBranchToBranch(child.branch, targetParent.branch, "ignored-branch-id")
            );

            // The underlying move is a no-op, but it still returns { success: true },
            // so moveBranchToBranch proceeds to expand the collapsed target parent.
            expect(res).toEqual({ success: true });
            expect(targetParent.branch.isExpanded).toBe(true);
        });

        it("propagates a validation failure and does not expand the target", () => {
            const targetParent = createNote("root");
            const rootBranch = getBecca().getBranchFromChildAndParent("root", "none");

            targetParent.branch.isExpanded = false;

            const res = getContext().init(() =>
                branchService.moveBranchToBranch(rootBranch!, targetParent.branch, "ignored-branch-id")
            ) as [number, { success: boolean }];

            expect(Array.isArray(res)).toBe(true);
            expect(res[0]).toBe(200);
            expect(res[1].success).toBe(false);
            expect(targetParent.branch.isExpanded).toBe(false);
        });
    });
});
