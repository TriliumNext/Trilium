import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { excelColorToRgb, parseRange, parseXlsxToWorkbook, toArrayBuffer } from "./parse_from_xlsx.js";
import {
    BorderStyle,
    CellValueType,
    type DataValidationRule,
    HorizontalAlign,
    type ICellData,
    type IStyleData,
    type IWorksheetData,
    VerticalAlign,
    WrapStrategy
} from "./workbook_model.js";

/** Build an xlsx in memory, parse it back, and return the requested sheet's Univer data. */
async function roundTrip(build: (wb: ExcelJS.Workbook) => void, sheetIndex = 0): Promise<IWorksheetData> {
    const wb = new ExcelJS.Workbook();
    build(wb);
    const buffer = await wb.xlsx.writeBuffer();
    const { workbook } = await parseXlsxToWorkbook(buffer as ArrayBuffer);
    const id = workbook.sheetOrder[sheetIndex];
    return workbook.sheets[id];
}

/** Convenience: the single styled cell at A1 (row 0, col 0). */
function cellA1(sheet: IWorksheetData): ICellData | undefined {
    return sheet.cellData[0]?.[0];
}

/** The inline style object on a cell — the importer never emits string style references. */
function styleOf(cell: ICellData | undefined): IStyleData {
    const s = cell?.s;
    return s && typeof s === "object" ? s : {};
}

describe("parseXlsxToWorkbook", () => {
    it("reads string, number and boolean values with their cell types", async () => {
        const sheet = await roundTrip((wb) => {
            const ws = wb.addWorksheet("Ledger");
            ws.getCell("A1").value = "Hello";
            ws.getCell("B1").value = 42;
            ws.getCell("C1").value = true;
        });

        expect(sheet.name).toBe("Ledger");
        expect(sheet.cellData[0][0]).toMatchObject({ v: "Hello", t: CellValueType.STRING });
        expect(sheet.cellData[0][1]).toMatchObject({ v: 42, t: CellValueType.NUMBER });
        expect(sheet.cellData[0][2]).toMatchObject({ v: true, t: CellValueType.BOOLEAN });
    });

    it("reads a formula and re-adds the leading '='", async () => {
        const sheet = await roundTrip((wb) => {
            const ws = wb.addWorksheet("S");
            ws.getCell("A1").value = { formula: "SUM(B1:B2)", result: 7 } as ExcelJS.CellFormulaValue;
        });
        expect(cellA1(sheet)).toMatchObject({ f: "=SUM(B1:B2)", v: 7, t: CellValueType.NUMBER });
    });

    it("reads font styling and an explicit ARGB color", async () => {
        const sheet = await roundTrip((wb) => {
            const ws = wb.addWorksheet("S");
            const cell = ws.getCell("A1");
            cell.value = "f";
            cell.font = { name: "Arial", size: 14, bold: true, italic: true, underline: true, strike: true, color: { argb: "FF414657" } };
        });
        expect(cellA1(sheet)?.s).toMatchObject({
            ff: "Arial", fs: 14, bl: 1, it: 1, ul: { s: 1 }, st: { s: 1 }, cl: { rgb: "#414657" }
        });
    });

    it("does not capture the workbook-default font as an explicit font", async () => {
        // A cell with other styling (number format) but no explicit font: exceljs reports the
        // theme-default Calibri 11 — which must NOT become an explicit font, so the cell keeps
        // inheriting Univer's default font.
        const sheet = await roundTrip((wb) => {
            const ws = wb.addWorksheet("S");
            const cell = ws.getCell("A1");
            cell.value = 5;
            cell.numFmt = "0.00";
        });
        const style = styleOf(cellA1(sheet));
        expect(style.ff).toBeUndefined();
        expect(style.fs).toBeUndefined();
        expect(style.cl).toBeUndefined();
        expect(style.n).toMatchObject({ pattern: "0.00" });
    });

    it("keeps an explicit font size/color on a default-family font", async () => {
        // No explicit family, but an explicit size and color — both must survive even though the
        // family is left to the theme default.
        const sheet = await roundTrip((wb) => {
            const ws = wb.addWorksheet("S");
            const cell = ws.getCell("A1");
            cell.value = "x";
            cell.font = { size: 19, color: { argb: "FF036672" } };
        });
        expect(cellA1(sheet)?.s).toMatchObject({ fs: 19, cl: { rgb: "#036672" } });
        expect(styleOf(cellA1(sheet)).ff).toBeUndefined();
    });

    it("reads a solid fill into the background color", async () => {
        const sheet = await roundTrip((wb) => {
            const ws = wb.addWorksheet("S");
            const cell = ws.getCell("A1");
            cell.value = "x";
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF9F9F9" } };
        });
        expect(cellA1(sheet)?.s).toMatchObject({ bg: { rgb: "#F9F9F9" } });
    });

    it("reads alignment and wrap", async () => {
        const sheet = await roundTrip((wb) => {
            const ws = wb.addWorksheet("S");
            const cell = ws.getCell("A1");
            cell.value = "x";
            cell.alignment = { horizontal: "right", vertical: "middle", wrapText: true };
        });
        expect(cellA1(sheet)?.s).toMatchObject({
            ht: HorizontalAlign.RIGHT, vt: VerticalAlign.MIDDLE, tb: WrapStrategy.WRAP
        });
    });

    it("maps exceljs border styles back to the Univer enum", async () => {
        const sheet = await roundTrip((wb) => {
            const ws = wb.addWorksheet("S");
            const cell = ws.getCell("A1");
            cell.value = "b";
            cell.border = {
                top: { style: "thin", color: { argb: "FF111111" } },
                right: { style: "medium", color: { argb: "FF222222" } },
                bottom: { style: "thick", color: { argb: "FF333333" } },
                left: { style: "dotted", color: { argb: "FF444444" } }
            };
        });
        expect(cellA1(sheet)?.s).toMatchObject({
            bd: {
                t: { s: BorderStyle.THIN, cl: { rgb: "#111111" } },
                r: { s: BorderStyle.MEDIUM },
                b: { s: BorderStyle.THICK },
                l: { s: BorderStyle.DOTTED }
            }
        });
    });

    it("reads the number-format pattern verbatim", async () => {
        const sheet = await roundTrip((wb) => {
            const ws = wb.addWorksheet("S");
            const cell = ws.getCell("A1");
            cell.value = 1234.5;
            cell.numFmt = "#,##0.00;[Red]#,##0.00";
        });
        expect(cellA1(sheet)?.s).toMatchObject({ n: { pattern: "#,##0.00;[Red]#,##0.00" } });
    });

    it("reads merges as 0-based inclusive ranges", async () => {
        const sheet = await roundTrip((wb) => {
            const ws = wb.addWorksheet("S");
            ws.getCell("A1").value = "merged";
            ws.mergeCells("A1:B2");
        });
        expect(sheet.mergeData).toEqual([{ startRow: 0, endRow: 1, startColumn: 0, endColumn: 1 }]);
    });

    it("converts column width (chars) and row height (points) back to pixels", async () => {
        const sheet = await roundTrip((wb) => {
            const ws = wb.addWorksheet("S");
            ws.getCell("A1").value = "x";
            ws.getColumn(1).width = 16;
            ws.getRow(1).height = 30;
        });
        // 16 chars -> 16*7+5 = 117px; 30pt -> 30/0.75 = 40px.
        expect(sheet.columnData?.[0]?.w).toBeCloseTo(117, 1);
        expect(sheet.rowData?.[0]?.h).toBeCloseTo(40, 1);
    });

    it("flags hidden sheets, rows and columns", async () => {
        const sheet = await roundTrip((wb) => {
            const ws = wb.addWorksheet("Secret", { state: "hidden" });
            ws.getCell("A1").value = "x";
            ws.getColumn(1).hidden = true;
            ws.getRow(1).hidden = true;
        });
        expect(sheet.hidden).toBe(1);
        expect(sheet.columnData?.[0]?.hd).toBe(1);
        expect(sheet.rowData?.[0]?.hd).toBe(1);
    });

    it("keeps the background of an empty (value-less) styled cell", async () => {
        const sheet = await roundTrip((wb) => {
            const ws = wb.addWorksheet("S");
            ws.getCell("A1").value = "x";
            // B1 has only a fill, no value — must still survive the round-trip.
            ws.getCell("B1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF9F9F9" } };
        });
        expect(sheet.cellData[0][1]?.s).toMatchObject({ bg: { rgb: "#F9F9F9" } });
    });

    it("reads the sheet default row height and column width", async () => {
        const sheet = await roundTrip((wb) => {
            const ws = wb.addWorksheet("S", { properties: { defaultRowHeight: 18, defaultColWidth: 11.857 } });
            ws.getCell("A1").value = "x";
        });
        // 18pt -> 18/0.75 = 24px; 11.857 chars -> 11.857*7+5 ≈ 88px.
        expect(sheet.defaultRowHeight).toBeCloseTo(24, 0);
        expect(sheet.defaultColumnWidth).toBeCloseTo(88, 0);
    });

    it("preserves sheet order across multiple sheets", async () => {
        const wb = new ExcelJS.Workbook();
        wb.addWorksheet("First").getCell("A1").value = "1";
        wb.addWorksheet("Second").getCell("A1").value = "2";
        const buffer = await wb.xlsx.writeBuffer();
        const { workbook } = await parseXlsxToWorkbook(buffer as ArrayBuffer);
        expect(workbook.sheetOrder.map((id) => workbook.sheets[id].name)).toEqual(["First", "Second"]);
    });

    it("handles a sheet with no cells (null columns)", async () => {
        // An empty worksheet reports `ws.columns === null`, exercising readColumns' `?? []` fallback.
        const sheet = await roundTrip((wb) => {
            wb.addWorksheet("Empty");
        });
        expect(sheet.columnData).toEqual({});
        expect(sheet.columnCount).toBe(20);
    });

    it("throws on a non-xlsx buffer", async () => {
        await expect(parseXlsxToWorkbook(new Uint8Array([1, 2, 3]))).rejects.toThrow(/parse/i);
    });

    it("reads a date value as an Excel serial number", async () => {
        const sheet = await roundTrip((wb) => {
            const ws = wb.addWorksheet("S");
            ws.getCell("A1").value = new Date(Date.UTC(2026, 3, 6));
        });
        expect(cellA1(sheet)).toMatchObject({ v: 46118, t: CellValueType.NUMBER });
    });

    it("reads a hyperlink keeping the display text only", async () => {
        const sheet = await roundTrip((wb) => {
            const ws = wb.addWorksheet("S");
            ws.getCell("A1").value = { text: "Click", hyperlink: "https://example.com" };
        });
        expect(cellA1(sheet)).toMatchObject({ v: "Click", t: CellValueType.STRING });
    });

    it("flattens rich text into plain text", async () => {
        const sheet = await roundTrip((wb) => {
            const ws = wb.addWorksheet("S");
            ws.getCell("A1").value = { richText: [{ text: "Hello " }, { text: "World" }] };
        });
        expect(cellA1(sheet)).toMatchObject({ v: "Hello World", t: CellValueType.STRING });
    });

    it("reads an error value as a forced string", async () => {
        const sheet = await roundTrip((wb) => {
            const ws = wb.addWorksheet("S");
            ws.getCell("A1").value = { error: "#DIV/0!" } as ExcelJS.CellErrorValue;
        });
        expect(cellA1(sheet)).toMatchObject({ v: "#DIV/0!", t: CellValueType.FORCE_STRING });
    });

    it("reads cached formula results of every primitive kind", async () => {
        const sheet = await roundTrip((wb) => {
            const ws = wb.addWorksheet("S");
            ws.getCell("A1").value = { formula: "TRUE()", result: true } as ExcelJS.CellFormulaValue;
            ws.getCell("A2").value = {
                formula: "TODAY()",
                result: new Date(Date.UTC(2026, 3, 6))
            } as ExcelJS.CellFormulaValue;
            ws.getCell("A3").value = {
                formula: "1/0",
                result: { error: "#DIV/0!" }
            } as ExcelJS.CellFormulaValue;
            ws.getCell("A4").value = { formula: "T(1)", result: "txt" } as ExcelJS.CellFormulaValue;
            ws.getCell("A5").value = { formula: "NA()", result: undefined } as ExcelJS.CellFormulaValue;
        });
        expect(sheet.cellData[0][0]).toMatchObject({ f: "=TRUE()", v: true, t: CellValueType.BOOLEAN });
        expect(sheet.cellData[1][0]).toMatchObject({ f: "=TODAY()", v: 46118, t: CellValueType.NUMBER });
        expect(sheet.cellData[2][0]).toMatchObject({ f: "=1/0", v: "#DIV/0!", t: CellValueType.FORCE_STRING });
        expect(sheet.cellData[3][0]).toMatchObject({ f: "=T(1)", v: "txt", t: CellValueType.STRING });
        const naCell = sheet.cellData[4][0];
        expect(naCell?.f).toBe("=NA()");
        expect(naCell?.v).toBeUndefined();
    });

    it("maps the remaining horizontal and vertical alignment options", async () => {
        const sheet = await roundTrip((wb) => {
            const ws = wb.addWorksheet("S");
            ws.getCell("A1").value = "a";
            ws.getCell("A1").alignment = { horizontal: "left", vertical: "top" };
            ws.getCell("B1").value = "b";
            ws.getCell("B1").alignment = { horizontal: "center", vertical: "bottom" };
        });
        expect(sheet.cellData[0][0]?.s).toMatchObject({ ht: HorizontalAlign.LEFT, vt: VerticalAlign.TOP });
        expect(sheet.cellData[0][1]?.s).toMatchObject({ ht: HorizontalAlign.CENTER, vt: VerticalAlign.BOTTOM });
    });

    it("ignores alignment axes that have no Univer equivalent", async () => {
        // Only a vertical set -> horizontalAlign returns null (default branch); only a horizontal
        // set -> verticalAlign returns null. Each cell must carry exactly one of ht/vt.
        const sheet = await roundTrip((wb) => {
            const ws = wb.addWorksheet("S");
            ws.getCell("A1").value = "a";
            ws.getCell("A1").alignment = { vertical: "middle" };
            ws.getCell("B1").value = "b";
            ws.getCell("B1").alignment = { horizontal: "right" };
        });
        const aStyle = styleOf(sheet.cellData[0][0]);
        expect(aStyle.vt).toBe(VerticalAlign.MIDDLE);
        expect(aStyle.ht).toBeUndefined();
        const bStyle = styleOf(sheet.cellData[0][1]);
        expect(bStyle.ht).toBe(HorizontalAlign.RIGHT);
        expect(bStyle.vt).toBeUndefined();
    });

    it("reads vertical and angled text rotation", async () => {
        const sheet = await roundTrip((wb) => {
            const ws = wb.addWorksheet("S");
            ws.getCell("A1").value = "a";
            ws.getCell("A1").alignment = { textRotation: "vertical" };
            ws.getCell("B1").value = "b";
            ws.getCell("B1").alignment = { textRotation: 45 };
        });
        expect(sheet.cellData[0][0]?.s).toMatchObject({ tr: { v: 1 } });
        expect(sheet.cellData[0][1]?.s).toMatchObject({ tr: { a: 45 } });
    });

    it("maps every remaining exceljs border style to the Univer enum", async () => {
        const sheet = await roundTrip((wb) => {
            const ws = wb.addWorksheet("S");
            const styles = [
                ["A1", "hair", BorderStyle.HAIR],
                ["B1", "dashed", BorderStyle.DASHED],
                ["C1", "dashDot", BorderStyle.DASH_DOT],
                ["D1", "dashDotDot", BorderStyle.DASH_DOT_DOT],
                ["E1", "double", BorderStyle.DOUBLE],
                ["F1", "mediumDashed", BorderStyle.MEDIUM_DASHED],
                ["G1", "mediumDashDot", BorderStyle.MEDIUM_DASH_DOT],
                ["H1", "mediumDashDotDot", BorderStyle.MEDIUM_DASH_DOT_DOT],
                ["I1", "slantDashDot", BorderStyle.SLANT_DASH_DOT]
            ] as const;
            for (const [addr, excelStyle] of styles) {
                const cell = ws.getCell(addr);
                cell.value = "b";
                cell.border = { top: { style: excelStyle } };
            }
        });
        const expectations: Array<[number, BorderStyle]> = [
            [0, BorderStyle.HAIR],
            [1, BorderStyle.DASHED],
            [2, BorderStyle.DASH_DOT],
            [3, BorderStyle.DASH_DOT_DOT],
            [4, BorderStyle.DOUBLE],
            [5, BorderStyle.MEDIUM_DASHED],
            [6, BorderStyle.MEDIUM_DASH_DOT],
            [7, BorderStyle.MEDIUM_DASH_DOT_DOT],
            [8, BorderStyle.SLANT_DASH_DOT]
        ];
        for (const [col, expected] of expectations) {
            expect(sheet.cellData[0][col]?.s).toMatchObject({ bd: { t: { s: expected } } });
        }
    });

    it("resolves theme colors with tint across every HSL branch", async () => {
        const sheet = await roundTrip((wb) => {
            const ws = wb.addWorksheet("S");
            // theme 5 (#ED7D31, max===r) tint +0.4 -> #F4B183, on font color.
            const orange = ws.getCell("A1");
            orange.value = "o";
            orange.font = { color: { theme: 5, tint: 0.4 } as unknown as ExcelJS.Color };
            // theme 4 (#4472C4, max===b) tint -0.25 -> #2F5597, on solid fill.
            const blue = ws.getCell("B1");
            blue.value = "b";
            blue.fill = {
                type: "pattern",
                pattern: "solid",
                fgColor: { theme: 4, tint: -0.25 } as unknown as ExcelJS.Color
            };
            // theme 9 (#70AD47, max===g) tint +0.6.
            const green = ws.getCell("C1");
            green.value = "g";
            green.font = { color: { theme: 9, tint: 0.6 } as unknown as ExcelJS.Color };
            // theme 0 (#FFFFFF, gray path max===min) tint -0.5 -> #808080 (hslToRgb s===0).
            const gray = ws.getCell("D1");
            gray.value = "w";
            gray.font = { color: { theme: 0, tint: -0.5 } as unknown as ExcelJS.Color };
        });
        expect(sheet.cellData[0][0]?.s).toMatchObject({ cl: { rgb: "#F4B183" } });
        expect(sheet.cellData[0][1]?.s).toMatchObject({ bg: { rgb: "#2F5597" } });
        // green/gray just need to resolve to a hex string and exercise their branches.
        expect(styleOf(sheet.cellData[0][2]).cl?.rgb).toMatch(/^#[0-9A-F]{6}$/);
        expect(sheet.cellData[0][3]?.s).toMatchObject({ cl: { rgb: "#808080" } });
    });

    it("flags a sheet with gridlines turned off", async () => {
        const sheet = await roundTrip((wb) => {
            const ws = wb.addWorksheet("S");
            ws.getCell("A1").value = "x";
            ws.views = [{ showGridLines: false } as ExcelJS.WorksheetView];
        });
        expect(sheet.showGridlines).toBe(0);
    });

    it("drops a font color that resolves to nothing while keeping other font styling", async () => {
        // A fully-transparent (alpha 00) font color resolves to null, so no `cl` is emitted, but
        // the bold flag still survives (covers the `if (color)` false branch in readFont).
        const sheet = await roundTrip((wb) => {
            const ws = wb.addWorksheet("S");
            const cell = ws.getCell("A1");
            cell.value = "x";
            cell.font = { bold: true, color: { argb: "00FF0000" } };
        });
        const style = styleOf(cellA1(sheet));
        expect(style.bl).toBe(1);
        expect(style.cl).toBeUndefined();
    });

    it("ignores an alignment object whose only setting has no Univer equivalent", async () => {
        // `horizontal: "fill"` maps to null and nothing else is set, so readAlignment returns null
        // and the cell carries no alignment style at all.
        const sheet = await roundTrip((wb) => {
            const ws = wb.addWorksheet("S");
            const cell = ws.getCell("A1");
            cell.value = "x";
            cell.alignment = { horizontal: "fill" };
        });
        const style = styleOf(cellA1(sheet));
        expect(style.ht).toBeUndefined();
        expect(style.vt).toBeUndefined();
    });

    it("skips the theme-1 default text color so the cell inherits Univer's default", async () => {
        const sheet = await roundTrip((wb) => {
            const ws = wb.addWorksheet("S");
            const cell = ws.getCell("A1");
            cell.value = "x";
            cell.font = { bold: true, color: { theme: 1 } as unknown as ExcelJS.Color };
        });
        const style = styleOf(cellA1(sheet));
        expect(style.bl).toBe(1);
        expect(style.cl).toBeUndefined();
    });

    it("parses an xlsx delivered as an offset view into a larger buffer (Node Buffer import path)", async () => {
        // Reproduces the real server-import shape: a Node Buffer that views part of a larger
        // backing buffer at a non-zero offset (single.ts / zip.ts both pass Buffers). With the
        // buggy `slice().buffer`, exceljs receives the WHOLE backing; the stray end-of-central-
        // directory marker placed in the trailing bytes then makes JSZip read an empty archive,
        // silently dropping every sheet.
        const wb = new ExcelJS.Workbook();
        wb.addWorksheet("Data").getCell("A1").value = "survived";
        const xlsx = Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);

        const PREFIX = 8;
        const TRAILER = 32;
        const backing = Buffer.alloc(PREFIX + xlsx.length + TRAILER); // standalone, zero-filled
        xlsx.copy(backing, PREFIX);
        // A fake EOCD signature ("PK\x05\x06") at the very end; the 18 zero bytes after it read as
        // a valid record describing zero entries, so the whole backing parses as an empty zip.
        backing.set([0x50, 0x4b, 0x05, 0x06], backing.length - 22);
        const view = backing.subarray(PREFIX, PREFIX + xlsx.length);

        const { workbook } = await parseXlsxToWorkbook(view);
        const sheet = workbook.sheets[workbook.sheetOrder[0]];
        expect(sheet?.cellData[0]?.[0]).toMatchObject({ v: "survived" });
    });
});

describe("parseXlsxToWorkbook images", () => {
    // 1x1 transparent PNG.
    const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

    async function parseBuilt(build: (wb: ExcelJS.Workbook) => void): Promise<Awaited<ReturnType<typeof parseXlsxToWorkbook>>["workbook"]> {
        const wb = new ExcelJS.Workbook();
        build(wb);
        const buffer = await wb.xlsx.writeBuffer();
        return (await parseXlsxToWorkbook(buffer as ArrayBuffer)).workbook;
    }

    // Reads the SHEET_DRAWING_PLUGIN resource for a sheet back into a typed shape.
    function drawingsOf(workbook: { sheetOrder: string[]; resources?: { name: string; data: string }[] }, sheetIndex = 0) {
        const resource = workbook.resources?.find((r) => r.name === "SHEET_DRAWING_PLUGIN");
        if (!resource) return null;
        const parsed = JSON.parse(resource.data) as Record<string, { data: Record<string, any>; order: string[] }>;
        return parsed[workbook.sheetOrder[sheetIndex]] ?? null;
    }

    it("imports a two-cell floating image as a base64 drawing with from/to anchors", async () => {
        const workbook = await parseBuilt((wb) => {
            const ws = wb.addWorksheet("S");
            ws.getCell("A1").value = "x";
            const id = wb.addImage({ base64: PNG, extension: "png" });
            ws.addImage(id, { tl: { col: 1, row: 2 }, br: { col: 3, row: 5 }, editAs: "twoCell" } as unknown as ExcelJS.ImageRange);
        });

        const drawings = drawingsOf(workbook);
        expect(drawings?.order.length).toBe(1);
        const drawing = drawings?.data[drawings.order[0]];
        expect(drawing.imageSourceType).toBe("BASE64");
        expect(drawing.source).toMatch(/^data:image\/png;base64,/);
        expect(drawing.sheetTransform.from).toMatchObject({ column: 1, row: 2, columnOffset: 0, rowOffset: 0 });
        expect(drawing.sheetTransform.to).toMatchObject({ column: 3, row: 5 });
        expect(drawing.transform.width).toBeGreaterThan(0);
        expect(drawing.transform.height).toBeGreaterThan(0);
    });

    it("imports a one-cell (ext) image using the extent for the drawing size", async () => {
        const workbook = await parseBuilt((wb) => {
            const ws = wb.addWorksheet("S");
            const id = wb.addImage({ base64: PNG, extension: "png" });
            ws.addImage(id, { tl: { col: 0, row: 0 }, ext: { width: 120, height: 90 } });
        });

        const drawing = drawingsOf(workbook)?.data[drawingsOf(workbook)!.order[0]];
        expect(drawing.transform.width).toBe(120);
        expect(drawing.transform.height).toBe(90);
        expect(drawing.sheetTransform.from).toMatchObject({ column: 0, row: 0 });
    });

    it("preserves multiple images in order", async () => {
        const workbook = await parseBuilt((wb) => {
            const ws = wb.addWorksheet("S");
            const a = wb.addImage({ base64: PNG, extension: "png" });
            const b = wb.addImage({ base64: PNG, extension: "png" });
            ws.addImage(a, { tl: { col: 0, row: 0 }, ext: { width: 10, height: 10 } });
            ws.addImage(b, { tl: { col: 2, row: 2 }, ext: { width: 10, height: 10 } });
        });
        expect(drawingsOf(workbook)?.order.length).toBe(2);
    });

    it("emits no drawing resource for a sheet without images", async () => {
        const workbook = await parseBuilt((wb) => {
            wb.addWorksheet("S").getCell("A1").value = "x";
        });
        expect(workbook.resources).toBeUndefined();
    });

    it("records the default header sizes so the baked-in image offset cancels in the share view", async () => {
        // buildDrawing adds the header gutters into transform.left/top; the share renderer subtracts
        // them back by reading these fields, so they must be present (and match) on imported sheets.
        const workbook = await parseBuilt((wb) => {
            wb.addWorksheet("S").getCell("A1").value = "x";
        });
        const sheet = workbook.sheets[workbook.sheetOrder[0]];
        expect(sheet.rowHeader).toEqual({ width: 46, hidden: 0 });
        expect(sheet.columnHeader).toEqual({ height: 20, hidden: 0 });
    });
});

describe("parseXlsxToWorkbook data validation", () => {
    // Reads the SHEET_DATA_VALIDATION_PLUGIN resource for a sheet back into a typed shape.
    function validationsOf(
        workbook: { sheetOrder: string[]; resources?: { name: string; data: string }[] },
        sheetIndex = 0
    ): DataValidationRule[] | null {
        const resource = workbook.resources?.find((r) => r.name === "SHEET_DATA_VALIDATION_PLUGIN");
        if (!resource) return null;
        const parsed = JSON.parse(resource.data) as Record<string, DataValidationRule[]>;
        return parsed[workbook.sheetOrder[sheetIndex]] ?? null;
    }

    it("imports an inline dropdown list, coalescing the cell range and JSON-encoding the options", async () => {
        // Mirrors the real file: a single sqref rectangle that exceljs expands to individual cells.
        const wb = new ExcelJS.Workbook();
        const ws = wb.addWorksheet("S");
        ws.getCell("A1").value = "x";
        ws.dataValidations.add("D2:E3", {
            type: "list",
            allowBlank: true,
            formulae: ['"0 - Below Expectations ,1 - Meets Expectations,2 - Strong Performance"']
        });
        const buffer = await wb.xlsx.writeBuffer();
        const { workbook } = await parseXlsxToWorkbook(buffer as ArrayBuffer);

        const rules = validationsOf(workbook);
        expect(rules).toHaveLength(1);
        const rule = rules?.[0];
        expect(rule?.type).toBe("list");
        // Univer's list validator JSON-parses formula1 (deserializeListOptions); the exporter
        // JSON.stringifies. The inline options keep their exact text, including the trailing space.
        expect(rule?.formula1).toBe(
            JSON.stringify(["0 - Below Expectations ", "1 - Meets Expectations", "2 - Strong Performance"])
        );
        // The 2x2 block collapses back into a single rectangle, not four 1x1 ranges.
        expect(rule?.ranges).toEqual([{ startRow: 1, endRow: 2, startColumn: 3, endColumn: 4 }]);
        expect(rule?.uid).toBeTruthy();
    });

    it("carries the operator and both formulae for a numeric (whole between) validation", async () => {
        const wb = new ExcelJS.Workbook();
        const ws = wb.addWorksheet("S");
        ws.getCell("B2").dataValidation = { type: "whole", operator: "between", formulae: [1, 10] };
        const buffer = await wb.xlsx.writeBuffer();
        const { workbook } = await parseXlsxToWorkbook(buffer as ArrayBuffer);

        const rule = validationsOf(workbook)?.[0];
        expect(rule?.type).toBe("whole");
        expect(rule?.operator).toBe("between");
        expect(rule?.formula1).toBe("1");
        expect(rule?.formula2).toBe("10");
        expect(rule?.ranges).toEqual([{ startRow: 1, endRow: 1, startColumn: 1, endColumn: 1 }]);
    });

    it("emits no validation resource for a sheet without any", async () => {
        const wb = new ExcelJS.Workbook();
        wb.addWorksheet("S").getCell("A1").value = "x";
        const buffer = await wb.xlsx.writeBuffer();
        const { workbook } = await parseXlsxToWorkbook(buffer as ArrayBuffer);
        expect(workbook.resources?.some((r) => r.name === "SHEET_DATA_VALIDATION_PLUGIN")).toBeFalsy();
    });

    it("keeps distinct configs as separate rules on the same sheet", async () => {
        const wb = new ExcelJS.Workbook();
        const ws = wb.addWorksheet("S");
        ws.dataValidations.add("A1:A2", { type: "list", formulae: ['"a,b"'] });
        ws.dataValidations.add("C1:C2", { type: "list", formulae: ['"x,y"'] });
        const buffer = await wb.xlsx.writeBuffer();
        const { workbook } = await parseXlsxToWorkbook(buffer as ArrayBuffer);

        const rules = validationsOf(workbook);
        expect(rules).toHaveLength(2);
        const formula1s = rules?.map((r) => r.formula1).sort();
        expect(formula1s).toEqual([JSON.stringify(["a", "b"]), JSON.stringify(["x", "y"])]);
    });

    it("passes a range-referenced list through as the formula, not a JSON option array", async () => {
        // A dropdown whose options come from a cell range ($A$1:$A$3) rather than inline text:
        // there are no literal options to encode, so the reference is carried as formula1 verbatim.
        const wb = new ExcelJS.Workbook();
        const ws = wb.addWorksheet("S");
        ws.getCell("C1").dataValidation = { type: "list", formulae: ["$A$1:$A$3"] };
        const buffer = await wb.xlsx.writeBuffer();
        const { workbook } = await parseXlsxToWorkbook(buffer as ArrayBuffer);

        const rule = validationsOf(workbook)?.[0];
        expect(rule?.type).toBe("list");
        expect(rule?.formula1).toBe("$A$1:$A$3");
    });

    it("carries a single-bound numeric constraint (greaterThan) with just formula1", async () => {
        const wb = new ExcelJS.Workbook();
        const ws = wb.addWorksheet("S");
        ws.getCell("B2").dataValidation = { type: "decimal", operator: "greaterThan", formulae: [5] };
        const buffer = await wb.xlsx.writeBuffer();
        const { workbook } = await parseXlsxToWorkbook(buffer as ArrayBuffer);

        const rule = validationsOf(workbook)?.[0];
        expect(rule?.operator).toBe("greaterThan");
        expect(rule?.formula1).toBe("5");
        expect(rule?.formula2).toBeUndefined();
    });

    it("carries a custom-formula validation (a formula, no operator)", async () => {
        const wb = new ExcelJS.Workbook();
        const ws = wb.addWorksheet("S");
        ws.getCell("B2").dataValidation = { type: "custom", formulae: ["=B2>0"] };
        const buffer = await wb.xlsx.writeBuffer();
        const { workbook } = await parseXlsxToWorkbook(buffer as ArrayBuffer);

        const rule = validationsOf(workbook)?.[0];
        expect(rule?.type).toBe("custom");
        expect(rule?.formula1).toBe("=B2>0");
        expect(rule?.operator).toBeUndefined();
    });

    it("drops a list validation that carries no options", async () => {
        const wb = new ExcelJS.Workbook();
        const ws = wb.addWorksheet("S");
        ws.getCell("A1").value = "x";
        ws.getCell("B1").dataValidation = { type: "list", formulae: [] };
        const buffer = await wb.xlsx.writeBuffer();
        const { workbook } = await parseXlsxToWorkbook(buffer as ArrayBuffer);
        expect(workbook.resources?.some((r) => r.name === "SHEET_DATA_VALIDATION_PLUGIN")).toBeFalsy();
    });
});

describe("toArrayBuffer", () => {
    it("copies a Node Buffer view into a tightly-sized ArrayBuffer, not the whole backing", () => {
        // Buffer.prototype.slice returns a VIEW over the same backing (unlike
        // Uint8Array.prototype.slice, which copies), so `input.slice().buffer` would expose the
        // entire backing — foreign bytes and all — to exceljs.
        const backing = Buffer.alloc(64);
        for (let i = 0; i < backing.length; i++) backing[i] = i;
        const view = backing.subarray(8, 24); // 16 bytes at a non-zero offset

        const result = toArrayBuffer(view);

        expect(result.byteLength).toBe(view.byteLength);
        expect([...new Uint8Array(result)]).toEqual([...view]);
    });

    it("copies a Uint8Array subarray tightly (browser/standalone import path)", () => {
        const backing = new Uint8Array(64);
        for (let i = 0; i < backing.length; i++) backing[i] = i;
        const view = backing.subarray(8, 24);

        const result = toArrayBuffer(view);

        expect(result.byteLength).toBe(view.byteLength);
        expect([...new Uint8Array(result)]).toEqual([...view]);
    });

    it("returns a standalone ArrayBuffer unchanged", () => {
        const ab = new ArrayBuffer(8);
        expect(toArrayBuffer(ab)).toBe(ab);
    });
});

describe("excelColorToRgb", () => {
    it("resolves ARGB, theme and edge-case colors", () => {
        // 8-digit ARGB drops the alpha; 6-digit ARGB is taken verbatim.
        expect(excelColorToRgb({ argb: "FF112233" })).toBe("#112233");
        expect(excelColorToRgb({ argb: "ABCDEF" } as Partial<ExcelJS.Color>)).toBe("#ABCDEF");
        // Fully-transparent (alpha "00") and non-hex strings resolve to null.
        expect(excelColorToRgb({ argb: "00FFFFFF" })).toBeNull();
        expect(excelColorToRgb({ argb: "nothex" })).toBeNull();
        // Theme + tint resolves against the Office palette.
        expect(excelColorToRgb({ theme: 5, tint: 0.4 } as Partial<ExcelJS.Color>)).toBe("#F4B183");
        // Out-of-range theme index, missing color and empty object all resolve to null.
        expect(excelColorToRgb({ theme: 99 } as Partial<ExcelJS.Color>)).toBeNull();
        expect(excelColorToRgb(undefined)).toBeNull();
        expect(excelColorToRgb({} as Partial<ExcelJS.Color>)).toBeNull();
    });

    it("exercises the tint and hue branches of the HSL math", () => {
        // A theme color with no tint short-circuits applyTint (returns the base hex untouched).
        expect(excelColorToRgb({ theme: 4 } as Partial<ExcelJS.Color>)).toBe("#4472C4");
        // theme 11 (#954F72): max===r with g < b, and a hue > 2/3 so hueToChannel's t>1 wraps.
        // A non-zero tint forces the value through rgbToHsl/hslToRgb/hueToChannel.
        expect(excelColorToRgb({ theme: 11, tint: 0.2 } as Partial<ExcelJS.Color>)).toMatch(/^#[0-9A-F]{6}$/);
        // theme 8 (#5B9BD5): max===b with a low hue so hueToChannel's t<0 wraps the other way.
        expect(excelColorToRgb({ theme: 8, tint: -0.3 } as Partial<ExcelJS.Color>)).toMatch(/^#[0-9A-F]{6}$/);
    });
});

describe("parseRange", () => {
    it("parses ranges, single cells and rejects malformed refs", () => {
        // A two-cell range, normalized to 0-based inclusive bounds.
        expect(parseRange("B2:D5")).toEqual({ startRow: 1, endRow: 4, startColumn: 1, endColumn: 3 });
        // Reversed corners are normalized via min/max, so endpoint order doesn't matter.
        expect(parseRange("D5:B2")).toEqual({ startRow: 1, endRow: 4, startColumn: 1, endColumn: 3 });
        // A single address (no ":") collapses to a 1×1 range (the `to ?? from` fallback).
        expect(parseRange("A1")).toEqual({ startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 });
        // Multi-letter columns advance base-26: AA -> column index 26.
        expect(parseRange("AA10")).toEqual({ startRow: 9, endRow: 9, startColumn: 26, endColumn: 26 });
        // A malformed start endpoint (no row digits) yields null.
        expect(parseRange("zzz")).toBeNull();
        // A malformed end endpoint yields null too (covers the `!end` half of the guard).
        expect(parseRange("A1:zz")).toBeNull();
    });
});
