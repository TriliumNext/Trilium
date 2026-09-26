import "./ToolCallViews.css";

import type { ComponentChildren } from "preact";
import { Trans } from "react-i18next";

import { isAutoLinkAttribute } from "../../../entities/fattribute.js";
import { formatValue } from "../../../services/attribute_renderer.js";
import { t } from "../../../services/i18n.js";
import { NOTE_TYPES } from "../../../services/note_types.js";
import { openInAppHelpFromUrl } from "../../../services/utils.js";
import CodeBlock from "../../react/CodeBlock.js";
import { useNote } from "../../react/hooks.js";
import { NewNoteLink } from "../../react/NoteLink.js";
import { ReadOnlyTextContent } from "../text/ReadOnlyText.js";
import { renderMarkdown } from "./chat_markdown.js";
import { isFailedToolCall, type ToolCall } from "./llm_chat_types.js";

const HELP_NOTE_PREFIX = "_help_";
const CONTENT_PREVIEW_SOURCE_LENGTH = 1000;
const SVG_MIME = "image/svg+xml";

/** What a finished call shows: a short summary beside its label, and the view it folds open to. */
export interface ToolCallView {
    /** Shown on the summary line before the note link, such as the title a rename replaced. */
    lead?: ComponentChildren;
    summary?: string;
    body?: ComponentChildren;
}

/** The view of a successful call to a tool that has one, or `null` to show the bare line. */
export function getToolCallView(toolCall: ToolCall): ToolCallView | null {
    if (isFailedToolCall(toolCall)) return null;

    // What a writing tool writes is in its input, so it shows before the result arrives.
    if (toolCall.toolName === "create_note") {
        const { type, mime, content } = toolCall.input;
        if (typeof type !== "string" || typeof content !== "string") return null;
        const body = <WrittenContent type={type} mime={typeof mime === "string" ? mime : undefined} content={content} />;
        return hasWrittenContentView(type, typeof mime === "string" ? mime : undefined, content) ? { body } : null;
    }

    if (toolCall.toolName === "set_note_content" || toolCall.toolName === "append_to_note") {
        const { noteId, content, type, mime } = toolCall.input;
        if (typeof noteId !== "string" || typeof content !== "string" || !content.trim()) return null;
        return { body: (
            <NoteWrittenContent
                noteId={noteId} content={content} appended={toolCall.toolName === "append_to_note"}
                type={typeof type === "string" ? type : undefined} mime={typeof mime === "string" ? mime : undefined}
            />
        ) };
    }

    if (!toolCall.result) return null;

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
        case "rename_note": {
            // The note link shows the note's title now, so the one it replaced comes from the result.
            const oldTitle = parseStringField(toolCall.result, "oldTitle");
            return oldTitle ? { lead: <span className="llm-chat-tool-call-old-title">{oldTitle}</span> } : null;
        }
        case "get_note": {
            const meta = parseNoteMeta(toolCall.result);
            return meta ? { body: <NoteMetaCard {...meta} /> } : null;
        }
        case "get_note_content": {
            const content = parseStringField(toolCall.result, "content");
            // A preview shows two lines, so the start of a long note is enough to flatten.
            const preview = content ? markdownToPlainPreview(content.slice(0, CONTENT_PREVIEW_SOURCE_LENGTH)) : "";
            return preview ? { body: <div className="llm-chat-note-card"><div className="llm-chat-note-result-preview">{preview}</div></div> } : null;
        }
        case "get_subtree": {
            const nodes = parseSubtreeResult(toolCall.result);
            if (!nodes) return null;
            return {
                summary: t("llm_chat.search_notes_count", { count: countSubtreeNotes(nodes) }),
                body: nodes.length > 0 ? <div className="llm-chat-note-results llm-chat-subtree"><SubtreeList nodes={nodes} /></div> : undefined
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

/** A level of a `get_subtree` result; `children` of a note are the next level, nested in its row. */
function SubtreeList({ nodes }: { nodes: SubtreeNode[] }) {
    return (
        <ul>
            {nodes.map((node, idx) => ("more" in node ? (
                <li key={idx} className="llm-chat-note-results-more">{t("llm_chat.subtree_more", { count: node.more })}</li>
            ) : (
                <NoteResultRow
                    key={idx}
                    noteId={node.noteId}
                    nested={node.children.length > 0 && <SubtreeList nodes={node.children} />}
                >
                    {node.hiddenChildren > 0 && (
                        <span className="llm-chat-note-result-detail">
                            {t("llm_chat.child_count", { count: node.hiddenChildren })}
                        </span>
                    )}
                </NoteResultRow>
            )))}
        </ul>
    );
}

/** One note in a list a tool returned: its link, muted details beside it, and a preview below. */
function NoteResultRow({ noteId, preview, nested, onLinkClick, children }: {
    noteId: string;
    preview?: string;
    /** A list nested under the row, such as the next level of a subtree. */
    nested?: ComponentChildren;
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
            {nested}
        </li>
    );
}

/**
 * The content a tool wrote into a note, shown the way its type reads: text as rendered Markdown, code
 * and diagrams as a code block, a web view as its URL, an SVG as an image. JSON types (canvas, mind
 * map) have no view. The SVG loads through an `<img>`, which runs none of its scripts.
 */
function WrittenContent({ type, mime, content, appended }: { type: string; mime?: string; content: string; appended?: boolean }) {
    const noteType = type !== "text" && findNoteType(type, mime);
    return (
        <div className="llm-chat-note-card">
            {noteType && <div className="llm-chat-note-card-facts">{noteType.title}</div>}
            <div className={`llm-chat-written ${appended ? "llm-chat-written-appended" : ""}`}>
                {type === "text" && <ReadOnlyTextContent html={renderMarkdown(content)} className="llm-chat-markdown" />}
                {type === "code" && <CodeBlock code={content} mimeType={mime} wrap />}
                {type === "mermaid" && <CodeBlock code={content} mimeType="text/mermaid" wrap />}
                {type === "search" && <CodeBlock code={content} wrap />}
                {type === "webView" && (
                    <a className="tn-link external" href={content} target="_blank" rel="noopener noreferrer">{content}</a>
                )}
                {type === "image" && (
                    <img className="llm-chat-written-svg" src={`data:${SVG_MIME};charset=utf-8,${encodeURIComponent(content)}`} alt="" />
                )}
            </div>
        </div>
    );
}

/**
 * The content `set_note_content` or `append_to_note` wrote. The type and mime come from the input
 * when `set_note_content` changes them, otherwise from the note, so nothing shows until froca has it.
 */
function NoteWrittenContent({ noteId, content, appended, type, mime }: {
    noteId: string;
    content: string;
    appended: boolean;
    type?: string;
    mime?: string;
}) {
    const note = useNote(noteId);
    if (!note) return null;
    const writtenType = type ?? note.type;
    const writtenMime = mime ?? (writtenType === note.type ? note.mime : undefined);
    if (!hasWrittenContentView(writtenType, writtenMime, content, appended)) return null;
    return <WrittenContent type={writtenType} mime={writtenMime} content={content} appended={appended} />;
}

/**
 * An image the LLM writes is always an SVG, so one without a mime is too. Markup appended to an SVG
 * has no picture of its own.
 */
function hasWrittenContentView(type: string, mime: string | undefined, content: string, appended = false): boolean {
    if (!content.trim()) return false;
    if (type === "webView") return /^https?:\/\//i.test(content.trim());
    if (type === "image") return !appended && (mime ?? SVG_MIME) === SVG_MIME;
    return [ "text", "code", "mermaid", "search" ].includes(type);
}

function findNoteType(type: string, mime?: string) {
    return NOTE_TYPES.find((nt) => nt.type === type && nt.mime === mime) ?? NOTE_TYPES.find((nt) => nt.type === type);
}

/** A capped list in a `get_note` result: `totalCount` counts past the entries it lists. */
interface CappedList<T> {
    totalCount: number;
    results: T[];
}

interface NoteMetaAttribute {
    type: string;
    name: string;
    value: string;
}

interface NoteMeta {
    type: string;
    mime?: string;
    childCount: number;
    attachmentCount: number;
    attributes: CappedList<NoteMetaAttribute>;
    contentPreview?: string | null;
}

/** What a `get_note` call learned about the note its summary line links. */
function NoteMetaCard({ type, mime, childCount, attachmentCount, attributes, contentPreview }: NoteMeta) {
    const noteType = findNoteType(type, mime);
    const facts = [
        noteType?.title ?? type,
        childCount > 0 && t("llm_chat.child_count", { count: childCount }),
        attachmentCount > 0 && t("llm_chat.attachment_count", { count: attachmentCount })
    ].filter(Boolean);
    const shown = attributes.results.filter(({ type, name }) => !isAutoLinkAttribute(type, name));
    const hiddenAttributes = attributes.totalCount - attributes.results.length;
    const preview = contentPreview ? markdownToPlainPreview(contentPreview) : "";

    return (
        <div className="llm-chat-note-card">
            <div className="llm-chat-note-card-facts">{facts.join(" · ")}</div>
            {(shown.length > 0 || hiddenAttributes > 0) && (
                <div className="llm-chat-note-card-attributes">
                    {shown.map((attribute, idx) => <AttributePill key={idx} {...attribute} />)}
                    {hiddenAttributes > 0 && (
                        <span className="llm-chat-note-results-more">{t("llm_chat.subtree_more", { count: hiddenAttributes })}</span>
                    )}
                </div>
            )}
            {preview && <div className="llm-chat-note-result-preview">{preview}</div>}
        </div>
    );
}

/**
 * A label or relation as the model read it, written the way `attribute_renderer` writes the attribute
 * bar's. It draws from the result rather than froca, which holds the attribute as it is now.
 */
function AttributePill({ type, name, value }: NoteMetaAttribute) {
    if (type === "relation") {
        return (
            <span className="llm-chat-attribute">
                ~{name}={value && <NewNoteLink notePath={value} showNoteIcon />}
            </span>
        );
    }
    return <span className="llm-chat-attribute">#{name}{value && `=${formatValue(value)}`}</span>;
}

function parseNoteMeta(result: string): NoteMeta | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(result);
    } catch {
        return null;
    }
    if (!isRecord(parsed) || typeof parsed.noteId !== "string" || typeof parsed.type !== "string") return null;

    const attributes = parseCappedList(parsed.attributes);
    return {
        type: parsed.type,
        mime: typeof parsed.mime === "string" ? parsed.mime : undefined,
        childCount: parseCappedList(parsed.childNotes).totalCount,
        attachmentCount: parseCappedList(parsed.attachments).totalCount,
        attributes: {
            totalCount: attributes.totalCount,
            results: attributes.results.filter((item): item is NoteMetaAttribute =>
                isRecord(item) && typeof item.type === "string" && typeof item.name === "string" && typeof item.value === "string")
        },
        contentPreview: typeof parsed.contentPreview === "string" ? parsed.contentPreview : null
    };
}

/** A string field of a JSON object result, or `null` when the result has no such field. */
function parseStringField(result: string, field: string): string | null {
    try {
        const parsed: unknown = JSON.parse(result);
        return isRecord(parsed) && typeof parsed[field] === "string" ? parsed[field] : null;
    } catch {
        return null;
    }
}

function parseCappedList(value: unknown): CappedList<unknown> {
    if (!isRecord(value) || !Array.isArray(value.results)) return { totalCount: 0, results: [] };
    return {
        totalCount: typeof value.totalCount === "number" ? value.totalCount : value.results.length,
        results: value.results
    };
}

/**
 * A note of a `get_subtree` result, or the marker that stands for the children past the ten a level
 * lists. `hiddenChildren` counts the children past the depth limit.
 */
type SubtreeNode = { noteId: string; children: SubtreeNode[]; hiddenChildren: number } | { more: number };

/**
 * Reads the root's children out of a `get_subtree` result. The tool reports what it left out in
 * English for the model ("... and 3 more", "5 children not shown"), so the counts are read out of
 * that text.
 */
function parseSubtreeResult(result: string): SubtreeNode[] | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(result);
    } catch {
        return null;
    }
    if (!isRecord(parsed) || typeof parsed.noteId !== "string") return null;
    return Array.isArray(parsed.children) ? parseSubtreeLevel(parsed.children) : [];
}

function parseSubtreeLevel(items: unknown[]): SubtreeNode[] {
    const nodes: SubtreeNode[] = [];
    for (const item of items) {
        if (!isRecord(item) || typeof item.noteId !== "string") continue;
        if (!item.noteId) {
            const more = firstNumber(item.title);
            if (more) nodes.push({ more });
            continue;
        }
        nodes.push({
            noteId: item.noteId,
            children: Array.isArray(item.children) ? parseSubtreeLevel(item.children) : [],
            hiddenChildren: firstNumber(item.children)
        });
    }
    return nodes;
}

function countSubtreeNotes(nodes: SubtreeNode[]): number {
    let count = 0;
    for (const node of nodes) {
        if ("noteId" in node) count += 1 + countSubtreeNotes(node.children);
    }
    return count;
}

function firstNumber(text: unknown): number {
    const match = typeof text === "string" ? /\d+/.exec(text) : null;
    return match ? Number(match[0]) : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
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

    // The Markdown export keeps what it cannot express (reference links, `<kbd>`, icon spans) as
    // HTML. Entities are decoded last, so an escaped `&lt;b&gt;` stays text.
    return markdown
        .replace(/<\/?[a-z][^>]*>/gi, "")
        .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/^\s*\|?[\s:|-]+\|?\s*$/gm, "")
        .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
        .replace(/\*\*|__|~~|`|\|/g, "")
        .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, decodeEntity)
        .replace(/\s+/g, " ")
        .trim();
}

const NAMED_ENTITIES: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'" };

function decodeEntity(entity: string, name: string): string {
    if (name.startsWith("#")) {
        const codePoint = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
        return codePoint <= 0x10FFFF ? String.fromCodePoint(codePoint) : entity;
    }
    return NAMED_ENTITIES[name.toLowerCase()] ?? entity;
}
