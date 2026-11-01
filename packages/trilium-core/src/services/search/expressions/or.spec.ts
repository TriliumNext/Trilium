import { beforeEach, describe, expect, it } from "vitest";

import { getBecca } from "../../../becca/becca.js";
import type BNote from "../../../becca/entities/bnote.js";
import { note } from "../../../test/becca_mocking.js";
import Expression from "./expression.js";
import NoteSet from "../note_set.js";
import OrExp from "./or.js";
import TrueExp from "./true.js";

// SearchContext-like argument is unused by execute(), so we pass an empty object.
const dummySearchContext = {} as any;

/** A stub expression that records its inputs and returns a predetermined note set. */
class StubExp extends Expression {
    calls: { inputNoteSet: NoteSet }[] = [];

    constructor(private result: NoteSet) {
        super();
    }

    execute(inputNoteSet: NoteSet) {
        this.calls.push({ inputNoteSet });
        return this.result;
    }
}

function noteIds(noteSet: NoteSet) {
    return noteSet.notes.map((n) => n.noteId).sort();
}

let a: BNote;
let b: BNote;
let c: BNote;

describe("OrExp", () => {
    beforeEach(() => {
        getBecca().reset();

        a = note("A").note;
        b = note("B").note;
        c = note("C").note;
    });

    describe("of()", () => {
        it("returns a TrueExp when there are no sub-expressions", () => {
            expect(OrExp.of([])).toBeInstanceOf(TrueExp);
        });

        it("returns a TrueExp when every sub-expression is falsy", () => {
            // Falsy entries are filtered out, leaving nothing behind.
            expect(OrExp.of([undefined as any, null as any])).toBeInstanceOf(TrueExp);
        });

        it("unwraps to the single sub-expression instead of wrapping it", () => {
            const only = new StubExp(new NoteSet([a]));

            // A lone expression is returned directly (no OrExp wrapper).
            expect(OrExp.of([only])).toBe(only);

            // Falsy entries are dropped first, so a single real expression also unwraps.
            expect(OrExp.of([null as any, only, undefined as any])).toBe(only);
        });

        it("wraps multiple sub-expressions in an OrExp", () => {
            const first = new StubExp(new NoteSet([a]));
            const second = new StubExp(new NoteSet([b]));

            const exp = OrExp.of([first, second]);

            expect(exp).toBeInstanceOf(OrExp);
            expect((exp as OrExp).subExpressions).toEqual([first, second]);
        });

        it("filters falsy entries before deciding how to wrap", () => {
            const first = new StubExp(new NoteSet([a]));
            const second = new StubExp(new NoteSet([b]));

            const exp = OrExp.of([first, null as any, second, undefined as any]);

            expect(exp).toBeInstanceOf(OrExp);
            expect((exp as OrExp).subExpressions).toEqual([first, second]);
        });
    });

    describe("execute()", () => {
        it("returns the union of all sub-expression results", () => {
            const exp = new OrExp([
                new StubExp(new NoteSet([a, b])),
                new StubExp(new NoteSet([b, c]))
            ]);

            const result = exp.execute(new NoteSet([a, b, c]), {}, dummySearchContext);

            // Overlapping note b appears only once (mergeIn de-duplicates).
            expect(noteIds(result)).toEqual([a.noteId, b.noteId, c.noteId].sort());
        });

        it("returns a fresh, empty NoteSet when there are no sub-expressions", () => {
            const input = new NoteSet([a, b, c]);
            const exp = new OrExp([]);

            const result = exp.execute(input, {}, dummySearchContext);

            expect(result).toBeInstanceOf(NoteSet);
            expect(result).not.toBe(input);
            expect(result.notes).toHaveLength(0);
        });

        it("passes the input note set and context through to each sub-expression", () => {
            const first = new StubExp(new NoteSet([a]));
            const second = new StubExp(new NoteSet([b]));
            const input = new NoteSet([a, b, c]);

            new OrExp([first, second]).execute(input, {}, dummySearchContext);

            expect(first.calls).toHaveLength(1);
            expect(first.calls[0].inputNoteSet).toBe(input);
            expect(second.calls).toHaveLength(1);
            expect(second.calls[0].inputNoteSet).toBe(input);
        });

        it("propagates an error thrown by any sub-expression", () => {
            const boom = new (class extends Expression {
                execute(): NoteSet {
                    throw new Error("sub-expression failure");
                }
            })();
            const exp = new OrExp([new StubExp(new NoteSet([a])), boom]);

            expect(() => exp.execute(new NoteSet([a]), {}, dummySearchContext)).toThrow(
                "sub-expression failure"
            );
        });
    });
});
