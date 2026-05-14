import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SearxngSearchProvider } from "./searxng.js";

function mockFetchOnce(body: unknown, init: { ok?: boolean; status?: number } = {}) {
    const fetchMock = vi.fn(async () => ({
        ok: init.ok ?? true,
        status: init.status ?? 200,
        json: async () => body,
        text: async () => (typeof body === "string" ? body : JSON.stringify(body))
    } as unknown as Response));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
}

describe("SearxngSearchProvider", () => {
    beforeEach(() => vi.restoreAllMocks());
    afterEach(() => vi.unstubAllGlobals());

    it("throws when constructed without a base URL", () => {
        expect(() => new SearxngSearchProvider("")).toThrow(/Base URL is required/);
    });

    it("strips trailing slashes from the base URL", async () => {
        const fetchMock = mockFetchOnce({ results: [] });
        const provider = new SearxngSearchProvider("http://localhost:8888/");

        await provider.search("hello");

        const [url] = fetchMock.mock.calls[0] as [string];
        expect(url.startsWith("http://localhost:8888/search?")).toBe(true);
        expect(url).toContain("q=hello");
        expect(url).toContain("format=json");
    });

    it("maps SearXNG content to snippet and caps to numResults", async () => {
        mockFetchOnce({
            results: [
                { title: "one", url: "https://a.com", content: "snippet one" },
                { title: "two", url: "https://b.com", content: "snippet two" },
                { title: "three", url: "https://c.com", content: "snippet three" }
            ]
        });
        const provider = new SearxngSearchProvider("http://localhost:8888");

        const results = await provider.search("q", { numResults: 2 });
        expect(results).toHaveLength(2);
        expect(results[0]).toEqual({
            title: "one",
            url: "https://a.com",
            snippet: "snippet one",
            publishedDate: undefined
        });
    });

    it("defaults missing content to an empty snippet rather than crashing", async () => {
        mockFetchOnce({ results: [{ title: "x", url: "https://x.com" }] });
        const provider = new SearxngSearchProvider("http://localhost:8888");

        const [r] = await provider.search("q");
        expect(r.snippet).toBe("");
    });

    it("throws on non-2xx responses", async () => {
        mockFetchOnce("server error", { ok: false, status: 500 });
        const provider = new SearxngSearchProvider("http://localhost:8888");

        await expect(provider.search("q")).rejects.toThrow(/SearXNG search failed: 500/);
    });
});
