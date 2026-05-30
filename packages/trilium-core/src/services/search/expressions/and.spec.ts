import { describe, expect, it } from "vitest";

import type NoteSet from "../note_set.js";
import type SearchContext from "../search_context.js";
import AndExp from "./and.js";
import Expression from "./expression.js";
import TrueExp from "./true.js";

// execute() never inspects the SearchContext, so an empty object is enough.
const dummySearchContext = {} as SearchContext;

/**
 * Minimal Expression stub that records every NoteSet it receives and returns a
 * (possibly different) NoteSet, letting us observe the chaining order.
 */
class RecordingExp extends Expression {
    received: NoteSet[] = [];

    constructor(private readonly output?: NoteSet) {
        super();
    }

    execute(inputNoteSet: NoteSet): NoteSet {
        this.received.push(inputNoteSet);
        return this.output ?? inputNoteSet;
    }
}

describe("AndExp", () => {
    describe("of()", () => {
        it("returns a TrueExp when given no (truthy) sub-expressions", () => {
            expect(AndExp.of([])).toBeInstanceOf(TrueExp);
            expect(AndExp.of([null, undefined])).toBeInstanceOf(TrueExp);
        });

        it("returns the single sub-expression unwrapped instead of an AndExp", () => {
            const only = new RecordingExp();

            // The lone real expression is returned directly...
            expect(AndExp.of([only])).toBe(only);
            // ...and nullish entries are filtered before counting.
            expect(AndExp.of([null, only, undefined])).toBe(only);
        });

        it("wraps two or more sub-expressions in an AndExp, dropping nullish ones", () => {
            const a = new RecordingExp();
            const b = new RecordingExp();

            const result = AndExp.of([a, null, b, undefined]);

            expect(result).toBeInstanceOf(AndExp);
            expect((result as AndExp).subExpressions).toEqual([a, b]);
        });
    });

    describe("execute()", () => {
        it("feeds each sub-expression's output into the next and returns the last", () => {
            const first = new RecordingExp({ marker: "after-first" } as unknown as NoteSet);
            const second = new RecordingExp({ marker: "after-second" } as unknown as NoteSet);
            const input = { marker: "input" } as unknown as NoteSet;

            const exp = new AndExp([first, second]);
            const result = exp.execute(input, {}, dummySearchContext);

            // first sees the original input, second sees first's output.
            expect(first.received).toEqual([input]);
            expect(second.received).toEqual([{ marker: "after-first" }]);
            // the final return value is the last sub-expression's output.
            expect(result).toEqual({ marker: "after-second" });
        });

        it("returns the input note set unchanged when there are no sub-expressions", () => {
            const input = { marker: "input" } as unknown as NoteSet;

            const result = new AndExp([]).execute(input, {}, dummySearchContext);

            expect(result).toBe(input);
        });

        it("acts as identity when every sub-expression passes the set through", () => {
            const passthroughA = new RecordingExp();
            const passthroughB = new RecordingExp();
            const input = { marker: "input" } as unknown as NoteSet;

            const result = new AndExp([passthroughA, passthroughB]).execute(
                input,
                {},
                dummySearchContext
            );

            expect(result).toBe(input);
            expect(passthroughA.received).toEqual([input]);
            expect(passthroughB.received).toEqual([input]);
        });
    });

    it("stores the provided sub-expressions on construction", () => {
        const subExpressions = [new RecordingExp(), new RecordingExp()];

        expect(new AndExp(subExpressions).subExpressions).toBe(subExpressions);
    });
});
