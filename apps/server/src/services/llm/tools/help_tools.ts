/**
 * LLM tools for consulting Trilium's built-in User Guide (the in-app help
 * notes under the hidden `_help` subtree). These let the assistant answer
 * "how do I…?" questions about Trilium itself, grounded in the documentation
 * that ships with the running version instead of possibly stale training data.
 *
 * Help pages are `doc` notes: their HTML lives on disk rather than in the
 * database, so Trilium's regular search cannot see their bodies. search_help
 * therefore matches against a lazily built in-memory index of the page texts
 * (~1 MB for the whole guide, loaded once per process).
 */

import { becca, type BNote } from "@triliumnext/core";
import { z } from "zod";

import { getContentPreview, getDocNoteHtml } from "./helpers.js";
import { defineTools } from "./tool_registry.js";

const HELP_ROOT_NOTE_ID = "_help";
const DEFAULT_SEARCH_LIMIT = 10;
/** The User Guide is only a few levels deep; bound traversal defensively. */
const MAX_HELP_DEPTH = 10;
/** A word occurrence in the title outweighs one in the body. */
const TITLE_MATCH_WEIGHT = 10;

export const helpTools = defineTools({
    search_help: {
        description: [
            "Search Trilium's built-in User Guide — the documentation for Trilium itself.",
            "Use this to answer questions about how to use Trilium: features, settings, keyboard shortcuts, sync, scripting, themes, etc.",
            "Full-text keyword search over the help pages; keep queries to a few keywords (e.g. 'keyboard shortcuts', 'protected notes').",
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

            // Strip punctuation (models happily send "cloning?" despite the
            // schema hint) and deduplicate so repeated words don't skew scoring.
            const words = query.toLowerCase()
                .replace(/[^\p{L}\p{N}\s]/gu, " ")
                .split(/\s+/)
                .filter(Boolean)
                .filter((word, index, all) => all.indexOf(word) === index);
            if (words.length === 0) {
                return { error: "Empty search query." };
            }

            const matches = getHelpIndex()
                .map((page) => ({ page, score: scorePage(page, words) }))
                .filter((m) => m.score > 0)
                .sort((a, b) => b.score - a.score);

            const results = matches.slice(0, limit).map(({ page }) => {
                const note = becca.notes[page.noteId];
                if (!note) return null;
                return {
                    noteId: page.noteId,
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

/** One help page in the search index; title and text are lowercased for matching. */
interface HelpPageIndexEntry {
    noteId: string;
    titleLower: string;
    textLower: string;
}

/**
 * Lazily built index of all help pages. The guide only changes on upgrade
 * (which restarts the server), so it is cached for the process lifetime.
 */
let helpIndex: HelpPageIndexEntry[] | null = null;

/** Drop the cached search index (for tests). */
export function resetHelpIndex(): void {
    helpIndex = null;
}

function getHelpIndex(): HelpPageIndexEntry[] {
    if (helpIndex === null) {
        helpIndex = [];
        collectIndexEntries(becca.getNoteOrThrow(HELP_ROOT_NOTE_ID), 0, helpIndex);
    }
    return helpIndex;
}

function collectIndexEntries(note: BNote, depth: number, entries: HelpPageIndexEntry[]): void {
    if (depth >= MAX_HELP_DEPTH) {
        return;
    }
    for (const child of note.getChildNotes()) {
        entries.push({
            noteId: child.noteId,
            titleLower: child.getTitleOrProtected().toLowerCase(),
            textLower: htmlToPlainText(getDocNoteHtml(child) ?? "").toLowerCase()
        });
        collectIndexEntries(child, depth + 1, entries);
    }
}

/**
 * Score a page against the query words: every word must occur in the title or
 * body (AND semantics), title occurrences weigh more than body occurrences.
 * Returns 0 when any word is missing.
 */
function scorePage(page: HelpPageIndexEntry, words: string[]): number {
    let score = 0;
    for (const word of words) {
        const titleHits = countOccurrences(page.titleLower, word);
        const bodyHits = countOccurrences(page.textLower, word);
        if (titleHits + bodyHits === 0) {
            return 0;
        }
        score += titleHits * TITLE_MATCH_WEIGHT + bodyHits;
    }
    return score;
}

function countOccurrences(haystack: string, needle: string): number {
    let count = 0;
    let index = haystack.indexOf(needle);
    while (index !== -1) {
        count++;
        index = haystack.indexOf(needle, index + needle.length);
    }
    return count;
}

/** Crude tag stripping — good enough for keyword matching, not for display. */
function htmlToPlainText(html: string): string {
    return html
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, "\"")
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, "&")
        .replace(/\s+/g, " ");
}

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
