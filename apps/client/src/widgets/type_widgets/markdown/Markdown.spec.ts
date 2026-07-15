// @vitest-environment jsdom
// DOMPurify relies on browser-faithful DOM traversal (NodeIterator); happy-dom
// mishandles it and strips valid markup (surfaced by dompurify 3.4.8). Run the
// sanitization-dependent specs under jsdom, which matches real-browser behavior.
import { describe, expect, it } from "vitest";

import { renderWithSourceLines } from "./Markdown.js";

describe("renderWithSourceLines", () => {
    function extractLines(src: string): number[] {
        const { html } = renderWithSourceLines(src);
        return [ ...html.matchAll(/data-source-line="(\d+)"/g) ].map((m) => parseInt(m[1], 10));
    }

    /** Markup with the source-line attributes stripped, so markup assertions stay readable. */
    function html(src: string): string {
        return renderWithSourceLines(src).html.replace(/ data-source-line="\d+"/g, "");
    }

    it("returns empty html for empty input", () => {
        expect(html("")).toBe("");
    });

    it("tags a single block as line 1", () => {
        const result = html("hello");
        expect(extractLines("hello")).toEqual([ 1 ]);
        expect(result).toContain("hello");
    });

    it("assigns correct source lines to consecutive blocks separated by blank lines", () => {
        const src = [
            "# Heading",       // line 1
            "",                // line 2
            "A paragraph.",    // line 3
            "",                // line 4
            "Another one."     // line 5
        ].join("\n");

        expect(extractLines(src)).toEqual([ 1, 3, 5 ]);
    });

    it("counts multi-line blocks so subsequent blocks get the right line", () => {
        const src = [
            "```",             // 1
            "code",            // 2
            "more code",       // 3
            "```",             // 4
            "",                // 5
            "after"            // 6
        ].join("\n");

        expect(extractLines(src)).toEqual([ 1, 6 ]);
    });

    it("renders standard markdown constructs", () => {
        const result = html("## Heading\n\n- item\n");
        expect(result).toContain("<h2>Heading</h2>");
        expect(result).toContain("<ul>");
        expect(result).toContain("<li>item</li>");
    });

    it("tags blocks in place so they stay direct siblings", () => {
        // The .ck-content styles use sibling combinators (e.g. the stacked look of consecutive
        // collapsibles), which only match if blocks are not each wrapped in a container.
        const src = [
            '<details class="trilium-collapsible">',
            "<summary>One</summary>",
            "</details>",
            "",
            '<details class="trilium-collapsible">',
            "<summary>Two</summary>",
            "</details>"
        ].join("\n");

        const container = document.createElement("div");
        container.innerHTML = renderWithSourceLines(src).html;

        const blocks = Array.from(container.children);
        expect(blocks.map((block) => block.tagName)).toEqual([ "DETAILS", "DETAILS" ]);
        expect(blocks.every((block) => block.hasAttribute("data-source-line"))).toBe(true);
    });

    it("keeps H1 as H1 in the preview (no title-row context to avoid)", () => {
        expect(html("# Top level")).toContain("<h1>Top level</h1>");
    });

    it("preserves reference-style links across per-block parsing", () => {
        const src = [
            "[trilium][t]",    // 1
            "",                // 2
            "[t]: https://example.com"
        ].join("\n");

        expect(html(src)).toContain('href="https://example.com"');
    });

    it("normalizes fenced code languages to CKEditor MIME identifiers for syntax highlighting", () => {
        // A markdown code fence is not a Trilium script, so `javascript` maps to plain JavaScript
        // (`text/javascript`) rather than the frontend/backend script variants.
        expect(html("```javascript\nconst x = 1;\n```")).toMatch(/class="language-text-javascript"/);
    });

    it("produces CKEditor admonition markup for GFM callouts", () => {
        expect(html("> [!NOTE]\n> heads up")).toContain('<aside class="admonition note">');
    });

    it("preserves the `mermaid` fence language so the mermaid rewrite can match it", () => {
        expect(html("```mermaid\ngraph TD;\nA-->B;\n```")).toContain('class="language-mermaid"');
    });

    it("produces math-tex spans for inline math", () => {
        expect(html("Energy: $e=mc^2$.")).toContain('<span class="math-tex">');
    });

    it("renders the default /todo:<state> templates to their task states", () => {
        // The `/todo:*` commands insert `- [<symbol>] `; verify each default state's marker
        // round-trips to the right rendered task item. The ` ` (unchecked) and `x` (checked)
        // anchors map to native checkboxes; custom states carry data-trilium-task-state.
        const unchecked = html("- [ ] groceries");
        expect(unchecked).toContain('type="checkbox"');
        expect(unchecked).not.toContain("checked");
        expect(unchecked).not.toContain("data-trilium-task-state");

        expect(html("- [x] groceries")).toContain("checked");
        expect(html("- [/] groceries")).toContain('data-trilium-task-state="doing"');
        expect(html("- [?] groceries")).toContain('data-trilium-task-state="maybe"');
        expect(html("- [-] groceries")).toContain('data-trilium-task-state="cancelled"');
    });

    it("renders the /collapsible template as a details block", () => {
        // Mirrors the markdown the `/collapsible` slash command inserts.
        const src = [
            '<details class="trilium-collapsible">',
            "<summary>Summary</summary>",
            "",
            "Details",
            "",
            "</details>"
        ].join("\n");

        const result = html(src);
        expect(result).toContain("<details");
        expect(result).toContain("<summary>Summary</summary>");
        expect(result).toContain("Details");
    });

    it("renders the /page-break template as a page-break div without swallowing following content", () => {
        // Mirrors the markdown the `/page-break` slash command inserts (note the trailing blank line).
        // The renderer must keep the `page-break` class through DOMPurify so print.css can drive the
        // page break, and the blank line must terminate the raw-HTML block so following text still
        // renders as markdown instead of being absorbed into the <div>.
        const result = html('<div class="page-break"></div>\n\nAfter the break');
        expect(result).toContain('class="page-break"');
        expect(result).toContain("<p>After the break</p>");
    });

    it("renders the /table skeleton as a table without swallowing following content", () => {
        // Mirrors the GFM table the `/table` slash command inserts (note the trailing blank line),
        // which must terminate the table block so following text renders as its own paragraph.
        const src = [
            "| Column 1 | Column 2 |",
            "| -------- | -------- |",
            "|          |          |",
            "",
            "After the table"
        ].join("\n");

        const result = html(src);
        expect(result).toContain("<table>");
        expect(result).toContain("<th>Column 1</th>");
        expect(result).toContain("<p>After the table</p>");
    });

    it("renders [[wikilinks]] with hash-router hrefs so the preview navigates correctly", () => {
        const result = html("See [[abc123]] for details.");
        expect(result).toContain('class="reference-link"');
        expect(result).toContain('href="#root/abc123"');
    });

    it("extracts headings with correct levels and lines", () => {
        const src = [
            "# Title",         // line 1
            "",                // line 2
            "text",            // line 3
            "",                // line 4
            "## Section",      // line 5
            "",                // line 6
            "### Sub"          // line 7
        ].join("\n");

        const { headings } = renderWithSourceLines(src);
        expect(headings).toEqual([
            { id: "md-heading-0", level: 1, text: "Title", line: 1 },
            { id: "md-heading-1", level: 2, text: "Section", line: 5 },
            { id: "md-heading-2", level: 3, text: "Sub", line: 7 }
        ]);
    });

    it("renders inline markdown formatting in heading text", () => {
        const src = [
            "## **Bold heading**",
            "",
            "## *Italic heading*",
            "",
            "## `Code in heading`",
            "",
            "## Heading with **bold** and `code`",
            "",
            "## Heading with ~~strikethrough~~",
            "",
            "## Heading with [a link](https://example.com)"
        ].join("\n");

        const { headings } = renderWithSourceLines(src);
        expect(headings[0].text).toBe("<strong>Bold heading</strong>");
        expect(headings[1].text).toBe("<em>Italic heading</em>");
        expect(headings[2].text).toBe("<code>Code in heading</code>");
        expect(headings[3].text).toBe("Heading with <strong>bold</strong> and <code>code</code>");
        expect(headings[4].text).toBe("Heading with <del>strikethrough</del>");
        expect(headings[5].text).toBe('Heading with <a href="https://example.com">a link</a>');
    });

    it("sanitizes XSS vectors in heading text", () => {
        const src = [
            "## <script>alert('XSS via script tag')</script>",
            "",
            '## <button onclick="alert(\'clicked!\')">Click me</button>',
            "",
            '## <img src="x" onerror="alert(\'img onerror XSS\')">',
            "",
            '## <a href="javascript:alert(\'javascript: URL\')">Innocent link</a>',
            "",
            '## <svg onload="alert(\'SVG onload XSS\')"><rect width="100" height="100"/></svg>',
            "",
            "## <details><summary>Collapsible</summary><script>alert('inside details')</script></details>"
        ].join("\n");

        const { headings } = renderWithSourceLines(src);

        for (const h of headings) {
            expect(h.text).not.toMatch(/<script/i);
            expect(h.text).not.toMatch(/onerror/i);
            expect(h.text).not.toMatch(/onclick/i);
            expect(h.text).not.toMatch(/onload/i);
            expect(h.text).not.toMatch(/javascript:/i);
        }
    });
});
