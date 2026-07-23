import type { ToolSet } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getOptionOrNullMock } = vi.hoisted(() => ({
    getOptionOrNullMock: vi.fn()
}));

vi.mock("@triliumnext/core", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@triliumnext/core")>();
    return {
        ...actual,
        options: { ...actual.options, getOptionOrNull: getOptionOrNullMock },
        getLog: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() })
    };
});

import { getConfiguredProviderSetups, getLlmProviderSetups, getSearchEngineSetups } from "./provider_config.js";
import { addConfiguredSearchEngineTool } from "./search_engines.js";

function setOptions(values: Record<string, string | null>) {
    getOptionOrNullMock.mockImplementation((name: string) => values[name] ?? null);
}

beforeEach(() => {
    getOptionOrNullMock.mockReset();
});

describe("provider_config", () => {
    it("treats entries without a type as LLM providers (backward compatibility)", () => {
        setOptions({
            llmProviders: JSON.stringify([
                { id: "a1", name: "Anthropic", provider: "anthropic", apiKey: "k" },
                { id: "s1", name: "Tavily", provider: "tavily", apiKey: "t", type: "search" }
            ])
        });

        expect(getConfiguredProviderSetups()).toHaveLength(2);
        expect(getLlmProviderSetups().map(s => s.id)).toEqual(["a1"]);
        expect(getSearchEngineSetups().map(s => s.id)).toEqual(["s1"]);
    });

    it("returns empty lists when the option is missing or invalid JSON", () => {
        setOptions({ llmProviders: null });
        expect(getConfiguredProviderSetups()).toEqual([]);

        setOptions({ llmProviders: "{not json" });
        expect(getConfiguredProviderSetups()).toEqual([]);
    });
});

describe("addConfiguredSearchEngineTool", () => {
    function engines(...setups: object[]) {
        return JSON.stringify(setups);
    }

    it("returns false when the provider default is selected", () => {
        setOptions({ llmWebSearchEngine: "provider" });
        const tools: ToolSet = {};
        expect(addConfiguredSearchEngineTool(tools)).toBe(false);
        expect(Object.keys(tools)).toEqual([]);
    });

    it("returns false when the selected engine no longer exists", () => {
        setOptions({ llmWebSearchEngine: "gone", llmProviders: engines() });
        expect(addConfiguredSearchEngineTool({})).toBe(false);
    });

    it("adds the Tavily tool for a selected Tavily setup with an API key", () => {
        setOptions({
            llmWebSearchEngine: "tv1",
            llmProviders: engines({ id: "tv1", name: "Tavily", provider: "tavily", apiKey: "tvly-x", type: "search" })
        });
        const tools: ToolSet = {};
        expect(addConfiguredSearchEngineTool(tools)).toBe(true);
        expect(tools.web_search).toBeDefined();
    });

    it("returns false for a Tavily setup without an API key", () => {
        setOptions({
            llmWebSearchEngine: "tv1",
            llmProviders: engines({ id: "tv1", name: "Tavily", provider: "tavily", apiKey: "", type: "search" })
        });
        expect(addConfiguredSearchEngineTool({})).toBe(false);
    });

    it("adds the SearXNG tool for a setup with a base URL and rejects one without", () => {
        setOptions({
            llmWebSearchEngine: "sx1",
            llmProviders: engines({ id: "sx1", name: "SearXNG", provider: "searxng", apiKey: "", baseURL: "http://localhost:8888", type: "search" })
        });
        const tools: ToolSet = {};
        expect(addConfiguredSearchEngineTool(tools)).toBe(true);
        expect(tools.web_search).toBeDefined();

        setOptions({
            llmWebSearchEngine: "sx2",
            llmProviders: engines({ id: "sx2", name: "SearXNG", provider: "searxng", apiKey: "", type: "search" })
        });
        expect(addConfiguredSearchEngineTool({})).toBe(false);
    });

    it("returns false for an unknown engine provider id", () => {
        setOptions({
            llmWebSearchEngine: "x1",
            llmProviders: engines({ id: "x1", name: "X", provider: "mystery", apiKey: "k", type: "search" })
        });
        expect(addConfiguredSearchEngineTool({})).toBe(false);
    });
});
