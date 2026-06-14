import type { FuseResultMatch } from "fuse.js";
import { describe, expect, it } from "vitest";

import { buildStaticSnippet, escapeHtml } from "./search.js";

describe("escapeHtml", () => {
    it("escapes the five HTML special characters", () => {
        expect(escapeHtml("&")).toBe("&amp;");
        expect(escapeHtml("<")).toBe("&lt;");
        expect(escapeHtml(">")).toBe("&gt;");
        expect(escapeHtml("\"")).toBe("&quot;");
        expect(escapeHtml("'")).toBe("&#39;");
    });

    it("escapes every occurrence in a mixed string", () => {
        expect(escapeHtml(`<script>alert("x & 'y'")</script>`))
            .toBe("&lt;script&gt;alert(&quot;x &amp; &#39;y&#39;&quot;)&lt;/script&gt;");
    });

    it("returns the input unchanged when nothing needs escaping", () => {
        expect(escapeHtml("just plain text 123")).toBe("just plain text 123");
        expect(escapeHtml("")).toBe("");
    });
});

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
        // The bolded portion is clipped to the window (20 A's), then ellipsis on the right.
        expect(result).toMatch(/^<b>A+<\/b>…$/);
        // Should not include all 31 A's — only the windowed slice.
        const bolded = result!.match(/<b>(A+)<\/b>/)![1];
        expect(bolded.length).toBeLessThanOrEqual(20);
    });

    it("ignores content matches with no indices", () => {
        const emptyMatch: FuseResultMatch = { key: "content", indices: [] };
        const result = buildStaticSnippet("abc def ghi", [ emptyMatch ]);
        // No content match found, so falls through to head preview.
        expect(result).toBe("abc def ghi");
    });
});
