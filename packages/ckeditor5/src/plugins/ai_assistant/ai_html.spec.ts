import { describe, expect, it } from "vitest";

import { sanitizeAiHtml, stripMarkdownFences } from "./ai_html.js";

describe("sanitizeAiHtml", () => {
    it("keeps ordinary formatting untouched", () => {
        const html = "<p>Hello <strong>world</strong></p><ul><li>one</li></ul>";
        expect(sanitizeAiHtml(html)).toBe(html);
    });

    it("removes active content: script-like elements, event handlers and javascript: URLs", () => {
        expect(sanitizeAiHtml("<p>ok</p><script>alert(1)</script><style>p{}</style><iframe src='x'></iframe>"))
            .toBe("<p>ok</p>");
        expect(sanitizeAiHtml("<p onclick=\"alert(1)\" class=\"keep\">ok</p>"))
            .toBe("<p class=\"keep\">ok</p>");
        expect(sanitizeAiHtml("<a href=\"javascript:alert(1)\">x</a><a href=\"https://example.com\">y</a>"))
            .toBe("<a>x</a><a href=\"https://example.com\">y</a>");
    });

    it("keeps a renderable result for HTML cut off mid-stream", () => {
        expect(sanitizeAiHtml("<p>This is an exam")).toBe("<p>This is an exam</p>");
    });
});

describe("stripMarkdownFences", () => {
    it("returns unfenced content unchanged", () => {
        expect(stripMarkdownFences("<p>plain</p>")).toBe("<p>plain</p>");
    });

    it("strips a complete ```html fence pair", () => {
        expect(stripMarkdownFences("```html\n<p>hi</p>\n```")).toBe("<p>hi</p>\n");
        expect(stripMarkdownFences("```\n<p>hi</p>\n```\n")).toBe("<p>hi</p>\n");
    });

    it("strips an opening fence whose closing half has not streamed in yet", () => {
        expect(stripMarkdownFences("```html\n<p>st")).toBe("<p>st");
    });

    it("does not treat a ``` inside the content as a closing fence", () => {
        expect(stripMarkdownFences("```html\n<p>use ``` for fences</p>\n<p>more</p>"))
            .toBe("<p>use ``` for fences</p>\n<p>more</p>");
    });
});
