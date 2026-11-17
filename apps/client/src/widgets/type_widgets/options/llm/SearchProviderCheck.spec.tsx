import type { LlmWebSearchResult } from "@triliumnext/commons";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

const testSearchProviderMock = vi.hoisted(() => vi.fn());
vi.mock("../../../../services/llm_chat", () => ({ testSearchProvider: testSearchProviderMock }));

// A real i18next with its default escaping, so interpolated values render as the app would render
// them. Keys without an entry come back as the key itself.
vi.mock("../../../../services/i18n", async () => {
    const i18next = (await import("i18next")).default.createInstance();
    await i18next.init({
        lng: "en",
        resources: { en: { translation: { llm: { search_check_failed: "The test search failed: {{error}}" } } } }
    });
    return { t: (key: string, options?: Record<string, unknown>) => i18next.t(key, options ?? {}) };
});

import SearchProviderCheck from "./SearchProviderCheck";

const QUERY = { provider: "searxng", apiKey: "", baseURL: "http://localhost:8888" };
const RESULTS: LlmWebSearchResult[] = [
    { title: "Trilium Notes", url: "https://triliumnotes.org/", snippet: "A hierarchical note taking application." },
    { title: "TriliumNext/Trilium", url: "https://github.com/TriliumNext/Trilium", snippet: "" }
];

let container: HTMLDivElement | undefined;

async function renderCheck(onFailedChange = vi.fn()) {
    container = document.createElement("div");
    document.body.appendChild(container);
    const target = container;
    await act(async () => { render(<SearchProviderCheck query={QUERY} onFailedChange={onFailedChange} />, target); });
    await act(async () => {});
    return { el: target, onFailedChange };
}

const retryButton = (el: HTMLElement) => [ ...el.querySelectorAll("button") ].find(b => b.textContent?.includes("llm.retry"));

describe("SearchProviderCheck", () => {
    afterEach(() => {
        if (container) {
            render(null, container);
            container.remove();
            container = undefined;
        }
        testSearchProviderMock.mockReset();
    });

    it("runs a test search with the credentials and lists the results as external links", async () => {
        testSearchProviderMock.mockResolvedValue(RESULTS);
        const { el, onFailedChange } = await renderCheck();

        expect(testSearchProviderMock).toHaveBeenCalledWith(QUERY);
        expect(el.textContent).toContain("llm.search_check_passed");
        const links = [ ...el.querySelectorAll<HTMLAnchorElement>("a.tn-link.external") ];
        expect(links.map(a => [ a.textContent, a.getAttribute("href"), a.target ])).toEqual([
            [ "Trilium Notes", "https://triliumnotes.org/", "_blank" ],
            [ "TriliumNext/Trilium", "https://github.com/TriliumNext/Trilium", "_blank" ]
        ]);
        expect([ ...el.querySelectorAll(".search-provider-check-site") ].map(s => s.textContent))
            .toEqual([ "triliumnotes.org", "github.com" ]);
        expect(el.querySelectorAll(".search-provider-check-snippet")).toHaveLength(1);
        expect(onFailedChange).toHaveBeenLastCalledWith(false);
    });

    it("shows the server's message verbatim on a failure, reports it, and searches again on Retry", async () => {
        testSearchProviderMock
            .mockRejectedValueOnce(new Error("Could not reach the search provider: connect ECONNREFUSED <127.0.0.1:8888>"))
            .mockResolvedValueOnce(RESULTS);
        const { el, onFailedChange } = await renderCheck();

        expect(el.textContent).toContain("The test search failed: Could not reach the search provider: connect ECONNREFUSED <127.0.0.1:8888>");
        expect(el.textContent).toContain("llm.search_check_failed_hint");
        expect(onFailedChange).toHaveBeenLastCalledWith(true);

        const retry = retryButton(el);
        expect(retry).toBeDefined();
        await act(async () => retry?.click());
        await act(async () => {});
        expect(testSearchProviderMock).toHaveBeenCalledTimes(2);
        expect(el.querySelectorAll("a.tn-link.external")).toHaveLength(2);
        expect(onFailedChange).toHaveBeenLastCalledWith(false);
    });

    it("says so when the provider answers with no results, and offers Retry", async () => {
        testSearchProviderMock.mockResolvedValue([]);
        const { el, onFailedChange } = await renderCheck();

        expect(el.textContent).toContain("llm.search_check_no_results");
        expect(retryButton(el)).toBeDefined();
        expect(onFailedChange).toHaveBeenLastCalledWith(false);
    });
});
