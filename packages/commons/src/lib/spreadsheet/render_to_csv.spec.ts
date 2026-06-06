import JSZip from "jszip";
import { afterEach, describe, expect, it, vi } from "vitest";

import { formatDate, renderSpreadsheetToCsv, renderSpreadsheetToCsvZip } from "./render_to_csv.js";

/** A sheet definition for {@link multiSheetWorkbook}. */
interface SheetSpec {
    id: string;
    name: string;
    hidden?: number;
    cellData: Record<number, Record<number, unknown>>;
}

/** Build a workbook payload from several sheets, preserving their order. */
function multiSheetWorkbook(sheets: SheetSpec[]): string {
    return JSON.stringify({
        version: 1,
        workbook: {
            sheetOrder: sheets.map((s) => s.id),
            styles: {},
            sheets: Object.fromEntries(sheets.map((s) => [s.id, { mergeData: [], rowData: {}, columnData: {}, ...s }]))
        }
    });
}

/** Render a zip and read its entries back as `{ name: csvContent }`, BOM stripped. */
async function readZip(buffer: Uint8Array): Promise<Record<string, string>> {
    const zip = await JSZip.loadAsync(buffer);
    const entries: Record<string, string> = {};
    for (const name of Object.keys(zip.files)) {
        const content = await zip.files[name].async("string");
        entries[name] = content.replace(/^\uFEFF/, "");
    }
    return entries;
}

/** Build a workbook payload from a sparse cell matrix (keyed by row, then column). */
function workbook(
    cellData: Record<number, Record<number, unknown>>,
    sheetExtra: Record<string, unknown> = {},
    workbookExtra: Record<string, unknown> = {}
): string {
    return JSON.stringify({
        version: 1,
        workbook: {
            sheetOrder: ["s1"],
            styles: {},
            sheets: {
                s1: {
                    id: "s1",
                    name: "Sheet1",
                    hidden: 0,
                    mergeData: [],
                    cellData,
                    rowData: {},
                    columnData: {},
                    ...sheetExtra
                }
            },
            ...workbookExtra
        }
    });
}

describe("renderSpreadsheetToCsv", () => {
    it("lays cells out as a dense rectangle, filling gaps with empty fields", () => {
        const csv = renderSpreadsheetToCsv(workbook({
            0: { 0: { v: "a" }, 2: { v: "c" } },
            1: { 1: { v: "b" } }
        }));
        // Bounds span rows 0-1, cols 0-2; missing cells become empty fields.
        expect(csv).toBe("a,,c\r\n,b,");
    });

    it("offsets the grid to the populated bounds (no leading empty rows/cols)", () => {
        const csv = renderSpreadsheetToCsv(workbook({
            2: { 3: { v: "x" }, 4: { v: "y" } }
        }));
        expect(csv).toBe("x,y");
    });

    it("renders numbers and booleans as raw values", () => {
        const csv = renderSpreadsheetToCsv(workbook({
            0: { 0: { v: 42, t: 2 }, 1: { v: true, t: 3 }, 2: { v: false, t: 3 } }
        }));
        expect(csv).toBe("42,TRUE,FALSE");
    });

    it("exports a formula cell's cached result, not the formula", () => {
        const csv = renderSpreadsheetToCsv(workbook({
            0: { 0: { f: "=1+2", v: 3 } }
        }));
        expect(csv).toBe("3");
    });

    it("renders date serials as ISO 8601 (yyyy-mm-dd), not the raw serial", () => {
        // 46118 is 2026-04-06 in Excel's serial date system.
        const inlineStyle = renderSpreadsheetToCsv(workbook({
            0: { 0: { v: 46118, t: 2, s: { n: { pattern: "m/d/yy" } } } }
        }));
        expect(inlineStyle).toBe("2026-04-06");

        // A date pattern referenced from the shared styles table resolves the same way.
        const sharedStyle = renderSpreadsheetToCsv(workbook(
            { 0: { 0: { v: 46118, t: 2, s: "d1" } } },
            {},
            { styles: { d1: { n: { pattern: "dd/mm/yyyy" } } } }
        ));
        expect(sharedStyle).toBe("2026-04-06");
    });

    it("appends the time portion when the date format carries one", () => {
        const csv = renderSpreadsheetToCsv(workbook({
            0: {
                0: { v: 46118.5, t: 2, s: { n: { pattern: "yyyy-mm-dd hh:mm" } } },
                1: { v: 46118.5, t: 2, s: { n: { pattern: "m/d/yy h:mm:ss" } } }
            }
        }));
        expect(csv).toBe("2026-04-06 12:00,2026-04-06 12:00:00");
    });

    it("falls back to the cell's own pattern for partial date formats (not full y/m/d)", () => {
        // Month-year / year-only patterns are date formats but lack a day component, so they
        // fall through to formatNumfmt(pattern, serial) rather than the ISO yyyy-mm-dd path.
        const csv = renderSpreadsheetToCsv(workbook({
            0: {
                0: { v: 46118.5, t: 2, s: { n: { pattern: "mmm yyyy" } } },
                1: { v: 46118.5, t: 2, s: { n: { pattern: "mmm-yy" } } },
                2: { v: 46118.5, t: 2, s: { n: { pattern: "yyyy" } } }
            }
        }));
        expect(csv).toBe("Apr 2026,Apr-26,2026");
    });

    it("keeps a non-date numeric cell raw even when it has a number format", () => {
        const csv = renderSpreadsheetToCsv(workbook({
            0: { 0: { v: 1234.5, t: 2, s: { n: { pattern: "#,##0.00" } } } }
        }));
        expect(csv).toBe("1234.5");
    });

    it("quotes fields containing commas, quotes, or newlines (RFC 4180)", () => {
        const csv = renderSpreadsheetToCsv(workbook({
            0: { 0: { v: "a,b" }, 1: { v: 'he said "hi"' }, 2: { v: "line1\nline2" } }
        }));
        expect(csv).toBe('"a,b","he said ""hi""","line1\nline2"');
    });

    it("treats empty and null cell values as empty fields", () => {
        const csv = renderSpreadsheetToCsv(workbook({
            0: { 0: { v: "" }, 1: { v: null }, 2: { v: "z" } }
        }));
        expect(csv).toBe(",,z");
    });

    it("exports the first visible sheet by default and the requested sheet by id", () => {
        const json = JSON.stringify({
            version: 1,
            workbook: {
                sheetOrder: ["s1", "s2"],
                styles: {},
                sheets: {
                    s1: { id: "s1", name: "First", hidden: 0, cellData: { 0: { 0: { v: "one" } } } },
                    s2: { id: "s2", name: "Second", hidden: 0, cellData: { 0: { 0: { v: "two" } } } }
                }
            }
        });
        expect(renderSpreadsheetToCsv(json)).toBe("one");
        expect(renderSpreadsheetToCsv(json, { sheetId: "s2" })).toBe("two");
        // Unknown id falls back to the first visible sheet.
        expect(renderSpreadsheetToCsv(json, { sheetId: "nope" })).toBe("one");
    });

    it("skips hidden sheets when choosing the default", () => {
        const json = JSON.stringify({
            version: 1,
            workbook: {
                sheetOrder: ["s1", "s2"],
                styles: {},
                sheets: {
                    s1: { id: "s1", name: "Hidden", hidden: 1, cellData: { 0: { 0: { v: "hidden" } } } },
                    s2: { id: "s2", name: "Visible", hidden: 0, cellData: { 0: { 0: { v: "visible" } } } }
                }
            }
        });
        expect(renderSpreadsheetToCsv(json)).toBe("visible");
    });

    it("returns an empty string for an empty sheet or a workbook with no visible sheets", () => {
        expect(renderSpreadsheetToCsv(workbook({}))).toBe("");

        const allHidden = JSON.stringify({
            version: 1,
            workbook: {
                sheetOrder: ["s1"],
                sheets: { s1: { id: "s1", name: "H", hidden: 1, cellData: {} } }
            }
        });
        expect(renderSpreadsheetToCsv(allHidden)).toBe("");
    });

    it("renders cell values when the workbook has no styles table", () => {
        // The `workbook` helper always sets `styles`, so build a literal without that key to
        // exercise the `workbook.styles ?? {}` fallback.
        const noStyles = JSON.stringify({
            version: 1,
            workbook: {
                sheetOrder: ["s1"],
                sheets: {
                    s1: { id: "s1", name: "Sheet1", hidden: 0, cellData: { 0: { 0: { v: "a" }, 1: { v: "b" } } } }
                }
            }
        });
        expect(renderSpreadsheetToCsv(noStyles)).toBe("a,b");
    });

    it("throws on unparseable JSON and on a workbook with no sheets", () => {
        expect(() => renderSpreadsheetToCsv("not json")).toThrow(/parse/i);
        expect(() => renderSpreadsheetToCsv(JSON.stringify({ version: 1 }))).toThrow(/no sheets/i);
    });
});

describe("renderSpreadsheetToCsvZip", () => {
    it("emits one BOM-prefixed CSV per visible sheet, named after the sheet", async () => {
        const buffer = await renderSpreadsheetToCsvZip(multiSheetWorkbook([
            { id: "s1", name: "Budget", cellData: { 0: { 0: { v: "a" }, 1: { v: 1 } } } },
            { id: "s2", name: "Notes", cellData: { 0: { 0: { v: "hello" } } } }
        ]));

        const entries = await readZip(buffer);
        expect(Object.keys(entries).sort()).toEqual(["Budget.csv", "Notes.csv"]);
        expect(entries["Budget.csv"]).toBe("a,1");
        expect(entries["Notes.csv"]).toBe("hello");

        // Each entry must keep its UTF-8 BOM (readZip strips it before returning).
        const zip = await JSZip.loadAsync(buffer);
        expect(await zip.files["Budget.csv"].async("string")).toMatch(/^\uFEFF/);
    });

    it("skips hidden sheets", async () => {
        const entries = await readZip(await renderSpreadsheetToCsvZip(multiSheetWorkbook([
            { id: "s1", name: "Visible", cellData: { 0: { 0: { v: "x" } } } },
            { id: "s2", name: "Secret", hidden: 1, cellData: { 0: { 0: { v: "y" } } } }
        ])));
        expect(Object.keys(entries)).toEqual(["Visible.csv"]);
    });

    it("sanitizes illegal filename characters in sheet names", async () => {
        const entries = await readZip(await renderSpreadsheetToCsvZip(multiSheetWorkbook([
            { id: "s1", name: "2026/Q1: a*b?", cellData: { 0: { 0: { v: "v" } } } }
        ])));
        expect(Object.keys(entries)).toEqual(["2026_Q1_ a_b_.csv"]);
    });

    it("de-duplicates colliding sheet names (case-insensitively)", async () => {
        const entries = await readZip(await renderSpreadsheetToCsvZip(multiSheetWorkbook([
            { id: "s1", name: "Sheet", cellData: { 0: { 0: { v: 1 } } } },
            { id: "s2", name: "sheet", cellData: { 0: { 0: { v: 2 } } } },
            { id: "s3", name: "", cellData: { 0: { 0: { v: 3 } } } }
        ])));
        // Each base keeps its own casing; collisions are detected case-insensitively, so "sheet"
        // and the blank name (which falls back to "Sheet") get numbered suffixes.
        expect(Object.keys(entries).sort()).toEqual(["Sheet (3).csv", "Sheet.csv", "sheet (2).csv"]);
    });

    it("renders cell values when the workbook has no styles table", async () => {
        // `multiSheetWorkbook` always sets `styles`, so build a literal without that key to
        // exercise the `workbook.styles ?? {}` fallback in the zip path.
        const noStyles = JSON.stringify({
            version: 1,
            workbook: {
                sheetOrder: ["s1"],
                sheets: {
                    s1: { id: "s1", name: "Data", hidden: 0, cellData: { 0: { 0: { v: "a" }, 1: { v: "b" } } } }
                }
            }
        });
        const entries = await readZip(await renderSpreadsheetToCsvZip(noStyles));
        expect(entries["Data.csv"]).toBe("a,b");
    });

    it("falls back to 'Sheet.csv' when a sheet has no name", async () => {
        // A visible sheet whose `name` is omitted (undefined) exercises the `sheetName ?? ""`
        // nullish fallback, which then resolves to "Sheet".
        const noName = JSON.stringify({
            version: 1,
            workbook: {
                sheetOrder: ["s1"],
                sheets: {
                    s1: { id: "s1", hidden: 0, cellData: { 0: { 0: { v: "x" } } } }
                }
            }
        });
        const entries = await readZip(await renderSpreadsheetToCsvZip(noName));
        expect(Object.keys(entries)).toEqual(["Sheet.csv"]);
        expect(entries["Sheet.csv"]).toBe("x");
    });

    it("throws on unparseable JSON and on a workbook with no sheets", async () => {
        await expect(renderSpreadsheetToCsvZip("not json")).rejects.toThrow(/parse/i);
        await expect(renderSpreadsheetToCsvZip(JSON.stringify({ version: 1 }))).rejects.toThrow(/no sheets/i);
    });
});

describe("formatDate", () => {
    it("renders a full y/m/d date as ISO 8601, partial formats via their own pattern", () => {
        // 46118 is 2026-04-06 in Excel's serial date system.
        expect(formatDate("yyyy-mm-dd", 46118)).toBe("2026-04-06");
        // A partial (month-year) date format falls through to formatNumfmt(pattern, serial).
        expect(formatDate("mmm yyyy", 46118)).toBe("Apr 2026");
    });

    it("returns null when the formatter throws", () => {
        // getFormatDateInfo("General;General;General;yyyy") reports no date parts (so the ISO
        // branch is skipped), then format() throws on the partition syntax, hitting the catch.
        expect(formatDate("General;General;General;yyyy", 46118.5)).toBeNull();
    });
});

describe("renderSpreadsheetToCsv (formatDate returns null)", () => {
    afterEach(() => {
        vi.resetModules();
        vi.doUnmock("numfmt");
    });

    it("falls back to the raw value when a date cell can't be formatted", async () => {
        // No public, real numfmt pattern makes isDateFormat() true yet formatDate() return null,
        // so the only way to exercise cellText's `formatted == null` fallback is to mock numfmt:
        // isDateFormat -> true (enters the date branch) and format -> throws (formatDate returns
        // null), leaving cellText to emit String(cell.v) — the raw serial.
        vi.resetModules();
        vi.doMock("numfmt", () => ({
            isDateFormat: () => true,
            getFormatDateInfo: () => ({ year: true, month: false, day: false }),
            format: () => {
                throw new Error("boom");
            }
        }));

        const { renderSpreadsheetToCsv: render } = await import("./render_to_csv.js");
        const csv = render(workbook({
            0: { 0: { v: 46118, t: 2, s: { n: { pattern: "yyyy-mm-dd" } } } }
        }));
        expect(csv).toBe("46118");
    });
});
