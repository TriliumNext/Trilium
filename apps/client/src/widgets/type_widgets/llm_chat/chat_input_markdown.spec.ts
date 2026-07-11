import { describe, expect, it } from "vitest";

import { editorHtmlToMarkdown } from "./chat_input_markdown.js";

describe("editorHtmlToMarkdown", () => {
    it("passes plain paragraphs through, separated by blank lines", () => {
        expect(editorHtmlToMarkdown("<p>hello</p>")).toBe("hello");
        expect(editorHtmlToMarkdown("<p>a</p><p>b</p>")).toBe("a\n\nb");
    });

    it("renders <br> as a markdown hard line break", () => {
        expect(editorHtmlToMarkdown("<p>a<br>b</p>")).toBe("a  \nb");
    });

    it("renders links as markdown, keeping note-reference hrefs", () => {
        expect(editorHtmlToMarkdown('<p><a href="#root/abc123">My note</a></p>')).toBe("[My note](#root/abc123)");
        expect(editorHtmlToMarkdown('<p>see <a href="https://example.com">the site</a></p>'))
            .toBe("see [the site](https://example.com)");
        // A bare auto-linked URL (text === href) stays a plain URL.
        expect(editorHtmlToMarkdown('<p><a href="https://example.com">https://example.com</a></p>'))
            .toBe("https://example.com");
    });

    it("renders block quotes with `> ` prefixes, blanking empty quote lines", () => {
        expect(editorHtmlToMarkdown("<blockquote><p>quoted</p></blockquote>")).toBe("> quoted");
        expect(editorHtmlToMarkdown("<blockquote><p>a</p><p>b</p></blockquote>")).toBe("> a\n>\n> b");
    });

    it("keeps hard breaks between quote lines so the attribution stays on its own line", () => {
        // <br> lines (as the quote-reply feature inserts) keep their `  ` markdown hard break, so
        // multi-line quotes and the trailing "Show quote source" attribution don't collapse.
        const hb = "  "; // markdown hard break (two trailing spaces)
        expect(editorHtmlToMarkdown("<blockquote><p>first<br>second<br>(Quoted from &lt;&lt;mid:abc&gt;&gt;)</p></blockquote>"))
            .toBe(`> first${hb}\n> second${hb}\n> (Quoted from <<mid:abc>>)`);
    });

    it("renders code blocks as fenced blocks, keeping the language", () => {
        expect(editorHtmlToMarkdown('<pre><code class="language-python">print(1)</code></pre>'))
            .toBe("```python\nprint(1)\n```");
        expect(editorHtmlToMarkdown("<pre><code>plain</code></pre>")).toBe("```\nplain\n```");
    });

    it("renders bulleted and numbered lists", () => {
        expect(editorHtmlToMarkdown("<ul><li>a</li><li>b</li></ul>")).toBe("- a\n- b");
        expect(editorHtmlToMarkdown("<ol><li>a</li><li>b</li></ol>")).toBe("1. a\n2. b");
    });

    it("indents nested lists", () => {
        expect(editorHtmlToMarkdown("<ul><li>a<ul><li>b</li></ul></li></ul>")).toBe("- a\n  - b");
    });

    it("returns an empty string for empty content", () => {
        expect(editorHtmlToMarkdown("<p><br></p>")).toBe("");
        expect(editorHtmlToMarkdown("")).toBe("");
    });
});
