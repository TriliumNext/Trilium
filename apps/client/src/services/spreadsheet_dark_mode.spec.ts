import { renderSpreadsheetToHtml } from "@triliumnext/commons/src/lib/spreadsheet/render_to_html.js";
import { invertColorByMatrix } from "@univerjs/core";
import { describe, expect, it } from "vitest";

/**
 * A previewed sheet has to darken the way the editor does, so the renderer inverts colors with
 * Univer's own matrix. This checks the two agree by running Univer's function, which lives in a
 * dependency only the client has — hence a spec here rather than beside the renderer.
 *
 * What happy-dom cannot help with is `light-dark()`: it does not evaluate the function, so the
 * pairing is asserted as emitted CSS in render_to_html.spec.ts rather than as a computed color.
 */
function darkHalfOf(rgb: string): string | undefined {
    const workbook = JSON.stringify({
        version: 1,
        workbook: {
            sheetOrder: ["s1"], styles: {},
            sheets: {
                s1: {
                    id: "s1", name: "S", hidden: 0, rowCount: 5, columnCount: 5, showGridlines: 0,
                    mergeData: [], cellData: { "0": { "0": { v: "x", t: 1, s: { cl: { rgb } } } } },
                    rowData: {}, columnData: {}
                }
            }
        }
    });
    return /color:light-dark\([^,]+,(#[0-9a-f]{6})\)/.exec(renderSpreadsheetToHtml(workbook))?.[1];
}

function univerDarkHalfOf(rgb: string): string {
    const channel = (at: number) => Number.parseInt(rgb.slice(at, at + 2), 16);
    const inverted = invertColorByMatrix([channel(1), channel(3), channel(5)]);

    return "#" + inverted.map((value) => Math.round(value).toString(16).padStart(2, "0")).join("");
}

describe("dark-mode colors match Univer", () => {
    it("agrees on the fills, text and edges a real workbook carries", () => {
        for (const color of [
            "#FFE699", "#FFD966", "#DBDBDB", "#F2F2F2", // fills from the sample workbooks
            "#000000", "#FFFFFF", "#7F7F7F", // the ends and middle of the grey axis
            "#0563C1", "#203864", "#FF0000", "#00FF00", // saturated, where a naive invert diverges
            "#010203", "#FEFDFC" // just inside each clamp
        ]) {
            expect(darkHalfOf(color)).toBe(univerDarkHalfOf(color));
        }
    });

    it("agrees across the color space", () => {
        // A fixed sequence rather than Math.random, so a failure is reproducible.
        let seed = 0x2f6e2b1;
        const next = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % 256;

        for (let i = 0; i < 300; i++) {
            const color = "#" + [next(), next(), next()].map((c) => c.toString(16).padStart(2, "0")).join("");
            expect(darkHalfOf(color)).toBe(univerDarkHalfOf(color));
        }
    });
});
