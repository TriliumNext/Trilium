import debounce from "../common/debounce.js";
import parents from "../common/parents.js";
import parseHTML from "../common/parsehtml.js";
import type { default as Fuse, FuseResultMatch } from "fuse.js";

let fuseInstance: Fuse<SearchResult> | null = null;

interface SearchResults {
    results: SearchResult[];
}

interface SearchResult {
    id: string;
    title: string;
    score?: number;
    path: string;
    /** Plain-text snippet of the matching content. */
    snippet?: string;
    /** HTML snippet with matched tokens wrapped in <b>...</b>. Pre-sanitized by the server. */
    highlightedSnippet?: string;
}

const HTML_ESCAPE_MAP: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
};

/** Escape user-supplied/match text before injecting into innerHTML. */
export function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (c) => HTML_ESCAPE_MAP[c]);
}

function buildResultItem(result: SearchResult) {
    // Prefer the server-rendered highlighted snippet (it only contains <b>/<br> tags that
    // the search service inserts). For static (Fuse) mode we build a plain snippet below
    // and the highlight pass wraps matched substrings in <b>.
    const snippetHtml = result.highlightedSnippet
        ?? (result.snippet ? escapeHtml(result.snippet) : "");
    const snippetBlock = snippetHtml
        ? `<div class="search-result-snippet">${snippetHtml}</div>`
        : "";
    return `<a class="search-result-item" href="./${result.id}">
                <div class="search-result-title">${escapeHtml(result.title)}</div>
                <div class="search-result-note">${escapeHtml(result.path || "Home")}</div>
                ${snippetBlock}
            </a>`;
}

/**
 * Build a content snippet around the first Fuse match for the static-export search index.
 * Returns an HTML string with the matched ranges wrapped in <b>...</b>.
 */
export function buildStaticSnippet(
    content: string | undefined,
    matches: ReadonlyArray<FuseResultMatch> | undefined,
    maxLength = 160
): string | undefined {
    if (!content) return undefined;
    const contentMatch = matches?.find(
        (m) => m.key === "content" && m.indices && m.indices.length > 0
    );
    if (!contentMatch) {
        // No content match (e.g. matched only on title) — return a small head-of-content preview.
        const head = content.slice(0, maxLength).trim();
        if (!head) return undefined;
        return `${escapeHtml(head)}${content.length > maxLength ? "…" : ""}`;
    }

    // Centre the window on the first match and wrap every match-range that falls inside it.
    const [ firstStart ] = contentMatch.indices[0];
    const half = Math.floor(maxLength / 2);
    const to = Math.min(content.length, Math.max(0, firstStart - half) + maxLength);
    // Anchor the window to the right edge when we hit the end of content.
    const from = Math.max(0, to - maxLength);

    // Build the snippet by walking the window and inserting <b>...</b> around any
    // match-range that intersects it. Indices are inclusive on both ends per Fuse.
    let out = "";
    let cursor = from;
    const ranges = contentMatch.indices
        .map(([ s, e ]) => [ Math.max(s, from), Math.min(e + 1, to) ] as [number, number])
        .filter(([ s, e ]) => e > s)
        .sort((a, b) => a[0] - b[0]);
    for (const [ s, e ] of ranges) {
        if (s > cursor) out += escapeHtml(content.slice(cursor, s));
        out += `<b>${escapeHtml(content.slice(s, e))}</b>`;
        cursor = e;
    }
    if (cursor < to) out += escapeHtml(content.slice(cursor, to));

    return `${from > 0 ? "…" : ""}${out}${to < content.length ? "…" : ""}`;
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
                includeMatches: true,
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
        const processedResults = results.map(({ item, score, matches }) => {
            const itemWithContent = item as SearchResult & { content?: string };
            const highlightedSnippet = buildStaticSnippet(itemWithContent.content, matches);
            return {
                ...item,
                id: rootUrl + "/" + item.id,
                score,
                highlightedSnippet
            };
        });
        return { results: processedResults };
    } else {
        const ancestor = document.body.dataset.ancestorNoteId;
        const resp = await fetch(`api/notes?search=${query}&ancestorNoteId=${ancestor}`);
        return await resp.json() as SearchResults;
    }
}
