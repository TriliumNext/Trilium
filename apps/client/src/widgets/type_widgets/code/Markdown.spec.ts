import { describe, expect, it } from "vitest";

import { renderWithSourceLines } from "./Markdown.js";

describe("renderWithSourceLines", () => {
    function extractLines(html: string): number[] {
        return [ ...html.matchAll(/data-source-line="(\d+)"/g) ].map((m) => parseInt(m[1], 10));
    }

    it("returns empty string for empty input", () => {
        expect(renderWithSourceLines("")).toBe("");
    });

    it("tags a single block as line 1", () => {
        const html = renderWithSourceLines("hello");
        expect(extractLines(html)).toEqual([ 1 ]);
        expect(html).toContain("hello");
    });

    it("assigns correct source lines to consecutive blocks separated by blank lines", () => {
        const src = [
            "# Heading",       // line 1
            "",                // line 2
            "A paragraph.",    // line 3
            "",                // line 4
            "Another one."     // line 5
        ].join("\n");

        expect(extractLines(renderWithSourceLines(src))).toEqual([ 1, 3, 5 ]);
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

        expect(extractLines(renderWithSourceLines(src))).toEqual([ 1, 6 ]);
    });

    it("renders standard markdown constructs inside the wrappers", () => {
        const html = renderWithSourceLines("## Heading\n\n- item\n");
        expect(html).toContain("<h2>Heading</h2>");
        expect(html).toContain("<ul>");
        expect(html).toContain("<li>item</li>");
    });

    it("keeps H1 as H1 in the preview (no title-row context to avoid)", () => {
        const html = renderWithSourceLines("# Top level");
        expect(html).toContain("<h1>Top level</h1>");
    });

    it("preserves reference-style links across per-block parsing", () => {
        const src = [
            "[trilium][t]",    // 1
            "",                // 2
            "[t]: https://example.com"
        ].join("\n");

        const html = renderWithSourceLines(src);
        expect(html).toContain('href="https://example.com"');
    });

    it("normalizes fenced code languages to CKEditor MIME identifiers for syntax highlighting", () => {
        const html = renderWithSourceLines("```javascript\nconst x = 1;\n```");
        expect(html).toMatch(/class="language-application-javascript-env-(backend|frontend)"/);
    });

    it("produces CKEditor admonition markup for GFM callouts", () => {
        const html = renderWithSourceLines("> [!NOTE]\n> heads up");
        expect(html).toContain('<aside class="admonition note">');
    });

    it("preserves the `mermaid` fence language so the mermaid rewrite can match it", () => {
        const html = renderWithSourceLines("```mermaid\ngraph TD;\nA-->B;\n```");
        expect(html).toContain('class="language-mermaid"');
    });

    it("produces math-tex spans for inline math", () => {
        const html = renderWithSourceLines("Energy: $e=mc^2$.");
        expect(html).toContain('<span class="math-tex">');
    });

    it("renders [[wikilinks]] with hash-router hrefs so the preview navigates correctly", () => {
        const html = renderWithSourceLines("See [[abc123]] for details.");
        expect(html).toContain('class="reference-link"');
        expect(html).toContain('href="#root/abc123"');
    });
});
