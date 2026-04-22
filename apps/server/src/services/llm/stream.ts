/**
 * Shared streaming utilities for converting AI SDK streams to SSE chunks.
 */

import type { LlmStreamChunk } from "@triliumnext/commons";

import type { ModelPricing, StreamResult } from "./types.js";

/**
 * Calculate estimated cost in USD based on token usage and pricing.
 */
function calculateCost(inputTokens: number, outputTokens: number, pricing?: ModelPricing): number | undefined {
    if (!pricing) return undefined;

    const inputCost = (inputTokens / 1_000_000) * pricing.input;
    const outputCost = (outputTokens / 1_000_000) * pricing.output;

    return inputCost + outputCost;
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
            const cost = calculateCost(usage.inputTokens, usage.outputTokens, options.pricing);
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
