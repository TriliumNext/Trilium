import "./ToolCallViews.css";

import type { ComponentChildren } from "preact";
import { Trans } from "react-i18next";

import { isAutoLinkAttribute } from "../../../entities/fattribute.js";
import { formatValue } from "../../../services/attribute_renderer.js";
import { t } from "../../../services/i18n.js";
import { calculateHash } from "../../../services/link.js";
import { NOTE_TYPES } from "../../../services/note_types.js";
import { formatSize, openInAppHelpFromUrl } from "../../../services/utils.js";
import CodeBlock from "../../react/CodeBlock.js";
import { useNote } from "../../react/hooks.js";
import { TooltipIcon } from "../../react/Icon.js";
import { PageLink } from "../../react/LinkButton.js";
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

    if (toolCall.toolName === "set_attribute") {
        // The result names the attribute as saved, which differs from the input when the tool prefixed it with `disabled:`.
        const saved = toolCall.result ? parseAttribute(parseJson(toolCall.result)) : null;
        const attribute = saved ?? parseAttribute(toolCall.input);
        return attribute ? { lead: <AttributePill {...attribute} /> } : null;
    }

    if (!toolCall.result) return null;

    switch (toolCall.toolName) {
        case "get_attributes": {
            const attributes = parseAttributeList(toolCall.result);
            if (!attributes) return null;
            return {
                summary: t("llm_chat.attribute_count", { count: attributes.length }),
                body: attributes.length > 0
                    ? <div className="llm-chat-note-card"><AttributeRow attributes={attributes} /></div>
                    : undefined
            };
        }
        case "get_attribute":
        case "delete_attribute": {
            const attribute = parseAttribute(parseJson(toolCall.result));
            const deleted = toolCall.toolName === "delete_attribute";
            return attribute ? { lead: <AttributePill {...attribute} deleted={deleted} /> } : null;
        }
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
        case "search_icons": {
            const result = parseIconSearchResult(toolCall.result);
            if (!result) return null;
            const { limit } = toolCall.input;
            return {
                summary: t("llm_chat.search_icons_count", { count: result.totalResults }),
                body: result.icons.length > 0
                    ? <IconSearchResults {...result} limit={typeof limit === "number" ? limit : result.icons.length} />
                    : undefined
            };
        }
        case "get_help_toc": {
            const result = parseJson(toolCall.result);
            if (!isRecord(result) || typeof result.toc !== "string") return null;
            const pages = parseHelpToc(result.toc);
            const count = typeof result.pageCount === "number" ? result.pageCount : pages.length;
            return {
                summary: t("llm_chat.search_help_count", { count }),
                body: pages.length > 0
                    ? <div className="llm-chat-note-results llm-chat-subtree"><HelpTocList pages={pages} /></div>
                    : undefined
            };
        }
        case "web_search": {
            const sources = parseWebSources(toolCall.result);
            if (!sources?.length) return null;
            return {
                summary: t("llm_chat.web_sources_count", { count: sources.length }),
                body: <WebSourceList sources={sources} />
            };
        }
        case "read_web_page": {
            // Some agents report only a status title here, which reads as text all the same.
            if (parseJson(toolCall.result) !== null) return null;
            const preview = markdownToPlainPreview(toolCall.result.slice(0, CONTENT_PREVIEW_SOURCE_LENGTH));
            if (!preview) return null;
            return {
                body: <div className="llm-chat-note-card"><div className="llm-chat-note-result-preview">{preview}</div></div>
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
        case "get_attachment": {
            // The input names only the attachment's ID, so its title and owner come from the result.
            const result = parseJson(toolCall.result);
            if (!isRecord(result) || typeof result.title !== "string" || typeof result.ownerId !== "string") return null;
            const components = {
                Title: <span className="llm-chat-tool-call-attachment-title">{result.title}</span>,
                Note: <NewNoteLink notePath={result.ownerId} showNoteIcon noPreview />
            };
            return {
                lead: (
                    <span className="llm-chat-tool-call-note-ref">
                        <Trans i18nKey="llm.tools.attachment_in_note" components={components as any} />
                    </span>
                ),
                summary: typeof result.contentLength === "number"
                    ? t("llm_chat.attachment_size", { size: formatSize(result.contentLength) })
                    : undefined
            };
        }
        case "get_attachment_content": {
            const content = parseStringField(toolCall.result, "content");
            const preview = content ? markdownToPlainPreview(content.slice(0, CONTENT_PREVIEW_SOURCE_LENGTH)) : "";
            if (!preview) return null;
            const isOcr = parseStringField(toolCall.result, "source") === "ocr";
            return {
                body: (
                    <div className="llm-chat-note-card">
                        {isOcr && <div className="llm-chat-note-card-facts">{t("llm_chat.attachment_ocr")}</div>}
                        <div className="llm-chat-note-result-preview">{preview}</div>
                    </div>
                )
            };
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

interface IconSearchResult {
    totalResults: number;
    icons: string[];
}

/** The icons a `search_icons` call found, drawn rather than named, with each class as its tooltip. */
function IconSearchResults({ totalResults, icons, limit }: IconSearchResult & { limit: number }) {
    return (
        <div className="llm-chat-icon-results">
            <div className="llm-chat-icon-grid">
                {icons.map((iconClass) => <TooltipIcon key={iconClass} icon={iconClass} tooltip={iconClass} />)}
            </div>
            {totalResults > icons.length && (
                <div className="llm-chat-note-results-more">
                    {t("llm_chat.search_notes_limited", { count: totalResults, limit })}
                </div>
            )}
        </div>
    );
}

function parseIconSearchResult(result: string): IconSearchResult | null {
    const parsed = parseJson(result);
    if (!isRecord(parsed) || typeof parsed.totalResults !== "number" || !Array.isArray(parsed.results)) return null;
    const icons = parsed.results
        .map((item) => (isRecord(item) && typeof item.iconClass === "string" ? item.iconClass : null))
        .filter((iconClass): iconClass is string => !!iconClass);
    return { totalResults: parsed.totalResults, icons };
}

interface WebSource {
    url: string;
    title: string | null;
}

/** The pages a web search found, each an external link with its site beside it. */
function WebSourceList({ sources }: { sources: WebSource[] }) {
    return (
        <div className="llm-chat-note-results">
            <ul>
                {sources.map(({ url, title }, idx) => (
                    <li key={idx} className="llm-chat-note-result">
                        <div className="llm-chat-note-result-header">
                            <ExternalLink url={url}>{title || url}</ExternalLink>
                            <span className="llm-chat-note-result-detail">{hostnameOf(url)}</span>
                        </div>
                    </li>
                ))}
            </ul>
        </div>
    );
}

/**
 * The sources of a `web_search` result, in each provider's shape: Anthropic's array of results,
 * OpenAI's `sources`, or the `Links: [...]` line Claude Code writes into its text. Only web URLs count.
 */
function parseWebSources(result: string): WebSource[] | null {
    let items: unknown = parseJson(result);
    if (isRecord(items)) {
        items = items.sources;
    } else if (items === null) {
        const links = /^Links: (\[.*\])$/m.exec(result);
        items = links ? parseJson(links[1]) : null;
    }
    if (!Array.isArray(items)) return null;
    const sources: WebSource[] = [];
    for (const item of items) {
        if (isRecord(item) && typeof item.url === "string" && /^https?:\/\//i.test(item.url)) {
            sources.push({ url: item.url, title: typeof item.title === "string" ? item.title : null });
        }
    }
    return sources;
}

/** A link to a page outside Trilium, opened in the browser. */
export function ExternalLink({ url, children }: { url: string; children: ComponentChildren }) {
    return <a className="tn-link external" href={url} target="_blank" rel="noopener noreferrer">{children}</a>;
}

function hostnameOf(url: string): string {
    try {
        return new URL(url).hostname;
    } catch {
        return "";
    }
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
                    onClick={onLinkClick && onPlainClick(() => onLinkClick(noteId))}
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
    const preview = contentPreview ? markdownToPlainPreview(contentPreview) : "";

    return (
        <div className="llm-chat-note-card">
            <div className="llm-chat-note-card-facts">{facts.join(" · ")}</div>
            <AttributeRow attributes={attributes.results} hiddenCount={attributes.totalCount - attributes.results.length} />
            {preview && <div className="llm-chat-note-result-preview">{preview}</div>}
        </div>
    );
}

/** A note's attributes as pills, leaving out the ones Trilium keeps for links, as the attribute bar does. */
function AttributeRow({ attributes, hiddenCount = 0 }: { attributes: NoteMetaAttribute[]; hiddenCount?: number }) {
    const shown = attributes.filter(({ type, name }) => !isAutoLinkAttribute(type, name));
    if (shown.length === 0 && hiddenCount <= 0) return null;
    return (
        <div className="llm-chat-note-card-attributes">
            {shown.map((attribute, idx) => <AttributePill key={idx} {...attribute} />)}
            {hiddenCount > 0 && (
                <span className="llm-chat-note-results-more">{t("llm_chat.subtree_more", { count: hiddenCount })}</span>
            )}
        </div>
    );
}

/**
 * A label or relation as the model read it, written the way `attribute_renderer` writes the attribute
 * bar's. It draws from the call rather than froca, which holds the attribute as it is now.
 */
function AttributePill({ type, name, value, deleted }: NoteMetaAttribute & { deleted?: boolean }) {
    const className = `llm-chat-attribute ${deleted ? "llm-chat-attribute-deleted" : ""}`;
    if (type === "relation") {
        return (
            <span className={className}>
                ~{name}={value && <NewNoteLink notePath={value} showNoteIcon />}
            </span>
        );
    }
    return <span className={className}>#{name}{value && `=${formatValue(value)}`}</span>;
}

function parseAttributeList(result: string): NoteMetaAttribute[] | null {
    const parsed = parseJson(result);
    if (!Array.isArray(parsed)) return null;
    return parsed.map(parseAttribute).filter((attribute): attribute is NoteMetaAttribute => !!attribute);
}

function parseJson(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

/** A label or relation out of a tool's input or result, or `null` when it does not describe one. */
function parseAttribute(value: unknown): NoteMetaAttribute | null {
    if (!isRecord(value) || (value.type !== "label" && value.type !== "relation") || typeof value.name !== "string") {
        return null;
    }
    return { type: value.type, name: value.name, value: typeof value.value === "string" ? value.value : "" };
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

/**
 * A link click handler that gives a plain left click to `handle`, and lets a modified or middle click
 * go on to `goToLink()` in `services/link.ts`. `handle` returns whether it took the click.
 */
function onPlainClick(handle: () => boolean) {
    return (e: MouseEvent) => {
        if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
        if (!handle()) return;
        e.preventDefault();
        e.stopPropagation();
    };
}

/** A page of the User Guide contents, with the pages below it. */
interface HelpTocPage {
    noteId: string;
    title: string;
    children: HelpTocPage[];
}

/**
 * The User Guide contents a `get_help_toc` call read. Titles come from the result rather than froca,
 * which would otherwise load every page of the guide for one line.
 */
function HelpTocList({ pages }: { pages: HelpTocPage[] }) {
    return (
        <ul>
            {pages.map((page) => (
                <li key={page.noteId} className="llm-chat-note-result">
                    <div className="llm-chat-note-result-header">
                        <PageLink
                            href={calculateHash({ notePath: page.noteId })}
                            text={page.title}
                            onClick={onPlainClick(() => openAsHelp(page.noteId))}
                        />
                    </div>
                    {page.children.length > 0 && <HelpTocList pages={page.children} />}
                </li>
            ))}
        </ul>
    );
}

/** Reads the `Title (noteId)` lines of a `get_help_toc` result, indented two spaces per level. */
function parseHelpToc(toc: string): HelpTocPage[] {
    const roots: HelpTocPage[] = [];
    const ancestors: HelpTocPage[] = [];
    for (const line of toc.split("\n")) {
        const match = /^( *)(.+) \(([^()\s]+)\)$/.exec(line);
        if (!match) continue;
        const depth = Math.floor(match[1].length / 2);
        const page: HelpTocPage = { noteId: match[3], title: match[2], children: [] };
        ancestors.length = Math.min(depth, ancestors.length);
        const parent = ancestors[ancestors.length - 1];
        (parent ? parent.children : roots).push(page);
        ancestors.push(page);
    }
    return roots;
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
    return stripTags(markdown)
        .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/^\s*\|?[\s:|-]+\|?\s*$/gm, "")
        .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
        .replace(/\*\*|__|~~|`|\|/g, "")
        .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, decodeEntity)
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * Removes HTML tags until none is left, since removing one can join the text around it into another.
 */
function stripTags(html: string): string {
    let previous: string;
    let text = html;
    do {
        previous = text;
        text = text.replace(/<\/?[a-z][^>]*>/gi, "");
    } while (text !== previous);
    return text;
}

const NAMED_ENTITIES: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'" };

function decodeEntity(entity: string, name: string): string {
    if (name.startsWith("#")) {
        const codePoint = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
        return codePoint <= 0x10FFFF ? String.fromCodePoint(codePoint) : entity;
    }
    return NAMED_ENTITIES[name.toLowerCase()] ?? entity;
}
