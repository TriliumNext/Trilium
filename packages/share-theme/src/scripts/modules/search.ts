import debounce from "../common/debounce.js";
import parents from "../common/parents.js";
import parseHTML from "../common/parsehtml.js";
import type { default as Fuse } from "fuse.js";

let fuseInstance: Fuse<SearchResult> | null = null;

interface SearchResults {
    results: SearchResult[];
}

interface SearchResult {
    id: string;
    title: string;
    score?: number;
    path: string;
}

function buildResultItem(result: SearchResult) {
    return `<a class="search-result-item" href="./${result.id}">
                <div class="search-result-title">${result.title}</div>
                <div class="search-result-note">${result.path || "Home"}</div>
            </a>`;
}


export default function setupSearch() {
    const searchInput: HTMLInputElement | null = document.querySelector(".search-input");
    if (!searchInput) {
        return;
    }

    searchInput.addEventListener("keyup", debounce(async () => {
        // console.log("CHANGE EVENT");
        const query = searchInput.value;
        if (query.length < 3) return;
        const resp = await fetchResults(query);
        const results = resp.results.slice(0, 5);
        const lines = [`<div class="search-results">`];
        for (const result of results) {
            lines.push(buildResultItem(result));
        }
        lines.push("</div>");

        const container = parseHTML(lines.join("")) as HTMLDivElement;
        // console.log(container, lines);
        const rect = searchInput.getBoundingClientRect();
        container.style.top = `${rect.bottom}px`;
        container.style.left = `${rect.left}px`;
        container.style.minWidth = `${rect.width}px`;

        const existing = document.querySelector(".search-results");
        if (existing) existing.replaceWith(container);
        else document.body.append(container);
    }, 500));

    window.addEventListener("click", e => {
        const existing = document.querySelector(".search-results");
        if (!existing) return;
        // If the click was anywhere search components ignore it
        if (parents(e.target as HTMLElement, ".search-results,.search-item").length) return;
        if (existing) existing.remove();
    });
}

async function fetchResults(query: string): Promise<SearchResults> {
    const linkHref = document.head.querySelector("link[rel=stylesheet]")?.getAttribute("href");
    const rootUrl = linkHref?.split("/").slice(0, -2).join("/") || ".";

    if ((window as any).glob.isStatic) {
        // Load the search index.
        if (!fuseInstance) {
            const searchIndex = await (await fetch(`${rootUrl}/search-index.json`)).json();
            const Fuse = (await import("fuse.js")).default;
            fuseInstance = new Fuse(searchIndex, {
                keys: [
                    "title",
                    "content"
                ],
                includeScore: true,
                threshold: 0.65,
                ignoreDiacritics: true,
                ignoreLocation: true,
                ignoreFieldNorm: true,
                useExtendedSearch: true
            });
        }

        // Do the search.
        const results = fuseInstance.search(query, { limit: 5 });
        console.debug("Search results:", results);
        const processedResults = results.map(({ item, score }) => ({
            ...item,
            id: rootUrl + "/" + item.id,
            score
        }));
        return { results: processedResults };
    } else {
        const ancestor = document.body.dataset.ancestorNoteId;
        const resp = await fetch(`api/notes?search=${query}&ancestorNoteId=${ancestor}`);
        return await resp.json() as SearchResults;
    }
}
