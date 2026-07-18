import "./chat_highlights.css";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

import type NoteContext from "../../../components/note_context.js";
import { t } from "../../../services/i18n.js";
import { randomString } from "../../../services/utils.js";
import type { ChatContextMenuItemsProvider } from "./chat_context_menu.js";
import { createAnchorFromSelection, findMessageContentRoot, resolveAnchorRange } from "./chat_highlights_anchor.js";
import type { HighlightAnchor } from "./llm_chat_types.js";
import type { UseLlmChatReturn } from "./useLlmChat.js";

/** A highlight surfaced in the sidebar list. */
export interface ChatHighlightItem {
    id: string;
    messageId: string;
    /** The highlighted prose, shown as the list entry's label. */
    text: string;
}

/** Context data published for the {@link ChatHighlightsList} sidebar widget. */
export interface ChatHighlightsContext {
    highlights: ChatHighlightItem[];
    scrollToHighlight(id: string): void;
    removeHighlight(id: string): void;
}

/** What {@link useChatHighlights} exposes to the shared chat context menu. */
export interface ChatHighlights {
    /** Highlight items for the right-clicked message: remove over an existing highlight, else add for a selection. */
    highlightMenuItems: ChatContextMenuItemsProvider;
}

/** The single CSS Custom Highlight registry entry all chat highlights paint through. */
const HIGHLIGHT_NAME = "chat-highlight";

type RangeMap = Map<string, { range: Range; messageId: string }>;

// A `::highlight()` name is global to the document, so every open chat shares this one registry entry
// instead of each registering its own (which would evict the others on set/delete — broken with two
// chats open in split panes). Each live hook instance contributes its resolved ranges; the entry is
// rebuilt from all of them and removed only once the last chat unmounts.
const activeRangeMaps = new Set<{ current: RangeMap }>();
let sharedHighlight: Highlight | null = null;

/**
 * Wires up user-created highlights for an AI chat: painting stored highlights over the rendered prose,
 * contributing add/remove items to the shared chat context menu, and publishing the list to the note
 * context so the sidebar widget can display it — mirroring {@link useChatToc}.
 *
 * Highlights are painted with the CSS Custom Highlight API rather than by wrapping text in elements,
 * so nothing is injected into the Preact-owned message DOM. Because that paints over live `Range`s
 * (which go stale when a message re-renders), the ranges are rebuilt from the stored anchors on every
 * message change.
 */
export function useChatHighlights(chat: UseLlmChatReturn, noteContext: NoteContext | undefined): ChatHighlights {
    const { messages, scrollContainerRef } = chat;
    const [highlightItems, setHighlightItems] = useState<ChatHighlightItem[]>([]);

    // Latest values for the imperative callbacks, so they never read stale state.
    const messagesRef = useRef(messages);
    messagesRef.current = messages;
    const setMessagesRef = useRef(chat.setMessages);
    setMessagesRef.current = chat.setMessages;

    // The resolved ranges behind this chat's currently painted highlights, keyed by anchor id (used
    // for hit-testing on right-click and for scroll-to). Registered in the module-level set so the
    // shared highlight can paint every open chat's ranges.
    const rangesRef = useRef<RangeMap>(new Map());

    // Rebuild ranges from the stored anchors and repaint. A layout effect so painting settles in the
    // same frame the messages render — no flash. The stream keeps `messages` stable, so this doesn't
    // run per token.
    const recompute = useCallback(() => {
        const container = scrollContainerRef.current;
        if (!container) return;

        const rangeById: RangeMap = new Map();
        const items: ChatHighlightItem[] = [];
        for (const message of messagesRef.current) {
            if (!message.highlights?.length) continue;
            const root = findMessageContentRoot(container, message.id);
            if (!root) continue;
            const resolved: { anchor: HighlightAnchor; range: Range }[] = [];
            for (const anchor of message.highlights) {
                const range = resolveAnchorRange(root, anchor);
                if (!range) continue; // orphaned (e.g. regenerated message) — drop cleanly, never mis-paint
                resolved.push({ anchor, range });
            }
            // Order by position within the message so the sidebar list follows the document, not the
            // order the user happened to create the highlights in (`addHighlight` appends).
            resolved.sort((a, b) => a.range.compareBoundaryPoints(Range.START_TO_START, b.range));
            for (const { anchor, range } of resolved) {
                rangeById.set(anchor.id, { range, messageId: message.id });
                items.push({ id: anchor.id, messageId: message.id, text: anchor.quotedText });
            }
        }

        rangesRef.current = rangeById;
        activeRangeMaps.add(rangesRef);
        repaintChatHighlights();
        setHighlightItems(items);
    }, [scrollContainerRef]);

    useLayoutEffect(() => recompute(), [messages, recompute]);

    // On unmount, drop this chat's ranges from the shared highlight (and the registry entry with the
    // last chat), so a switched-away chat leaves no paint behind.
    useEffect(() => () => releaseRangeMap(rangesRef), []);

    const addHighlight = useCallback((messageId: string, built: Omit<HighlightAnchor, "id">) => {
        const anchor: HighlightAnchor = { id: randomString(), ...built };
        setMessagesRef.current(messagesRef.current.map(message =>
            message.id === messageId
                ? { ...message, highlights: [...(message.highlights ?? []), anchor] }
                : message
        ));
    }, []);

    const removeHighlight = useCallback((anchorId: string) => {
        setMessagesRef.current(messagesRef.current.map(message => {
            if (!message.highlights?.some(h => h.id === anchorId)) return message;
            const remaining = message.highlights.filter(h => h.id !== anchorId);
            return { ...message, highlights: remaining.length ? remaining : undefined };
        }));
    }, []);

    const scrollToHighlight = useCallback((anchorId: string) => {
        // Reuse the range resolved by the most recent recompute rather than re-walking the DOM; every
        // listed highlight has a cached entry (the list is built from the same resolved set).
        const entry = rangesRef.current.get(anchorId);
        const element = entry && nearestElement(entry.range.startContainer);
        element?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, []);

    // Contribute the highlight commands to the chat context menu: Remove over an existing highlight,
    // else Highlight for a prose selection. Both mutate the message, so they're suppressed while a
    // reply streams.
    const highlightMenuItems = useCallback<ChatContextMenuItemsProvider>((ctx) => {
        if (ctx.streaming) return [];
        const hitId = highlightAtPoint(rangesRef.current, ctx.messageId, ctx.clientX, ctx.clientY);
        if (hitId) {
            return [{ title: t("llm_chat.highlight_remove"), uiIcon: "bx bx-eraser", handler: () => removeHighlight(hitId) }];
        }
        const built = ctx.selectionRange ? createAnchorFromSelection(ctx.root, ctx.selectionRange) : null;
        if (built) {
            return [{ title: t("llm_chat.highlight_add"), uiIcon: "bx bx-highlight", handler: () => addHighlight(ctx.messageId, built) }];
        }
        return [];
    }, [addHighlight, removeHighlight]);

    // Publish the list for the sidebar widget.
    useEffect(() => {
        noteContext?.setContextData("chatHighlights", { highlights: highlightItems, scrollToHighlight, removeHighlight });
    }, [noteContext, highlightItems, scrollToHighlight, removeHighlight]);

    // Clear the published data when this context goes away (note switch or unmount), so the sidebar
    // doesn't keep showing a stale list. Kept separate from the publish effect above — clearing there
    // would flash the list empty on every update.
    useEffect(() => () => noteContext?.clearContextData("chatHighlights"), [noteContext]);

    return { highlightMenuItems };
}

function isHighlightApiAvailable(): boolean {
    return typeof Highlight !== "undefined" && typeof CSS !== "undefined" && !!CSS.highlights;
}

/** Rebuild the shared registry entry from every open chat's ranges. */
function repaintChatHighlights() {
    if (!isHighlightApiAvailable()) return;
    if (!sharedHighlight) {
        sharedHighlight = new Highlight();
        CSS.highlights.set(HIGHLIGHT_NAME, sharedHighlight);
    }
    sharedHighlight.clear();
    for (const ref of activeRangeMaps) {
        for (const { range } of ref.current.values()) sharedHighlight.add(range);
    }
}

/** Drop one chat's ranges; remove the registry entry entirely once no chats remain. */
function releaseRangeMap(ref: { current: RangeMap }) {
    activeRangeMaps.delete(ref);
    if (activeRangeMaps.size === 0) {
        if (isHighlightApiAvailable()) CSS.highlights.delete(HIGHLIGHT_NAME);
        sharedHighlight = null;
    } else {
        repaintChatHighlights();
    }
}

/** The id of the smallest highlight (of `messageId`) painted under the given viewport point, if any. */
function highlightAtPoint(ranges: RangeMap, messageId: string, x: number, y: number): string | null {
    const caret = caretFromPoint(document, x, y);
    if (!caret) return null;

    let bestId: string | null = null;
    let bestLength = Infinity;
    for (const [id, { range, messageId: owner }] of ranges) {
        if (owner !== messageId) continue;
        try {
            if (!range.isPointInRange(caret.node, caret.offset)) continue;
        } catch {
            continue; // point in a different document subtree
        }
        const length = range.toString().length;
        if (length < bestLength) {
            bestLength = length;
            bestId = id;
        }
    }
    return bestId;
}

function caretFromPoint(doc: Document, x: number, y: number): { node: Node; offset: number } | null {
    if (typeof doc.caretPositionFromPoint === "function") {
        const pos = doc.caretPositionFromPoint(x, y);
        return pos?.offsetNode ? { node: pos.offsetNode, offset: pos.offset } : null;
    }
    // Older Chromium/Electron only expose the WebKit-prefixed variant.
    const legacy = (doc as unknown as { caretRangeFromPoint?: (x: number, y: number) => Range | null }).caretRangeFromPoint;
    if (typeof legacy === "function") {
        const range = legacy.call(doc, x, y);
        return range ? { node: range.startContainer, offset: range.startOffset } : null;
    }
    return null;
}

function nearestElement(node: Node): HTMLElement | null {
    return node instanceof HTMLElement ? node : node.parentElement;
}
