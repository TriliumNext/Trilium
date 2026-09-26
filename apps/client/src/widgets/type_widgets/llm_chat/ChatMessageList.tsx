import "./ChatMessageList.css";

import { useEffect, useMemo, useState } from "preact/hooks";

import { t } from "../../../services/i18n.js";
import ActionButton from "../../react/ActionButton.js";
import LoadingSpinner from "../../react/LoadingSpinner.js";
import NoItems from "../../react/NoItems.js";
import ChatMessage from "./ChatMessage.js";
import type { ContentBlock, StoredMessage } from "./llm_chat_types.js";
import type { UseLlmChatReturn } from "./useLlmChat.js";

/** How long a streaming reply goes without changing before the list says it is still working. */
const STREAM_IDLE_MS = 2000;

interface ChatMessageListProps {
    /** The chat hook result. */
    chat: UseLlmChatReturn;
    /** Placeholder text shown when there are no messages yet. */
    emptyStateText: string;
    /** Extra class on the scroll container for widget-specific styling. */
    className?: string;
}

/**
 * Renders the scrollable chat message timeline: stored messages (with retry
 * wiring on a trailing error), in-progress streaming placeholders and the
 * scroll anchor. Shared by the chat note type widget and the sidebar chat.
 */
export default function ChatMessageList({ chat, emptyStateText, className }: ChatMessageListProps) {
    const { messages, isStreaming, retryLast } = chat;
    const isStreamIdle = useStreamIdle(chat.streamingBlocks, isStreaming);

    // Rebuilt only when the timeline itself changes: renders caused by anything else
    // (streaming commits, toggles) skip the O(messages) vnode allocation and the
    // per-message memo compares entirely.
    const storedMessages = useMemo(() => messages.map((msg, idx) => (
        <ChatMessage
            key={msg.id}
            message={msg}
            onRetry={
                idx === messages.length - 1 && msg.type === "error" && !isStreaming
                    ? retryLast
                    : undefined
            }
        />
    )), [messages, isStreaming, retryLast]);

    // A stable placeholder object: rebuilt only when its streamed content advances, so
    // renders caused by anything else let memo(ChatMessage) skip the placeholder too.
    const streamingMessage = useMemo<StoredMessage | null>(() => chat.streamingBlocks.length > 0 ? {
        id: "streaming",
        role: "assistant",
        content: chat.streamingBlocks,
        createdAt: new Date().toISOString(),
        citations: chat.pendingCitations.length > 0 ? chat.pendingCitations : undefined
    } : null, [chat.streamingBlocks, chat.pendingCitations]);

    return (
        <div className="chat-message-list-wrapper">
            <div className={`chat-message-list scroll-edge-fade ${className ?? ""}`} ref={chat.scrollContainerRef}>
                {messages.length === 0 && !isStreaming && (
                    <NoItems icon="bx bx-conversation" text={emptyStateText} />
                )}
                {storedMessages}
                {isStreaming && !streamingMessage && (
                    <div className={`chat-stream-status ${chat.streamingStatus ? "" : "chat-stream-status-waiting"}`} role="status">
                        <LoadingSpinner />
                        {chat.streamingStatus
                            ? t(`llm_chat.stream_status.${chat.streamingStatus}`)
                            : t("llm_chat.stream_status.waiting_for_reply")}
                    </div>
                )}
                {isStreaming && streamingMessage && (
                    <ChatMessage
                        message={streamingMessage}
                        isStreaming
                    />
                )}
                {isStreaming && streamingMessage && isStreamIdle && !showsOwnProgress(chat.streamingBlocks) && (
                    <div className="chat-stream-status chat-stream-status-idle" role="status">
                        <LoadingSpinner />
                        {t("llm_chat.stream_status.still_working")}
                    </div>
                )}
                <div ref={chat.messagesEndRef} className="chat-messages-end" aria-hidden="true" />
                <div ref={chat.bottomSpacerRef} className="chat-bottom-spacer" aria-hidden="true" />
            </div>
            {chat.showScrollToBottom && (
                <ActionButton
                    className="chat-scroll-to-bottom"
                    icon="bx bx-chevron-down"
                    text={t("llm_chat.scroll_to_bottom")}
                    titlePosition="top"
                    onClick={chat.scrollToBottom}
                />
            )}
        </div>
    );
}

/** Whether `blocks` has gone {@link STREAM_IDLE_MS} without changing while the turn streams. */
function useStreamIdle(blocks: ContentBlock[], isStreaming: boolean) {
    const [isIdle, setIsIdle] = useState(false);
    useEffect(() => {
        setIsIdle(false);
        if (!isStreaming) return;
        const timer = setTimeout(() => setIsIdle(true), STREAM_IDLE_MS);
        return () => clearTimeout(timer);
    }, [blocks, isStreaming]);
    return isIdle;
}

/** A thought being streamed and a tool call awaiting its result each show a spinner of their own. */
function showsOwnProgress(blocks: ContentBlock[]) {
    const last = blocks.at(-1);
    return last?.type === "thinking" || (last?.type === "tool_call" && !last.toolCall.result);
}
