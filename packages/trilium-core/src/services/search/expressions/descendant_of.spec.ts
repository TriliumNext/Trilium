import { beforeEach, describe, expect, it } from "vitest";

import { getBecca } from "../../../becca/becca.js";
import BBranch from "../../../becca/entities/bbranch.js";
import BNote from "../../../becca/entities/bnote.js";
import { note, NoteBuilder } from "../../../test/becca_mocking.js";
import DescendantOfExp from "./descendant_of.js";
import Expression from "./expression.js";
import NoteSet from "../note_set.js";

// SearchContext-like argument is unused by execute(), so we pass an empty object.
const dummySearchContext = {} as any;

/** A stub sub-expression that records its inputs and returns a predetermined note set. */
class StubExp extends Expression {
    calls: { inputNoteSet: NoteSet; executionContext: {} }[] = [];

    constructor(private result: NoteSet) {
        super();
    }

    execute(inputNoteSet: NoteSet, executionContext: {}) {
        this.calls.push({ inputNoteSet, executionContext });
        return this.result;
    }
}

function noteIds(noteSet: NoteSet) {
    return noteSet.notes.map((n) => n.noteId).sort();
}

/** A NoteSet containing every note currently registered in getBecca(). */
function allNotesSet() {
    return new NoteSet(Object.values(getBecca().notes));
}

let rootNote: NoteBuilder;

describe("DescendantOfExp", () => {
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

    it("returns input notes located in the subtree of a note matched by the sub-expression", () => {
        const ancestor = note("Ancestor");
        const child = note("Child");
        const grandchild = note("Grandchild");
        const outside = note("Outside");
        ancestor.child(child.child(grandchild));
        rootNote.child(ancestor).child(outside);

        // The sub-expression matches "ancestor"; its descendants present in the input set come
        // back, but the ancestor itself and unrelated notes are excluded.
        const exp = new DescendantOfExp(new StubExp(new NoteSet([ancestor.note])));
        const input = new NoteSet([child.note, grandchild.note, outside.note]);

        expect(noteIds(exp.execute(input, {}, dummySearchContext))).toEqual(
            [child.note.noteId, grandchild.note.noteId].sort()
        );
    });

    it("feeds the sub-expression every note in becca, not just the input set", () => {
        const ancestor = note("Ancestor");
        const child = note("Child");
        ancestor.child(child);
        rootNote.child(ancestor);

        const stub = new StubExp(new NoteSet());
        const exp = new DescendantOfExp(stub);

        const executionContext = { marker: true };
        // The input set deliberately omits most notes; the sub-expression must still see all of
        // becca (root, ancestor, child) so it can locate ancestors anywhere in the tree.
        exp.execute(new NoteSet([child.note]), executionContext, dummySearchContext);

        expect(stub.calls).toHaveLength(1);
        expect(noteIds(stub.calls[0].inputNoteSet)).toEqual(
            ["root", ancestor.note.noteId, child.note.noteId].sort()
        );
        // The execution context is threaded through unchanged.
        expect(stub.calls[0].executionContext).toBe(executionContext);
    });

    it("includes the matched note itself when it is part of the input set", () => {
        const ancestor = note("Ancestor");
        const child = note("Child");
        ancestor.child(child);
        rootNote.child(ancestor);

        // getSubtree() includes the subtree root, so a matched note present in the input set is
        // returned alongside its descendants.
        const exp = new DescendantOfExp(new StubExp(new NoteSet([ancestor.note])));
        const input = new NoteSet([ancestor.note, child.note]);

        expect(noteIds(exp.execute(input, {}, dummySearchContext))).toEqual(
            [ancestor.note.noteId, child.note.noteId].sort()
        );
    });

    it("only returns descendants that are also present in the input set", () => {
        const ancestor = note("Ancestor");
        const included = note("Included");
        const excluded = note("Excluded");
        ancestor.child(included).child(excluded);
        rootNote.child(ancestor);

        const exp = new DescendantOfExp(new StubExp(new NoteSet([ancestor.note])));
        const input = new NoteSet([included.note]);

        expect(noteIds(exp.execute(input, {}, dummySearchContext))).toEqual([included.note.noteId]);
    });

    it("de-duplicates a descendant reachable through multiple matched ancestors (clones)", () => {
        const ancestorA = note("AncestorA");
        const ancestorB = note("AncestorB");
        const child = note("Child");
        // The same child is cloned under both matched ancestors.
        ancestorA.child(child);
        ancestorB.child(child);
        rootNote.child(ancestorA).child(ancestorB);

        const exp = new DescendantOfExp(new StubExp(new NoteSet([ancestorA.note, ancestorB.note])));
        const input = new NoteSet([child.note]);

        const result = exp.execute(input, {}, dummySearchContext);
        // NoteSet.add de-duplicates, so the cloned child appears only once.
        expect(noteIds(result)).toEqual([child.note.noteId]);
        expect(result.notes).toHaveLength(1);
    });

    it("returns an empty set when the sub-expression matches no note", () => {
        const ancestor = note("Ancestor");
        const child = note("Child");
        ancestor.child(child);
        rootNote.child(ancestor);

        const exp = new DescendantOfExp(new StubExp(new NoteSet()));
        const result = exp.execute(new NoteSet([child.note]), {}, dummySearchContext);

        expect(result).toBeInstanceOf(NoteSet);
        expect(result.notes).toHaveLength(0);
    });

    it("returns an empty set when no descendant of the matched note is in the input", () => {
        const ancestor = note("Ancestor");
        const child = note("Child");
        const unrelated = note("Unrelated");
        ancestor.child(child);
        rootNote.child(ancestor).child(unrelated);

        // Ancestor is matched, but the input set holds only an unrelated note.
        const exp = new DescendantOfExp(new StubExp(new NoteSet([ancestor.note])));
        const result = exp.execute(new NoteSet([unrelated.note]), {}, dummySearchContext);

        expect(result.notes).toHaveLength(0);
    });

    it("propagates an error thrown by the sub-expression", () => {
        const boom = new (class extends Expression {
            execute(): NoteSet {
                throw new Error("sub-expression failure");
            }
        })();
        const child = note("Child");
        rootNote.child(child);

        const exp = new DescendantOfExp(boom);

        expect(() => exp.execute(new NoteSet([child.note]), {}, dummySearchContext)).toThrow(
            "sub-expression failure"
        );
    });
});
