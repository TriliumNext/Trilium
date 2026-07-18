import "./chat_highlights.css";

import { findMessageContentRoot, resolveAnchorRange } from "./chat_highlights_anchor.js";
import type { StoredMessage } from "./llm_chat_types.js";

/**
 * Paints a chat's stored highlights as real markup, for the read-only preview surfaces.
 *
 * The live chat paints highlights with the CSS Custom Highlight API (see {@link useChatHighlights}):
 * they exist only as `Range` objects in a document-global registry, deliberately leaving the
 * Preact-owned message DOM untouched. That makes them invisible to every context that consumes the
 * rendered markup rather than the live document — the note tooltip (which serializes the preview to
 * an HTML string), collection tiles, and printing (where `::highlight()` painting is not reliably
 * rendered anyway).
 *
 * So for previews the same anchors are resolved against the preview's own DOM and wrapped in
 * `<mark class="chat-highlight">` elements, which survive serialization, printing, and sanitization.
 * Idempotent: any previously materialized marks are unwrapped first, so a re-render can't nest them.
 */
export function materializeChatHighlights(container: HTMLElement, messages: StoredMessage[]) {
    clearMaterializedHighlights(container);

    for (const message of messages) {
        if (!message.highlights?.length) continue;

        const root = findMessageContentRoot(container, message.id);
        if (!root) continue;

        for (const anchor of message.highlights) {
            // Resolved one at a time: wrapping splits text nodes, so each anchor re-reads the prose
            // (whose *text* is unchanged by wrapping — a <mark> contributes its own text back).
            const range = resolveAnchorRange(root, anchor);
            // Orphaned (e.g. the message was regenerated) — drop it rather than mis-paint.
            if (!range) continue;
            wrapRangeInMarks(range, anchor.id);
        }
    }
}

export const HIGHLIGHT_MARK_CLASS = "chat-highlight";

/** Unwrap previously materialized marks, restoring the DOM to plain prose. */
function clearMaterializedHighlights(container: HTMLElement) {
    for (const mark of container.querySelectorAll<HTMLElement>(`mark.${HIGHLIGHT_MARK_CLASS}`)) {
        const parent = mark.parentNode;
        if (!parent) continue;
        mark.replaceWith(...mark.childNodes);
        // Re-merge the text nodes the original wrap split apart, so offsets resolve over whole runs.
        parent.normalize();
    }
}

/**
 * Wrap every text node the range covers in its own `<mark>`. A highlight routinely spans element
 * boundaries (`**bold** words`), where `Range.surroundContents` throws on partial containment — so
 * the range is applied node by node, splitting the boundary text nodes to the exact offsets.
 */
function wrapRangeInMarks(range: Range, anchorId: string) {
    for (const text of textNodesInRange(range)) {
        const start = text === range.startContainer ? range.startOffset : 0;
        const end = text === range.endContainer ? range.endOffset : text.data.length;
        if (end <= start) continue;

        // splitText leaves `text` holding [0, end); splitting again at `start` yields exactly the
        // covered run, with the untouched remainders left behind as siblings.
        let covered = text;
        if (end < covered.data.length) covered.splitText(end);
        if (start > 0) covered = covered.splitText(start);

        const mark = covered.ownerDocument.createElement("mark");
        mark.className = HIGHLIGHT_MARK_CLASS;
        mark.dataset.highlightId = anchorId;
        covered.replaceWith(mark);
        mark.appendChild(covered);
    }
}

/**
 * The text nodes a range covers, in document order. Anchors always resolve to text-node boundaries
 * (they are built from a projection of text nodes), so walking from the start container to the end
 * container is enough — no element-boundary cases to consider.
 */
function textNodesInRange(range: Range): Text[] {
    const root = range.commonAncestorContainer;
    if (root.nodeType === Node.TEXT_NODE) {
        return [root as Text];
    }

    const walker = root.ownerDocument?.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    if (!walker) return [];

    const nodes: Text[] = [];
    let covering = false;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node as Text;
        if (text === range.startContainer) covering = true;
        if (covering) nodes.push(text);
        if (text === range.endContainer) break;
    }
    return nodes;
}
