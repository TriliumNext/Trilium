import { beforeEach, describe, expect, it } from "vitest";

import becca from "../../../becca/becca.js";
import type BNote from "../../../becca/entities/bnote.js";
import { note } from "../../../test/becca_mocking.js";
import NoteSet from "../note_set.js";
import Expression from "./expression.js";
import OrderByAndLimitExp from "./order_by_and_limit.js";

// SearchContext-like argument is unused by execute(), so we pass an empty object.
const dummySearchContext = {} as any;

/** A subexpression that simply returns the note set it is configured with. */
class StubExpression extends Expression {
    constructor(private result: NoteSet) {
        super();
    }

    execute() {
        return this.result;
    }
}

function run(exp: OrderByAndLimitExp, notes: BNote[]) {
    exp.subExpression = new StubExpression(new NoteSet(notes));
    return exp.execute(new NoteSet(notes), {}, dummySearchContext);
}

/** Build a value extractor keyed off the note title via a lookup table. */
function extractorFor(values: Record<string, number | string | null>) {
    return {
        valueExtractor: {
            extract: (n: BNote) => values[n.title]
        }
    };
}

describe("OrderByAndLimitExp", () => {
    beforeEach(() => {
        becca.reset();
    });

    it("derives smaller/larger comparison signs from the direction", () => {
        const asc = new OrderByAndLimitExp([{ direction: "asc", valueExtractor: { extract: () => 0 } }]);
        const desc = new OrderByAndLimitExp([{ direction: "desc", valueExtractor: { extract: () => 0 } }]);
        const fallback = new OrderByAndLimitExp([{ valueExtractor: { extract: () => 0 } }]);

        // The fields aren't part of the public type, but the constructor sets them.
        expect((asc as any).orderDefinitions[0].smaller).toBe(-1);
        expect((asc as any).orderDefinitions[0].larger).toBe(1);

        // Anything other than "asc" (including missing direction) is treated as descending.
        expect((desc as any).orderDefinitions[0].smaller).toBe(1);
        expect((desc as any).orderDefinitions[0].larger).toBe(-1);
        expect((fallback as any).orderDefinitions[0].smaller).toBe(1);
        expect((fallback as any).orderDefinitions[0].larger).toBe(-1);
    });

    it("defaults the limit to 0 when none is provided", () => {
        expect(new OrderByAndLimitExp([], 5).limit).toBe(5);
        expect(new OrderByAndLimitExp([]).limit).toBe(0);
    });

    it("throws when executed without a subexpression", () => {
        const exp = new OrderByAndLimitExp([{ direction: "asc", valueExtractor: { extract: () => 0 } }]);
        expect(() => exp.execute(new NoteSet([]), {}, dummySearchContext)).toThrow("Missing subexpression");
    });

    it("returns a sorted note set flagged as sorted (defaulting to descending order)", () => {
        const a = note("A").note;
        const b = note("B").note;
        // No direction => treated as descending, so the larger value comes first.
        const exp = new OrderByAndLimitExp([extractorFor({ A: 2, B: 1 })]);

        const result = run(exp, [a, b]);

        expect(result.sorted).toBe(true);
        expect(result.notes.map((n) => n.title)).toEqual(["A", "B"]);
    });

    it("sorts ascending and descending numeric values", () => {
        const a = note("A").note;
        const b = note("B").note;
        const c = note("C").note;
        const values = { A: 3, B: 1, C: 2 };

        const asc = new OrderByAndLimitExp([{ direction: "asc", valueExtractor: { extract: (n) => values[n.title as keyof typeof values] } }]);
        expect(run(asc, [a, b, c]).notes.map((n) => n.title)).toEqual(["B", "C", "A"]);

        const desc = new OrderByAndLimitExp([{ direction: "desc", valueExtractor: { extract: (n) => values[n.title as keyof typeof values] } }]);
        expect(run(desc, [a, b, c]).notes.map((n) => n.title)).toEqual(["A", "C", "B"]);
    });

    it("parses numeric strings for numerical (not lexicographic) comparison", () => {
        const a = note("A").note;
        const b = note("B").note;
        // "20" and "123.45" are both rejected by isDate() but accepted by isNumber(), so the
        // comparator genuinely takes the parseFloat numeric branch (unlike "10"/"9", which
        // new Date() accepts and would route through the date branch instead). Numerically
        // 20 < 123.45, but lexicographically "123.45" < "20" — so a string sort would yield
        // ["B", "A"] and only a numeric sort yields ["A", "B"].
        const exp = new OrderByAndLimitExp([{ direction: "asc", valueExtractor: { extract: (n) => (n.title === "A" ? "20" : "123.45") } }]);

        expect(run(exp, [a, b]).notes.map((n) => n.title)).toEqual(["A", "B"]);
    });

    it("parses date strings for chronological comparison", () => {
        const a = note("A").note;
        const b = note("B").note;
        const exp = new OrderByAndLimitExp([{ direction: "asc", valueExtractor: { extract: (n) => (n.title === "A" ? "2024-12-31" : "2020-01-01") } }]);

        expect(run(exp, [a, b]).notes.map((n) => n.title)).toEqual(["B", "A"]);
    });

    it("sorts a null value last when ascending and first when descending", () => {
        const a = note("A").note;
        const b = note("B").note;
        const c = note("C").note;

        // A has no value (null). Ascending pushes null to the bottom...
        const asc = new OrderByAndLimitExp([{ direction: "asc", valueExtractor: { extract: (n) => ({ A: null, B: 1, C: 2 } as Record<string, number | null>)[n.title] } }]);
        expect(run(asc, [a, b, c]).notes.map((n) => n.title)).toEqual(["B", "C", "A"]);

        // ...while descending pulls null to the top.
        const desc = new OrderByAndLimitExp([{ direction: "desc", valueExtractor: { extract: (n) => ({ A: null, B: 1, C: 2 } as Record<string, number | null>)[n.title] } }]);
        expect(run(desc, [a, b, c]).notes.map((n) => n.title)).toEqual(["A", "C", "B"]);
    });

    it("treats undefined the same as null and keeps both null-valued notes' relative order", () => {
        const a = note("A").note;
        const b = note("B").note;
        // valueExtractor returns undefined for unknown titles; both are missing.
        const exp = new OrderByAndLimitExp([{ direction: "asc", valueExtractor: { extract: () => undefined as any } }]);

        // When both values are null, the comparator returns 0 and the original order is preserved.
        expect(run(exp, [a, b]).notes.map((n) => n.title)).toEqual(["A", "B"]);
    });

    it("falls through to the next order definition when the first compares equal", () => {
        const a = note("A").note;
        const b = note("B").note;
        const c = note("C").note;

        const primary = { A: 1, B: 1, C: 2 };
        const secondary = { A: 20, B: 10, C: 5 };

        const exp = new OrderByAndLimitExp([
            { direction: "asc", valueExtractor: { extract: (n) => primary[n.title as keyof typeof primary] } },
            { direction: "asc", valueExtractor: { extract: (n) => secondary[n.title as keyof typeof secondary] } }
        ]);

        // A and B tie on the primary key (1), broken by the secondary key: B(10) before A(20). C has primary 2 last.
        expect(run(exp, [a, b, c]).notes.map((n) => n.title)).toEqual(["B", "A", "C"]);
    });

    it("continues to the next order definition when both values are empty/zero", () => {
        const a = note("A").note;
        const b = note("B").note;

        // Both have 0 on the primary key (falsy -> continue), broken by the secondary key.
        const exp = new OrderByAndLimitExp([
            { direction: "asc", valueExtractor: { extract: () => 0 } },
            { direction: "asc", valueExtractor: { extract: (n) => (n.title === "A" ? 2 : 1) } }
        ]);

        expect(run(exp, [a, b]).notes.map((n) => n.title)).toEqual(["B", "A"]);
    });

    it("applies the limit by slicing the sorted result", () => {
        const a = note("A").note;
        const b = note("B").note;
        const c = note("C").note;
        const values = { A: 3, B: 1, C: 2 };

        const exp = new OrderByAndLimitExp([{ direction: "asc", valueExtractor: { extract: (n) => values[n.title as keyof typeof values] } }], 2);

        // Sorted ascending => B, C, A; limit 2 keeps the first two.
        expect(run(exp, [a, b, c]).notes.map((n) => n.title)).toEqual(["B", "C"]);
    });

    it("does not slice when the limit is zero", () => {
        const a = note("A").note;
        const b = note("B").note;
        const c = note("C").note;
        const exp = new OrderByAndLimitExp([{ direction: "asc", valueExtractor: { extract: () => 0 } }]);

        expect(run(exp, [a, b, c]).notes).toHaveLength(3);
    });

    describe("isDate", () => {
        it("recognises parseable dates and rejects garbage", () => {
            const exp = new OrderByAndLimitExp([]);
            expect(exp.isDate("2024-01-01")).toBe(true);
            expect(exp.isDate("not-a-date")).toBe(false);
        });
    });

    describe("isNumber", () => {
        it("recognises numbers and numeric strings, rejecting blanks and words", () => {
            const exp = new OrderByAndLimitExp([]);
            expect(exp.isNumber(42)).toBe(true);
            expect(exp.isNumber("42")).toBe(true);
            expect(exp.isNumber("3.14")).toBe(true);
            expect(exp.isNumber("")).toBe(false);
            expect(exp.isNumber("   ")).toBe(false);
            expect(exp.isNumber("abc")).toBe(false);
        });
    });
});
