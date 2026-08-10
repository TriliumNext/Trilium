import { beforeEach, describe, expect, it } from "vitest";

import becca from "../../../becca/becca.js";
import { buildNote } from "../../../test/becca_easy_mocking.js";
import { helpTools, resetHelpIndex } from "./help_tools.js";
import type { ToolDefinition } from "./tool_registry.js";

function getTool(name: string): ToolDefinition {
    for (const [n, def] of helpTools) {
        if (n === name) return def;
    }
    throw new Error(`Tool ${name} not registered`);
}

/** A miniature `_help` subtree: root → section → page. */
function buildHelpTree() {
    buildNote({
        id: "_help",
        title: "User Guide",
        content: "",
        children: [
            {
                id: "_help_basics",
                title: "Basic Concepts",
                content: "",
                children: [
                    {
                        id: "_help_notes",
                        title: "Notes",
                        content: "",
                        children: [
                            {
                                id: "_help_cloning",
                                title: "Cloning Notes",
                                type: "text",
                                content: "<p>A note can be placed in multiple locations. Prefix &amp; installation hints.</p>"
                            }
                        ]
                    }
                ]
            },
            { id: "_help_install", title: "Installation & Setup", type: "text", content: "<p>Download the desktop app.</p>" }
        ]
    });
}

interface SearchHelpResult {
    totalResults: number;
    results: { noteId: string; title: string; path: string; contentPreview: string | null }[];
}

describe("help_tools", () => {
    beforeEach(() => {
        becca.reset();
        resetHelpIndex();
    });

    describe("search_help", () => {
        it("matches page bodies and returns breadcrumb paths", () => {
            buildHelpTree();

            const result = getTool("search_help").execute({ query: "multiple locations" }) as SearchHelpResult;

            expect(result.totalResults).toBe(1);
            expect(result.results[0]).toMatchObject({
                noteId: "_help_cloning",
                title: "Cloning Notes",
                path: "Basic Concepts > Notes"
            });
            expect(result.results[0].contentPreview).toContain("multiple locations");
        });

        it("requires every query word (AND semantics)", () => {
            buildHelpTree();

            const result = getTool("search_help").execute({ query: "cloning fnordhotzenplotz" }) as SearchHelpResult;

            expect(result.totalResults).toBe(0);
            expect(result.results).toEqual([]);
        });

        it("ranks title matches above body matches and respects the limit", () => {
            buildHelpTree();
            // "installation" occurs in the Installation page title AND in the Cloning page body.

            const all = getTool("search_help").execute({ query: "installation" }) as SearchHelpResult;
            expect(all.totalResults).toBe(2);
            expect(all.results.map(r => r.noteId)).toEqual(["_help_install", "_help_cloning"]);

            const limited = getTool("search_help").execute({ query: "installation", limit: 1 }) as SearchHelpResult;
            expect(limited.totalResults).toBe(2);
            expect(limited.results).toHaveLength(1);
        });

        it("strips punctuation and deduplicates query words", () => {
            buildHelpTree();

            // "locations?" would never match as-is; repeated words must not double-count.
            const punctuated = getTool("search_help").execute({ query: "multiple locations?" }) as SearchHelpResult;
            expect(punctuated.results.map(r => r.noteId)).toEqual(["_help_cloning"]);

            const deduped = getTool("search_help").execute({ query: "installation installation" }) as SearchHelpResult;
            // Title match still outranks body match — the duplicate word doesn't skew scoring.
            expect(deduped.results.map(r => r.noteId)).toEqual(["_help_install", "_help_cloning"]);
        });

        it("rejects an empty query", () => {
            buildHelpTree();
            expect(getTool("search_help").execute({ query: "   " }))
                .toEqual({ error: "Empty search query." });
            expect(getTool("search_help").execute({ query: "?!" }))
                .toEqual({ error: "Empty search query." });
        });

        it("returns an error when the help subtree is absent or empty", () => {
            expect(getTool("search_help").execute({ query: "anything" }))
                .toEqual({ error: "The built-in User Guide is not available in this installation." });

            buildNote({ id: "_help", title: "User Guide", content: "" }); // present but not yet populated
            expect(getTool("search_help").execute({ query: "anything" }))
                .toEqual({ error: "The built-in User Guide is not available in this installation." });
        });
    });

    describe("get_help_toc", () => {
        it("returns an indented outline of every help page with its noteId", () => {
            buildHelpTree();

            const result = getTool("get_help_toc").execute({}) as { pageCount: number; toc: string };

            expect(result.pageCount).toBe(4);
            expect(result.toc.split("\n")).toEqual([
                "Basic Concepts (_help_basics)",
                "  Notes (_help_notes)",
                "    Cloning Notes (_help_cloning)",
                "Installation & Setup (_help_install)"
            ]);
        });

        it("returns an error when the help subtree is absent", () => {
            expect(getTool("get_help_toc").execute({}))
                .toEqual({ error: "The built-in User Guide is not available in this installation." });
        });
    });
});
