/**
 * Tests for the snippet-card search results view. Split across its composable pieces:
 * - {@link SearchResultCard}: renders title/icon/breadcrumb/snippet/badges from server details,
 *   the loading skeleton, the "snippet unavailable" fallback, and the bare-noteId link href.
 * - {@link SearchResultsToolbar}: the always-visible result count and the page-size selector.
 * - the pure {@link getBreadcrumbTitle} / {@link searchTermsFor} / {@link toPlainSearchTerms} helpers.
 *
 * The lazy page fetch + stale-response guard live in `useSearchResultDetails.spec.tsx`; this file
 * exercises the rendering that consumes those details.
 */
import type { SearchResultDetails } from "@triliumnext/commons";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// i18next isn't initialized under test (t() would echo the key), so stub it to surface interpolated
// values, mirroring RenderErrorCard.spec, so the result-count assertion can see the count.
vi.mock("../../../services/i18n", () => ({
    t: (key: string, opts?: Record<string, unknown>) => (opts && "count" in opts ? `${key}:${opts.count}` : key)
}));

import Component from "../../../components/component";
import { calculateHash } from "../../../services/link";
import server from "../../../services/server";
import { buildNote, buildNotes } from "../../../test/easy-froca";
import { ParentComponent } from "../../react/react_utils";
import SearchResultCard, { getBreadcrumbTitle, searchTermsFor, toPlainSearchTerms } from "./SearchResultCard";
import SearchResultsList, { SearchResultsToolbar } from "./SearchResultsList";

function makeDetails(overrides: Partial<SearchResultDetails> = {}): SearchResultDetails {
    return {
        noteId: "note1",
        notePath: "note1",
        noteTitle: "Meeting notes",
        notePathTitle: "Work › 2026 › Meeting notes",
        contentSnippet: "the calendar sync failed twice",
        highlightedContentSnippet: "the calendar <b>sync</b> failed twice",
        attributeSnippet: "#status=open\n#priority=high",
        highlightedAttributeSnippet: "#status=<b>open</b><br>#priority=high",
        icon: "bx bx-calendar",
        ...overrides
    };
}

let container: HTMLElement;
let parent: Component;

beforeEach(() => {
    parent = new Component();
    container = document.createElement("div");
    document.body.appendChild(container);
});

afterEach(() => {
    vi.restoreAllMocks();
    render(null, container);
    container.remove();
});

/** Lets the pending loads (`useNoteIds`, `froca.getNotes()`, the details fetch) commit. */
async function settle() {
    for (let pass = 0; pass < 3; pass++) {
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
    }
}

async function mount(element: preact.VNode) {
    await act(async () => {
        render(<ParentComponent.Provider value={parent}>{element}</ParentComponent.Provider>, container);
        await Promise.resolve();
    });
}

describe("SearchResultCard", () => {
    it("renders the title, breadcrumb, snippet HTML, badges, and a bare-noteId link", async () => {
        const note = buildNote({ id: "note1", title: "Meeting notes", type: "text" });
        await mount(
            <SearchResultCard noteId={note.noteId} details={makeDetails()} loading={false} highlightedTokens={["sync"]} />
        );

        const link = container.querySelector("a.search-result-card");
        // The card's href carries the highlighted plain tokens as `searchTerms` so the destination
        // type widget can highlight/jump to them via ViewScope.searchTerms.
        expect(link?.getAttribute("href")).toBe(`#${note.noteId}?searchTerms=sync`);
        expect(container.querySelector(".search-result-card-title")?.textContent).toBe("Meeting notes");
        // Breadcrumb is the note-path title minus the note's own (last) segment.
        expect(container.querySelector(".search-result-card-path")?.textContent).toBe("Work › 2026");

        const snippet = container.querySelector(".search-result-card-snippet");
        expect(snippet?.innerHTML).toContain("<b>sync</b>");
        expect(snippet?.classList.contains("skeleton")).toBe(false);

        // Attribute snippet is split on <br> into one outline badge per line.
        const badges = container.querySelectorAll(".search-result-card-badges .ext-badge");
        expect(badges.length).toBe(2);
        expect(badges[0].classList.contains("outline")).toBe(true);
        expect(badges[0].textContent).toContain("status=open");
        expect(badges[0].querySelector("b")?.textContent).toBe("open");
    });

    it("links with the words the note matched, falling back to the search tokens (#11787)", async () => {
        const note = buildNote({ id: "note1", title: "Slovak", type: "text" });
        await mount(
            <SearchResultCard noteId={note.noteId} details={makeDetails({ matchedTerms: [ "Ktorý" ] })} loading={false} highlightedTokens={[ "ktory" ]} />
        );
        expect(container.querySelector("a.search-result-card")?.getAttribute("href"))
            .toBe(calculateHash({ notePath: note.noteId, viewScope: { searchTerms: [ "Ktorý" ] } }));

        await mount(
            <SearchResultCard noteId={note.noteId} details={makeDetails({ matchedTerms: [] })} loading={false} highlightedTokens={[ "ktory" ]} />
        );
        expect(container.querySelector("a.search-result-card")?.getAttribute("href")).toBe(`#${note.noteId}?searchTerms=ktory`);
    });

    it("shows a snippet skeleton while the page's details are still loading", async () => {
        const note = buildNote({ id: "note1", title: "Meeting notes", type: "text" });
        await mount(
            <SearchResultCard noteId={note.noteId} details={undefined} loading={true} highlightedTokens={null} />
        );

        expect(container.querySelector(".search-result-card-snippet.skeleton")).not.toBeNull();
        // Title still renders immediately (from froca) even before details arrive.
        expect(container.querySelector(".search-result-card-title")?.textContent).toBe("Meeting notes");
    });

    it("shows the snippet-unavailable line when details exist but there is no content snippet", async () => {
        const note = buildNote({ id: "note1", title: "Protected", type: "text" });
        await mount(
            <SearchResultCard
                noteId={note.noteId}
                details={makeDetails({ contentSnippet: "", highlightedContentSnippet: "", attributeSnippet: "", highlightedAttributeSnippet: "" })}
                loading={false}
                highlightedTokens={null}
            />
        );

        const snippet = container.querySelector(".search-result-card-snippet");
        expect(snippet?.classList.contains("unavailable")).toBe(true);
        expect(snippet?.textContent).toBe("search_result.snippet_unavailable");
        expect(container.querySelector(".search-result-card-snippet.skeleton")).toBeNull();
        expect(container.querySelector(".search-result-card-badges")).toBeNull();
    });
});

describe("SearchResultsList", () => {
    it("goes back to the first page when the search runs again", async () => {
        vi.spyOn(server, "post").mockResolvedValue({ results: [] });
        // 25 results make two pages at the default page size of 20.
        const firstResults = buildNotes(Array.from({ length: 25 }, (_, i) => ({ id: `first-${i}`, title: `First ${i}` })));
        const secondResults = buildNotes(Array.from({ length: 25 }, (_, i) => ({ id: `second-${i}`, title: `Second ${i}` })));
        const note = buildNote({ id: "search", title: "Search", type: "search" });
        note.children = firstResults;

        await mount(<SearchResultsList note={note} notePath="search" ntxId="ntx1" media="screen" />);
        await settle();
        const secondPageButton = [ ...container.querySelectorAll(".note-list-pager-page-button") ]
            .find((button) => button.textContent?.trim() === "2");
        expect(secondPageButton).toBeDefined();
        await act(async () => {
            secondPageButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });
        await settle();
        expect(currentPage()).toBe("2");
        expect(cardHrefs()[0]).toBe("#first-20");

        // What `froca.loadSearchNote()` does when the search runs with a new query.
        note.children = secondResults;
        await act(async () => {
            await parent.handleEvent("searchRefreshed", { ntxId: "ntx1" });
        });
        await settle();
        expect(currentPage()).toBe("1");
        expect(cardHrefs()[0]).toBe("#second-0");
    });

    function currentPage() {
        return container.querySelector(".note-list-pager-page-button-current")?.textContent?.trim();
    }

    function cardHrefs() {
        return [ ...container.querySelectorAll("a.search-result-card") ].map((card) => card.getAttribute("href"));
    }
});

describe("SearchResultsToolbar", () => {
    it("always renders the result count, including for a single page", async () => {
        await mount(<SearchResultsToolbar count={1} pageSize={20} setPageSize={() => {}} />);
        expect(container.querySelector(".search-results-list-count")?.textContent).toBe("search_result.result_count:1");
    });

    it("renders the current page size and reports the parsed value on change", async () => {
        const setPageSize = vi.fn();
        await mount(<SearchResultsToolbar count={42} pageSize={20} setPageSize={setPageSize} />);

        const select = container.querySelector<HTMLSelectElement>(".search-results-list-page-size select");
        expect(select?.value).toBe("20");

        if (!select) throw new Error("select not rendered");
        await act(async () => {
            select.value = "50";
            select.dispatchEvent(new Event("change", { bubbles: true }));
        });
        expect(setPageSize).toHaveBeenCalledWith(50);
    });
});

describe("getBreadcrumbTitle", () => {
    it("drops the note's own segment and keeps the ancestor path", () => {
        expect(getBreadcrumbTitle("Work › 2026 › Meeting notes")).toBe("Work › 2026");
        expect(getBreadcrumbTitle("Austria")).toBe(""); // single segment: no ancestors
        expect(getBreadcrumbTitle(undefined)).toBe("");
    });
});

describe("toPlainSearchTerms", () => {
    it("keeps plain tokens (and legacy strings) but drops regex tokens", () => {
        expect(
            toPlainSearchTerms(["sync", { token: "backup", type: "plain" }, { token: "re?ge", type: "regex" }])
        ).toEqual(["sync", "backup"]);
        expect(toPlainSearchTerms(null)).toEqual([]);
        expect(toPlainSearchTerms([])).toEqual([]);
    });
});

describe("searchTermsFor", () => {
    it("prefers the terms the note matched and falls back to the query's plain tokens", () => {
        const tokens = [ "ktory", { token: "k.*", type: "regex" as const } ];
        expect(searchTermsFor({ matchedTerms: [ "ktorý" ] }, tokens)).toEqual([ "ktorý" ]);
        expect(searchTermsFor({ matchedTerms: [] }, tokens)).toEqual([ "ktory" ]);
        expect(searchTermsFor(undefined, tokens)).toEqual([ "ktory" ]);
    });
});
