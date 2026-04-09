import type { LlmCitation, LlmUsage } from "@triliumnext/commons";

export type MessageType = "message" | "error" | "thinking";

export interface ToolCall {
    id: string;
    toolName: string;
    input: Record<string, unknown>;
    result?: string;
    isError?: boolean;
}

/** A block of text content (rendered as Markdown for assistant messages). */
export interface TextBlock {
    type: "text";
    content: string;
}

/** A tool invocation block shown inline in the message timeline. */
export interface ToolCallBlock {
    type: "tool_call";
    toolCall: ToolCall;
}

/** An ordered content block in an assistant message. */
export type ContentBlock = TextBlock | ToolCallBlock;

/**
 * Extract the plain text from message content (works for both legacy string and block formats).
 */
export function getMessageText(content: string | ContentBlock[]): string {
    if (typeof content === "string") {
        return content;
    }
    return content
        .filter((b): b is TextBlock => b.type === "text")
        .map(b => b.content)
        .join("");
}

/**
 * Extract tool calls from message content blocks.
 */
export function getMessageToolCalls(message: StoredMessage): ToolCall[] {
    if (Array.isArray(message.content)) {
        return message.content
            .filter((b): b is ToolCallBlock => b.type === "tool_call")
            .map(b => b.toolCall);
    }
    return [];
}

export interface StoredMessage {
    id: string;
    role: "user" | "assistant" | "system";
    /** Message content: plain string (user messages, legacy) or ordered content blocks (assistant). */
    content: string | ContentBlock[];
    createdAt: string;
    citations?: LlmCitation[];
    /** Message type for special rendering. Defaults to "message" if omitted. */
    type?: MessageType;
    /** Token usage for this response */
    usage?: LlmUsage;
}

export interface LlmChatContent {
    version: 1;
    messages: StoredMessage[];
    selectedModel?: string;
    enableWebSearch?: boolean;
    enableNoteTools?: boolean;
    enableExtendedThinking?: boolean;
}
