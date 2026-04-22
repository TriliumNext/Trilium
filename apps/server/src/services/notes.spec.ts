import { describe, expect, it } from "vitest";
import { findBookmarks } from "./notes.js";

describe("findBookmarks", () => {
    it("extracts bookmark IDs from empty anchor tags", () => {
        const content = `<p>Hello</p><a id="chapter-1"></a><p>World</p>`;
        expect(findBookmarks(content)).toEqual(["chapter-1"]);
    });

    it("extracts multiple bookmarks", () => {
        const content = `<a id="intro"></a><p>Text</p><a id="conclusion"></a>`;
        expect(findBookmarks(content)).toEqual(["intro", "conclusion"]);
    });

    it("returns empty array when no bookmarks exist", () => {
        const content = `<p>No bookmarks here</p>`;
        expect(findBookmarks(content)).toEqual([]);
    });

    it("ignores anchor tags with href (regular links, not bookmarks)", () => {
        const content = `<a href="#root/abc123" id="some-id">link</a>`;
        expect(findBookmarks(content)).toEqual([]);
    });

    it("handles bookmarks with various valid ID characters", () => {
        const content = `<a id="my_bookmark-2.0"></a>`;
        expect(findBookmarks(content)).toEqual(["my_bookmark-2.0"]);
    });

    it("does not produce duplicates", () => {
        const content = `<a id="same"></a><a id="same"></a>`;
        expect(findBookmarks(content)).toEqual(["same"]);
    });

    it("matches self-closing bookmark anchors (CKEditor empty elements)", () => {
        const content = `<p>Text</p><a id="my-bookmark"></a><p>More</p>`;
        // CKEditor may also output without closing tag
        const contentNoClose = `<p>Text</p><a id="my-bookmark"><p>More</p>`;
        expect(findBookmarks(content)).toEqual(["my-bookmark"]);
        expect(findBookmarks(contentNoClose)).toEqual(["my-bookmark"]);
    });
});
