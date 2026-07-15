import type { HighlightAnchor } from "./llm_chat_types.js";

/**
 * Anchoring for chat highlights: turning a live text selection into a durable {@link HighlightAnchor},
 * and resolving a stored anchor back into a DOM {@link Range} at render time.
 *
 * A chat message's text is immutable once its turn completes, so highlights are anchored to that
 * text rather than to the rendered DOM (which the markdown pipeline regenerates on every render).
 * Anchoring works over a *prose projection* of a message: the concatenation of the message's rendered
 * markdown text, skipping non-prose (code blocks, math, diagrams, tool cards, images) so that
 * asynchronously-rendered or opaque content can never shift or corrupt an offset.
 */

/** Only text inside rendered markdown counts as highlightable prose. */
const PROSE_CONTAINER_SELECTOR = ".llm-chat-markdown";
/** Non-prose subtrees skipped within the markdown: code, math (async KaTeX), diagrams. */
const NON_PROSE_SELECTOR = "pre, code, .math-tex, .katex, .ck-math-tex, .mermaid, svg";
/** How much surrounding prose to store as disambiguating context on each side of a highlight. */
const CONTEXT_LENGTH = 24;

/** A run of highlightable prose contributed by a single DOM text node. */
interface ProseSegment {
    node: Text;
    /** Offset of this run's first character within the projection string. */
    start: number;
    length: number;
}

/** The flattened prose of a message plus the mapping back to its DOM text nodes. */
export interface ProseProjection {
    text: string;
    segments: ProseSegment[];
}

/**
 * Build a {@link HighlightAnchor} (minus its id) from a live selection within a message's content
 * root. Returns `null` when the selection is empty or covers no prose (e.g. only a code block or
 * image) — the boundaries are snapped to the nearest prose so a selection that spills into
 * non-prose is clipped rather than rejected outright.
 */
export function createAnchorFromSelection(root: HTMLElement, range: Range): Omit<HighlightAnchor, "id"> | null {
    if (range.collapsed) return null;

    const projection = buildProseProjection(root);
    if (!projection.text) return null;

    const start = boundaryToIndex(projection, range.startContainer, range.startOffset, "start");
    const end = boundaryToIndex(projection, range.endContainer, range.endOffset, "end");
    if (start == null || end == null || end <= start) return null;

    const quotedText = projection.text.slice(start, end);
    if (!quotedText.trim()) return null;

    return {
        start,
        end,
        quotedText,
        prefix: projection.text.slice(Math.max(0, start - CONTEXT_LENGTH), start),
        suffix: projection.text.slice(end, end + CONTEXT_LENGTH)
    };
}

/** The prose root of a rendered message — the element a message's anchors resolve against. */
export function findMessageContentRoot(container: HTMLElement, messageId: string): HTMLElement | null {
    // Match on the parsed dataset value rather than an attribute selector: persisted/imported chats
    // may carry ids with characters that would make a selector invalid and throw.
    for (const el of container.querySelectorAll<HTMLElement>("[data-message-id]")) {
        if (el.dataset.messageId === messageId) return el.querySelector<HTMLElement>(".llm-chat-message-content");
    }
    return null;
}

/** Resolve a stored anchor to a live {@link Range} within `root`, or `null` if it can't be located. */
export function resolveAnchorRange(root: HTMLElement, anchor: HighlightAnchor): Range | null {
    const projection = buildProseProjection(root);
    const indices = resolveAnchorIndices(projection.text, anchor);
    if (!indices) return null;
    return rangeFromProjection(root, projection.segments, indices.start, indices.end);
}

/**
 * Locate an anchor within a message's flattened prose. Pure string logic (no DOM), so the tricky
 * part — surviving render-pipeline drift — is unit-testable in isolation.
 *
 * Fast path: if the stored offsets still frame exactly the quoted text, use them as-is. Otherwise
 * the offsets have drifted (e.g. a KaTeX/markdown upgrade re-rendered an earlier block), so relocate
 * by searching for the quoted text, disambiguating repeats by surrounding context and, as a final
 * tie-breaker, proximity to the original offset. Returns `null` when the text is gone entirely
 * (a regenerated message), so the caller cleanly drops the highlight rather than mis-painting.
 */
export function resolveAnchorIndices(text: string, anchor: HighlightAnchor): { start: number; end: number } | null {
    const { start, end, quotedText, prefix = "", suffix = "" } = anchor;
    if (!quotedText) return null;

    if (start >= 0 && end <= text.length && start < end && text.slice(start, end) === quotedText) {
        return { start, end };
    }

    const matches = findAllOccurrences(text, quotedText);
    if (matches.length === 0) return null;
    if (matches.length === 1) return { start: matches[0], end: matches[0] + quotedText.length };

    let best = matches[0];
    let bestScore = -1;
    for (const match of matches) {
        const score = contextScore(text, match, quotedText.length, prefix, suffix);
        const isBetter = score > bestScore || (score === bestScore && Math.abs(match - start) < Math.abs(best - start));
        if (isBetter) {
            best = match;
            bestScore = score;
        }
    }
    return { start: best, end: best + quotedText.length };
}

/** Concatenate a message content root's prose text, recording where each text node lands. */
export function buildProseProjection(root: HTMLElement): ProseProjection {
    const segments: ProseSegment[] = [];
    let text = "";

    const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const textNode = node as Text;
        if (!isProseTextNode(textNode)) continue;
        segments.push({ node: textNode, start: text.length, length: textNode.data.length });
        text += textNode.data;
    }

    return { text, segments };
}

function isProseTextNode(node: Text): boolean {
    const parent = node.parentElement;
    if (!parent) return false;
    if (!parent.closest(PROSE_CONTAINER_SELECTOR)) return false;
    if (parent.closest(NON_PROSE_SELECTOR)) return false;
    return true;
}

/** Map a DOM selection boundary onto a projection offset, snapping off-prose points to the nearest prose. */
function boundaryToIndex(projection: ProseProjection, node: Node, offset: number, snap: "start" | "end"): number | null {
    const { segments, text } = projection;
    if (segments.length === 0) return null;

    for (const seg of segments) {
        if (seg.node === node) return seg.start + Math.min(offset, seg.length);
    }

    // The boundary sits on an element edge or inside excluded content: snap in document order.
    let prevEnd = 0;
    for (const seg of segments) {
        if (pointCompare(node, offset, seg.node, 0) <= 0) {
            return snap === "start" ? seg.start : prevEnd;
        }
        prevEnd = seg.start + seg.length;
    }
    return snap === "start" ? text.length : prevEnd;
}

/** Build a DOM range spanning projection offsets `[start, end)`. */
function rangeFromProjection(root: HTMLElement, segments: ProseSegment[], start: number, end: number): Range | null {
    const startPoint = locateOffset(segments, start);
    const endPoint = locateOffset(segments, end);
    if (!startPoint || !endPoint) return null;

    const range = root.ownerDocument.createRange();
    range.setStart(startPoint.node, startPoint.offset);
    range.setEnd(endPoint.node, endPoint.offset);
    return range;
}

function locateOffset(segments: ProseSegment[], index: number): { node: Text; offset: number } | null {
    for (const seg of segments) {
        if (index <= seg.start + seg.length) {
            return { node: seg.node, offset: Math.max(0, index - seg.start) };
        }
    }
    const last = segments[segments.length - 1];
    return last ? { node: last.node, offset: last.length } : null;
}

/** Standard comparator (-1 / 0 / +1) for two DOM points, offsets included. */
function pointCompare(aNode: Node, aOffset: number, bNode: Node, bOffset: number): number {
    const range = aNode.ownerDocument?.createRange();
    if (!range) return 0;
    range.setStart(aNode, aOffset);
    // comparePoint returns -1 if b is before the (collapsed-at-a) range, +1 if after.
    const cmp = range.comparePoint(bNode, bOffset);
    return cmp === 0 ? 0 : -cmp;
}

function findAllOccurrences(haystack: string, needle: string): number[] {
    // An empty needle would make indexOf loop forever (it matches at every position). Callers already
    // guard against it, but keep the function self-safe.
    if (!needle) return [];
    const indices: number[] = [];
    for (let from = haystack.indexOf(needle); from !== -1; from = haystack.indexOf(needle, from + 1)) {
        indices.push(from);
    }
    return indices;
}

/** How many characters of stored context still match around a candidate match — higher is a better fit. */
function contextScore(text: string, matchStart: number, matchLength: number, prefix: string, suffix: string): number {
    const before = text.slice(0, matchStart);
    const after = text.slice(matchStart + matchLength);
    return commonSuffixLength(before, prefix) + commonPrefixLength(after, suffix);
}

function commonSuffixLength(a: string, b: string): number {
    let n = 0;
    while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
    return n;
}

function commonPrefixLength(a: string, b: string): number {
    let n = 0;
    while (n < a.length && n < b.length && a[n] === b[n]) n++;
    return n;
}
