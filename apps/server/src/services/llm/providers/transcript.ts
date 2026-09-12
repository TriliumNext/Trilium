/**
 * Transcript helpers shared by the session-based agent providers (Claude
 * Agent, Copilot Agent). These providers own their conversation history in
 * host-side sessions, so they need a stable way to detect whether the
 * transcript the client sent still matches a mapped session (hash) and to
 * reseed a fresh session when it doesn't (replay).
 */

import type { LlmFilePart, LlmImagePart, LlmMessage, LlmMessagePart, LlmTextAttachmentPart } from "@triliumnext/commons";
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

/** Short "[attached …]" stand-in used wherever an attachment's bytes aren't sent. */
export function attachmentPlaceholder(part: LlmImagePart | LlmFilePart | LlmTextAttachmentPart): string {
    const kind = part.type === "image" ? "image" : "file";
    const name = "filename" in part ? `: ${part.filename}` : "";
    return `[attached ${kind}${name}]`;
}
