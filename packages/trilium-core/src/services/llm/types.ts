/**
 * Server-specific LLM Provider types.
 * Shared types (LlmMessage, LlmCitation, LlmStreamChunk, LlmChatConfig)
 * should be imported from @triliumnext/commons.
 */

import type { LlmChatConfig, LlmMessage, LlmStreamChunk } from "@triliumnext/commons";
import type { streamText } from "ai";

/**
 * Extended provider config with server-specific options.
 */
export interface LlmProviderConfig extends LlmChatConfig {
    maxTokens?: number;
    temperature?: number;
}

/**
 * Result type from streamText - the AI SDK's unified streaming interface.
 */
export type StreamResult = ReturnType<typeof streamText>;

/**
 * Pricing per million tokens for a model.
 */
export interface ModelPricing {
    /** Cost per million input tokens in USD */
    input: number;
    /** Cost per million output tokens in USD */
    output: number;
}

/**
 * Information about an available model.
 */
export interface ModelInfo {
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
    pricing?: ModelPricing;
    /** Whether this is the default model */
    isDefault?: boolean;
    /** Maximum context window size in tokens */
    contextWindow?: number;
    /** Whether this is a legacy/older model */
    isLegacy?: boolean;
    /** Whether this model is pre-selected by default when adding a provider (e.g. excludes legacy and, for Gemini, preview models) */
    recommended?: boolean;
    /** Whether usage is covered by a subscription plan rather than metered per token */
    isSubscription?: boolean;
}

export interface LlmProvider {
    name: string;

    /**
     * Create a streaming chat completion.
     * Returns the AI SDK StreamResult which is provider-agnostic.
     */
    chat(
        messages: LlmMessage[],
        config: LlmProviderConfig
    ): StreamResult;

    /**
     * Chunk-native alternative to {@link chat} for providers that don't go
     * through the AI SDK (e.g. the Claude Agent provider, which runs its own
     * agentic loop in a subprocess). When implemented, the chat route streams
     * these chunks directly and skips the AI SDK conversion entirely.
     *
     * @param signal aborts the underlying agent turn when the client disconnects
     */
    chatChunks?(
        messages: LlmMessage[],
        config: LlmProviderConfig,
        signal?: AbortSignal
    ): AsyncIterable<LlmStreamChunk>;

    /**
     * Get pricing for a model. Returns undefined if pricing is not available.
     */
    getModelPricing(model: string): ModelPricing | undefined;

    /**
     * Get list of available models for this provider.
     *
     * This is the static, curated list — instant and offline-safe. Used for
     * default-model and display-name lookups, and as the fallback when dynamic
     * listing is unavailable or fails.
     */
    getAvailableModels(): ModelInfo[];

    /**
     * Dynamically list the models actually available on the provider's
     * endpoint, merged with curated metadata (names, pricing, context windows)
     * where known. Optional — providers with a fixed catalog (agent/subscription
     * providers) omit it and callers fall back to {@link getAvailableModels}.
     *
     * Returns the curated list when dynamic listing is unsupported, but a
     * listing *failure* (bad credentials, unreachable endpoint) rejects so the
     * add/edit-provider screen can surface it instead of masking a bad
     * credential as success.
     */
    listModels?(): Promise<ModelInfo[]>;

    /**
     * Of a listed model set, the ids pre-selected by default when the provider
     * is added or its selection reset. Lives on the provider because the rule is
     * provider-specific (OpenAI and Anthropic read a recency signal out of their
     * id shapes; everything else falls back to non-preview, non-legacy), and so
     * the model picker can stay rule-free and just honour the flag.
     */
    recommendedModelIds(models: ModelInfo[]): Set<string>;

    /**
     * Generate a short title summarizing a message.
     * Used for auto-renaming chat notes. Should use a fast, cheap model.
     */
    generateTitle(firstMessage: string): Promise<string>;
}
