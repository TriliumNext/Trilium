/**
 * Parsing and filtering of the `llmProviders` option, which stores the
 * user-configured provider instances (both LLM providers and search engines)
 * as a JSON array.
 *
 * Kept separate from index.ts so that modules used by the providers themselves
 * (e.g. search engine tools) can read the configuration without import cycles.
 */

import { getLog, options as optionService } from "@triliumnext/core";

/**
 * Configuration for a single provider instance.
 * This matches the structure stored in the llmProviders option.
 */
export interface LlmProviderSetup {
    id: string;
    name: string;
    provider: string;
    apiKey: string;
    /** Optional override for the SDK's default API endpoint (e.g. Ollama, SearXNG). */
    baseURL?: string;
    /**
     * What this entry provides: "llm" for chat model providers, "search" for
     * web search engines. Entries without a type are LLM providers — older
     * configurations predate this field.
     */
    type?: "llm" | "search";
}

/** Get all configured provider setups (LLM providers and search engines). */
export function getConfiguredProviderSetups(): LlmProviderSetup[] {
    try {
        const providersJson = optionService.getOptionOrNull("llmProviders");
        if (!providersJson) {
            return [];
        }
        return JSON.parse(providersJson) as LlmProviderSetup[];
    } catch (e) {
        getLog().error(`Failed to parse llmProviders option: ${e}`);
        return [];
    }
}

/** Get configured LLM (chat model) provider setups. */
export function getLlmProviderSetups(): LlmProviderSetup[] {
    return getConfiguredProviderSetups().filter(c => (c.type ?? "llm") === "llm");
}

/** Get configured web search engine setups. */
export function getSearchEngineSetups(): LlmProviderSetup[] {
    return getConfiguredProviderSetups().filter(c => c.type === "search");
}
