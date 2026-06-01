import { becca, cls, note_service as noteService } from "@triliumnext/core";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import branches from "./branches.js";
import sql_init from "./sql_init.js";

function createNote(parentNoteId: string, title: string) {
    return cls.init(() => noteService.createNewNote({
        parentNoteId, title, content: "", type: "text"
    }));
}

describe("branches (real DB)", () => {
    beforeAll(async () => {
        sql_init.initializeDb();
        await sql_init.dbReady;
    });

    afterEach(() => vi.restoreAllMocks());

    describe("moveBranchToNote", () => {
        it("is a no-op when the branch already lives under the target parent", () => {
            const { branch } = createNote("root", "Stay put");

            const result = branches.moveBranchToNote(branch, branch.parentNoteId);

            expect(result).toEqual({ success: true });
            // The branch was not replaced.
            expect(becca.getBranch(branch.branchId!)?.isDeleted).toBeFalsy();
        });

        it("returns the validation result tuple when the move is invalid", () => {
            const parent = createNote("root", "Parent");
            const child = createNote(parent.note.noteId, "Child");

            // Moving a parent under its own descendant is a cycle → validation fails.
            const result = branches.moveBranchToNote(parent.branch, child.note.noteId) as any[];

            expect(Array.isArray(result)).toBe(true);
            expect(result[0]).toBe(200);
            expect(result[1].success).toBe(false);
        });

        it("moves a branch to a new parent, deleting the old branch (notePosition 0 when target empty)", () => {
            const sourceParent = createNote("root", "Source");
            const targetParent = createNote("root", "Target empty");
            const child = createNote(sourceParent.note.noteId, "Movable");
            const oldBranchId = child.branch.branchId!;

            const result = cls.init(() => branches.moveBranchToNote(child.branch, targetParent.note.noteId)) as any;

            expect(result.success).toBe(true);
            expect(result.branch.parentNoteId).toBe(targetParent.note.noteId);
            // The original branch is gone (deleted or removed from the cache).
            const oldBranch = becca.getBranch(oldBranchId);
            expect(!oldBranch || oldBranch.isDeleted).toBe(true);
            // The note now lives under the target.
            expect(child.note.getParentBranches().some((b) => b.parentNoteId === targetParent.note.noteId)).toBe(true);
        });

        it("computes notePosition as max + 10 when the target already has children", () => {
            const targetParent = createNote("root", "Target with child");
            // Existing child establishes a max notePosition.
            const existing = createNote(targetParent.note.noteId, "Existing");
            existing.branch.notePosition = 50;
            cls.init(() => existing.branch.save());

            const sourceParent = createNote("root", "Source 2");
            const child = createNote(sourceParent.note.noteId, "Movable 2");

            const result = cls.init(() => branches.moveBranchToNote(child.branch, targetParent.note.noteId)) as any;

            expect(result.success).toBe(true);
            expect(result.branch.notePosition).toBe(60);
        });
    });

    describe("moveBranchToBranch", () => {
        it("moves the branch and expands a collapsed target parent branch", () => {
            const targetParent = createNote("root", "Expand target");
            const targetBranch = targetParent.branch;
            targetBranch.isExpanded = false;
            cls.init(() => targetBranch.save());

            const source = createNote("root", "Source 3");
            const child = createNote(source.note.noteId, "Movable 3");

            const result = cls.init(() => branches.moveBranchToBranch(child.branch, targetBranch, "ignored")) as any;

            expect(result.success).toBe(true);
            expect(targetBranch.isExpanded).toBe(true);
        });

        it("leaves an already-expanded target parent untouched", () => {
            const targetParent = createNote("root", "Already expanded");
            const targetBranch = targetParent.branch;
            targetBranch.isExpanded = true;
            cls.init(() => targetBranch.save());

            const source = createNote("root", "Source 4");
            const child = createNote(source.note.noteId, "Movable 4");
            const saveSpy = vi.spyOn(targetBranch, "save");

            const result = cls.init(() => branches.moveBranchToBranch(child.branch, targetBranch, "ignored")) as any;

            expect(result.success).toBe(true);
            expect(targetBranch.isExpanded).toBe(true);
            // No re-save was needed to expand.
            expect(saveSpy).not.toHaveBeenCalled();
        });

        it("passes through a failed move without expanding the target", () => {
            const parent = createNote("root", "P5");
            const child = createNote(parent.note.noteId, "C5");
            const targetBranch = child.branch;
            targetBranch.isExpanded = false;

            // Moving the parent into its own child fails validation.
            const result = branches.moveBranchToBranch(parent.branch, targetBranch, "ignored") as any[];

            expect(Array.isArray(result)).toBe(true);
            expect(result[0]).toBe(200);
            expect(targetBranch.isExpanded).toBe(false);
        });

        it("returns the no-op success object when source already under the target parent", () => {
            const targetParent = createNote("root", "Noop target");
            const targetBranch = targetParent.branch;
            const child = createNote(targetParent.note.noteId, "Child noop");

            const result = cls.init(() => branches.moveBranchToBranch(child.branch, targetBranch, "ignored")) as any;

            expect(result).toEqual({ success: true });
        });
    });
});
