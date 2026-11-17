import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";

const createMistralMock = vi.fn();
const modelMock = vi.fn((modelId: string) => ({ modelId }));

vi.mock("@ai-sdk/mistral", () => ({
    createMistral: (opts: unknown) => {
        createMistralMock(opts);
        return (modelId: string) => modelMock(modelId);
    }
}));

const { streamTextMock } = vi.hoisted(() => ({
    streamTextMock: vi.fn((..._args: any[]) => ({}) as any)
}));

vi.mock("ai", async (importOriginal) => {
    const actual = await importOriginal<typeof import("ai")>();
    return { ...actual, streamText: streamTextMock };
});

import { isMistralChatModel, mistralModelName, MistralProvider } from "./mistral.js";
import { installGlobalFetchAsApiTransport } from "../../../test/request_provider.js";
import { llmFetch } from "./fetch.js";

// A provider reaches its endpoint through the request provider rather than the global `fetch`, so
// the specs that stub that global need one installed which leads back to it.
beforeEach(installGlobalFetchAsApiTransport);

describe("MistralProvider construction", () => {
    beforeEach(() => {
        createMistralMock.mockClear();
    });

    it("forwards apiKey only when no baseURL provided", () => {
        new MistralProvider("sk-test");
        expect(createMistralMock).toHaveBeenCalledTimes(1);
        expect(createMistralMock).toHaveBeenCalledWith({ apiKey: "sk-test", fetch: llmFetch });
    });

    it("forwards apiKey and baseURL when both provided", () => {
        new MistralProvider("sk-test", "http://localhost:8080/v1");
        expect(createMistralMock).toHaveBeenCalledWith({
            apiKey: "sk-test",
            baseURL: "http://localhost:8080/v1",
            fetch: llmFetch
        });
    });

    it("omits baseURL when empty string is provided", () => {
        new MistralProvider("sk-test", "");
        expect(createMistralMock).toHaveBeenCalledWith({ apiKey: "sk-test", fetch: llmFetch });
    });

    it("throws when apiKey is missing", () => {
        expect(() => new MistralProvider("")).toThrow(/API key is required/);
    });
});

describe("MistralProvider chat", () => {
    beforeEach(() => {
        streamTextMock.mockClear();
        modelMock.mockClear();
    });

    it("createModel uses the configured model id, falling back to the default", () => {
        const provider = new MistralProvider("sk-test");
        provider.chat([{ role: "user", content: "hi" }], {});
        expect(modelMock).toHaveBeenLastCalledWith("mistral-large-4");

        provider.chat([{ role: "user", content: "hi" }], { model: "mistral-small-4" });
        expect(modelMock).toHaveBeenLastCalledWith("mistral-small-4");
    });

    it("sends reasoning_effort for Mistral Large 4 with high effort", () => {
        const provider = new MistralProvider("sk-test");
        provider.chat(
            [{ role: "user", content: "hi" }],
            { model: "mistral-large-4", reasoningEffort: "high" }
        );

        const opts = streamTextMock.mock.calls[0][0] as any;
        expect(opts.providerOptions?.mistral?.reasoningEffort).toBe("high");
    });

    it("sends reasoning_effort for Mistral Small with high effort", () => {
        const provider = new MistralProvider("sk-test");
        provider.chat(
            [{ role: "user", content: "hi" }],
            { model: "mistral-small-4", reasoningEffort: "high" }
        );

        const opts = streamTextMock.mock.calls[0][0] as any;
        expect(opts.providerOptions?.mistral?.reasoningEffort).toBe("high");
    });

    it("sends reasoning_effort none for Mistral Small (which supports none)", () => {
        const provider = new MistralProvider("sk-test");
        provider.chat(
            [{ role: "user", content: "hi" }],
            { model: "mistral-small-4", reasoningEffort: "none" }
        );

        const opts = streamTextMock.mock.calls[0][0] as any;
        expect(opts.providerOptions?.mistral?.reasoningEffort).toBe("none");
    });

    it("converts none to low for Mistral Large 4 (which doesn't support none)", () => {
        const provider = new MistralProvider("sk-test");
        provider.chat(
            [{ role: "user", content: "hi" }],
            { model: "mistral-large-4", reasoningEffort: "none" }
        );

        const opts = streamTextMock.mock.calls[0][0] as any;
        // Mistral Large 4 doesn't support "none", so it falls back to "low"
        expect(opts.providerOptions?.mistral?.reasoningEffort).toBe("low");
    });

    it("converts none to low for GLM 5.3 (which doesn't support none)", () => {
        const provider = new MistralProvider("sk-test");
        provider.chat(
            [{ role: "user", content: "hi" }],
            { model: "zai-glm-5-3", reasoningEffort: "none" }
        );

        const opts = streamTextMock.mock.calls[0][0] as any;
        // GLM 5.3 doesn't support "none", so it falls back to "low"
        expect(opts.providerOptions?.mistral?.reasoningEffort).toBe("low");
    });

    it("sends max effort for GLM 5.3 Flash", () => {
        const provider = new MistralProvider("sk-test");
        provider.chat(
            [{ role: "user", content: "hi" }],
            { model: "zai-glm-5-3-flash", reasoningEffort: "max" }
        );

        const opts = streamTextMock.mock.calls[0][0] as any;
        expect(opts.providerOptions?.mistral?.reasoningEffort).toBe("max");
    });

    it("does not send reasoning_effort for non-reasoning models", () => {
        const provider = new MistralProvider("sk-test");
        provider.chat(
            [{ role: "user", content: "hi" }],
            { model: "mistral-tiny", reasoningEffort: "high" }
        );

        const opts = streamTextMock.mock.calls[0][0] as any;
        expect(opts.providerOptions?.mistral).toBeUndefined();
    });

    it("uses high as default for Mistral Large 4 when no effort specified", () => {
        const provider = new MistralProvider("sk-test");
        provider.chat(
            [{ role: "user", content: "hi" }],
            { model: "mistral-large-4" }
        );

        const opts = streamTextMock.mock.calls[0][0] as any;
        expect(opts.providerOptions?.mistral?.reasoningEffort).toBe("high");
    });
});

describe("MistralProvider model listing", () => {
    const fetchMock = vi.fn();

    beforeEach(() => {
        fetchMock.mockReset();
        vi.stubGlobal("fetch", fetchMock);
    });
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    const okJson = (body: unknown) => ({ ok: true, json: async () => body });

    it("filters non-chat models and names known models", async () => {
        fetchMock.mockResolvedValue(okJson({ data: [
            { id: "mistral-large-4", context_length: 128000 },
            { id: "mistral-small-4", context_length: 128000 },
            { id: "mistral-embedding", context_length: 8192 }, // non-chat
            { id: "mistral-tiny" }
        ]}));
        const provider = new MistralProvider("sk-test");

        const models = await provider.listModels();
        expect(fetchMock).toHaveBeenCalledWith(
            "https://api.mistral.ai/v1/models",
            expect.objectContaining({ headers: { Authorization: "Bearer sk-test" } })
        );
        expect(models.map((m) => m.id)).toEqual(["mistral-large-4", "mistral-small-4", "mistral-tiny"]);
        expect(models[0]).toMatchObject({ name: "Mistral Large 4", reasoningEfforts: ["low", "medium", "high"], defaultReasoningEffort: "high" });
        expect(models[1]).toMatchObject({ name: "Mistral Small 4", reasoningEfforts: ["none", "high"], defaultReasoningEffort: "high" });
        expect(models[2]).toMatchObject({ name: "Mistral Tiny" });
        expect(models[2].reasoningEfforts).toBeUndefined();
    });

    it("lists models from a custom endpoint", async () => {
        fetchMock.mockResolvedValue(okJson({ data: [{ id: "mistral-large-4" }] }));
        const provider = new MistralProvider("sk-test", "http://localhost:8080/v1");

        await provider.listModels();
        expect(fetchMock).toHaveBeenCalledWith("http://localhost:8080/v1/models", expect.anything());
    });

    it("propagates HTTP errors", async () => {
        fetchMock.mockResolvedValue({ ok: false, status: 500 });
        const provider = new MistralProvider("sk-test");
        await expect(provider.listModels()).rejects.toThrow("HTTP 500");
    });

    it("reports a friendly authentication error on a 401", async () => {
        fetchMock.mockResolvedValue({ ok: false, status: 401 });
        const provider = new MistralProvider("sk-test");
        await expect(provider.listModels()).rejects.toThrow(/Authentication failed/);
    });

    it("propagates a malformed response body", async () => {
        fetchMock.mockResolvedValue(okJson({ nope: true }));
        const provider = new MistralProvider("sk-test");
        await expect(provider.listModels()).rejects.toThrow(/Unexpected .* response shape/);
    });
});

describe("MistralProvider getAvailableModels", () => {
    it("returns the curated list of Mistral models", () => {
        const provider = new MistralProvider("sk-test");
        const models = provider.getAvailableModels();

        expect(models.length).toBeGreaterThan(0);
        expect(models.map(m => m.id)).toContain("mistral-large-4");
        expect(models.map(m => m.id)).toContain("mistral-small-4");
        expect(models.map(m => m.id)).toContain("mistral-medium-3-5");
    });

    it("marks mistral-large-4 as default", () => {
        const provider = new MistralProvider("sk-test");
        const models = provider.getAvailableModels();
        const large4 = models.find(m => m.id === "mistral-large-4");
        expect(large4?.isDefault).toBe(true);
    });

    it("marks newer models as recommended", () => {
        const provider = new MistralProvider("sk-test");
        const models = provider.getAvailableModels();
        
        for (const id of ["mistral-large-4", "mistral-medium-3-5", "mistral-small-4"]) {
            const model = models.find(m => m.id === id);
            expect(model?.recommended).toBe(true);
        }
    });

    it("marks older models as legacy", () => {
        const provider = new MistralProvider("sk-test");
        const models = provider.getAvailableModels();
        
        for (const id of ["mistral-large-2", "mistral-large", "mistral-medium", "mistral-small", "mistral-tiny"]) {
            const model = models.find(m => m.id === id);
            expect(model?.isLegacy).toBe(true);
        }
    });
});

describe("MistralProvider recommendedModelIds", () => {
    const recommend = (ids: string[]) =>
        new MistralProvider("sk-test").recommendedModelIds(ids.map(id => ({ id, name: id })));

    it("recommends Mistral Large 4, Medium 3.5, and Small 4", () => {
        const ids = recommend([
            "mistral-large-4",
            "mistral-large-4-0",
            "mistral-medium-3-5",
            "mistral-medium-3-5-26-04",
            "mistral-small-4",
            "mistral-small-2603",
            "mistral-large-2",
            "mistral-tiny"
        ]);
        expect(ids).toEqual(new Set([
            "mistral-large-4",
            "mistral-large-4-0",
            "mistral-medium-3-5",
            "mistral-medium-3-5-26-04",
            "mistral-small-4",
            "mistral-small-2603"
        ]));
    });

    it("excludes legacy models from recommendations", () => {
        const ids = recommend([
            "mistral-large-2",
            "mistral-large",
            "mistral-medium",
            "mistral-small",
            "mistral-tiny"
        ]);
        expect(ids.size).toBe(0);
    });

    it("excludes non-Mistral models", () => {
        const ids = recommend(["gpt-4", "claude-3-sonnet"]);
        expect(ids.size).toBe(0);
    });
});

describe("MistralProvider acceptsAttachment", () => {
    const provider = new MistralProvider("sk-test");

    it("accepts images for vision models", () => {
        expect(provider.acceptsAttachment("image", "mistral-large-4-vision")).toBe(true);
    });

    it("rejects images for non-vision models", () => {
        expect(provider.acceptsAttachment("image", "mistral-large-4")).toBe(false);
    });

    it("rejects files for all models", () => {
        expect(provider.acceptsAttachment("file", "mistral-large-4")).toBe(false);
    });
});

describe("isMistralChatModel", () => {
    it("keeps Mistral chat models", () => {
        for (const id of [
            "mistral-large-4",
            "mistral-large-4-0",
            "mistral-medium-3-5",
            "mistral-small-4",
            "mistral-small-2603",
            "zai-glm-5-3",
            "zai-glm-5-3-flash"
        ]) {
            expect(isMistralChatModel(id), id).toBe(true);
        }
    });

    it("drops Mistral embedding models", () => {
        for (const id of ["mistral-embedding", "mistral-embedding-3-large"]) {
            expect(isMistralChatModel(id), id).toBe(false);
        }
    });

    it("drops non-Mistral models", () => {
        for (const id of ["gpt-4", "claude-3-sonnet", "llama3.2"]) {
            expect(isMistralChatModel(id), id).toBe(false);
        }
    });
});

describe("mistralModelName", () => {
    it("prettifies standard Mistral model ids", () => {
        expect(mistralModelName("mistral-large-4")).toBe("Mistral Large 4");
        expect(mistralModelName("mistral-large-4-0")).toBe("Mistral Large 4.0");
        expect(mistralModelName("mistral-medium-3-5")).toBe("Mistral Medium 3.5");
        expect(mistralModelName("mistral-small-4")).toBe("Mistral Small 4");
        expect(mistralModelName("mistral-small-2603")).toBe("Mistral Small 2603");
    });

    it("prettifies dated Mistral Medium variant", () => {
        expect(mistralModelName("mistral-medium-3-5-26-04")).toBe("Mistral Medium 3.5 (26-04)");
    });

    it("prettifies GLM model ids", () => {
        expect(mistralModelName("zai-glm-5-3")).toBe("GLM 5 3");
        expect(mistralModelName("zai-glm-5-3-flash")).toBe("GLM 5 3 FLASH");
    });

    it("leaves legacy model ids untouched", () => {
        expect(mistralModelName("mistral-large")).toBe("Mistral Large");
        expect(mistralModelName("mistral-medium")).toBe("Mistral Medium");
        expect(mistralModelName("mistral-small")).toBe("Mistral Small");
        expect(mistralModelName("mistral-tiny")).toBe("Mistral Tiny");
    });

    it("leaves unknown ids untouched", () => {
        expect(mistralModelName("custom-model")).toBe("custom-model");
    });
});
