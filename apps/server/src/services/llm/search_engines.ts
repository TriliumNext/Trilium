/**
 * Web search engine selection for LLM chat.
 *
 * Search engines are configured as provider entries with type "search" in the
 * llmProviders option. The llmWebSearchEngine option selects which configured
 * engine to use ("provider" or empty means the LLM provider's native search).
 */

import type { ToolSet } from "ai";

import { options as optionService } from "@triliumnext/core";
import { getSearchEngineSetups, type LlmProviderSetup } from "./provider_config.js";
import { addSearxngSearchTool, addTavilySearchTool } from "./web_search_tools.js";

const DEFAULT_TIMEOUT_SEC = 15;

function getSearchTimeoutMs(): number {
    const timeoutSec = parseInt(optionService.getOptionOrNull("llmSearchTimeout") ?? "", 10);
    return (timeoutSec > 0 ? timeoutSec : DEFAULT_TIMEOUT_SEC) * 1000;
}

/** Add the search tool for one engine setup. Returns false if the setup is unusable. */
function addSearchToolForSetup(tools: ToolSet, setup: LlmProviderSetup, timeoutMs: number): boolean {
    switch (setup.provider) {
        case "tavily":
            if (!setup.apiKey) return false;
            addTavilySearchTool(tools, setup.apiKey, timeoutMs);
            return true;
        case "searxng":
            if (!setup.baseURL) return false;
            addSearxngSearchTool(tools, setup.baseURL, timeoutMs);
            return true;
        default:
            return false;
    }
}

/**
 * Add the web search tool for the engine selected in the llmWebSearchEngine
 * option. Returns false when no configured engine is selected or usable, so
 * the caller can fall back to the LLM provider's native web search.
 */
export function addConfiguredSearchEngineTool(tools: ToolSet): boolean {
    const selectedId = optionService.getOptionOrNull("llmWebSearchEngine");
    if (!selectedId || selectedId === "provider") {
        return false;
    }

    const setup = getSearchEngineSetups().find(s => s.id === selectedId);
    if (!setup) {
        return false;
    }

    return addSearchToolForSetup(tools, setup, getSearchTimeoutMs());
}
