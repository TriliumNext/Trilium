/**
 * Shared LLM types for chat integration.
 * Used by both client and server for API communication.
 */

/**
 * Plain-text segment of a multimodal message.
 */
export interface LlmTextPart {
    type: "text";
    text: string;
}

/**
 * Image segment of a multimodal message. The image is referenced by its
 * Trilium attachment ID — the server loads the bytes from Becca before
 * forwarding to the provider, so the wire stays small and we don't store
 * base64 in chat history.
 */
export interface LlmImagePart {
    type: "image";
    attachmentId: string;
    /** IANA media type (e.g. "image/png"). */
    mime: string;
}

/**
 * File segment of a multimodal message (e.g. a PDF). Like image parts, the
 * file is referenced by its Trilium attachment ID and resolved to bytes
 * server-side. Provider support varies by MIME type — PDFs (`application/pdf`)
 * are handled natively by Anthropic, OpenAI, and Google.
 */
export interface LlmFilePart {
    type: "file";
    attachmentId: string;
    mime: string;
    filename: string;
}

/**
 * Text-file segment of a multimodal message (e.g. a `.md`, `.json`, source
 * code). Unlike `LlmFilePart`, the server inlines the decoded UTF-8 content
 * as a plain `TextPart` so it works with every provider regardless of file
 * upload support — the trade-off is that large files inflate token usage.
 */
export interface LlmTextAttachmentPart {
    type: "text_attachment";
    attachmentId: string;
    filename: string;
}

export type LlmMessagePart = LlmTextPart | LlmImagePart | LlmFilePart | LlmTextAttachmentPart;

/**
 * A chat message in the conversation. `content` may be a plain string (the
 * common case) or an ordered array of parts when the message includes images.
 */
export interface LlmMessage {
    role: "user" | "assistant" | "system";
    content: string | LlmMessagePart[];
}

/**
 * Citation information extracted from LLM responses.
 * May include URL (for web search) or document metadata (for document citations).
 */
export interface LlmCitation {
    /** Source URL (typically from web search) */
    url?: string;
    /** Document or page title */
    title?: string;
    /** The text that was cited */
    citedText?: string;
}

/**
 * Configuration for LLM chat requests.
 */
export interface LlmChatConfig {
    provider?: string;
    model?: string;
    systemPrompt?: string;
    /** Enable web search tool */
    enableWebSearch?: boolean;
    /** Enable note tools (search and read notes) */
    enableNoteTools?: boolean;
    /** Enable extended thinking for deeper reasoning */
    enableExtendedThinking?: boolean;
    /** Token budget for extended thinking (default: 10000) */
    thinkingBudget?: number;
    /** Current note context (note ID the user is viewing) */
    contextNoteId?: string;
    /** The note ID of the chat note (used for auto-renaming on first message) */
    chatNoteId?: string;
    /**
     * How mutating (write) tool calls are handled:
     * - "ask" (default): the client must approve each mutating tool call
     * - "auto": mutating tools execute automatically without approval
     */
    toolPermissionMode?: ToolPermissionMode;
}

export type ToolPermissionMode = "ask" | "auto";

/**
 * Pricing per million tokens for a model.
 */
export interface LlmModelPricing {
    /** Cost per million input tokens in USD */
    input: number;
    /** Cost per million output tokens in USD */
    output: number;
}

/**
 * Information about an available LLM model.
 */
export interface LlmModelInfo {
    /** Model identifier (e.g., "claude-sonnet-4-20250514") */
    id: string;
    /** Human-readable name (e.g., "Claude Sonnet 4") */
    name: string;
    /** Provider type that owns this model (e.g., "anthropic", "openai") */
    provider?: string;
    /** Pricing per million tokens */
    pricing: LlmModelPricing;
    /** Whether this is the default model */
    isDefault?: boolean;
    /** Whether this is a legacy/older model */
    isLegacy?: boolean;
    /** Cost multiplier relative to the cheapest model (1x = cheapest) */
    costMultiplier?: number;
    /** Maximum context window size in tokens */
    contextWindow?: number;
    /** Whether usage is covered by a subscription plan rather than metered per token */
    isSubscription?: boolean;
}

/**
 * Token usage information from the LLM response.
 */
export interface LlmUsage {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    /** Estimated cost in USD (if available) */
    cost?: number;
    /** Model identifier used for this response */
    model?: string;
}

/**
 * Stream chunk types for real-time SSE updates.
 * Defines the protocol between server and client.
 */
export type LlmStreamChunk =
    | { type: "text"; content: string }
    | { type: "thinking"; content: string }
    | { type: "tool_input_start"; toolCallId: string; toolName: string }
    | { type: "tool_input_delta"; toolCallId: string; delta: string }
    | { type: "tool_use"; toolCallId: string; toolName: string; toolInput: Record<string, unknown> }
    | { type: "tool_result"; toolCallId: string; toolName: string; result: string; isError?: boolean }
    | { type: "citation"; citation: LlmCitation }
    | { type: "usage"; usage: LlmUsage }
    | { type: "error"; error: string }
    | { type: "done" };
