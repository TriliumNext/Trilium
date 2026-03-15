/**
 * Converts a UniversJS workbook JSON structure into a static HTML table representation.
 * This is used for rendering spreadsheets in shared notes and exports.
 *
 * Only the subset of UniversJS types needed for rendering is defined here,
 * to avoid depending on @univerjs/core.
 */

// #region UniversJS type subset

interface PersistedData {
    version: number;
    workbook: IWorkbookData;
}

interface IWorkbookData {
    sheetOrder: string[];
    styles?: Record<string, IStyleData | null>;
    sheets: Record<string, IWorksheetData>;
}

interface IWorksheetData {
    id: string;
    name: string;
    hidden?: number;
    rowCount: number;
    columnCount: number;
    defaultColumnWidth?: number;
    defaultRowHeight?: number;
    mergeData?: IRange[];
    cellData: CellMatrix;
    rowData?: Record<number, IRowData>;
    columnData?: Record<number, IColumnData>;
    showGridlines?: number;
}

type CellMatrix = Record<number, Record<number, ICellData>>;

interface ICellData {
    v?: string | number | boolean | null;
    t?: number | null;
    s?: IStyleData | string | null;
}

interface IStyleData {
    bl?: number;
    it?: number;
    ul?: ITextDecoration;
    st?: ITextDecoration;
    fs?: number;
    ff?: string | null;
    bg?: IColorStyle | null;
    cl?: IColorStyle | null;
    ht?: number | null;
    vt?: number | null;
    bd?: IBorderData | null;
}

interface ITextDecoration {
    s?: number;
}

interface IColorStyle {
    rgb?: string | null;
}

interface IBorderData {
    t?: IBorderStyleData | null;
    r?: IBorderStyleData | null;
    b?: IBorderStyleData | null;
    l?: IBorderStyleData | null;
}

interface IBorderStyleData {
    s?: number;
    cl?: IColorStyle;
}

interface IRange {
    startRow: number;
    endRow: number;
    startColumn: number;
    endColumn: number;
}

interface IRowData {
    h?: number;
    hd?: number;
}

interface IColumnData {
    w?: number;
    hd?: number;
}

// Alignment enums (from UniversJS)
const enum HorizontalAlign {
    LEFT = 1,
    CENTER = 2,
    RIGHT = 3
}

const enum VerticalAlign {
    TOP = 1,
    MIDDLE = 2,
    BOTTOM = 3
}

// Border style enum
const enum BorderStyle {
    THIN = 1,
    MEDIUM = 6,
    THICK = 9,
    DASHED = 3,
    DOTTED = 4
}

// #endregion

/**
 * Parses the raw JSON content of a spreadsheet note and renders it as HTML.
 * Returns an HTML string containing one `<table>` per visible sheet.
 */
export function renderSpreadsheetToHtml(jsonContent: string): string {
    let data: PersistedData;
    try {
        data = JSON.parse(jsonContent);
    } catch {
        return "<p>Unable to parse spreadsheet data.</p>";
    }

    if (!data?.workbook?.sheets) {
        return "<p>Empty spreadsheet.</p>";
    }

    const { workbook } = data;
    const sheetIds = workbook.sheetOrder ?? Object.keys(workbook.sheets);
    const visibleSheets = sheetIds
        .map((id) => workbook.sheets[id])
        .filter((s) => s && !s.hidden);

    if (visibleSheets.length === 0) {
        return "<p>Empty spreadsheet.</p>";
    }

    const parts: string[] = [];
    for (const sheet of visibleSheets) {
        if (visibleSheets.length > 1) {
            parts.push(`<h3>${escapeHtml(sheet.name)}</h3>`);
        }
        parts.push(renderSheet(sheet, workbook.styles ?? {}));
    }

    return parts.join("\n");
}

function renderSheet(sheet: IWorksheetData, styles: Record<string, IStyleData | null>): string {
    const { cellData, mergeData = [], columnData = {}, rowData = {} } = sheet;

    // Determine the actual bounds (only cells with data).
    const bounds = computeBounds(cellData, mergeData);
    if (!bounds) {
        return "<p>Empty sheet.</p>";
    }

    const { minRow, maxRow, minCol, maxCol } = bounds;

    // Build a set of cells that are hidden by merges (non-origin cells).
    const mergeMap = buildMergeMap(mergeData, minRow, maxRow, minCol, maxCol);

    const lines: string[] = [];
    lines.push('<table class="spreadsheet-table">');

    // Colgroup for column widths.
    const defaultWidth = sheet.defaultColumnWidth ?? 88;
    lines.push("<colgroup>");
    for (let col = minCol; col <= maxCol; col++) {
        const colMeta = columnData[col];
        if (colMeta?.hd) continue;
        const width = isFiniteNumber(colMeta?.w) ? colMeta.w : defaultWidth;
        lines.push(`<col style="width:${width}px">`);
    }
    lines.push("</colgroup>");

    const defaultHeight = sheet.defaultRowHeight ?? 24;

    for (let row = minRow; row <= maxRow; row++) {
        const rowMeta = rowData[row];
        if (rowMeta?.hd) continue;

        const height = isFiniteNumber(rowMeta?.h) ? rowMeta.h : defaultHeight;
        lines.push(`<tr style="height:${height}px">`);

        for (let col = minCol; col <= maxCol; col++) {
            if (columnData[col]?.hd) continue;

            const mergeInfo = mergeMap.get(cellKey(row, col));
            if (mergeInfo === "hidden") continue;

            const cell = cellData[row]?.[col];
            const cellStyle = resolveCellStyle(cell, styles);
            const cssText = buildCssText(cellStyle);
            const value = formatCellValue(cell);

            const attrs: string[] = [];
            if (cssText) attrs.push(`style="${cssText}"`);
            if (mergeInfo) {
                if (mergeInfo.rowSpan > 1) attrs.push(`rowspan="${mergeInfo.rowSpan}"`);
                if (mergeInfo.colSpan > 1) attrs.push(`colspan="${mergeInfo.colSpan}"`);
            }

            lines.push(`<td${attrs.length ? " " + attrs.join(" ") : ""}>${value}</td>`);
        }

        lines.push("</tr>");
    }

    lines.push("</table>");
    return lines.join("\n");
}

// #region Bounds computation

interface Bounds {
    minRow: number;
    maxRow: number;
    minCol: number;
    maxCol: number;
}

function computeBounds(cellData: CellMatrix, mergeData: IRange[]): Bounds | null {
    let minRow = Infinity;
    let maxRow = -Infinity;
    let minCol = Infinity;
    let maxCol = -Infinity;

    for (const rowStr of Object.keys(cellData)) {
        const row = Number(rowStr);
        const cols = cellData[row];
        for (const colStr of Object.keys(cols)) {
            const col = Number(colStr);
            if (minRow > row) minRow = row;
            if (maxRow < row) maxRow = row;
            if (minCol > col) minCol = col;
            if (maxCol < col) maxCol = col;
        }
    }

    // Extend bounds to cover merged ranges.
    for (const range of mergeData) {
        if (minRow > range.startRow) minRow = range.startRow;
        if (maxRow < range.endRow) maxRow = range.endRow;
        if (minCol > range.startColumn) minCol = range.startColumn;
        if (maxCol < range.endColumn) maxCol = range.endColumn;
    }

    if (minRow > maxRow) return null;
    return { minRow, maxRow, minCol, maxCol };
}

// #endregion

// #region Merge handling

interface MergeOrigin {
    rowSpan: number;
    colSpan: number;
}

type MergeInfo = MergeOrigin | "hidden";

function cellKey(row: number, col: number): string {
    return `${row},${col}`;
}

function buildMergeMap(mergeData: IRange[], minRow: number, maxRow: number, minCol: number, maxCol: number): Map<string, MergeInfo> {
    const map = new Map<string, MergeInfo>();

    for (const range of mergeData) {
        const startRow = Math.max(range.startRow, minRow);
        const endRow = Math.min(range.endRow, maxRow);
        const startCol = Math.max(range.startColumn, minCol);
        const endCol = Math.min(range.endColumn, maxCol);

        map.set(cellKey(range.startRow, range.startColumn), {
            rowSpan: endRow - startRow + 1,
            colSpan: endCol - startCol + 1
        });

        for (let r = startRow; r <= endRow; r++) {
            for (let c = startCol; c <= endCol; c++) {
                if (r === range.startRow && c === range.startColumn) continue;
                map.set(cellKey(r, c), "hidden");
            }
        }
    }

    return map;
}

// #endregion

// #region Style resolution

function resolveCellStyle(cell: ICellData | undefined, styles: Record<string, IStyleData | null>): IStyleData | null {
    if (!cell?.s) return null;

    if (typeof cell.s === "string") {
        return styles[cell.s] ?? null;
    }

    return cell.s;
}

function buildCssText(style: IStyleData | null): string {
    if (!style) return "";

    const parts: string[] = [];

    if (style.bl) parts.push("font-weight:bold");
    if (style.it) parts.push("font-style:italic");
    if (style.ul?.s) parts.push("text-decoration:underline");
    if (style.st?.s) {
        // Combine with underline if both are set.
        const existing = parts.findIndex((p) => p.startsWith("text-decoration:"));
        if (existing >= 0) {
            parts[existing] = "text-decoration:underline line-through";
        } else {
            parts.push("text-decoration:line-through");
        }
    }
    if (style.fs && isFiniteNumber(style.fs)) parts.push(`font-size:${style.fs}pt`);
    if (style.ff) parts.push(`font-family:${sanitizeCssValue(style.ff)}`);
    if (style.bg?.rgb) parts.push(`background-color:${sanitizeCssColor(style.bg.rgb)}`);
    if (style.cl?.rgb) parts.push(`color:${sanitizeCssColor(style.cl.rgb)}`);

    if (style.ht != null) {
        const align = horizontalAlignToCss(style.ht);
        if (align) parts.push(`text-align:${align}`);
    }
    if (style.vt != null) {
        const valign = verticalAlignToCss(style.vt);
        if (valign) parts.push(`vertical-align:${valign}`);
    }

    if (style.bd) {
        appendBorderCss(parts, "border-top", style.bd.t);
        appendBorderCss(parts, "border-right", style.bd.r);
        appendBorderCss(parts, "border-bottom", style.bd.b);
        appendBorderCss(parts, "border-left", style.bd.l);
    }

    return parts.join(";");
}

function horizontalAlignToCss(align: number): string | null {
    switch (align) {
        case HorizontalAlign.LEFT: return "left";
        case HorizontalAlign.CENTER: return "center";
        case HorizontalAlign.RIGHT: return "right";
        default: return null;
    }
}

function verticalAlignToCss(align: number): string | null {
    switch (align) {
        case VerticalAlign.TOP: return "top";
        case VerticalAlign.MIDDLE: return "middle";
        case VerticalAlign.BOTTOM: return "bottom";
        default: return null;
    }
}

function appendBorderCss(parts: string[], property: string, border: IBorderStyleData | null | undefined): void {
    if (!border) return;
    const width = borderStyleToWidth(border.s);
    const color = sanitizeCssColor(border.cl?.rgb ?? "#000");
    const style = borderStyleToCss(border.s);
    parts.push(`${property}:${width} ${style} ${color}`);
}

function borderStyleToWidth(style: number | undefined): string {
    switch (style) {
        case BorderStyle.MEDIUM: return "2px";
        case BorderStyle.THICK: return "3px";
        default: return "1px";
    }
}

function borderStyleToCss(style: number | undefined): string {
    switch (style) {
        case BorderStyle.DASHED: return "dashed";
        case BorderStyle.DOTTED: return "dotted";
        default: return "solid";
    }
}

/** Checks that a value is a finite number (guards against stringified payloads from JSON). */
function isFiniteNumber(v: unknown): v is number {
    return typeof v === "number" && Number.isFinite(v);
}

/**
 * Sanitizes an arbitrary string for use as a CSS value by removing characters
 * that could break out of a property (semicolons, braces, angle brackets, etc.).
 */
function sanitizeCssValue(value: string): string {
    return value.replace(/[;<>{}\\/()'"]/g, "");
}

/**
 * Validates a CSS color string. Accepts hex colors (#rgb, #rrggbb, #rrggbbaa),
 * named colors (letters only), and rgb()/rgba()/hsl()/hsla() functional notation
 * with safe characters. Returns "transparent" for anything that doesn't match.
 */
function sanitizeCssColor(value: string): string {
    const trimmed = value.trim();
    // Hex colors
    if (/^#[0-9a-fA-F]{3,8}$/.test(trimmed)) return trimmed;
    // Named colors (letters only, reasonable length)
    if (/^[a-zA-Z]{1,30}$/.test(trimmed)) return trimmed;
    // Functional notation: rgb(), rgba(), hsl(), hsla() — allow digits, commas, dots, spaces, %
    if (/^(?:rgb|hsl)a?\([0-9.,\s%]+\)$/.test(trimmed)) return trimmed;
    return "transparent";
}

// #endregion

// #region Value formatting

function formatCellValue(cell: ICellData | undefined): string {
    if (!cell || cell.v == null) return "";

    if (typeof cell.v === "boolean") {
        return cell.v ? "TRUE" : "FALSE";
    }

    return escapeHtml(String(cell.v));
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    ;
}

// #endregion
