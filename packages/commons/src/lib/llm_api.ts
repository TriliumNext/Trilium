/**
 * Shared LLM types for chat integration.
 * Used by both client and server for API communication.
 */

/**
 * A chat message in the conversation.
 */
export interface LlmMessage {
    role: "user" | "assistant" | "system";
    content: string;
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
}

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
    | { type: "tool_use"; toolName: string; toolInput: Record<string, unknown> }
    | { type: "tool_result"; toolName: string; result: string; isError?: boolean }
    | { type: "citation"; citation: LlmCitation }
    | { type: "usage"; usage: LlmUsage }
    | { type: "error"; error: string }
    | { type: "done" };
