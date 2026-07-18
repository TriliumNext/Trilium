import "./ChatMessageList.css";

import { useMemo } from "preact/hooks";

import { t } from "../../../services/i18n.js";
import ActionButton from "../../react/ActionButton.js";
import NoItems from "../../react/NoItems.js";
import ChatMessage from "./ChatMessage.js";
import type { StoredMessage } from "./llm_chat_types.js";
import type { UseLlmChatReturn } from "./useLlmChat.js";

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

    // Stable placeholder objects: rebuilt only when their streamed content advances, so
    // renders caused by anything else let memo(ChatMessage) skip the placeholders too.
    const thinkingMessage = useMemo<StoredMessage | null>(() => chat.streamingThinking ? {
        id: "streaming-thinking",
        role: "assistant",
        content: chat.streamingThinking,
        createdAt: new Date().toISOString(),
        type: "thinking"
    } : null, [chat.streamingThinking]);

    const streamingMessage = useMemo<StoredMessage | null>(() => chat.streamingBlocks.length > 0 ? {
        id: "streaming",
        role: "assistant",
        content: chat.streamingBlocks,
        createdAt: new Date().toISOString(),
        citations: chat.pendingCitations.length > 0 ? chat.pendingCitations : undefined
    } : null, [chat.streamingBlocks, chat.pendingCitations]);

    return (
        <div className="chat-message-list-wrapper">
            <div className={`chat-message-list ${className ?? ""}`} ref={chat.scrollContainerRef}>
                {messages.length === 0 && !isStreaming && (
                    <NoItems icon="bx bx-conversation" text={emptyStateText} />
                )}
                {storedMessages}
                {isStreaming && thinkingMessage && (
                    <ChatMessage
                        message={thinkingMessage}
                        isStreaming
                    />
                )}
                {isStreaming && streamingMessage && (
                    <ChatMessage
                        message={streamingMessage}
                        isStreaming
                    />
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
