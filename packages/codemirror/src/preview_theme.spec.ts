import { defaultHighlightStyle, HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { describe, expect, it } from "vitest";

import { getThemeById } from "./color_themes.js";
import { buildCodePreviewCss, readPreviewTheme } from "./preview_theme.js";

describe("readPreviewTheme", () => {
    it("reads the token styles and the editor colors of a theme", async () => {
        const theme = await readTheme("vs-code-light");

        expect(theme.styles[0]).toMatchObject({ color: "#0064ff", fontWeight: "bold" });
        expect(theme.colors).toEqual({
            background: "#ffffff",
            foreground: "#383a42",
            gutterBackground: "#f5f5f5",
            gutterForeground: "#237893",
            gutterBorderWidth: "1px",
            gutterBorderColor: "#d6d6d6",
            lineHeight: "1.6"
        });
    });

    it("keeps the default highlight style and no colors for an extension without them", () => {
        expect(readPreviewTheme("none", [])).toEqual({
            id: "none", styles: defaultHighlightStyle.specs, colors: {}
        });

        const dashed = readPreviewTheme("dashed", [
            EditorView.theme({ ".cm-gutters": { borderRight: "1px dashed red" } })
        ]);
        expect(dashed.colors).toEqual({});
    });
});

describe("buildCodePreviewCss", () => {
    it("writes the colors and the token styles of a theme, under its slot", async () => {
        const theme = await readTheme("vs-code-light");
        const css = buildCodePreviewCss({ theme, key: "l" }, ":where(html.theme-light)")
            .split("\n");
        const root = ":where(html.theme-light) .code-preview[data-code-theme-l=\"vs-code-light\"]";

        expect(css[0]).toBe(`${root} { --code-preview-background: #ffffff; `
            + "--code-preview-foreground: #383a42; --code-preview-gutter-background: #f5f5f5; "
            + "--code-preview-gutter-foreground: #237893; --code-preview-gutter-border-width: 1px; "
            + "--code-preview-gutter-border-color: #d6d6d6; --code-preview-line-height: 1.6; }");
        expect(css[1]).toBe(`${root} .l0 { color: #0064ff; font-weight: bold; }`);
        expect(css.length).toBe(theme.styles.length + 1);
    });

    it("leaves out the colors a theme does not set, and the class of a style", () => {
        const theme = readPreviewTheme("custom", syntaxHighlighting(HighlightStyle.define([
            { tag: tags.keyword, class: "keyword", color: "red", fontStyle: "italic" }
        ])));

        expect(buildCodePreviewCss({ theme, key: "t" }).split("\n")).toEqual([
            ".code-preview[data-code-theme-t=\"custom\"] {  }",
            ".code-preview[data-code-theme-t=\"custom\"] .t0 { color: red; font-style: italic; }"
        ]);
    });
});

async function readTheme(id: string) {
    const definition = getThemeById(id);
    if (!definition) throw new Error(`No theme ${id}.`);
    return readPreviewTheme(id, await definition.load());
}
