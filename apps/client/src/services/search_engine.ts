import options from "./options.js";

/** The `customSearchEngineUrl` that turns off searching the web from the context menu. */
export const NO_SEARCH_ENGINE = "none";

/** The search engines offered in the options, the first of which is used while none is set. */
export const SEARCH_ENGINE_PRESETS = [
    {
        url: "https://duckduckgo.com/?q={keyword}",
        nameKey: "search_engine.duckduckgo", icon: "bx bx-search-alt"
    },
    {
        url: "https://www.bing.com/search?q={keyword}",
        nameKey: "search_engine.bing", icon: "bx bxl-bing"
    },
    {
        url: "https://www.baidu.com/s?wd={keyword}",
        nameKey: "search_engine.baidu", icon: "bx bxl-baidu"
    },
    {
        url: "https://www.google.com/search?q={keyword}",
        nameKey: "search_engine.google", icon: "bx bxl-google"
    }
] as const;

/**
 * The engine the context menu searches the web with: the one in the options, DuckDuckGo while none
 * is set, or `null` when searching the web is turned off.
 */
export function getSearchEngine(): { name: string; url: string; icon: string } | null {
    const name = options.get("customSearchEngineName");
    const url = options.get("customSearchEngineUrl");
    if (url === NO_SEARCH_ENGINE) return null;
    if (!name || !url) {
        const [ fallback ] = SEARCH_ENGINE_PRESETS;
        return { name: "DuckDuckGo", url: fallback.url, icon: fallback.icon };
    }

    const preset = SEARCH_ENGINE_PRESETS.find((preset) => preset.url === url);
    return { name, url, icon: preset?.icon ?? "bx bx-search-alt" };
}
