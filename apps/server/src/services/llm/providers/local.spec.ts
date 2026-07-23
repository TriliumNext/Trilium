import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@triliumnext/core", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@triliumnext/core")>();
    return {
        ...actual,
        getLog: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() })
    };
});

const createOpenAiMock = vi.fn();

vi.mock("@ai-sdk/openai", () => ({
    createOpenAI: (opts: unknown) => {
        createOpenAiMock(opts);
        const fn: any = () => ({});
        fn.chat = vi.fn((modelId: string) => ({ modelId }));
        return fn;
    }
}));

import { LocalProvider } from "./local.js";

/** Minimal /api/tags payload with the fields the provider reads. */
function ollamaTags(models: Array<{ name: string; parameter_size?: string; quantization_level?: string }>) {
    return json({
        models: models.map(m => ({
            name: m.name,
            model: m.name,
            details: { parameter_size: m.parameter_size, quantization_level: m.quantization_level }
        }))
    });
}

/** Minimal /api/v0/models payload (LM Studio's own REST API). */
function lmStudioModels(models: Array<{ id: string; quantization?: string; max_context_length?: number }>) {
    return json({ data: models });
}

/** Minimal OpenAI-compatible /v1/models payload. */
function openAiModels(ids: string[]) {
    return json({ data: ids.map(id => ({ id, object: "model" })) });
}

function json(payload: unknown) {
    return { ok: true, status: 200, json: async () => payload } as Response;
}

function status(code: number) {
    return { ok: false, status: code } as Response;
}

/** Route each probe URL to a response, so the fallback chain can be driven precisely. */
function routes(map: Record<string, Response>) {
    return (url: string) => {
        const response = Object.entries(map).find(([suffix]) => url.endsWith(suffix))?.[1];
        return Promise.resolve(response ?? status(404));
    };
}

describe("LocalProvider", () => {
    const fetchMock = vi.fn();

    beforeEach(() => {
        fetchMock.mockReset();
        createOpenAiMock.mockClear();
        vi.stubGlobal("fetch", fetchMock);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    describe("endpoint resolution", () => {
        it("prefills each card's default endpoint", () => {
            new LocalProvider("ollama");
            expect(createOpenAiMock).toHaveBeenLastCalledWith({ apiKey: "local", baseURL: "http://localhost:11434/v1" });

            new LocalProvider("lmstudio");
            expect(createOpenAiMock).toHaveBeenLastCalledWith({ apiKey: "local", baseURL: "http://localhost:1234/v1" });
        });

        it("accepts a URL written with or without the /v1 suffix", () => {
            new LocalProvider("openai-compatible", "", "http://box:8080");
            expect(createOpenAiMock).toHaveBeenLastCalledWith({ apiKey: "local", baseURL: "http://box:8080/v1" });

            new LocalProvider("openai-compatible", "", "http://box:8080/v1");
            expect(createOpenAiMock).toHaveBeenLastCalledWith({ apiKey: "local", baseURL: "http://box:8080/v1" });
        });

        it("keeps a path prefix intact (proxied endpoints)", () => {
            new LocalProvider("openai-compatible", "", "https://proxy.example.com/llm/v1");
            expect(createOpenAiMock).toHaveBeenLastCalledWith({ apiKey: "local", baseURL: "https://proxy.example.com/llm/v1" });
        });

        it("forwards a supplied API key to the SDK", () => {
            new LocalProvider("openai-compatible", "sk-proxy", "http://box:8080/v1");
            expect(createOpenAiMock).toHaveBeenLastCalledWith({ apiKey: "sk-proxy", baseURL: "http://box:8080/v1" });
        });

        it("falls back to the card's default for an invalid URL, but rejects one it cannot replace", () => {
            new LocalProvider("ollama", "", "not a url");
            expect(createOpenAiMock).toHaveBeenLastCalledWith({ apiKey: "local", baseURL: "http://localhost:11434/v1" });

            new LocalProvider("ollama", "", "ftp://example.com");
            expect(createOpenAiMock).toHaveBeenLastCalledWith({ apiKey: "local", baseURL: "http://localhost:11434/v1" });

            // The generic card has no default to fall back to.
            expect(() => new LocalProvider("openai-compatible", "", "not a url")).toThrow(/Invalid base URL/);
            expect(() => new LocalProvider("openai-compatible")).toThrow(/base URL is required/i);
        });

        it("chats through the Chat Completions API, which every runtime supports", () => {
            const provider = new LocalProvider("ollama") as any;
            expect(provider.createModel("llama3.2")).toEqual({ modelId: "llama3.2" });
        });
    });

    describe("model listing", () => {
        it("uses Ollama's /api/tags, with size and quantization in the name", async () => {
            fetchMock.mockImplementation(routes({
                "/api/tags": ollamaTags([
                    { name: "llama3.2:latest", parameter_size: "3.2B", quantization_level: "Q4_K_M" },
                    { name: "plain-model" }
                ])
            }));

            const models = await new LocalProvider("ollama").listModels();

            expect(models.map(m => m.name)).toEqual(["llama3.2:latest (3.2B, Q4_K_M)", "plain-model"]);
            expect(models[0].isDefault).toBe(true);
            expect(models.every(m => m.pricing?.input === 0 && m.pricing.output === 0)).toBe(true);
        });

        it("uses LM Studio's /api/v0/models, with quantization and context length", async () => {
            fetchMock.mockImplementation(routes({
                "/api/v0/models": lmStudioModels([{ id: "qwen3-8b", quantization: "Q4_K_M", max_context_length: 32768 }])
            }));

            const models = await new LocalProvider("lmstudio").listModels();

            expect(models).toEqual([expect.objectContaining({
                id: "qwen3-8b",
                name: "qwen3-8b (Q4_K_M)",
                contextWindow: 32768,
                pricing: { input: 0, output: 0 }
            })]);
            // The Ollama-only endpoint is never probed for the LM Studio card.
            expect(fetchMock.mock.calls.every(([url]) => !String(url).includes("/api/tags"))).toBe(true);
        });

        it("falls back to /v1/models when no native listing is served", async () => {
            fetchMock.mockImplementation(routes({ "/v1/models": openAiModels(["mistral-7b", "qwen3-8b"]) }));

            const models = await new LocalProvider("openai-compatible", "", "http://box:8080/v1").listModels();

            expect(models.map(m => m.id)).toEqual(["mistral-7b", "qwen3-8b"]);
            // Both native endpoints are tried first for the generic card.
            const probed = fetchMock.mock.calls.map(([url]) => String(url));
            expect(probed).toEqual([
                "http://box:8080/api/tags",
                "http://box:8080/api/v0/models",
                "http://box:8080/v1/models"
            ]);
        });

        it("leaves an unidentified endpoint unpriced, since it may be a metered proxy", async () => {
            fetchMock.mockImplementation(routes({ "/v1/models": openAiModels(["gpt-4.1"]) }));
            const provider = new LocalProvider("openai-compatible", "", "https://proxy.example.com/v1");

            const models = await provider.listModels();

            expect(models[0].pricing).toBeUndefined();
            expect(provider.getModelPricing("gpt-4.1")).toBeUndefined();
        });

        it("prices an endpoint identified as a local runtime as free", async () => {
            fetchMock.mockImplementation(routes({ "/api/tags": ollamaTags([{ name: "m1" }]) }));
            const provider = new LocalProvider("openai-compatible", "", "http://box:11434");

            const models = await provider.listModels();

            expect(models[0].pricing).toEqual({ input: 0, output: 0 });
            expect(provider.getModelPricing("m1")).toEqual({ input: 0, output: 0 });
        });

        it("caches within the TTL and refetches after it expires", async () => {
            vi.useFakeTimers();
            fetchMock.mockImplementation(routes({ "/api/tags": ollamaTags([{ name: "m1" }]) }));

            const provider = new LocalProvider("ollama");
            await provider.listModels();
            await provider.listModels();
            expect(fetchMock).toHaveBeenCalledTimes(1);

            vi.advanceTimersByTime(61 * 60 * 1000);
            await provider.listModels();
            expect(fetchMock).toHaveBeenCalledTimes(2);
        });

        it("does not cache an empty list, so a first-use setup can recover", async () => {
            fetchMock.mockImplementation(routes({ "/api/tags": ollamaTags([]) }));
            const provider = new LocalProvider("ollama");
            await expect(provider.listModels()).resolves.toEqual([]);

            fetchMock.mockImplementation(routes({ "/api/tags": ollamaTags([{ name: "fresh" }]) }));
            expect((await provider.listModels()).map(m => m.id)).toEqual(["fresh"]);
        });
    });

    describe("listing failures", () => {
        it("reports an unreachable endpoint instead of probing on", async () => {
            fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));

            await expect(new LocalProvider("ollama").listModels()).rejects.toThrow(/ECONNREFUSED/);
            // A dead host must not be reported as "no listing endpoint found".
            expect(fetchMock).toHaveBeenCalledTimes(1);
        });

        it("sends the key on the probe when the endpoint is behind a gateway", async () => {
            fetchMock.mockImplementation(routes({ "/v1/models": openAiModels(["m1"]) }));
            await new LocalProvider("openai-compatible", "sk-gateway", "http://box:8080").listModels();
            expect(fetchMock).toHaveBeenCalledWith(
                "http://box:8080/v1/models",
                expect.objectContaining({ headers: { Authorization: "Bearer sk-gateway" } })
            );
        });

        it("reports a rejected credential instead of probing on", async () => {
            fetchMock.mockImplementation(routes({ "/api/tags": status(401) }));
            await expect(new LocalProvider("ollama").listModels()).rejects.toThrow(/Authentication failed \(HTTP 401\)/);
        });

        it("reports a server error instead of probing on", async () => {
            fetchMock.mockImplementation(routes({ "/api/tags": status(500) }));
            await expect(new LocalProvider("ollama").listModels()).rejects.toThrow(/HTTP 500/);
        });

        it("reports an endpoint that serves no listing at all", async () => {
            fetchMock.mockImplementation(routes({}));
            await expect(new LocalProvider("openai-compatible", "", "http://box:9999").listModels())
                .rejects.toThrow(/No model listing endpoint found/);
        });

        it("reports a foreign payload from the endpoint the card names", async () => {
            fetchMock.mockImplementation(routes({ "/api/tags": json({ error: "boom" }) }));
            await expect(new LocalProvider("ollama").listModels()).rejects.toThrow(/Unexpected \/api\/tags response shape/);
        });

        it("reports a foreign payload from LM Studio's own API", async () => {
            // Mirror of the Ollama case: the named card trusts its own endpoint, so
            // a reply that isn't a model list is a misconfiguration, not a miss.
            fetchMock.mockImplementation(routes({ "/api/v0/models": json({ error: "boom" }) }));
            await expect(new LocalProvider("lmstudio").listModels())
                .rejects.toThrow(/Unexpected \/api\/v0\/models response shape/);

            // Same verdict when the list is there but an entry has no id.
            fetchMock.mockImplementation(routes({ "/api/v0/models": json({ data: [{ id: "ok" }, { quantization: "Q4" }] }) }));
            await expect(new LocalProvider("lmstudio").listModels())
                .rejects.toThrow(/Unexpected \/api\/v0\/models response shape/);
        });

        it("reports an Ollama tag list with an unnamed entry", async () => {
            fetchMock.mockImplementation(routes({ "/api/tags": json({ models: [{ name: "ok" }, { size: 123 }] }) }));
            await expect(new LocalProvider("ollama").listModels())
                .rejects.toThrow(/Unexpected \/api\/tags response shape/);
        });

        it("reports an OpenAI-compatible listing whose data isn't a list", async () => {
            fetchMock.mockImplementation(routes({ "/v1/models": json({ data: { object: "list" } }) }));
            await expect(new LocalProvider("openai-compatible", "", "http://box:8080").listModels())
                .rejects.toThrow(/Unexpected response shape from http:\/\/box:8080\/v1\/models/);
        });

        it("falls back to the OpenAI-compatible listing when Ollama's own is absent", async () => {
            // The Ollama card pointed at a plain OpenAI-compatible server: /api/tags
            // 404s, and the LM Studio probe is skipped entirely for this card.
            fetchMock.mockImplementation(routes({ "/v1/models": openAiModels(["llama3"]) }));
            const models = await new LocalProvider("ollama").listModels();
            expect(models.map(m => m.id)).toEqual(["llama3"]);
            expect(fetchMock.mock.calls.every(([url]) => !String(url).includes("/api/v0/models"))).toBe(true);
        });

        it("treats a foreign native payload as 'not that runtime' for the generic card", async () => {
            // Something answers /api/tags with unrelated JSON; the generic card
            // keeps probing rather than failing on a guess it made itself.
            fetchMock.mockImplementation(routes({
                "/api/tags": json({ error: "boom" }),
                "/v1/models": openAiModels(["m1"])
            }));
            const models = await new LocalProvider("openai-compatible", "", "http://box:8080").listModels();
            expect(models.map(m => m.id)).toEqual(["m1"]);
        });
    });

    describe("model defaults", () => {
        it("chats with the first model and writes titles with a small one", async () => {
            fetchMock.mockImplementation(routes({
                "/api/tags": ollamaTags([
                    { name: "big-model", parameter_size: "70B" },
                    { name: "small-model", parameter_size: "3B" }
                ])
            }));

            const provider = new LocalProvider("ollama");
            await provider.listModels();

            // Both are protected — observable only through the models the base
            // class picks, so assert through the internal fields.
            const internals = provider as unknown as { defaultModel: string; titleModel: string };
            expect(internals.defaultModel).toBe("big-model");
            expect(internals.titleModel).toBe("small-model");
        });

        it("falls back to a name-shaped small model, then to the default model", async () => {
            fetchMock.mockImplementation(routes({ "/v1/models": openAiModels(["big-model", "phi-4"]) }));
            const byName = new LocalProvider("openai-compatible", "", "http://box:8080");
            await byName.listModels();
            expect((byName as unknown as { titleModel: string }).titleModel).toBe("phi-4");

            fetchMock.mockImplementation(routes({ "/v1/models": openAiModels(["only-big"]) }));
            const onlyBig = new LocalProvider("openai-compatible", "", "http://box:8080");
            await onlyBig.listModels();
            expect((onlyBig as unknown as { titleModel: string }).titleModel).toBe("only-big");
        });

        it("reads parameter sizes below a billion, and ignores ones it can't parse", async () => {
            // Ollama reports sub-billion models in M and K; both are well under the
            // 4B ceiling, so either should win the title job over a 70B model.
            fetchMock.mockImplementation(routes({
                "/api/tags": ollamaTags([
                    { name: "big-model", parameter_size: "70B" },
                    { name: "milli-model", parameter_size: "500M" }
                ])
            }));
            const milli = new LocalProvider("ollama");
            await milli.listModels();
            expect((milli as unknown as { titleModel: string }).titleModel).toBe("milli-model");

            fetchMock.mockImplementation(routes({
                "/api/tags": ollamaTags([
                    { name: "big-model", parameter_size: "70B" },
                    { name: "kilo-model", parameter_size: "800K" }
                ])
            }));
            const kilo = new LocalProvider("ollama");
            await kilo.listModels();
            expect((kilo as unknown as { titleModel: string }).titleModel).toBe("kilo-model");

            // An unparseable size disqualifies nothing but decides nothing either —
            // with no name-shaped small model around, the default takes the job.
            fetchMock.mockImplementation(routes({
                "/api/tags": ollamaTags([
                    { name: "big-model", parameter_size: "70B" },
                    { name: "odd-model", parameter_size: "quite large" }
                ])
            }));
            const odd = new LocalProvider("ollama");
            await odd.listModels();
            expect((odd as unknown as { titleModel: string }).titleModel).toBe("big-model");
        });

        it("resolves the title model before generating a title", async () => {
            fetchMock.mockImplementation(routes({ "/api/tags": ollamaTags([{ name: "tiny", parameter_size: "1B" }]) }));
            const provider = new LocalProvider("ollama");
            const generateTitle = vi.spyOn(
                Object.getPrototypeOf(Object.getPrototypeOf(provider)) as { generateTitle: () => Promise<string> },
                "generateTitle"
            ).mockResolvedValue("A title");

            await expect(provider.generateTitle("Hello")).resolves.toBe("A title");
            expect((provider as unknown as { titleModel: string }).titleModel).toBe("tiny");

            // Already resolved: a second title costs no further listing.
            const probes = fetchMock.mock.calls.length;
            await provider.generateTitle("Hello again");
            expect(fetchMock.mock.calls.length).toBe(probes);
            generateTitle.mockRestore();
        });
    });
});
