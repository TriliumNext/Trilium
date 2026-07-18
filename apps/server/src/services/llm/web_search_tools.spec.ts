import type { ToolSet } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@triliumnext/core", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@triliumnext/core")>();
    return {
        ...actual,
        getLog: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() })
    };
});

import { addSearxngSearchTool, addTavilySearchTool } from "./web_search_tools.js";

async function runTool(tools: ToolSet, query: string) {
    return await tools.web_search.execute!({ query }, {} as never);
}

describe("web search tools", () => {
    const fetchMock = vi.fn();

    beforeEach(() => {
        fetchMock.mockReset();
        vi.stubGlobal("fetch", fetchMock);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    describe("Tavily", () => {
        it("authenticates with a Bearer header and maps results", async () => {
            fetchMock.mockResolvedValue({
                ok: true,
                json: async () => ({
                    answer: "42",
                    results: [{ title: "T", url: "https://example.com", content: "snippet" }]
                })
            } as Response);

            const tools: ToolSet = {};
            addTavilySearchTool(tools, "tvly-key");
            const result = await runTool(tools, "meaning of life");

            const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
            expect(url).toBe("https://api.tavily.com/search");
            // Tavily rejects the deprecated api_key body field — the key must go in the header.
            expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer tvly-key");
            expect(JSON.parse(init.body as string)).not.toHaveProperty("api_key");
            expect(JSON.parse(init.body as string).query).toBe("meaning of life");

            expect(result).toEqual({
                answer: "42",
                results: [{ title: "T", url: "https://example.com", snippet: "snippet" }]
            });
        });

        it("reports an error result on a non-ok response", async () => {
            fetchMock.mockResolvedValue({ ok: false, status: 401, text: async () => "unauthorized" } as Response);

            const tools: ToolSet = {};
            addTavilySearchTool(tools, "bad-key");
            await expect(runTool(tools, "q")).resolves.toEqual({ error: "Search failed: 401" });
        });

        it("reports an error result when the request throws", async () => {
            fetchMock.mockRejectedValue(new Error("timeout"));

            const tools: ToolSet = {};
            addTavilySearchTool(tools, "k");
            await expect(runTool(tools, "q")).resolves.toEqual({ error: "Search failed: timeout" });
        });
    });

    describe("SearXNG", () => {
        it("queries the instance with JSON format and maps capped results", async () => {
            fetchMock.mockResolvedValue({
                ok: true,
                json: async () => ({
                    results: Array.from({ length: 8 }, (_, i) => ({
                        title: `R${i}`, url: `https://r${i}.example`, content: `c${i}`
                    }))
                })
            } as Response);

            const tools: ToolSet = {};
            addSearxngSearchTool(tools, "http://localhost:8888///");
            const result = await runTool(tools, "trilium") as { results: unknown[] };

            const [url] = fetchMock.mock.calls[0] as [string];
            // Trailing slashes are normalized away and the query is URL-encoded.
            expect(url).toMatch(/^http:\/\/localhost:8888\/search\?/);
            expect(url).toContain("q=trilium");
            expect(url).toContain("format=json");
            // Results are capped at 5.
            expect(result.results).toHaveLength(5);
        });

        it("reports an error result on a non-ok response", async () => {
            fetchMock.mockResolvedValue({ ok: false, status: 403, text: async () => "forbidden" } as Response);

            const tools: ToolSet = {};
            addSearxngSearchTool(tools, "http://localhost:8888");
            await expect(runTool(tools, "q")).resolves.toEqual({ error: "Search failed: 403" });
        });
    });
});
