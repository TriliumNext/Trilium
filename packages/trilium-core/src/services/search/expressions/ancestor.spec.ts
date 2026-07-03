import { beforeEach, describe, expect, it } from "vitest";

import { getBecca } from "../../../becca/becca.js";
import BBranch from "../../../becca/entities/bbranch.js";
import BNote from "../../../becca/entities/bnote.js";
import { note, NoteBuilder } from "../../../test/becca_mocking.js";
import NoteSet from "../note_set.js";
import AncestorExp from "./ancestor.js";

// SearchContext-like argument is unused by execute(), so we pass an empty object.
const dummySearchContext = {} as any;

/** Build a NoteSet that contains every note currently registered in getBecca(). */
function allNotesSet() {
    return new NoteSet(Object.values(getBecca().notes));
}

function execute(exp: AncestorExp, inputNoteSet = allNotesSet()) {
    return exp.execute(inputNoteSet, {}, dummySearchContext);
}

function noteIds(noteSet: NoteSet) {
    return noteSet.notes.map((n) => n.noteId).sort();
}

let rootNote: NoteBuilder;

describe("AncestorExp", () => {
    beforeEach(() => {
        getBecca().reset();

        rootNote = new NoteBuilder(new BNote({ noteId: "root", title: "root", type: "text" }));
        new BBranch({
            branchId: "none_root",
            noteId: "root",
            parentNoteId: "none",
            notePosition: 10
        });
    });

    describe("getComparator", () => {
        it("returns null when no depth condition is given", () => {
            const exp = new AncestorExp("root");
            expect(exp.getComparator()).toBeNull();
            expect(exp.getComparator("")).toBeNull();
        });

        it("builds an eq/gt/lt comparator that compares against the parsed depth", () => {
            const exp = new AncestorExp("root");

            const eq = exp.getComparator("eq2")!;
            expect(eq(1)).toBe(false);
            expect(eq(2)).toBe(true);
            expect(eq(3)).toBe(false);

            const gt = exp.getComparator("gt2")!;
            expect(gt(2)).toBe(false);
            expect(gt(3)).toBe(true);

            const lt = exp.getComparator("lt2")!;
            expect(lt(2)).toBe(false);
            expect(lt(1)).toBe(true);
        });

        it("returns null for an unrecognized condition prefix", () => {
            const exp = new AncestorExp("root");
            expect(exp.getComparator("ne2")).toBeNull();
        });
    });

    it("returns an empty set when the ancestor note does not exist", () => {
        const child = note("Child");
        rootNote.child(child);

        const exp = new AncestorExp("doesNotExist");
        const result = execute(exp);

        expect(result.notes).toHaveLength(0);
    });

    it("returns the ancestor subtree intersected with the input set when no depth is given", () => {
        const parent = note("Parent");
        const child = note("Child");
        const grandchild = note("Grandchild");
        const sibling = note("Sibling");
        parent.child(child.child(grandchild));
        rootNote.child(parent).child(sibling);

        const exp = new AncestorExp(parent.note.noteId);
        const result = execute(exp);

        // The subtree of "parent" is parent + child + grandchild; the unrelated
        // sibling and root must be excluded.
        expect(noteIds(result)).toEqual(
            [parent.note.noteId, child.note.noteId, grandchild.note.noteId].sort()
        );
    });

    it("intersects the subtree with the provided input set", () => {
        const parent = note("Parent");
        const child = note("Child");
        const grandchild = note("Grandchild");
        parent.child(child.child(grandchild));
        rootNote.child(parent);

        const exp = new AncestorExp(parent.note.noteId);

        // Restrict the input to just the grandchild; the rest of the subtree must
        // be dropped by the intersection.
        const restricted = new NoteSet([grandchild.note]);
        expect(noteIds(execute(exp, restricted))).toEqual([grandchild.note.noteId]);
    });

    it("filters by distance to the ancestor using the depth comparator", () => {
        const parent = note("Parent");
        const child = note("Child");
        const grandchild = note("Grandchild");
        parent.child(child.child(grandchild));
        rootNote.child(parent);

        // depth eq1 -> only direct children (the ancestor itself is distance 0).
        const eqExp = new AncestorExp(parent.note.noteId, "eq1");
        expect(noteIds(execute(eqExp))).toEqual([child.note.noteId]);

        // depth eq0 -> only the ancestor note itself.
        const selfExp = new AncestorExp(parent.note.noteId, "eq0");
        expect(noteIds(execute(selfExp))).toEqual([parent.note.noteId]);

        // depth gt1 -> notes strictly deeper than the direct children.
        const gtExp = new AncestorExp(parent.note.noteId, "gt1");
        expect(noteIds(execute(gtExp))).toEqual([grandchild.note.noteId]);

        // depth lt2 -> the ancestor and its direct children.
        const ltExp = new AncestorExp(parent.note.noteId, "lt2");
        expect(noteIds(execute(ltExp))).toEqual(
            [parent.note.noteId, child.note.noteId].sort()
        );
    });

    it("ignores the depth filter when the depth condition is unrecognized", () => {
        const parent = note("Parent");
        const child = note("Child");
        parent.child(child);
        rootNote.child(parent);

        // An invalid condition yields a null comparator, so the whole subtree is returned.
        const exp = new AncestorExp(parent.note.noteId, "bogus");
        expect(noteIds(execute(exp))).toEqual(
            [parent.note.noteId, child.note.noteId].sort()
        );
    });

    it("exposes the raw depth string for debugging", () => {
        const parent = note("Parent");
        rootNote.child(parent);

        const exp = new AncestorExp(parent.note.noteId, "eq3");
        expect(exp.ancestorDepth).toBe("eq3");
    });
});
