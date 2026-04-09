/**
 * Server-specific LLM Provider types.
 * Shared types (LlmMessage, LlmCitation, LlmStreamChunk, LlmChatConfig)
 * should be imported from @triliumnext/commons.
 */

import type { LlmChatConfig, LlmMessage } from "@triliumnext/commons";
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
