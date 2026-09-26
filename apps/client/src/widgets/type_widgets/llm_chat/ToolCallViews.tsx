import "./ToolCallViews.css";

import type { ComponentChildren } from "preact";
import { Trans } from "react-i18next";

import { t } from "../../../services/i18n.js";
import { openInAppHelpFromUrl } from "../../../services/utils.js";
import { NewNoteLink } from "../../react/NoteLink.js";
import type { ToolCall } from "./llm_chat_types.js";

const HELP_NOTE_PREFIX = "_help_";

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
        case "search_help": {
            const result = parseSearchNotesResult(toolCall.result);
            if (!result) return null;
            const { limit } = toolCall.input;
            const search: NoteSearch = {
                totalResults: result.totalResults,
                // The guide path stands where a note search shows the parent.
                results: result.results.map(({ noteId, path, contentPreview }) => ({ noteId, parentTitle: path, contentPreview })),
                limit: typeof limit === "number" ? limit : result.results.length,
                isHelp: true
            };
            return {
                summary: t("llm_chat.search_help_count", { count: result.totalResults }),
                body: search.results.length > 0 ? <NoteSearchResults {...search} /> : undefined
            };
        }
        case "get_child_notes": {
            const children = parseChildNotesResult(toolCall.result);
            if (!children) return null;
            return {
                summary: t("llm_chat.child_notes_count", { count: children.length }),
                body: children.length > 0 ? <ChildNoteList notes={children} /> : undefined
            };
        }
        default:
            return null;
    }
}

interface NoteSearchResult {
    noteId: string;
    parentTitle?: string | null;
    /** The chain of User Guide sections above a `search_help` result. */
    path?: string | null;
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
    /** The results are User Guide pages, which open as contextual help. */
    isHelp?: boolean;
}

function NoteSearchResults({ totalResults, results, ancestorNoteId, limit, isHelp }: NoteSearch) {
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
                    {results.map(({ noteId, parentTitle, contentPreview }) => (
                        <NoteResultRow
                            key={noteId}
                            noteId={noteId}
                            preview={contentPreview ? markdownToPlainPreview(contentPreview) : ""}
                            onLinkClick={isHelp ? openAsHelp : undefined}
                        >
                            {parentTitle && (
                                <span className="llm-chat-note-result-parent">
                                    <span className="bx bx-folder" />{parentTitle}
                                </span>
                            )}
                        </NoteResultRow>
                    ))}
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

function ChildNoteList({ notes }: { notes: ChildNote[] }) {
    return (
        <div className="llm-chat-note-results">
            <ul>
                {notes.map(({ noteId, childCount }) => (
                    <NoteResultRow key={noteId} noteId={noteId}>
                        {childCount > 0 && (
                            <span className="llm-chat-note-result-detail">
                                {t("llm_chat.child_count", { count: childCount })}
                            </span>
                        )}
                    </NoteResultRow>
                ))}
            </ul>
        </div>
    );
}

/** One note in a list a tool returned: its link, muted details beside it, and a preview below. */
function NoteResultRow({ noteId, preview, onLinkClick, children }: {
    noteId: string;
    preview?: string;
    /** Takes a plain click on the link. Returns whether it handled the click. */
    onLinkClick?: (noteId: string) => boolean;
    children?: ComponentChildren;
}) {
    return (
        <li className="llm-chat-note-result">
            <div className="llm-chat-note-result-header">
                <NewNoteLink
                    notePath={noteId}
                    showNoteIcon
                    onClick={onLinkClick && ((e) => {
                        // A modified or middle click goes on to `goToLink()` in `services/link.ts`.
                        if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
                        if (!onLinkClick(noteId)) return;
                        e.preventDefault();
                        e.stopPropagation();
                    })}
                />
                {children}
            </div>
            {preview && <div className="llm-chat-note-result-preview">{preview}</div>}
        </li>
    );
}

/** Opens a User Guide page in the contextual help split, as `HelpButton` does. */
function openAsHelp(noteId: string): boolean {
    if (!noteId.startsWith(HELP_NOTE_PREFIX)) return false;
    void openInAppHelpFromUrl(noteId.slice(HELP_NOTE_PREFIX.length));
    return true;
}

interface ChildNote {
    noteId: string;
    childCount: number;
}

function parseChildNotesResult(result: string): ChildNote[] | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(result);
    } catch {
        return null;
    }
    if (!Array.isArray(parsed)) return null;
    return parsed
        .filter((item): item is { noteId: string; childCount?: unknown } =>
            typeof item === "object" && item !== null && typeof item.noteId === "string")
        .map(({ noteId, childCount }) => ({ noteId, childCount: typeof childCount === "number" ? childCount : 0 }));
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
