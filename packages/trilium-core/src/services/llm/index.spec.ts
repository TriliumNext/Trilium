import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getOptionOrNullMock, errorMock } = vi.hoisted(() => ({
    getOptionOrNullMock: vi.fn(),
    errorMock: vi.fn()
}));

vi.mock("../../services/options.js", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../services/options.js")>();
    return { default: { ...actual.default, getOptionOrNull: getOptionOrNullMock } };
});

vi.mock("../../services/log.js", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../services/log.js")>();
    return { ...actual, getLog: () => ({ error: errorMock, info: vi.fn(), warn: vi.fn() }) };
});

/** Each provider stub records its constructor args and exposes a tagged model list. */
function makeProviderMock(tag: string) {
    return class {
        static lastArgs: unknown[] = [];
        constructor(...args: unknown[]) {
            (this.constructor as any).lastArgs = args;
        }
        getAvailableModels() {
            return [{ id: `${tag}-model`, name: `${tag} Model` }];
        }
        listModels() {
            return Promise.resolve([
                { id: `${tag}-model`, name: `${tag} Model` },
                { id: `${tag}-preview`, name: `${tag} Preview` }
            ]);
        }
        /** Stands in for the provider's own rule — index only forwards to it. */
        recommendedModelIds(models: { id: string }[]) {
            return new Set(models.filter(m => !m.id.endsWith("-preview")).map(m => m.id));
        }
    };
}

vi.mock("./providers/anthropic.js", () => ({ AnthropicProvider: makeProviderMock("anthropic") }));
vi.mock("./providers/openai.js", () => ({ OpenAiProvider: makeProviderMock("openai") }));
vi.mock("./providers/google.js", () => ({ GoogleProvider: makeProviderMock("google") }));
vi.mock("./providers/deepseek.js", () => ({ DeepSeekProvider: makeProviderMock("deepseek") }));
vi.mock("./providers/local.js", () => ({ LocalProvider: makeProviderMock("local") }));

import {
    clearHostProviders,
    clearProviderCache,
    getProvider,
    getProviderByType,
    getSelectedModel,
    hasConfiguredProviders,
    HOST_PROVIDED_TYPES,
    listProviderModels,
    registerHostProvider
} from "./index.js";
// Mocked module → this is the makeProviderMock("google") stand-in class, whose
// prototype we can strip listModels from to exercise the curated-list fallback.
import { GoogleProvider } from "./providers/google.js";

function setProviders(configs: unknown) {
    getOptionOrNullMock.mockReturnValue(typeof configs === "string" ? configs : JSON.stringify(configs));
}

const TWO = [
    { id: "a1", name: "My Claude", provider: "anthropic", apiKey: "k1", baseURL: "https://proxy" },
    { id: "o1", name: "My GPT", provider: "openai", apiKey: "k2" }
];

/**
 * Host-provided types are not part of core — the Claude Agent one spawns the
 * Claude Code CLI — so whichever host can run them registers a factory. Stand one
 * in per type, for the same reason the other provider modules are mocked: to
 * observe what reaches the constructor.
 */
const hostProviderMocks = Object.fromEntries(
    Object.keys(HOST_PROVIDED_TYPES).map((type) => [ type, makeProviderMock(type) ])
);

describe("llm/index provider registry", () => {
    beforeEach(() => {
        clearProviderCache();
        vi.clearAllMocks();
        for (const [ type, Mock ] of Object.entries(hostProviderMocks)) {
            registerHostProvider(type as keyof typeof HOST_PROVIDED_TYPES, () => new Mock() as never);
        }
    });
    afterEach(() => {
        clearProviderCache();
    });

    describe("getProvider", () => {
        it("returns the first provider when no id is given and caches it", async () => {
            setProviders(TWO);
            const p1 = await getProvider();
            const p2 = await getProvider();
            expect(p1).toBe(p2); // cached
            expect((p1.constructor as any).lastArgs).toEqual(["k1", "https://proxy"]);
        });

        it("returns the provider matching a given id", async () => {
            setProviders(TWO);
            const p = await getProvider("o1");
            expect((p.constructor as any).lastArgs).toEqual(["k2", undefined]);
        });

        it("instantiates each known provider type via its factory", async () => {
            setProviders([
                { id: "a", name: "A", provider: "anthropic", apiKey: "ka" },
                { id: "o", name: "O", provider: "openai", apiKey: "ko" },
                { id: "g", name: "G", provider: "google", apiKey: "kg" },
                { id: "d", name: "D", provider: "deepseek", apiKey: "kd" },
                { id: "c", name: "C", provider: "claude-agent", apiKey: "" },
                { id: "l", name: "L", provider: "ollama", apiKey: "", baseURL: "http://ollama.lan:11434" },
                { id: "lm", name: "LM", provider: "lmstudio", apiKey: "", baseURL: "http://box:1234/v1" },
                { id: "oc", name: "OC", provider: "openai-compatible", apiKey: "k", baseURL: "http://box:8080/v1" }
            ]);
            const constructorArgs = async (id: string) => ((await getProvider(id)).constructor as any).lastArgs;
            expect(await constructorArgs("a")).toEqual(["ka", undefined]);
            expect(await constructorArgs("o")).toEqual(["ko", undefined]);
            expect(await constructorArgs("g")).toEqual(["kg", undefined]);
            // Its own class rather than the shared self-hosted one, despite speaking
            // the same protocol — that is what gives its models a price.
            expect(await constructorArgs("d")).toEqual(["kd", undefined]);
            // The subscription provider takes no constructor args — auth is Claude Code's.
            expect(await constructorArgs("c")).toEqual([]);
            // The three self-hosted cards share one class, which receives the card
            // id so it knows which endpoint to probe and prefill.
            expect(await constructorArgs("l")).toEqual(["ollama", "", "http://ollama.lan:11434"]);
            expect(await constructorArgs("lm")).toEqual(["lmstudio", "", "http://box:1234/v1"]);
            expect(await constructorArgs("oc")).toEqual(["openai-compatible", "k", "http://box:8080/v1"]);
        });

        it("throws when no providers are configured (null and empty array)", async () => {
            getOptionOrNullMock.mockReturnValue(null);
            await expect(getProvider()).rejects.toThrow(/No LLM providers configured/);
            setProviders([]);
            await expect(getProvider()).rejects.toThrow(/No LLM providers configured/);
        });

        it("throws when the requested id is not found", async () => {
            setProviders(TWO);
            await expect(getProvider("nope")).rejects.toThrow(/not found: nope/);
        });

        it("throws for an unknown provider type", async () => {
            setProviders([{ id: "x", name: "X", provider: "mystery", apiKey: "k" }]);
            await expect(getProvider("x")).rejects.toThrow(/Unknown LLM provider type: mystery/);
        });

        it("builds every host-provided type through the factory its host registered", async () => {
            // The catalog and the switch have to agree: a type listed in
            // HOST_PROVIDED_TYPES with no branch of its own falls through to the
            // default and reads as a typo, in a build that can in fact serve it.
            const types = Object.keys(HOST_PROVIDED_TYPES);
            setProviders(types.map((provider, index) => ({ id: `h${index}`, name: provider, provider, apiKey: "" })));

            for (const [index, type] of types.entries()) {
                expect(await getProvider(`h${index}`)).toBeInstanceOf(hostProviderMocks[type]);
            }
        });

        it("names the provider when no host in this build can build it", async () => {
            // What standalone hits for Claude Code: the type is real and the branch is
            // there, but nothing registered a factory. Better than "unknown type",
            // which would send the user looking for a typo.
            clearHostProviders();
            setProviders([{ id: "c", name: "C", provider: "claude-agent", apiKey: "" }]);
            await expect(getProvider("c")).rejects.toThrow("The Claude Code provider is not available in this build.");
        });

        it("drops cached instances when the llmProviders option changes", async () => {
            setProviders(TWO);
            const p1 = await getProvider("a1");
            // Same config → still cached.
            setProviders(TWO);
            expect(await getProvider("a1")).toBe(p1);
            // Edited config (e.g. new API key) → cache self-invalidates.
            setProviders([{ ...TWO[0], apiKey: "new-key" }, TWO[1]]);
            const p2 = await getProvider("a1");
            expect(p2).not.toBe(p1);
            expect((p2.constructor as any).lastArgs).toEqual(["new-key", "https://proxy"]);
        });
    });

    describe("getConfiguredProviders error handling (via hasConfiguredProviders)", () => {
        it("treats malformed JSON as no providers and logs the error", () => {
            getOptionOrNullMock.mockReturnValue("{not json");
            expect(hasConfiguredProviders()).toBe(false);
            expect(errorMock).toHaveBeenCalled();
        });

        it("treats a null option as no providers", () => {
            getOptionOrNullMock.mockReturnValue(null);
            expect(hasConfiguredProviders()).toBe(false);
        });

        it("reports true when providers exist", () => {
            setProviders(TWO);
            expect(hasConfiguredProviders()).toBe(true);
        });
    });

    describe("getProviderByType", () => {
        it("returns the first provider of the given type", async () => {
            setProviders(TWO);
            const p = await getProviderByType("openai");
            expect((p.constructor as any).lastArgs).toEqual(["k2", undefined]);
        });

        it("throws when no provider of that type is configured", async () => {
            setProviders(TWO);
            await expect(getProviderByType("google")).rejects.toThrow(/No google provider configured/);
        });
    });

    describe("listProviderModels", () => {
        it("lists models for ad-hoc credentials, tagged with the recommended flag", async () => {
            // No saved config needed — the add/edit flow passes raw credentials.
            // Only the delegation is asserted here; each provider's own rule is
            // covered in its spec (openai/anthropic/google/claude_agent).
            const models = await listProviderModels("google", "k");
            expect(models).toEqual([
                { id: "google-model", name: "google Model", recommended: true },
                { id: "google-preview", name: "google Preview", recommended: false }
            ]);
        });

        it("throws for an unknown provider type", async () => {
            await expect(listProviderModels("mystery", "k")).rejects.toThrow(/Unknown LLM provider type: mystery/);
        });

        it("falls back to getAvailableModels for a provider without dynamic listing", async () => {
            // Some providers offer no live /models endpoint, so listModels is
            // absent and the `?.() ?? getAvailableModels()` fallback takes over.
            const proto = GoogleProvider.prototype as { listModels?: unknown };
            const original = proto.listModels;
            delete proto.listModels;
            try {
                const models = await listProviderModels("google", "k");
                expect(models).toEqual([{ id: "google-model", name: "google Model", recommended: true }]);
            } finally {
                proto.listModels = original;
            }
        });
    });

    describe("getSelectedModel", () => {
        it("finds a stored selected model by config id and model id", () => {
            setProviders([
                { id: "o1", name: "My GPT", provider: "openai", apiKey: "k", selectedModels: [
                    { id: "gpt-9", name: "GPT-9", pricing: { input: 1, output: 2 } }
                ] }
            ]);
            expect(getSelectedModel("o1", "gpt-9")).toMatchObject({ name: "GPT-9", pricing: { input: 1, output: 2 } });
        });

        it("returns undefined for a missing provider, model, or providerId", () => {
            setProviders([{ id: "o1", name: "My GPT", provider: "openai", apiKey: "k", selectedModels: [{ id: "gpt-9", name: "GPT-9" }] }]);
            expect(getSelectedModel("o1", "absent")).toBeUndefined();
            expect(getSelectedModel("nope", "gpt-9")).toBeUndefined();
            expect(getSelectedModel(undefined, "gpt-9")).toBeUndefined();
        });
    });
});
