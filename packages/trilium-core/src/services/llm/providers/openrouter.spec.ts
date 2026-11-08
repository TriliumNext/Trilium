import { beforeEach, describe, expect, it, vi } from "vitest";

const { createOpenRouterMock, chatMock } = vi.hoisted(() => ({
    createOpenRouterMock: vi.fn(),
    chatMock: vi.fn()
}));

// Spies around the real SDK, so a stream fed through `fetch` is parsed as it is in production.
vi.mock("@openrouter/ai-sdk-provider", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@openrouter/ai-sdk-provider")>();
    return {
        createOpenRouter: (opts: Parameters<typeof actual.createOpenRouter>[0]) => {
            createOpenRouterMock(opts);
            const sdk = actual.createOpenRouter(opts);
            return { chat: (modelId: string) => { chatMock(modelId); return sdk.chat(modelId); } };
        }
    };
});

// Attachments resolve by kind rather than from Becca: an image part to PNG bytes.
vi.mock("../attachment_content.js", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../attachment_content.js")>();
    return {
        ...actual,
        resolveAttachmentPart: (part: { type: string; text?: string }) => (part.type === "text"
            ? { kind: "text", text: part.text }
            : { kind: "image", bytes: new Uint8Array([ 137, 80, 78, 71 ]), mime: "image/png" })
    };
});

import type { LlmMessage, LlmStreamChunk } from "@triliumnext/commons";

import { installGlobalFetchAsApiTransport } from "../../../test/request_provider.js";
import { streamToChunks } from "../stream.js";
import type { LlmProviderConfig } from "../types.js";
import { llmFetch } from "./fetch.js";
import { OpenRouterProvider } from "./openrouter.js";

// A provider reaches its endpoint through the request provider rather than the global `fetch`, so
// the specs that stub that global need one installed which leads back to it.
beforeEach(installGlobalFetchAsApiTransport);

const CATALOG = [
    {
        id: "anthropic/claude-haiku-5.5", canonical_slug: "anthropic/claude-haiku-5.5-20261007",
        name: "Anthropic: Claude Haiku 5.5", context_length: 1000000,
        pricing: { prompt: "0.0000001", completion: "0.0000005" },
        architecture: { input_modalities: [ "text", "image", "file" ], output_modalities: [ "text" ] },
        supported_parameters: [ "reasoning", "tools" ]
    },
    {
        id: "anthropic/claude-haiku-5.5:batch", name: "Anthropic: Claude Haiku 5.5 (batch)",
        pricing: { prompt: "0.00000005", completion: "0.00000025" },
        architecture: { input_modalities: [ "text" ], output_modalities: [ "text" ] },
        supported_parameters: [ "tools" ]
    },
    {
        id: "~anthropic/claude-haiku-latest", name: "Anthropic: Claude Haiku Latest",
        pricing: { prompt: "0.0000001", completion: "0.0000005" },
        architecture: { input_modalities: [ "text", "image", "file" ], output_modalities: [ "text" ] },
        supported_parameters: [ "reasoning", "tools" ]
    },
    {
        id: "~unbiased/no-tools-latest", name: "No Tools Latest",
        pricing: { prompt: "0", completion: "0" },
        architecture: { input_modalities: [ "text" ], output_modalities: [ "text" ] },
        supported_parameters: [ "temperature" ]
    },
    {
        id: "openrouter/auto", name: "Auto Router", context_length: 2000000,
        pricing: { prompt: "-1", completion: "-1" },
        architecture: { input_modalities: [ "text", "image" ], output_modalities: [ "text" ] },
        supported_parameters: [ "reasoning", "tools" ]
    },
    {
        id: "meta-llama/llama-3-8b", name: "Meta: Llama 3 8B", expiration_date: "2026-11-02",
        pricing: { prompt: "0.00000003", completion: "0.00000006" },
        architecture: { input_modalities: [ "text" ], output_modalities: [ "text" ] },
        supported_parameters: [ "tools" ]
    },
    {
        id: "google/gemini-image", name: "Google: Gemini Image",
        pricing: { prompt: "0.000001", completion: "0.00003" },
        architecture: { input_modalities: [ "text", "image" ], output_modalities: [ "image" ] }
    }
];

const okJson = (body: unknown) => ({ ok: true, json: async () => body });

/** Answers `/key` with the key's details and `/models` with `models`. */
function stubListing(fetchMock: ReturnType<typeof vi.fn>, models: unknown = { data: CATALOG }) {
    fetchMock.mockImplementation(async (url: string) => (url.endsWith("/key") ? okJson({ data: { label: "sk-or-v1-…" } }) : okJson(models)));
}

describe("OpenRouterProvider construction", () => {
    beforeEach(() => {
        createOpenRouterMock.mockClear();
        chatMock.mockClear();
    });

    it("points at the official endpoint unless overridden, names the app, and requires a key", () => {
        new OpenRouterProvider("sk-or");
        expect(createOpenRouterMock).toHaveBeenCalledWith({
            apiKey: "sk-or",
            baseURL: "https://openrouter.ai/api/v1",
            compatibility: "strict",
            appName: "Trilium Notes",
            appUrl: "https://triliumnotes.org",
            fetch: llmFetch
        });

        new OpenRouterProvider("sk-or", "https://gateway.example/v1");
        expect(createOpenRouterMock).toHaveBeenLastCalledWith(expect.objectContaining({ baseURL: "https://gateway.example/v1" }));
        new OpenRouterProvider("sk-or", "");
        expect(createOpenRouterMock).toHaveBeenLastCalledWith(expect.objectContaining({ baseURL: "https://openrouter.ai/api/v1" }));

        expect(() => new OpenRouterProvider("")).toThrow(/API key is required/);
    });

    it("builds models through Chat Completions", () => {
        const provider = new OpenRouterProvider("sk-or") as any;
        provider.createModel("openrouter/auto");
        expect(chatMock).toHaveBeenCalledWith("openrouter/auto");
    });
});

describe("OpenRouterProvider model listing", () => {
    const fetchMock = vi.fn();

    beforeEach(() => {
        fetchMock.mockReset();
        vi.stubGlobal("fetch", fetchMock);
    });

    it("checks the key, and lists the chat models with the listing's metadata", async () => {
        stubListing(fetchMock);
        const provider = new OpenRouterProvider("sk-or");
        const models = await provider.listModels();

        for (const path of [ "key", "models" ]) {
            expect(fetchMock).toHaveBeenCalledWith(
                `https://openrouter.ai/api/v1/${path}`,
                expect.objectContaining({ headers: { Authorization: "Bearer sk-or" } })
            );
        }
        // Neither the batch variant nor the image generator is a chat model.
        expect(models.map(m => m.id).sort()).toEqual([
            "anthropic/claude-haiku-5.5", "meta-llama/llama-3-8b", "openrouter/auto",
            "~anthropic/claude-haiku-latest", "~unbiased/no-tools-latest"
        ]);

        const haiku = models.find(m => m.id === "anthropic/claude-haiku-5.5");
        expect(haiku).toMatchObject({
            name: "Anthropic: Claude Haiku 5.5",
            contextWindow: 1000000,
            pricing: { input: 0.1, output: 0.5 },
            reasoningEfforts: [ "low", "medium", "high" ],
            defaultReasoningEffort: "medium"
        });
        expect(haiku).not.toHaveProperty("attachmentKinds");

        // A router's price depends on the model it picks, so it has none.
        const auto = models.find(m => m.id === "openrouter/auto");
        expect(auto?.pricing).toBeUndefined();
        expect(auto?.attachmentKinds).toEqual([ "image" ]);

        const llama = models.find(m => m.id === "meta-llama/llama-3-8b");
        expect(llama).toMatchObject({ isLegacy: true, pricing: { input: 0.03, output: 0.06 }, attachmentKinds: [] });
        expect(llama).not.toHaveProperty("reasoningEfforts");

        expect(models.find(m => m.id === "~unbiased/no-tools-latest")?.pricing).toEqual({ input: 0, output: 0 });
        expect(provider.getModelPricing("anthropic/claude-haiku-5.5")).toEqual({ input: 0.1, output: 0.5 });
        expect(provider.getModelPricing("openrouter/auto")).toBeUndefined();
    });

    it("reports a rejected key and a malformed listing", async () => {
        fetchMock.mockImplementation(async (url: string) => (url.endsWith("/key")
            ? { ok: false, status: 401, json: async () => ({}) }
            : okJson({ data: CATALOG })));
        await expect(new OpenRouterProvider("sk-wrong").listModels()).rejects.toThrow(/Authentication failed \(HTTP 401\)/);

        stubListing(fetchMock, { data: { unexpected: "shape" } });
        await expect(new OpenRouterProvider("sk-or").listModels()).rejects.toThrow(/Unexpected \/models response shape/);
    });

    it("lists through a base URL override", async () => {
        stubListing(fetchMock);
        await new OpenRouterProvider("sk-or", "https://gateway.example/v1").listModels();
        expect(fetchMock).toHaveBeenCalledWith("https://gateway.example/v1/models", expect.anything());
        expect(fetchMock).toHaveBeenCalledWith("https://gateway.example/v1/key", expect.anything());
    });

    it("offers the Auto Router as the default before and after listing", async () => {
        // `runChat()` falls back to this list's default when a request names no model.
        const provider = new OpenRouterProvider("sk-or");
        expect(provider.getAvailableModels().find(m => m.isDefault)?.id).toBe("openrouter/auto");

        stubListing(fetchMock);
        const models = await provider.listModels();
        expect(models.filter(m => m.isDefault).map(m => m.id)).toEqual([ "openrouter/auto" ]);
    });

    it("pre-selects the rolling aliases that can call tools", async () => {
        stubListing(fetchMock);
        const provider = new OpenRouterProvider("sk-or");
        const recommended = provider.recommendedModelIds(await provider.listModels());
        expect([ ...recommended ]).toEqual([ "~anthropic/claude-haiku-latest" ]);
    });
});

describe("OpenRouterProvider turn report", () => {
    const fetchMock = vi.fn();
    const noStoredName = () => undefined;
    /** A step as `streamText()` reports it: the model that answered, and OpenRouter's usage in its metadata. */
    const step = (modelId: string, cost?: number) => ({
        response: { modelId },
        providerMetadata: { openrouter: { provider: "Google Vertex", usage: cost === undefined ? {} : { cost } } }
    }) as never;

    beforeEach(() => {
        fetchMock.mockReset();
        vi.stubGlobal("fetch", fetchMock);
    });

    it("adds up what OpenRouter billed each step, unless a step went unbilled", async () => {
        const provider = new OpenRouterProvider("sk-or");
        expect((await provider.describeTurn([ step("openrouter/auto", 0.0012), step("openrouter/auto", 0.0003) ], "openrouter/auto", noStoredName)).cost)
            .toBeCloseTo(0.0015, 10);
        expect((await provider.describeTurn([ step("openrouter/auto", 0.0012), step("openrouter/auto") ], "openrouter/auto", noStoredName)).cost)
            .toBeUndefined();
    });

    it("names the model a router picked: from the stored selection, else from the listing, else by its id", async () => {
        const provider = new OpenRouterProvider("sk-or");

        // The model asked for answered, so its name stands and nothing is fetched.
        expect((await provider.describeTurn([ step("anthropic/claude-haiku-5.5") ], "anthropic/claude-haiku-5.5", noStoredName)).model).toBeUndefined();

        // A routed model the user selected is named without a request.
        expect((await provider.describeTurn([ step("anthropic/claude-haiku-5.5") ], "openrouter/auto", () => "Claude Haiku (mine)")).model)
            .toBe("Claude Haiku (mine)");
        expect(fetchMock).not.toHaveBeenCalled();

        // One that isn't is named from the listing, matched by id or by its dated slug.
        stubListing(fetchMock);
        expect((await provider.describeTurn([ step("anthropic/claude-haiku-5.5-20261007") ], "openrouter/auto", noStoredName)).model)
            .toBe("Anthropic: Claude Haiku 5.5");
        // The dated slug of the model asked for is still that model.
        expect((await provider.describeTurn([ step("anthropic/claude-haiku-5.5-20261007") ], "anthropic/claude-haiku-5.5", noStoredName)).model)
            .toBeUndefined();

        // Offline, the id is all there is.
        fetchMock.mockRejectedValue(new Error("offline"));
        expect((await new OpenRouterProvider("sk-or").describeTurn([ step("x-ai/grok-9") ], "openrouter/auto", noStoredName)).model)
            .toBe("x-ai/grok-9");
    });
});

describe("OpenRouterProvider chat", () => {
    const fetchMock = vi.fn();

    beforeEach(() => {
        fetchMock.mockReset();
        fetchMock.mockImplementation(async () => sseResponse([
            { choices: [ { index: 0, delta: { role: "assistant", content: "Ok" }, finish_reason: "stop" } ] }
        ]));
        vi.stubGlobal("fetch", fetchMock);
    });

    async function requestBody(config: LlmProviderConfig) {
        fetchMock.mockClear();
        for await (const _ of streamToChunks(new OpenRouterProvider("sk-or").chat([ { role: "user", content: "Hi" } ], config))) { /* drain */ }
        expect(fetchMock).toHaveBeenCalledOnce();
        const [ url, init ] = fetchMock.mock.calls[0] as [ string, RequestInit ];
        expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
        return { body: JSON.parse(String(init.body)), headers: new Headers(init.headers) };
    }

    it("sends the chosen effort, and leaves the model at its own default otherwise", async () => {
        expect((await requestBody({ model: "anthropic/claude-haiku-5.5", reasoningEffort: "high" })).body)
            .toMatchObject({ model: "anthropic/claude-haiku-5.5", reasoning: { effort: "high" } });
        expect((await requestBody({ model: "anthropic/claude-haiku-5.5" })).body).not.toHaveProperty("reasoning");
        // A level OpenRouter's list doesn't offer is not passed through.
        expect((await requestBody({ model: "anthropic/claude-haiku-5.5", reasoningEffort: "max" })).body).not.toHaveProperty("reasoning");
    });

    it("sends a placeholder for an earlier attachment the stored model can't read", async () => {
        // The chat's provider instance never lists models, so the kinds come from the stored selection.
        const messages: LlmMessage[] = [
            { role: "user", content: [ { type: "text", text: "What is this?" }, { type: "image", attachmentId: "img1", mime: "image/png" } ] },
            { role: "assistant", content: "A cat." },
            { role: "user", content: "And now?" }
        ];
        fetchMock.mockClear();
        const config: LlmProviderConfig = { model: "deepseek/deepseek-v4-pro", attachmentKinds: [] };
        for await (const _ of streamToChunks(new OpenRouterProvider("sk-or").chat(messages, config))) { /* drain */ }
        const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
        const first = body.messages.find((m: { role: string }) => m.role === "user").content;
        expect(JSON.stringify(first)).toContain("[attached image]");
        expect(JSON.stringify(first)).not.toContain("image_url");
    });

    it("names Trilium on each request", async () => {
        const { headers } = await requestBody({ model: "openrouter/auto" });
        expect(headers.get("Authorization")).toBe("Bearer sk-or");
        expect(headers.get("HTTP-Referer")).toBe("https://triliumnotes.org");
        expect(headers.get("X-OpenRouter-Title")).toBe("Trilium Notes");
    });

    it("streams `reasoning` as thinking ahead of the answer", async () => {
        fetchMock.mockImplementation(async () => sseResponse([
            { choices: [ { index: 0, delta: { role: "assistant", reasoning: "Weighing " } } ] },
            { choices: [ { index: 0, delta: { reasoning: "the options." } } ] },
            { choices: [ { index: 0, delta: { content: "Pick B." } } ] },
            { choices: [ { index: 0, delta: {}, finish_reason: "stop" } ], usage: { prompt_tokens: 5, completion_tokens: 7 } }
        ]));
        const chunks: LlmStreamChunk[] = [];
        for await (const chunk of streamToChunks(new OpenRouterProvider("sk-or").chat([ { role: "user", content: "A or B?" } ], { model: "openrouter/auto" }))) {
            chunks.push(chunk);
        }
        expect(chunks.filter(c => c.type === "thinking" || c.type === "text")).toEqual([
            { type: "thinking", content: "Weighing " },
            { type: "thinking", content: "the options." },
            { type: "text", content: "Pick B." }
        ]);
    });
});

function sseResponse(events: object[]) {
    const body = `${events.map(e => `data: ${JSON.stringify({ id: "c1", created: 0, model: "openrouter/auto", ...e })}\n\n`).join("")}data: [DONE]\n\n`;
    return new Response(body, { headers: { "content-type": "text/event-stream" } });
}
