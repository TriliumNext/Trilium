import "./ToolCallViews.css";

import type { ComponentChildren } from "preact";
import { Trans } from "react-i18next";

import { t } from "../../../services/i18n.js";
import { NewNoteLink } from "../../react/NoteLink.js";
import type { ToolCall } from "./llm_chat_types.js";

/** What a finished call shows: a short summary beside its label, and the view it folds open to. */
export interface ToolCallView {
    summary?: string;
    body?: ComponentChildren;
}

/** The view of a successful call to a tool that has one, or `null` to show the bare line. */
export function getToolCallView(toolCall: ToolCall): ToolCallView | null {
    if (!toolCall.result || toolCall.isError) return null;

    switch (toolCall.toolName) {
        case "search_notes": {
            const result = parseSearchNotesResult(toolCall.result);
            if (!result) return null;
            const { ancestorNoteId, limit } = toolCall.input;
            const search: NoteSearch = {
                ...result,
                // Searching under the root is the same as not narrowing the search at all.
                ancestorNoteId: typeof ancestorNoteId === "string" && ancestorNoteId !== "root" ? ancestorNoteId : undefined,
                limit: typeof limit === "number" ? limit : result.results.length
            };
            return {
                summary: t("llm_chat.search_notes_count", { count: result.totalResults }),
                body: search.results.length > 0 || search.ancestorNoteId ? <NoteSearchResults {...search} /> : undefined
            };
        }
        default:
            return null;
    }
}

interface NoteSearchResult {
    noteId: string;
    parentTitle?: string | null;
    contentPreview?: string | null;
}

interface SearchNotesResult {
    totalResults: number;
    results: NoteSearchResult[];
}

/** A `search_notes` result with the input that shaped it. */
interface NoteSearch extends SearchNotesResult {
    ancestorNoteId?: string;
    limit: number;
}

function NoteSearchResults({ totalResults, results, ancestorNoteId, limit }: NoteSearch) {
    return (
        <div className="llm-chat-note-results">
            {ancestorNoteId && (
                <div className="llm-chat-note-results-scope">
                    <span className="bx bx-subdirectory-right" />
                    <Trans
                        i18nKey="llm_chat.search_notes_scope"
                        components={{ Note: <NewNoteLink notePath={ancestorNoteId} showNoteIcon /> } as any}
                    />
                </div>
            )}
            {results.length > 0 && (
                <ul>
                    {results.map(({ noteId, parentTitle, contentPreview }) => {
                        const preview = contentPreview ? markdownToPlainPreview(contentPreview) : "";
                        return (
                            <li key={noteId} className="llm-chat-note-result">
                                <div className="llm-chat-note-result-header">
                                    <NewNoteLink notePath={noteId} showNoteIcon />
                                    {parentTitle && (
                                        <span className="llm-chat-note-result-parent">
                                            <span className="bx bx-folder" />{parentTitle}
                                        </span>
                                    )}
                                </div>
                                {preview && <div className="llm-chat-note-result-preview">{preview}</div>}
                            </li>
                        );
                    })}
                </ul>
            )}
            {totalResults > results.length && (
                <div className="llm-chat-note-results-more">
                    {t("llm_chat.search_notes_limited", { count: totalResults, limit })}
                </div>
            )}
        </div>
    );
}

function parseSearchNotesResult(result: string): SearchNotesResult | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(result);
    } catch {
        return null;
    }
    if (typeof parsed !== "object" || parsed === null) return null;

    const { totalResults, results } = parsed as Partial<Record<keyof SearchNotesResult, unknown>>;
    if (typeof totalResults !== "number" || !Array.isArray(results)) return null;
    const notes = results.filter((item): item is NoteSearchResult =>
        typeof item === "object" && item !== null && typeof item.noteId === "string");
    return { totalResults, results: notes };
}

/**
 * Flattens the Markdown of `contentPreview` into one line of plain text. The size notice that
 * `getContentPreview()` sends for a large note in place of its text yields an empty string.
 */
export function markdownToPlainPreview(markdown: string): string {
    if (/^\[\d+KB - /.test(markdown)) return "";

    return markdown
        .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/^\s*\|?[\s:|-]+\|?\s*$/gm, "")
        .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
        .replace(/\*\*|__|~~|`|\|/g, "")
        .replace(/\s+/g, " ")
        .trim();
}
