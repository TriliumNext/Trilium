/**
 * Shared streaming utilities for converting AI SDK streams to SSE chunks.
 */

import type { LlmStreamChunk } from "@triliumnext/commons";
import type { LanguageModelUsage } from "ai";

import type { ModelPricing, StreamResult } from "./types.js";

// Cache pricing assumes Anthropic's 5-min ephemeral rates (writes 1.25× input, reads 0.1× input).
// OpenAI/Gemini bill caches differently but the gap is small compared to the current behaviour
// of treating cached tokens at full input price.
const CACHE_WRITE_MULTIPLIER = 1.25;
const CACHE_READ_MULTIPLIER = 0.1;

/**
 * Calculate estimated cost in USD based on token usage and pricing.
 * Accounts for cache read/write pricing tiers when the provider reports them;
 * reasoning tokens are already included in `outputTokens` per the AI SDK.
 */
function calculateCost(usage: LanguageModelUsage, pricing?: ModelPricing): number | undefined {
    if (!pricing) return undefined;

    const details = usage.inputTokenDetails;
    const cacheReadTokens = details?.cacheReadTokens ?? usage.cachedInputTokens ?? 0;
    const cacheWriteTokens = details?.cacheWriteTokens ?? 0;
    const noCacheInputTokens = details?.noCacheTokens
        ?? Math.max(0, (usage.inputTokens ?? 0) - cacheReadTokens - cacheWriteTokens);
    const outputTokens = usage.outputTokens ?? 0;

    const M = 1_000_000;
    return (
        (noCacheInputTokens / M) * pricing.input
        + (cacheReadTokens / M) * pricing.input * CACHE_READ_MULTIPLIER
        + (cacheWriteTokens / M) * pricing.input * CACHE_WRITE_MULTIPLIER
        + (outputTokens / M) * pricing.output
    );
}

export interface StreamOptions {
    /** Model identifier for display */
    model?: string;
    /** Model pricing for cost calculation (from provider) */
    pricing?: ModelPricing;
}

/**
 * Convert an AI SDK StreamResult to an async iterable of LlmStreamChunk.
 * This is provider-agnostic - works with any AI SDK provider.
 */
export async function* streamToChunks(result: StreamResult, options: StreamOptions = {}): AsyncIterable<LlmStreamChunk> {
    try {
        for await (const part of result.fullStream) {
            switch (part.type) {
                case "text-delta":
                    yield { type: "text", content: part.text };
                    break;

                case "reasoning-delta":
                    yield { type: "thinking", content: part.text };
                    break;

                case "tool-call":
                    yield {
                        type: "tool_use",
                        toolName: part.toolName,
                        toolInput: part.input as Record<string, unknown>
                    };
                    break;

                case "tool-result": {
                    const output = part.output;
                    const isError = typeof output === "object" && output !== null && "error" in output;
                    yield {
                        type: "tool_result",
                        toolName: part.toolName,
                        result: typeof output === "string"
                            ? output
                            : JSON.stringify(output),
                        isError
                    };
                    break;
                }

                case "source":
                    // Citation from web search (only URL sources have url property)
                    if (part.sourceType === "url") {
                        yield {
                            type: "citation",
                            citation: {
                                url: part.url,
                                title: part.title
                            }
                        };
                    }
                    break;

                case "error":
                    yield { type: "error", error: String(part.error) };
                    break;
            }
        }

        // Get usage information after stream completes
        const usage = await result.usage;
        if (usage && typeof usage.inputTokens === "number" && typeof usage.outputTokens === "number") {
            const cost = calculateCost(usage, options.pricing);
            yield {
                type: "usage",
                usage: {
                    promptTokens: usage.inputTokens,
                    completionTokens: usage.outputTokens,
                    totalTokens: usage.inputTokens + usage.outputTokens,
                    cost,
                    model: options.model
                }
            };
        }

        yield { type: "done" };
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        yield { type: "error", error: message };
    }
}
