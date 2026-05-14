/**
 * Registry for pluggable web-search providers used by the LLM agent.
 *
 * Mirrors the shape of {@code services/llm/index.ts}: user-configured provider
 * instances are persisted as JSON in the {@code searchProviders} option; this module
 * instantiates them lazily and caches them by id. The LLM {@code base_provider.ts}
 * consults {@link getFirstSearchProvider} to decide whether to expose a pluggable
 * search tool or fall back to each LLM provider's native web-search implementation.
 */

import log from "../log.js";
import optionService from "../options.js";
import type { SearchProvider, SearchProviderSetup } from "./base_search_provider.js";
import { ExaSearchProvider } from "./exa.js";
import { SearxngSearchProvider } from "./searxng.js";
import { TavilySearchProvider } from "./tavily.js";

/** Factory functions for creating search-provider instances. */
const providerFactories: Record<string, (setup: SearchProviderSetup) => SearchProvider> = {
    exa: (s) => new ExaSearchProvider(s.apiKey ?? ""),
    tavily: (s) => new TavilySearchProvider(s.apiKey ?? ""),
    searxng: (s) => new SearxngSearchProvider(s.baseUrl ?? "")
};

/** Cache of instantiated providers by their config id. */
let cachedProviders: Record<string, SearchProvider> = {};

export function getConfiguredSearchProviders(): SearchProviderSetup[] {
    try {
        const providersJson = optionService.getOptionOrNull("searchProviders");
        if (!providersJson) {
            return [];
        }
        return JSON.parse(providersJson) as SearchProviderSetup[];
    } catch (e) {
        log.error(`Failed to parse searchProviders option: ${e}`);
        return [];
    }
}

export function hasConfiguredSearchProviders(): boolean {
    return getConfiguredSearchProviders().length > 0;
}

/**
 * Return an instantiated provider by id (or the first configured one if no id is given).
 * Returns null when no provider is configured or the config points to an unknown type.
 */
export function getSearchProvider(providerId?: string): SearchProvider | null {
    const configs = getConfiguredSearchProviders();
    if (configs.length === 0) {
        return null;
    }

    const config = providerId ? configs.find(c => c.id === providerId) : configs[0];
    if (!config) {
        return null;
    }

    if (cachedProviders[config.id]) {
        return cachedProviders[config.id];
    }

    const factory = providerFactories[config.provider];
    if (!factory) {
        log.error(`Unknown search provider type: ${config.provider}. Available: ${Object.keys(providerFactories).join(", ")}`);
        return null;
    }

    try {
        const provider = factory(config);
        cachedProviders[config.id] = provider;
        return provider;
    } catch (e) {
        log.error(`Failed to instantiate ${config.provider} search provider: ${e}`);
        return null;
    }
}

/** Convenience: first configured provider (the one the LLM agent will use by default). */
export function getFirstSearchProvider(): SearchProvider | null {
    return getSearchProvider();
}

/** Clear the provider cache. Call this when search-provider configurations change. */
export function clearSearchProviderCache(): void {
    cachedProviders = {};
}

export type {
    SearchOptions,
    SearchProvider,
    SearchProviderSetup,
    SearchResult
} from "./base_search_provider.js";
