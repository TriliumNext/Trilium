import { describe, expect, it } from "vitest";

import becca from "../becca.js";
import { getContext } from "../../services/context.js";
import noteService from "../../services/notes.js";
import BBranch from "./bbranch.js";
import type BNote from "./bnote.js";

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
            title: `bbranch-spec-${counter}`,
            content: "<p>hello</p>",
            type: "text"
        })
    );
}

describe("BBranch (real DB)", () => {
    describe("deleteBranch", () => {
        it("refuses to delete the root branch", () => {
            const rootBranch = becca.getBranchOrThrow("none_root");

            expect(() => getContext().init(() => rootBranch.deleteBranch())).toThrow();
        });

        it("deletes a note that has only one strong parent branch", () => {
            const { note, branch } = createNote("root");

            const deleted = getContext().init(() => branch.deleteBranch());

            expect(deleted).toBe(true);
            expect(branch.isDeleted).toBe(true);
            expect(note.isDeleted).toBe(true);
        });

        it("keeps the note when a second strong branch remains, returning false", () => {
            const { note } = createNote("root");
            const otherParent = createNote("root");

            // Add a second strong branch under another parent.
            const secondBranch = getContext().init(() => {
                const b = new BBranch({
                    noteId: note.noteId,
                    parentNoteId: otherParent.note.noteId,
                    prefix: null,
                    isExpanded: false
                });
                b.save();
                return b;
            });

            const firstBranch = note.getParentBranches().find((b) => b.parentNoteId === "root");
            expect(firstBranch).toBeDefined();

            const deleted = getContext().init(() => firstBranch?.deleteBranch());

            expect(deleted).toBe(false);
            expect(note.isDeleted).toBe(false);
            expect(secondBranch.isDeleted).toBe(false);
        });

        it("marks remaining weak branches as deleted when the only strong branch is removed", () => {
            const { note, branch } = createNote("root");

            // Add a weak clone under the bookmarks container so the note has a
            // strong branch (under root) plus a weak branch (under _lbBookmarks).
            const weakBranch = getContext().init(() => {
                const b = new BBranch({
                    noteId: note.noteId,
                    parentNoteId: "_lbBookmarks",
                    prefix: null,
                    isExpanded: false
                });
                b.save();
                return b;
            });

            expect(weakBranch.isWeak).toBe(true);
            expect(note.getStrongParentBranches().length).toBe(1);

            const deleted = getContext().init(() => branch.deleteBranch());

            // The single strong branch is gone, so the note (and its weak branch)
            // are deleted as well.
            expect(deleted).toBe(true);
            expect(weakBranch.isDeleted).toBe(true);
            expect(note.isDeleted).toBe(true);
        });

        it("deletes attached attachments together with the note", () => {
            const { note, branch } = createNote("root");

            const attachment = getContext().init(() =>
                note.saveAttachment({
                    role: "file",
                    mime: "text/plain",
                    title: `att-${counter}`,
                    content: "data"
                })
            );

            expect(note.getAttachments().some((a) => a.attachmentId === attachment.attachmentId)).toBe(true);

            const deleted = getContext().init(() => branch.deleteBranch());

            expect(deleted).toBe(true);
            // The attachment was marked deleted as part of the note deletion, so it
            // is no longer returned among the note's (non-deleted) attachments.
            expect(note.getAttachments().some((a) => a.attachmentId === attachment.attachmentId)).toBe(false);
        });
    });

    describe("beforeSaving", () => {
        it("throws when noteId or parentNoteId are missing", () => {
            const branch = new BBranch();

            expect(() => getContext().init(() => branch.save())).toThrow();
        });

        it("computes notePosition as max sibling position + 10, skipping _hidden", () => {
            const parent = createNote("root");
            const existing = createNote(parent.note.noteId);

            const maxPos = existing.branch.notePosition;
            const child = createNote("root");

            const newBranch = getContext().init(() => {
                const b = new BBranch({
                    noteId: child.note.noteId,
                    parentNoteId: parent.note.noteId,
                    prefix: null,
                    isExpanded: false
                });
                // notePosition intentionally left undefined to trigger computation.
                b.save();
                return b;
            });

            expect(newBranch.notePosition).toBe(maxPos + 10);
        });

        it("skips a falsy child branch while computing notePosition", () => {
            const parent = createNote("root");
            const existing = createNote(parent.note.noteId);
            const child = createNote("root");

            // Simulate the transient sync/import inconsistency where a child note is
            // still present in the parent's children array but its branch lookup
            // returns a falsy value. getChildBranches() will then yield an entry
            // that beforeSaving must skip.
            const key = `${existing.note.noteId}-${parent.note.noteId}`;
            const savedBranch = becca.childParentToBranch[key];
            delete becca.childParentToBranch[key];

            try {
                const newBranch = getContext().init(() => {
                    const b = new BBranch({
                        noteId: child.note.noteId,
                        parentNoteId: parent.note.noteId,
                        prefix: null,
                        isExpanded: false
                    });
                    // notePosition undefined -> iterates child branches, skipping the
                    // falsy one, so the computed position falls back to 0 + 10.
                    b.save();
                    return b;
                });

                expect(newBranch.notePosition).toBe(10);
            } finally {
                // Restore the becca map so subsequent assertions/teardown are consistent.
                becca.childParentToBranch[key] = savedBranch;
            }
        });
    });

    describe("createClone", () => {
        it("returns the existing branch and updates its position when one is present", () => {
            const { note, branch } = createNote("root");
            const target = createNote("root");

            // Create the clone under the target first.
            const firstClone = getContext().init(() => {
                const clone = branch.createClone(target.note.noteId);
                clone.save();
                return clone;
            });

            expect(firstClone.parentNoteId).toBe(target.note.noteId);
            expect(firstClone.noteId).toBe(note.noteId);

            // Cloning again to the same parent with a position returns the existing
            // branch and updates its notePosition.
            const secondClone = getContext().init(() => branch.createClone(target.note.noteId, 555));

            expect(secondClone).toBe(firstClone);
            expect(secondClone.notePosition).toBe(555);
        });

        it("returns the existing branch unchanged when no position is provided", () => {
            const { branch } = createNote("root");
            const target = createNote("root");

            const firstClone = getContext().init(() => {
                const clone = branch.createClone(target.note.noteId);
                clone.save();
                return clone;
            });

            const originalPos = firstClone.notePosition;
            const secondClone = getContext().init(() => branch.createClone(target.note.noteId));

            expect(secondClone).toBe(firstClone);
            expect(secondClone.notePosition).toBe(originalPos);
        });
    });

    describe("getParentNote", () => {
        it("returns the parent note of the branch", () => {
            const parent = createNote("root");
            const child = createNote(parent.note.noteId);

            expect(child.branch.getParentNote()).toBe(parent.note);
        });
    });
});
