/**
 * Shared interface and types for pluggable web search providers used by the LLM agent.
 *
 * Each search provider implementation wraps a third-party search API and returns a
 * unified {@link SearchResult} array so the LLM tool layer can remain provider-agnostic.
 */

/** Normalised search result returned by all providers. */
export interface SearchResult {
    title: string;
    url: string;
    /** Short extract of the page (provider-chosen: highlights, summary or truncated body). */
    snippet: string;
    publishedDate?: string;
    author?: string;
}

/** Optional search parameters understood by all providers. Providers ignore unsupported fields. */
export interface SearchOptions {
    numResults?: number;
    includeDomains?: string[];
    excludeDomains?: string[];
    /** ISO-8601 date, e.g. "2025-01-01T00:00:00.000Z" */
    startPublishedDate?: string;
    /** ISO-8601 date */
    endPublishedDate?: string;
    /** Provider-specific category hint (Exa: company, research paper, news, ...). */
    category?: string;
}

/** Implemented by every concrete search provider. */
export interface SearchProvider {
    /** Human-readable provider name shown to the LLM and in logs (e.g. "Exa", "Tavily"). */
    name: string;
    search(query: string, options?: SearchOptions): Promise<SearchResult[]>;
}

/**
 * User-supplied configuration for one search-provider instance, stored as JSON in the
 * {@code searchProviders} option. Shape mirrors {@code LlmProviderSetup} so the same UI
 * patterns (multiple named instances, optional API key and base URL) can be reused.
 */
export interface SearchProviderSetup {
    id: string;
    name: string;
    /** Provider type id, e.g. "exa", "tavily", "searxng". */
    provider: string;
    /** API key, required by providers like Exa and Tavily. */
    apiKey?: string;
    /** Custom endpoint, required by providers like SearXNG. */
    baseUrl?: string;
}

export const DEFAULT_MAX_RESULTS = 5;
export const DEFAULT_TIMEOUT_MS = 15_000;

export abstract class BaseSearchProvider implements SearchProvider {
    abstract name: string;
    abstract search(query: string, options?: SearchOptions): Promise<SearchResult[]>;
}
