/**
 * The standalone build's chat transport, which delivers a completion over the
 * WebSocket-style message channel instead of Server-Sent Events.
 *
 * A file of its own because the choice between the two is made from
 * `isStandalone`, a module-level constant read off `window.glob` at import time:
 * the SSE tests in `llm_chat.spec.ts` need it false, and these need it true.
 */

import type { LlmChatConfig, LlmMessage, LlmStreamChunk, WebSocketMessage } from "@triliumnext/commons";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./utils.js", async (importOriginal) => ({
    ...await importOriginal<typeof import("./utils.js")>(),
    isStandalone: true,
    randomString: () => "stream1"
}));

const handlers: ((message: WebSocketMessage) => void)[] = vi.hoisted(() => []);
vi.mock("./ws.js", () => ({
    subscribeToMessages: (handler: (message: WebSocketMessage) => void) => { handlers.push(handler); },
    unsubscribeToMessage: (handler: (message: WebSocketMessage) => void) => {
        handlers.splice(handlers.indexOf(handler), 1);
    }
}));

import { streamChatCompletion, type StreamCallbacks } from "./llm_chat.js";
import server from "./server.js";

function makeCallbacks(): Record<keyof StreamCallbacks, ReturnType<typeof vi.fn>> & StreamCallbacks {
    return {
        onChunk: vi.fn(),
        onThinking: vi.fn(),
        onToolInputStart: vi.fn(),
        onToolInputDelta: vi.fn(),
        onToolUse: vi.fn(),
        onToolResult: vi.fn(),
        onCitation: vi.fn(),
        onUsage: vi.fn(),
        onError: vi.fn(),
        onDone: vi.fn()
    } as Record<keyof StreamCallbacks, ReturnType<typeof vi.fn>> & StreamCallbacks;
}

/** Deliver a message to whoever is listening, as the worker's relay would. */
function broadcast(message: WebSocketMessage) {
    for (const handler of [...handlers]) {
        handler(message);
    }
}

const chunk = (c: LlmStreamChunk): WebSocketMessage => ({ type: "llm-stream", streamId: "stream1", chunk: c });
const end: WebSocketMessage = { type: "llm-stream-end", streamId: "stream1" };

const messages: LlmMessage[] = [{ role: "user", content: "hi" }];
const config = {} as LlmChatConfig;

describe("streamChatCompletion in standalone", () => {
    let posts: [string, unknown][];

    beforeEach(() => {
        posts = [];
        server.post = vi.fn(async (url: string, body?: unknown) => { posts.push([url, body]); }) as typeof server.post;
    });

    afterEach(() => {
        handlers.length = 0;
        vi.restoreAllMocks();
    });

    it("starts the completion under the id it minted, then delivers only that stream's chunks", async () => {
        const cb = makeCallbacks();
        const streaming = streamChatCompletion(messages, config, cb);

        // The subscription is in place before the request goes out, so an
        // opening chunk cannot outrun it.
        expect(handlers).toHaveLength(1);
        await Promise.resolve();
        expect(posts).toEqual([["llm-chat/stream-start", { streamId: "stream1", messages, config }]]);

        broadcast(chunk({ type: "text", content: "hel" }));
        broadcast({ type: "llm-stream", streamId: "someone-else", chunk: { type: "text", content: "not mine" } });
        broadcast({ type: "llm-stream-end", streamId: "someone-else" });
        broadcast(chunk({ type: "text", content: "lo" }));
        broadcast(chunk({ type: "done" }));
        broadcast(end);

        await streaming;
        expect(cb.onChunk.mock.calls).toEqual([["hel"], ["lo"]]);
        expect(cb.onDone).toHaveBeenCalledTimes(1);
        // The subscription is dropped once the stream is over.
        expect(handlers).toHaveLength(0);
    });

    it("delivers chunks in order even when they arrive faster than they are handled", async () => {
        const cb = makeCallbacks();
        const streaming = streamChatCompletion(messages, config, cb);
        await Promise.resolve();

        // A tool_use chunk yields to the renderer before the next is handled, so
        // without the chain the text that follows it would be applied first.
        broadcast(chunk({ type: "tool_use", toolCallId: "t1", toolName: "search", toolInput: {} }));
        broadcast(chunk({ type: "text", content: "after" }));
        broadcast(end);

        await streaming;
        expect(cb.onToolUse).toHaveBeenCalledWith("t1", "search", {});
        expect(cb.onChunk).toHaveBeenCalledWith("after");
        expect(cb.onToolUse.mock.invocationCallOrder[0]).toBeLessThan(cb.onChunk.mock.invocationCallOrder[0]);
    });

    it("reports a failure to start the completion, and does not wait for a stream that never began", async () => {
        server.post = vi.fn(async () => { throw JSON.stringify({ message: "No LLM providers configured." }); }) as typeof server.post;

        const cb = makeCallbacks();
        await streamChatCompletion(messages, config, cb);

        expect(cb.onError).toHaveBeenCalledWith("Failed to start the LLM stream: No LLM providers configured.");
        expect(handlers).toHaveLength(0);
    });

    it("fails an aborted generation the way a cancelled fetch does, and tells the backend to stop", async () => {
        const controller = new AbortController();
        const cb = makeCallbacks();
        const streaming = streamChatCompletion(messages, config, cb, controller.signal);
        await Promise.resolve();

        broadcast(chunk({ type: "text", content: "partial" }));
        controller.abort();

        await expect(streaming).rejects.toThrow(expect.objectContaining({ name: "AbortError" }));
        expect(posts.map(([url]) => url)).toContain("llm-chat/stream-abort");
        expect(posts.at(-1)?.[1]).toEqual({ streamId: "stream1" });
        expect(handlers).toHaveLength(0);
    });

    it("fails immediately when handed a signal that has already been aborted", async () => {
        const cb = makeCallbacks();
        await expect(streamChatCompletion(messages, config, cb, AbortSignal.abort()))
            .rejects.toThrow(expect.objectContaining({ name: "AbortError" }));
        expect(handlers).toHaveLength(0);
    });

    it("survives a backend that cannot be told to stop", async () => {
        const controller = new AbortController();
        server.post = vi.fn(async (url: string) => {
            if (url.endsWith("stream-abort")) throw new Error("worker gone");
        }) as typeof server.post;

        const cb = makeCallbacks();
        const streaming = streamChatCompletion(messages, config, cb, controller.signal);
        await Promise.resolve();
        controller.abort();

        await expect(streaming).rejects.toThrow(expect.objectContaining({ name: "AbortError" }));
    });
});
