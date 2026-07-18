/**
 * Shared streaming utilities for converting AI SDK streams to SSE chunks.
 */

import type { LlmStreamChunk } from "@triliumnext/commons";

import type { KnowledgeBaseSource, ModelPricing, StreamResult } from "./types.js";

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
    /** Knowledge base sources, in the same order as numbered in the system prompt. */
    knowledgeBaseSources?: KnowledgeBaseSource[];
}

/**
 * Find which knowledge base sources were cited in the response text via
 * inline Harvard-style markers ([1], [2], …) and return them as citations.
 * Source numbering matches the reference list injected into the system prompt.
 */
function collectKbCitations(text: string, sources: KnowledgeBaseSource[]): LlmStreamChunk[] {
    const citedNumbers = new Set<number>();
    for (const match of text.matchAll(/\[(\d{1,2})\]/g)) {
        citedNumbers.add(Number(match[1]));
    }

    const chunks: LlmStreamChunk[] = [];
    for (const num of [...citedNumbers].sort((a, b) => a - b)) {
        const source = sources[num - 1];
        if (source) {
            chunks.push({
                type: "citation",
                citation: { noteId: source.noteId, title: source.title }
            });
        }
    }
    return chunks;
}

/**
 * Convert an AI SDK StreamResult to an async iterable of LlmStreamChunk.
 * This is provider-agnostic - works with any AI SDK provider.
 */
export async function* streamToChunks(result: StreamResult, options: StreamOptions = {}): AsyncIterable<LlmStreamChunk> {
    let fullText = "";

    try {
        for await (const part of result.fullStream) {
            switch (part.type) {
                case "text-delta":
                    fullText += part.text;
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

        // Emit citations for knowledge base sources referenced in the response
        if (options.knowledgeBaseSources?.length) {
            yield* collectKbCitations(fullText, options.knowledgeBaseSources);
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
