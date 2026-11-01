import type { StoredMessage } from "./llm_chat_types.js";

/**
 * Whether the "Delete message" command should be offered for a right-clicked message: only with no
 * active text selection (a selection means the selection commands apply), only for a real message,
 * and never mid-stream — the in-flight reply is finalized from a pre-stream snapshot, which would
 * resurrect a message deleted while it runs.
 */
export function canDeleteMessage(hasSelection: boolean, message: StoredMessage | undefined, isStreaming: boolean): boolean {
    return !isStreaming && !hasSelection && !!message;
}

/** Remove the message with `messageId` from the conversation, leaving the rest in order. */
export function removeMessage(messages: StoredMessage[], messageId: string): StoredMessage[] {
    return messages.filter(message => message.id !== messageId);
}
