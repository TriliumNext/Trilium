import { describe, expect, it } from "vitest";

import { deriveSeededFind } from "./find.js";

describe("deriveSeededFind", () => {
    it("uses the first token as the seed and the rest as extra highlight tokens", () => {
        expect(deriveSeededFind([ "alpha", "beta", "gamma" ])).toEqual({
            seed: "alpha",
            extraTokens: [ "beta", "gamma" ]
        });
    });

    it("treats a single token as the seed with no extras", () => {
        expect(deriveSeededFind([ "alpha" ])).toEqual({ seed: "alpha", extraTokens: [] });
    });

    it("keeps a quoted phrase (already a single token) intact as the seed", () => {
        expect(deriveSeededFind([ "hello world" ])).toEqual({ seed: "hello world", extraTokens: [] });
    });

    it("degrades to an empty seed for an empty term list", () => {
        expect(deriveSeededFind([])).toEqual({ seed: "", extraTokens: [] });
    });
});
