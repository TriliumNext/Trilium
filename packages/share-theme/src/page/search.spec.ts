// @vitest-environment happy-dom
import type { FuseResultMatch } from "fuse.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import setupSearch, { buildStaticSnippet } from "./search.js";

describe("buildStaticSnippet", () => {
    const contentMatch = (...indices: [number, number][]): FuseResultMatch => ({
        key: "content",
        indices
    });

    it("returns undefined for empty/missing content", () => {
        expect(buildStaticSnippet(undefined, undefined)).toBeUndefined();
        expect(buildStaticSnippet("", undefined)).toBeUndefined();
    });

    it("falls back to head-of-content preview when only title matched", () => {
        const titleOnly: FuseResultMatch = { key: "title", indices: [ [ 0, 4 ] ] };
        const result = buildStaticSnippet("hello world goodbye", [ titleOnly ]);
        expect(result).toBe("hello world goodbye");
    });

    it("truncates the head preview with an ellipsis when content exceeds maxLength", () => {
        const long = "a".repeat(200);
        const result = buildStaticSnippet(long, undefined, 20);
        // Trim then ellipsis suffix.
        expect(result).toBe(`${"a".repeat(20)}…`);
    });

    it("returns undefined when the head preview would be all whitespace", () => {
        expect(buildStaticSnippet("   \n\t  ", undefined)).toBeUndefined();
    });

    it("wraps a single content match in <b>...</b>", () => {
        // "magnesium" lives at indices [11, 19] in "Patient on magnesium drip, stable."
        // (Fuse indices are inclusive on both ends.)
        const content = "Patient on magnesium drip, stable.";
        const result = buildStaticSnippet(content, [ contentMatch([ 11, 19 ]) ]);
        expect(result).toBe("Patient on <b>magnesium</b> drip, stable.");
    });

    it("escapes HTML in both matched and surrounding text", () => {
        // The '&' character sits at index 12 in this string; everything else must be escaped.
        const content = "<em>hi</em> & 'world'";
        const result = buildStaticSnippet(content, [ contentMatch([ 12, 12 ]) ]);
        expect(result).toBe("&lt;em&gt;hi&lt;/em&gt; <b>&amp;</b> &#39;world&#39;");
    });

    it("wraps multiple match ranges and leaves the text between them untouched", () => {
        // Match "foo" [0, 2] and "baz" [8, 10].
        const result = buildStaticSnippet(
            "foo bar baz",
            [ contentMatch([ 0, 2 ], [ 8, 10 ]) ]
        );
        expect(result).toBe("<b>foo</b> bar <b>baz</b>");
    });

    it("merges overlapping/adjacent ranges and skips ranges outside the window", () => {
        // [0, 5] and [3, 8] overlap and [9, 10] touches the merged run: every character must
        // be emitted exactly once, inside a single <b>.
        expect(buildStaticSnippet("abcdefghijk end", [ contentMatch([ 0, 5 ], [ 3, 8 ], [ 9, 10 ]) ]))
            .toBe("<b>abcdefghijk</b> end");

        // A range that lies entirely past the 40-char window contributes nothing.
        const content = `FOO ${"y".repeat(200)}BAR`;
        expect(buildStaticSnippet(content, [ contentMatch([ 0, 2 ], [ 204, 206 ]) ], 40))
            .toBe(`<b>FOO</b> ${"y".repeat(36)}…`);
    });

    it("prepends an ellipsis when the window is cut from the left of content", () => {
        // 200 chars, match at position 180. With maxLength=40, window anchors to the right.
        const before = "x".repeat(180);
        const content = `${before}MATCH and tail`;
        const result = buildStaticSnippet(content, [ contentMatch([ 180, 184 ]) ], 40);
        expect(result).toMatch(/^…/);
        expect(result).toContain("<b>MATCH</b>");
        // Window ends at content.length, so no trailing ellipsis.
        expect(result?.endsWith("…")).toBe(false);
    });

    it("appends an ellipsis when the window is cut from the right of content", () => {
        // Match near the start of a long content.
        const content = `FOO ${"y".repeat(200)}`;
        const result = buildStaticSnippet(content, [ contentMatch([ 0, 2 ]) ], 40);
        expect(result).toMatch(/^<b>FOO<\/b>/);
        expect(result?.endsWith("…")).toBe(true);
    });

    it("clips a match range that straddles the window boundary", () => {
        // maxLength=20 so window won't fit the whole match. Match at [0, 30] in a longer string.
        const content = `${"A".repeat(31)} tail tail tail tail tail`;
        const result = buildStaticSnippet(content, [ contentMatch([ 0, 30 ]) ], 20);
        // The bolded run is clipped to the 20-char window and followed by the right-hand ellipsis.
        expect(result).toBe(`<b>${"A".repeat(20)}</b>…`);
    });

    it("ignores content matches with no indices", () => {
        const emptyMatch: FuseResultMatch = { key: "content", indices: [] };
        const result = buildStaticSnippet("abc def ghi", [ emptyMatch ]);
        // No content match found, so falls through to head preview.
        expect(result).toBe("abc def ghi");
    });
});

describe("setupSearch", () => {
    afterEach(() => {
        document.head.innerHTML = "";
        document.body.innerHTML = "";
        delete window.glob;
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it("asks the server once typing pauses and lists the first five results", async () => {
        const fetchMock = vi.fn(async (_url: string) => Response.json({ results: [
            { id: "a", title: "<A>", path: "Home > Docs", highlightedSnippet: "<b>abc</b>" },
            { id: "b", title: "B", path: "", snippet: "<plain>" },
            { id: "c", title: "C", path: "Docs" },
            { id: "d", title: "D", path: "Docs" },
            { id: "e", title: "E", path: "Docs" },
            { id: "f", title: "F", path: "Docs" }
        ] }));
        const input = renderSearch(fetchMock);
        document.body.dataset.ancestorNoteId = "root";

        await type(input, "ab");
        expect(fetchMock).not.toHaveBeenCalled();

        await type(input, "a&b c");
        expect(fetchMock.mock.calls.map(([ url ]) => url))
            .toEqual([ "api/notes?search=a%26b+c&ancestorNoteId=root" ]);
        const items = [ ...document.querySelectorAll<HTMLAnchorElement>(".search-results a") ];
        expect(items.map((item) => item.getAttribute("href")))
            .toEqual([ "./a", "./b", "./c", "./d", "./e" ]);
        expect(items[0].querySelector(".search-result-title")?.textContent).toBe("<A>");
        expect(items[0].querySelector(".search-result-snippet")?.innerHTML).toBe("<b>abc</b>");
        expect(items[1].querySelector(".search-result-note")?.textContent).toBe("Home");
        expect(items[1].querySelector(".search-result-snippet")?.textContent).toBe("<plain>");
        expect(items[2].querySelector(".search-result-snippet")).toBeNull();

        delete document.body.dataset.ancestorNoteId;
        await type(input, "abc");
        expect(fetchMock).toHaveBeenLastCalledWith("api/notes?search=abc&ancestorNoteId=");
        expect(document.querySelectorAll(".search-results")).toHaveLength(1);
    });

    it("closes the results on a click outside them and the search box", async () => {
        const input = renderSearch(vi.fn(async () => Response.json({ results: [] })));
        document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));

        await type(input, "abc");
        const click = () => new MouseEvent("click", { bubbles: true });
        document.querySelector(".search-results")?.dispatchEvent(click());
        input.dispatchEvent(click());
        expect(document.querySelector(".search-results")).not.toBeNull();

        document.body.dispatchEvent(click());
        expect(document.querySelector(".search-results")).toBeNull();
    });

    it("searches the index of a static export, loaded once", async () => {
        window.glob = { isShare: true, isStatic: true, theme: "light" };
        document.head.innerHTML = `<link rel="stylesheet" href="../../assets/style.css">`;
        const fetchMock = vi.fn(async (_url: string) => Response.json([
            { id: "drip", title: "Treatment", path: "Home", content: "Patient on magnesium drip." },
            { id: "other", title: "Unrelated", path: "Home", content: "Nothing here." }
        ]));
        const input = renderSearch(fetchMock);

        await type(input, "'magnesium");
        await type(input, "'treatment");

        const item = await vi.waitFor(() => {
            const result = document.querySelector<HTMLAnchorElement>(".search-results a");
            expect(result).not.toBeNull();
            return result;
        });
        expect(fetchMock.mock.calls.map(([ url ]) => url)).toEqual([ "../../search-index.json" ]);
        expect(document.querySelectorAll(".search-results a")).toHaveLength(1);
        expect(item?.getAttribute("href")).toBe("./../../drip");
        expect(item?.querySelector(".search-result-snippet")?.textContent)
            .toBe("Patient on magnesium drip.");
    });

    it("does nothing on a page without a search box", () => {
        expect(() => setupSearch()).not.toThrow();
    });
});

function renderSearch(fetchMock: (url: string) => Promise<Response>) {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", fetchMock);
    document.body.innerHTML = `<div class="search-item"><input class="search-input"></div>`;
    setupSearch();
    const input = document.querySelector<HTMLInputElement>(".search-input");
    if (!input) {
        throw new Error("The search box is missing.");
    }
    return input;
}

/** Types a query key by key and waits out the pause after which the search runs. */
async function type(input: HTMLInputElement, query: string) {
    for (const length of query.split("").keys()) {
        input.value = query.slice(0, length + 1);
        input.dispatchEvent(new KeyboardEvent("keyup"));
        await vi.advanceTimersByTimeAsync(100);
    }
    await vi.advanceTimersByTimeAsync(500);
}
