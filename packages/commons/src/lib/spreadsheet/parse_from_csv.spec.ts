import { describe, expect, it } from "vitest";

import { parseCsvToWorkbook } from "./parse_from_csv.js";
import { CellValueType, type ICellData, type IWorksheetData } from "./workbook_model.js";

/** Parse CSV and return the single sheet. */
function sheet(csv: string): IWorksheetData {
    const { workbook } = parseCsvToWorkbook(csv);
    return workbook.sheets[workbook.sheetOrder[0]];
}

/** The cell at (row, col), or undefined when no cell was emitted. */
function cell(ws: IWorksheetData, row: number, col: number): ICellData | undefined {
    return ws.cellData[row]?.[col];
}

describe("parseCsvToWorkbook", () => {
    it("produces a single sheet laid out by row and column", () => {
        const ws = sheet("a,b,c\r\nd,e,f");
        expect(workbookShape("a,b,c\r\nd,e,f")).toEqual([
            ["a", "b", "c"],
            ["d", "e", "f"]
        ]);
        expect(ws.id).toBe("sheet-0");
        // Grid grows to at least Univer's defaults.
        expect(ws.rowCount).toBe(1000);
        expect(ws.columnCount).toBe(20);
    });

    it("accepts LF, CRLF and CR record terminators", () => {
        expect(workbookShape("a,b\nc,d")).toEqual([["a", "b"], ["c", "d"]]);
        expect(workbookShape("a,b\r\nc,d")).toEqual([["a", "b"], ["c", "d"]]);
        expect(workbookShape("a,b\rc,d")).toEqual([["a", "b"], ["c", "d"]]);
    });

    it("infers numbers and booleans, leaving other text alone", () => {
        const ws = sheet("42,1234.5,-5,TRUE,FALSE,hello");
        expect(cell(ws, 0, 0)).toEqual({ v: 42, t: CellValueType.NUMBER });
        expect(cell(ws, 0, 1)).toEqual({ v: 1234.5, t: CellValueType.NUMBER });
        expect(cell(ws, 0, 2)).toEqual({ v: -5, t: CellValueType.NUMBER });
        expect(cell(ws, 0, 3)).toEqual({ v: true, t: CellValueType.BOOLEAN });
        expect(cell(ws, 0, 4)).toEqual({ v: false, t: CellValueType.BOOLEAN });
        expect(cell(ws, 0, 5)).toEqual({ v: "hello", t: CellValueType.STRING });
    });

    it("keeps numeric-looking text that would not round-trip as a string", () => {
        const ws = sheet("007,1e3,+1,1.0,2026-04-06");
        expect(cell(ws, 0, 0)).toEqual({ v: "007", t: CellValueType.STRING });
        expect(cell(ws, 0, 1)).toEqual({ v: "1e3", t: CellValueType.STRING });
        expect(cell(ws, 0, 2)).toEqual({ v: "+1", t: CellValueType.STRING });
        expect(cell(ws, 0, 3)).toEqual({ v: "1.0", t: CellValueType.STRING });
        // Dates have no CSV type, so they stay text.
        expect(cell(ws, 0, 4)).toEqual({ v: "2026-04-06", t: CellValueType.STRING });
    });

    it("unquotes RFC 4180 fields (doubled quotes, embedded commas and newlines)", () => {
        const ws = sheet('"a,b","he said ""hi""","line1\nline2"');
        expect(cell(ws, 0, 0)?.v).toBe("a,b");
        expect(cell(ws, 0, 1)?.v).toBe('he said "hi"');
        expect(cell(ws, 0, 2)?.v).toBe("line1\nline2");
    });

    it("emits no cell for an empty field but keeps surrounding ones", () => {
        const ws = sheet("a,,c");
        expect(cell(ws, 0, 0)?.v).toBe("a");
        expect(cell(ws, 0, 1)).toBeUndefined();
        expect(cell(ws, 0, 2)?.v).toBe("c");
    });

    it("ignores a single trailing newline but preserves interior blank rows", () => {
        expect(workbookShape("a\n")).toEqual([["a"]]);
        // A blank middle line is a real (empty) record between two populated rows.
        const ws = sheet("a\n\nb");
        expect(cell(ws, 0, 0)?.v).toBe("a");
        expect(cell(ws, 1, 0)).toBeUndefined();
        expect(cell(ws, 2, 0)?.v).toBe("b");
    });

    it("strips a leading UTF-8 BOM (as written by the exporter)", () => {
        const ws = sheet("﻿name,age");
        expect(cell(ws, 0, 0)?.v).toBe("name");
    });

    it("returns an empty sheet for empty input", () => {
        const ws = sheet("");
        expect(ws.cellData).toEqual({});
    });
});

/** Reduce the parsed workbook back to a plain matrix of cell values for shape assertions. */
function workbookShape(csv: string): unknown[][] {
    const ws = sheet(csv);
    const rows = Object.keys(ws.cellData).map(Number).sort((a, b) => a - b);
    return rows.map((r) => {
        const cols = Object.keys(ws.cellData[r]).map(Number).sort((a, b) => a - b);
        return cols.map((c) => ws.cellData[r][c].v);
    });
}
