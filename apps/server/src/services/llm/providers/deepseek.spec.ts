import { beforeEach, describe, expect, it, vi } from "vitest";

const createOpenAiMock = vi.fn();
const chatMock = vi.fn(() => ({}));

vi.mock("@ai-sdk/openai", () => ({
    createOpenAI: (opts: unknown) => {
        createOpenAiMock(opts);
        const fn: any = () => ({});
        fn.chat = chatMock;
        return fn;
    }
}));

const { generateTextMock } = vi.hoisted(() => ({
    generateTextMock: vi.fn(async () => ({ text: "  A generated title  " }) as any)
}));

vi.mock("ai", async (importOriginal) => {
    const actual = await importOriginal<typeof import("ai")>();
    return { ...actual, generateText: generateTextMock };
});

import { DeepSeekProvider, deepSeekModelName } from "./deepseek.js";

describe("DeepSeekProvider construction", () => {
    beforeEach(() => {
        createOpenAiMock.mockClear();
        chatMock.mockClear();
    });

    it("points at the official endpoint unless overridden, and requires a key", () => {
        new DeepSeekProvider("sk-deep");
        expect(createOpenAiMock).toHaveBeenCalledWith({ apiKey: "sk-deep", baseURL: "https://api.deepseek.com/v1" });

        // An override reaches a gateway in front of DeepSeek; a blank one is no override.
        new DeepSeekProvider("sk-deep", "https://gateway.example/v1");
        expect(createOpenAiMock).toHaveBeenLastCalledWith({ apiKey: "sk-deep", baseURL: "https://gateway.example/v1" });
        new DeepSeekProvider("sk-deep", "");
        expect(createOpenAiMock).toHaveBeenLastCalledWith({ apiKey: "sk-deep", baseURL: "https://api.deepseek.com/v1" });

        expect(() => new DeepSeekProvider("")).toThrow(/API key is required/);
    });

    it("builds models through Chat Completions, which is all DeepSeek implements", () => {
        const provider = new DeepSeekProvider("sk-deep") as any;
        provider.createModel("deepseek-chat");
        // `.chat()`, not the callable default — that would be the Responses API.
        expect(chatMock).toHaveBeenCalledWith("deepseek-chat");
    });
});

describe("DeepSeekProvider model listing", () => {
    const fetchMock = vi.fn();
    const okJson = (body: unknown) => ({ ok: true, json: async () => body });

    beforeEach(() => {
        fetchMock.mockReset();
        vi.stubGlobal("fetch", fetchMock);
    });

    it("lists /models with a bearer key and prices the ids against the committed table", async () => {
        fetchMock.mockResolvedValue(okJson({ data: [{ id: "deepseek-chat" }, { id: "deepseek-reasoner" }] }));
        const provider = new DeepSeekProvider("sk-deep");

        const models = await provider.listModels();
        expect(fetchMock).toHaveBeenCalledWith(
            "https://api.deepseek.com/v1/models",
            expect.objectContaining({ headers: { Authorization: "Bearer sk-deep" } })
        );
        expect(models.map(m => m.id)).toEqual(["deepseek-chat", "deepseek-reasoner"]);
        // The whole point of carding DeepSeek rather than leaving it to the generic
        // endpoint: its bare ids join against model_prices.json, so cost and context
        // resolve. Values live in the committed table, so only assert they are there.
        expect(models[0].pricing).toBeDefined();
        expect(models[0].contextWindow).toBeGreaterThan(0);
        // Both cost the same, so the tie goes to the first listed — chat, not the
        // reasoner, which spends far more tokens for the same price per token.
        expect(models[0]).toMatchObject({ isDefault: true, name: "DeepSeek Chat" });
    });

    it("repoints the defaults at the ids the account actually lists", async () => {
        // A v4-era account lists neither `deepseek-chat` nor `deepseek-reasoner`,
        // so the hardcoded fallbacks must not survive a successful listing —
        // generating a title with an unlisted model is a request that just fails.
        fetchMock.mockResolvedValue(okJson({ data: [{ id: "deepseek-v4-pro" }, { id: "deepseek-v4-flash" }] }));
        const provider = new DeepSeekProvider("sk-deep") as any;

        const models = await provider.listModels();
        // Cheapest for titles, flagship for conversation.
        expect(provider.titleModel).toBe("deepseek-v4-flash");
        expect(provider.defaultModel).toBe("deepseek-v4-pro");
        expect(models.find((m: any) => m.isDefault)?.id).toBe("deepseek-v4-pro");

        // Same verdict whichever order the endpoint happens to list them in.
        fetchMock.mockResolvedValue(okJson({ data: [{ id: "deepseek-v4-flash" }, { id: "deepseek-v4-pro" }] }));
        const reversed = new DeepSeekProvider("sk-deep") as any;
        await reversed.listModels();
        expect(reversed.titleModel).toBe("deepseek-v4-flash");
        expect(reversed.defaultModel).toBe("deepseek-v4-pro");
    });

    it("keeps the alias when a listing never happens, and never titles with an unpriced id", async () => {
        // Offline: the fallback alias is all there is, and generateTitle must not
        // throw on the listing it attempts first.
        fetchMock.mockRejectedValue(new Error("offline"));
        const offline = new DeepSeekProvider("sk-deep") as any;
        await expect(offline.listModels()).rejects.toThrow("offline");
        expect(offline.titleModel).toBe("deepseek-chat");

        // A gateway serving ids the price table doesn't know: unpriced ids sort
        // last, so a priced one is still preferred for titles.
        fetchMock.mockResolvedValue(okJson({ data: [{ id: "some-proxy-model" }, { id: "deepseek-v4-flash" }] }));
        const proxied = new DeepSeekProvider("sk-deep") as any;
        await proxied.listModels();
        expect(proxied.titleModel).toBe("deepseek-v4-flash");
    });

    it("leaves the fallbacks alone when the endpoint lists nothing", async () => {
        // An empty catalogue gives nothing to point the defaults at, so the aliases
        // stand and the base class falls back to the price table's own list.
        fetchMock.mockResolvedValue(okJson({ data: [] }));
        const provider = new DeepSeekProvider("sk-deep") as any;
        await provider.listModels();
        expect(provider.titleModel).toBe("deepseek-chat");
        expect(provider.defaultModel).toBe("deepseek-chat");
    });

    it("falls back to listing order when the table prices none of the models", async () => {
        // A gateway serving ids the table doesn't know: nothing can be ranked on
        // cost, so both defaults settle on the first one listed.
        fetchMock.mockResolvedValue(okJson({ data: [{ id: "house-model" }, { id: "other-model" }] }));
        const provider = new DeepSeekProvider("sk-deep") as any;
        await provider.listModels();
        expect(provider.titleModel).toBe("house-model");
        expect(provider.defaultModel).toBe("house-model");
    });

    it("honours a base URL override and surfaces listing failures", async () => {
        fetchMock.mockResolvedValue(okJson({ data: [{ id: "deepseek-chat" }] }));
        await new DeepSeekProvider("sk-deep", "https://gateway.example/v1").listModels();
        expect(fetchMock).toHaveBeenCalledWith("https://gateway.example/v1/models", expect.anything());

        fetchMock.mockRejectedValue(new Error("offline"));
        await expect(new DeepSeekProvider("sk-deep").listModels()).rejects.toThrow("offline");

        fetchMock.mockResolvedValue(okJson({ data: { unexpected: "shape" } }));
        await expect(new DeepSeekProvider("sk-deep").listModels()).rejects.toThrow(/Unexpected \/models response shape/);
    });
});

describe("DeepSeekProvider title generation", () => {
    const fetchMock = vi.fn();
    const okJson = (body: unknown) => ({ ok: true, json: async () => body });

    beforeEach(() => {
        fetchMock.mockReset();
        chatMock.mockClear();
        generateTextMock.mockClear();
        vi.stubGlobal("fetch", fetchMock);
    });

    it("lists the endpoint first, so the title goes to a model the account has", async () => {
        fetchMock.mockResolvedValue(okJson({ data: [{ id: "deepseek-v4-pro" }, { id: "deepseek-v4-flash" }] }));

        const title = await new DeepSeekProvider("sk-deep").generateTitle("Explain quantum tunnelling");
        // Not the `deepseek-chat` alias baked into the class — a v4-era account
        // doesn't list it, so titling with it would be a request that just fails.
        expect(chatMock).toHaveBeenCalledWith("deepseek-v4-flash");
        expect(title).toBe("A generated title");
    });

    it("doesn't list again once the defaults are resolved", async () => {
        fetchMock.mockResolvedValue(okJson({ data: [{ id: "deepseek-v4-flash" }] }));
        const provider = new DeepSeekProvider("sk-deep");
        await provider.listModels();

        const probes = fetchMock.mock.calls.length;
        await provider.generateTitle("Explain quantum tunnelling");
        expect(fetchMock.mock.calls.length).toBe(probes);
    });

    it("still titles when the endpoint can't be listed", async () => {
        // Offline, or a listing that errors: the alias is the last resort, and the
        // user loses nothing.
        fetchMock.mockRejectedValue(new Error("offline"));

        const title = await new DeepSeekProvider("sk-deep").generateTitle("Explain quantum tunnelling");
        expect(chatMock).toHaveBeenCalledWith("deepseek-chat");
        expect(title).toBe("A generated title");
    });
});

describe("DeepSeekProvider recommendations", () => {
    it("pre-selects the current line but not the superseded coder models", () => {
        const provider = new DeepSeekProvider("sk-deep");
        const recommended = provider.recommendedModelIds([
            { id: "deepseek-chat", name: "DeepSeek Chat" },
            { id: "deepseek-reasoner", name: "DeepSeek Reasoner" },
            { id: "deepseek-coder", name: "DeepSeek Coder" },
            { id: "deepseek-chat-preview", name: "DeepSeek Chat Preview" },
            { id: "deepseek-old", name: "DeepSeek Old", isLegacy: true }
        ]);
        expect([...recommended]).toEqual(["deepseek-chat", "deepseek-reasoner"]);
    });
});

describe("deepSeekModelName", () => {
    it("titles the DeepSeek line and leaves foreign ids alone", () => {
        expect(deepSeekModelName("deepseek-chat")).toBe("DeepSeek Chat");
        expect(deepSeekModelName("deepseek-reasoner")).toBe("DeepSeek Reasoner");
        // Version segments stay upper-case rather than becoming "V4" → "V4" vs "v4".
        expect(deepSeekModelName("deepseek-v4-pro")).toBe("DeepSeek V4 Pro");
        // A gateway serving something else keeps its id verbatim.
        expect(deepSeekModelName("llama3.2")).toBe("llama3.2");
    });
});
