import ExcelJS from "exceljs";
import { beforeAll, describe, expect, it } from "vitest";

import { renderSpreadsheetToXlsx, uniqueSheetName } from "./render_to_xlsx.js";

/** Wrap a single styled cell (at A1 / row 0, col 0) into a complete workbook payload. */
function singleCellWorkbook(cell: unknown, sheetExtra: Record<string, unknown> = {}, styles: Record<string, unknown> = {}): string {
    return JSON.stringify({
        version: 1,
        workbook: {
            sheetOrder: ["s1"],
            styles,
            sheets: {
                s1: {
                    id: "s1",
                    name: "Sheet1",
                    hidden: 0,
                    mergeData: [],
                    cellData: { "0": { "0": cell } },
                    rowData: {},
                    columnData: {},
                    ...sheetExtra
                }
            }
        }
    });
}

/** Render to xlsx and read it back so assertions run against real OOXML output. */
async function roundTrip(json: string): Promise<ExcelJS.Workbook> {
    const buffer = await renderSpreadsheetToXlsx(json);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as ArrayBuffer);
    return wb;
}

describe("renderSpreadsheetToXlsx", () => {
    it("writes sheet name and string/number/boolean values", async () => {
        const json = JSON.stringify({
            version: 1,
            workbook: {
                sheetOrder: ["s1"],
                styles: {},
                sheets: {
                    s1: {
                        id: "s1",
                        name: "Ledger",
                        hidden: 0,
                        mergeData: [],
                        cellData: {
                            "0": { "0": { v: "Hello", t: 1 }, "1": { v: 42, t: 2 }, "2": { v: true, t: 3 } }
                        },
                        rowData: {},
                        columnData: {}
                    }
                }
            }
        });

        const ws = (await roundTrip(json)).getWorksheet("Ledger");
        expect(ws).toBeDefined();
        expect(ws?.getCell("A1").value).toBe("Hello");
        expect(ws?.getCell("B1").value).toBe(42);
        expect(ws?.getCell("C1").value).toBe(true);
    });

    it("passes the number-format pattern through verbatim", async () => {
        const ws = (await roundTrip(
            singleCellWorkbook({ v: 1234.5, t: 2, s: "money" }, {}, { money: { n: { pattern: "#,##0.00;[Red]#,##0.00" } } })
        )).worksheets[0];
        expect(ws.getCell("A1").numFmt).toBe("#,##0.00;[Red]#,##0.00");
    });

    it("maps font: bold, italic, underline, strike, size, family and color", async () => {
        const ws = (await roundTrip(
            singleCellWorkbook({ v: "f", s: { bl: 1, it: 1, ul: { s: 1 }, st: { s: 1 }, fs: 14, ff: "Arial", cl: { rgb: "#414657" } } })
        )).worksheets[0];
        const font = ws.getCell("A1").font;
        expect(font.bold).toBe(true);
        expect(font.italic).toBe(true);
        expect(font.underline).toBe(true);
        expect(font.strike).toBe(true);
        expect(font.size).toBe(14);
        expect(font.name).toBe("Arial");
        expect(font.color?.argb).toBe("FF414657");
    });

    it("maps a background fill to a solid pattern fill", async () => {
        const ws = (await roundTrip(
            singleCellWorkbook({ v: "x", s: { bg: { rgb: "#f9f9f9" } } })
        )).worksheets[0];
        const fill = ws.getCell("A1").fill as ExcelJS.FillPattern;
        expect(fill.type).toBe("pattern");
        expect(fill.pattern).toBe("solid");
        expect(fill.fgColor?.argb).toBe("FFF9F9F9");
    });

    it("maps horizontal/vertical alignment and wrap", async () => {
        const ws = (await roundTrip(
            singleCellWorkbook({ v: "x", s: { ht: 3, vt: 2, tb: 3 } })
        )).worksheets[0];
        const a = ws.getCell("A1").alignment;
        expect(a.horizontal).toBe("right");
        expect(a.vertical).toBe("middle");
        expect(a.wrapText).toBe(true);
    });

    it("maps the Univer border enum to the correct exceljs styles and colors", async () => {
        // THIN=1, MEDIUM=8, THICK=13, DOTTED=3 (the codes the real template uses + thick).
        const ws = (await roundTrip(
            singleCellWorkbook({
                v: "b",
                s: {
                    bd: {
                        t: { s: 1, cl: { rgb: "#111111" } },
                        r: { s: 8, cl: { rgb: "#222222" } },
                        b: { s: 13, cl: { rgb: "#333333" } },
                        l: { s: 3, cl: { rgb: "#444444" } }
                    }
                }
            })
        )).worksheets[0];
        const border = ws.getCell("A1").border;
        expect(border.top?.style).toBe("thin");
        expect(border.top?.color?.argb).toBe("FF111111");
        expect(border.right?.style).toBe("medium");
        expect(border.bottom?.style).toBe("thick");
        expect(border.left?.style).toBe("dotted");
    });

    it("skips a NONE (0) border side", async () => {
        const ws = (await roundTrip(
            singleCellWorkbook({ v: "b", s: { bd: { t: { s: 0, cl: { rgb: "#111" } }, b: { s: 1, cl: { rgb: "#222222" } } } } })
        )).worksheets[0];
        const border = ws.getCell("A1").border;
        expect(border.top).toBeUndefined();
        expect(border.bottom?.style).toBe("thin");
    });

    it("applies merges", async () => {
        const ws = (await roundTrip(
            singleCellWorkbook({ v: "merged" }, { mergeData: [{ startRow: 0, endRow: 1, startColumn: 0, endColumn: 1 }] })
        )).worksheets[0];
        expect(ws.getCell("A1").value).toBe("merged");
        expect(ws.getCell("B2").isMerged).toBe(true);
        expect(ws.getCell("B2").master.address).toBe("A1");
    });

    it("converts column width (px) and row height (px) to Excel units", async () => {
        const ws = (await roundTrip(
            singleCellWorkbook({ v: "x" }, { columnData: { "0": { w: 117 } }, rowData: { "0": { h: 40 } } })
        )).worksheets[0];
        // 117px -> (117-5)/7 = 16 chars; 40px -> 30pt.
        expect(ws.getColumn(1).width).toBeCloseTo(16, 1);
        expect(ws.getRow(1).height).toBeCloseTo(30, 1);
    });

    it("marks hidden rows and columns as hidden (data preserved)", async () => {
        const ws = (await roundTrip(
            singleCellWorkbook({ v: "x" }, { columnData: { "0": { hd: 1 } }, rowData: { "0": { hd: 1 } } })
        )).worksheets[0];
        expect(ws.getColumn(1).hidden).toBe(true);
        expect(ws.getRow(1).hidden).toBe(true);
    });

    it("reflects the showGridlines flag in the sheet view", async () => {
        const off = (await roundTrip(singleCellWorkbook({ v: "x" }, { showGridlines: 0 }))).worksheets[0];
        const on = (await roundTrip(singleCellWorkbook({ v: "x" }, { showGridlines: 1 }))).worksheets[0];
        expect(off.views[0].showGridLines).toBe(false);
        expect(on.views[0].showGridLines).toBe(true);
    });

    it("emits sheet default row height and column width", async () => {
        const ws = (await roundTrip(
            singleCellWorkbook({ v: "x" }, { defaultRowHeight: 24, defaultColumnWidth: 88 })
        )).worksheets[0];
        // 24px -> 18pt; 88px -> (88-5)/7 ≈ 11.86 chars.
        expect(ws.properties.defaultRowHeight).toBeCloseTo(18, 1);
        expect(ws.properties.defaultColWidth).toBeCloseTo(11.86, 1);
    });

    it("writes a formula with its cached result", async () => {
        const ws = (await roundTrip(singleCellWorkbook({ f: "=SUM(B1:B2)", v: 7, t: 2 }))).worksheets[0];
        const value = ws.getCell("A1").value as ExcelJS.CellFormulaValue;
        expect(value.formula).toBe("SUM(B1:B2)");
        expect(value.result).toBe(7);
    });

    it("skips hidden sheets but keeps a valid workbook", async () => {
        const json = JSON.stringify({
            version: 1,
            workbook: {
                sheetOrder: ["s1", "s2"],
                styles: {},
                sheets: {
                    s1: { id: "s1", name: "Visible", hidden: 0, mergeData: [], cellData: { "0": { "0": { v: "shown" } } }, rowData: {}, columnData: {} },
                    s2: { id: "s2", name: "Secret", hidden: 1, mergeData: [], cellData: { "0": { "0": { v: "hidden" } } }, rowData: {}, columnData: {} }
                }
            }
        });
        const wb = await roundTrip(json);
        expect(wb.worksheets.map((w) => w.name)).toEqual(["Visible"]);
    });

    it("resolves a style referenced by id", async () => {
        const ws = (await roundTrip(
            singleCellWorkbook({ v: "x", s: "bold" }, {}, { bold: { bl: 1 } })
        )).worksheets[0];
        expect(ws.getCell("A1").font.bold).toBe(true);
    });

    it("throws on unparseable JSON", async () => {
        await expect(renderSpreadsheetToXlsx("not json")).rejects.toThrow(/parse/i);
    });

    it("throws when the workbook has no sheets", async () => {
        await expect(renderSpreadsheetToXlsx(JSON.stringify({ version: 1, workbook: {} }))).rejects.toThrow(/no sheets/i);
    });

    it("emits a single empty Sheet1 when no sheets are visible", async () => {
        const json = JSON.stringify({
            version: 1,
            workbook: {
                sheetOrder: ["s1"],
                styles: {},
                sheets: {
                    s1: { id: "s1", name: "Secret", hidden: 1, mergeData: [], cellData: {}, rowData: {}, columnData: {} }
                }
            }
        });
        const wb = await roundTrip(json);
        expect(wb.worksheets.map((w) => w.name)).toEqual(["Sheet1"]);
    });

    it("renders a workbook with no styles key and a sheet omitting merge/column/row data", async () => {
        // No `styles` key on the workbook, and the sheet omits mergeData/columnData/rowData
        // entirely so the `?? {}` / `?? []` fallbacks are exercised (do not use singleCellWorkbook
        // which always sets these).
        const json = JSON.stringify({
            version: 1,
            workbook: {
                sheetOrder: ["s1"],
                sheets: {
                    s1: { id: "s1", name: "Bare", hidden: 0, cellData: { "0": { "0": { v: "x", t: 1 } } } }
                }
            }
        });
        const ws = (await roundTrip(json)).worksheets[0];
        expect(ws.name).toBe("Bare");
        expect(ws.getCell("A1").value).toBe("x");
    });

    it("skips a null cell, an empty merge/column/row set, without error", async () => {
        // cellData entry whose value is null -> writeCell must skip it (the `!cell` guard).
        const ws = (await roundTrip(
            singleCellWorkbook(null, { cellData: { "0": { "0": null, "1": { v: "kept", t: 1 } } } })
        )).worksheets[0];
        expect(ws.getCell("A1").value).toBeNull();
        expect(ws.getCell("B1").value).toBe("kept");
    });

    it("applies style to a cell with no value (non-formula)", async () => {
        // A cell `{ s: { bl: 1 } }` with no `v` and no `f`: font applied, no value written.
        const ws = (await roundTrip(singleCellWorkbook({ s: { bl: 1 } }))).worksheets[0];
        expect(ws.getCell("A1").value).toBeNull();
        expect(ws.getCell("A1").font.bold).toBe(true);
    });

    it("writes a formula with no cached result", async () => {
        // A formula cell with no `v` -> result is undefined.
        const ws = (await roundTrip(singleCellWorkbook({ f: "=A1" }))).worksheets[0];
        const value = ws.getCell("A1").value as ExcelJS.CellFormulaValue;
        expect(value.formula).toBe("A1");
        expect(value.result).toBeUndefined();
    });

    it("maps text rotation: vertical, an explicit angle, and ignores a zero angle", async () => {
        const vertical = (await roundTrip(singleCellWorkbook({ v: "x", s: { tr: { v: 1 } } }))).worksheets[0];
        expect(vertical.getCell("A1").alignment.textRotation).toBe("vertical");

        const angled = (await roundTrip(singleCellWorkbook({ v: "x", s: { tr: { a: 45 } } }))).worksheets[0];
        expect(angled.getCell("A1").alignment.textRotation).toBe(45);

        // tr present but angle is 0 -> the `!== 0` guard means no textRotation (and no alignment,
        // which exceljs reads back as undefined).
        const zero = (await roundTrip(singleCellWorkbook({ v: "x", s: { tr: { a: 0 } } }))).worksheets[0];
        expect(zero.getCell("A1").alignment).toBeUndefined();
    });

    it("maps left/center horizontal and top/bottom vertical alignment", async () => {
        const left = (await roundTrip(singleCellWorkbook({ v: "x", s: { ht: 1 } }))).worksheets[0];
        expect(left.getCell("A1").alignment.horizontal).toBe("left");

        const center = (await roundTrip(singleCellWorkbook({ v: "x", s: { ht: 2 } }))).worksheets[0];
        expect(center.getCell("A1").alignment.horizontal).toBe("center");

        const top = (await roundTrip(singleCellWorkbook({ v: "x", s: { vt: 1 } }))).worksheets[0];
        expect(top.getCell("A1").alignment.vertical).toBe("top");

        const bottom = (await roundTrip(singleCellWorkbook({ v: "x", s: { vt: 3 } }))).worksheets[0];
        expect(bottom.getCell("A1").alignment.vertical).toBe("bottom");
    });

    it("ignores unknown horizontal/vertical alignment codes", async () => {
        // Unknown ht/vt fall through to the default branch -> no alignment applied (exceljs reads
        // back as undefined).
        const ws = (await roundTrip(singleCellWorkbook({ v: "x", s: { ht: 99, vt: 99 } }))).worksheets[0];
        expect(ws.getCell("A1").alignment).toBeUndefined();
    });

    it("maps the remaining Univer border-style enum codes to exceljs styles", async () => {
        // A cell can carry only 4 border sides, so split the 9 remaining codes across cells.
        // HAIR=2, DASHED=4, DASH_DOT=5, DASH_DOT_DOT=6 / DOUBLE=7, MEDIUM_DASHED=9,
        // MEDIUM_DASH_DOT=10, MEDIUM_DASH_DOT_DOT=11 / SLANT_DASH_DOT=12.
        const first = (await roundTrip(singleCellWorkbook({
            v: "b",
            s: { bd: { t: { s: 2 }, r: { s: 4 }, b: { s: 5 }, l: { s: 6 } } }
        }))).worksheets[0];
        let border = first.getCell("A1").border;
        expect(border.top?.style).toBe("hair");
        expect(border.right?.style).toBe("dashed");
        expect(border.bottom?.style).toBe("dashDot");
        expect(border.left?.style).toBe("dashDotDot");

        const second = (await roundTrip(singleCellWorkbook({
            v: "b",
            s: { bd: { t: { s: 7 }, r: { s: 9 }, b: { s: 10 }, l: { s: 11 } } }
        }))).worksheets[0];
        border = second.getCell("A1").border;
        expect(border.top?.style).toBe("double");
        expect(border.right?.style).toBe("mediumDashed");
        expect(border.bottom?.style).toBe("mediumDashDot");
        expect(border.left?.style).toBe("mediumDashDotDot");

        const third = (await roundTrip(singleCellWorkbook({
            v: "b",
            s: { bd: { t: { s: 12 } } }
        }))).worksheets[0];
        expect(third.getCell("A1").border.top?.style).toBe("slantDashDot");
    });

    it("falls back to FF000000 for a border side with a style but no color", async () => {
        const ws = (await roundTrip(singleCellWorkbook({ v: "b", s: { bd: { b: { s: 1 } } } }))).worksheets[0];
        expect(ws.getCell("A1").border.bottom?.style).toBe("thin");
        expect(ws.getCell("A1").border.bottom?.color?.argb).toBe("FF000000");
    });

    it("applies no border when the only side is NONE", async () => {
        // buildBorder returns null because every side resolves to no style -> exceljs reads back
        // the whole border as undefined.
        const ws = (await roundTrip(singleCellWorkbook({ v: "b", s: { bd: { t: { s: 0 } } } }))).worksheets[0];
        expect(ws.getCell("A1").border).toBeUndefined();
    });

    it("passes an 8-digit AARRGGBB color through verbatim", async () => {
        const ws = (await roundTrip(singleCellWorkbook({ v: "x", s: { cl: { rgb: "#11223344" } } }))).worksheets[0];
        expect(ws.getCell("A1").font.color?.argb).toBe("11223344");
    });

    it("applies no color for an invalid rgb (font and border)", async () => {
        // Invalid rgb -> toArgb returns null: no font color; border side with a style but an
        // invalid color falls back to FF000000.
        const ws = (await roundTrip(singleCellWorkbook({
            v: "x",
            s: { bl: 1, cl: { rgb: "notacolor" }, bd: { b: { s: 1, cl: { rgb: "#zzz" } } } }
        }))).worksheets[0];
        const cell = ws.getCell("A1");
        // Font still applied (bold), but no color attached.
        expect(cell.font.bold).toBe(true);
        expect(cell.font.color).toBeUndefined();
        // No fill written -> exceljs reads back the default "none" pattern fill.
        expect((cell.fill as ExcelJS.FillPattern)?.pattern).toBe("none");
        // Border keeps the style with the fallback color.
        expect(cell.border.bottom?.style).toBe("thin");
        expect(cell.border.bottom?.color?.argb).toBe("FF000000");
    });

    describe("output is a valid xlsx", () => {
        let buffer: ExcelJS.Buffer;
        beforeAll(async () => {
            buffer = await renderSpreadsheetToXlsx(singleCellWorkbook({ v: "x" }));
        });
        it("starts with the ZIP magic bytes (PK)", () => {
            const bytes = new Uint8Array(buffer as ArrayBuffer);
            expect(bytes[0]).toBe(0x50); // 'P'
            expect(bytes[1]).toBe(0x4b); // 'K'
        });
    });

    describe("images", () => {
        // 1x1 transparent PNG.
        const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
        const resolveAsPng: NonNullable<Parameters<typeof renderSpreadsheetToXlsx>[1]>["resolveImage"] =
            async (source) => (source ? { base64: PNG, extension: "png" } : null);

        function floatingImageWorkbook(drawing: Record<string, unknown> & { drawingId: string }): string {
            const sheetId = "s1";
            return JSON.stringify({
                version: 1,
                workbook: {
                    sheetOrder: [sheetId],
                    styles: {},
                    sheets: {
                        [sheetId]: {
                            id: sheetId,
                            name: "Sheet1",
                            hidden: 0,
                            defaultColumnWidth: 88,
                            defaultRowHeight: 24,
                            mergeData: [],
                            cellData: { "0": { "0": { v: "x" } } },
                            rowData: {},
                            columnData: {}
                        }
                    },
                    resources: [
                        { name: "SHEET_DRAWING_PLUGIN", data: JSON.stringify({ [sheetId]: { data: { [drawing.drawingId]: drawing }, order: [drawing.drawingId] } }) }
                    ]
                }
            });
        }

        async function load(buffer: ExcelJS.Buffer): Promise<ExcelJS.Workbook> {
            const wb = new ExcelJS.Workbook();
            await wb.xlsx.load(buffer as ArrayBuffer);
            return wb;
        }

        it("embeds a floating image with a two-cell anchor from its from/to cells", async () => {
            const buffer = await renderSpreadsheetToXlsx(
                floatingImageWorkbook({
                    drawingId: "img1",
                    imageSourceType: "URL",
                    source: "api/attachments/cgN4jEBCA1Kn/image/image.png",
                    sheetTransform: {
                        from: { row: 4, rowOffset: 12, column: 1, columnOffset: 44 },
                        to: { row: 8, rowOffset: 0, column: 3, columnOffset: 0 }
                    }
                }),
                { resolveImage: resolveAsPng }
            );
            const wb = await load(buffer);
            const images = wb.getWorksheet("Sheet1")?.getImages() ?? [];
            expect(images.length).toBe(1);
            const range = images[0].range;
            // column 1 + 44/88 = 1.5; row 4 + 12/24 = 4.5; to-corner has no offsets.
            expect(range.tl.col).toBeCloseTo(1.5);
            expect(range.tl.row).toBeCloseTo(4.5);
            expect(range.br?.col).toBeCloseTo(3);
            expect(range.br?.row).toBeCloseTo(8);
            expect(wb.model.media[0]?.extension).toBe("png");
        });

        it("embeds a cell image anchored to its cell at the drawing size", async () => {
            const buffer = await renderSpreadsheetToXlsx(
                singleCellWorkbook({
                    p: {
                        drawings: {
                            d1: { drawingId: "d1", source: "api/attachments/BBBBBBBBBBBB/image/y.png", transform: { width: 120, height: 90 } }
                        },
                        drawingsOrder: ["d1"]
                    }
                }),
                { resolveImage: resolveAsPng }
            );
            const wb = await load(buffer);
            const images = wb.worksheets[0].getImages();
            expect(images.length).toBe(1);
            const range = images[0].range;
            expect(range.tl.col).toBeCloseTo(0);
            expect(range.tl.row).toBeCloseTo(0);
            const ext = (range as unknown as { ext?: { width: number; height: number } }).ext;
            expect(ext?.width).toBe(120);
            expect(ext?.height).toBe(90);
        });

        it("embeds no images when no resolver is provided", async () => {
            const wb = await load(await renderSpreadsheetToXlsx(
                floatingImageWorkbook({
                    drawingId: "img1",
                    source: "api/attachments/cgN4jEBCA1Kn/image/image.png",
                    sheetTransform: { from: { row: 0, column: 0 }, to: { row: 2, column: 2 } }
                })
            ));
            expect(wb.getWorksheet("Sheet1")?.getImages().length).toBe(0);
        });

        it("skips an image the resolver returns null for", async () => {
            const wb = await load(await renderSpreadsheetToXlsx(
                floatingImageWorkbook({
                    drawingId: "img1",
                    source: "api/attachments/cgN4jEBCA1Kn/image/image.png",
                    sheetTransform: { from: { row: 0, column: 0 }, to: { row: 2, column: 2 } }
                }),
                { resolveImage: async () => null }
            ));
            expect(wb.getWorksheet("Sheet1")?.getImages().length).toBe(0);
        });

        it("skips a floating drawing that has no from/to anchor", async () => {
            const wb = await load(await renderSpreadsheetToXlsx(
                floatingImageWorkbook({
                    drawingId: "img1",
                    source: "api/attachments/cgN4jEBCA1Kn/image/image.png",
                    transform: { left: 10, top: 10, width: 50, height: 50 }
                }),
                { resolveImage: resolveAsPng }
            ));
            expect(wb.getWorksheet("Sheet1")?.getImages().length).toBe(0);
        });
    });
});

describe("uniqueSheetName", () => {
    it("sanitises illegal characters, apostrophes, over-long and empty/reserved names", () => {
        // Excel/exceljs reject \ / ? * : [ ] -> replace with underscore.
        expect(uniqueSheetName("Sheet/1", new Set())).toBe("Sheet_1");
        expect(uniqueSheetName("a:b*c?", new Set())).toBe("a_b_c_");
        expect(uniqueSheetName("[ledger]\\", new Set())).toBe("_ledger__");
        // A leading/trailing single quote is rejected.
        expect(uniqueSheetName("'quoted'", new Set())).toBe("_quoted_");
        // 31-char cap.
        expect(uniqueSheetName("A".repeat(40), new Set())).toBe("A".repeat(31));
        // Empty/whitespace falls back to a default; "History" is reserved (case-insensitive).
        expect(uniqueSheetName("", new Set())).toBe("Sheet");
        expect(uniqueSheetName("   ", new Set())).toBe("Sheet");
        expect(uniqueSheetName("History", new Set())).toBe("History_");
        expect(uniqueSheetName("history", new Set())).toBe("history_");
        // An undefined name exercises the `name ?? ""` fallback in sanitizeSheetName.
        expect(uniqueSheetName(undefined, new Set())).toBe("Sheet");
    });

    it("de-duplicates case-insensitively, keeping names within the 31-char limit", () => {
        const used = new Set<string>();
        expect(uniqueSheetName("Data", used)).toBe("Data");
        expect(uniqueSheetName("data", used)).toBe("data (2)");
        expect(uniqueSheetName("DATA", used)).toBe("DATA (3)");

        const long = new Set<string>();
        expect(uniqueSheetName("A".repeat(40), long)).toBe("A".repeat(31));
        const second = uniqueSheetName("A".repeat(40), long);
        expect(second).toHaveLength(31);
        expect(second.endsWith(" (2)")).toBe(true);
    });
});

describe("renderSpreadsheetToXlsx sheet-name safety", () => {
    it("writes hostile sheet names as legal, unique, readable sheets without throwing", async () => {
        const json = workbookWithSheetNames(["Sheet/1", "History", "'Sales'", "A".repeat(40)]);
        const wb = await roundTrip(json);
        expect(wb.worksheets.map((ws) => ws.name)).toEqual(["Sheet_1", "History_", "_Sales_", "A".repeat(31)]);
    });

    it("de-duplicates colliding sheet names case-insensitively", async () => {
        const json = workbookWithSheetNames(["Data", "data", "DATA"]);
        const wb = await roundTrip(json);
        expect(wb.worksheets.map((ws) => ws.name)).toEqual(["Data", "data (2)", "DATA (3)"]);
    });
});

/** Build a workbook payload whose visible sheets carry the given (possibly hostile) names. */
function workbookWithSheetNames(names: string[]): string {
    const sheets: Record<string, unknown> = {};
    const sheetOrder: string[] = [];
    names.forEach((name, i) => {
        const id = `s${i}`;
        sheetOrder.push(id);
        sheets[id] = {
            id,
            name,
            hidden: 0,
            mergeData: [],
            cellData: { "0": { "0": { v: `cell-${i}`, t: 1 } } },
            rowData: {},
            columnData: {}
        };
    });
    return JSON.stringify({ version: 1, workbook: { sheetOrder, styles: {}, sheets } });
}
