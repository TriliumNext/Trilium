/**
 * Shared streaming utilities for converting AI SDK streams to SSE chunks.
 */

import type { LlmErrorDetails, LlmStreamChunk } from "@triliumnext/commons";
import { APICallError, type LanguageModelUsage } from "ai";

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
    /** Provider type that served the response, reported with usage so the client can abbreviate the model name */
    provider?: string;
    /** Model pricing for cost calculation (from provider) */
    pricing?: ModelPricing;
}

/** Longest response body forwarded to the client; error bodies are normally tiny JSON payloads. */
const MAX_RESPONSE_BODY_LENGTH = 500;

/**
 * Describe an error coming out of the AI SDK as a message plus its machine-readable
 * context.
 *
 * AI SDK `APICallError`s carry the HTTP status, the URL that was called and the raw
 * response body. Surfacing those turns an opaque "Not Found" into something
 * actionable — e.g. a `404` against `http://localhost:8080/messages` immediately
 * reveals a misconfigured provider base URL. They are kept *beside* the message
 * rather than appended to it so the chat UI can title the failure and hide the noise
 * behind a details toggle; {@link formatStreamError} rejoins them for the log.
 *
 * The error's class name (`AI_APICallError`) is deliberately dropped: it names an SDK
 * internal, and the status it stands for is reported as `statusCode`. Plain errors keep
 * their name, which is the only classification they carry.
 */
export function describeStreamError(error: unknown): { message: string; details?: LlmErrorDetails } {
    if (APICallError.isInstance(error)) {
        const details: LlmErrorDetails = {};
        if (typeof error.statusCode === "number") {
            details.statusCode = error.statusCode;
        }
        if (error.url) {
            details.url = error.url;
        }
        if (error.responseBody) {
            details.responseBody = error.responseBody.length > MAX_RESPONSE_BODY_LENGTH
                ? `${error.responseBody.slice(0, MAX_RESPONSE_BODY_LENGTH)}…`
                : error.responseBody;
        }
        return {
            message: error.message,
            ...(Object.keys(details).length > 0 ? { details } : {})
        };
    }
    if (error instanceof Error) {
        return { message: `${error.name}: ${error.message}` };
    }
    return { message: String(error) };
}

/**
 * Rejoin a described error into one line, for the server log — where a collapsible
 * details section isn't an option and the full context has to travel with the message.
 */
export function formatStreamError({ message, details }: { message: string; details?: LlmErrorDetails }): string {
    const parts: string[] = [];
    if (typeof details?.statusCode === "number") {
        parts.push(`HTTP ${details.statusCode}`);
    }
    if (details?.url) {
        parts.push(`URL ${details.url}`);
    }
    if (details?.responseBody) {
        parts.push(`response: ${details.responseBody}`);
    }
    return parts.length > 0 ? `${message} (${parts.join(", ")})` : message;
}

/** Package an error for the wire: the message on `error`, its context on `errorDetails`. */
function errorChunk(error: unknown): Extract<LlmStreamChunk, { type: "error" }> {
    const { message, details } = describeStreamError(error);
    return { type: "error", error: message, ...(details ? { errorDetails: details } : {}) };
}

/**
 * Convert an AI SDK StreamResult to an async iterable of LlmStreamChunk.
 * This is provider-agnostic - works with any AI SDK provider.
 */
export async function* streamToChunks(result: StreamResult, options: StreamOptions = {}): AsyncIterable<LlmStreamChunk> {
    let errorEmitted = false;
    try {
        for await (const part of result.fullStream) {
            switch (part.type) {
                case "text-delta":
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
                    yield errorChunk(part.error);
                    break;
            }
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
                yield errorChunk(error);
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
                    model: options.model,
                    provider: options.provider
                }
            };
        }

        yield { type: "done" };
    } catch (error) {
        if (!errorEmitted) {
            yield errorChunk(error);
        }
    }
}
