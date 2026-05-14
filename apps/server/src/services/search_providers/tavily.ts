import {
    BaseSearchProvider,
    DEFAULT_MAX_RESULTS,
    DEFAULT_TIMEOUT_MS,
    type SearchOptions,
    type SearchResult
} from "./base_search_provider.js";

interface TavilyResult {
    title: string;
    url: string;
    content: string;
    published_date?: string;
}

interface TavilySearchResponse {
    results?: TavilyResult[];
}

/**
 * Tavily search provider (https://tavily.com). Free tier: 1000 queries/month.
 */
export class TavilySearchProvider extends BaseSearchProvider {
    name = "Tavily";

    constructor(private readonly apiKey: string, private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS) {
        super();
        if (!apiKey) {
            throw new Error("API key is required for Tavily search provider");
        }
    }

    async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
        const body: Record<string, unknown> = {
            api_key: this.apiKey,
            query,
            max_results: options.numResults ?? DEFAULT_MAX_RESULTS
        };
        if (options.includeDomains?.length) body.include_domains = options.includeDomains;
        if (options.excludeDomains?.length) body.exclude_domains = options.excludeDomains;

        const response = await fetch("https://api.tavily.com/search", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(this.timeoutMs)
        });

        if (!response.ok) {
            const errorBody = await response.text().catch(() => "");
            throw new Error(`Tavily search failed: ${response.status} ${errorBody}`.trim());
        }

        const data = (await response.json()) as TavilySearchResponse;
        return (data.results ?? []).map(r => ({
            title: r.title,
            url: r.url,
            snippet: r.content,
            publishedDate: r.published_date
        }));
    }
}
