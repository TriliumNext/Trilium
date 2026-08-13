/**
 * LLM tools for consulting Trilium's built-in User Guide (the in-app help
 * notes under the hidden `_help` subtree). These let the assistant answer
 * "how do I…?" questions about Trilium itself, grounded in the documentation
 * that ships with the running version instead of possibly stale training data.
 *
 * The searching itself is the application's own, scoped to the guide. What these add is that they
 * are here to be reached for at all: a tool the assistant can see is what points it at the
 * documentation of the version in front of it.
 */

import { z } from "zod";

import becca from "../../../becca/becca.js";
import type BNote from "../../../becca/entities/bnote.js";
import SearchContext from "../../search/search_context.js";
import searchService from "../../search/services/search.js";
import { getContentPreview } from "./helpers.js";
import { defineTools } from "./tool_registry.js";

const HELP_ROOT_NOTE_ID = "_help";
const DEFAULT_SEARCH_LIMIT = 10;
/** The User Guide is only a few levels deep; bound traversal defensively. */
const MAX_HELP_DEPTH = 10;

export const helpTools = defineTools({
    search_help: {
        description: [
            "Search Trilium's built-in User Guide — the documentation for Trilium itself.",
            "Use this to answer questions about how to use Trilium: features, settings, keyboard shortcuts, sync, scripting, themes, etc.",
            "Takes the same query as search_notes, over the help pages alone; keep it to a few keywords (e.g. 'keyboard shortcuts', 'protected notes').",
            "If a query finds nothing, retry with synonyms or browse get_help_toc — the guide may name the concept differently (e.g. placing a note in two locations is 'cloning').",
            "Read a found page with get_note_content."
        ].join(" "),
        inputSchema: z.object({
            query: z.string().describe("Keyword search query (a few plain words, not a full question)"),
            limit: z.number().int().positive().optional().describe("Maximum number of results to return. Defaults to 10.")
        }),
        execute: ({ query, limit = DEFAULT_SEARCH_LIMIT }) => {
            if (!isHelpAvailable()) {
                return { error: "The built-in User Guide is not available in this installation." };
            }

            // Naming an ancestor is also what lets the guide be found at all: it takes the place
            // of the filter that keeps the hidden subtree out of ordinary results (see
            // `getAncestorExp`), so the pages are in scope without opening up everything else.
            const matches = searchService.findResultsWithQuery(
                query,
                new SearchContext({ ancestorNoteId: HELP_ROOT_NOTE_ID })
            );

            const results = matches.slice(0, limit).map(({ noteId }) => {
                const note = becca.notes[noteId];
                if (!note) return null;
                return {
                    noteId,
                    title: note.getTitleOrProtected(),
                    path: getHelpPath(note),
                    contentPreview: getContentPreview(note)
                };
            }).filter(Boolean);

            return {
                totalResults: matches.length,
                results
            };
        }
    },

    get_help_toc: {
        description: [
            "Get the table of contents of Trilium's built-in User Guide: every help page's title and note ID, hierarchically indented.",
            "Use this when search_help does not find the right page (the guide may name the concept differently than the user), or to get an overview of a documentation area.",
            "Read a page with get_note_content."
        ].join(" "),
        inputSchema: z.object({}),
        execute: () => {
            if (!isHelpAvailable()) {
                return { error: "The built-in User Guide is not available in this installation." };
            }

            const helpRoot = becca.getNoteOrThrow(HELP_ROOT_NOTE_ID);
            const lines: string[] = [];
            collectTocLines(helpRoot, 0, lines);

            return {
                pageCount: lines.length,
                toc: lines.join("\n")
            };
        }
    }
});

/** The help subtree exists only once the in-app help has been imported. */
function isHelpAvailable(): boolean {
    const helpRoot = becca.getNote(HELP_ROOT_NOTE_ID);
    return !!helpRoot && helpRoot.getChildNotes().length > 0;
}

/**
 * Breadcrumb of ancestor titles within the User Guide (excluding the help
 * root and the page itself), e.g. "Basic Concepts > Notes".
 */
function getHelpPath(note: BNote): string {
    const titles: string[] = [];
    let current: BNote | undefined = note.getParentNotes()[0];
    for (let depth = 0; depth < MAX_HELP_DEPTH && current && current.noteId !== HELP_ROOT_NOTE_ID; depth++) {
        titles.unshift(current.getTitleOrProtected());
        current = current.getParentNotes()[0];
    }
    return titles.join(" > ");
}

/** Append one indented `Title (noteId)` line per help page, depth-first. */
function collectTocLines(note: BNote, depth: number, lines: string[]): void {
    if (depth >= MAX_HELP_DEPTH) {
        return;
    }
    for (const child of note.getChildNotes()) {
        lines.push(`${"  ".repeat(depth)}${child.getTitleOrProtected()} (${child.noteId})`);
        collectTocLines(child, depth + 1, lines);
    }
}
