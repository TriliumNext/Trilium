/**
 * Shared streaming utilities for converting AI SDK streams to SSE chunks.
 */

import type { LlmStreamChunk } from "@triliumnext/commons";
import { APICallError, type LanguageModelUsage } from "ai";

import type { KnowledgeBaseSource, ModelPricing, StreamResult } from "./types.js";

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
    const cacheReadTokens = details?.cacheReadTokens ?? 0;
    const cacheWriteTokens = details?.cacheWriteTokens ?? 0;
    // The sole caller only invokes calculateCost once it has type-guarded both
    // inputTokens and outputTokens as numbers, so the `?? 0` fallbacks here are
    // unreachable defensive normalisation.
    /* v8 ignore next */
    const inputTokens = usage.inputTokens ?? 0;
    const noCacheInputTokens = details?.noCacheTokens
        ?? Math.max(0, inputTokens - cacheReadTokens - cacheWriteTokens);
    /* v8 ignore next */
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
    /** Knowledge base sources, in the same order as numbered in the system prompt. */
    knowledgeBaseSources?: KnowledgeBaseSource[];
}

/**
 * Find which knowledge base sources were cited in the response text via
 * inline Harvard-style markers ([1], [2], …) and return them as citations.
 * Source numbering matches the reference list injected into the system prompt.
 */
function collectKbCitations(text: string, sources: KnowledgeBaseSource[]): LlmStreamChunk[] {
    // Strip fenced code blocks and inline code first — bracketed numbers there
    // are array subscripts or similar, not citations.
    const prose = text
        .replace(/```[\s\S]*?```/g, " ")
        .replace(/`[^`\n]*`/g, " ");

    const citedNumbers = new Set<number>();
    for (const match of prose.matchAll(/\[(\d{1,2})\]/g)) {
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
 * Build a detailed, single-line description of an error coming out of the AI SDK.
 *
 * AI SDK `APICallError`s carry the HTTP status, the URL that was called and the raw
 * response body. Surfacing those turns an opaque "Not Found" into something
 * actionable — e.g. a `404` against `http://localhost:8080/messages` immediately
 * reveals a misconfigured provider base URL. Plain errors fall back to name + message.
 */
export function describeStreamError(error: unknown): string {
    if (APICallError.isInstance(error)) {
        const detail: string[] = [];
        if (typeof error.statusCode === "number") {
            detail.push(`HTTP ${error.statusCode}`);
        }
        if (error.url) {
            detail.push(`URL ${error.url}`);
        }
        if (error.responseBody) {
            // Response bodies for errors are normally tiny JSON payloads; cap defensively.
            const body = error.responseBody.length > 500
                ? `${error.responseBody.slice(0, 500)}…`
                : error.responseBody;
            detail.push(`response: ${body}`);
        }
        const suffix = detail.length > 0 ? ` (${detail.join(", ")})` : "";
        return `${error.name}: ${error.message}${suffix}`;
    }
    if (error instanceof Error) {
        return `${error.name}: ${error.message}`;
    }
    return String(error);
}

/**
 * Convert an AI SDK StreamResult to an async iterable of LlmStreamChunk.
 * This is provider-agnostic - works with any AI SDK provider.
 */
export async function* streamToChunks(result: StreamResult, options: StreamOptions = {}): AsyncIterable<LlmStreamChunk> {
    let fullText = "";
    let errorEmitted = false;
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

                case "tool-input-start":
                    yield {
                        type: "tool_input_start",
                        toolCallId: part.id,
                        toolName: part.toolName
                    };
                    break;

                case "tool-input-delta":
                    yield {
                        type: "tool_input_delta",
                        toolCallId: part.id,
                        delta: part.delta
                    };
                    break;

                case "tool-call":
                    yield {
                        type: "tool_use",
                        toolCallId: part.toolCallId,
                        toolName: part.toolName,
                        toolInput: part.input as Record<string, unknown>
                    };
                    break;

                case "tool-result": {
                    const output = part.output;
                    const isError = typeof output === "object" && output !== null && "error" in output;
                    yield {
                        type: "tool_result",
                        toolCallId: part.toolCallId,
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
                    errorEmitted = true;
                    yield { type: "error", error: describeStreamError(part.error) };
                    break;
            }
        }

        // Emit citations for knowledge base sources referenced in the response
        if (options.knowledgeBaseSources?.length) {
            yield* collectKbCitations(fullText, options.knowledgeBaseSources);
        }

        // Get usage information after the stream completes. Use `totalUsage`, which
        // aggregates token usage across every step of the agentic loop — `usage` only
        // reports the final step, undercounting cost on turns that involve tool calls.
        // When the stream produced no steps, the AI SDK rejects `totalUsage` with a
        // generic NoOutputGeneratedError ("No output generated. Check the stream for
        // errors."). If a real error was already emitted above, that earlier error is
        // the actual cause — don't mask it with the generic one.
        let usage: LanguageModelUsage;
        try {
            usage = await result.totalUsage;
        } catch (error) {
            if (!errorEmitted) {
                yield { type: "error", error: describeStreamError(error) };
            }
            return;
        }

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
        if (!errorEmitted) {
            yield { type: "error", error: describeStreamError(error) };
        }
    }
}
