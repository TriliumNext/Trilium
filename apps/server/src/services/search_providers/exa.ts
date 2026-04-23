import {
    BaseSearchProvider,
    DEFAULT_MAX_RESULTS,
    DEFAULT_TIMEOUT_MS,
    type SearchOptions,
    type SearchResult
} from "./base_search_provider.js";

interface ExaResult {
    title: string;
    url: string;
    publishedDate?: string | null;
    author?: string | null;
    text?: string;
    highlights?: string[];
    summary?: string;
}

interface ExaSearchResponse {
    results?: ExaResult[];
}

/**
 * Exa search provider (https://exa.ai). Uses POST /search with the unified `contents`
 * field to fetch highlights, a summary and a short text extract in a single request.
 */
export class ExaSearchProvider extends BaseSearchProvider {
    name = "Exa";

    constructor(private readonly apiKey: string, private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS) {
        super();
        if (!apiKey) {
            throw new Error("API key is required for Exa search provider");
        }
    }

    async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
        const body: Record<string, unknown> = {
            query,
            type: "auto",
            numResults: options.numResults ?? DEFAULT_MAX_RESULTS,
            contents: {
                highlights: { numSentences: 3, highlightsPerUrl: 3 },
                summary: true,
                text: { maxCharacters: 500 }
            }
        };

        if (options.category) body.category = options.category;
        if (options.includeDomains?.length) body.includeDomains = options.includeDomains;
        if (options.excludeDomains?.length) body.excludeDomains = options.excludeDomains;
        if (options.startPublishedDate) body.startPublishedDate = options.startPublishedDate;
        if (options.endPublishedDate) body.endPublishedDate = options.endPublishedDate;

        const response = await fetch("https://api.exa.ai/search", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": this.apiKey,
                "x-exa-integration": "trilium"
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(this.timeoutMs)
        });

        if (!response.ok) {
            const errorBody = await response.text().catch(() => "");
            throw new Error(`Exa search failed: ${response.status} ${errorBody}`.trim());
        }

        const data = (await response.json()) as ExaSearchResponse;
        return (data.results ?? []).map(toSearchResult);
    }
}

/**
 * Exa returns any combination of highlights/summary/text on a result. Pick the most
 * useful snippet in priority order so the LLM sees meaningful context even when some
 * fields are absent (e.g. highlights missing for a short page).
 */
function toSearchResult(r: ExaResult): SearchResult {
    let snippet = "";
    if (r.highlights && r.highlights.length > 0) {
        snippet = r.highlights.join(" … ");
    } else if (r.summary) {
        snippet = r.summary;
    } else if (r.text) {
        snippet = r.text.length > 500 ? `${r.text.slice(0, 500)}…` : r.text;
    }

    return {
        title: r.title,
        url: r.url,
        snippet,
        publishedDate: r.publishedDate ?? undefined,
        author: r.author ?? undefined
    };
}
