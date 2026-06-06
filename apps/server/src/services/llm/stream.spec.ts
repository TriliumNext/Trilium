import type { LlmStreamChunk } from "@triliumnext/commons";
import { APICallError } from "ai";
import { describe, expect, it } from "vitest";

import { describeStreamError, type StreamOptions, streamToChunks } from "./stream.js";
import type { ModelPricing, StreamResult } from "./types.js";

type ErrorChunk = Extract<LlmStreamChunk, { type: "error" }>;

/** Build a minimal fake StreamResult exposing just what streamToChunks consumes. */
function fakeResult(parts: unknown[], totalUsage: Promise<unknown>): StreamResult {
    return {
        fullStream: (async function* () {
            for (const part of parts) {
                yield part;
            }
        })(),
        totalUsage
    } as unknown as StreamResult;
}

/** Drain streamToChunks into an array. */
async function collect(result: StreamResult, options?: StreamOptions): Promise<LlmStreamChunk[]> {
    const chunks: LlmStreamChunk[] = [];
    for await (const chunk of streamToChunks(result, options)) {
        chunks.push(chunk);
    }
    return chunks;
}

type UsageChunk = Extract<LlmStreamChunk, { type: "usage" }>;
const usageOf = (chunks: LlmStreamChunk[]) =>
    chunks.find((c): c is UsageChunk => c.type === "usage")!;

/** A representative provider failure: a 404 against a misconfigured base URL. */
function apiCallError(): APICallError {
    return new APICallError({
        message: "Not Found",
        url: "http://localhost:8080/messages",
        requestBodyValues: {},
        statusCode: 404,
        responseBody: '{"message":"Router not found for request POST /messages"}'
    });
}

/**
 * The AI SDK rejects `result.totalUsage` with this generic message whenever the
 * stream produced no steps — which is exactly what happens after a connection-level error.
 */
function noOutputUsage(): Promise<never> {
    return Promise.reject(new Error("No output generated. Check the stream for errors."));
}

const errorsOf = (chunks: LlmStreamChunk[]) =>
    chunks.filter((c): c is ErrorChunk => c.type === "error");

describe("streamToChunks", () => {
    it("emits text and a final done chunk for a normal stream", async () => {
        const chunks = await collect(fakeResult(
            [
                { type: "text-delta", text: "Hello " },
                { type: "text-delta", text: "world" }
            ],
            Promise.resolve({ inputTokens: 10, outputTokens: 5 })
        ));

        expect(chunks).toEqual([
            { type: "text", content: "Hello " },
            { type: "text", content: "world" },
            {
                type: "usage",
                usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, cost: undefined, model: undefined }
            },
            { type: "done" }
        ]);
    });

    it("does not mask a real stream error with the generic 'No output generated' error", async () => {
        // A genuine error part arrives, then `totalUsage` rejects because no steps ran.
        const chunks = await collect(fakeResult(
            [{ type: "error", error: apiCallError() }],
            noOutputUsage()
        ));

        // The previous implementation emitted two error chunks — the real one, then the
        // generic "No output generated" — so the client only ever saw the masked one.
        const errors = errorsOf(chunks);
        expect(errors).toHaveLength(1);
        expect(errors[0].error).not.toContain("No output generated");
        expect(errors[0].error).toContain("Not Found");
        // No spurious done chunk should follow a failed stream.
        expect(chunks.some(c => c.type === "done")).toBe(false);
    });

    it("includes HTTP status, URL and response body in the surfaced error", async () => {
        const chunks = await collect(fakeResult(
            [{ type: "error", error: apiCallError() }],
            noOutputUsage()
        ));

        const [error] = errorsOf(chunks);
        // The previous implementation used String(error), losing all of this detail.
        expect(error.error).toContain("HTTP 404");
        expect(error.error).toContain("http://localhost:8080/messages");
        expect(error.error).toContain("Router not found");
    });

    it("surfaces a usage rejection when no error part preceded it", async () => {
        const chunks = await collect(fakeResult(
            [{ type: "text-delta", text: "partial" }],
            noOutputUsage()
        ));

        expect(chunks).toContainEqual({ type: "text", content: "partial" });
        expect(errorsOf(chunks)).toHaveLength(1);
        expect(errorsOf(chunks)[0].error).toContain("No output generated");
        expect(chunks.some(c => c.type === "done")).toBe(false);
    });

    it("streams tool input deltas with the same id used by the final tool-call", async () => {
        // The AI SDK emits the JSON arguments incrementally as `tool-input-delta` chunks
        // before the parsed `tool-call` arrives — clients use the shared id to attach
        // each delta to the right pending tool block.
        const chunks = await collect(fakeResult(
            [
                { type: "tool-input-start", id: "call_42", toolName: "search_notes" },
                { type: "tool-input-delta", id: "call_42", delta: "{\"query\":\"" },
                { type: "tool-input-delta", id: "call_42", delta: "trilium\"}" },
                { type: "tool-call", toolCallId: "call_42", toolName: "search_notes", input: { query: "trilium" } },
                { type: "tool-result", toolCallId: "call_42", toolName: "search_notes", output: "[]" }
            ],
            Promise.resolve({ inputTokens: 1, outputTokens: 1 })
        ));

        expect(chunks).toEqual([
            { type: "tool_input_start", toolCallId: "call_42", toolName: "search_notes" },
            { type: "tool_input_delta", toolCallId: "call_42", delta: "{\"query\":\"" },
            { type: "tool_input_delta", toolCallId: "call_42", delta: "trilium\"}" },
            {
                type: "tool_use",
                toolCallId: "call_42",
                toolName: "search_notes",
                toolInput: { query: "trilium" }
            },
            {
                type: "tool_result",
                toolCallId: "call_42",
                toolName: "search_notes",
                result: "[]",
                isError: false
            },
            {
                type: "usage",
                usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2, cost: undefined, model: undefined }
            },
            { type: "done" }
        ]);
    });

    it("maps reasoning-delta parts to thinking chunks", async () => {
        const chunks = await collect(fakeResult(
            [
                { type: "reasoning-delta", text: "let me think" },
                { type: "text-delta", text: "answer" }
            ],
            Promise.resolve({ inputTokens: 1, outputTokens: 1 })
        ));

        expect(chunks).toContainEqual({ type: "thinking", content: "let me think" });
        expect(chunks).toContainEqual({ type: "text", content: "answer" });
    });

    it("flags tool results whose output object carries an error and stringifies object output", async () => {
        const chunks = await collect(fakeResult(
            [
                { type: "tool-result", toolCallId: "ok", toolName: "search_notes", output: { hits: 2 } },
                { type: "tool-result", toolCallId: "bad", toolName: "search_notes", output: { error: "boom" } }
            ],
            Promise.resolve({ inputTokens: 1, outputTokens: 1 })
        ));

        const results = chunks.filter((c) => c.type === "tool_result") as Extract<LlmStreamChunk, { type: "tool_result" }>[];
        expect(results[0]).toMatchObject({ result: JSON.stringify({ hits: 2 }), isError: false });
        expect(results[1]).toMatchObject({ result: JSON.stringify({ error: "boom" }), isError: true });
    });

    it("emits citations only for url sources and ignores other source types", async () => {
        const chunks = await collect(fakeResult(
            [
                { type: "source", sourceType: "url", url: "https://a.test", title: "A" },
                { type: "source", sourceType: "document", id: "doc1" }
            ],
            Promise.resolve({ inputTokens: 1, outputTokens: 1 })
        ));

        const citations = chunks.filter((c) => c.type === "citation");
        expect(citations).toEqual([
            { type: "citation", citation: { url: "https://a.test", title: "A" } }
        ]);
    });

    it("emits the error chunk from the outer catch when the stream itself throws", async () => {
        const result = {
            fullStream: (async function* () {
                yield { type: "text-delta", text: "partial" };
                throw new TypeError("stream blew up");
            })(),
            totalUsage: Promise.resolve({ inputTokens: 0, outputTokens: 0 })
        } as unknown as StreamResult;

        const chunks = await collect(result);
        expect(chunks).toContainEqual({ type: "text", content: "partial" });
        expect(errorsOf(chunks)).toEqual([{ type: "error", error: "TypeError: stream blew up" }]);
        expect(chunks.some((c) => c.type === "done")).toBe(false);
    });

    it("does not double-report when the stream throws after an error part was already emitted", async () => {
        const result = {
            fullStream: (async function* () {
                yield { type: "error", error: new Error("first failure") };
                throw new TypeError("secondary explosion");
            })(),
            totalUsage: Promise.resolve({ inputTokens: 0, outputTokens: 0 })
        } as unknown as StreamResult;

        const chunks = await collect(result);
        // errorEmitted is already true, so the outer catch swallows the throw.
        const errors = errorsOf(chunks);
        expect(errors).toHaveLength(1);
        expect(errors[0].error).toContain("first failure");
    });

    it("computes cost from cache read/write token detail tiers", async () => {
        const pricing: ModelPricing = { input: 4, output: 8 };
        const chunks = await collect(fakeResult(
            [],
            Promise.resolve({
                inputTokens: 1_000_000,
                outputTokens: 1_000_000,
                inputTokenDetails: {
                    cacheReadTokens: 200_000,
                    cacheWriteTokens: 100_000,
                    noCacheTokens: 700_000
                }
            })
        ), { model: "m", pricing });

        // 0.7*4 (no-cache) + 0.2*4*0.1 (read) + 0.1*4*1.25 (write) + 1*8 (output)
        const expected = 0.7 * 4 + 0.2 * 4 * 0.1 + 0.1 * 4 * 1.25 + 1 * 8;
        const usage = usageOf(chunks);
        expect(usage.usage.cost).toBeCloseTo(expected, 6);
        expect(usage.usage.model).toBe("m");
    });

    it("falls back to cachedInputTokens and derives no-cache input when details are absent", async () => {
        const pricing: ModelPricing = { input: 2, output: 6 };
        const chunks = await collect(fakeResult(
            [],
            Promise.resolve({
                inputTokens: 1_000_000,
                outputTokens: 0,
                cachedInputTokens: 400_000
            })
        ), { pricing });

        // noCache = max(0, 1_000_000 - 400_000 - 0) = 600_000
        // 0.6*2 + 0.4*2*0.1 (read) + 0 (write) + 0 (output)
        const expected = 0.6 * 2 + 0.4 * 2 * 0.1;
        expect(usageOf(chunks).usage.cost).toBeCloseTo(expected, 6);
    });

    it("derives no-cache tokens via Math.max when details lack noCacheTokens and there is no cache read", async () => {
        const pricing: ModelPricing = { input: 3, output: 5 };
        const chunks = await collect(fakeResult(
            [],
            Promise.resolve({
                inputTokens: 1_000_000,
                outputTokens: 0,
                // details present but only carries a write count; no read, no noCache.
                inputTokenDetails: { cacheWriteTokens: 250_000 }
            })
        ), { pricing });

        // cacheRead = 0 (details.cacheReadTokens ?? cachedInputTokens ?? 0)
        // noCache = max(0, 1_000_000 - 0 - 250_000) = 750_000
        const expected = 0.75 * 3 + 0.25 * 3 * 1.25;
        expect(usageOf(chunks).usage.cost).toBeCloseTo(expected, 6);
    });

    it("does not emit usage when token counts are not numbers", async () => {
        const chunks = await collect(fakeResult(
            [{ type: "text-delta", text: "hi" }],
            Promise.resolve({ inputTokens: undefined, outputTokens: undefined })
        ));

        expect(chunks.some((c) => c.type === "usage")).toBe(false);
        // Stream still completes cleanly.
        expect(chunks[chunks.length - 1]).toEqual({ type: "done" });
    });

    it("interleaves input deltas for parallel tool calls and forwards distinct ids", async () => {
        // Two parallel tool calls with the same name; without per-call ids the client
        // couldn't tell whose delta belonged to whom.
        const chunks = await collect(fakeResult(
            [
                { type: "tool-input-start", id: "a", toolName: "search_notes" },
                { type: "tool-input-start", id: "b", toolName: "search_notes" },
                { type: "tool-input-delta", id: "a", delta: "{\"query\":\"x\"}" },
                { type: "tool-input-delta", id: "b", delta: "{\"query\":\"y\"}" },
                { type: "tool-call", toolCallId: "a", toolName: "search_notes", input: { query: "x" } },
                { type: "tool-call", toolCallId: "b", toolName: "search_notes", input: { query: "y" } }
            ],
            Promise.resolve({ inputTokens: 1, outputTokens: 1 })
        ));

        const idsByType = chunks.reduce<Record<string, string[]>>((acc, c) => {
            if ("toolCallId" in c) (acc[c.type] ??= []).push(c.toolCallId);
            return acc;
        }, {});
        expect(idsByType.tool_input_start).toEqual(["a", "b"]);
        expect(idsByType.tool_input_delta).toEqual(["a", "b"]);
        expect(idsByType.tool_use).toEqual(["a", "b"]);
    });
});

describe("describeStreamError", () => {
    it("expands an APICallError into status, URL and response body", () => {
        const msg = describeStreamError(apiCallError());
        expect(msg).toContain("AI_APICallError: Not Found");
        expect(msg).toContain("HTTP 404");
        expect(msg).toContain("URL http://localhost:8080/messages");
        expect(msg).toContain('{"message":"Router not found for request POST /messages"}');
    });

    it("truncates an oversized response body", () => {
        const err = new APICallError({
            message: "Boom",
            url: "http://example.com/api",
            requestBodyValues: {},
            statusCode: 500,
            responseBody: "x".repeat(900)
        });
        const msg = describeStreamError(err);
        expect(msg).toContain("…");
        expect(msg.length).toBeLessThan(900);
    });

    it("omits the detail suffix for an APICallError lacking status, url and body", () => {
        const err = new APICallError({
            message: "Opaque failure",
            url: "",
            requestBodyValues: {},
            statusCode: undefined,
            responseBody: undefined
        });
        // No status/url/body → no parenthesised detail, just name + message.
        expect(describeStreamError(err)).toBe(`${err.name}: Opaque failure`);
    });

    it("falls back to name and message for a plain Error", () => {
        expect(describeStreamError(new TypeError("bad input"))).toBe("TypeError: bad input");
    });

    it("stringifies a non-Error value", () => {
        expect(describeStreamError("just a string")).toBe("just a string");
    });
});
