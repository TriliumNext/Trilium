import type { Request, Response } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
    configured: true,
    models: [] as unknown[],
    chunks: [] as unknown[],
    availableModels: [{ id: "m1", name: "Model One", isDefault: true }] as { id: string; name: string; isDefault?: boolean }[],
    chatThrows: undefined as unknown,
    // When true, the fake provider is chunk-native (implements chatChunks) and
    // records the abort signal the route wires to the response lifecycle.
    chunkNative: false,
    chunkSignal: undefined as AbortSignal | undefined,
    executed: [] as unknown[]
}));

vi.mock("../../services/llm/index.js", () => ({
    hasConfiguredProviders: () => state.configured,
    getAllModels: () => state.models,
    getProviderByType: () => ({
        chat: () => { if (state.chatThrows !== undefined) throw state.chatThrows; return {}; },
        chatChunks: state.chunkNative
            ? async function* (_messages: unknown, _config: unknown, signal?: AbortSignal) {
                state.chunkSignal = signal;
                for (const c of state.chunks) yield c;
            }
            : undefined,
        getAvailableModels: () => state.availableModels,
        getModelPricing: () => ({ input: 0, output: 0 })
    })
}));

vi.mock("../../services/llm/stream.js", () => ({
    async *streamToChunks () { for (const c of state.chunks) yield c; }
}));

vi.mock("../../services/llm/tools/index.js", async () => {
    const { z } = await import("zod");
    const writeDef = {
        description: "write",
        inputSchema: z.object({ id: z.string() }),
        mutates: true as const,
        execute: (args: { id: string }) => { state.executed.push(args); return { ok: true, id: args.id }; }
    };
    const readDef = {
        description: "read",
        inputSchema: z.object({ id: z.string() }),
        execute: () => ({ read: true })
    };
    const registry = {
        *[Symbol.iterator]() {
            yield ["write_thing", writeDef] as const;
            yield ["read_thing", readDef] as const;
        },
        getMutatingToolNames: () => ["write_thing"],
        toToolSet: () => ({})
    };
    return { allToolRegistries: [registry] };
});

const generateChatTitle = vi.fn(async (..._args: unknown[]) => {});
vi.mock("../../services/llm/chat_title.js", () => ({ generateChatTitle: (...args: unknown[]) => generateChatTitle(...args) }));

import llmChatRoute from "./llm_chat.js";

function fakeRes({ withFlush = false } = {}) {
    const writes: string[] = [];
    const headers: Record<string, string> = {};
    const listeners: Record<string, () => void> = {};
    let statusCode = 200;
    let jsonBody: unknown;
    let ended = false;
    let flushes = 0;
    const res = {
        setHeader(k: string, v: string) { headers[k] = v; },
        flushHeaders() {},
        write(chunk: string) { writes.push(chunk); return true; },
        end() { ended = true; },
        status(code: number) { statusCode = code; return this; },
        json(body: unknown) { jsonBody = body; return this; },
        on(event: string, handler: () => void) { listeners[event] = handler; },
        ...(withFlush ? { flush() { flushes++; } } : {})
    } as unknown as Response;
    return {
        res, writes, headers, listeners,
        get statusCode() { return statusCode; },
        get jsonBody() { return jsonBody; },
        get ended() { return ended; },
        get flushes() { return flushes; }
    };
}

describe("LLM chat API", () => {
    afterEach(() => {
        Object.assign(state, {
            configured: true,
            models: [],
            chunks: [],
            availableModels: [{ id: "m1", name: "Model One", isDefault: true }],
            chatThrows: undefined,
            chunkNative: false,
            chunkSignal: undefined
        });
        generateChatTitle.mockClear();
    });

    describe("getModels", () => {
        it("returns no models when no provider is configured", () => {
            state.configured = false;
            expect(llmChatRoute.getModels({} as Request, {} as Response)).toEqual({ models: [] });
        });

        it("returns all models when configured", () => {
            state.models = [{ id: "m1" }];
            expect(llmChatRoute.getModels({} as Request, {} as Response)).toEqual({ models: [{ id: "m1" }] });
        });
    });

    describe("streamChat", () => {
        function req(body: unknown) { return { body } as unknown as Request; }

        it("returns 400 for an empty messages array", async () => {
            const r = fakeRes();
            await llmChatRoute.streamChat(req({ messages: [] }), r.res);
            expect(r.statusCode).toBe(400);
            expect(r.jsonBody).toEqual({ error: "messages array is required" });
        });

        it("emits an SSE error when no providers are configured", async () => {
            state.configured = false;
            const r = fakeRes();
            await llmChatRoute.streamChat(req({ messages: [{ role: "user", content: "hi" }] }), r.res);
            expect(r.writes.join("")).toContain("No LLM providers configured");
            expect(r.ended).toBe(true);
        });

        it("emits an SSE error when no model can be resolved", async () => {
            state.availableModels = [];
            const r = fakeRes();
            await llmChatRoute.streamChat(req({ messages: [{ role: "user", content: "hi" }], config: {} }), r.res);
            expect(r.writes.join("")).toContain("No model specified");
        });

        it("streams chunks, logs errors, ends the response and generates a title", async () => {
            state.chunks = [{ type: "text", content: "Hi" }, { type: "error", error: "boom" }, { type: "done" }];
            const r = fakeRes();
            await llmChatRoute.streamChat(req({ messages: [{ role: "user", content: "hello" }], config: { chatNoteId: "abc" } }), r.res);
            const body = r.writes.join("");
            expect(body).toContain('"type":"text"');
            expect(body).toContain('"type":"done"');
            expect(r.ended).toBe(true);
            expect(generateChatTitle).toHaveBeenCalledWith("abc", "hello");
            expect(r.headers["Content-Type"]).toBe("text/event-stream");
        });

        it("writes an SSE error when the provider throws", async () => {
            state.chatThrows = new Error("provider exploded");
            const r = fakeRes();
            await llmChatRoute.streamChat(req({ messages: [{ role: "user", content: "hi" }], config: {} }), r.res);
            expect(r.writes.join("")).toContain("provider exploded");
            expect(r.ended).toBe(true);
        });

        it("writes a generic SSE error when the provider throws a non-Error", async () => {
            state.chatThrows = "weird failure";
            const r = fakeRes();
            await llmChatRoute.streamChat(req({ messages: [{ role: "user", content: "hi" }], config: {} }), r.res);
            expect(r.writes.join("")).toContain("Unknown error");
        });

        it("prefers a chunk-native provider, wires the disconnect abort, and flushes each chunk", async () => {
            state.chunkNative = true;
            state.chunks = [{ type: "text", content: "native" }, { type: "done" }];
            const r = fakeRes({ withFlush: true });
            await llmChatRoute.streamChat(req({ messages: [{ role: "user", content: "hi" }], config: { provider: "claude-agent" } }), r.res);

            const body = r.writes.join("");
            expect(body).toContain('"content":"native"');
            expect(r.flushes).toBeGreaterThanOrEqual(2);

            // The provider received the signal tied to the response lifecycle:
            // a client disconnect (res close) aborts the in-flight agent turn.
            const signal = state.chunkSignal;
            expect(signal).toBeInstanceOf(AbortSignal);
            expect(signal?.aborted).toBe(false);
            r.listeners.close();
            expect(signal?.aborted).toBe(true);
        });

        it("falls back to the raw model id as display name for an unlisted model", async () => {
            state.chunks = [{ type: "error", error: "boom" }];
            const r = fakeRes();
            await llmChatRoute.streamChat(req({ messages: [{ role: "user", content: "hi" }], config: { model: "custom-model" } }), r.res);
            expect(r.writes.join("")).toContain("boom");
            expect(r.ended).toBe(true);
        });

        it("titles from the text parts of a multimodal first message, and skips image-only ones", async () => {
            const r1 = fakeRes();
            await llmChatRoute.streamChat(req({
                messages: [{ role: "user", content: [
                    { type: "image", attachmentId: "a1", mime: "image/png" },
                    { type: "text", text: "describe this" }
                ] }],
                config: { chatNoteId: "abc" }
            }), r1.res);
            expect(generateChatTitle).toHaveBeenCalledWith("abc", "describe this");

            generateChatTitle.mockClear();
            const r2 = fakeRes();
            await llmChatRoute.streamChat(req({
                messages: [{ role: "user", content: [{ type: "image", attachmentId: "a1", mime: "image/png" }] }],
                config: { chatNoteId: "abc" }
            }), r2.res);
            expect(generateChatTitle).not.toHaveBeenCalled();
        });

        it("does not title follow-up turns", async () => {
            const r = fakeRes();
            await llmChatRoute.streamChat(req({
                messages: [
                    { role: "user", content: "first" },
                    { role: "assistant", content: "reply" },
                    { role: "user", content: "second" }
                ],
                config: { chatNoteId: "abc" }
            }), r.res);
            expect(generateChatTitle).not.toHaveBeenCalled();
        });

        it("keeps the chat alive when title generation fails", async () => {
            generateChatTitle.mockRejectedValueOnce(new Error("title model down"));
            state.chunks = [{ type: "done" }];
            const r = fakeRes();
            await llmChatRoute.streamChat(req({ messages: [{ role: "user", content: "hello" }], config: { chatNoteId: "abc" } }), r.res);
            expect(r.writes.join("")).toContain('"type":"done"');
            expect(r.ended).toBe(true);
        });
    });

    describe("executeTool", () => {
        function req(body: unknown) { return { body } as unknown as Request; }

        it("executes an approved mutating tool with schema-valid input", () => {
            state.executed = [];
            const result = llmChatRoute.executeTool(req({ toolName: "write_thing", toolInput: { id: "w1" } }), {} as Response);
            expect(result).toEqual({ result: { ok: true, id: "w1" } });
            expect(state.executed).toEqual([{ id: "w1" }]);
        });

        it("rejects input that fails the tool's schema without executing", () => {
            state.executed = [];
            const result = llmChatRoute.executeTool(req({ toolName: "write_thing", toolInput: { id: 42 } }), {} as Response) as { error?: string };
            expect(result.error).toMatch(/Invalid tool input/);
            expect(state.executed).toEqual([]);
        });

        it("refuses to run read-only tools through the approval endpoint", () => {
            const result = llmChatRoute.executeTool(req({ toolName: "read_thing", toolInput: {} }), {} as Response) as { error?: string };
            expect(result.error).toMatch(/Only mutating tools/);
        });

        it("errors on an unknown tool name", () => {
            const result = llmChatRoute.executeTool(req({ toolName: "nope", toolInput: {} }), {} as Response) as { error?: string };
            expect(result.error).toMatch(/not found/);
        });

        it("errors when toolName is missing", () => {
            const result = llmChatRoute.executeTool(req({ toolInput: {} }), {} as Response) as { error?: string };
            expect(result.error).toMatch(/toolName is required/);
        });
    });
});
