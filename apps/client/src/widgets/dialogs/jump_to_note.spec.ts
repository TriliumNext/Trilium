import { describe, expect, it } from "vitest";

import { deriveSearchViewScope } from "./jump_to_note";

describe("deriveSearchViewScope", () => {
    it("attaches searchTerms for a typed search string", () => {
        expect(deriveSearchViewScope(false, "hello")).toEqual({ searchTerms: ["hello"] });
    });

    it("trims the typed text before using it as a search term", () => {
        expect(deriveSearchViewScope(false, "  hello world  ")).toEqual({ searchTerms: ["hello world"] });
    });

    it("returns an empty viewScope in command-palette mode, even with typed text", () => {
        // Regression: command suggestions never carry a notePath so this branch is normally
        // unreachable for them, but the gate itself must not leak searchTerms if it ever is.
        expect(deriveSearchViewScope(true, ">some command")).toEqual({});
    });

    it("returns an empty viewScope for an untyped/blank query (e.g. a 'recent notes' pick)", () => {
        expect(deriveSearchViewScope(false, "")).toEqual({});
        expect(deriveSearchViewScope(false, "   ")).toEqual({});
        expect(deriveSearchViewScope(false, undefined)).toEqual({});
    });

    it("does not attach a stale search term once the query has actually been cleared", () => {
        // Reproduces the review finding: typing "hello", then clearing/switching to recent
        // notes without the ref going stale, must gate the same as never having typed anything.
        expect(deriveSearchViewScope(false, "hello")).toEqual({ searchTerms: ["hello"] });
        expect(deriveSearchViewScope(false, "")).toEqual({});
    });
});
