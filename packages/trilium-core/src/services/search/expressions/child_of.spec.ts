import { beforeEach, describe, expect, it } from "vitest";

import { getBecca } from "../../../becca/becca.js";
import BBranch from "../../../becca/entities/bbranch.js";
import BNote from "../../../becca/entities/bnote.js";
import { note, NoteBuilder } from "../../../test/becca_mocking.js";
import ChildOfExp from "./child_of.js";
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

let rootNote: NoteBuilder;

describe("ChildOfExp", () => {
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

    it("returns input notes whose parent is matched by the sub-expression", () => {
        const parent = note("Parent");
        const child = note("Child");
        const sibling = note("Sibling");
        parent.child(child);
        rootNote.child(parent).child(sibling);

        // The sub-expression matches only "parent"; its children present in the input set
        // (just "child") should come back.
        const exp = new ChildOfExp(new StubExp(new NoteSet([parent.note])));
        const input = new NoteSet([parent.note, child.note, sibling.note]);

        expect(noteIds(exp.execute(input, {}, dummySearchContext))).toEqual([child.note.noteId]);
    });

    it("feeds the parents of the input set to the sub-expression", () => {
        const parentA = note("ParentA");
        const parentB = note("ParentB");
        const childA = note("ChildA");
        const childB = note("ChildB");
        parentA.child(childA);
        parentB.child(childB);
        rootNote.child(parentA).child(parentB);

        const stub = new StubExp(new NoteSet());
        const exp = new ChildOfExp(stub);

        const executionContext = { marker: true };
        exp.execute(new NoteSet([childA.note, childB.note]), executionContext, dummySearchContext);

        // The sub-expression is invoked exactly once with the de-duplicated set of parents
        // (each child has "root"-less parents parentA/parentB respectively).
        expect(stub.calls).toHaveLength(1);
        expect(noteIds(stub.calls[0].inputNoteSet)).toEqual(
            [parentA.note.noteId, parentB.note.noteId].sort()
        );
        // The execution context is threaded through unchanged.
        expect(stub.calls[0].executionContext).toBe(executionContext);
    });

    it("only returns children that are also present in the input set", () => {
        const parent = note("Parent");
        const includedChild = note("Included");
        const excludedChild = note("Excluded");
        parent.child(includedChild).child(excludedChild);
        rootNote.child(parent);

        // Sub-expression matches the parent, but the input set omits one of its children,
        // so that child must be filtered out of the result.
        const exp = new ChildOfExp(new StubExp(new NoteSet([parent.note])));
        const input = new NoteSet([includedChild.note]);

        expect(noteIds(exp.execute(input, {}, dummySearchContext))).toEqual([
            includedChild.note.noteId
        ]);
    });

    it("de-duplicates a child reachable through multiple matched parents (clones)", () => {
        const parentA = note("ParentA");
        const parentB = note("ParentB");
        const child = note("Child");
        // The same child is cloned under both parents.
        parentA.child(child);
        parentB.child(child);
        rootNote.child(parentA).child(parentB);

        const exp = new ChildOfExp(new StubExp(new NoteSet([parentA.note, parentB.note])));
        const input = new NoteSet([child.note]);

        const result = exp.execute(input, {}, dummySearchContext);
        // NoteSet.add de-duplicates, so the cloned child appears only once.
        expect(noteIds(result)).toEqual([child.note.noteId]);
        expect(result.notes).toHaveLength(1);
    });

    it("returns an empty set when the sub-expression matches no parent", () => {
        const parent = note("Parent");
        const child = note("Child");
        parent.child(child);
        rootNote.child(parent);

        const exp = new ChildOfExp(new StubExp(new NoteSet()));
        const result = exp.execute(new NoteSet([child.note]), {}, dummySearchContext);

        expect(result).toBeInstanceOf(NoteSet);
        expect(result.notes).toHaveLength(0);
    });

    it("returns an empty set when the matched parent's children are absent from the input", () => {
        const parent = note("Parent");
        const child = note("Child");
        parent.child(child);
        rootNote.child(parent);

        // Parent is matched, but the input set contains only the parent (not its child).
        const exp = new ChildOfExp(new StubExp(new NoteSet([parent.note])));
        const result = exp.execute(new NoteSet([parent.note]), {}, dummySearchContext);

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

        const exp = new ChildOfExp(boom);

        expect(() => exp.execute(new NoteSet([child.note]), {}, dummySearchContext)).toThrow(
            "sub-expression failure"
        );
    });
});
