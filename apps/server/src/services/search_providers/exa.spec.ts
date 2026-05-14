import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ExaSearchProvider } from "./exa.js";

function mockFetchOnce(body: unknown, init: { ok?: boolean; status?: number; statusText?: string } = {}) {
    const fetchMock = vi.fn(async () => ({
        ok: init.ok ?? true,
        status: init.status ?? 200,
        statusText: init.statusText ?? "OK",
        json: async () => body,
        text: async () => (typeof body === "string" ? body : JSON.stringify(body))
    } as unknown as Response));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
}

describe("ExaSearchProvider", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("throws when constructed without an API key", () => {
        expect(() => new ExaSearchProvider("")).toThrow(/API key is required/);
    });

    it("sends the x-exa-integration header and requests highlights/summary/text", async () => {
        const fetchMock = mockFetchOnce({ results: [] });
        const provider = new ExaSearchProvider("test-key");

        await provider.search("foo bar");

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe("https://api.exa.ai/search");
        const headers = init.headers as Record<string, string>;
        expect(headers["x-exa-integration"]).toBe("trilium");
        expect(headers["x-api-key"]).toBe("test-key");

        const body = JSON.parse(init.body as string);
        expect(body.query).toBe("foo bar");
        expect(body.type).toBe("auto");
        expect(body.contents).toMatchObject({
            highlights: expect.any(Object),
            summary: true,
            text: expect.any(Object)
        });
    });

    it("passes numResults, domain and date filters through unchanged", async () => {
        const fetchMock = mockFetchOnce({ results: [] });
        const provider = new ExaSearchProvider("test-key");

        await provider.search("ai news", {
            numResults: 7,
            includeDomains: ["wired.com"],
            excludeDomains: ["example.com"],
            startPublishedDate: "2025-01-01T00:00:00.000Z",
            endPublishedDate: "2025-06-01T00:00:00.000Z",
            category: "news"
        });

        const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        const body = JSON.parse(init.body as string);
        expect(body.numResults).toBe(7);
        expect(body.includeDomains).toEqual(["wired.com"]);
        expect(body.excludeDomains).toEqual(["example.com"]);
        expect(body.startPublishedDate).toBe("2025-01-01T00:00:00.000Z");
        expect(body.endPublishedDate).toBe("2025-06-01T00:00:00.000Z");
        expect(body.category).toBe("news");
    });

    it("uses highlights when present", async () => {
        mockFetchOnce({
            results: [
                {
                    title: "Example",
                    url: "https://example.com",
                    highlights: ["first important sentence", "second context sentence"],
                    summary: "should be ignored",
                    text: "full body text that should also be ignored"
                }
            ]
        });
        const provider = new ExaSearchProvider("test-key");

        const results = await provider.search("q");
        expect(results).toHaveLength(1);
        expect(results[0].snippet).toBe("first important sentence … second context sentence");
    });

    it("falls back to summary when highlights are missing", async () => {
        mockFetchOnce({
            results: [
                {
                    title: "Example",
                    url: "https://example.com",
                    summary: "summary sentence describing the page",
                    text: "full body text"
                }
            ]
        });
        const provider = new ExaSearchProvider("test-key");

        const [result] = await provider.search("q");
        expect(result.snippet).toBe("summary sentence describing the page");
    });

    it("falls back to text when both highlights and summary are missing and truncates to 500 chars", async () => {
        const longText = "x".repeat(900);
        mockFetchOnce({
            results: [
                {
                    title: "Example",
                    url: "https://example.com",
                    text: longText
                }
            ]
        });
        const provider = new ExaSearchProvider("test-key");

        const [result] = await provider.search("q");
        expect(result.snippet).toHaveLength(501);
        expect(result.snippet.endsWith("…")).toBe(true);
    });

    it("returns an empty snippet when no content fields are present", async () => {
        mockFetchOnce({
            results: [{ title: "No content", url: "https://example.com" }]
        });
        const provider = new ExaSearchProvider("test-key");

        const [result] = await provider.search("q");
        expect(result.snippet).toBe("");
        expect(result.title).toBe("No content");
        expect(result.url).toBe("https://example.com");
    });

    it("propagates publishedDate and author when present", async () => {
        mockFetchOnce({
            results: [
                {
                    title: "Example",
                    url: "https://example.com",
                    summary: "summary",
                    publishedDate: "2025-03-15",
                    author: "Jane Doe"
                }
            ]
        });
        const provider = new ExaSearchProvider("test-key");

        const [result] = await provider.search("q");
        expect(result.publishedDate).toBe("2025-03-15");
        expect(result.author).toBe("Jane Doe");
    });

    it("throws a descriptive error on non-2xx responses", async () => {
        mockFetchOnce("unauthorized", { ok: false, status: 401 });
        const provider = new ExaSearchProvider("test-key");

        await expect(provider.search("q")).rejects.toThrow(/Exa search failed: 401/);
    });

    it("handles a response with no results field", async () => {
        mockFetchOnce({});
        const provider = new ExaSearchProvider("test-key");

        await expect(provider.search("q")).resolves.toEqual([]);
    });
});
