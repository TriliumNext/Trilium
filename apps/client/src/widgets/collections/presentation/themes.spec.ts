import { describe, expect, it } from "vitest";
import { getPresentationThemes, loadPresentationTheme } from "./themes";

describe("Presentation themes", () => {
    it("can load all themes", async () => {
        const themes = getPresentationThemes();
        const stylesheets = await Promise.all(themes.map(theme => loadPresentationTheme(theme.id)));

        for (const [ index, stylesheet ] of stylesheets.entries()) {
            const id = themes[index].id;

            // Every theme drives reveal.js through the custom properties the template emits.
            expect(stylesheet, id).toContain("--r-main-font");
            expect(stylesheet, id).toContain("--r-background-color");

            // The vendored sources carry no fonts: no inlined face, and nothing fetched at render
            // time. See reveal-themes/README.md.
            expect(stylesheet, id).not.toContain("@font-face");
            expect(stylesheet, id).not.toContain("base64");
            expect(stylesheet, id).not.toContain("fonts.googleapis.com");
        }
    });

    it("falls back to the default theme for an unknown name", async () => {
        expect(await loadPresentationTheme("no-such-theme")).toBe(await loadPresentationTheme("white"));
    });
});
