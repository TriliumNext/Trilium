import { describe, expect, it } from "vitest";

import { betterQuality, classifyContentMatch, type ContentMatchTier, tierRank } from "./match_quality.js";

/** Convenience: tokenize a plain string into whitespace-separated words. */
function words(text: string): string[] {
    return text.split(/\s+/).filter((word) => word.length > 0);
}

describe("match_quality", () => {
    describe("tierRank", () => {
        it("orders tiers from weakest (fuzzy) to strongest (exact_phrase)", () => {
            const ordered: ContentMatchTier[] = [
                "fuzzy",
                "substring",
                "word_prefix",
                "exact_word",
                "proximity",
                "exact_phrase"
            ];

            for (let i = 1; i < ordered.length; i++) {
                expect(tierRank(ordered[i])).toBeGreaterThan(tierRank(ordered[i - 1]));
            }
        });
    });

    describe("betterQuality", () => {
        it("keeps the higher tier", () => {
            const a = { tier: "substring" as const, matchedTokenCount: 3, inOrder: false };
            const b = { tier: "exact_word" as const, matchedTokenCount: 1, inOrder: false };

            expect(betterQuality(a, b)).toBe(b);
            expect(betterQuality(b, a)).toBe(b);
        });

        it("breaks a tier tie by the higher matchedTokenCount", () => {
            const a = { tier: "exact_word" as const, matchedTokenCount: 2, inOrder: false };
            const b = { tier: "exact_word" as const, matchedTokenCount: 4, inOrder: false };

            expect(betterQuality(a, b)).toBe(b);
            expect(betterQuality(b, a)).toBe(b);
        });
    });

    describe("classifyContentMatch", () => {
        it("returns null when nothing matches", () => {
            expect(classifyContentMatch(["zzz"], words("alpha beta gamma"))).toBeNull();
            expect(classifyContentMatch([], words("alpha"))).toBeNull();
            expect(classifyContentMatch(["alpha"], [])).toBeNull();
        });

        it("classifies a consecutive multi-token run as exact_phrase", () => {
            const q = classifyContentMatch(["you", "and", "me"], words("i like you and me as a phrase"));

            expect(q?.tier).toBe("exact_phrase");
            expect(q?.matchedTokenCount).toBe(3);
        });

        it("classifies all tokens present within the proximity window as proximity", () => {
            // "you" and "me" are exact words 3 apart, but not consecutive.
            const q = classifyContentMatch(["you", "me"], words("you know it is me now"));

            expect(q?.tier).toBe("proximity");
            expect(q?.inOrder).toBe(true);
            expect(q?.matchedTokenCount).toBe(2);
        });

        it("marks proximity out of order when the tokens appear reversed", () => {
            const q = classifyContentMatch(["alpha", "beta"], words("beta then some words alpha"));

            expect(q?.tier).toBe("proximity");
            expect(q?.inOrder).toBe(false);
        });

        it("treats tokens exactly 10 words apart as proximity but 11 apart as exact_word", () => {
            const fillers = (n: number) => Array.from({ length: n }, (_, i) => `x${i}`);

            const tenApart = ["alpha", ...fillers(9), "beta"]; // beta at index 10
            const elevenApart = ["alpha", ...fillers(10), "beta"]; // beta at index 11

            expect(classifyContentMatch(["alpha", "beta"], tenApart)?.tier).toBe("proximity");
            expect(classifyContentMatch(["alpha", "beta"], elevenApart)?.tier).toBe("exact_word");
        });

        it("classifies a single exact word match as exact_word", () => {
            const q = classifyContentMatch(["sync"], words("please sync the notes"));

            expect(q?.tier).toBe("exact_word");
            expect(q?.matchedTokenCount).toBe(1);
            expect(q?.inOrder).toBe(false);
        });

        it("classifies a content word that starts with the token as word_prefix", () => {
            const q = classifyContentMatch(["combin"], words("the value is combined here"));

            expect(q?.tier).toBe("word_prefix");
            expect(q?.matchedTokenCount).toBe(1);
        });

        it("classifies a token embedded inside a content word as substring", () => {
            const q = classifyContentMatch(["ync"], words("the asynchronous flag"));

            expect(q?.tier).toBe("substring");
            expect(q?.matchedTokenCount).toBe(1);
        });

        it("counts distinct matched tokens even across different tiers", () => {
            // "you" exact, "menu" prefix-matches "me", "and" exact => 3 distinct matched tokens,
            // best tier is exact_word (not all tokens are exact words, so no proximity).
            const q = classifyContentMatch(["you", "and", "me"], words("the menu and you"));

            expect(q?.tier).toBe("exact_word");
            expect(q?.matchedTokenCount).toBe(3);
        });
    });
});
