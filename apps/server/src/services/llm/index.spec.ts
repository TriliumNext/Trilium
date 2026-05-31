import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getOptionOrNullMock, errorMock } = vi.hoisted(() => ({
    getOptionOrNullMock: vi.fn(),
    errorMock: vi.fn()
}));

vi.mock("@triliumnext/core", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@triliumnext/core")>();
    return {
        ...actual,
        options: { ...actual.options, getOptionOrNull: getOptionOrNullMock },
        getLog: () => ({ error: errorMock, info: vi.fn(), warn: vi.fn() })
    };
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
    };
}

vi.mock("./providers/anthropic.js", () => ({ AnthropicProvider: makeProviderMock("anthropic") }));
vi.mock("./providers/openai.js", () => ({ OpenAiProvider: makeProviderMock("openai") }));
vi.mock("./providers/google.js", () => ({ GoogleProvider: makeProviderMock("google") }));

import {
    clearProviderCache,
    getAllModels,
    getProvider,
    getProviderByType,
    getProviderSetupByType,
    hasConfiguredProviders
} from "./index.js";

function setProviders(configs: unknown) {
    getOptionOrNullMock.mockReturnValue(typeof configs === "string" ? configs : JSON.stringify(configs));
}

const TWO = [
    { id: "a1", name: "My Claude", provider: "anthropic", apiKey: "k1", baseURL: "https://proxy" },
    { id: "o1", name: "My GPT", provider: "openai", apiKey: "k2" }
];

describe("llm/index provider registry", () => {
    beforeEach(() => {
        clearProviderCache();
        vi.clearAllMocks();
    });
    afterEach(() => {
        clearProviderCache();
    });

    describe("getProvider", () => {
        it("returns the first provider when no id is given and caches it", () => {
            setProviders(TWO);
            const p1 = getProvider();
            const p2 = getProvider();
            expect(p1).toBe(p2); // cached
            expect((p1.constructor as any).lastArgs).toEqual(["k1", "https://proxy"]);
        });

        it("returns the provider matching a given id", () => {
            setProviders(TWO);
            const p = getProvider("o1");
            expect((p.constructor as any).lastArgs).toEqual(["k2", undefined]);
        });

        it("instantiates each known provider type via its factory", () => {
            setProviders([
                { id: "a", name: "A", provider: "anthropic", apiKey: "ka" },
                { id: "o", name: "O", provider: "openai", apiKey: "ko" },
                { id: "g", name: "G", provider: "google", apiKey: "kg" }
            ]);
            expect((getProvider("a").constructor as any).lastArgs).toEqual(["ka", undefined]);
            expect((getProvider("o").constructor as any).lastArgs).toEqual(["ko", undefined]);
            expect((getProvider("g").constructor as any).lastArgs).toEqual(["kg", undefined]);
        });

        it("throws when no providers are configured (null and empty array)", () => {
            getOptionOrNullMock.mockReturnValue(null);
            expect(() => getProvider()).toThrow(/No LLM providers configured/);
            setProviders([]);
            expect(() => getProvider()).toThrow(/No LLM providers configured/);
        });

        it("throws when the requested id is not found", () => {
            setProviders(TWO);
            expect(() => getProvider("nope")).toThrow(/not found: nope/);
        });

        it("throws for an unknown provider type", () => {
            setProviders([{ id: "x", name: "X", provider: "mystery", apiKey: "k" }]);
            expect(() => getProvider("x")).toThrow(/Unknown LLM provider type: mystery/);
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
        it("returns the first provider of the given type", () => {
            setProviders(TWO);
            const p = getProviderByType("openai");
            expect((p.constructor as any).lastArgs).toEqual(["k2", undefined]);
        });

        it("throws when no provider of that type is configured", () => {
            setProviders(TWO);
            expect(() => getProviderByType("google")).toThrow(/No google provider configured/);
        });
    });

    describe("getAllModels", () => {
        it("aggregates models across provider types, tagged with the provider", () => {
            setProviders(TWO);
            const models = getAllModels();
            expect(models).toEqual([
                { id: "anthropic-model", name: "anthropic Model", provider: "anthropic" },
                { id: "openai-model", name: "openai Model", provider: "openai" }
            ]);
        });

        it("includes each provider type only once even with duplicate configs", () => {
            setProviders([
                { id: "a1", name: "A1", provider: "anthropic", apiKey: "k1" },
                { id: "a2", name: "A2", provider: "anthropic", apiKey: "k2" }
            ]);
            const models = getAllModels();
            expect(models).toHaveLength(1);
            expect(models[0].provider).toBe("anthropic");
        });

        it("skips and logs a provider whose model lookup throws", () => {
            setProviders([{ id: "x", name: "X", provider: "mystery", apiKey: "k" }]);
            // Unknown type → getProvider throws inside getAllModels and is caught.
            expect(getAllModels()).toEqual([]);
            expect(errorMock).toHaveBeenCalled();
        });

        it("injects a configured custom model as default when it is not in the provider list", () => {
            setProviders([
                { id: "a1", name: "A1", provider: "anthropic", apiKey: "k1", model: "custom-model" }
            ]);
            const models = getAllModels();
            expect(models).toHaveLength(2);
            expect(models[0]).toEqual({
                id: "custom-model",
                name: "custom-model",
                provider: "anthropic",
                pricing: { input: 0, output: 0 },
                isDefault: true
            });
        });

        it("marks an existing model as default when it matches the configured model", () => {
            setProviders([
                { id: "a1", name: "A1", provider: "anthropic", apiKey: "k1", model: "anthropic-model" }
            ]);
            const models = getAllModels();
            expect(models).toHaveLength(1);
            expect(models[0]).toMatchObject({
                id: "anthropic-model",
                provider: "anthropic",
                isDefault: true
            });
        });
    });

    describe("getProviderSetupByType", () => {
        it("returns the setup for the first provider of the given type", () => {
            setProviders(TWO);
            const setup = getProviderSetupByType("openai");
            expect(setup).toMatchObject({ id: "o1", provider: "openai" });
        });

        it("returns undefined when no provider of that type exists", () => {
            setProviders(TWO);
            expect(getProviderSetupByType("google")).toBeUndefined();
        });
    });
});
