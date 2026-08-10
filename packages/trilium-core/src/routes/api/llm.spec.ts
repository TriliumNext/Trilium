import type { WebSocketMessage } from "@triliumnext/commons";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

const state = vi.hoisted(() => ({
    models: [] as unknown[],
    /** Records the credentials the route passed to listProviderModels. */
    args: undefined as unknown[] | undefined,
    /** When set, listProviderModels rejects with this (simulates a bad key). */
    throws: undefined as unknown,
    /** Chunks the faked completion yields, one per `await` tick. */
    chunks: [] as unknown[],
    /** When set, runChat throws this instead of yielding. */
    chatThrows: undefined as unknown,
    /** The signal the completion was handed, so the abort route can be asserted. */
    signal: undefined as AbortSignal | undefined,
    /** Keeps the faked completion running until it is aborted, as a real one would. */
    holdUntilAborted: false,
    /** Every message broadcast while a stream ran. */
    sent: [] as WebSocketMessage[]
}));

// The route reaches the provider registry through a dynamic import, so that the
// AI SDK stays out of the startup chunk; mocking the module id covers it either way.
vi.mock("../../services/llm/index.js", () => ({
    listProviderModels: async (...args: unknown[]) => {
        state.args = args;
        if (state.throws !== undefined) throw state.throws;
        return state.models;
    }
}));

vi.mock("../../services/llm/chat.js", () => ({
    async *runChat(_messages: unknown, _config: unknown, signal?: AbortSignal) {
        state.signal = signal;
        if (state.chatThrows !== undefined) throw state.chatThrows;
        for (const c of state.chunks) yield c;
        if (state.holdUntilAborted) {
            await new Promise<void>(resolve => signal?.addEventListener("abort", () => resolve(), { once: true }));
        }
    }
}));

import { getLog } from "../../services/log.js";
import ws from "../../services/ws.js";

import { abortChatStream, getProviderModels, startChatStream } from "./llm.js";

/**
 * Poll until the completion — which runs detached from the request that started
 * it — reaches the state a test is waiting for. Wall-clock rather than a fixed
 * number of ticks: the completion's first step is a dynamic import, which the
 * test runner can take arbitrarily long to resolve the first time.
 */
function until(condition: () => boolean, what: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const deadline = Date.now() + 2000;
        const check = () => {
            if (condition()) {
                resolve();
            } else if (Date.now() > deadline) {
                reject(new Error(`Timed out waiting for ${what}`));
            } else {
                setTimeout(check, 1);
            }
        };
        check();
    });
}

const untilStreamEnds = () => until(() => state.sent.some(m => m.type === "llm-stream-end"), "the stream to end");

const HELLO = [{ role: "user" as const, content: "hi" }];

/**
 * Spied rather than mocked: core loads both modules while it initialises, before
 * a per-file `vi.mock` could take their place, so the route would go on using the
 * real ones.
 */
let errorLog: MockInstance<(...args: unknown[]) => void>;
beforeEach(() => {
    vi.spyOn(ws, "sendMessageToAllClients").mockImplementation((message) => { state.sent.push(message); });
    errorLog = vi.spyOn(getLog(), "error").mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
    Object.assign(state, {
        models: [],
        args: undefined,
        throws: undefined,
        chunks: [],
        chatThrows: undefined,
        signal: undefined,
        holdUntilAborted: false,
        sent: []
    });
});

describe("getProviderModels", () => {

    it("lists models for the credentials in the request body, defaulting a missing key to an empty string", async () => {
        state.models = [{ id: "m1" }];
        await expect(getProviderModels({ body: { provider: "openai", apiKey: "sk-test", baseURL: "http://localhost:11434/v1" } }))
            .resolves.toEqual({ models: [{ id: "m1" }] });
        expect(state.args).toEqual(["openai", "sk-test", "http://localhost:11434/v1"]);

        // The subscription provider carries no key of its own — auth is Claude Code's.
        await getProviderModels({ body: { provider: "claude-agent" } });
        expect(state.args).toEqual(["claude-agent", "", undefined]);
    });

    it("throws when no provider is given", async () => {
        await expect(getProviderModels({ body: {} as never })).rejects.toThrow(/provider is required/);
    });

    it("surfaces a listing failure instead of masking it, whether or not it is an Error", async () => {
        state.throws = new Error("Authentication failed (HTTP 401) — check the API key.");
        await expect(getProviderModels({ body: { provider: "openai", apiKey: "bad-key" } }))
            .rejects.toThrow(/Authentication failed \(HTTP 401\)/);

        state.throws = "socket hang up";
        await expect(getProviderModels({ body: { provider: "openai", apiKey: "k" } }))
            .rejects.toThrow("socket hang up");
    });
});

describe("startChatStream", () => {
    it("answers immediately, then broadcasts the chunks under the client's id and an end marker", async () => {
        state.chunks = [{ type: "text", content: "Hi" }, { type: "done" }];

        expect(startChatStream({ body: { streamId: "s1", messages: HELLO } })).toEqual({});
        // Nothing has been broadcast yet: the completion outlives the request.
        expect(state.sent).toEqual([]);

        await untilStreamEnds();
        expect(state.sent).toEqual([
            { type: "llm-stream", streamId: "s1", chunk: { type: "text", content: "Hi" } },
            { type: "llm-stream", streamId: "s1", chunk: { type: "done" } },
            { type: "llm-stream-end", streamId: "s1" }
        ]);
    });

    it("rejects a request that could not be matched back to a stream", () => {
        expect(() => startChatStream({ body: { streamId: "", messages: HELLO } })).toThrow(/streamId is required/);
        expect(() => startChatStream({ body: { streamId: "s1", messages: [] } })).toThrow(/messages array is required/);
        expect(() => startChatStream({ body: {} as never })).toThrow(/streamId is required/);
    });

    it("refuses to reuse the id of a stream still running, and frees it once it ends", async () => {
        state.chunks = [{ type: "done" }];
        startChatStream({ body: { streamId: "s1", messages: HELLO } });
        expect(() => startChatStream({ body: { streamId: "s1", messages: HELLO } }))
            .toThrow(/'s1' is already running/);

        await untilStreamEnds();
        expect(() => startChatStream({ body: { streamId: "s1", messages: HELLO } })).not.toThrow();
    });

    it("still ends the stream when the completion throws, reporting it as a chunk", async () => {
        state.chatThrows = new Error("worker died");
        startChatStream({ body: { streamId: "s1", messages: HELLO } });
        await untilStreamEnds();

        expect(state.sent).toEqual([
            { type: "llm-stream", streamId: "s1", chunk: { type: "error", error: "worker died" } },
            { type: "llm-stream-end", streamId: "s1" }
        ]);
        expect(errorLog).toHaveBeenCalledWith(expect.stringContaining("LLM chat stream s1 failed"));
    });

    it("reports a non-Error failure by its string form", async () => {
        state.chatThrows = "socket hang up";
        startChatStream({ body: { streamId: "s1", messages: HELLO } });
        await untilStreamEnds();
        expect(state.sent[0]).toEqual({
            type: "llm-stream", streamId: "s1", chunk: { type: "error", error: "socket hang up" }
        });
    });
});

describe("abortChatStream", () => {
    it("aborts the signal the running completion was given, which ends the stream", async () => {
        state.holdUntilAborted = true;
        startChatStream({ body: { streamId: "s1", messages: HELLO } });
        // Let the completion start, so it has been handed its signal.
        await until(() => state.signal !== undefined, "the completion to start");
        expect(state.signal?.aborted).toBe(false);
        expect(state.sent).toEqual([]);

        expect(abortChatStream({ body: { streamId: "s1" } })).toEqual({});
        expect(state.signal?.aborted).toBe(true);

        await untilStreamEnds();
        expect(state.sent).toEqual([{ type: "llm-stream-end", streamId: "s1" }]);
    });

    it("ignores an id that is not running, and a request with no id at all", () => {
        expect(() => abortChatStream({ body: { streamId: "nope" } })).not.toThrow();
        expect(() => abortChatStream({ body: {} })).not.toThrow();
    });
});
