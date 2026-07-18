/**
 * Converts a UniversJS workbook JSON structure into a CSV file (RFC 4180).
 *
 * CSV is a flat, single-sheet, value-only format: it carries no styling, merges, or
 * formulas. So this emitter throws away everything the HTML/XLSX emitters preserve and
 * keeps only the cell values, laid out as a dense rectangle over the sheet's populated
 * bounds. Formula cells export their cached result (Univer stores it in `v`); most numbers
 * export their raw underlying value rather than the formatted display string, which is what
 * downstream CSV consumers expect.
 *
 * Dates are the exception: Univer stores them as serial numbers (e.g. `46118`), which no
 * CSV consumer recognizes as a date. So date-formatted cells are emitted as ISO 8601
 * (`yyyy-mm-dd`, plus time when the format carries it) — unambiguous and parsed by Excel,
 * LibreOffice, etc. — rather than the locale-specific display string or the raw serial.
 *
 * Because CSV holds a single sheet, the caller picks which one via `sheetId` (e.g. the
 * active sheet in the editor); absent that, the first visible sheet is used. To export a
 * multi-sheet workbook without losing data, `renderSpreadsheetToCsvZip` emits one CSV per
 * visible sheet bundled into a `.zip`.
 */

import { format as formatNumfmt, getFormatDateInfo, isDateFormat } from "numfmt";

import {
    computeBounds,
    getVisibleSheets,
    type ICellData,
    isFiniteNumber,
    type IStyleData,
    type IWorkbookData,
    type IWorksheetData,
    parseWorkbookData,
    resolveCellStyle
} from "./workbook_model.js";

// Prepended to each emitted CSV so Excel auto-detects UTF-8 (it only does so with a BOM).
const UTF8_BOM = "\uFEFF";

export interface CsvRenderOptions {
    /** Id of the sheet to export. Falls back to the first visible sheet when omitted or not found. */
    sheetId?: string;
}

/**
 * Parses the raw JSON content of a spreadsheet note and renders a single sheet as CSV.
 * Hidden rows and columns are still exported (their data is part of the sheet). Returns
 * an empty string for an empty sheet. Throws if the content is not a parseable workbook.
 *
 * Note: the returned string has no UTF-8 BOM, so callers downloading it for Excel should
 * prepend one (the zip variant below does this per entry).
 */
export function renderSpreadsheetToCsv(jsonContent: string, options: CsvRenderOptions = {}): string {
    const workbook = readWorkbook(jsonContent);
    const visibleSheets = getVisibleSheets(workbook);
    if (visibleSheets.length === 0) {
        return "";
    }

    const sheet = pickSheet(visibleSheets, options.sheetId);
    return renderSheet(sheet, workbook.styles ?? {});
}

/**
 * Renders every visible sheet to its own CSV and bundles them into a `.zip`, returned as a
 * binary buffer. Each entry is named after its sheet (sanitized and de-duplicated) with a
 * UTF-8 BOM. Use this for multi-sheet workbooks, where the single-sheet renderer would
 * silently drop every sheet but one. Throws if the content is not a parseable workbook.
 */
export async function renderSpreadsheetToCsvZip(jsonContent: string): Promise<Uint8Array> {
    const workbook = readWorkbook(jsonContent);
    const styles = workbook.styles ?? {};

    // Dynamic import keeps jszip out of the main bundle (and out of standalone/core).
    const { default: JSZip } = await import("jszip");
    const zip = new JSZip();

    const usedNames = new Set<string>();
    for (const sheet of getVisibleSheets(workbook)) {
        const fileName = uniqueFileName(sheet.name, usedNames);
        zip.file(fileName, UTF8_BOM + renderSheet(sheet, styles));
    }

    return zip.generateAsync({ type: "uint8array" });
}

/** Parses and validates workbook JSON, throwing on unparseable content or a missing workbook. */
function readWorkbook(jsonContent: string): IWorkbookData {
    const { ok, data } = parseWorkbookData(jsonContent);
    if (!ok) {
        throw new Error("Unable to parse spreadsheet data.");
    }
    if (!data?.workbook?.sheets) {
        throw new Error("Spreadsheet contains no sheets.");
    }
    return data.workbook;
}

function pickSheet(visibleSheets: IWorksheetData[], sheetId: string | undefined): IWorksheetData {
    if (sheetId) {
        const match = visibleSheets.find((s) => s.id === sheetId);
        if (match) return match;
    }
    return visibleSheets[0];
}

/**
 * Turns a sheet name into a safe, unique `<name>.csv` zip entry: illegal filename characters
 * (path separators, `:*?"<>|`, control codes) become `_`, blank names fall back to "Sheet",
 * and collisions get a ` (n)` suffix. De-duplication is case-insensitive so the archive
 * unzips cleanly on case-insensitive filesystems (Windows, macOS).
 */
function uniqueFileName(sheetName: string, usedNames: Set<string>): string {
    const base = (sheetName ?? "").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim() || "Sheet";

    let candidate = base;
    for (let n = 2; usedNames.has(candidate.toLowerCase()); n++) {
        candidate = `${base} (${n})`;
    }
    usedNames.add(candidate.toLowerCase());

    return `${candidate}.csv`;
}

function renderSheet(sheet: IWorksheetData, styles: Record<string, IStyleData | null>): string {
    const { cellData } = sheet;
    const bounds = computeBounds(cellData, sheet.mergeData);
    if (!bounds) {
        return "";
    }

    const { minRow, maxRow, minCol, maxCol } = bounds;
    const lines: string[] = [];

    for (let row = minRow; row <= maxRow; row++) {
        const cells: string[] = [];
        for (let col = minCol; col <= maxCol; col++) {
            cells.push(escapeCsvField(cellText(cellData[row]?.[col], styles)));
        }
        lines.push(cells.join(","));
    }

    // RFC 4180 uses CRLF as the record separator.
    return lines.join("\r\n");
}

/**
 * Extracts a cell's plain-text value. Formula cells use their cached result (`v`); date
 * serials (a numeric value with a date number format) are rendered as ISO 8601.
 */
function cellText(cell: ICellData | undefined, styles: Record<string, IStyleData | null>): string {
    if (!cell || cell.v == null) return "";
    if (typeof cell.v === "boolean") return cell.v ? "TRUE" : "FALSE";

    const pattern = resolveCellStyle(cell.s, styles)?.n?.pattern;
    if (pattern && isFiniteNumber(cell.v) && isDateFormat(pattern)) {
        const formatted = formatDate(pattern, cell.v);
        if (formatted != null) return formatted;
    }

    return String(cell.v);
}

/**
 * Renders a date serial as ISO 8601 when the format is a full year-month-day date (with
 * time appended only if the format carries it). Partial date formats (e.g. month-year only)
 * fall back to the cell's own pattern so the output stays a readable date, never a serial.
 * Returns `null` if the value can't be formatted, so the caller falls back to the raw value.
 */
export function formatDate(pattern: string, serial: number): string | null {
    try {
        const info = getFormatDateInfo(pattern);
        if (info.year && info.month && info.day) {
            let isoFormat = "yyyy-mm-dd";
            if (info.seconds) isoFormat += " hh:mm:ss";
            else if (info.hours || info.minutes) isoFormat += " hh:mm";
            return formatNumfmt(isoFormat, serial);
        }
        return formatNumfmt(pattern, serial);
    } catch {
        return null;
    }
}

/**
 * Quotes a field per RFC 4180 when it contains a comma, double quote, CR, or LF;
 * embedded double quotes are doubled. Plain fields pass through unchanged.
 */
function escapeCsvField(value: string): string {
    if (/[",\r\n]/.test(value)) {
        return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
}
