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
 * How much a model reasons before it answers, weakest first. The names are the
 * AI SDK's `reasoning` call option, plus Anthropic's `max`.
 */
export const LLM_REASONING_EFFORTS = [ "none", "minimal", "low", "medium", "high", "xhigh", "max" ] as const;

export type LlmReasoningEffort = (typeof LLM_REASONING_EFFORTS)[number];

/**
 * Configuration for LLM chat requests.
 */
export interface LlmChatConfig {
    /** Provider type (e.g. "anthropic"). Kept for chats saved before {@link providerId} existed. */
    provider?: string;
    /**
     * ID of the provider configuration to route through. Preferred over
     * {@link provider} — it disambiguates multiple configs of the same type
     * (e.g. a real OpenAI key plus a self-hosted Ollama endpoint).
     */
    providerId?: string;
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
    /**
     * Reasoning effort for a model that lists {@link LlmModelInfo.reasoningEfforts}. Takes the
     * place of {@link enableExtendedThinking} for such a model; absent means the model's
     * {@link LlmModelInfo.defaultReasoningEffort}.
     */
    reasoningEffort?: LlmReasoningEffort;
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
    /** ID of the provider configuration this model was listed from */
    providerId?: string;
    /** User-given name of the provider configuration (e.g. "My Ollama") */
    providerName?: string;
    /** Pricing per million tokens. Absent for dynamically discovered models with unknown pricing. */
    pricing?: LlmModelPricing;
    /** Whether this is the default model */
    isDefault?: boolean;
    /** Whether this is a legacy/older model */
    isLegacy?: boolean;
    /** Whether this model is pre-selected by default when adding a provider (e.g. excludes legacy and, for Gemini, preview models) */
    recommended?: boolean;
    /** Maximum context window size in tokens */
    contextWindow?: number;
    /** Whether usage is covered by a subscription plan rather than metered per token */
    isSubscription?: boolean;
    /**
     * The reasoning efforts the model can be run at, weakest first. Absent for a model with no
     * graded setting, which keeps the on/off extended thinking switch instead.
     */
    reasoningEfforts?: LlmReasoningEffort[];
    /** The effort used when a chat has not chosen one. One of {@link reasoningEfforts}. */
    defaultReasoningEffort?: LlmReasoningEffort;
}

/**
 * Token usage information from the LLM response.
 */
export interface LlmUsage {
    /** The token counts are absent when the provider reports none, as the ACP agents (Copilot, Antigravity) do. */
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    /** Estimated cost in USD (if available) */
    cost?: number;
    /** Model identifier used for this response */
    model?: string;
    /**
     * Provider *type* that served the response ("anthropic", "deepseek", …), not the id of a
     * particular configuration. Recorded alongside the model so the client can abbreviate the
     * name for display: which vendor word is safe to drop depends on the vendor. The full
     * name is what gets stored — shortening is applied at render time only.
     */
    provider?: string;
}

/**
 * Machine-readable context for a failed provider call, carried alongside the
 * human-readable error message of an `error` chunk.
 *
 * Kept as separate fields rather than pre-formatted into the message so the client
 * can title the failure ("API error (HTTP 400)"), collapse the noisy parts behind a
 * "show details" toggle, and drop a response body that only repeats the message.
 * Absent for failures that never reached a provider (connection errors, aborted
 * streams) and for chats saved before this field existed.
 */
export interface LlmErrorDetails {
    /** HTTP status returned by the provider. */
    statusCode?: number;
    /** Endpoint the failed request was sent to. */
    url?: string;
    /** Raw response body, truncated by the server to a display-safe length. */
    responseBody?: string;
}

/**
 * What a turn is waiting on before its reply starts. The client names it in
 * the chat until the first content of the reply arrives.
 *   - `starting_agent`: a subscription agent's CLI is being started.
 */
export type LlmStreamStatus = "starting_agent";

/**
 * Stream chunk types for real-time SSE updates.
 * Defines the protocol between server and client.
 */
export type LlmStreamChunk =
    | { type: "status"; status: LlmStreamStatus }
    | { type: "text"; content: string }
    | { type: "thinking"; content: string }
    | { type: "tool_input_start"; toolCallId: string; toolName: string }
    | { type: "tool_input_delta"; toolCallId: string; delta: string }
    | { type: "tool_use"; toolCallId: string; toolName: string; toolInput: Record<string, unknown> }
    | { type: "tool_result"; toolCallId: string; toolName: string; result: string; isError?: boolean }
    | { type: "citation"; citation: LlmCitation }
    | { type: "usage"; usage: LlmUsage }
    | { type: "error"; error: string; errorDetails?: LlmErrorDetails }
    | { type: "done" };
