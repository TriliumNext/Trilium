import type { Request, Response } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
    chunks: [] as unknown[],
    /** The signal runChat was handed, so the disconnect wiring can be asserted. */
    signal: undefined as AbortSignal | undefined
}));

// The completion itself is core's and tested there; what this route adds is the
// SSE framing around it, so only the chunk source is faked.
vi.mock("@triliumnext/core/src/services/llm/chat.js", () => ({
    async *runChat(_messages: unknown, _config: unknown, signal?: AbortSignal) {
        state.signal = signal;
        for (const c of state.chunks) yield c;
    }
}));

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

function req(body: unknown) { return { body } as unknown as Request; }

describe("streamChat", () => {
    afterEach(() => {
        state.chunks = [];
        state.signal = undefined;
    });

    it("returns 400 for an empty messages array, without opening a stream", async () => {
        const r = fakeRes();
        await llmChatRoute.streamChat(req({ messages: [] }), r.res);
        expect(r.statusCode).toBe(400);
        expect(r.jsonBody).toEqual({ error: "messages array is required" });
        expect(r.writes).toEqual([]);
    });

    it("writes each chunk as an SSE event, flushes it, and ends the response", async () => {
        state.chunks = [{ type: "text", content: "Hi" }, { type: "done" }];
        const r = fakeRes({ withFlush: true });
        await llmChatRoute.streamChat(req({ messages: [{ role: "user", content: "hello" }] }), r.res);

        expect(r.headers["Content-Type"]).toBe("text/event-stream");
        expect(r.headers["X-Accel-Buffering"]).toBe("no");
        expect(r.writes).toEqual([
            'data: {"type":"text","content":"Hi"}\n\n',
            'data: {"type":"done"}\n\n'
        ]);
        expect(r.flushes).toBe(2);
        expect(r.ended).toBe(true);
    });

    it("ends the response and streams without a flush method available", async () => {
        state.chunks = [{ type: "done" }];
        const r = fakeRes();
        await llmChatRoute.streamChat(req({ messages: [{ role: "user", content: "hi" }] }), r.res);
        expect(r.writes.join("")).toContain('"type":"done"');
        expect(r.ended).toBe(true);
    });

    it("aborts the completion when the client disconnects", async () => {
        state.chunks = [{ type: "done" }];
        const r = fakeRes();
        await llmChatRoute.streamChat(req({ messages: [{ role: "user", content: "hi" }] }), r.res);

        const signal = state.signal;
        expect(signal).toBeInstanceOf(AbortSignal);
        expect(signal?.aborted).toBe(false);
        r.listeners.close();
        expect(signal?.aborted).toBe(true);
    });
});
