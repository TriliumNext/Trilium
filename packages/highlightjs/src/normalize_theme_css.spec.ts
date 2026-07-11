import { describe, expect, it } from "vitest";
import { normalizeThemeCss } from "./index.js";

describe("normalizeThemeCss", () => {
    describe("standard highlight.js themes", () => {
        const standardThemeCss = [
            "pre code.hljs {",
            "  display: block;",
            "  overflow-x: auto;",
            "  padding: 1em",
            "}",
            "code.hljs {",
            "  padding: 3px 5px",
            "}",
            ".hljs {",
            "  color: #ffffff;",
            "  background: #1c1b1b",
            "}",
            ".hljs-keyword {",
            "  color: #88aece",
            "}",
            ".hljs-string {",
            "  color: #b5bd68",
            "}",
        ].join("\n");

        it("preserves 'pre code.hljs' layout rule", () => {
            const result = normalizeThemeCss(standardThemeCss);
            expect(result).toContain("pre code.hljs {");
        });

        it("preserves 'code.hljs' inline layout rule", () => {
            const result = normalizeThemeCss(standardThemeCss);
            expect(result).toContain("code.hljs {");
        });

        it("preserves .hljs-* token selectors unchanged", () => {
            const result = normalizeThemeCss(standardThemeCss);
            expect(result).toContain(".hljs-keyword {");
            expect(result).toContain(".hljs-string {");
        });

        it("adds CKEditor specificity to .hljs container rule", () => {
            const result = normalizeThemeCss(standardThemeCss);
            expect(result).toContain(".hljs, .ck-content pre.hljs {");
        });
    });

    describe("catppuccin-style themes (code-scoped selectors)", () => {
        const catppuccinCss =
            "code.hljs{color:#cdd6f4;background:#1e1e2e}" +
            "code .hljs-keyword{color:#cba6f7}" +
            "code .hljs-string{color:#a6e3a1}" +
            "code .hljs-comment{color:#9399b2}";

        it("rewrites 'code.hljs' container to '.hljs'", () => {
            const result = normalizeThemeCss(catppuccinCss);
            expect(result).not.toContain("code.hljs");
        });

        it("rewrites 'code .hljs-*' token selectors to '.hljs .hljs-*'", () => {
            const result = normalizeThemeCss(catppuccinCss);
            expect(result).not.toContain("code .hljs-");
            expect(result).toContain(".hljs .hljs-keyword");
            expect(result).toContain(".hljs .hljs-string");
            expect(result).toContain(".hljs .hljs-comment");
        });

        it("adds CKEditor specificity to .hljs container rule", () => {
            const result = normalizeThemeCss(catppuccinCss);
            expect(result).toContain(".hljs, .ck-content pre.hljs {");
        });

        it("preserves color values", () => {
            const result = normalizeThemeCss(catppuccinCss);
            expect(result).toContain("#cdd6f4");
            expect(result).toContain("#1e1e2e");
            expect(result).toContain("#cba6f7");
            expect(result).toContain("#a6e3a1");
        });
    });
});
