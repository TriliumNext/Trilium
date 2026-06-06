import { describe, expect, it } from "vitest";

import buildComparator from "./build_comparator.js";

describe("buildComparator", () => {
    it("returns undefined for an unknown operator", () => {
        expect(buildComparator("???", "value")).toBeUndefined();
    });

    describe("numeric comparators", () => {
        it("uses numeric comparison when the compared value is a number", () => {
            const gt = buildComparator(">", "5")!;
            expect(gt("10")).toBe(true);
            expect(gt("3")).toBe(false);
            expect(gt("5")).toBe(false);

            const gte = buildComparator(">=", "5")!;
            expect(gte("5")).toBe(true);
            expect(gte("4")).toBe(false);

            const lt = buildComparator("<", "5")!;
            expect(lt("3")).toBe(true);
            expect(lt("5")).toBe(false);

            const lte = buildComparator("<=", "5")!;
            expect(lte("5")).toBe(true);
            expect(lte("6")).toBe(false);
        });

        it("parses the candidate value as a float (numeric, not lexical)", () => {
            // Lexically "9" > "10", but numerically 9 < 10. Numeric path must win.
            const gt = buildComparator(">", "10")!;
            expect(gt("9")).toBe(false);
            expect(gt("100")).toBe(true);

            // Decimal compared values are supported.
            const lt = buildComparator("<", "2.5")!;
            expect(lt("2.4")).toBe(true);
            expect(lt("2.6")).toBe(false);
        });

        it("falls back to lexical string comparison when the compared value is not numeric", () => {
            const gt = buildComparator(">", "abc")!;
            // String comparison: "abd" > "abc"
            expect(gt("abd")).toBe(true);
            expect(gt("abb")).toBe(false);
        });
    });

    describe("equality operators (= and !=)", () => {
        it("matches a single word case-insensitively against any word in the value", () => {
            const eq = buildComparator("=", "Hello")!;
            expect(eq("hello world")).toBe(true);
            expect(eq("say HELLO there")).toBe(true);
            expect(eq("hellothere")).toBe(false); // not an exact word
            expect(eq("")).toBe(false);
        });

        it("matches a multi-word phrase as a consecutive substring", () => {
            const eq = buildComparator("=", "hello world")!;
            expect(eq("well hello world friend")).toBe(true);
            expect(eq("world hello")).toBe(false);
        });

        it("normalizes diacritics on both sides", () => {
            const eq = buildComparator("=", "café")!;
            expect(eq("the cafe is open")).toBe(true);
        });

        it("negates the equality match and treats empty value as a match", () => {
            const neq = buildComparator("!=", "hello")!;
            expect(neq("hello world")).toBe(false);
            expect(neq("goodbye world")).toBe(true);
            expect(neq("")).toBe(true);

            const neqPhrase = buildComparator("!=", "hello world")!;
            expect(neqPhrase("well hello world")).toBe(false);
            expect(neqPhrase("world hello")).toBe(true);
        });
    });

    describe("substring operators", () => {
        it("handles *= (ends with), =* (starts with) and *=* (includes)", () => {
            // comparedValue is lowercased internally.
            const endsWith = buildComparator("*=", "World")!;
            expect(endsWith("hello world")).toBe(true);
            expect(endsWith("world hello")).toBe(false);
            expect(endsWith("")).toBe(false);

            const startsWith = buildComparator("=*", "Hello")!;
            expect(startsWith("hello world")).toBe(true);
            expect(startsWith("say hello")).toBe(false);
            expect(startsWith("")).toBe(false);

            const includes = buildComparator("*=*", "lo wo")!;
            expect(includes("hello world")).toBe(true);
            expect(includes("helloworld")).toBe(false);
            expect(includes("")).toBe(false);
        });
    });

    describe("regex operator (%=)", () => {
        it("tests the value against the compared value as a regular expression", () => {
            const re = buildComparator("%=", "^h.llo$")!;
            expect(re("hello")).toBe(true);
            expect(re("hallo")).toBe(true);
            expect(re("hello world")).toBe(false);
            expect(re("")).toBe(false);
        });

        it("caches compiled regexes (repeated calls behave consistently)", () => {
            const re = buildComparator("%=", "ab+c")!;
            expect(re("abbbc")).toBe(true);
            expect(re("ac")).toBe(false);
            // Re-using the same pattern hits the cache; behavior is unchanged.
            const re2 = buildComparator("%=", "ab+c")!;
            expect(re2("abc")).toBe(true);
        });
    });

    describe("fuzzy operators (~= and ~*)", () => {
        it("~= matches exact substring and close typos for tokens of sufficient length", () => {
            const fuzzy = buildComparator("~=", "hello")!;
            // Exact substring match.
            expect(fuzzy("well hello there")).toBe(true);
            // Fuzzy word match (single edit distance).
            expect(fuzzy("the hallo world")).toBe(true);
            // Completely unrelated.
            expect(fuzzy("goodbye")).toBe(false);
        });

        it("~= falls back to plain substring matching for tokens below the minimum length", () => {
            // "ab" is shorter than MIN_FUZZY_TOKEN_LENGTH (3), so no fuzzy logic applies.
            const fuzzy = buildComparator("~=", "ab")!;
            expect(fuzzy("crab")).toBe(true);
            expect(fuzzy("xyz")).toBe(false);
        });

        it("returns false when either side is empty for fuzzy operators", () => {
            const fuzzyEq = buildComparator("~=", "hello")!;
            expect(fuzzyEq("")).toBe(false);

            const fuzzyStar = buildComparator("~*", "hello")!;
            expect(fuzzyStar("")).toBe(false);
        });

        it("~* performs fuzzy matching across the whole content", () => {
            const fuzzy = buildComparator("~*", "hello")!;
            expect(fuzzy("hello world")).toBe(true);
            expect(fuzzy("xyz")).toBe(false);
        });

        it("~* falls back to substring matching for short tokens", () => {
            const fuzzy = buildComparator("~*", "ab")!;
            expect(fuzzy("crab")).toBe(true);
            expect(fuzzy("xyz")).toBe(false);
        });
    });
});
