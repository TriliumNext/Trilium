import { cls, note_service as noteService } from "@triliumnext/core";
import { describe, expect, it } from "vitest";

import { hierarchyTools } from "./hierarchy_tools.js";
import type { ToolDefinition } from "./tool_registry.js";

function getTool(name: string): ToolDefinition {
    for (const [n, def] of hierarchyTools) {
        if (n === name) return def;
    }
    throw new Error(`Tool ${name} not registered`);
}

function createNote(parentNoteId: string, title: string) {
    return cls.init(() => noteService.createNewNote({
        parentNoteId,
        title,
        content: "body",
        type: "text"
    }).note);
}

describe("hierarchy_tools", () => {
    describe("get_child_notes", () => {
        it("lists immediate children with their child counts", () => {
            const parent = createNote("root", "Parent");
            const child = createNote(parent.noteId, "Child");
            createNote(child.noteId, "Grandchild");

            const result = getTool("get_child_notes").execute({ noteId: parent.noteId }) as any[];
            expect(result).toEqual([
                { noteId: child.noteId, title: "Child", type: "text", childCount: 1 }
            ]);
        });

        it("returns an error when the note is missing", () => {
            expect(getTool("get_child_notes").execute({ noteId: "missing" }))
                .toEqual({ error: "Note not found" });
        });
    });

    describe("get_subtree", () => {
        it("returns a nested subtree honouring the depth argument", () => {
            const root = createNote("root", "Subtree root");
            const a = createNote(root.noteId, "A");
            createNote(a.noteId, "A.1");

            // Default depth (2): root → A → A.1 not shown beyond depth.
            const result = getTool("get_subtree").execute({ noteId: root.noteId }) as any;
            expect(result.noteId).toBe(root.noteId);
            expect(result.children[0].title).toBe("A");
            // At depth 2 the leaf A.1 is reached and has no children of its own.
            expect(result.children[0].children[0].title).toBe("A.1");
        });

        it("reports a depth-limit message when children exist past maxDepth", () => {
            const root = createNote("root", "Deep root");
            const a = createNote(root.noteId, "Deep A");
            createNote(a.noteId, "Deep A.1");

            // depth 1: only the first level is expanded; A still has children.
            const result = getTool("get_subtree").execute({ noteId: root.noteId, depth: 1 }) as any;
            expect(result.children[0].children).toContain("1 children not shown (depth limit reached)");
        });

        it("truncates wide levels and appends a '... and N more' marker", () => {
            const wide = createNote("root", "Wide");
            for (let i = 0; i < 12; i++) {
                createNote(wide.noteId, `c${i}`);
            }
            const result = getTool("get_subtree").execute({ noteId: wide.noteId, depth: 1 }) as any;
            // 10 shown + 1 truncation marker.
            expect(result.children).toHaveLength(11);
            expect(result.children[10]).toMatchObject({ type: "truncated", noteId: "" });
        });

        it("stops at leaf nodes reached before the depth limit", () => {
            const root = createNote("root", "Leaf root");
            // A is a leaf (no children) reached at depth 1, well within depth 2.
            createNote(root.noteId, "Leaf A");
            const result = getTool("get_subtree").execute({ noteId: root.noteId, depth: 2 }) as any;
            expect(result.children).toHaveLength(1);
            // A leaf has no `children` property at all.
            expect(result.children[0]).not.toHaveProperty("children");
        });

        it("returns an error when the note is missing", () => {
            expect(getTool("get_subtree").execute({ noteId: "missing" }))
                .toEqual({ error: "Note not found" });
        });
    });

    describe("move_note", () => {
        it("moves a note to a new parent", () => {
            const oldParent = createNote("root", "Old parent");
            const newParent = createNote("root", "New parent");
            const note = createNote(oldParent.noteId, "Movable");

            const result = cls.init(() => getTool("move_note").execute({
                noteId: note.noteId,
                newParentNoteId: newParent.noteId
            }));
            expect(result).toMatchObject({
                success: true,
                noteId: note.noteId,
                newParentNoteId: newParent.noteId,
                newParentTitle: "New parent"
            });
            expect(note.getParentNotes().map((p) => p.noteId)).toContain(newParent.noteId);
        });

        it("rejects missing note, system notes, protected notes, and missing/invalid targets", () => {
            expect(getTool("move_note").execute({ noteId: "missing", newParentNoteId: "root" }))
                .toEqual({ error: "Note not found" });

            expect(getTool("move_note").execute({ noteId: "root", newParentNoteId: "root" }))
                .toEqual({ error: "Cannot move system notes" });

            const protectedNote = createNote("root", "Protected move");
            protectedNote.isProtected = true;
            expect(getTool("move_note").execute({
                noteId: protectedNote.noteId, newParentNoteId: "root"
            })).toMatchObject({ error: expect.stringContaining("protected") });
            protectedNote.isProtected = false;

            const orphan = createNote("root", "Target missing");
            expect(getTool("move_note").execute({
                noteId: orphan.noteId, newParentNoteId: "doesNotExist"
            })).toEqual({ error: "Target parent note not found" });

            const movable = createNote("root", "Movable to protected");
            const protectedParent = createNote("root", "Protected target");
            protectedParent.isProtected = true; // content unavailable without a protected session
            expect(getTool("move_note").execute({
                noteId: movable.noteId, newParentNoteId: protectedParent.noteId
            })).toMatchObject({ error: expect.stringContaining("protected parent") });
            protectedParent.isProtected = false;
        });

        it("surfaces a validation failure when moving a note under its own descendant", () => {
            const parent = createNote("root", "Cycle parent");
            const child = createNote(parent.noteId, "Cycle child");

            // Moving the parent under its own child would create a cycle → validation fails.
            const result = cls.init(() => getTool("move_note").execute({
                noteId: parent.noteId,
                newParentNoteId: child.noteId
            }));
            expect(result).toHaveProperty("error");
            expect(result).not.toHaveProperty("success");
        });
    });

    describe("clone_note", () => {
        it("clones a note to an additional parent with a prefix", () => {
            const a = createNote("root", "Clone A");
            const b = createNote("root", "Clone B");
            const note = createNote(a.noteId, "Cloneable");

            const result = cls.init(() => getTool("clone_note").execute({
                noteId: note.noteId,
                parentNoteId: b.noteId,
                prefix: "ref"
            })) as any;
            expect(result).toMatchObject({
                success: true,
                noteId: note.noteId,
                parentNoteId: b.noteId,
                parentTitle: "Clone B"
            });
            expect(result.branchId).toBeTruthy();
            expect(note.getParentNotes().map((p) => p.noteId)).toContain(b.noteId);
        });

        it("rejects a missing note, a protected source, a protected parent, and a clone failure", () => {
            expect(getTool("clone_note").execute({ noteId: "missing", parentNoteId: "root" }))
                .toEqual({ error: "Note not found" });

            const protectedSource = createNote("root", "Protected clone source");
            protectedSource.isProtected = true;
            expect(getTool("clone_note").execute({
                noteId: protectedSource.noteId, parentNoteId: "root"
            })).toMatchObject({ error: expect.stringContaining("protected") });
            protectedSource.isProtected = false;

            const cloneable = createNote("root", "Cloneable to protected");
            const protectedParent = createNote("root", "Protected clone target");
            protectedParent.isProtected = true;
            expect(getTool("clone_note").execute({
                noteId: cloneable.noteId, parentNoteId: protectedParent.noteId
            })).toMatchObject({ error: expect.stringContaining("protected parent") });
            protectedParent.isProtected = false;

            const parent = createNote("root", "Dup parent");
            const note = createNote(parent.noteId, "Already there");
            // Cloning into a parent it already lives under fails.
            const result = cls.init(() => getTool("clone_note").execute({
                noteId: note.noteId,
                parentNoteId: parent.noteId
            }));
            expect(result).toHaveProperty("error");
            expect(result).not.toHaveProperty("success");
        });
    });
});
