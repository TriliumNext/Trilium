/**
 * Parses an `.xlsx` file (OOXML) into a UniversJS workbook JSON structure — the inverse of
 * `render_to_xlsx`. The result matches the `PersistedData` shape that a spreadsheet note
 * stores and that the editor loads via `univerAPI.createWorkbook(...)`, so the output can be
 * stringified straight into note content.
 *
 * Like the exporter, the mapping is near-1:1: values, formulas, number formats, fonts, fills,
 * alignment, borders, merges and row/column sizing all invert their export counterparts. The
 * heavy lifting (unzip + XML) is delegated to `exceljs`.
 *
 * Known fidelity gaps (Excel features Univer's cell model — and our exporter — don't carry):
 * conditional formatting, data validation, filters, charts, embedded images, comments,
 * frozen panes and defined names are dropped. Rich text is flattened to plain text and
 * hyperlinks keep their display text but lose the link. Theme/indexed colors are resolved
 * against the standard Office palette (see `THEME_COLORS`), which is approximate when the
 * file ships a custom theme.
 */

import ExcelJS from "exceljs";

import {
    BorderStyle,
    CellValueType,
    HorizontalAlign,
    type IBorderData,
    type IBorderStyleData,
    type ICellData,
    type IColumnData,
    type IRange,
    type IRowData,
    type IStyleData,
    type IWorksheetData,
    type PersistedData,
    VerticalAlign,
    WrapStrategy
} from "./workbook_model.js";

/** Univer's default grid size for a fresh sheet; imported sheets are grown to fit their data. */
const DEFAULT_ROW_COUNT = 1000;
const DEFAULT_COLUMN_COUNT = 20;

/** Excel's default body font size (points); exceljs reports it on every theme-default font. */
const EXCEL_DEFAULT_FONT_SIZE = 11;

/**
 * Reads an `.xlsx` binary and produces a UniversJS workbook. Hidden sheets/rows/columns are
 * preserved and flagged hidden. Styles are emitted inline on each cell (Univer accepts either
 * inline objects or a shared `styles` table; inline keeps the parser stateless). Throws if the
 * buffer is not a readable workbook.
 */
export async function parseXlsxToWorkbook(input: ArrayBuffer | Uint8Array): Promise<PersistedData> {
    const wb = new ExcelJS.Workbook();
    try {
        await wb.xlsx.load(toArrayBuffer(input));
    } catch {
        throw new Error("Unable to parse spreadsheet file.");
    }

    const sheetOrder: string[] = [];
    const sheets: Record<string, IWorksheetData> = {};

    wb.eachSheet((ws, sheetIndex) => {
        // Deterministic ids keyed off position; the workbook id/locale are reassigned on load
        // (see persistence.tsx) and sheet view state keys off this id, so stability is all we need.
        const id = `sheet-${sheetIndex}`;
        sheetOrder.push(id);
        sheets[id] = readSheet(ws, id);
    });

    return {
        version: 1,
        workbook: {
            sheetOrder,
            styles: {},
            sheets
        }
    };
}

function readSheet(ws: ExcelJS.Worksheet, id: string): IWorksheetData {
    const cellData = readCells(ws);
    const mergeData = readMerges(ws);
    const { rowData, maxRow } = readRows(ws);
    const { columnData, maxCol } = readColumns(ws);

    const sheet: IWorksheetData = {
        id,
        name: ws.name,
        cellData,
        rowData,
        columnData,
        mergeData,
        // Grow the grid past Univer's defaults when the data needs it, so nothing is clipped.
        rowCount: Math.max(DEFAULT_ROW_COUNT, maxRow + 1),
        columnCount: Math.max(DEFAULT_COLUMN_COUNT, maxCol + 1),
        // exceljs reports a hidden sheet as state "hidden"/"veryHidden".
        hidden: ws.state && ws.state !== "visible" ? 1 : 0,
        showGridlines: ws.views?.[0]?.showGridLines === false ? 0 : 1
    };

    if (isFiniteNumber(ws.properties?.defaultColWidth)) {
        sheet.defaultColumnWidth = excelWidthToPx(ws.properties.defaultColWidth);
    }
    /* v8 ignore next -- defensive: exceljs always reports a defaultRowHeight (15pt default), so the non-finite branch is unreachable */
    if (isFiniteNumber(ws.properties?.defaultRowHeight)) {
        sheet.defaultRowHeight = pointsToPx(ws.properties.defaultRowHeight);
    }

    return sheet;
}

function readCells(ws: ExcelJS.Worksheet): Record<number, Record<number, ICellData>> {
    const cellData: Record<number, Record<number, ICellData>> = {};

    // `includeEmpty: true` so cells carrying only a style (e.g. a header background with no
    // text) are visited — `readCell` drops the truly-empty ones. With `false`, exceljs skips
    // any cell/row without a value, silently losing fills on blank cells.
    ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
            const data = readCell(cell);
            if (!data) return;
            const r = rowNumber - 1;
            const c = colNumber - 1;
            (cellData[r] ??= {})[c] = data;
        });
    });

    return cellData;
}

function readCell(cell: ExcelJS.Cell): ICellData | null {
    const data: ICellData = {};
    applyCellValue(data, cell);

    const style = readStyle(cell);
    if (style) data.s = style;

    // Drop cells that carry neither a value, a formula nor a style.
    if (data.v == null && data.f == null && data.s == null) return null;
    return data;
}

function applyCellValue(data: ICellData, cell: ExcelJS.Cell): void {
    // Formula cells: re-add the leading "=" the exporter strips, and carry the cached result.
    if (cell.type === ExcelJS.ValueType.Formula) {
        data.f = `=${cell.formula}`;
        assignPrimitive(data, cell.result);
        return;
    }

    switch (cell.type) {
        case ExcelJS.ValueType.Number:
            data.v = cell.value as number;
            data.t = CellValueType.NUMBER;
            break;
        case ExcelJS.ValueType.Boolean:
            data.v = cell.value as boolean;
            data.t = CellValueType.BOOLEAN;
            break;
        case ExcelJS.ValueType.Date:
            data.v = dateToSerial(cell.value as Date);
            data.t = CellValueType.NUMBER;
            break;
        case ExcelJS.ValueType.Hyperlink:
            // Keep the display text; the link itself has no inline Univer equivalent.
            /* v8 ignore next -- defensive: a hyperlink cell always carries display text */
            data.v = String((cell.value as ExcelJS.CellHyperlinkValue)?.text ?? "");
            data.t = CellValueType.STRING;
            break;
        case ExcelJS.ValueType.RichText:
            data.v = flattenRichText(cell.value as ExcelJS.CellRichTextValue);
            data.t = CellValueType.STRING;
            break;
        case ExcelJS.ValueType.Error:
            /* v8 ignore next -- defensive: an error cell always carries an error code */
            data.v = String((cell.value as ExcelJS.CellErrorValue)?.error ?? "#ERROR!");
            data.t = CellValueType.FORCE_STRING;
            break;
        case ExcelJS.ValueType.String:
            data.v = cell.value as string;
            data.t = CellValueType.STRING;
            break;
        default:
            // Null/Merge/empty — nothing to carry.
            break;
    }
}

/** Maps a formula's cached result (number/bool/string/date) onto the cell value + type. */
function assignPrimitive(data: ICellData, result: ExcelJS.Cell["result"]): void {
    if (result == null) return;
    if (typeof result === "number") { data.v = result; data.t = CellValueType.NUMBER; return; }
    if (typeof result === "boolean") { data.v = result; data.t = CellValueType.BOOLEAN; return; }
    if (result instanceof Date) { data.v = dateToSerial(result); data.t = CellValueType.NUMBER; return; }
    if (typeof result === "object" && result !== null && "error" in result) {
        data.v = String((result as ExcelJS.CellErrorValue).error);
        data.t = CellValueType.FORCE_STRING;
        return;
    }
    data.v = String(result);
    data.t = CellValueType.STRING;
}

function flattenRichText(value: ExcelJS.CellRichTextValue): string {
    /* v8 ignore next -- defensive: a rich-text cell always carries a richText run array */
    return (value?.richText ?? []).map((run) => run.text).join("");
}

function readStyle(cell: ExcelJS.Cell): IStyleData | null {
    const style: IStyleData = {};
    let any = false;

    const font = readFont(cell.font);
    if (font) { Object.assign(style, font); any = true; }

    const bg = excelColorToRgb(solidFillColor(cell.fill));
    if (bg) { style.bg = { rgb: bg }; any = true; }

    const alignment = readAlignment(cell.alignment);
    if (alignment) { Object.assign(style, alignment); any = true; }

    const border = readBorder(cell.border);
    if (border) { style.bd = border; any = true; }

    if (cell.numFmt) { style.n = { pattern: cell.numFmt }; any = true; }

    return any ? style : null;
}

function readFont(font: Partial<ExcelJS.Font> | undefined): Partial<IStyleData> | null {
    if (!font) return null;
    const out: Partial<IStyleData> = {};
    let any = false;

    // exceljs injects the workbook-default font (Calibri 11, theme-1 text color, `scheme` set)
    // onto any cell that has *other* styling but no explicit font. Carrying that back as an
    // explicit font would override Univer's own default font — so skip the theme-derived name,
    // the default size, and the default text color, while keeping bold/italic/underline/strike
    // and any genuinely-explicit size/color (which exceljs reports without `scheme`).
    const isThemeFont = Boolean(font.scheme);

    if (font.name && !isThemeFont) { out.ff = font.name; any = true; }
    if (isFiniteNumber(font.size) && !(isThemeFont && font.size === EXCEL_DEFAULT_FONT_SIZE)) { out.fs = font.size; any = true; }
    if (font.bold) { out.bl = 1; any = true; }
    if (font.italic) { out.it = 1; any = true; }
    if (font.underline) { out.ul = { s: 1 }; any = true; }
    if (font.strike) { out.st = { s: 1 }; any = true; }

    // Skip the default text color (theme 1) so the cell inherits Univer's default text color.
    if (font.color?.theme !== 1) {
        const color = excelColorToRgb(font.color);
        if (color) { out.cl = { rgb: color }; any = true; }
    }

    return any ? out : null;
}

function readAlignment(alignment: Partial<ExcelJS.Alignment> | undefined): Partial<IStyleData> | null {
    if (!alignment) return null;
    const out: Partial<IStyleData> = {};
    let any = false;

    const ht = horizontalAlign(alignment.horizontal);
    if (ht) { out.ht = ht; any = true; }

    const vt = verticalAlign(alignment.vertical);
    if (vt) { out.vt = vt; any = true; }

    if (alignment.wrapText) { out.tb = WrapStrategy.WRAP; any = true; }

    if (alignment.textRotation === "vertical") {
        out.tr = { v: 1 }; any = true;
    } else if (isFiniteNumber(alignment.textRotation) && alignment.textRotation !== 0) {
        out.tr = { a: alignment.textRotation }; any = true;
    }

    return any ? out : null;
}

function readBorder(border: Partial<ExcelJS.Borders> | undefined): IBorderData | null {
    if (!border) return null;
    const out: IBorderData = {};
    let any = false;

    for (const [univerSide, excelSide] of [["t", "top"], ["r", "right"], ["b", "bottom"], ["l", "left"]] as const) {
        const side = readBorderSide(border[excelSide]);
        if (!side) continue;
        out[univerSide] = side;
        any = true;
    }

    return any ? out : null;
}

function readBorderSide(side: Partial<ExcelJS.Border> | undefined): IBorderStyleData | null {
    const style = borderStyle(side?.style);
    if (style == null) return null;
    const out: IBorderStyleData = { s: style };
    const color = excelColorToRgb(side?.color);
    if (color) out.cl = { rgb: color };
    return out;
}

function readMerges(ws: ExcelJS.Worksheet): IRange[] {
    // exceljs exposes merges as A1-style range strings on the worksheet model.
    /* v8 ignore next -- defensive: exceljs always exposes model.merges as an array */
    const merges = (ws.model as { merges?: string[] })?.merges ?? [];
    const ranges: IRange[] = [];
    for (const ref of merges) {
        const range = parseRange(ref);
        /* v8 ignore next -- defensive: exceljs merge refs are always well-formed ranges */
        if (range) ranges.push(range);
    }
    return ranges;
}

function readRows(ws: ExcelJS.Worksheet): { rowData: Record<number, IRowData>; maxRow: number } {
    const rowData: Record<number, IRowData> = {};
    let maxRow = 0;

    // `includeEmpty: true` keeps custom heights on rows that hold only styled (valueless) cells,
    // such as a thin spacer row, which `false` would skip.
    ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
        const index = rowNumber - 1;
        if (index > maxRow) maxRow = index;

        const meta: IRowData = {};
        // exceljs leaves `row.height` undefined unless the row carries a custom height, so this
        // never picks up the sheet default (which lives on `ws.properties.defaultRowHeight`).
        if (isFiniteNumber(row.height)) meta.h = pointsToPx(row.height);
        if (row.hidden) meta.hd = 1;
        if (meta.h != null || meta.hd != null) rowData[index] = meta;
    });

    return { rowData, maxRow };
}

function readColumns(ws: ExcelJS.Worksheet): { columnData: Record<number, IColumnData>; maxCol: number } {
    const columnData: Record<number, IColumnData> = {};
    let maxCol = 0;

    // `ws.columns` is null when no column metadata exists; cell-driven width still has no column entry.
    (ws.columns ?? []).forEach((column, index) => {
        if (index > maxCol) maxCol = index;

        const meta: IColumnData = {};
        if (isFiniteNumber(column.width)) meta.w = excelWidthToPx(column.width);
        if (column.hidden) meta.hd = 1;
        if (meta.w != null || meta.hd != null) columnData[index] = meta;
    });

    // The cell pass may reach further right than the declared columns; account for that.
    maxCol = Math.max(maxCol, ws.actualColumnCount - 1);
    return { columnData, maxCol };
}

function horizontalAlign(horizontal: ExcelJS.Alignment["horizontal"] | undefined): HorizontalAlign | null {
    switch (horizontal) {
        case "left": return HorizontalAlign.LEFT;
        case "center": return HorizontalAlign.CENTER;
        case "right": return HorizontalAlign.RIGHT;
        default: return null; // fill/justify/distributed/etc. have no Univer equivalent
    }
}

function verticalAlign(vertical: ExcelJS.Alignment["vertical"] | undefined): VerticalAlign | null {
    switch (vertical) {
        case "top": return VerticalAlign.TOP;
        case "middle": return VerticalAlign.MIDDLE;
        case "bottom": return VerticalAlign.BOTTOM;
        default: return null;
    }
}

function borderStyle(style: ExcelJS.BorderStyle | undefined): BorderStyle | null {
    switch (style) {
        case "thin": return BorderStyle.THIN;
        case "hair": return BorderStyle.HAIR;
        case "dotted": return BorderStyle.DOTTED;
        case "dashed": return BorderStyle.DASHED;
        case "dashDot": return BorderStyle.DASH_DOT;
        case "dashDotDot": return BorderStyle.DASH_DOT_DOT;
        case "double": return BorderStyle.DOUBLE;
        case "medium": return BorderStyle.MEDIUM;
        case "mediumDashed": return BorderStyle.MEDIUM_DASHED;
        case "mediumDashDot": return BorderStyle.MEDIUM_DASH_DOT;
        case "mediumDashDotDot": return BorderStyle.MEDIUM_DASH_DOT_DOT;
        case "slantDashDot": return BorderStyle.SLANT_DASH_DOT;
        case "thick": return BorderStyle.THICK;
        default: return null;
    }
}

function solidFillColor(fill: ExcelJS.Fill | undefined): Partial<ExcelJS.Color> | undefined {
    if (!fill || fill.type !== "pattern") return undefined;
    // "solid" puts the visible color in fgColor; other patterns approximate with the same.
    return fill.fgColor;
}

/**
 * Converts an exceljs color to a `#rrggbb` hex string, or `null` when it can't be resolved.
 * Handles explicit ARGB and theme colors (resolved against the standard Office palette plus
 * tint). Indexed (legacy) colors are not handled.
 */
export function excelColorToRgb(color: Partial<ExcelJS.Color> | undefined): string | null {
    if (!color) return null;
    if (typeof color.argb === "string") return argbToHex(color.argb);
    // exceljs' `Color` type omits `tint`, though it's present on theme colors at runtime.
    const themed = color as { theme?: number; tint?: number };
    if (typeof themed.theme === "number") {
        const base = THEME_COLORS[themed.theme];
        if (!base) return null;
        return applyTint(base, isFiniteNumber(themed.tint) ? themed.tint : 0);
    }
    return null;
}

/** Converts an `AARRGGBB` string to `#RRGGBB`, dropping the alpha. Fully transparent → null. */
function argbToHex(argb: string): string | null {
    const s = argb.trim().toUpperCase();
    if (/^[0-9A-F]{8}$/.test(s)) {
        if (s.slice(0, 2) === "00") return null; // transparent
        return `#${s.slice(2)}`;
    }
    if (/^[0-9A-F]{6}$/.test(s)) return `#${s}`;
    return null;
}

/**
 * Standard Office theme palette, indexed the way SpreadsheetML references theme colors in cell
 * formatting (note the light/dark swap at 0/1 and 2/3 relative to the theme XML order).
 */
const THEME_COLORS: string[] = [
    "#FFFFFF", // 0 — light 1 (background)
    "#000000", // 1 — dark 1 (text)
    "#E7E6E6", // 2 — light 2
    "#44546A", // 3 — dark 2
    "#4472C4", // 4 — accent 1
    "#ED7D31", // 5 — accent 2
    "#A5A5A5", // 6 — accent 3
    "#FFC000", // 7 — accent 4
    "#5B9BD5", // 8 — accent 5
    "#70AD47", // 9 — accent 6
    "#0563C1", // 10 — hyperlink
    "#954F72"  // 11 — followed hyperlink
];

/** Applies an OOXML tint (-1..1) to a hex color by shifting its HSL luminance. */
function applyTint(hex: string, tint: number): string {
    if (!tint) return hex;
    const { h, s, l } = rgbToHsl(hex);
    const lum = tint < 0 ? l * (1 + tint) : l * (1 - tint) + tint;
    return hslToRgb(h, s, lum);
}

function rgbToHsl(hex: string): { h: number; s: number; l: number } {
    const n = hex.replace("#", "");
    const r = parseInt(n.slice(0, 2), 16) / 255;
    const g = parseInt(n.slice(2, 4), 16) / 255;
    const b = parseInt(n.slice(4, 6), 16) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return { h: 0, s: 0, l };
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h = 0;
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return { h: h / 6, s, l };
}

function hslToRgb(h: number, s: number, l: number): string {
    if (s === 0) {
        const v = clampChannel(l);
        return `#${v}${v}${v}`;
    }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const r = hueToChannel(p, q, h + 1 / 3);
    const g = hueToChannel(p, q, h);
    const b = hueToChannel(p, q, h - 1 / 3);
    return `#${clampChannel(r)}${clampChannel(g)}${clampChannel(b)}`;
}

function hueToChannel(p: number, q: number, t: number): number {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
}

function clampChannel(v: number): string {
    const byte = Math.round(Math.min(1, Math.max(0, v)) * 255);
    return byte.toString(16).padStart(2, "0").toUpperCase();
}

/** Parses an A1-style range ("B2:D5" or a single "A1") into a 0-based inclusive `IRange`. */
export function parseRange(ref: string): IRange | null {
    const [from, to] = ref.split(":");
    const start = parseAddress(from);
    const end = parseAddress(to ?? from);
    if (!start || !end) return null;
    return {
        startRow: Math.min(start.row, end.row),
        endRow: Math.max(start.row, end.row),
        startColumn: Math.min(start.col, end.col),
        endColumn: Math.max(start.col, end.col)
    };
}

function parseAddress(addr: string): { row: number; col: number } | null {
    const m = /^([A-Z]+)(\d+)$/.exec(addr.trim().toUpperCase());
    if (!m) return null;
    let col = 0;
    for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
    return { row: Number(m[2]) - 1, col: col - 1 };
}

/** Excel column width (character units) → pixels; inverse of the exporter's `pxToExcelWidth`. */
function excelWidthToPx(width: number): number {
    return width * 7 + 5;
}

/** Excel row height (points) → pixels; inverse of the exporter's `pxToPoints` (1pt = 1/0.75 px). */
function pointsToPx(points: number): number {
    return points / 0.75;
}

/** Excel serial date (days since 1899-12-30) for a JS Date; inverse of exceljs' date parsing. */
function dateToSerial(date: Date): number {
    const EPOCH_OFFSET_DAYS = 25569; // days between 1899-12-30 and 1970-01-01
    const MS_PER_DAY = 86_400_000;
    return date.getTime() / MS_PER_DAY + EPOCH_OFFSET_DAYS;
}

function isFiniteNumber(v: unknown): v is number {
    return typeof v === "number" && Number.isFinite(v);
}

/**
 * Normalizes input to a tight `ArrayBuffer` for exceljs. A `Uint8Array`/Node `Buffer` can be a
 * view into a larger pooled buffer, so reading `.buffer` directly would include foreign bytes —
 * slice by its offset/length to copy out exactly the viewed region.
 */
export function toArrayBuffer(input: ArrayBuffer | Uint8Array): ArrayBuffer {
    if (!(input instanceof Uint8Array)) return input;
    // NB: `input.slice()` can't be used here — Node's `Buffer.prototype.slice` returns a VIEW over
    // the same (often pooled) backing, so `.buffer` would expose the entire backing. Slicing the
    // backing ArrayBuffer by offset/length copies out exactly the viewed bytes in both Node and
    // the browser.
    return input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) as ArrayBuffer;
}
