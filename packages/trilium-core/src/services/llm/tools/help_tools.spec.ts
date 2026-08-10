import { beforeEach, describe, expect, it, vi } from "vitest";

import becca from "../../../becca/becca.js";
import { buildNote } from "../../../test/becca_easy_mocking.js";
import type SearchContext from "../../search/search_context.js";

// The searching itself is the application's, and it wants a database; what belongs to these tools
// is which notes they put in scope and what they make of the results. Those are asserted here, and
// the matching end to end against the shipped guide in `apps/server/spec/in_app_help.spec.ts`.
vi.mock("../../search/services/search.js", () => ({
    default: {
        findResultsWithQuery: (query: string, context: SearchContext) => search(query, context)
    }
}));

import { helpTools } from "./help_tools.js";
import type { ToolDefinition } from "./tool_registry.js";

let search = vi.fn((_query: string, _context: SearchContext) => [] as { noteId: string }[]);

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
        search = vi.fn(() => []);
    });

    describe("search_help", () => {
        it("searches the guide and nothing else, passing the query through as written", () => {
            buildHelpTree();

            getTool("search_help").execute({ query: "multiple locations?" });

            expect(search).toHaveBeenCalledOnce();
            const [ query, context ] = search.mock.calls[0];
            expect(query).toBe("multiple locations?");
            // Naming an ancestor is also what puts the hidden subtree in scope, so the guide is
            // reachable without the search opening up to everything else hidden.
            expect(context.ancestorNoteId).toBe("_help");
            expect(context.includeHiddenNotes).toBe(false);
        });

        it("describes each hit by its title, its place in the guide and a preview of its text", () => {
            buildHelpTree();
            search = vi.fn(() => [ { noteId: "_help_cloning" } ]);

            const result = getTool("search_help").execute({ query: "multiple locations" }) as SearchHelpResult;

            expect(result.totalResults).toBe(1);
            expect(result.results[0]).toMatchObject({
                noteId: "_help_cloning",
                title: "Cloning Notes",
                path: "Basic Concepts > Notes"
            });
            expect(result.results[0].contentPreview).toContain("multiple locations");
        });

        it("reports how many pages matched even when only some are returned", () => {
            buildHelpTree();
            search = vi.fn(() => [ { noteId: "_help_install" }, { noteId: "_help_cloning" } ]);

            const limited = getTool("search_help").execute({ query: "installation", limit: 1 }) as SearchHelpResult;

            expect(limited.totalResults).toBe(2);
            expect(limited.results.map((r) => r.noteId)).toEqual([ "_help_install" ]);
        });

        it("drops a hit whose note has since gone from becca", () => {
            buildHelpTree();
            search = vi.fn(() => [ { noteId: "_help_cloning" }, { noteId: "_help_vanished" } ]);

            const result = getTool("search_help").execute({ query: "anything" }) as SearchHelpResult;

            expect(result.results.map((r) => r.noteId)).toEqual([ "_help_cloning" ]);
        });

        it("returns an error when the help subtree is absent or empty, without searching", () => {
            expect(getTool("search_help").execute({ query: "anything" }))
                .toEqual({ error: "The built-in User Guide is not available in this installation." });

            buildNote({ id: "_help", title: "User Guide", content: "" }); // present but not yet populated
            expect(getTool("search_help").execute({ query: "anything" }))
                .toEqual({ error: "The built-in User Guide is not available in this installation." });

            expect(search).not.toHaveBeenCalled();
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
