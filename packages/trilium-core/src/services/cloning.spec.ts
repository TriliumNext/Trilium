import { describe, expect, it } from "vitest";

import becca from "../becca/becca.js";
import type BBranch from "../becca/entities/bbranch.js";
import type BNote from "../becca/entities/bnote.js";
import cloningService from "./cloning.js";
import { getContext } from "./context.js";
import noteService from "./notes.js";
import { getSql } from "./sql/index.js";

let counter = 0;

/**
 * Creates a fresh note under the given parent in the real in-memory DB.
 * Each call uses a unique title since the same fixture DB is shared between
 * the `it()`s in this file.
 */
function createNote(parentNoteId: string, type: "text" | "search" = "text"): { note: BNote; branch: BBranch } {
    counter++;
    return getContext().init(() =>
        noteService.createNewNote({
            parentNoteId,
            title: `cloning-spec-${counter}`,
            content: type === "search" ? "" : "<p>hello</p>",
            type
        })
    );
}

describe("cloning service (real DB)", () => {
    describe("cloneNoteToParentNote", () => {
        it("creates a new branch under the target parent and reports the note path", () => {
            const source = createNote("root");
            const target = createNote("root");

            const res = getContext().init(() =>
                cloningService.cloneNoteToParentNote(source.note.noteId, target.note.noteId, "my-prefix")
            );

            expect(res.success).toBe(true);
            expect(res.branchId).toBeDefined();

            const branch = becca.getBranchFromChildAndParent(source.note.noteId, target.note.noteId);
            expect(branch).not.toBeNull();
            expect(branch!.branchId).toBe(res.branchId);
            expect(branch!.prefix).toBe("my-prefix");
            expect(res.notePath).toBe(`${target.note.getBestNotePathString()}/${source.note.noteId}`);

            // The note is now reachable as a child of the target parent.
            expect(target.note.getChildNotes().some((n) => n.noteId === source.note.noteId)).toBe(true);
            // The original branch under root is untouched (cloning, not moving).
            expect(source.branch.isDeleted).toBe(false);
        });

        it("fails when the source note does not exist", () => {
            const target = createNote("root");

            const res = cloningService.cloneNoteToParentNote("doesNotExist123", target.note.noteId);

            expect(res.success).toBe(false);
            expect(typeof res.message).toBe("string");
        });

        it("fails when the parent note does not exist", () => {
            const source = createNote("root");

            const res = cloningService.cloneNoteToParentNote(source.note.noteId, "doesNotExist123");

            expect(res.success).toBe(false);
            expect(typeof res.message).toBe("string");
        });

        it("refuses to clone into a search note", () => {
            const source = createNote("root");
            const search = createNote("root", "search");

            const res = cloningService.cloneNoteToParentNote(source.note.noteId, search.note.noteId);

            expect(res.success).toBe(false);
            expect(res.message).toBe("Can't clone into a search note");
            expect(becca.getBranchFromChildAndParent(source.note.noteId, search.note.noteId)).toBeNull();
        });

        it("propagates a validation failure (clone already present under the parent)", () => {
            const target = createNote("root");
            const child = createNote(target.note.noteId);

            // The note already lives under the target parent; a second clone is rejected.
            const res = cloningService.cloneNoteToParentNote(child.note.noteId, target.note.noteId);

            expect(res.success).toBe(false);
            expect(typeof res.message).toBe("string");
        });
    });

    describe("cloneNoteToBranch", () => {
        it("clones via the parent branch and expands that branch", () => {
            const source = createNote("root");
            const targetParent = createNote("root");

            targetParent.branch.isExpanded = false;

            const res = getContext().init(() =>
                cloningService.cloneNoteToBranch(source.note.noteId, targetParent.branch.branchId!, "px")
            ) as { success: boolean; branchId?: string };

            expect(res.success).toBe(true);
            expect(res.branchId).toBeDefined();
            // The parent branch is expanded so the clone is immediately visible.
            expect(targetParent.branch.isExpanded).toBe(true);

            const branch = becca.getBranchFromChildAndParent(source.note.noteId, targetParent.note.noteId);
            expect(branch).not.toBeNull();
            expect(branch!.prefix).toBe("px");
        });

        it("fails when the parent branch does not exist", () => {
            const source = createNote("root");

            const res = cloningService.cloneNoteToBranch(source.note.noteId, "noSuchBranch123");

            expect(res.success).toBe(false);
            expect(typeof res.message).toBe("string");
        });
    });

    describe("ensureNoteIsPresentInParent", () => {
        it("creates the branch and returns it on success", () => {
            const source = createNote("root");
            const target = createNote("root");

            const res = getContext().init(() =>
                cloningService.ensureNoteIsPresentInParent(source.note.noteId, target.note.noteId, "ep")
            ) as { branch: BBranch | null; success: boolean };

            expect(res.success).toBe(true);
            expect(res.branch).not.toBeNull();
            expect(res.branch!.parentNoteId).toBe(target.note.noteId);
            expect(res.branch!.noteId).toBe(source.note.noteId);
            expect(res.branch!.prefix).toBe("ep");
        });

        it("fails with a null branch when the note is deleted/missing", () => {
            const target = createNote("root");

            const res = cloningService.ensureNoteIsPresentInParent("doesNotExist123", target.note.noteId) as {
                branch: BBranch | null;
                success: boolean;
            };

            expect(res.success).toBe(false);
            expect(res.branch).toBeNull();
        });

        it("fails with a null branch when the parent is deleted/missing", () => {
            const source = createNote("root");

            const res = cloningService.ensureNoteIsPresentInParent(source.note.noteId, "doesNotExist123") as {
                branch: BBranch | null;
                success: boolean;
            };

            expect(res.success).toBe(false);
            expect(res.branch).toBeNull();
        });

        it("refuses to add the note into a search note", () => {
            const source = createNote("root");
            const search = createNote("root", "search");

            const res = cloningService.ensureNoteIsPresentInParent(source.note.noteId, search.note.noteId) as {
                branch: BBranch | null;
                success: boolean;
                message?: string;
            };

            expect(res.success).toBe(false);
            expect(res.branch).toBeNull();
            expect(res.message).toBe("Can't clone into a search note");
        });
    });

    describe("ensureNoteIsAbsentFromParent", () => {
        it("removes an existing extra branch but keeps the underlying note", () => {
            const source = createNote("root");
            const target = createNote("root");

            // Add a second branch so removing it does not delete the note.
            getContext().init(() => cloningService.cloneNoteToParentNote(source.note.noteId, target.note.noteId));
            expect(becca.getBranchFromChildAndParent(source.note.noteId, target.note.noteId)).not.toBeNull();

            const res = getContext().init(() =>
                cloningService.ensureNoteIsAbsentFromParent(source.note.noteId, target.note.noteId)
            );

            expect(res).toEqual({ success: true });
            expect(becca.getBranchFromChildAndParent(source.note.noteId, target.note.noteId)).toBeNull();
            // The note still exists via its original branch under root.
            expect(becca.notes[source.note.noteId]).toBeDefined();
            expect(source.note.isDeleted).toBe(false);
        });

        it("refuses to remove the only strong branch since it would delete the note", () => {
            const source = createNote("root");

            const res = getContext().init(() =>
                cloningService.ensureNoteIsAbsentFromParent(source.note.noteId, "root")
            ) as { success: boolean; message?: string };

            expect(res.success).toBe(false);
            expect(typeof res.message).toBe("string");
            // The branch is preserved.
            expect(becca.getBranchFromChildAndParent(source.note.noteId, "root")).not.toBeNull();
        });

        it("returns undefined when there is no matching branch to remove", () => {
            const source = createNote("root");
            const target = createNote("root");

            const res = cloningService.ensureNoteIsAbsentFromParent(source.note.noteId, target.note.noteId);

            expect(res).toBeUndefined();
        });
    });

    describe("toggleNoteInParent", () => {
        it("dispatches to present (true) then absent (false)", () => {
            const source = createNote("root");
            const target = createNote("root");

            const present = getContext().init(() =>
                cloningService.toggleNoteInParent(true, source.note.noteId, target.note.noteId, "tp")
            ) as { branch: BBranch | null; success: boolean };

            expect(present.success).toBe(true);
            expect(present.branch).not.toBeNull();
            expect(becca.getBranchFromChildAndParent(source.note.noteId, target.note.noteId)).not.toBeNull();

            const absent = getContext().init(() =>
                cloningService.toggleNoteInParent(false, source.note.noteId, target.note.noteId)
            );

            expect(absent).toEqual({ success: true });
            expect(becca.getBranchFromChildAndParent(source.note.noteId, target.note.noteId)).toBeNull();
        });
    });

    describe("cloneNoteAfter", () => {
        it("clones the note right after the reference branch and shifts later siblings", () => {
            const parent = createNote("root");
            const first = createNote(parent.note.noteId);
            const second = createNote(parent.note.noteId);
            const source = createNote("root");

            const afterPos = first.branch.notePosition;

            const res = getContext().init(() =>
                cloningService.cloneNoteAfter(source.note.noteId, first.branch.branchId!)
            ) as { success: boolean; branchId?: string };

            expect(res.success).toBe(true);
            expect(res.branchId).toBeDefined();

            const newBranch = becca.getBranch(res.branchId!);
            expect(newBranch).not.toBeNull();
            expect(newBranch!.parentNoteId).toBe(parent.note.noteId);
            expect(newBranch!.noteId).toBe(source.note.noteId);
            expect(newBranch!.notePosition).toBe(afterPos + 10);

            // The sibling that previously came after `first` was shifted further down.
            const shifted = getSql().getValue<number>(
                "SELECT notePosition FROM branches WHERE branchId = ?",
                [second.branch.branchId]
            );
            expect(shifted).toBeGreaterThan(afterPos + 10);
        });

        it("forbids cloning protected structural notes", () => {
            const target = createNote("root");

            const res = cloningService.cloneNoteAfter("root", target.branch.branchId!);

            expect(res.success).toBe(false);
            expect(res.message).toBe("Cloning the note 'root' is forbidden.");
        });

        it("fails when the reference branch does not exist", () => {
            const source = createNote("root");

            const res = cloningService.cloneNoteAfter(source.note.noteId, "noSuchBranch123");

            expect(res.success).toBe(false);
            expect(typeof res.message).toBe("string");
        });

        it("propagates a validation failure when the clone would already be present", () => {
            const parent = createNote("root");
            const reference = createNote(parent.note.noteId);
            const existing = createNote(parent.note.noteId);

            // `existing` already lives under `parent`; cloning it after `reference`
            // (same parent) is rejected by validateParentChild.
            const res = cloningService.cloneNoteAfter(existing.note.noteId, reference.branch.branchId!);

            expect(res.success).toBe(false);
            expect(typeof res.message).toBe("string");
        });
    });
});
