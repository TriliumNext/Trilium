import type { LlmMessage, LlmStreamChunk } from "@triliumnext/commons";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
    configured: true,
    chunks: [] as unknown[],
    availableModels: [{ id: "m1", name: "Model One", isDefault: true }] as { id: string; name: string; isDefault?: boolean }[],
    chatThrows: undefined as unknown,
    /** When true the fake provider is chunk-native, and records the signal it was handed. */
    chunkNative: false,
    chunkSignal: undefined as AbortSignal | undefined,
    /** Records how runChat resolved the provider. */
    providerIdRequested: undefined as string | undefined,
    providerTypeRequested: undefined as string | undefined
}));

vi.mock("./index.js", () => {
    const makeProvider = () => ({
        name: "fake",
        chat: () => { if (state.chatThrows !== undefined) throw state.chatThrows; return {}; },
        chatChunks: state.chunkNative
            ? async function* (_messages: unknown, _config: unknown, signal?: AbortSignal) {
                state.chunkSignal = signal;
                for (const c of state.chunks) yield c;
            }
            : undefined,
        getAvailableModels: () => state.availableModels,
        getModelPricing: () => ({ input: 0, output: 0 })
    });
    return {
        hasConfiguredProviders: () => state.configured,
        getSelectedModel: () => undefined,
        getProvider: (id: string) => { state.providerIdRequested = id; return makeProvider(); },
        getProviderByType: (type: string) => { state.providerTypeRequested = type; return makeProvider(); }
    };
});

// Only the stream itself is faked; `formatStreamError` (used for the log line) is a pure
// function and stays real, so the logged text is asserted against the production format.
vi.mock("./stream.js", async (importOriginal) => ({
    ...await importOriginal<typeof import("./stream.js")>(),
    async *streamToChunks() { for (const c of state.chunks) yield c; }
}));

const generateChatTitle = vi.fn(async (..._args: unknown[]) => {});
vi.mock("./chat_title.js", () => ({ generateChatTitle: (...args: unknown[]) => generateChatTitle(...args) }));

const errorMock = vi.fn();
vi.mock("../log.js", async (importOriginal) => ({
    ...await importOriginal<typeof import("../log.js")>(),
    getLog: () => ({ error: errorMock, info: vi.fn(), warn: vi.fn() })
}));

import { runChat } from "./chat.js";

/** Drain a completion into an array, which is how every assertion here reads it. */
async function collect(messages: LlmMessage[], config: object = {}, signal?: AbortSignal): Promise<LlmStreamChunk[]> {
    const collected: LlmStreamChunk[] = [];
    for await (const chunk of runChat(messages, config, signal)) {
        collected.push(chunk);
    }
    return collected;
}

const HELLO: LlmMessage[] = [{ role: "user", content: "hi" }];

describe("runChat", () => {
    afterEach(() => {
        Object.assign(state, {
            configured: true,
            chunks: [],
            availableModels: [{ id: "m1", name: "Model One", isDefault: true }],
            chatThrows: undefined,
            chunkNative: false,
            chunkSignal: undefined,
            providerIdRequested: undefined,
            providerTypeRequested: undefined
        });
        generateChatTitle.mockClear();
        errorMock.mockClear();
    });

    it("yields an error chunk and stops when nothing can serve the completion", async () => {
        state.configured = false;
        expect(await collect(HELLO)).toEqual([
            { type: "error", error: expect.stringContaining("No LLM providers configured") }
        ]);

        state.configured = true;
        state.availableModels = [];
        expect(await collect(HELLO)).toEqual([
            { type: "error", error: expect.stringContaining("No model specified") }
        ]);
    });

    it("routes by providerId when present, falling back to provider type", async () => {
        state.chunks = [{ type: "done" }];
        await collect(HELLO, { provider: "openai", providerId: "openai_123" });
        expect(state.providerIdRequested).toBe("openai_123");
        expect(state.providerTypeRequested).toBeUndefined();

        // No providerId (chat saved before it existed) → type-based resolution.
        state.providerIdRequested = undefined;
        await collect(HELLO, { provider: "openai" });
        expect(state.providerIdRequested).toBeUndefined();
        expect(state.providerTypeRequested).toBe("openai");
    });

    it("passes chunks through, logging the errors among them with their provider context", async () => {
        state.chunks = [
            { type: "text", content: "Hi" },
            { type: "error", error: "boom", errorDetails: { statusCode: 429 } },
            { type: "done" }
        ];
        expect(await collect(HELLO, { model: "m1" })).toEqual(state.chunks);
        expect(errorMock).toHaveBeenCalledWith(expect.stringContaining("boom (HTTP 429)"));
    });

    it("names an unlisted model by its raw id in the log line", async () => {
        state.chunks = [{ type: "error", error: "boom" }];
        await collect(HELLO, { model: "custom-model" });
        expect(errorMock).toHaveBeenCalledWith(expect.stringContaining("model custom-model"));
    });

    it("reports a throwing provider as an error chunk, whether or not it threw an Error", async () => {
        state.chatThrows = new Error("provider exploded");
        expect(await collect(HELLO)).toEqual([{ type: "error", error: "provider exploded" }]);

        state.chatThrows = "weird failure";
        expect(await collect(HELLO)).toEqual([{ type: "error", error: "Unknown error" }]);
    });

    it("prefers a chunk-native provider and hands it the abort signal", async () => {
        state.chunkNative = true;
        state.chunks = [{ type: "text", content: "native" }, { type: "done" }];
        const controller = new AbortController();
        expect(await collect(HELLO, { provider: "claude-agent" }, controller.signal)).toEqual(state.chunks);
        expect(state.chunkSignal).toBe(controller.signal);
    });

    it("stops at the next chunk once aborted", async () => {
        state.chunks = [{ type: "text", content: "a" }, { type: "text", content: "b" }];
        const controller = new AbortController();
        const collected: LlmStreamChunk[] = [];
        for await (const chunk of runChat(HELLO, {}, controller.signal)) {
            collected.push(chunk);
            controller.abort();
        }
        expect(collected).toEqual([{ type: "text", content: "a" }]);
    });

    describe("title generation", () => {
        it("titles the note from the opening message, including the text parts of a multimodal one", async () => {
            await collect([{ role: "user", content: "hello" }], { chatNoteId: "abc" });
            expect(generateChatTitle).toHaveBeenCalledWith("abc", "hello");

            generateChatTitle.mockClear();
            await collect([{ role: "user", content: [
                { type: "image", attachmentId: "a1", mime: "image/png" },
                { type: "text", text: "describe this" }
            ] }], { chatNoteId: "abc" });
            expect(generateChatTitle).toHaveBeenCalledWith("abc", "describe this");
        });

        it("skips an image-only opening message, a follow-up turn, and a chat with no note", async () => {
            await collect([{ role: "user", content: [{ type: "image", attachmentId: "a1", mime: "image/png" }] }], { chatNoteId: "abc" });
            expect(generateChatTitle).not.toHaveBeenCalled();

            await collect([
                { role: "user", content: "first" },
                { role: "assistant", content: "reply" },
                { role: "user", content: "second" }
            ], { chatNoteId: "abc" });
            expect(generateChatTitle).not.toHaveBeenCalled();

            await collect([{ role: "user", content: "hello" }], {});
            expect(generateChatTitle).not.toHaveBeenCalled();
        });

        it("keeps a completed chat intact when titling fails", async () => {
            generateChatTitle.mockRejectedValueOnce(new Error("title model down"));
            state.chunks = [{ type: "done" }];
            expect(await collect([{ role: "user", content: "hello" }], { chatNoteId: "abc" }))
                .toEqual([{ type: "done" }]);
            expect(errorMock).toHaveBeenCalledWith(expect.stringContaining("Failed to generate chat title"));
        });
    });
});
