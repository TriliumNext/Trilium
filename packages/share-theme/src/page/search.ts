import { escapeHtml } from "@triliumnext/commons/src/lib/utils.js";
import type { default as Fuse, FuseResultMatch } from "fuse.js";

import "./search.css";

let fuseIndex: Promise<Fuse<SearchResult>> | undefined;

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

export default function setupSearch() {
    const searchInput: HTMLInputElement | null = document.querySelector(".search-input");
    if (!searchInput) {
        return;
    }

    searchInput.addEventListener("keyup", debounce(async () => {
        const query = searchInput.value;
        if (query.length < 3) return;
        const resp = await fetchResults(query);
        const container = document.createElement("div");
        container.className = "search-results";
        container.innerHTML = resp.results.slice(0, 5).map(buildResultItem).join("");

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
        // A click inside the results or the search box keeps the results open.
        if (e.target instanceof Element && e.target.closest(".search-results, .search-item")) {
            return;
        }
        existing.remove();
    });
}

function debounce(executor: () => Promise<void>, delay: number) {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    return () => {
        clearTimeout(timeout);
        timeout = setTimeout(executor, delay);
    };
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
    // Ranges are clipped to the window and then merged when they overlap or touch, so that
    // overlapping matches (common for multi-term queries) never emit a character twice.
    const ranges = contentMatch.indices
        .filter(([ s, e ]) => s < to && e >= from)
        .map(([ s, e ]) => [ Math.max(s, from), Math.min(e + 1, to) ] as [number, number])
        .sort((a, b) => a[0] - b[0]);
    const mergedRanges: [number, number][] = [];
    for (const [ s, e ] of ranges) {
        const last = mergedRanges[mergedRanges.length - 1];
        if (last && s <= last[1]) {
            last[1] = Math.max(last[1], e);
        } else {
            mergedRanges.push([ s, e ]);
        }
    }

    let out = "";
    let cursor = from;
    for (const [ s, e ] of mergedRanges) {
        if (s > cursor) out += escapeHtml(content.slice(cursor, s));
        out += `<b>${escapeHtml(content.slice(s, e))}</b>`;
        cursor = e;
    }
    if (cursor < to) out += escapeHtml(content.slice(cursor, to));

    return `${from > 0 ? "…" : ""}${out}${to < content.length ? "…" : ""}`;
}

async function fetchResults(query: string): Promise<SearchResults> {
    const linkHref = document.head.querySelector("link[rel=stylesheet]")?.getAttribute("href");
    const rootUrl = linkHref?.split("/").slice(0, -2).join("/") || ".";

    if (window.glob?.isStatic) {
        fuseIndex ??= loadSearchIndex(rootUrl);
        const results = (await fuseIndex).search(query, { limit: 5 });
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
        const params = new URLSearchParams({ search: query, ancestorNoteId: ancestor ?? "" });
        const resp = await fetch(`api/notes?${params}`);
        return await resp.json() as SearchResults;
    }
}

/** Loads the search index of a static export, which every later search of the page reuses. */
async function loadSearchIndex(rootUrl: string) {
    const searchIndex = await (await fetch(`${rootUrl}/search-index.json`)).json();
    const Fuse = (await import("fuse.js")).default;
    return new Fuse<SearchResult>(searchIndex, {
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
