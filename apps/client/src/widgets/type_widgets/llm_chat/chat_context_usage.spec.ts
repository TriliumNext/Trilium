import { describe, expect, it } from "vitest";

import { computeContextUsage, estimateTokens, quantizeDraftTokens } from "./chat_context_usage.js";

describe("chat context usage", () => {
    describe("computeContextUsage", () => {
        it("stays hidden below the visible threshold, and appears once crossed", () => {
            const below = computeContextUsage({ promptTokens: 4_000, completionTokens: 0, draftTokens: 0, contextWindow: 10_000 });
            expect(below).toBeNull();

            const above = computeContextUsage({ promptTokens: 5_500, completionTokens: 0, draftTokens: 0, contextWindow: 10_000 });
            expect(above).toMatchObject({ level: "neutral", percentage: 55, usedTokens: 5_500, contextWindow: 10_000 });
        });

        it("reports nothing when the model advertises no context window, rather than guessing one", () => {
            const shared = { promptTokens: 190_000, completionTokens: 0, draftTokens: 0 };
            expect(computeContextUsage({ ...shared, contextWindow: undefined })).toBeNull();
            expect(computeContextUsage({ ...shared, contextWindow: 0 })).toBeNull();
            expect(computeContextUsage({ ...shared, contextWindow: -1 })).toBeNull();
        });

        it("counts the last reply and the unsent draft, not just the last prompt", () => {
            // 4k prompt alone is 40% and would stay hidden; the reply and draft are what
            // actually push the *next* request over the line.
            expect(computeContextUsage({ promptTokens: 4_000, completionTokens: 0, draftTokens: 0, contextWindow: 10_000 })).toBeNull();

            const usage = computeContextUsage({ promptTokens: 4_000, completionTokens: 1_500, draftTokens: 500, contextWindow: 10_000 });
            expect(usage).toMatchObject({ level: "neutral", percentage: 60, usedTokens: 6_000 });
        });

        it("escalates through neutral, warning and critical at the thresholds", () => {
            const at = (tokens: number) => computeContextUsage({ promptTokens: tokens, completionTokens: 0, draftTokens: 0, contextWindow: 1_000 })?.level;
            expect(at(740)).toBe("neutral");
            expect(at(750)).toBe("warning");
            expect(at(899)).toBe("warning");
            expect(at(900)).toBe("critical");
        });

        it("clamps an overflowing conversation to 100% instead of reporting past full", () => {
            const usage = computeContextUsage({ promptTokens: 5_000, completionTokens: 0, draftTokens: 0, contextWindow: 2_000 });
            expect(usage).toMatchObject({ level: "critical", percentage: 100, usedTokens: 5_000 });
        });

        it("ignores negative token counts rather than letting them subtract", () => {
            const usage = computeContextUsage({ promptTokens: 900, completionTokens: -500, draftTokens: -100, contextWindow: 1_000 });
            expect(usage).toMatchObject({ level: "critical", usedTokens: 900 });
        });
    });

    describe("estimateTokens", () => {
        it("approximates four characters per token and rounds up, so any text costs at least one", () => {
            expect(estimateTokens("")).toBe(0);
            expect(estimateTokens("a")).toBe(1);
            expect(estimateTokens("abcd")).toBe(1);
            expect(estimateTokens("abcde")).toBe(2);
            expect(estimateTokens("x".repeat(400))).toBe(100);
        });
    });

    describe("quantizeDraftTokens", () => {
        it("snaps to a coarse step, so nearby values collapse to the same state", () => {
            expect(quantizeDraftTokens(0)).toBe(0);
            expect(quantizeDraftTokens(12)).toBe(0);
            expect(quantizeDraftTokens(13)).toBe(25);
            expect(quantizeDraftTokens(30)).toBe(25);
            expect(quantizeDraftTokens(38)).toBe(50);
            // A keystroke inside a step must not produce a new value (which would re-render).
            expect(quantizeDraftTokens(101)).toBe(quantizeDraftTokens(105));
        });
    });
});
