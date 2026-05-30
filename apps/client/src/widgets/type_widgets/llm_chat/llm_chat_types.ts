import type { LlmCitation, LlmUsage } from "@triliumnext/commons";

export type MessageType = "message" | "error" | "thinking";

export interface ToolCall {
    id: string;
    toolName: string;
    input: Record<string, unknown>;
    /**
     * Raw JSON arguments accumulated from `tool_input_delta` chunks while the call's input
     * is still streaming. Cleared once the parsed `input` arrives via the `tool_use` chunk.
     */
    inputStreaming?: string;
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

/**
 * An image attached to a user message, stored as a reference to a Trilium
 * attachment (uploaded to the chat note). The server resolves the bytes from
 * Becca before forwarding to the LLM provider.
 */
export interface ImageBlock {
    type: "image";
    attachmentId: string;
    mime: string;
    title: string;
    /** URL for inline display in the UI (e.g. `api/attachments/<id>/image/<title>`). */
    url: string;
}

/**
 * A non-image file attached to a user message (e.g. a PDF). Stored as a
 * reference to a Trilium attachment; the server resolves the bytes before
 * forwarding to the provider as an AI SDK `FilePart`.
 */
export interface FileBlock {
    type: "file";
    attachmentId: string;
    mime: string;
    title: string;
    /** URL pointing back at the attachment's note view. */
    url: string;
}

/**
 * A text-based file attached to a user message (e.g. `.md`, `.json`, source
 * code). The server decodes the UTF-8 content and inlines it as a text part,
 * so the LLM sees the file contents directly — works on every provider but
 * inflates the prompt by the file size in tokens.
 */
export interface TextFileBlock {
    type: "text_file";
    attachmentId: string;
    mime: string;
    title: string;
    /** URL pointing back at the attachment's note view. */
    url: string;
}

/** An ordered content block in a chat message. */
export type ContentBlock = TextBlock | ToolCallBlock | ImageBlock | FileBlock | TextFileBlock;

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
