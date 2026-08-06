import { describe, expect, it } from "vitest";

import { iconTools, scoreIcon } from "./icon_tools.js";
import type { ToolDefinition } from "./tool_registry.js";

function getTool(name: string): ToolDefinition {
    for (const [n, def] of iconTools) {
        if (n === name) return def;
    }
    throw new Error(`Tool ${name} not registered`);
}

interface SearchResult {
    totalResults: number;
    results: { iconClass: string; terms: string[] }[];
}

describe("icon_tools", () => {
    describe("search_icons", () => {
        it("finds icons by keyword and returns their icon class with terms", () => {
            const result = getTool("search_icons").execute({ query: "rocket" }) as SearchResult;
            expect(result.totalResults).toBeGreaterThanOrEqual(2);
            const rocket = result.results.find((r) => r.iconClass === "bx bx-rocket");
            expect(rocket).toMatchObject({ iconClass: "bx bx-rocket", terms: ["rocket"] });
        });

        it("matches multi-keyword queries against hyphenated terms and ranks them first", () => {
            const result = getTool("search_icons").execute({ query: "check circle" }) as SearchResult;
            expect(result.results[0].iconClass).toMatch(/^bx bxs?-check-circle$/);
        });

        it("respects the limit and reports the full match count", () => {
            const result = getTool("search_icons").execute({ query: "circle", limit: 3 }) as SearchResult;
            expect(result.results).toHaveLength(3);
            expect(result.totalResults).toBeGreaterThan(3);
        });

        it("still matches a descriptive query where no icon carries every keyword", () => {
            const result = getTool("search_icons").execute({ query: "building landmark monument" }) as SearchResult;
            expect(result.totalResults).toBeGreaterThan(0);
            expect(result.results[0].iconClass).toMatch(/building/);
        });

        it("returns no results for an unmatched keyword", () => {
            const result = getTool("search_icons").execute({ query: "xyzzyplugh" }) as SearchResult;
            expect(result).toEqual({ totalResults: 0, results: [] });
        });

        it("rejects an empty or whitespace-only query", () => {
            expect(getTool("search_icons").execute({ query: "" }))
                .toEqual({ error: "Query must not be empty" });
            expect(getTool("search_icons").execute({ query: "   " }))
                .toEqual({ error: "Query must not be empty" });
        });
    });

    describe("scoreIcon", () => {
        it("ranks exact term and segment matches above substring matches and counts keyword coverage", () => {
            // Exact term match.
            expect(scoreIcon("bx-rocket", ["rocket"], ["rocket"])).toEqual({ matched: 1, quality: 2 });
            // Exact hyphen-segment match.
            expect(scoreIcon("bx-check-circle", ["check-circle"], ["circle"])).toEqual({ matched: 1, quality: 2 });
            // Substring-only match scores lower.
            expect(scoreIcon("bx-checkbox", ["checkbox"], ["check"])).toEqual({ matched: 1, quality: 1 });
            // Match on the icon name itself.
            expect(scoreIcon("bx-rocket", ["launch"], ["rocket"])).toEqual({ matched: 1, quality: 1 });
            // An unmatched keyword no longer rejects the icon, it just doesn't count.
            expect(scoreIcon("bx-rocket", ["rocket"], ["rocket", "banana"])).toEqual({ matched: 1, quality: 2 });
            // No keyword matched at all.
            expect(scoreIcon("bx-rocket", ["rocket"], ["banana"])).toEqual({ matched: 0, quality: 0 });
            // Scores accumulate across keywords.
            expect(scoreIcon("bx-check-circle", ["check-circle"], ["check", "circle"])).toEqual({ matched: 2, quality: 4 });
        });
    });
});
