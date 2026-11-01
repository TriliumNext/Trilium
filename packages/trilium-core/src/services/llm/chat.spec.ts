import type { LlmMessage, LlmStreamChunk } from "@triliumnext/commons";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
    configured: true,
    chunks: [] as unknown[],
    availableModels: [{ id: "m1", name: "Model One", isDefault: true }] as { id: string; name: string; isDefault?: boolean }[],
    /** What `getSelectedModel()` finds in the stored provider configuration. */
    selectedModel: undefined as { id: string; name: string; attachmentKinds?: string[] } | undefined,
    chatThrows: undefined as unknown,
    /** When true the fake provider is chunk-native, and records the signal it was handed. */
    chunkNative: false,
    chunkSignal: undefined as AbortSignal | undefined,
    /** When true the chunk-native provider asks about a tool call and reports the answer. */
    asksApproval: false,
    /** Records how runChat resolved the provider. */
    providerIdRequested: undefined as string | undefined,
    providerTypeRequested: undefined as string | undefined,
    /** The config the provider's `chat()` was handed. */
    chatConfig: undefined as unknown,
    /** The abort signal the provider's `chat()` was handed. */
    chatSignal: undefined as AbortSignal | undefined,
    /** When true the fake provider reports on its turns, and records what it was asked. */
    describesTurns: false,
    describeTurnArgs: undefined as unknown[] | undefined,
    /** The options `streamToChunks()` was handed. */
    streamOptions: undefined as StreamOptions | undefined
}));

vi.mock("./index.js", () => {
    const makeProvider = (resolvedFrom: string) => ({
        name: "fake",
        resolvedFrom,
        chat: (_messages: unknown, config: unknown, signal?: AbortSignal) => {
            state.chatConfig = config;
            state.chatSignal = signal;
            if (state.chatThrows !== undefined) throw state.chatThrows;
            return {};
        },
        chatChunks: state.chunkNative
            ? async function* (_messages: unknown, config: LlmProviderConfig, signal?: AbortSignal) {
                state.chunkSignal = signal;
                for (const c of state.chunks) yield c;
                if (state.asksApproval) {
                    const toolInput = { title: "New" };
                    yield { type: "tool_use", toolCallId: "c1", toolName: "create_note", toolInput };
                    const approved = await config.toolApprovals?.request({ toolCallId: "c1", toolName: "create_note", toolInput });
                    yield { type: "text", content: `approved: ${approved}` };
                }
            }
            : undefined,
        describeTurn: state.describesTurns
            ? async (...args: unknown[]) => { state.describeTurnArgs = args; return { model: "Routed" }; }
            : undefined,
        getAvailableModels: () => state.availableModels,
        getModelPricing: () => ({ input: 0, output: 0 })
    });
    return {
        hasConfiguredProviders: () => state.configured,
        getSelectedModel: () => state.selectedModel,
        getSearchProviderSetup: (id: string | undefined) => (id === "s1" ? { id: "s1", provider: "tavily", apiKey: "tk" } : undefined),
        getProvider: (id: string) => { state.providerIdRequested = id; return makeProvider(`id:${id}`); },
        getProviderByType: (type: string) => { state.providerTypeRequested = type; return makeProvider(`type:${type}`); }
    };
});

// Only the stream itself is faked; `formatStreamError` (used for the log line) is a pure
// function and stays real, so the logged text is asserted against the production format.
vi.mock("./stream.js", async (importOriginal) => ({
    ...await importOriginal<typeof import("./stream.js")>(),
    async *streamToChunks(_result: unknown, options: StreamOptions) {
        state.streamOptions = options;
        for (const c of state.chunks) yield c;
    }
}));

const generateChatTitle = vi.fn(async (..._args: unknown[]) => {});
vi.mock("./chat_title.js", () => ({ generateChatTitle: (...args: unknown[]) => generateChatTitle(...args) }));

const errorMock = vi.fn();
vi.mock("../log.js", async (importOriginal) => ({
    ...await importOriginal<typeof import("../log.js")>(),
    getLog: () => ({ error: errorMock, info: vi.fn(), warn: vi.fn() })
}));

import { runChat } from "./chat.js";
import type { StreamOptions } from "./stream.js";
import { answerToolApproval } from "./tool_approval.js";
import type { LlmProviderConfig } from "./types.js";

/** Drain a completion into an array, which is how every assertion here reads it. */
async function collect(messages: LlmMessage[], config: object = {}, signal?: AbortSignal): Promise<LlmStreamChunk[]> {
    const collected: LlmStreamChunk[] = [];
    for await (const chunk of runChat("s1", messages, config, signal)) {
        collected.push(chunk);
    }
    return collected;
}

const HELLO: LlmMessage[] = [{ role: "user", content: "hi" }];

describe("runChat", () => {
    it("routes web search through the stored search provider the request names, and only that", async () => {
        const smuggled = { provider: "brave", apiKey: "stolen", baseURL: "http://169.254.169.254" };

        await collect(HELLO, { enableWebSearch: true, webSearchProviderId: "s1", webSearch: smuggled });
        expect((state.chatConfig as { webSearch?: unknown }).webSearch).toEqual({ id: "s1", provider: "tavily", apiKey: "tk" });

        await collect(HELLO, { enableWebSearch: true, webSearchProviderId: "deleted", webSearch: smuggled });
        expect((state.chatConfig as { webSearch?: unknown }).webSearch).toBeUndefined();
    });

    afterEach(() => {
        Object.assign(state, {
            configured: true,
            chunks: [],
            availableModels: [{ id: "m1", name: "Model One", isDefault: true }],
            selectedModel: undefined,
            describesTurns: false,
            describeTurnArgs: undefined,
            streamOptions: undefined,
            chatThrows: undefined,
            chunkNative: false,
            chunkSignal: undefined,
            asksApproval: false,
            providerIdRequested: undefined,
            providerTypeRequested: undefined,
            chatConfig: undefined
        });
        generateChatTitle.mockClear();
        errorMock.mockClear();
    });

    it("hands the provider the attachment kinds of the stored model, never the request's", async () => {
        state.selectedModel = { id: "m1", name: "Model One", attachmentKinds: [] };
        await collect(HELLO, { model: "m1", attachmentKinds: [ "image", "file" ] });
        expect((state.chatConfig as LlmProviderConfig).attachmentKinds).toEqual([]);

        // A stored model without the field reads everything, so the provider decides.
        state.selectedModel = { id: "m1", name: "Model One" };
        await collect(HELLO, { model: "m1", attachmentKinds: [ "image" ] });
        expect((state.chatConfig as LlmProviderConfig).attachmentKinds).toBeUndefined();
    });

    it("hands a provider that reports on its turns the steps, the model asked for and the stored names", async () => {
        await collect(HELLO, { model: "m1" });
        expect(state.streamOptions?.describeTurn).toBeUndefined();

        state.describesTurns = true;
        state.selectedModel = { id: "m2", name: "Model Two" };
        await collect(HELLO, { model: "m1" });
        const steps = [ { response: { modelId: "m2" } } ];
        expect(await state.streamOptions?.describeTurn?.(steps as never)).toEqual({ model: "Routed" });

        const [ seenSteps, requested, modelName ] = state.describeTurnArgs ?? [];
        expect(seenSteps).toBe(steps);
        expect(requested).toBe("m1");
        expect((modelName as (id: string) => string | undefined)("m2")).toBe("Model Two");
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

    it("hands the abort signal to an AI SDK provider too, so its tool calls stop with the turn", async () => {
        const controller = new AbortController();
        await collect(HELLO, {}, controller.signal);
        expect(state.chatSignal).toBe(controller.signal);
    });

    it("stops at the next chunk once aborted", async () => {
        state.chunks = [{ type: "text", content: "a" }, { type: "text", content: "b" }];
        const controller = new AbortController();
        const collected: LlmStreamChunk[] = [];
        for await (const chunk of runChat("s1", HELLO, {}, controller.signal)) {
            collected.push(chunk);
            controller.abort();
        }
        expect(collected).toEqual([{ type: "text", content: "a" }]);
    });

    describe("tool approval", () => {
        const TOOL_USE = { type: "tool_use", toolCallId: "c1", toolName: "create_note", toolInput: { title: "New" } };
        const REQUEST = { type: "tool_approval_request", toolCallId: "c1", toolName: "create_note", toolInput: { title: "New" } };

        it("announces a waiting call while it holds the stream, and resumes once the user answers", async () => {
            state.chunkNative = true;
            state.asksApproval = true;
            const turn = runChat("s1", HELLO, {});

            expect((await turn.next()).value).toEqual(TOOL_USE);
            expect((await turn.next()).value).toEqual(REQUEST);
            expect(answerToolApproval("s1", "c1", true)).toBe(true);
            expect((await turn.next()).value).toEqual({ type: "text", content: "approved: true" });
            expect((await turn.next()).done).toBe(true);
            // The turn has ended, so nothing waits under its id any more.
            expect(answerToolApproval("s1", "c1", true)).toBe(false);
        });

        it("runs a call of a tool the chat allowed without announcing it", async () => {
            state.chunkNative = true;
            state.asksApproval = true;
            const turn = runChat("s1", HELLO, { allowedTools: [ "create_note" ] });

            expect((await turn.next()).value).toEqual(TOOL_USE);
            expect((await turn.next()).value).toEqual({ type: "text", content: "approved: true" });
            expect((await turn.next()).done).toBe(true);
        });

        it("runs a call the permission mode lets through without announcing it", async () => {
            state.chunkNative = true;
            state.asksApproval = true;
            const turn = runChat("s1", HELLO, { permissionMode: "dont_ask" });

            expect((await turn.next()).value).toEqual(TOOL_USE);
            expect((await turn.next()).value).toEqual({ type: "text", content: "approved: true" });
            expect((await turn.next()).done).toBe(true);
        });

        it("declines a waiting call when the turn is stopped", async () => {
            state.chunkNative = true;
            state.asksApproval = true;
            const controller = new AbortController();
            const turn = runChat("s1", HELLO, {}, controller.signal);

            expect((await turn.next()).value).toEqual(TOOL_USE);
            expect((await turn.next()).value).toEqual(REQUEST);
            const resumed = turn.next();
            controller.abort();
            // Stopped, the turn ends at its next chunk; the call itself was declined.
            expect((await resumed).done).toBe(true);
            expect(answerToolApproval("s1", "c1", true)).toBe(false);
        });

        it("refuses a stream id that another running turn holds", async () => {
            state.chunkNative = true;
            state.asksApproval = true;
            const first = runChat("s1", HELLO, {});
            await first.next();

            expect(await collect(HELLO)).toEqual([{ type: "error", error: "Stream 's1' is already running." }]);

            await first.return(undefined);
            state.asksApproval = false;
            state.chunks = [{ type: "done" }];
            expect(await collect(HELLO)).toEqual([{ type: "done" }]);
        });
    });

    describe("title generation", () => {
        it("titles the note from the opening message, including the text parts of a multimodal one", async () => {
            await collect([{ role: "user", content: "hello" }], { chatNoteId: "abc" });
            expect(generateChatTitle).toHaveBeenCalledWith("abc", "hello", expect.anything());

            generateChatTitle.mockClear();
            await collect([{ role: "user", content: [
                { type: "image", attachmentId: "a1", mime: "image/png" },
                { type: "text", text: "describe this" }
            ] }], { chatNoteId: "abc" });
            expect(generateChatTitle).toHaveBeenCalledWith("abc", "describe this", expect.anything());
        });

        it("titles the note with the provider the chat talks to", async () => {
            await collect([{ role: "user", content: "hello" }], { chatNoteId: "abc", providerId: "p2" });
            expect(generateChatTitle).toHaveBeenCalledWith("abc", "hello", expect.objectContaining({ resolvedFrom: "id:p2" }));

            generateChatTitle.mockClear();
            await collect([{ role: "user", content: "hello" }], { chatNoteId: "abc", provider: "openai" });
            expect(generateChatTitle).toHaveBeenCalledWith("abc", "hello", expect.objectContaining({ resolvedFrom: "type:openai" }));
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
