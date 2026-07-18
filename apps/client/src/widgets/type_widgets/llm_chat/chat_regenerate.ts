import type { StoredMessage } from "./llm_chat_types.js";

/**
 * Whether the "Regenerate" command should be offered for a right-clicked message: only with no text
 * selection, not mid-stream, and only for the conversation's last message when it's an assistant reply
 * (there must be a preceding user turn to re-run from).
 */
export function canRegenerate(hasSelection: boolean, message: StoredMessage | undefined, messages: StoredMessage[], isStreaming: boolean): boolean {
    if (hasSelection || isStreaming || message?.role !== "assistant") return false;
    const last = messages[messages.length - 1];
    return last?.id === message.id && messages.some(m => m.role === "user");
}

/**
 * The conversation to re-run when regenerating: everything up to and including the last user message,
 * dropping the reply that followed it (its text and any separate "thinking" message). Returns null if
 * there's no user message to run from.
 */
export function conversationForRegenerate(messages: StoredMessage[]): StoredMessage[] | null {
    const lastUserIndex = messages.map(m => m.role).lastIndexOf("user");
    return lastUserIndex < 0 ? null : messages.slice(0, lastUserIndex + 1);
}
