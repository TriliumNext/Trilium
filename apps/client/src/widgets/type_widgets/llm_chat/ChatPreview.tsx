import "./ChatPreview.css";

import { useLayoutEffect, useRef } from "preact/hooks";

import ChatMessage from "./ChatMessage.js";
import { materializeChatHighlights } from "./chat_highlights_static.js";
import type { StoredMessage } from "./llm_chat_types.js";

/**
 * Read-only render of a stored conversation, used by the note preview renderer (collection
 * tiles, tooltips, printing — see content_renderer). Reuses {@link ChatMessage} so markdown, tool
 * calls, thinking, citations and attachments render exactly as in the live timeline — but with no
 * input bar, context menu, scroll button, or read-only notice: just the conversation.
 */
export default function ChatPreview({ messages }: { messages: StoredMessage[] }) {
    const containerRef = useRef<HTMLDivElement>(null);

    // The live chat paints highlights over ranges, which leaves nothing in the markup for a preview
    // to show (or a tooltip to serialize, or a printer to print). Re-apply them here as elements.
    // A layout effect, so the marks are in place before the tooltip snapshots the preview.
    useLayoutEffect(() => {
        if (containerRef.current) {
            materializeChatHighlights(containerRef.current, messages);
        }
    }, [messages]);

    return (
        <div className="llm-chat-preview" ref={containerRef}>
            {messages.map((message) => (
                <ChatMessage key={message.id} message={message} />
            ))}
        </div>
    );
}
