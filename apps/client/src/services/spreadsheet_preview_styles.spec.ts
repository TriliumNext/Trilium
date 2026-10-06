import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderSpreadsheetToHtml } from "@triliumnext/commons/src/lib/spreadsheet/render_to_html.js";
import { describe, expect, it } from "vitest";

/**
 * The renderer emits a workbook's cell styling as `.spreadsheet-table .sst-*` rules, while
 * content_renderer.css supplies the defaults every cell starts from. Those two have to stay on
 * speaking terms: if a default ever outranks a generated rule, cells silently lose their
 * borders, wrapping or clipping. This renders a workbook against the real stylesheet and reads
 * the computed styles back, which is the only way that contract shows up as a test failure.
 */
function spreadsheetRulesFrom(stylesheet: string): string {
    const css = readFileSync(join(__dirname, stylesheet), "utf-8");
    return (css.match(/[^{}]*spreadsheet-table[^{]*\{[^}]*\}/g) ?? []).join("\n");
}

const WORKBOOK = JSON.stringify({
    version: 1,
    workbook: {
        sheetOrder: ["s1"],
        styles: {},
        sheets: {
            s1: {
                id: "s1", name: "S", hidden: 0, rowCount: 10, columnCount: 5, showGridlines: 1,
                mergeData: [],
                cellData: {
                    "0": {
                        // Wraps and carries its own border, both of which the defaults also set.
                        "0": { v: "a long wrapped label", t: 1, s: { tb: 3, bd: { t: { s: 3, cl: { rgb: "#FF0000" } } } } },
                        "1": { v: "next", t: 1 }
                    }
                },
                rowData: {}, columnData: {}
            }
        }
    }
});

describe("spreadsheet preview styling", () => {
    it("lets a cell's own styling outrank the preview defaults, which still reach a plain cell", () => {
        document.head.innerHTML = `<style>${spreadsheetRulesFrom("content_renderer.css")}</style>`;
        document.body.innerHTML = `<div class="ck-content office-preview-body">${renderSpreadsheetToHtml(WORKBOOK)}</div>`;

        const [styled, plain] = document.querySelectorAll("td");
        const styledCss = getComputedStyle(styled);

        expect(styledCss.whiteSpace).toBe("normal");
        expect(styledCss.borderTopStyle).toBe("dotted");
        expect(styledCss.borderTopColor).toBe("#FF0000");

        // A cell that styles nothing still picks up the gridline default.
        const plainCss = getComputedStyle(plain);
        expect(plainCss.borderTopStyle).toBe("solid");
        // Its padding comes from the renderer, which measures every cell holding content against
        // the box the editor lays it out in, rather than from the stylesheet's own.
        expect(plainCss.paddingLeft).toBe("2px");
    });

    it("draws gridlines from the host's color, which a sheet's own gridline color overrides", () => {
        // The stylesheet resolves the host color to var(--main-border-color); happy-dom cannot
        // resolve a custom property whose value is itself a var(), so the token is substituted
        // here. The rule under test — the renderer's own — is used exactly as it ships.
        document.head.innerHTML = `<style>${spreadsheetRulesFrom("content_renderer.css")}
            .office-preview-body .spreadsheet-table { --spreadsheet-gridline-color: #aabbcc; }</style>`;

        const gridlineColor = (gridlinesColor?: string) => {
            const workbook = JSON.parse(WORKBOOK);
            if (gridlinesColor) workbook.workbook.sheets.s1.gridlinesColor = gridlinesColor;
            document.body.innerHTML =
                `<div class="ck-content office-preview-body">${renderSpreadsheetToHtml(JSON.stringify(workbook))}</div>`;
            // Read where GRIDLINE_RULE reads it: happy-dom substitutes only the first var() of a
            // value, so the rule's second one — the color — never reaches a cell's border there.
            return getComputedStyle(document.querySelectorAll(".spreadsheet-table")[0])
                .getPropertyValue("--spreadsheet-gridline-color");
        };

        expect(gridlineColor()).toBe("#aabbcc");
        // The second cell styles nothing of its own, so the gridline is the border it draws.
        expect(getComputedStyle(document.querySelectorAll("td")[1]).borderTopStyle).toBe("solid");
        expect(gridlineColor("#00FF00")).toBe("#00FF00");
    });

});
