import { describe, expect, it } from "vitest";

import { normalizeThemeCss } from "./index.js";
import themeDefinitions, { getThemeVariant } from "./themes.js";
import { buildVsCodeThemeCss, VS_CODE_DARK, VS_CODE_LIGHT } from "./vs_code_theme.js";

describe("buildVsCodeThemeCss", () => {
    it("colors each token kind from the palette, with the block background", () => {
        const css = buildVsCodeThemeCss(VS_CODE_DARK);

        expect(css).toMatch(/^\.hljs \{ color: #d4d4d4; background: #1e1e1e; \}/);
        expect(css).toContain(".hljs-keyword, .hljs-literal, .hljs-variable.language_, "
            + ".hljs-template-tag, .hljs-selector-tag, .hljs-name { color: #569cd6; }");
        expect(css).toContain(".hljs-title.function_ { color: #dcdcaa; }");
        expect(css).toContain(".hljs-comment, .hljs-quote { color: #6a9955; font-style: italic; }");
        // The app widens the block selector so it applies inside the editor.
        expect(normalizeThemeCss(css)).toMatch(/^\.hljs, \.ck-content pre\.hljs \{/);
    });

    it("scopes every selector, the block layout included", () => {
        const css = buildVsCodeThemeCss(VS_CODE_LIGHT, ":where(html.theme-light)");

        expect(css).toMatch(
            /^:where\(html\.theme-light\) \.hljs \{ color: #383a42; background: #ffffff; \}/);
        expect(css).toContain(
            ":where(html.theme-light) .hljs-string, :where(html.theme-light) .hljs-addition");
        expect(css).toContain(":where(html.theme-light) pre code.hljs { display: block;");
        for (const selector of css.match(/[^{}]+(?=\{)/g) ?? []) {
            for (const part of selector.split(",")) {
                expect(part.trim()).toMatch(/^:where\(html\.theme-light\) /);
            }
        }
    });
});

describe("VS Code themes", () => {
    it("are registered as a light and a dark theme", () => {
        expect(getThemeVariant(themeDefinitions["vs-code-light"])).toBe("light");
        expect(getThemeVariant(themeDefinitions["vs-code-dark"])).toBe("dark");
    });
});
