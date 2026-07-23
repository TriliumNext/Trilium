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
 * A resolved knowledge base source note. Order matches the numbered
 * reference list injected into the system prompt.
 */
export interface KnowledgeBaseSource {
    noteId: string;
    title: string;
}

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
    /** Pricing per million tokens */
    pricing: ModelPricing;
    /** Whether this is the default model */
    isDefault?: boolean;
    /** Cost multiplier relative to the cheapest model (1x = cheapest) */
    costMultiplier?: number;
    /** Maximum context window size in tokens */
    contextWindow?: number;
    /** Whether this is a legacy/older model */
    isLegacy?: boolean;
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
     */
    getAvailableModels(): ModelInfo[];

    /**
     * Generate a short title summarizing a message.
     * Used for auto-renaming chat notes. Should use a fast, cheap model.
     */
    generateTitle(firstMessage: string): Promise<string>;
}
