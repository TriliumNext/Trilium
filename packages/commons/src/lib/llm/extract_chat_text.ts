/**
 * Extracts the plain conversation text from an LLM chat note's JSON content for
 * full-text search indexing. An `llmChat` note stores its whole conversation as a
 * single `application/json` blob (see `LlmChatContent` in the client's `llm_chat_types`);
 * search must surface the readable prose, not the surrounding JSON metadata (roles,
 * timestamps, tool-call bookkeeping, attachment references).
 *
 * Only user/assistant/system prose is kept: thinking and error turns, tool calls, and
 * image/file references are skipped. Returns an empty string for invalid or empty content.
 *
 * The search preprocessor runs `normalize()` (lowercase + diacritic removal) on the raw
 * content before calling this, so both keys and values arrive lowercased — the keys accessed
 * here (`messages`, `content`, `type`) are already lowercase in the source, so this keeps
 * working either way.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Parses the raw JSON content of an `llmChat` note and returns the conversation's
 * readable text as a single space-separated string.
 */
export function extractLlmChatText(jsonContent: string): string {
    let data: any;
    try {
        data = JSON.parse(jsonContent);
    } catch {
        return "";
    }

    const messages = data?.messages;
    if (!Array.isArray(messages)) {
        return "";
    }

    const parts: string[] = [];
    for (const message of messages) {
        // Skip internal reasoning and error turns — they are not part of the conversation.
        if (message?.type === "thinking" || message?.type === "error") {
            continue;
        }

        const text = extractMessageText(message?.content);
        if (text) {
            parts.push(text);
        }
    }

    return parts.join(" ").trim();
}

/** Flattens a message's content (plain string or ordered content blocks) to its text. */
function extractMessageText(content: any): string {
    if (typeof content === "string") {
        return content;
    }
    if (!Array.isArray(content)) {
        return "";
    }

    // Keep only text blocks; drop tool calls and image/file references.
    return content
        .filter((block: any) => block?.type === "text" && typeof block.content === "string")
        .map((block: any) => block.content)
        .join(" ");
}
