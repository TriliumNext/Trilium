import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";

const createOpenAIMock = vi.fn();
const webSearchMock = vi.fn(() => ({ kind: "web_search" }));
const modelMock = vi.fn((modelId: string) => ({ modelId }));

vi.mock("@ai-sdk/openai", () => ({
    createOpenAI: (opts: unknown) => {
        createOpenAIMock(opts);
        const fn: any = (modelId: string) => modelMock(modelId);
        fn.tools = { webSearch: webSearchMock };
        return fn;
    }
}));

const { streamTextMock } = vi.hoisted(() => ({
    streamTextMock: vi.fn((..._args: any[]) => ({}) as any)
}));

vi.mock("ai", async (importOriginal) => {
    const actual = await importOriginal<typeof import("ai")>();
    return { ...actual, streamText: streamTextMock };
});

import { isOpenAiChatModel, openAiModelName, OpenAiProvider } from "./openai.js";

describe("OpenAiProvider construction", () => {
    beforeEach(() => {
        createOpenAIMock.mockClear();
    });

    it("forwards apiKey only when no baseURL provided", () => {
        new OpenAiProvider("sk-test");
        expect(createOpenAIMock).toHaveBeenCalledTimes(1);
        expect(createOpenAIMock).toHaveBeenCalledWith({ apiKey: "sk-test" });
    });

    it("forwards apiKey and baseURL when both provided", () => {
        new OpenAiProvider("sk-test", "http://localhost:11434/v1");
        expect(createOpenAIMock).toHaveBeenCalledWith({
            apiKey: "sk-test",
            baseURL: "http://localhost:11434/v1"
        });
    });

    it("omits baseURL when empty string is provided", () => {
        new OpenAiProvider("sk-test", "");
        expect(createOpenAIMock).toHaveBeenCalledWith({ apiKey: "sk-test" });
    });

    it("throws when apiKey is missing", () => {
        expect(() => new OpenAiProvider("")).toThrow(/API key is required/);
    });
});

describe("OpenAiProvider chat", () => {
    beforeEach(() => {
        streamTextMock.mockClear();
        webSearchMock.mockClear();
        modelMock.mockClear();
    });

    it("createModel uses the configured model id, falling back to the default", () => {
        const provider = new OpenAiProvider("sk-test");
        provider.chat([{ role: "user", content: "hi" }], {});
        expect(modelMock).toHaveBeenLastCalledWith("gpt-4.1");

        provider.chat([{ role: "user", content: "hi" }], { model: "o3" });
        expect(modelMock).toHaveBeenLastCalledWith("o3");
    });

    it("adds the OpenAI web_search tool when web search is enabled", () => {
        const provider = new OpenAiProvider("sk-test");
        provider.chat([{ role: "user", content: "hi" }], { enableWebSearch: true });

        expect(webSearchMock).toHaveBeenCalledOnce();
        const opts = streamTextMock.mock.calls[0][0] as any;
        expect(opts.tools.web_search).toEqual({ kind: "web_search" });
        // Tools present → agentic loop options are set.
        expect(opts.toolChoice).toBe("auto");
        expect(opts.stopWhen).toBeDefined();
    });
});

describe("OpenAiProvider model listing", () => {
    const fetchMock = vi.fn();

    beforeEach(() => {
        fetchMock.mockReset();
        vi.stubGlobal("fetch", fetchMock);
    });
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    const okJson = (body: unknown) => ({ ok: true, json: async () => body });

    it("filters non-chat models, drops dated snapshots, and names unknown models", async () => {
        fetchMock.mockResolvedValue(okJson({ data: [
            { id: "gpt-4.1" },
            { id: "whisper-1" }, // non-chat
            { id: "text-embedding-3-large" }, // non-chat
            { id: "gpt-4.1-2025-04-14" }, // dated snapshot of gpt-4.1
            { id: "gpt-9" }
        ] }));
        const provider = new OpenAiProvider("sk-test");

        const models = await provider.listModels();
        expect(fetchMock).toHaveBeenCalledWith(
            "https://api.openai.com/v1/models",
            expect.objectContaining({ headers: { Authorization: "Bearer sk-test" } })
        );
        expect(models.map((m) => m.id)).toEqual(["gpt-4.1", "gpt-9"]);
        // Curated metadata survives the merge...
        expect(models[0]).toMatchObject({ name: "GPT-4.1", isDefault: true });
        // ...and an unknown model gets a generated friendly name, no pricing.
        expect(models[1]).toMatchObject({ id: "gpt-9", name: "GPT-9" });
        expect(models[1].pricing).toBeUndefined();
    });

    it("lists a custom endpoint unfiltered (self-hosted Ollama/vLLM)", async () => {
        fetchMock.mockResolvedValue(okJson({ data: [{ id: "llama3.2" }, { id: "nomic-embed-text" }] }));
        // Trailing slash on the user-entered base URL is normalized away.
        const provider = new OpenAiProvider("unused", "http://localhost:11434/v1/");

        const models = await provider.listModels();
        expect(fetchMock).toHaveBeenCalledWith("http://localhost:11434/v1/models", expect.anything());
        expect(models.map((m) => m.id)).toEqual(["llama3.2", "nomic-embed-text"]);
        // None of the curated models exist here → the first model becomes default.
        expect(models[0].isDefault).toBe(true);
    });

    it("propagates HTTP errors so a bad key/endpoint surfaces in the modal", async () => {
        fetchMock.mockResolvedValue({ ok: false, status: 500 });
        const provider = new OpenAiProvider("sk-test");
        await expect(provider.listModels()).rejects.toThrow("HTTP 500");
    });

    it("reports a friendly authentication error on a 401", async () => {
        fetchMock.mockResolvedValue({ ok: false, status: 401 });
        const provider = new OpenAiProvider("sk-test");
        await expect(provider.listModels()).rejects.toThrow(/Authentication failed/);
    });

    it("propagates a malformed response body", async () => {
        fetchMock.mockResolvedValue(okJson({ nope: true }));
        const provider = new OpenAiProvider("sk-test");
        await expect(provider.listModels()).rejects.toThrow(/Unexpected .* response shape/);
    });
});

describe("isOpenAiChatModel", () => {
    it("keeps chat model families, including unknown future ones", () => {
        for (const id of ["gpt-4.1", "gpt-5", "gpt-5.6-sol", "o3", "o4-mini", "chatgpt-4o-latest"]) {
            expect(isOpenAiChatModel(id), id).toBe(true);
        }
    });

    it("drops non-chat families", () => {
        for (const id of [
            "text-embedding-3-large",
            "whisper-1",
            "tts-1-hd",
            "dall-e-3",
            "omni-moderation-latest",
            "gpt-4o-realtime-preview",
            "gpt-4o-audio-preview",
            "gpt-4o-transcribe",
            "gpt-image-1",
            "sora-2",
            "computer-use-preview",
            "codex-mini-latest",
            "gpt-3.5-turbo-instruct",
            "o3-deep-research",
            "babbage-002",
            "davinci-002",
            "gpt-4o-search-preview",
            "chat-latest" // bare rolling alias, dropped; versioned gpt-*-chat-latest are kept
        ]) {
            expect(isOpenAiChatModel(id), id).toBe(false);
        }
    });

    it("drops pinned snapshots that duplicate a rolling base id", () => {
        for (const id of [
            "gpt-4o-2024-05-13",
            "gpt-5-2025-08-07",
            "gpt-4.1-mini-2025-04-14",
            "gpt-4-turbo-2024-04-09",
            "o3-2025-04-16",
            "o4-mini-2025-04-16",
            "gpt-3.5-turbo-0125",
            "gpt-3.5-turbo-1106",
            "gpt-4-0613"
        ]) {
            expect(isOpenAiChatModel(id), id).toBe(false);
        }
        // ...but the rolling base ids and non-snapshot suffixes survive.
        for (const id of ["gpt-4o", "gpt-5", "gpt-4.1-mini", "gpt-3.5-turbo-16k", "gpt-5-chat-latest"]) {
            expect(isOpenAiChatModel(id), id).toBe(true);
        }
    });
});

describe("openAiModelName", () => {
    it("prettifies gpt-* ids into friendly names", () => {
        expect(openAiModelName("gpt-4.1")).toBe("GPT-4.1");
        expect(openAiModelName("gpt-4.1-mini")).toBe("GPT-4.1 Mini");
        expect(openAiModelName("gpt-4o")).toBe("GPT-4o");
        expect(openAiModelName("gpt-4o-mini")).toBe("GPT-4o Mini");
        expect(openAiModelName("gpt-5.6-sol")).toBe("GPT-5.6 Sol");
        expect(openAiModelName("gpt-3.5-turbo")).toBe("GPT-3.5 Turbo");
        expect(openAiModelName("gpt-5-chat-latest")).toBe("GPT-5 Chat Latest");
    });

    it("leaves the o-series in OpenAI's canonical lowercase-hyphenated form", () => {
        // Kept distinct from "GPT-4o Mini"; only the GPT family is reshaped.
        expect(openAiModelName("o1")).toBe("o1");
        expect(openAiModelName("o3")).toBe("o3");
        expect(openAiModelName("o3-mini")).toBe("o3-mini");
        expect(openAiModelName("o4-mini")).toBe("o4-mini");
        expect(openAiModelName("o1-pro")).toBe("o1-pro");
    });

    it("leaves non-OpenAI ids untouched", () => {
        expect(openAiModelName("llama3.2")).toBe("llama3.2"); // self-hosted endpoint
        expect(openAiModelName("chatgpt-4o-latest")).toBe("chatgpt-4o-latest");
    });
});

describe("OpenAiProvider recommendedModelIds", () => {
    const recommend = (ids: string[]) =>
        new OpenAiProvider("sk-test").recommendedModelIds(ids.map(id => ({ id, name: id })));

    it("recommends only the newest generation of each OpenAI line, core tiers only", () => {
        // A representative slice of a live OpenAI /models response.
        const ids = recommend([
            "gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano", "gpt-4o", "gpt-4", "gpt-3.5-turbo",
            "gpt-5", "gpt-5-mini", "gpt-5-chat-latest", "gpt-5.4", "gpt-5.4-mini", "gpt-5.4-pro",
            "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna",
            "o1", "o1-pro", "o3", "o3-mini", "o4-mini"
        ]);
        // Newest GPT generation (5.6) + newest o-series (o4) — nothing older.
        expect([...ids].sort()).toEqual(["gpt-5.6-luna", "gpt-5.6-sol", "gpt-5.6-terra", "o4-mini"]);
    });

    it("excludes -pro and -chat-latest even within the newest generation", () => {
        expect([...recommend(["gpt-9-sol", "gpt-9-pro", "gpt-9-chat-latest"])]).toEqual(["gpt-9-sol"]);
    });

    it("degrades to the newest available generation for an older-only endpoint", () => {
        expect([...recommend(["gpt-4", "gpt-4.1", "gpt-4o"])]).toEqual(["gpt-4.1"]); // 4.1 > 4o (4.0) > 4
    });

    it("recommends nothing for an OpenAI-compatible endpoint with no gpt/o models", () => {
        expect(recommend(["llama3.2", "qwen2.5"]).size).toBe(0);
    });

    it("recommends unversioned gpt-* models when nothing versioned outranks them", () => {
        // A self-hosted endpoint serving OpenAI's open-weight models: `gpt-oss-*`
        // starts with `gpt-` but carries no version, so all of them tie at 0.
        expect([...recommend(["gpt-oss-120b", "gpt-oss-20b"])].sort())
            .toEqual(["gpt-oss-120b", "gpt-oss-20b"]);
        // ...but any real GPT generation outranks them.
        expect([...recommend(["gpt-oss-120b", "gpt-4.1"])]).toEqual(["gpt-4.1"]);
    });
});
