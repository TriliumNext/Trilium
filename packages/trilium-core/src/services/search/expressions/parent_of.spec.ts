import { beforeEach, describe, expect, it } from "vitest";

import { getBecca } from "../../../becca/becca.js";
import BBranch from "../../../becca/entities/bbranch.js";
import BNote from "../../../becca/entities/bnote.js";
import { note, NoteBuilder } from "../../../test/becca_mocking.js";
import Expression from "./expression.js";
import NoteSet from "../note_set.js";
import ParentOfExp from "./parent_of.js";

// SearchContext-like argument is unused by execute(), so we pass an empty object.
const dummySearchContext = {} as any;

/** A stub sub-expression: records the note set it receives and returns a fixed result. */
class StubExp extends Expression {
    calls: NoteSet[] = [];

    constructor(private result: NoteSet) {
        super();
    }

    execute(inputNoteSet: NoteSet) {
        this.calls.push(inputNoteSet);
        return this.result;
    }
}

function noteIds(noteSet: NoteSet) {
    return noteSet.notes.map((n) => n.noteId).sort();
}

let rootNote: NoteBuilder;

describe("ParentOfExp", () => {
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

    it("returns the parents of the notes matched by the sub-expression", () => {
        const parent = note("Parent");
        const child = note("Child");
        parent.child(child);
        rootNote.child(parent);

        // The sub-expression matches the child; the result should be its parent.
        const sub = new StubExp(new NoteSet([child.note]));
        const exp = new ParentOfExp(sub);

        const input = new NoteSet([rootNote.note, parent.note, child.note]);
        expect(noteIds(exp.execute(input, {}, dummySearchContext))).toEqual([
            parent.note.noteId
        ]);
    });

    it("feeds the sub-expression a note set of all children of the input notes", () => {
        const parent = note("Parent");
        const childA = note("ChildA");
        const childB = note("ChildB");
        parent.child(childA).child(childB);
        rootNote.child(parent);

        const sub = new StubExp(new NoteSet());
        const exp = new ParentOfExp(sub);

        exp.execute(new NoteSet([parent.note]), {}, dummySearchContext);

        // The sub-expression must have been called once with both children.
        expect(sub.calls).toHaveLength(1);
        expect(noteIds(sub.calls[0])).toEqual([childA.note.noteId, childB.note.noteId].sort());
    });

    it("excludes a parent that is not present in the input note set", () => {
        const parent = note("Parent");
        const child = note("Child");
        parent.child(child);
        rootNote.child(parent);

        // The matched child's parent exists, but it is filtered out because the input
        // set does not contain it.
        const sub = new StubExp(new NoteSet([child.note]));
        const exp = new ParentOfExp(sub);

        const input = new NoteSet([rootNote.note, child.note]);
        expect(exp.execute(input, {}, dummySearchContext).notes).toHaveLength(0);
    });

    it("returns only the input-set parents for a cloned (multi-parent) child", () => {
        const parentA = note("ParentA");
        const parentB = note("ParentB");
        const child = note("Child");
        parentA.child(child);
        parentB.child(child);
        rootNote.child(parentA).child(parentB);

        const sub = new StubExp(new NoteSet([child.note]));
        const exp = new ParentOfExp(sub);

        // Both parents match, but only the one present in the input set is returned.
        const input = new NoteSet([parentA.note, child.note]);
        expect(noteIds(exp.execute(input, {}, dummySearchContext))).toEqual([
            parentA.note.noteId
        ]);

        // With both parents in the input, both are returned.
        const inputBoth = new NoteSet([parentA.note, parentB.note, child.note]);
        expect(noteIds(exp.execute(inputBoth, {}, dummySearchContext))).toEqual(
            [parentA.note.noteId, parentB.note.noteId].sort()
        );
    });

    it("de-duplicates a parent that has several matching children", () => {
        const parent = note("Parent");
        const childA = note("ChildA");
        const childB = note("ChildB");
        parent.child(childA).child(childB);
        rootNote.child(parent);

        // Both children match; the shared parent must appear exactly once.
        const sub = new StubExp(new NoteSet([childA.note, childB.note]));
        const exp = new ParentOfExp(sub);

        const result = exp.execute(new NoteSet([parent.note]), {}, dummySearchContext);
        expect(noteIds(result)).toEqual([parent.note.noteId]);
        expect(result.notes).toHaveLength(1);
    });

    it("returns an empty set when the sub-expression matches nothing", () => {
        const parent = note("Parent");
        const child = note("Child");
        parent.child(child);
        rootNote.child(parent);

        const sub = new StubExp(new NoteSet());
        const exp = new ParentOfExp(sub);

        const result = exp.execute(new NoteSet([parent.note, child.note]), {}, dummySearchContext);
        expect(result).toBeInstanceOf(NoteSet);
        expect(result.notes).toHaveLength(0);
    });

    it("propagates an error thrown by the sub-expression", () => {
        const parent = note("Parent");
        const child = note("Child");
        parent.child(child);
        rootNote.child(parent);

        const boom = new (class extends Expression {
            execute(): NoteSet {
                throw new Error("sub-expression failure");
            }
        })();
        const exp = new ParentOfExp(boom);

        expect(() => exp.execute(new NoteSet([parent.note]), {}, dummySearchContext)).toThrow(
            "sub-expression failure"
        );
    });
});
