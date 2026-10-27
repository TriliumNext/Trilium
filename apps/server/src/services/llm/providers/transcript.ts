/**
 * Transcript helpers shared by the session-based agent providers (Claude
 * Agent and the ACP agents). These providers own their conversation history in
 * host-side sessions, so they need a stable way to detect whether the
 * transcript the client sent still matches a mapped session (hash), to
 * reseed a fresh session when it doesn't (replay), and to name chats in a
 * session that several titles share.
 */

import type { LlmMessage, LlmMessagePart } from "@triliumnext/commons";
import { attachmentPlaceholder } from "@triliumnext/core/src/services/llm/attachment_content.js";
import { createHash } from "crypto";

/**
 * Stable hash of a transcript (roles + text only). Used to detect whether the
 * history the client sent still matches what the mapped agent session saw.
 */
export function hashTranscript(messages: LlmMessage[]): string {
    const normalized = messages.map(m => [m.role, flattenContent(m.content).trim()]);
    return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

/**
 * First prompt of a reseeded session: replays the retained transcript as
 * context so the agent can continue a conversation whose session was lost or
 * diverged (edited history, server restart).
 */
export function buildSeededPrompt(history: LlmMessage[], lastText: string): string {
    return `${buildHistoryReplay(history)}\n\n${lastText}`;
}

/** The `<conversation_history>` replay block, without any trailing user message. */
export function buildHistoryReplay(history: LlmMessage[]): string {
    const transcript = history
        .map(m => `${m.role === "user" ? "User" : "Assistant"}: ${flattenContent(m.content)}`)
        .join("\n\n");
    return `<conversation_history>\nThis is the prior conversation between the user and you. Continue it naturally; do not mention this replay.\n\n${transcript}\n</conversation_history>`;
}

/** Flatten possibly-multimodal message content to plain text (attachments as placeholders). */
export function flattenContent(content: string | LlmMessagePart[]): string {
    if (typeof content === "string") {
        return content;
    }
    return content
        .map(part => (part.type === "text" ? part.text : attachmentPlaceholder(part)))
        .join("\n");
}

/**
 * Titles one session answers before it is replaced. Titles share a session to
 * skip the session start (~2.5 s on Antigravity, which also keeps every session
 * on disk); the cap bounds the history each title prompt carries.
 */
export const MAX_TITLES_PER_SESSION = 20;

/** The prompt that names a chat after its first message, in a session shared by earlier titles. */
export function buildTitlePrompt(firstMessage: string): string {
    return `Generate a short title (at most 5 words) summarizing the chat message below. It is a new request: earlier messages in this conversation do not apply. Reply with only the title, no quotes or punctuation around it:

${firstMessage.substring(0, 500)}`;
}

/** The agent's title reply without surrounding whitespace or quotes, capped at 100 characters. */
export function cleanTitle(reply: string): string {
    return reply.trim().replace(/^["']|["']$/g, "").substring(0, 100);
}
