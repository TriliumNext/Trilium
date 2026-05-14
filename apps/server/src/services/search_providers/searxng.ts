import {
    BaseSearchProvider,
    DEFAULT_MAX_RESULTS,
    DEFAULT_TIMEOUT_MS,
    type SearchOptions,
    type SearchResult
} from "./base_search_provider.js";

interface SearxngResult {
    title: string;
    url: string;
    content?: string;
    publishedDate?: string;
}

interface SearxngResponse {
    results?: SearxngResult[];
}

/**
 * SearXNG search provider. Self-hosted metasearch; no API key, just a base URL.
 * See https://docs.searxng.org/.
 */
export class SearxngSearchProvider extends BaseSearchProvider {
    name = "SearXNG";
    private readonly baseUrl: string;

    constructor(baseUrl: string, private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS) {
        super();
        if (!baseUrl) {
            throw new Error("Base URL is required for SearXNG search provider");
        }
        this.baseUrl = baseUrl.replace(/\/+$/, "");
    }

    async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
        const params = new URLSearchParams({
            q: query,
            format: "json",
            categories: "general",
            language: "auto"
        });

        const response = await fetch(`${this.baseUrl}/search?${params.toString()}`, {
            headers: { Accept: "application/json" },
            signal: AbortSignal.timeout(this.timeoutMs)
        });

        if (!response.ok) {
            const errorBody = await response.text().catch(() => "");
            throw new Error(`SearXNG search failed: ${response.status} ${errorBody}`.trim());
        }

        const data = (await response.json()) as SearxngResponse;
        const limit = options.numResults ?? DEFAULT_MAX_RESULTS;

        return (data.results ?? []).slice(0, limit).map(r => ({
            title: r.title,
            url: r.url,
            snippet: r.content ?? "",
            publishedDate: r.publishedDate
        }));
    }
}
