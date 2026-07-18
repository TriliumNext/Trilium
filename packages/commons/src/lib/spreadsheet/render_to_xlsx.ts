/**
 * Converts a UniversJS workbook JSON structure into an `.xlsx` file (OOXML).
 *
 * Unlike the HTML renderer, this is a near-lossless mapping: Univer's cell model mirrors
 * OOXML, so number formats pass through verbatim, the border-style enum maps almost 1:1 to
 * Excel's, and fonts/fills/alignment/merges map directly. Data-validation rules (dropdown lists,
 * numeric/date/text bounds) invert their import counterparts. The heavy lifting (zip + XML) is
 * delegated to `exceljs`.
 *
 * The workbook type subset, sheet selection, and style resolution live in the shared
 * `workbook_model` reader; this module only owns the Univer→OOXML translation.
 */

import ExcelJS from "exceljs";

import "./exceljs_augmentation.js";

import {
    BorderStyle,
    type DataValidationRule,
    getDataValidations,
    getFloatingDrawings,
    getVisibleSheets,
    HorizontalAlign,
    type IBorderData,
    type ICellData,
    type IDrawingCellAnchor,
    isFiniteNumber,
    type IRange,
    type IStyleData,
    type IWorkbookData,
    type IWorksheetData,
    parseWorkbookData,
    resolveCellStyle,
    VerticalAlign,
    WrapStrategy
} from "./workbook_model.js";

/** An image resolved to embeddable bytes. Returned by the caller's {@link XlsxRenderOptions.resolveImage}. */
export interface ResolvedImage {
    /** Raw base64 (no `data:` prefix). */
    base64: string;
    /** A format exceljs can embed. */
    extension: "jpeg" | "png" | "gif";
}

export interface XlsxRenderOptions {
    /**
     * Resolves a drawing's `source` (an `api/attachments/...` URL or a `data:` URL) to embeddable
     * bytes, or `null` to skip it. Image bytes can't be fetched from the platform-agnostic commons
     * layer, so the caller (which has attachment access) supplies them. When omitted, images are
     * dropped.
     */
    resolveImage?: (source: string) => Promise<ResolvedImage | null>;
}

/**
 * Parses the raw JSON content of a spreadsheet note and produces an `.xlsx` workbook as a
 * binary buffer. Hidden sheets are skipped; hidden rows/columns are preserved but flagged
 * hidden (Excel keeps the data). Throws if the content is not a parseable workbook.
 */
export async function renderSpreadsheetToXlsx(jsonContent: string, opts: XlsxRenderOptions = {}): Promise<ExcelJS.Buffer> {
    const { ok, data } = parseWorkbookData(jsonContent);
    if (!ok) {
        throw new Error("Unable to parse spreadsheet data.");
    }

    if (!data?.workbook?.sheets) {
        throw new Error("Spreadsheet contains no sheets.");
    }

    const { workbook } = data;
    const styles = workbook.styles ?? {};
    const out = new ExcelJS.Workbook();

    const visibleSheets = getVisibleSheets(workbook);

    // Always emit at least one sheet so the file is a valid workbook.
    if (visibleSheets.length === 0) {
        out.addWorksheet("Sheet1");
        return out.xlsx.writeBuffer();
    }

    // Sheet names come from arbitrary user/imported data; exceljs throws (aborting the whole
    // export) on names that are illegal or collide, so resolve each to an Excel-legal unique name.
    const usedNames = new Set<string>();
    for (const sheet of visibleSheets) {
        const ws = writeSheet(out, sheet, uniqueSheetName(sheet.name, usedNames), styles);
        applyDataValidations(ws, workbook, sheet.id);
        if (opts.resolveImage) {
            await embedImages(out, ws, sheet, workbook, opts.resolveImage);
        }
    }

    return out.xlsx.writeBuffer();
}

const MAX_SHEET_NAME_LENGTH = 31;
// Excel/exceljs reject these characters anywhere in a worksheet name.
const ILLEGAL_SHEET_NAME_CHARS = /[\\/?*:[\]]/g;

/**
 * Returns an Excel-legal, workbook-unique worksheet name derived from `name`, recording the result
 * in `usedNames`. exceljs throws when a name is empty, equals the reserved "History", contains
 * \ / ? * : [ ], begins/ends with a single quote, or collides case-insensitively with an existing
 * sheet — so sanitise, truncate, then de-duplicate.
 */
export function uniqueSheetName(name: string | undefined, usedNames: Set<string>): string {
    const base = sanitizeSheetName(name);
    let candidate = base;
    for (let n = 2; usedNames.has(candidate.toLowerCase()); n++) {
        const suffix = ` (${n})`;
        candidate = `${base.slice(0, MAX_SHEET_NAME_LENGTH - suffix.length)}${suffix}`;
    }
    usedNames.add(candidate.toLowerCase());
    return candidate;
}

function sanitizeSheetName(name: string | undefined): string {
    const cleaned = (name ?? "")
        .replace(ILLEGAL_SHEET_NAME_CHARS, "_")
        .trim()
        .slice(0, MAX_SHEET_NAME_LENGTH)
        .replace(/^'+|'+$/g, "_"); // a leading/trailing single quote is illegal — check after the cut
    if (cleaned === "") return "Sheet";
    if (/^history$/i.test(cleaned)) return `${cleaned}_`;
    return cleaned;
}

function writeSheet(out: ExcelJS.Workbook, sheet: IWorksheetData, name: string, styles: Record<string, IStyleData | null>): ExcelJS.Worksheet {
    const ws = out.addWorksheet(name, {
        views: [{ showGridLines: sheet.showGridlines !== 0 }],
        // Carry Univer's sheet-wide defaults so rows/columns without an explicit size keep it on
        // round-trip; otherwise Excel falls back to its own defaults (15pt rows / 8.43-char cols).
        properties: {
            ...(isFiniteNumber(sheet.defaultRowHeight) ? { defaultRowHeight: pxToPoints(sheet.defaultRowHeight) } : {}),
            ...(isFiniteNumber(sheet.defaultColumnWidth) ? { defaultColWidth: pxToExcelWidth(sheet.defaultColumnWidth) } : {})
        }
    });

    applyColumns(ws, sheet);
    applyRows(ws, sheet);

    const { cellData } = sheet;
    for (const rowStr of Object.keys(cellData)) {
        const row = Number(rowStr);
        const cols = cellData[row];
        for (const colStr of Object.keys(cols)) {
            const col = Number(colStr);
            writeCell(ws.getCell(row + 1, col + 1), cols[col], styles);
        }
    }

    for (const range of sheet.mergeData ?? []) {
        try {
            // exceljs uses 1-based, inclusive (top, left, bottom, right).
            ws.mergeCells(range.startRow + 1, range.startColumn + 1, range.endRow + 1, range.endColumn + 1);
        } catch {
            // Overlapping/invalid merge — skip rather than abort the whole export.
        }
    }

    return ws;
}

// #region Images

/**
 * Embeds a sheet's images into the worksheet: floating drawings (from the `SHEET_DRAWING_PLUGIN`
 * resource) as two-cell anchors spanning their from/to cells, and cell images (`cell.p.drawings`)
 * anchored to their cell at the drawing's pixel size. Bytes come from `resolveImage`; a drawing is
 * skipped when it has no usable anchor or its source can't be resolved.
 */
async function embedImages(out: ExcelJS.Workbook, ws: ExcelJS.Worksheet, sheet: IWorksheetData, workbook: IWorkbookData, resolveImage: NonNullable<XlsxRenderOptions["resolveImage"]>): Promise<void> {
    for (const drawing of getFloatingDrawings(workbook, sheet.id)) {
        const anchor = drawing.sheetTransform;
        if (!anchor?.from || !anchor?.to) continue;

        const imageId = await addImage(out, drawing.source, resolveImage);
        if (imageId == null) continue;

        // exceljs's types demand native-EMU anchors, but the runtime accepts fractional {col,row}.
        ws.addImage(imageId, {
            tl: anchorPoint(sheet, anchor.from),
            br: anchorPoint(sheet, anchor.to),
            editAs: "twoCell"
        } as unknown as ExcelJS.ImageRange);
    }

    const { cellData } = sheet;
    for (const rowStr of Object.keys(cellData)) {
        const row = Number(rowStr);
        const cols = cellData[row];
        for (const colStr of Object.keys(cols)) {
            await embedCellImages(out, ws, row, Number(colStr), cols[Number(colStr)], resolveImage);
        }
    }
}

async function embedCellImages(out: ExcelJS.Workbook, ws: ExcelJS.Worksheet, row: number, col: number, cell: ICellData | undefined, resolveImage: NonNullable<XlsxRenderOptions["resolveImage"]>): Promise<void> {
    const doc = cell?.p;
    const drawings = doc?.drawings;
    if (!drawings) return;

    const order = Array.isArray(doc?.drawingsOrder) ? doc.drawingsOrder : Object.keys(drawings);
    for (const id of order) {
        const drawing = drawings[id];
        if (!drawing) continue;

        const width = toFinite(drawing.transform?.width);
        const height = toFinite(drawing.transform?.height);
        if (width <= 0 || height <= 0) continue;

        const imageId = await addImage(out, drawing.source, resolveImage);
        if (imageId == null) continue;

        // exceljs anchors are 0-based, matching Univer's row/column indices.
        ws.addImage(imageId, { tl: { col, row }, ext: { width, height }, editAs: "oneCell" } as unknown as ExcelJS.ImageRange);
    }
}

/** Resolves a drawing source to bytes and registers it on the workbook, returning its image id. */
async function addImage(out: ExcelJS.Workbook, source: string | undefined, resolveImage: NonNullable<XlsxRenderOptions["resolveImage"]>): Promise<number | null> {
    if (!source) return null;
    const resolved = await resolveImage(source);
    if (!resolved?.base64) return null;
    return out.addImage({ base64: resolved.base64, extension: resolved.extension });
}

/**
 * Converts a Univer cell anchor to an exceljs fractional `{ col, row }` point: the cell index plus
 * the px offset expressed as a fraction of that cell's width/height. exceljs re-expands the fraction
 * using the same column/row sizes, reproducing the editor's placement.
 */
function anchorPoint(sheet: IWorksheetData, anchor: IDrawingCellAnchor): { col: number; row: number } {
    const column = toFinite(anchor.column);
    const row = toFinite(anchor.row);
    const colWidth = columnWidthPx(sheet, column);
    const rowHeight = rowHeightPx(sheet, row);
    return {
        col: column + (colWidth > 0 ? toFinite(anchor.columnOffset) / colWidth : 0),
        row: row + (rowHeight > 0 ? toFinite(anchor.rowOffset) / rowHeight : 0)
    };
}

function columnWidthPx(sheet: IWorksheetData, col: number): number {
    const w = sheet.columnData?.[col]?.w;
    return isFiniteNumber(w) ? w : (sheet.defaultColumnWidth ?? 88);
}

function rowHeightPx(sheet: IWorksheetData, row: number): number {
    const h = sheet.rowData?.[row]?.h;
    return isFiniteNumber(h) ? h : (sheet.defaultRowHeight ?? 24);
}

function toFinite(value: number | undefined): number {
    return isFiniteNumber(value) ? value : 0;
}

// #endregion

// #region Data validation

/**
 * Writes a sheet's Univer data-validation rules (from the SHEET_DATA_VALIDATION_PLUGIN resource)
 * into the worksheet — the inverse of the importer's `readDataValidations`. Each rule is applied
 * once per range, because exceljs rejects a multi-range `sqref` on write; contiguous cells are
 * re-consolidated by exceljs when it serialises. Rules whose type Excel can't represent are skipped.
 */
function applyDataValidations(ws: ExcelJS.Worksheet, workbook: IWorkbookData, sheetId: string): void {
    for (const rule of getDataValidations(workbook, sheetId)) {
        const validation = buildExcelValidation(rule);
        /* v8 ignore next -- defensive: an imported rule always carries at least one range */
        if (!validation || !rule.ranges) continue;
        for (const range of rule.ranges) {
            ws.dataValidations.add(rangeToA1(range), validation);
        }
    }
}

/** exceljs's supported data-validation types; Univer types outside this set can't be exported. */
const EXCEL_VALIDATION_TYPES: ReadonlySet<string> = new Set(["list", "whole", "decimal", "date", "textLength", "custom"]);

/**
 * Converts a Univer rule to an exceljs `DataValidation`, or null when it can't be represented: a
 * type with no Excel equivalent (checkbox, none, time), or a list with no options. A `list`/
 * `listMultiple` becomes an Excel `list`: literal options (a JSON array in `formula1`) are re-joined
 * into Excel's inline `"a,b,c"` syntax, while a range/name reference is passed through as the
 * formula. Other types carry their bounds and operator verbatim.
 */
function buildExcelValidation(rule: DataValidationRule): ExcelJS.DataValidation | null {
    if (rule.type === "list" || rule.type === "listMultiple") {
        const options = parseListOptions(rule.formula1);
        // An option array that parses but is empty (an import of an inline list of only empty
        // tokens, e.g. `",,"`) has no dropdown to write, and Excel rejects an empty inline list.
        if (options) return options.length > 0 ? { type: "list", allowBlank: true, formulae: [`"${options.join(",")}"`] } : null;
        // A range/name reference passes through; an absent/empty formula has no dropdown to write.
        if (rule.formula1) return { type: "list", allowBlank: true, formulae: [rule.formula1] };
        return null;
    }

    if (!EXCEL_VALIDATION_TYPES.has(rule.type)) return null;

    const formulae = [rule.formula1, rule.formula2].filter((f): f is string => f != null);
    const validation = { type: rule.type, allowBlank: true, formulae } as ExcelJS.DataValidation;
    if (rule.operator) validation.operator = rule.operator as ExcelJS.DataValidationOperator;
    return validation;
}

/**
 * Reads a Univer list `formula1` back into its literal options: a JSON-encoded string array (how
 * the list validator serialises inline options). Returns null when `formula1` is a range/name
 * reference (not a JSON array), so the caller passes it through as a formula instead.
 */
function parseListOptions(formula1: string | undefined): string[] | null {
    if (formula1 == null) return null;
    try {
        const parsed: unknown = JSON.parse(formula1);
        if (Array.isArray(parsed) && parsed.every((o) => typeof o === "string")) return parsed;
    } catch {
        // Not JSON — a range/name reference; fall through.
    }
    return null;
}

/** Converts a 0-based inclusive Univer range to an A1 sqref ("D2" for a single cell, else "D2:E3"). */
function rangeToA1(range: IRange): string {
    const start = `${columnLetters(range.startColumn)}${range.startRow + 1}`;
    if (range.startRow === range.endRow && range.startColumn === range.endColumn) return start;
    return `${start}:${columnLetters(range.endColumn)}${range.endRow + 1}`;
}

/** 0-based column index to its Excel letters (0 -> "A", 25 -> "Z", 26 -> "AA"). */
function columnLetters(index: number): string {
    let n = index;
    let letters = "";
    do {
        letters = String.fromCharCode(65 + (n % 26)) + letters;
        n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    return letters;
}

// #endregion

function applyColumns(ws: ExcelJS.Worksheet, sheet: IWorksheetData): void {
    const columnData = sheet.columnData ?? {};
    for (const colStr of Object.keys(columnData)) {
        const meta = columnData[Number(colStr)];
        const column = ws.getColumn(Number(colStr) + 1);
        if (isFiniteNumber(meta?.w)) column.width = pxToExcelWidth(meta.w);
        if (meta?.hd) column.hidden = true;
    }
}

function applyRows(ws: ExcelJS.Worksheet, sheet: IWorksheetData): void {
    const rowData = sheet.rowData ?? {};
    for (const rowStr of Object.keys(rowData)) {
        const meta = rowData[Number(rowStr)];
        const row = ws.getRow(Number(rowStr) + 1);
        if (isFiniteNumber(meta?.h)) row.height = pxToPoints(meta.h);
        if (meta?.hd) row.hidden = true;
    }
}

function writeCell(target: ExcelJS.Cell, cell: ICellData | undefined, styles: Record<string, IStyleData | null>): void {
    if (!cell) return;

    setCellValue(target, cell);

    const style = resolveCellStyle(cell.s, styles);
    if (!style) return;

    if (style.n?.pattern) target.numFmt = style.n.pattern;

    const font = buildFont(style);
    if (font) target.font = font;

    const fill = buildFill(style);
    if (fill) target.fill = fill;

    const alignment = buildAlignment(style);
    if (alignment) target.alignment = alignment;

    const border = buildBorder(style.bd);
    if (border) target.border = border;
}

function setCellValue(target: ExcelJS.Cell, cell: ICellData): void {
    if (cell.f) {
        // Univer stores formulas with a leading "="; exceljs wants it stripped, plus the
        // cached result so the value shows without a recalc.
        target.value = { formula: cell.f.replace(/^=/, ""), result: cell.v ?? undefined } as ExcelJS.CellFormulaValue;
        return;
    }
    if (cell.v == null) return;
    target.value = cell.v;
}

function buildFont(style: IStyleData): Partial<ExcelJS.Font> | null {
    const font: Partial<ExcelJS.Font> = {};
    let any = false;

    if (style.ff) { font.name = style.ff; any = true; }
    if (isFiniteNumber(style.fs)) { font.size = style.fs; any = true; }
    if (style.bl) { font.bold = true; any = true; }
    if (style.it) { font.italic = true; any = true; }
    if (style.ul?.s) { font.underline = true; any = true; }
    if (style.st?.s) { font.strike = true; any = true; }

    const color = toArgb(style.cl?.rgb);
    if (color) { font.color = { argb: color }; any = true; }

    return any ? font : null;
}

function buildFill(style: IStyleData): ExcelJS.Fill | null {
    const argb = toArgb(style.bg?.rgb);
    if (!argb) return null;
    return { type: "pattern", pattern: "solid", fgColor: { argb } };
}

function buildAlignment(style: IStyleData): Partial<ExcelJS.Alignment> | null {
    const alignment: Partial<ExcelJS.Alignment> = {};
    let any = false;

    const horizontal = horizontalAlign(style.ht);
    if (horizontal) { alignment.horizontal = horizontal; any = true; }

    const vertical = verticalAlign(style.vt);
    if (vertical) { alignment.vertical = vertical; any = true; }

    if (style.tb === WrapStrategy.WRAP) { alignment.wrapText = true; any = true; }

    if (style.tr) {
        if (style.tr.v) { alignment.textRotation = "vertical"; any = true; }
        else if (isFiniteNumber(style.tr.a) && style.tr.a !== 0) { alignment.textRotation = style.tr.a; any = true; }
    }

    return any ? alignment : null;
}

function buildBorder(bd: IBorderData | null | undefined): Partial<ExcelJS.Borders> | null {
    if (!bd) return null;
    const border: Partial<ExcelJS.Borders> = {};
    let any = false;

    for (const [univerSide, excelSide] of [["t", "top"], ["r", "right"], ["b", "bottom"], ["l", "left"]] as const) {
        const side = bd[univerSide];
        const style = borderStyle(side?.s);
        if (!style) continue;
        border[excelSide] = { style, color: { argb: toArgb(side?.cl?.rgb) ?? "FF000000" } };
        any = true;
    }

    return any ? border : null;
}

function horizontalAlign(ht: number | null | undefined): ExcelJS.Alignment["horizontal"] | null {
    switch (ht) {
        case HorizontalAlign.LEFT: return "left";
        case HorizontalAlign.CENTER: return "center";
        case HorizontalAlign.RIGHT: return "right";
        default: return null;
    }
}

function verticalAlign(vt: number | null | undefined): ExcelJS.Alignment["vertical"] | null {
    switch (vt) {
        case VerticalAlign.TOP: return "top";
        case VerticalAlign.MIDDLE: return "middle";
        case VerticalAlign.BOTTOM: return "bottom";
        default: return null;
    }
}

function borderStyle(s: number | undefined): ExcelJS.BorderStyle | null {
    switch (s) {
        case BorderStyle.THIN: return "thin";
        case BorderStyle.HAIR: return "hair";
        case BorderStyle.DOTTED: return "dotted";
        case BorderStyle.DASHED: return "dashed";
        case BorderStyle.DASH_DOT: return "dashDot";
        case BorderStyle.DASH_DOT_DOT: return "dashDotDot";
        case BorderStyle.DOUBLE: return "double";
        case BorderStyle.MEDIUM: return "medium";
        case BorderStyle.MEDIUM_DASHED: return "mediumDashed";
        case BorderStyle.MEDIUM_DASH_DOT: return "mediumDashDot";
        case BorderStyle.MEDIUM_DASH_DOT_DOT: return "mediumDashDotDot";
        case BorderStyle.SLANT_DASH_DOT: return "slantDashDot";
        case BorderStyle.THICK: return "thick";
        default: return null; // NONE / unknown -> no border
    }
}

/** Converts a `#rrggbb` (or `#rrggbbaa`) color to exceljs' `AARRGGBB`. Returns null otherwise. */
function toArgb(rgb: string | null | undefined): string | null {
    if (!rgb) return null;
    const hex = rgb.trim().replace(/^#/, "").toUpperCase();
    if (/^[0-9A-F]{6}$/.test(hex)) return `FF${hex}`;
    if (/^[0-9A-F]{8}$/.test(hex)) return hex; // already AARRGGBB
    return null;
}

/** Univer stores column widths in pixels; Excel uses character widths (default-font based). */
function pxToExcelWidth(px: number): number {
    // Excel's width unit is "max digit widths"; ~7px per char + 5px cell padding for the default font.
    return Math.max(0, (px - 5) / 7);
}

/** Univer stores row heights in pixels; Excel uses points (1px = 0.75pt at 96dpi). */
function pxToPoints(px: number): number {
    return px * 0.75;
}
