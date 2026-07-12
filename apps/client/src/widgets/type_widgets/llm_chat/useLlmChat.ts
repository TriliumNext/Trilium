import type { LlmCitation, LlmMessage, LlmMessagePart, LlmModelInfo, LlmUsage } from "@triliumnext/commons";
import { RefObject } from "preact";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";

import { getAvailableModels, streamChatCompletion } from "../../../services/llm_chat.js";
import { randomString } from "../../../services/utils.js";
import { useTriliumEvent } from "../../react/hooks.js";
import { stripQuoteSources } from "./chat_quote.js";
import { conversationForRegenerate } from "./chat_regenerate.js";
import { type ContentBlock, type FileBlock, type ImageBlock, type LlmChatContent, type StoredMessage, type TextFileBlock, trimToFirstUserMessage } from "./llm_chat_types.js";
import { useSmoothStreaming } from "./useSmoothStreaming.js";

/** A user-supplied attachment waiting to be sent with the next message. */
export type AttachmentBlock = ImageBlock | FileBlock | TextFileBlock;

/** The subset of the reply-input editor API the chat needs to write into it imperatively. */
export interface InputEditorApi {
    appendBlockQuote(markdown: string): void;
}

/** Distance (px) past the content bottom edge within which the timeline counts as "at bottom". */
const SCROLL_BOTTOM_THRESHOLD = 50;
/**
 * On send, the boundary between the user's message and the reply is parked this
 * fraction of the viewport down from the top — the reply then types out in place,
 * with the tail of the query still visible above.
 */
const REPLY_ANCHOR_TOP_FRACTION = 0.25;
/** Duration (ms) of the smooth scroll that parks a new reply near the top. */
const ANCHOR_SCROLL_DURATION_MS = 300;

/** The most recent user message element inside the scroll container, or null. */
function getLastUserMessageEl(container: HTMLElement): HTMLElement | null {
    const els = container.querySelectorAll<HTMLElement>('[data-message-role="user"]');
    return els.length ? els[els.length - 1] : null;
}

/**
 * Flatten a stored message's content into the wire format the server expects.
 * Plain string content stays as-is; block-shaped content (with images) becomes
 * an ordered array of text/image parts, with tool-call blocks stripped.
 */
function flattenToApiContent(content: string | ContentBlock[]): string | LlmMessagePart[] {
    if (typeof content === "string") {
        return content;
    }
    const parts: LlmMessagePart[] = [];
    for (const block of content) {
        if (block.type === "text") {
            if (block.content) parts.push({ type: "text", text: block.content });
        } else if (block.type === "image") {
            parts.push({ type: "image", attachmentId: block.attachmentId, mime: block.mime });
        } else if (block.type === "file") {
            parts.push({ type: "file", attachmentId: block.attachmentId, mime: block.mime, filename: block.title });
        } else if (block.type === "text_file") {
            parts.push({ type: "text_attachment", attachmentId: block.attachmentId, filename: block.title });
        }
        // tool_call blocks belong to assistant history rendering only — they
        // are reconstructed from the model's own tool-use turns and must not
        // be re-sent as user/assistant content.
    }
    // Collapse to a string if there is no multimodal content — keeps backwards
    // compatibility with providers/paths that haven't been touched.
    if (parts.length === 0) return "";
    if (parts.length === 1 && parts[0].type === "text") return parts[0].text;
    return parts;
}

/** Strip quote attribution lines from wire content, so the message-id anchors never reach the LLM. */
function stripQuoteSourcesFromApiContent(content: string | LlmMessagePart[]): string | LlmMessagePart[] {
    if (typeof content === "string") return stripQuoteSources(content);
    return content.map(part => (part.type === "text" ? { ...part, text: stripQuoteSources(part.text) } : part));
}

export interface ModelOption extends LlmModelInfo {
    costDescription?: string;
}

export interface LlmChatOptions {
    /** Default value for enableNoteTools */
    defaultEnableNoteTools?: boolean;
    /** Whether extended thinking is supported */
    supportsExtendedThinking?: boolean;
    /** Initial context note ID (the note the user is viewing) */
    contextNoteId?: string;
    /** The chat note ID (used for auto-renaming on first message) */
    chatNoteId?: string;
}

export interface UseLlmChatReturn {
    // State
    messages: StoredMessage[];
    /** Whether the reply-input draft has non-whitespace text. The draft itself is kept out of
     * state (typing must not re-render the chat tree); read it at submit time via
     * {@link getInput}. */
    hasInputText: boolean;
    isStreaming: boolean;
    streamingBlocks: ContentBlock[];
    streamingThinking: string;
    pendingCitations: LlmCitation[];
    /** Images or files the user has attached but not yet sent. */
    pendingAttachments: AttachmentBlock[];
    availableModels: ModelOption[];
    selectedModel: string;
    enableWebSearch: boolean;
    enableNoteTools: boolean;
    enableExtendedThinking: boolean;
    contextNoteId: string | undefined;
    /** The chat note's ID — used as the upload target for attachments. */
    chatNoteId: string | undefined;
    lastPromptTokens: number;
    messagesEndRef: RefObject<HTMLDivElement>;
    scrollContainerRef: RefObject<HTMLDivElement>;
    /** Trailing spacer below the last message; sized so the active turn can park near the top. */
    bottomSpacerRef: RefObject<HTMLDivElement>;
    /** Whether the timeline is scrolled away from the bottom (drives the jump-to-bottom button). */
    showScrollToBottom: boolean;
    /** Jump the timeline to the latest content. */
    scrollToBottom: () => void;
    /** Whether a provider is configured and available */
    hasProvider: boolean;
    /** Whether we're still checking for providers */
    isCheckingProvider: boolean;

    /** Register the reply-input editor so message-timeline actions (e.g. quoting) can write into it. */
    registerInputEditor: (api: InputEditorApi | undefined) => void;
    /** Append a preformatted block (e.g. a Markdown quote) to the reply input and focus it. */
    appendToInput: (text: string) => void;

    /** Read the current reply-input draft text (kept in a ref, not state — see {@link hasInputText}). */
    getInput: () => string;

    // Setters
    setInput: (value: string) => void;
    setMessages: (messages: StoredMessage[]) => void;
    setSelectedModel: (model: string) => void;
    setEnableWebSearch: (value: boolean) => void;
    setEnableNoteTools: (value: boolean) => void;
    setEnableExtendedThinking: (value: boolean) => void;
    setContextNoteId: (noteId: string | undefined) => void;
    setChatNoteId: (noteId: string | undefined) => void;
    /** Append a freshly uploaded image or file to the pending-attachments list. */
    addPendingAttachment: (attachment: AttachmentBlock) => void;
    /** Remove a pending attachment by its attachment ID. */
    removePendingAttachment: (attachmentId: string) => void;

    // Actions
    handleSubmit: (e: Event) => Promise<void>;
    handleKeyDown: (e: KeyboardEvent) => void;
    loadFromContent: (content: LlmChatContent) => void;
    getContent: () => LlmChatContent;
    clearMessages: () => void;
    /** Refresh the provider/models list */
    refreshModels: () => void;
    /** Stop the current generation */
    stopStreaming: () => void;
    /** Re-run the last turn after a failed response (drops the trailing error message) */
    retryLast: () => void;
    /** Regenerate the last reply: re-run from the last user message, dropping the reply that followed */
    regenerateLastReply: () => void;
}

export function useLlmChat(
    onMessagesChange?: (messages: StoredMessage[]) => void,
    options: LlmChatOptions = {}
): UseLlmChatReturn {
    const { defaultEnableNoteTools = false, supportsExtendedThinking = false, contextNoteId: initialContextNoteId, chatNoteId: initialChatNoteId } = options;

    const [messages, setMessagesInternal] = useState<StoredMessage[]>([]);
    // The reply-input draft lives in a ref so typing never re-renders the chat tree; only the
    // empty <-> non-empty transition is stateful (it drives the send button), and same-value
    // setState calls bail out of re-rendering.
    const inputRef = useRef("");
    const [hasInputText, setHasInputText] = useState(false);
    const setInput = useCallback((value: string) => {
        inputRef.current = value;
        setHasInputText(value.trim().length > 0);
    }, []);
    const getInput = useCallback(() => inputRef.current, []);
    const [isStreaming, setIsStreaming] = useState(false);
    // The canonical "target" content received from the stream so far. The
    // displayed `streamingBlocks` is derived from this with the trailing text
    // block smoothed via useSmoothStreaming for a steady reveal cadence.
    const [targetBlocks, setTargetBlocks] = useState<ContentBlock[]>([]);
    const [streamingThinking, setStreamingThinking] = useState("");
    const { displayedText: smoothedTailText, append: smoothAppend, drain: smoothDrain, reset: smoothReset } = useSmoothStreaming();
    const [pendingCitations, setPendingCitations] = useState<LlmCitation[]>([]);
    const [pendingAttachments, setPendingAttachments] = useState<AttachmentBlock[]>([]);
    const [availableModels, setAvailableModels] = useState<ModelOption[]>([]);
    const [selectedModel, setSelectedModel] = useState<string>("");
    const [enableWebSearch, setEnableWebSearch] = useState(true);
    const [enableNoteTools, setEnableNoteTools] = useState(defaultEnableNoteTools);
    const [enableExtendedThinking, setEnableExtendedThinking] = useState(false);
    const [contextNoteId, setContextNoteId] = useState<string | undefined>(initialContextNoteId);
    const [chatNoteId, setChatNoteIdState] = useState<string | undefined>(initialChatNoteId);
    const [lastPromptTokens, setLastPromptTokens] = useState<number>(0);
    const [hasProvider, setHasProvider] = useState<boolean>(true); // Assume true initially
    const [isCheckingProvider, setIsCheckingProvider] = useState<boolean>(true);
    const [showScrollToBottom, setShowScrollToBottom] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const bottomSpacerRef = useRef<HTMLDivElement>(null);
    const abortControllerRef = useRef<AbortController | null>(null);
    const anchorRafRef = useRef<number | null>(null);
    // A one-shot scroll to run after the next messages render: "anchor" parks a fresh
    // reply near the top (sending/retrying), "bottom" jumps to the latest content
    // (loading a chat). The timeline never follows the stream beyond this single action.
    const pendingScrollRef = useRef<"anchor" | "bottom" | null>(null);
    // True from the moment the layout effect commits an anchor scroll until that smooth scroll finishes or
    // the user takes over. `pendingScrollRef` only guards the window before the layout effect consumes the
    // mode; once consumed it's null, so this covers the ~300ms animation that follows — during which a
    // content reload must not queue a bottom jump that would yank the just-parked reply to the latest content.
    const anchorScrollActiveRef = useRef(false);

    // Refs to get fresh values in getContent (avoids stale closures)
    const messagesRef = useRef(messages);
    messagesRef.current = messages;
    const selectedModelRef = useRef(selectedModel);
    selectedModelRef.current = selectedModel;
    const enableWebSearchRef = useRef(enableWebSearch);
    enableWebSearchRef.current = enableWebSearch;
    const enableNoteToolsRef = useRef(enableNoteTools);
    enableNoteToolsRef.current = enableNoteTools;
    const enableExtendedThinkingRef = useRef(enableExtendedThinking);
    enableExtendedThinkingRef.current = enableExtendedThinking;
    const chatNoteIdRef = useRef(chatNoteId);
    chatNoteIdRef.current = chatNoteId;
    const setChatNoteId = useCallback((noteId: string | undefined) => {
        chatNoteIdRef.current = noteId;
        setChatNoteIdState(noteId);
    }, []);
    const contextNoteIdRef = useRef(contextNoteId);
    contextNoteIdRef.current = contextNoteId;
    const pendingAttachmentsRef = useRef(pendingAttachments);
    pendingAttachmentsRef.current = pendingAttachments;

    // The reply-input editor, registered by ChatInputBar once mounted. Held in a ref so timeline
    // actions (e.g. quoting a selection) can write into it without a render-order dependency.
    const inputEditorRef = useRef<InputEditorApi | undefined>();
    const registerInputEditor = useCallback((api: InputEditorApi | undefined) => {
        inputEditorRef.current = api;
    }, []);
    const appendToInput = useCallback((text: string) => {
        inputEditorRef.current?.appendBlockQuote(text);
    }, []);

    const addPendingAttachment = useCallback((attachment: AttachmentBlock) => {
        setPendingAttachments(prev => [...prev, attachment]);
    }, []);
    const removePendingAttachment = useCallback((attachmentId: string) => {
        setPendingAttachments(prev => prev.filter(a => a.attachmentId !== attachmentId));
    }, []);

    // Wrapper to call onMessagesChange when messages update. The callback goes through a ref:
    // both hosts pass inline arrows, and keeping them out of the deps keeps setMessages — and the
    // whole action-callback chain built on it (runStream, handleSubmit, retryLast, ...) — stable
    // across renders.
    const onMessagesChangeRef = useRef(onMessagesChange);
    onMessagesChangeRef.current = onMessagesChange;
    const setMessages = useCallback((newMessages: StoredMessage[]) => {
        setMessagesInternal(newMessages);
        onMessagesChangeRef.current?.(newMessages);
    }, []);

    // Fetch available models on mount
    const refreshModels = useCallback(() => {
        setIsCheckingProvider(true);
        getAvailableModels().then(models => {
            const modelsWithDescription = models.map(m => ({
                ...m,
                costDescription: m.costMultiplier ? `${m.costMultiplier}x` : undefined
            }));
            setAvailableModels(modelsWithDescription);
            setHasProvider(models.length > 0);
            setIsCheckingProvider(false);
            if (!selectedModel) {
                const defaultModel = models.find(m => m.isDefault) || models[0];
                if (defaultModel) {
                    setSelectedModel(defaultModel.id);
                }
            }
        }).catch(err => {
            console.error("Failed to fetch available models:", err);
            setHasProvider(false);
            setIsCheckingProvider(false);
        });
    }, [selectedModel]);

    useEffect(() => {
        refreshModels();
    }, []);

    // Re-fetch models when providers are (re)configured elsewhere — e.g. via the
    // settings page — so the chat picks up newly added providers and clears the
    // "no provider configured" prompt without requiring a page reload.
    useTriliumEvent("entitiesReloaded", useCallback(({ loadResults }) => {
        const optionNames = loadResults.getOptionNames();
        if (optionNames.includes("llmProviders") || optionNames.includes("aiEnabled")) {
            refreshModels();
        }
    }, [refreshModels]));

    /** Jump to the latest content (ignores the trailing spacer). */
    const scrollToBottom = useCallback(() => {
        messagesEndRef.current?.scrollIntoView({ block: "end", behavior: "instant" });
    }, []);

    // Size the trailing spacer so the current turn can be parked near the top: reserve
    // enough room below the user→reply boundary for the boundary to sit at
    // REPLY_ANCHOR_TOP_FRACTION of the viewport, minus whatever the reply already
    // provides (so long replies leave little blank). Set imperatively so it settles
    // synchronously, right before the one-shot anchor scroll — no extra render, no flash.
    const recomputeBottomSpacer = useCallback(() => {
        const container = scrollContainerRef.current;
        const spacer = bottomSpacerRef.current;
        const endEl = messagesEndRef.current;
        if (!container || !spacer || !endEl) return;

        const lastUser = getLastUserMessageEl(container);
        const viewport = container.clientHeight;
        if (!lastUser || viewport === 0) {
            spacer.style.height = "0px";
            return;
        }
        // The spacer sits after endEl, so boundary→endEl is independent of its own
        // height — no feedback loop.
        const boundary = lastUser.getBoundingClientRect().bottom;
        const contentEnd = endEl.getBoundingClientRect().top;
        const replyHeight = Math.max(0, contentEnd - boundary);
        const roomNeeded = viewport * (1 - REPLY_ANCHOR_TOP_FRACTION);
        spacer.style.height = `${Math.round(Math.max(0, roomNeeded - replyHeight))}px`;
    }, []);

    /** Smoothly scroll the container to `targetTop` over ANCHOR_SCROLL_DURATION_MS. */
    const smoothScrollTo = useCallback((targetTop: number) => {
        const container = scrollContainerRef.current;
        if (!container) {
            anchorScrollActiveRef.current = false;
            return;
        }
        if (anchorRafRef.current != null) {
            cancelAnimationFrame(anchorRafRef.current);
            anchorRafRef.current = null;
        }
        const maxScroll = container.scrollHeight - container.clientHeight;
        const to = Math.max(0, Math.min(targetTop, maxScroll));
        const from = container.scrollTop;
        const distance = to - from;
        if (Math.abs(distance) < 1) {
            container.scrollTop = to;
            anchorScrollActiveRef.current = false;
            return;
        }
        // Committed to the parked position — hold off reload-driven bottom jumps until the animation ends.
        anchorScrollActiveRef.current = true;
        const start = performance.now();
        let lastSetTop = from;
        const step = (now: number) => {
            // Bail out if the user scrolled mid-animation (don't fight them).
            if (Math.abs(container.scrollTop - lastSetTop) > 2) {
                anchorRafRef.current = null;
                anchorScrollActiveRef.current = false;
                return;
            }
            const t = Math.min(1, (now - start) / ANCHOR_SCROLL_DURATION_MS);
            const eased = t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2; // easeInOutQuad
            container.scrollTop = from + distance * eased;
            lastSetTop = container.scrollTop;
            if (t < 1) {
                anchorRafRef.current = requestAnimationFrame(step);
            } else {
                anchorRafRef.current = null;
                anchorScrollActiveRef.current = false;
            }
        };
        anchorRafRef.current = requestAnimationFrame(step);
    }, []);

    /** Park the latest user→reply boundary near the top, once, with a smooth transition. */
    const anchorReplyToTop = useCallback(() => {
        const container = scrollContainerRef.current;
        if (!container) return;
        const lastUser = getLastUserMessageEl(container);
        if (!lastUser) {
            scrollToBottom();
            return;
        }
        const viewport = container.clientHeight;
        const containerTop = container.getBoundingClientRect().top;
        const userRect = lastUser.getBoundingClientRect();
        const boundaryWithinView = userRect.bottom - containerTop;
        // Keep at most a REPLY_ANCHOR_TOP_FRACTION-viewport sliver of the query above the
        // boundary; if the query is shorter, just pin its top (no blank gap above).
        const offsetAboveBoundary = Math.min(viewport * REPLY_ANCHOR_TOP_FRACTION, userRect.height);
        smoothScrollTo(container.scrollTop + boundaryWithinView - offsetAboveBoundary);
    }, [scrollToBottom, smoothScrollTo]);

    // The timeline does not follow the stream — the model can outpace the reader, and
    // moving text is hard to read. A jump-to-latest button appears whenever the content
    // end sits below the fold. An IntersectionObserver on the messagesEnd anchor drives
    // it: it fires only when the anchor crosses the viewport edge — no per-scroll layout
    // reads — and covers scrolling, resize, streaming growth, and message changes alike.
    useEffect(() => {
        const container = scrollContainerRef.current;
        const endEl = messagesEndRef.current;
        if (!container || !endEl || typeof IntersectionObserver === "undefined") return;
        const observer = new IntersectionObserver(
            ([entry]) => {
                const rootBounds = entry.rootBounds;
                // Show only when the content end is genuinely below the fold — not when it
                // has been scrolled above (matches the previous distance-based check).
                setShowScrollToBottom(rootBounds ? entry.boundingClientRect.top > rootBounds.bottom : false);
            },
            { root: container, rootMargin: `0px 0px ${SCROLL_BOTTOM_THRESHOLD}px 0px`, threshold: 0 }
        );
        observer.observe(endEl);
        return () => observer.disconnect();
    }, []);

    // Re-fit the spacer and run any pending one-shot scroll as the message list changes.
    // A layout effect lets the spacer settle synchronously so the anchor scroll already
    // has the room it needs (no double-scroll, no flash). The stream itself never moves
    // the view: `messages` is stable while streaming, so this does not re-run per token.
    useLayoutEffect(() => {
        recomputeBottomSpacer();
        const mode = pendingScrollRef.current;
        if (mode) {
            pendingScrollRef.current = null;
            if (mode === "anchor") {
                anchorReplyToTop();
            } else {
                scrollToBottom();
            }
        }
    }, [messages, recomputeBottomSpacer, anchorReplyToTop, scrollToBottom]);

    // Re-fit the spacer when the container is resized (pane split, window resize, etc.).
    // The button is handled by the IntersectionObserver, which reacts to resize itself.
    useEffect(() => {
        const container = scrollContainerRef.current;
        if (!container || typeof ResizeObserver === "undefined") return;
        const observer = new ResizeObserver(() => recomputeBottomSpacer());
        observer.observe(container);
        return () => observer.disconnect();
    }, [recomputeBottomSpacer]);

    // On unmount, stop the anchor animation and abort any active stream so it stops
    // consuming API tokens and can't push chunks into an unmounted component.
    useEffect(() => () => {
        if (anchorRafRef.current != null) cancelAnimationFrame(anchorRafRef.current);
        abortControllerRef.current?.abort();
    }, []);

    // Load state from content object
    const loadFromContent = useCallback((content: LlmChatContent) => {
        // Opening an existing chat should land on the most recent message — but never clobber a send/retry
        // that has queued the reply-anchor positioning, nor one whose anchor scroll is still animating: a
        // content reload can race both the layout effect that consumes the pending mode and the ~300ms
        // smooth scroll that follows, and a bottom jump in either window would yank the reply to the latest content.
        if ((content.messages?.length ?? 0) > 0 && pendingScrollRef.current !== "anchor" && !anchorScrollActiveRef.current) {
            pendingScrollRef.current = "bottom";
        }
        setMessagesInternal(content.messages || []);
        if (content.selectedModel) {
            setSelectedModel(content.selectedModel);
        }
        if (typeof content.enableWebSearch === "boolean") {
            setEnableWebSearch(content.enableWebSearch);
        }
        if (typeof content.enableNoteTools === "boolean") {
            setEnableNoteTools(content.enableNoteTools);
        }
        if (supportsExtendedThinking && typeof content.enableExtendedThinking === "boolean") {
            setEnableExtendedThinking(content.enableExtendedThinking);
        }
        // Restore last prompt tokens from the most recent message with usage
        const lastUsage = [...(content.messages || [])].reverse().find(m => m.usage)?.usage;
        setLastPromptTokens(lastUsage?.promptTokens ?? 0);
    }, [supportsExtendedThinking]);

    // Get current state as content object (uses refs to avoid stale closures)
    const getContent = useCallback((): LlmChatContent => {
        const content: LlmChatContent = {
            version: 1,
            messages: messagesRef.current,
            selectedModel: selectedModelRef.current || undefined,
            enableWebSearch: enableWebSearchRef.current,
            enableNoteTools: enableNoteToolsRef.current
        };
        if (supportsExtendedThinking) {
            content.enableExtendedThinking = enableExtendedThinkingRef.current;
        }
        return content;
    }, [supportsExtendedThinking]);

    const clearMessages = useCallback(() => {
        setMessages([]);
        setLastPromptTokens(0);
    }, [setMessages]);

    /**
     * Run a streaming completion against `conversation` — the full ordered message
     * list to send to the model and to use as the base for finalized/error results.
     */
    const runStream = useCallback(async (conversation: StoredMessage[]) => {
        setPendingCitations([]);
        setMessagesInternal(conversation);
        setIsStreaming(true);
        setTargetBlocks([]);
        setStreamingThinking("");
        smoothReset();

        let thinkingContent = "";
        const contentBlocks: ContentBlock[] = [];
        const citations: LlmCitation[] = [];
        let usage: LlmUsage | undefined;

        /** Get or create the last text block to append streaming text to. */
        function lastTextBlock(): ContentBlock & { type: "text" } {
            const last = contentBlocks[contentBlocks.length - 1];
            if (last?.type === "text") {
                return last;
            }
            const block: ContentBlock = { type: "text", content: "" };
            contentBlocks.push(block);
            return block as ContentBlock & { type: "text" };
        }

        const apiMessages: LlmMessage[] = trimToFirstUserMessage(conversation).map(m => ({
            role: m.role,
            content: stripQuoteSourcesFromApiContent(flattenToApiContent(m.content))
        }));

        const selectedModelProvider = availableModels.find(m => m.id === selectedModel)?.provider;
        const streamOptions: Parameters<typeof streamChatCompletion>[1] = {
            model: selectedModel || undefined,
            provider: selectedModelProvider,
            enableWebSearch,
            enableNoteTools,
            contextNoteId,
            chatNoteId: chatNoteIdRef.current
        };
        if (supportsExtendedThinking) {
            streamOptions.enableExtendedThinking = enableExtendedThinking;
        }

        const abortController = new AbortController();
        abortControllerRef.current = abortController;

        /** Shared cleanup: finalize collected content and reset streaming state. */
        function finalizeStream() {
            // Reveal any remaining smoothed text instantly so the trailing chars
            // don't get clipped when the streaming placeholder is swapped for
            // the finalized message.
            smoothDrain();

            // Mark any in-progress tool calls as stopped so they don't show infinite spinners.
            // Also clear `inputStreaming` so a half-streamed JSON arg list doesn't render.
            for (const [i, block] of contentBlocks.entries()) {
                if (block.type === "tool_call" && !block.toolCall.result) {
                    contentBlocks[i] = {
                        type: "tool_call",
                        toolCall: {
                            ...block.toolCall,
                            inputStreaming: undefined,
                            result: "[Stopped]",
                            isError: true
                        }
                    };
                }
            }

            const finalNewMessages: StoredMessage[] = [];

            if (thinkingContent) {
                finalNewMessages.push({
                    id: randomString(),
                    role: "assistant",
                    content: thinkingContent,
                    createdAt: new Date().toISOString(),
                    type: "thinking"
                });
            }

            if (contentBlocks.length > 0) {
                finalNewMessages.push({
                    id: randomString(),
                    role: "assistant",
                    content: contentBlocks,
                    createdAt: new Date().toISOString(),
                    citations: citations.length > 0 ? citations : undefined,
                    usage
                });
            }

            if (finalNewMessages.length > 0) {
                setMessages([...conversation, ...finalNewMessages]);
            }

            setTargetBlocks([]);
            setStreamingThinking("");
            setPendingCitations([]);
            setIsStreaming(false);
            abortControllerRef.current = null;
        }

        await streamChatCompletion(
            apiMessages,
            streamOptions,
            {
                onChunk: (text) => {
                    // A new text block begins whenever the previous tail is
                    // anything other than text (or there's nothing yet). In
                    // that case the smoother needs to start fresh so it doesn't
                    // pin the displayed length from the previous block.
                    const prev = contentBlocks[contentBlocks.length - 1];
                    const isNewTextBlock = prev?.type !== "text";
                    lastTextBlock().content += text;
                    if (isNewTextBlock) {
                        smoothReset();
                    }
                    smoothAppend(text);
                    setTargetBlocks([...contentBlocks]);
                },
                onThinking: (text) => {
                    thinkingContent += text;
                    setStreamingThinking(thinkingContent);
                },
                onToolInputStart: (toolCallId, toolName) => {
                    // Snap any pending smoothed text to its full value before
                    // the tool_call block appears — otherwise the trailing
                    // chars of the previous text block would be left hanging.
                    smoothDrain();
                    contentBlocks.push({
                        type: "tool_call",
                        toolCall: {
                            id: toolCallId,
                            toolName,
                            input: {},
                            inputStreaming: ""
                        }
                    });
                    setTargetBlocks([...contentBlocks]);
                },
                onToolInputDelta: (toolCallId, delta) => {
                    for (let i = contentBlocks.length - 1; i >= 0; i--) {
                        const block = contentBlocks[i];
                        if (block.type === "tool_call" && block.toolCall.id === toolCallId) {
                            contentBlocks[i] = {
                                type: "tool_call",
                                toolCall: {
                                    ...block.toolCall,
                                    inputStreaming: (block.toolCall.inputStreaming ?? "") + delta
                                }
                            };
                            break;
                        }
                    }
                    setTargetBlocks([...contentBlocks]);
                },
                onToolUse: (toolCallId, toolName, toolInput) => {
                    // Some providers skip tool-input-start/delta entirely and only emit
                    // the final tool-call. In that case there's no pending block to update,
                    // so push a fresh one.
                    for (let i = contentBlocks.length - 1; i >= 0; i--) {
                        const block = contentBlocks[i];
                        if (block.type === "tool_call" && block.toolCall.id === toolCallId) {
                            contentBlocks[i] = {
                                type: "tool_call",
                                toolCall: {
                                    ...block.toolCall,
                                    input: toolInput,
                                    inputStreaming: undefined
                                }
                            };
                            setTargetBlocks([...contentBlocks]);
                            return;
                        }
                    }
                    // Provider went straight to a full tool_call with no
                    // start/delta events — drain so any preceding text is
                    // shown in full before the tool_call card replaces it.
                    smoothDrain();
                    contentBlocks.push({
                        type: "tool_call",
                        toolCall: { id: toolCallId, toolName, input: toolInput }
                    });
                    setTargetBlocks([...contentBlocks]);
                },
                onToolResult: (toolCallId, _toolName, result, isError) => {
                    // Replace the matching block with a new object so Preact sees the change.
                    for (let i = contentBlocks.length - 1; i >= 0; i--) {
                        const block = contentBlocks[i];
                        if (block.type === "tool_call" && block.toolCall.id === toolCallId) {
                            contentBlocks[i] = {
                                type: "tool_call",
                                toolCall: { ...block.toolCall, result, isError }
                            };
                            break;
                        }
                    }
                    setTargetBlocks([...contentBlocks]);
                },
                onCitation: (citation) => {
                    // Deduplicate by URL
                    if (!citation.url || !citations.some(c => c.url === citation.url)) {
                        citations.push(citation);
                        setPendingCitations([...citations]);
                    }
                },
                onUsage: (u) => {
                    usage = u;
                    setLastPromptTokens(u.promptTokens);
                },
                onError: (errorMsg) => {
                    console.error("Chat error:", errorMsg);
                    const errorMessage: StoredMessage = {
                        id: randomString(),
                        role: "assistant",
                        content: errorMsg,
                        createdAt: new Date().toISOString(),
                        type: "error"
                    };
                    const finalMessages = [...conversation, errorMessage];
                    setMessages(finalMessages);
                    smoothReset();
                    setTargetBlocks([]);
                    setStreamingThinking("");
                    setIsStreaming(false);
                },
                onDone: () => {
                    finalizeStream();
                }
            },
            abortController.signal
        ).catch((e) => {
            // AbortError is expected when user stops generation
            if (e instanceof DOMException && e.name === "AbortError") {
                finalizeStream();
                return;
            }
            // Unexpected error — streamChatCompletion normally routes failures
            // through onError, so reaching here is a bug. Surface it in the chat
            // and reset state instead of leaving the UI stuck on the stop button.
            console.error("Unexpected error in chat stream:", e);
            const errorMsg = e instanceof Error ? e.message : String(e);
            setMessages([...conversation, {
                id: randomString(),
                role: "assistant",
                content: errorMsg,
                createdAt: new Date().toISOString(),
                type: "error"
            }]);
            smoothReset();
            setTargetBlocks([]);
            setStreamingThinking("");
            setIsStreaming(false);
            abortControllerRef.current = null;
        });
    }, [selectedModel, availableModels, enableWebSearch, enableNoteTools, enableExtendedThinking, contextNoteId, supportsExtendedThinking, setMessages, smoothAppend, smoothDrain, smoothReset]);

    const handleSubmit = useCallback(async (e: Event) => {
        e.preventDefault();
        if (isStreaming) return;
        const trimmedInput = inputRef.current.trim();
        const attachments = pendingAttachmentsRef.current;
        if (!trimmedInput && attachments.length === 0) return;

        // If there are attachments, build a block-shaped content array so the
        // images travel alongside the text. Otherwise stay with the simple
        // string form so existing chat history remains byte-identical.
        let content: StoredMessage["content"];
        if (attachments.length === 0) {
            content = trimmedInput;
        } else {
            const blocks: ContentBlock[] = [];
            if (trimmedInput) {
                blocks.push({ type: "text", content: trimmedInput });
            }
            for (const att of attachments) {
                blocks.push(att);
            }
            content = blocks;
        }

        const userMessage: StoredMessage = {
            id: randomString(),
            role: "user",
            content,
            createdAt: new Date().toISOString()
        };
        setInput("");
        setPendingAttachments([]);
        pendingScrollRef.current = "anchor";
        await runStream([...messages, userMessage]);
    }, [isStreaming, messages, runStream, setInput]);

    /** Re-run the last turn after a failed response, dropping the trailing error message. */
    const retryLast = useCallback(async () => {
        if (isStreaming) return;
        if (messages[messages.length - 1]?.type !== "error") return;
        pendingScrollRef.current = "anchor";
        await runStream(messages.slice(0, -1));
    }, [isStreaming, messages, runStream]);

    /** Regenerate the last reply: re-run from the last user message, dropping the reply that followed. */
    const regenerateLastReply = useCallback(async () => {
        // Re-check against the current state, not the snapshot from when the menu opened: only act while
        // idle and while the last message is still an assistant reply to regenerate.
        if (isStreaming || messages[messages.length - 1]?.role !== "assistant") return;
        const conversation = conversationForRegenerate(messages);
        if (!conversation) return;
        pendingScrollRef.current = "anchor";
        await runStream(conversation);
    }, [isStreaming, messages, runStream]);

    const handleKeyDown = useCallback((e: KeyboardEvent) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSubmit(e);
        }
    }, [handleSubmit]);

    /** Stop the current generation by aborting the SSE connection. */
    const stopStreaming = useCallback(() => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
    }, []);

    // Build the rendered view by swapping the trailing text block's content for
    // the smoother's progressively-revealed prefix. Earlier text blocks are
    // already drained to their full content (drain() runs whenever a tool_call
    // pushes onto the stack), so only the tail needs substitution.
    const streamingBlocks = useMemo<ContentBlock[]>(() => {
        if (targetBlocks.length === 0) return targetBlocks;
        const lastIdx = targetBlocks.length - 1;
        const last = targetBlocks[lastIdx];
        if (last.type !== "text") return targetBlocks;
        if (last.content === smoothedTailText) return targetBlocks;
        return [
            ...targetBlocks.slice(0, lastIdx),
            { ...last, content: smoothedTailText }
        ];
    }, [targetBlocks, smoothedTailText]);

    return {
        // State
        messages,
        hasInputText,
        isStreaming,
        streamingBlocks,
        streamingThinking,
        pendingCitations,
        pendingAttachments,
        availableModels,
        selectedModel,
        enableWebSearch,
        enableNoteTools,
        enableExtendedThinking,
        contextNoteId,
        chatNoteId,
        lastPromptTokens,
        messagesEndRef,
        scrollContainerRef,
        bottomSpacerRef,
        showScrollToBottom,
        scrollToBottom,
        hasProvider,
        isCheckingProvider,

        registerInputEditor,
        appendToInput,
        getInput,

        // Setters
        setInput,
        setMessages,
        setSelectedModel,
        setEnableWebSearch,
        setEnableNoteTools,
        setEnableExtendedThinking,
        setContextNoteId,
        setChatNoteId,
        addPendingAttachment,
        removePendingAttachment,

        // Actions
        handleSubmit,
        handleKeyDown,
        loadFromContent,
        getContent,
        clearMessages,
        refreshModels,
        stopStreaming,
        retryLast,
        regenerateLastReply
    };
}
