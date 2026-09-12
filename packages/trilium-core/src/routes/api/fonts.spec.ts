import type { Request, Response } from "express";
import { beforeEach, describe, expect, it } from "vitest";

import * as cls from "../../services/context.js";
import optionService from "../../services/options.js";
import fontsRoute from "./fonts.js";

function fakeRes() {
    const headers: Record<string, string> = {};
    let body = "";
    const res = {
        setHeader(name: string, value: string) { headers[name] = value; },
        send(content: string) { body = content; }
    } as unknown as Response;
    return { res, headers, getBody: () => body };
}

function getCss(): { headers: Record<string, string>; body: string } {
    const { res, headers, getBody } = fakeRes();
    fontsRoute.getFontCss({} as Request, res);
    return { headers, body: getBody() };
}

describe("Fonts API", () => {
    beforeEach(() => {
        cls.init(() => optionService.setOption("overrideThemeFonts", "false"));
    });

    it("always sets a CSS content type", () => {
        const { headers } = getCss();
        expect(headers["Content-Type"]).toBe("text/css");
    });

    it("returns empty CSS when font override is disabled", () => {
        expect(getCss().body).toBe("");
    });

    it("emits font-size variables and resolves 'system' / 'theme' families", () => {
        cls.init(() => {
            optionService.setOption("overrideThemeFonts", "true");
            optionService.setOption("mainFontFamily", "system");
            optionService.setOption("treeFontFamily", "theme");
            optionService.setOption("detailFontFamily", "Arial");
            optionService.setOption("monospaceFontFamily", "system");
        });

        const { body } = getCss();
        expect(body).toContain("--main-font-size:");
        expect(body).toContain("--tree-font-size:");
        // 'system' is expanded to a font stack, 'theme' is omitted entirely
        expect(body).toContain("--main-font-family:");
        expect(body).not.toContain("--tree-font-family:");
        expect(body).toContain("--detail-font-family: Arial;");
        expect(body).toContain("--monospace-font-family:");
    });

    it("expands every family when all are set to 'system'", () => {
        cls.init(() => {
            optionService.setOption("overrideThemeFonts", "true");
            optionService.setOption("mainFontFamily", "system");
            optionService.setOption("treeFontFamily", "system");
            optionService.setOption("detailFontFamily", "system");
            optionService.setOption("monospaceFontFamily", "system");
        });

        const { body } = getCss();
        for (const v of ["--main-font-family:", "--tree-font-family:", "--detail-font-family:", "--monospace-font-family:"]) {
            expect(body).toContain(v);
        }
    });

    it("names one of the user's own fonts by the family its file is registered under", () => {
        cls.init(() => {
            optionService.setOption("overrideThemeFonts", "true");
            optionService.setOption("mainFontFamily", "customFont:abc123XYZ");
            // A reference to no note Trilium could have minted is left as it stands rather than
            // built into a declaration.
            optionService.setOption("treeFontFamily", "customFont:not a note id");
            optionService.setOption("detailFontFamily", "Arial");
        });

        const { body } = getCss();
        expect(body).toContain('--main-font-family: "trilium-font-abc123XYZ";');
        expect(body).toContain("--tree-font-family: customFont:not a note id;");
        expect(body).toContain("--detail-font-family: Arial;");
    });
});
