import type { Request, Response } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
    configured: true,
    models: [] as unknown[],
    chunks: [] as unknown[],
    availableModels: [{ id: "m1", name: "Model One", isDefault: true }] as { id: string; name: string; isDefault?: boolean }[],
    chatThrows: false
}));

vi.mock("../../services/llm/index.js", () => ({
    hasConfiguredProviders: () => state.configured,
    getAllModels: () => state.models,
    getProviderByType: () => ({
        chat: () => { if (state.chatThrows) throw new Error("provider exploded"); return {}; },
        getAvailableModels: () => state.availableModels,
        getModelPricing: () => ({ input: 0, output: 0 })
    })
}));

vi.mock("../../services/llm/stream.js", () => ({
    async *streamToChunks () { for (const c of state.chunks) yield c; }
}));

const generateChatTitle = vi.fn(async (..._args: unknown[]) => {});
vi.mock("../../services/llm/chat_title.js", () => ({ generateChatTitle: (...args: unknown[]) => generateChatTitle(...args) }));

import llmChatRoute from "./llm_chat.js";

function fakeRes() {
    const writes: string[] = [];
    const headers: Record<string, string> = {};
    let statusCode = 200;
    let jsonBody: unknown;
    let ended = false;
    const res = {
        setHeader(k: string, v: string) { headers[k] = v; },
        flushHeaders() {},
        write(chunk: string) { writes.push(chunk); return true; },
        end() { ended = true; },
        status(code: number) { statusCode = code; return this; },
        json(body: unknown) { jsonBody = body; return this; }
    } as unknown as Response;
    return { res, writes, headers, get statusCode() { return statusCode; }, get jsonBody() { return jsonBody; }, get ended() { return ended; } };
}

describe("LLM chat API", () => {
    afterEach(() => {
        Object.assign(state, { configured: true, models: [], chunks: [], availableModels: [{ id: "m1", name: "Model One", isDefault: true }], chatThrows: false });
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
            state.chatThrows = true;
            const r = fakeRes();
            await llmChatRoute.streamChat(req({ messages: [{ role: "user", content: "hi" }], config: {} }), r.res);
            expect(r.writes.join("")).toContain("provider exploded");
            expect(r.ended).toBe(true);
        });
    });
});
