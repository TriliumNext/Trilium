import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import type NoteContext from "../../../components/note_context.js";
import { t } from "../../../services/i18n.js";
import { escapeHtml } from "../../../services/utils.js";
import type { HeadingContext } from "../../sidebar/TableOfContents.js";
import { type ContentBlock, getMessageText, type StoredMessage } from "./llm_chat_types.js";
import type { UseLlmChatReturn } from "./useLlmChat.js";

/** A single entry in the shared table-of-contents widget. */
type RawHeading = HeadingContext["headings"][number];

/** A chat table-of-contents entry, anchored to its rendered element for scrolling and tracking. */
export interface ChatHeading extends RawHeading {
    element: HTMLElement | null;
}

/** How far down the viewport (as a fraction of its height) the "you are here" line sits. */
const ACTIVATION_LINE_FRACTION = 0.3;

/**
 * Pixels a clicked heading is scrolled *past* the activation line, so the scroll-spy counts it as crossed
 * despite sub-pixel scroll snapping (device-pixel rounding can leave it a hair short of the line, lighting
 * up the previous entry). A few pixels beats the snapping while staying well within the heading's section.
 */
const ACTIVATION_LINE_MARGIN_PX = 4;

/**
 * Publishes a table of contents for an AI chat into the note context, so the shared
 * {@link TableOfContents} widget renders it exactly like the text-note and PDF tables of
 * contents. Each user message becomes a level-1 entry (its text truncated to a short
 * preview); headings inside assistant replies nest below it, untruncated, shifted one
 * level down (reply H1 → level 2). Also tracks which entry is currently in view and
 * highlights it as the user scrolls.
 */
export function useChatToc(chat: UseLlmChatReturn, noteContext: NoteContext | undefined) {
    const { messages, scrollContainerRef } = chat;
    const [headings, setHeadings] = useState<ChatHeading[]>([]);
    const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null);

    // Extract from the rendered DOM whenever the message list changes. Effects run after
    // the commit, so the messages (including a just-finalized streaming reply) are in the
    // DOM by now. Streamed-in-progress content is not in `messages` and is ignored.
    useEffect(() => {
        setHeadings(extractChatHeadings(messages, scrollContainerRef.current));
    }, [messages, scrollContainerRef]);

    const scrollToHeading = useCallback((heading: ChatHeading) => {
        const container = scrollContainerRef.current;
        const element = heading.element;
        if (!container || !element?.isConnected) return;
        // Scroll the heading to the activation line the scroll-spy uses to pick the active entry, so
        // clicking a heading leaves *that* heading highlighted. Scrolling it to the top instead would drop
        // the activation line (30% down) into the following section, highlighting the next entry. Same
        // content-space math as `measure()` below; land the heading a few pixels *past* the line so it
        // registers as crossed despite sub-pixel scroll snapping (otherwise it can settle a hair short and
        // the previous entry lights up).
        const contentTop = container.getBoundingClientRect().top - container.scrollTop;
        const headingOffset = element.getBoundingClientRect().top - contentTop;
        const activationOffset = container.clientHeight * ACTIVATION_LINE_FRACTION;
        container.scrollTo({ top: headingOffset - activationOffset + ACTIVATION_LINE_MARGIN_PX, behavior: "smooth" });
    }, [scrollContainerRef]);

    // Scroll-spy: pick the active heading whenever the timeline scrolls or resizes. Heading
    // offsets are measured once per headings change or container resize — never per scroll
    // frame, where per-heading geometry reads would force layout across the whole timeline.
    // Scrolling only reads scrollTop. Offsets can drift when content resizes without
    // resizing the container (e.g. an image loading mid-history); the drift only affects
    // the highlight and heals on the next measure.
    useEffect(() => {
        const container = scrollContainerRef.current;
        if (!container) return;

        // Offsets relative to the scroll content, independent of the scroll position.
        let offsets: HeadingOffset[] = [];
        let activationLine = 0;
        const measure = () => {
            const contentTop = container.getBoundingClientRect().top - container.scrollTop;
            offsets = [];
            for (const heading of headings) {
                if (!heading.element?.isConnected) continue;
                offsets.push({ id: heading.id, top: heading.element.getBoundingClientRect().top - contentTop });
            }
            activationLine = container.clientHeight * ACTIVATION_LINE_FRACTION;
        };

        let rafId: number | null = null;
        let measureNeeded = true;
        const recompute = () => {
            rafId = null;
            if (measureNeeded) {
                measureNeeded = false;
                measure();
            }
            setActiveHeadingId(pickActiveHeadingId(offsets, activationLine + container.scrollTop));
        };
        const schedule = () => {
            if (rafId == null) rafId = requestAnimationFrame(recompute);
        };
        const scheduleMeasure = () => {
            measureNeeded = true;
            schedule();
        };

        recompute();
        container.addEventListener("scroll", schedule, { passive: true });
        const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(scheduleMeasure) : null;
        resizeObserver?.observe(container);

        return () => {
            container.removeEventListener("scroll", schedule);
            resizeObserver?.disconnect();
            if (rafId != null) cancelAnimationFrame(rafId);
        };
    }, [headings, scrollContainerRef]);

    // Publish to the note context so the shared sidebar widget can consume it.
    useEffect(() => {
        noteContext?.setContextData("toc", { headings, scrollToHeading, activeHeadingId });
    }, [noteContext, headings, scrollToHeading, activeHeadingId]);

    // Clear the published data when the chat unmounts, so the sidebar doesn't keep showing a
    // stale table of contents. Kept in its own unmount-only effect: clearing inside the publish
    // effect above would flash the list empty on every update. A ref supplies the latest
    // noteContext without re-running the effect.
    const noteContextRef = useRef(noteContext);
    noteContextRef.current = noteContext;
    useEffect(() => () => noteContextRef.current?.clearContextData("toc"), []);
}

interface HeadingOffset {
    id: string;
    /** The heading's top edge position, in the same coordinate space as the activation line. */
    top: number;
}

/**
 * Map every rendered message element by its id in one pass, so heading extraction stays
 * O(messages) instead of running a full-timeline query per message. The dataset value is
 * compared as parsed rather than interpolated into a CSS selector: persisted or imported
 * chats may carry ids with characters (quotes, backslashes, newlines) that would make an
 * attribute selector invalid and throw.
 */
function buildMessageElementMap(container: HTMLElement | null): Map<string, HTMLElement> {
    const elementById = new Map<string, HTMLElement>();
    if (!container) return elementById;
    for (const el of container.querySelectorAll<HTMLElement>("[data-message-id]")) {
        const id = el.dataset.messageId;
        if (id !== undefined && !elementById.has(id)) {
            elementById.set(id, el);
        }
    }
    return elementById;
}

/** Headings inside an assistant reply's rendered markdown (excludes tool cards, citations, etc.). */
const REPLY_HEADING_SELECTOR = [1, 2, 3, 4, 5, 6].map(n => `.llm-chat-markdown h${n}`).join(", ");

/**
 * Build the table-of-contents entries for a chat: a level-1 entry per user message
 * (truncated preview) and, nested below it, one entry per heading found in the rendered
 * assistant replies — untruncated, exactly like the text-note table of contents. Reply
 * headings are shifted one level down (H1 → 2, H2 → 3, …); if no user message precedes
 * them (e.g. an imported chat), they keep their own level so the hierarchy starts at 1.
 */
export function extractChatHeadings(messages: StoredMessage[], container: HTMLElement | null): ChatHeading[] {
    const elementById = buildMessageElementMap(container);
    const headings: ChatHeading[] = [];
    let hasUserHeading = false;
    for (const message of messages) {
        if (message.type === "error" || message.type === "thinking") continue;

        if (message.role === "user") {
            const preview = truncateForToc(getMessagePreviewText(message.content));
            // The shared widget renders `text` as HTML (via RawHtml), so escape the plain
            // message text so it renders literally and can't inject markup.
            headings.push({
                id: message.id,
                level: 1,
                text: escapeHtml(preview),
                element: elementById.get(message.id) ?? null
            });
            hasUserHeading = true;
        } else if (message.role === "assistant") {
            const messageEl = elementById.get(message.id);
            if (!messageEl) continue;
            const levelOffset = hasUserHeading ? 1 : 0;
            let index = 0;
            for (const headingEl of messageEl.querySelectorAll<HTMLHeadingElement>(REPLY_HEADING_SELECTOR)) {
                headings.push({
                    id: `${message.id}:${index}`,
                    level: parseInt(headingEl.tagName.substring(1), 10) + levelOffset,
                    // Already-rendered, DOMPurify-sanitized HTML — used as-is, untruncated.
                    text: headingEl.innerHTML,
                    element: headingEl
                });
                index++;
            }
        }
    }
    return headings;
}

/** Pick the entry whose section the reader is currently in: the last one scrolled past the activation line. */
export function pickActiveHeadingId(entries: HeadingOffset[], activationLine: number): string | null {
    if (entries.length === 0) return null;
    // Default to the first entry so that when nothing has been scrolled past yet
    // (all messages sit below the line) the top entry is highlighted.
    let active = entries[0].id;
    for (const entry of entries) {
        if (entry.top <= activationLine) active = entry.id;
    }
    return active;
}

/**
 * The text used to preview a user message in the table of contents. Falls back to an
 * attachment's title for messages that carry only an image or file and no prose.
 */
function getMessagePreviewText(content: string | ContentBlock[]): string {
    const text = getMessageText(content);
    if (text.trim()) return text;
    if (Array.isArray(content)) {
        // Attachment-only messages get a localized "File: " prefix so a bare filename in
        // the list isn't mistaken for the message's prose; multiple files are comma-joined.
        const titles: string[] = [];
        for (const block of content) {
            if ((block.type === "image" || block.type === "file" || block.type === "text_file") && block.title) {
                titles.push(block.title);
            }
        }
        if (titles.length > 0) return t("llm_chat.toc_file", { name: titles.join(", ") });
    }
    return "";
}

const ELLIPSIS = "…";

export interface TruncateOptions {
    /** Maximum number of words to keep. */
    maxWords?: number;
    /** Hard cap on the character (grapheme) count of the whole result, ellipsis included. */
    maxChars?: number;
}

/**
 * Produce a short, single-line preview of a chat message for the table of contents.
 *
 * Collapses whitespace, keeps at most `maxWords` words, then hard-caps the result at
 * `maxChars` characters as a defence against a single very long / malformed "word".
 * Word and character boundaries are found with `Intl.Segmenter`, so it behaves correctly
 * across cultures — scripts without spaces (e.g. Chinese, Japanese), combining marks, and
 * multi-code-point emoji — rather than naively splitting on spaces or UTF-16 units.
 */
export function truncateForToc(text: string, { maxWords = 7, maxChars = 128 }: TruncateOptions = {}): string {
    // Collapse every run of whitespace (including newlines) into a single space for a one-line label.
    const normalized = text.replace(/\s+/g, " ").trim();
    if (!normalized) return "";

    const word = truncateToWords(normalized, maxWords);
    // Grapheme-cap the (possibly word-truncated) text. When an ellipsis will be appended,
    // leave room for it so the final string never exceeds `maxChars`.
    let truncated = word.truncated;
    const initialCap = truncateToGraphemes(word.text, maxChars);
    truncated = truncated || initialCap.truncated;
    let result = truncated ? truncateToGraphemes(initialCap.text, maxChars - 1).text : initialCap.text;

    result = result.trimEnd();
    return truncated ? result + ELLIPSIS : result;
}

interface TruncationResult {
    text: string;
    truncated: boolean;
}

function truncateToWords(text: string, maxWords: number): TruncationResult {
    if (maxWords <= 0) return { text: "", truncated: text.length > 0 };

    const segmenter = getSegmenter("word");
    if (!segmenter) {
        // Fallback for environments without Intl.Segmenter: naive whitespace split.
        const parts = text.split(" ");
        if (parts.length <= maxWords) return { text, truncated: false };
        return { text: parts.slice(0, maxWords).join(" "), truncated: true };
    }

    let wordCount = 0;
    let cutIndex = text.length;
    for (const { segment, index, isWordLike } of segmenter.segment(text)) {
        if (!isWordLike) continue;
        wordCount++;
        if (wordCount === maxWords) {
            // Remember where the last kept word ends, dropping any trailing punctuation/space.
            cutIndex = index + segment.length;
        } else if (wordCount > maxWords) {
            return { text: text.slice(0, cutIndex), truncated: true };
        }
    }
    return { text, truncated: false };
}

function truncateToGraphemes(text: string, maxGraphemes: number): TruncationResult {
    if (maxGraphemes <= 0) return { text: "", truncated: text.length > 0 };

    const segmenter = getSegmenter("grapheme");
    if (!segmenter) {
        // Fallback: count code points so surrogate pairs are at least kept intact.
        const codePoints = [...text];
        if (codePoints.length <= maxGraphemes) return { text, truncated: false };
        return { text: codePoints.slice(0, maxGraphemes).join(""), truncated: true };
    }

    let count = 0;
    for (const { index } of segmenter.segment(text)) {
        if (count === maxGraphemes) return { text: text.slice(0, index), truncated: true };
        count++;
    }
    return { text, truncated: false };
}

// `undefined` = not yet attempted, `null` = attempted and unavailable (don't retry).
let wordSegmenter: Intl.Segmenter | null | undefined;
let graphemeSegmenter: Intl.Segmenter | null | undefined;

function getSegmenter(granularity: "word" | "grapheme"): Intl.Segmenter | null {
    if (granularity === "word") {
        if (wordSegmenter === undefined) wordSegmenter = createSegmenter("word");
        return wordSegmenter;
    }
    if (graphemeSegmenter === undefined) graphemeSegmenter = createSegmenter("grapheme");
    return graphemeSegmenter;
}

function createSegmenter(granularity: "word" | "grapheme"): Intl.Segmenter | null {
    // Instantiation can throw in environments with a partial or non-standard Intl
    // implementation; fall back to the naive split rather than crashing. The result
    // (including the null failure) is cached by the caller so this runs at most once.
    if (typeof Intl === "undefined" || typeof Intl.Segmenter === "undefined") return null;
    try {
        return new Intl.Segmenter(undefined, { granularity });
    } catch (e) {
        console.warn("Failed to initialize Intl.Segmenter:", e);
        return null;
    }
}
