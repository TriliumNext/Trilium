import { describe, expect, it } from "vitest";

import { buildFontCss, type FontOptions } from "./font_css.js";

const SIZES: FontOptions = {
    mainFontSize: "100", treeFontSize: "95", detailFontSize: "110", monospaceFontSize: "90"
};

function css(options: FontOptions) {
    return buildFontCss({ overrideThemeFonts: "true", ...SIZES, ...options });
}

describe("buildFontCss", () => {
    it("is empty while the theme's fonts are not overridden", () => {
        expect(buildFontCss({ ...SIZES, overrideThemeFonts: "false", mainFontFamily: "Arial" })).toBe("");
    });

    it("emits font-size variables and resolves 'system' / 'theme' families", () => {
        const body = css({
            mainFontFamily: "system",
            treeFontFamily: "theme",
            detailFontFamily: "Arial",
            monospaceFontFamily: "system"
        });
        // The client sizes `<html>` from `--main-font-size`, so it cannot be declared on `body`.
        expect(body).toMatch(/^html:root \{/);
        expect(body).toContain("--main-font-size: 100%;");
        expect(body).toContain("--tree-font-size: 95%;");
        expect(body).toContain("--detail-font-size: 110%;");
        expect(body).toContain("--monospace-font-size: 90%;");
        expect(body).toContain("--main-font-family: system-ui");
        expect(body).not.toContain("--tree-font-family:");
        expect(body).toContain("--detail-font-family: Arial;");
        expect(body).toMatch(/--monospace-font-family: [^;]*monospace;/);
    });

    it("leaves every family that follows the theme to the theme", () => {
        const body = css({
            mainFontFamily: "theme", treeFontFamily: "theme", detailFontFamily: "theme", monospaceFontFamily: "theme"
        });
        expect(body).toContain("--main-font-size:");
        expect(body).not.toContain("-font-family:");
    });

    it("names one of the user's own fonts by the family its file is registered under", () => {
        const body = css({
            mainFontFamily: "customFont:abc123XYZ",
            // A reference to no note Trilium could have minted is left as it stands rather than
            // built into a declaration.
            treeFontFamily: "customFont:not a note id",
            detailFontFamily: "Arial"
        });
        expect(body).toContain('--main-font-family: "trilium-font-abc123XYZ";');
        expect(body).toContain("--tree-font-family: customFont:not a note id;");
        expect(body).toContain("--detail-font-family: Arial;");
    });

    it("names the generic monospace twice, so the browser keeps the chosen font size", () => {
        const body = css({ detailFontFamily: "monospace", monospaceFontFamily: "monospace" });
        expect(body).toContain("--detail-font-family: monospace, monospace;");
        expect(body).toContain("--monospace-font-family: monospace, monospace;");
    });
});
