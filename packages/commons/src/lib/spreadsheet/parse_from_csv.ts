/**
 * Parses CSV text into a UniversJS workbook JSON structure — the inverse of `render_to_csv`.
 * The result matches the `PersistedData` shape a spreadsheet note stores, so the output can be
 * stringified straight into note content (same as `parse_from_xlsx`).
 *
 * CSV carries only values, so the workbook is a single unstyled sheet. Field parsing follows
 * RFC 4180 (quoted fields, doubled quotes, embedded commas/newlines); records may end in CRLF,
 * LF or CR. A leading UTF-8 BOM (which our own exporter writes for Excel) is stripped.
 *
 * Values are inferred conservatively: `TRUE`/`FALSE` become booleans, and a field becomes a
 * number only when it round-trips exactly (so `007`, `1,000`, `+1`, `1e3` and the like stay
 * text rather than being silently mangled). Everything else — including dates, which CSV has
 * no type for — stays a string.
 */

import { parseCsv } from "../csv.js";
import {
    CellValueType,
    type ICellData,
    type IWorksheetData,
    type PersistedData
} from "./workbook_model.js";

/** Univer's default grid size for a fresh sheet; the imported sheet is grown to fit its data. */
const DEFAULT_ROW_COUNT = 1000;
const DEFAULT_COLUMN_COUNT = 20;

const SHEET_ID = "sheet-0";

/** Parses CSV text and produces a single-sheet UniversJS workbook. */
export function parseCsvToWorkbook(csvText: string): PersistedData {
    const rows = parseCsv(csvText);
    const cellData = buildCellData(rows);
    const maxColumns = rows.reduce((max, row) => Math.max(max, row.length), 0);

    const sheet: IWorksheetData = {
        id: SHEET_ID,
        name: "Sheet1",
        cellData,
        // Grow the grid past Univer's defaults when the data needs it, so nothing is clipped.
        rowCount: Math.max(DEFAULT_ROW_COUNT, rows.length),
        columnCount: Math.max(DEFAULT_COLUMN_COUNT, maxColumns)
    };

    return {
        version: 1,
        workbook: {
            sheetOrder: [SHEET_ID],
            styles: {},
            sheets: { [SHEET_ID]: sheet }
        }
    };
}

function buildCellData(rows: string[][]): Record<number, Record<number, ICellData>> {
    const cellData: Record<number, Record<number, ICellData>> = {};

    rows.forEach((row, r) => {
        row.forEach((value, c) => {
            const cell = toCell(value);
            if (cell) (cellData[r] ??= {})[c] = cell;
        });
    });

    return cellData;
}

/** Infers a typed cell from a raw field, or `null` for an empty field (no cell emitted). */
function toCell(value: string): ICellData | null {
    if (value === "") return null;

    if (value === "TRUE") return { v: true, t: CellValueType.BOOLEAN };
    if (value === "FALSE") return { v: false, t: CellValueType.BOOLEAN };

    // Treat as a number only when the canonical form is byte-identical, so values that merely
    // look numeric (leading zeros, thousands separators, exponents, signs) keep their text.
    const num = Number(value);
    if (Number.isFinite(num) && String(num) === value) {
        return { v: num, t: CellValueType.NUMBER };
    }

    return { v: value, t: CellValueType.STRING };
}
