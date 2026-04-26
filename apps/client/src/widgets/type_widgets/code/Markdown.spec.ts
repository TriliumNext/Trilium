import { describe, expect, it } from "vitest";

import { renderWithSourceLines } from "./Markdown.js";

describe("renderWithSourceLines", () => {
    function extractLines(src: string): number[] {
        const { html } = renderWithSourceLines(src);
        return [ ...html.matchAll(/data-source-line="(\d+)"/g) ].map((m) => parseInt(m[1], 10));
    }

    function html(src: string): string {
        return renderWithSourceLines(src).html;
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

    it("renders standard markdown constructs inside the wrappers", () => {
        const result = html("## Heading\n\n- item\n");
        expect(result).toContain("<h2>Heading</h2>");
        expect(result).toContain("<ul>");
        expect(result).toContain("<li>item</li>");
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
        expect(html("```javascript\nconst x = 1;\n```")).toMatch(/class="language-application-javascript-env-(backend|frontend)"/);
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
});
