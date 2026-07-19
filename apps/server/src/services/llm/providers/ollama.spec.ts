import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@triliumnext/core", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@triliumnext/core")>();
    return {
        ...actual,
        getLog: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() })
    };
});

import { OllamaProvider } from "./ollama.js";

/** Minimal /api/tags payload with the fields the provider reads. */
function tagsResponse(models: Array<{ name: string; parameter_size?: string; quantization_level?: string }>) {
    return {
        ok: true,
        json: async () => ({
            models: models.map(m => ({
                name: m.name,
                model: m.name,
                details: {
                    parameter_size: m.parameter_size,
                    quantization_level: m.quantization_level
                }
            }))
        })
    } as Response;
}

describe("OllamaProvider", () => {
    const fetchMock = vi.fn();

    beforeEach(() => {
        fetchMock.mockReset();
        vi.stubGlobal("fetch", fetchMock);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it("loads models with display names built from size and quantization", async () => {
        fetchMock.mockResolvedValue(tagsResponse([
            { name: "llama3.2:latest", parameter_size: "3.2B", quantization_level: "Q4_K_M" },
            { name: "plain-model" }
        ]));

        const provider = new OllamaProvider();
        const models = await provider.loadModels();

        expect(fetchMock).toHaveBeenCalledWith("http://localhost:11434/api/tags", expect.anything());
        expect(models.map(m => m.name)).toEqual([
            "llama3.2:latest (3.2B, Q4_K_M)",
            "plain-model"
        ]);
        // Local models are free and the first one is the default.
        expect(models[0].isDefault).toBe(true);
        expect(models[0].pricing).toEqual({ input: 0, output: 0 });
    });

    it("caches the model list within the TTL and refetches after it expires", async () => {
        vi.useFakeTimers();
        fetchMock.mockResolvedValue(tagsResponse([{ name: "m1" }]));

        const provider = new OllamaProvider();
        await provider.loadModels();
        await provider.loadModels();
        expect(fetchMock).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(61_000);
        await provider.loadModels();
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("does not cache an empty model list, so a first-use setup can recover", async () => {
        fetchMock.mockResolvedValue(tagsResponse([]));
        const provider = new OllamaProvider();
        await expect(provider.loadModels()).resolves.toEqual([]);

        // Models get pulled in Ollama, the next call must refetch.
        fetchMock.mockResolvedValue(tagsResponse([{ name: "fresh" }]));
        const models = await provider.loadModels();
        expect(models).toHaveLength(1);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("keeps the previous model list when the instance is unreachable", async () => {
        vi.useFakeTimers();
        fetchMock.mockResolvedValue(tagsResponse([{ name: "m1" }]));
        const provider = new OllamaProvider();
        await provider.loadModels();

        vi.advanceTimersByTime(61_000);
        fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
        const models = await provider.loadModels();
        expect(models.map(m => m.id)).toEqual(["m1"]);
    });

    it("returns the current list on a malformed /api/tags response", async () => {
        fetchMock.mockResolvedValue({ ok: true, json: async () => ({ error: "boom" }) } as Response);
        const provider = new OllamaProvider();
        await expect(provider.loadModels()).resolves.toEqual([]);
    });

    it("returns the current list when the instance responds with an error status", async () => {
        fetchMock.mockResolvedValue({ ok: false, status: 500 } as Response);
        const provider = new OllamaProvider();
        await expect(provider.loadModels()).resolves.toEqual([]);
    });

    it("falls back to the default base URL for invalid or non-http URLs", async () => {
        fetchMock.mockResolvedValue(tagsResponse([]));

        await new OllamaProvider("ftp://example.com").loadModels();
        expect(fetchMock).toHaveBeenLastCalledWith("http://localhost:11434/api/tags", expect.anything());

        await new OllamaProvider("not a url").loadModels();
        expect(fetchMock).toHaveBeenLastCalledWith("http://localhost:11434/api/tags", expect.anything());
    });

    it("strips trailing slashes from a valid base URL", async () => {
        fetchMock.mockResolvedValue(tagsResponse([]));
        await new OllamaProvider("http://ollama.lan:11434///").loadModels();
        expect(fetchMock).toHaveBeenLastCalledWith("http://ollama.lan:11434/api/tags", expect.anything());
    });

    it("prefers a small model for title generation", async () => {
        fetchMock.mockResolvedValue(tagsResponse([
            { name: "big-model", parameter_size: "70B" },
            { name: "small-model", parameter_size: "3B" }
        ]));

        const provider = new OllamaProvider();
        await provider.loadModels();
        // titleModel is protected — observable via generateTitle's model choice,
        // so assert through the internal field cast instead.
        expect((provider as unknown as { titleModel: string }).titleModel).toBe("small-model");
    });
});
