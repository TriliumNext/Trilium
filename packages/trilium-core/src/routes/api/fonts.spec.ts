import type { Request, Response } from "../../http_interface";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as cls from "../../services/context.js";
import optionService from "../../services/options.js";
import sqlInit from "../../services/sql_init.js";
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

    it("serves the stylesheet of the font options as CSS", () => {
        const empty = getCss();
        expect(empty.headers["Content-Type"]).toBe("text/css");
        expect(empty.body).toBe("");

        cls.init(() => {
            optionService.setOption("overrideThemeFonts", "true");
            optionService.setOption("detailFontFamily", "Arial");
        });
        const { headers, body } = getCss();
        expect(headers["Content-Type"]).toBe("text/css");
        expect(body).toMatch(/^html:root \{/);
        expect(body).toContain("--detail-font-family: Arial;");
    });

    it("serves an empty stylesheet before the database is initialized", () => {
        cls.init(() => {
            optionService.setOption("overrideThemeFonts", "true");
            optionService.setOption("detailFontFamily", "Arial");
        });
        const initialized = vi.spyOn(sqlInit, "isDbInitialized").mockReturnValue(false);
        try {
            const { headers, body } = getCss();
            expect(headers["Content-Type"]).toBe("text/css");
            expect(body).toBe("");
        } finally {
            initialized.mockRestore();
        }
    });
});
