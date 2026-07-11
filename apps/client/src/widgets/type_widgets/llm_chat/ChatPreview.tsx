import "./ChatPreview.css";

import ChatMessage from "./ChatMessage.js";
import type { StoredMessage } from "./llm_chat_types.js";

/**
 * Read-only render of a stored conversation, used by the note preview renderer (collection
 * tiles, etc. — see content_renderer). Reuses {@link ChatMessage} so markdown, tool calls,
 * thinking, citations and attachments render exactly as in the live timeline — but with no
 * input bar, context menu, scroll button, or read-only notice: just the conversation.
 */
export default function ChatPreview({ messages }: { messages: StoredMessage[] }) {
    return (
        <div className="llm-chat-preview">
            {messages.map((message) => (
                <ChatMessage key={message.id} message={message} />
            ))}
        </div>
    );
}
