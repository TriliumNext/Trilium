import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TavilySearchProvider } from "./tavily.js";

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

describe("TavilySearchProvider", () => {
    beforeEach(() => vi.restoreAllMocks());
    afterEach(() => vi.unstubAllGlobals());

    it("throws when constructed without an API key", () => {
        expect(() => new TavilySearchProvider("")).toThrow(/API key is required/);
    });

    it("posts the query with api_key and honours domain filters", async () => {
        const fetchMock = mockFetchOnce({ results: [] });
        const provider = new TavilySearchProvider("tvly-test");

        await provider.search("example", {
            numResults: 3,
            includeDomains: ["good.com"],
            excludeDomains: ["bad.com"]
        });

        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe("https://api.tavily.com/search");
        const body = JSON.parse(init.body as string);
        expect(body.api_key).toBe("tvly-test");
        expect(body.query).toBe("example");
        expect(body.max_results).toBe(3);
        expect(body.include_domains).toEqual(["good.com"]);
        expect(body.exclude_domains).toEqual(["bad.com"]);
    });

    it("maps content to snippet and forwards published_date", async () => {
        mockFetchOnce({
            results: [
                {
                    title: "t",
                    url: "https://a.com",
                    content: "the snippet",
                    published_date: "2025-02-01"
                }
            ]
        });
        const provider = new TavilySearchProvider("tvly-test");

        const [r] = await provider.search("q");
        expect(r.title).toBe("t");
        expect(r.url).toBe("https://a.com");
        expect(r.snippet).toBe("the snippet");
        expect(r.publishedDate).toBe("2025-02-01");
    });

    it("throws on non-2xx responses", async () => {
        mockFetchOnce("rate limited", { ok: false, status: 429 });
        const provider = new TavilySearchProvider("tvly-test");

        await expect(provider.search("q")).rejects.toThrow(/Tavily search failed: 429/);
    });

    it("returns [] when the response omits results", async () => {
        mockFetchOnce({});
        const provider = new TavilySearchProvider("tvly-test");

        await expect(provider.search("q")).resolves.toEqual([]);
    });
});
