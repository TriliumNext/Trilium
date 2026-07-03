import { beforeEach, describe, expect, it } from "vitest";

import { getBecca } from "../../../becca/becca.js";
import type BNote from "../../../becca/entities/bnote.js";
import { note } from "../../../test/becca_mocking.js";
import NoteSet from "../note_set.js";
import type SearchContext from "../search_context.js";
import Expression from "./expression.js";
import NotExp from "./not.js";

// execute() ignores the executionContext / searchContext arguments, so dummies suffice.
const dummySearchContext = {} as SearchContext;

/** A stub sub-expression that always returns a fixed NoteSet, recording its inputs. */
class StubExp extends Expression {
    result: NoteSet;
    calls: Array<{ inputNoteSet: NoteSet; executionContext: {}; searchContext: SearchContext }> = [];

    constructor(result: NoteSet) {
        super();
        this.result = result;
    }

    execute(inputNoteSet: NoteSet, executionContext: {}, searchContext: SearchContext) {
        this.calls.push({ inputNoteSet, executionContext, searchContext });
        return this.result;
    }
}

function noteIds(noteSet: NoteSet) {
    return noteSet.notes.map((n) => n.noteId).sort();
}

let a: BNote, b: BNote, c: BNote;

describe("NotExp", () => {
    beforeEach(() => {
        getBecca().reset();

        a = note("A").note;
        b = note("B").note;
        c = note("C").note;
    });

    it("stores the sub-expression passed to the constructor", () => {
        const sub = new StubExp(new NoteSet());
        const exp = new NotExp(sub);

        expect(exp.subExpression).toBe(sub);
        // Inherited from Expression: name is the runtime constructor name.
        expect(exp.name).toBe("NotExp");
    });

    it("returns the input notes that are NOT matched by the sub-expression", () => {
        const input = new NoteSet([a, b, c]);
        // Sub-expression matches only B, so the result should be A and C.
        const exp = new NotExp(new StubExp(new NoteSet([b])));

        const result = exp.execute(input, {}, dummySearchContext);

        expect(noteIds(result)).toEqual([a.noteId, c.noteId].sort());
    });

    it("returns the full input set when the sub-expression matches nothing", () => {
        const input = new NoteSet([a, b, c]);
        const exp = new NotExp(new StubExp(new NoteSet()));

        const result = exp.execute(input, {}, dummySearchContext);

        expect(noteIds(result)).toEqual([a.noteId, b.noteId, c.noteId].sort());
    });

    it("returns an empty set when the sub-expression matches the entire input", () => {
        const input = new NoteSet([a, b, c]);
        const exp = new NotExp(new StubExp(new NoteSet([a, b, c])));

        const result = exp.execute(input, {}, dummySearchContext);

        expect(result.notes).toHaveLength(0);
    });

    it("ignores sub-expression matches that are not part of the input set", () => {
        const input = new NoteSet([a, b]);
        // The sub-expression also matches C, which is not in the input and must not affect the result.
        const exp = new NotExp(new StubExp(new NoteSet([b, c])));

        const result = exp.execute(input, {}, dummySearchContext);

        expect(noteIds(result)).toEqual([a.noteId]);
    });

    it("forwards the input note set and contexts to the sub-expression and returns a fresh NoteSet", () => {
        const input = new NoteSet([a, b]);
        const executionContext = { marker: true };
        const sub = new StubExp(new NoteSet([a]));
        const exp = new NotExp(sub);

        const result = exp.execute(input, executionContext, dummySearchContext);

        // The sub-expression is invoked exactly once with the same arguments NotExp received.
        expect(sub.calls).toHaveLength(1);
        expect(sub.calls[0].inputNoteSet).toBe(input);
        expect(sub.calls[0].executionContext).toBe(executionContext);
        expect(sub.calls[0].searchContext).toBe(dummySearchContext);

        // minus() builds a new NoteSet rather than mutating the input.
        expect(result).not.toBe(input);
        expect(noteIds(result)).toEqual([b.noteId]);
        expect(noteIds(input)).toEqual([a.noteId, b.noteId].sort());
    });

    it("returns an empty set for an empty input set", () => {
        const exp = new NotExp(new StubExp(new NoteSet([a, b, c])));

        const result = exp.execute(new NoteSet(), {}, dummySearchContext);

        expect(result.notes).toHaveLength(0);
    });
});
