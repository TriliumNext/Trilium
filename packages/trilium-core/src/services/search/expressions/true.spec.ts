import { beforeEach, describe, expect, it } from "vitest";

import becca from "../../../becca/becca.js";
import type BNote from "../../../becca/entities/bnote.js";
import { note } from "../../../test/becca_mocking.js";
import Expression from "./expression.js";
import NoteSet from "../note_set.js";
import TrueExp from "./true.js";

// SearchContext-like argument is unused by execute(), so we pass an empty object.
const dummySearchContext = {} as any;

let a: BNote;
let b: BNote;

describe("TrueExp", () => {
    beforeEach(() => {
        becca.reset();

        a = note("A").note;
        b = note("B").note;
    });

    it("is an Expression with the constructor name as its name", () => {
        const exp = new TrueExp();

        expect(exp).toBeInstanceOf(Expression);
        expect(exp.name).toBe("TrueExp");
    });

    it("returns the exact same note set instance it was given", () => {
        const exp = new TrueExp();
        const input = new NoteSet([a, b]);

        const result = exp.execute(input, {}, dummySearchContext);

        // Identity passthrough: same reference, same contents, nothing mutated.
        expect(result).toBe(input);
        expect(result.notes).toEqual([a, b]);
    });

    it("passes through an empty note set unchanged", () => {
        const exp = new TrueExp();
        const input = new NoteSet();

        const result = exp.execute(input, {}, dummySearchContext);

        expect(result).toBe(input);
        expect(result.notes).toHaveLength(0);
    });
});
