import "./ChatMessage.css";
import "../markdown/MarkdownCommons.css";

import { type LlmCitation } from "@triliumnext/commons";
import { memo } from "preact/compat";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";

import { t } from "../../../services/i18n.js";
import utils from "../../../services/utils.js";
import { ExtendedAdmonition } from "../../react/Admonition.js";
import Button from "../../react/Button.js";
import { useResizeObserver } from "../../react/hooks.js";
import LightboxLink from "../../react/LightboxLink.js";
import LoadingSpinner from "../../react/LoadingSpinner.js";
import { ReadOnlyTextContent } from "../text/ReadOnlyText.js";
import { formatErrorDetails } from "./chat_error.js";
import { renderMarkdown } from "./chat_markdown.js";
import { renderQuoteSourceLinks } from "./chat_quote.js";
import { ExpandableCard, ExpandableSection } from "./ExpandableCard.js";
import { type ContentBlock, type FileBlock, getMessageText, type ImageBlock, type StoredMessage, type TextBlock, type TextFileBlock, type ThinkingBlock, type ToolCallBlock } from "./llm_chat_types.js";
import { shortModelName } from "./model_name.js";
import { SafeImage } from "./retry_image.js";
import ToolCallCard from "./ToolCallCard.js";
import { getAttachmentLightbox } from "./useChatAttachments.js";

function shortenNumber(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
    return n.toString();
}

/** Renders markdown content using the shared read-only text pipeline (math, syntax highlighting, mermaid, etc.). */
function MarkdownContent({ html, isStreaming }: { html: string; isStreaming?: boolean }) {
    return (
        <>
            <ReadOnlyTextContent html={html} className="llm-chat-markdown" />
            {isStreaming && <span className="llm-chat-cursor" />}
        </>
    );
}

/**
 * Markdown for one text block, memoized per content string: while a reply streams, each
 * commit re-renders the whole streaming message, but only the smoothed tail block's content
 * actually changes — earlier blocks skip both the re-render and the markdown re-parse.
 */
const TextBlockContent = memo(function TextBlockContent({ content, isStreaming }: { content: string; isStreaming?: boolean }) {
    const html = useMemo(() => renderMarkdown(content), [content]);
    return <MarkdownContent html={html} isStreaming={isStreaming} />;
});

interface Props {
    message: StoredMessage;
    isStreaming?: boolean;
    /** When set on an error message, renders a Retry button that re-runs the failed turn. */
    onRetry?: () => void;
}

type ContentGroup =
    | { type: "text"; block: TextBlock; index: number }
    | { type: "thinking"; block: ThinkingBlock; index: number }
    | { type: "tool_calls"; blocks: ToolCallBlock[]; index: number }
    | { type: "image"; block: ImageBlock; index: number }
    | { type: "file"; block: FileBlock; index: number }
    | { type: "text_file"; block: TextFileBlock; index: number };

/** Extract domain + TLD from a hostname (e.g. "www.example.co.uk" → "example.co.uk"). */
function extractDomain(hostname: string): string {
    return hostname.replace(/^www\./, "");
}

function getUniqueSiteCount(citations: LlmCitation[]): number {
    const domains = new Set<string>();
    for (const c of citations) {
        if (c.url) {
            try {
                domains.add(extractDomain(new URL(c.url).hostname));
            } catch { /* ignore invalid URLs */ }
        }
    }
    return domains.size;
}

function CitationsSection({ citations }: { citations: LlmCitation[] }) {
    const siteCount = getUniqueSiteCount(citations);
    const summary = t("llm_chat.sources_summary", { count: citations.length, sites: siteCount });

    return (
        <ExpandableCard className="llm-chat-citations-card">
            <ExpandableSection icon="bx bx-link" label={summary}>
                <table className="llm-chat-citations-list">
                    <tbody>
                        {citations.map((citation, idx) => {
                            const title = citation.title || citation.citedText?.slice(0, 80) || `Source ${idx + 1}`;
                            let domain: string | null = null;
                            if (citation.url) {
                                try {
                                    domain = extractDomain(new URL(citation.url).hostname);
                                } catch { /* ignore */ }
                            }

                            return (
                                <tr key={idx}>
                                    <td className="llm-chat-citation-title">
                                        {citation.url ? (
                                            <a href={citation.url} target="_blank" rel="noopener noreferrer" title={title}>
                                                {title}
                                            </a>
                                        ) : (
                                            <span>{title}</span>
                                        )}
                                    </td>
                                    {domain && (
                                        <td className="llm-chat-citation-site">{domain}</td>
                                    )}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </ExpandableSection>
        </ExpandableCard>
    );
}

/**
 * One stretch of the model's reasoning. A finished one folds to a single muted line: its leading
 * `**Title**` (the shape of Codex's reasoning summaries), or else its first line, which the body
 * then leaves out. The one being generated stays open in full under a spinner and its latest title.
 */
function ThinkingCard({ content, isLive }: { content: string; isLive?: boolean }) {
    if (isLive) {
        return (
            <div className="expandable-line llm-chat-thinking llm-chat-thinking-live">
                <div className="expandable-line-header">
                    <LoadingSpinner />
                    <span className="llm-chat-thinking-title">{latestThinkingTitle(content) ?? t("llm_chat.thinking")}</span>
                </div>
                <div className="expandable-line-body llm-chat-thinking-content">
                    <TextBlockContent content={content} />
                </div>
            </div>
        );
    }

    const { label, body } = splitThinkingLabel(content);
    if (!body) {
        return <ThinkingLine label={label || t("llm_chat.thought_process")} />;
    }

    return (
        <ExpandableSection variant="line" className="llm-chat-thinking" icon="bx bx-brain" label={label || t("llm_chat.thought_process")}>
            <div className="llm-chat-thinking-content">
                <TextBlockContent content={body} />
            </div>
        </ExpandableSection>
    );
}

/**
 * A finished thought with nothing under its label. It opens, letting the label wrap, only when the
 * label is cut off. The label is measured while closed, since an open one wraps and always fits.
 */
function ThinkingLine({ label }: { label: string }) {
    const labelRef = useRef<HTMLSpanElement>(null);
    const [fits, setFits] = useState(true);
    const measure = useCallback(() => {
        const el = labelRef.current;
        if (el && !el.closest("details")?.open) {
            setFits(el.scrollWidth <= el.clientWidth);
        }
    }, []);
    useLayoutEffect(measure, [label, measure]);
    useResizeObserver(labelRef, measure);

    return (
        <ExpandableSection
            variant="line"
            className={`llm-chat-thinking ${fits ? "llm-chat-thinking-fits" : ""}`}
            icon="bx bx-brain"
            label={<span ref={labelRef} className="llm-chat-thinking-label">{label}</span>}
        />
    );
}

function ChatMessage({ message, isStreaming, onRetry }: Props) {
    const isError = message.type === "error";
    const isThinking = message.type === "thinking";
    const textContent = typeof message.content === "string" ? message.content : getMessageText(message.content);

    // Render markdown for plain-string content (assistant legacy content and user prompts).
    // User prompts may contain `[Title](#root/noteId)` reference links produced by the
    // chat input's @-mention feature, which markdown renders as proper clickable links.
    // A submitted quote's attribution line is rewritten (before rendering) into a "Show quote source"
    // jump link back to the quoted message — user messages only, where quotes live.
    const renderedContent = useMemo(() => {
        if (!isThinking && typeof message.content === "string") {
            const source = message.role === "user"
                ? renderQuoteSourceLinks(message.content, t("llm_chat.show_quote_source"))
                : message.content;
            return renderMarkdown(source);
        }
        return null;
    }, [message.content, isThinking, message.role]);

    const messageClasses = [
        "llm-chat-message",
        `llm-chat-message-${message.role}`,
        isThinking && "llm-chat-message-thinking"
    ].filter(Boolean).join(" ");

    // Chats saved before reasoning moved into the reply hold it as a message of its own.
    if (isThinking) {
        return (
            <div className="llm-chat-message-wrapper llm-chat-message-wrapper-assistant">
                <ThinkingCard content={textContent} />
            </div>
        );
    }

    // Render error messages as a "caution" extended admonition: the header classifies the
    // failure (an HTTP status when the provider answered) so the message below it can be
    // just what went wrong, with the endpoint and raw response body folded into "details".
    if (isError) {
        const status = message.errorDetails?.statusCode;
        const details = formatErrorDetails(textContent, message.errorDetails);
        return (
            <div className="llm-chat-message-wrapper llm-chat-message-wrapper-assistant">
                <ExtendedAdmonition
                    type="caution"
                    icon="bx bx-error-circle"
                    title={status ? t("llm_chat.error_api", { status }) : t("llm_chat.error")}
                    className="llm-chat-error"
                    detailsLabel={t("llm_chat.error_show_details")}
                    details={details && <pre className="llm-chat-error-details">{details}</pre>}
                >
                    <div className="llm-chat-error-text">{textContent}</div>
                    {onRetry && (
                        <div className="llm-chat-error-actions">
                            <Button
                                text={t("llm_chat.retry")}
                                icon="bx-revision"
                                size="small"
                                onClick={onRetry}
                            />
                        </div>
                    )}
                </ExtendedAdmonition>
            </div>
        );
    }

    const hasBlockContent = Array.isArray(message.content);

    return (
        <div className={`llm-chat-message-wrapper llm-chat-message-wrapper-${message.role}`} data-message-role={message.role} data-message-id={message.id}>
            <div className={messageClasses}>
                <div className="llm-chat-message-content">
                    {hasBlockContent ? (
                        renderContentBlocks(message.content as ContentBlock[], isStreaming)
                    ) : (
                        <MarkdownContent html={renderedContent || ""} isStreaming={isStreaming && message.role === "assistant"} />
                    )}
                </div>
                {message.citations && message.citations.length > 0 && (
                    <CitationsSection citations={message.citations} />
                )}
            </div>
            <div className={`llm-chat-footer llm-chat-footer-${message.role}`}>
                <span
                    className="llm-chat-footer-time"
                    title={utils.formatDateTime(new Date(message.createdAt))}
                >
                    {utils.formatTime(new Date(message.createdAt))}
                </span>
                {message.usage?.model && (
                    <span className="llm-chat-usage-model" title={message.usage.model}>
                        {shortModelName(message.usage.model, message.usage.provider)}
                    </span>
                )}
                {message.usage && typeof message.usage.promptTokens === "number" && (
                    <>
                        <span
                            className="llm-chat-usage-tokens"
                            title={t("llm_chat.tokens_detail", {
                                prompt: message.usage.promptTokens.toLocaleString(),
                                completion: (message.usage.completionTokens ?? 0).toLocaleString()
                            })}
                        >
                            {t("llm_chat.total_tokens", { total: shortenNumber(message.usage.totalTokens ?? message.usage.promptTokens) })}
                        </span>
                        {message.usage.cost != null && (
                            <span className="llm-chat-usage-cost">~${message.usage.cost.toFixed(2)}</span>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}

// Memoized: the message list re-renders on every chat state change (streaming updates arrive at
// animation-frame rate), so without this every message reconciles per update — sluggish on long
// chats. Props are stable across those renders (same `message` object, `isStreaming` false, stable
// `onRetry`), so completed messages are skipped; the streaming placeholder uses a fresh object each
// render, so it still updates.
export default memo(ChatMessage);

/** Group content blocks so that consecutive tool_calls are merged into one entry. */
function groupContentBlocks(blocks: ContentBlock[]): ContentGroup[] {
    const groups: ContentGroup[] = [];

    for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        if (block.type === "tool_call") {
            const last = groups[groups.length - 1];
            if (last?.type === "tool_calls") {
                last.blocks.push(block);
            } else {
                groups.push({ type: "tool_calls", blocks: [block], index: i });
            }
        } else if (block.type === "thinking") {
            groups.push({ type: "thinking", block, index: i });
        } else if (block.type === "image") {
            groups.push({ type: "image", block, index: i });
        } else if (block.type === "file") {
            groups.push({ type: "file", block, index: i });
        } else if (block.type === "text_file") {
            groups.push({ type: "text_file", block, index: i });
        } else {
            groups.push({ type: "text", block, index: i });
        }
    }

    return groups;
}

function renderContentBlocks(blocks: ContentBlock[], isStreaming?: boolean) {
    const groups = groupContentBlocks(blocks);
    const lastStep = groups.findLastIndex(group => group.type === "thinking" || group.type === "tool_calls");
    const reply = lastStep >= 0 && groups[lastStep + 1]?.type === "text" ? groups[lastStep + 1] : undefined;

    return groups.map((group) => {
        const isLastBlock = group.index === blocks.length - 1;
        if (group.type === "text") {
            return (
                <div key={group.index} className={group === reply ? "llm-chat-reply" : undefined}>
                    <TextBlockContent content={group.block.content} isStreaming={isStreaming && isLastBlock} />
                </div>
            );
        }

        if (group.type === "thinking") {
            return <ThinkingCard key={group.index} content={group.block.content} isLive={isStreaming && isLastBlock} />;
        }

        if (group.type === "image") {
            return (
                <LightboxLink
                    key={group.index}
                    lightbox={{ src: group.block.url, title: group.block.title }}
                    className="llm-chat-message-image"
                >
                    <SafeImage src={group.block.url} alt={group.block.title} />
                </LightboxLink>
            );
        }

        if (group.type === "file" || group.type === "text_file") {
            const icon = group.type === "file" ? "bxs-file-pdf" : "bxs-file-blank";
            const lightbox = getAttachmentLightbox(group.block);
            const content = <>
                <span className={`bx ${icon}`} />
                <span className="llm-chat-message-file-name">{group.block.title}</span>
            </>;

            return lightbox ? (
                <LightboxLink
                    key={group.index}
                    lightbox={lightbox}
                    href={group.block.url}
                    className="llm-chat-message-file"
                >
                    {content}
                </LightboxLink>
            ) : (
                <a
                    key={group.index}
                    href={group.block.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="llm-chat-message-file"
                    title={group.block.title}
                >
                    {content}
                </a>
            );
        }

        return <ToolCallCard key={group.index} toolCalls={group.blocks.map((b) => b.toolCall)} />;
    });
}

/** Matches a line that is only bold text, the title Codex puts on each reasoning summary. */
const THINKING_TITLE_LINE = /^\*\*([^*\n]+)\*\*[ \t]*$/gm;

/**
 * Split off the line that names a folded thought: its leading `**Title**`, or else its first line
 * without inline Markdown marks. The body is the rest, so the opened thought does not repeat it.
 */
function splitThinkingLabel(content: string): { label: string; body: string } {
    const trimmed = content.trim();
    const title = /^\*\*([^*\n]+)\*\*[ \t]*(?:\n|$)/.exec(trimmed);
    const firstLine = title?.[0] ?? trimmed.split("\n", 1)[0];
    const label = title?.[1] ?? firstLine.replace(/\*\*|`/g, "");
    return { label: label.trim(), body: trimmed.slice(firstLine.length).trim() };
}

/** The last `**Title**` line of a thought, naming what the model is working on now. */
function latestThinkingTitle(content: string): string | undefined {
    return [...content.matchAll(THINKING_TITLE_LINE)].at(-1)?.[1].trim();
}
