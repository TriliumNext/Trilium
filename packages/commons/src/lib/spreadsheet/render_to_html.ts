/**
 * Converts a UniversJS workbook JSON structure into a static HTML table representation.
 * This is used for rendering spreadsheets in shared notes and exports.
 *
 * Only the subset of UniversJS types needed for rendering is defined here,
 * to avoid depending on @univerjs/core.
 *
 * Number formatting is delegated to the `numfmt` library — the same ECMA-376
 * formatter Univer itself uses internally (`@univerjs/core` re-exports it) — so
 * shared output matches what the editor displays.
 */

import { format as formatNumfmt, formatColor as formatNumfmtColor } from "numfmt";

import {
    BorderStyle,
    computeBounds,
    getVisibleSheets,
    HorizontalAlign,
    type IBorderStyleData,
    type ICellData,
    isFiniteNumber,
    type IRange,
    type IStyleData,
    type IWorksheetData,
    parseWorkbookData,
    resolveCellStyle,
    VerticalAlign
} from "./workbook_model.js";

/**
 * Parses the raw JSON content of a spreadsheet note and renders it as HTML.
 * Returns an HTML string containing one `<table>` per visible sheet.
 */
export function renderSpreadsheetToHtml(jsonContent: string): string {
    const { ok, data } = parseWorkbookData(jsonContent);
    if (!ok) {
        return "<p>Unable to parse spreadsheet data.</p>";
    }

    if (!data?.workbook?.sheets) {
        return "<p>Empty spreadsheet.</p>";
    }

    const { workbook } = data;
    const visibleSheets = getVisibleSheets(workbook);

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
    lines.push(buildTableTag(sheet));

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
            const cellStyle = resolveCellStyle(cell?.s, styles);
            const cssText = buildCssText(cellStyle, cell);
            const value = formatCellValue(cell, cellStyle);

            const attrs: string[] = [];
            // Cells with a background fill carry `has-fill` so the stylesheet can suppress
            // gridlines under the fill, matching the editor (a fill covers the grid).
            if (cellStyle?.bg?.rgb) attrs.push(`class="has-fill"`);
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

/**
 * Builds the opening `<table>` tag, reflecting the sheet's gridline state. Univer stores
 * gridline visibility per sheet (`showGridlines`, 0 = hidden) and an optional custom
 * `gridlinesColor`. When gridlines are on, the table gets a `show-gridlines` class so the
 * stylesheet can draw a light border on every cell; explicit per-cell borders from the
 * data are emitted inline and override those on the sides they define.
 */
function buildTableTag(sheet: IWorksheetData): string {
    // Default to shown (matching the editor) unless explicitly disabled.
    const showGridlines = sheet.showGridlines !== 0;
    if (!showGridlines) {
        return '<table class="spreadsheet-table">';
    }

    let style = "";
    if (sheet.gridlinesColor) {
        style = ` style="--spreadsheet-gridline-color:${sanitizeCssColor(sheet.gridlinesColor)}"`;
    }
    return `<table class="spreadsheet-table show-gridlines"${style}>`;
}

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

function buildCssText(style: IStyleData | null, cell?: ICellData): string {
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

    // A color produced by the number-format pattern (e.g. `[Red]` for negatives) takes
    // precedence over the cell's own text color, matching Univer's rendering.
    const patternColor = resolvePatternColor(style, cell);
    const textColor = patternColor ?? style.cl?.rgb;
    if (textColor) parts.push(`color:${sanitizeCssColor(textColor)}`);

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
    if (!border || border.s === BorderStyle.NONE) return;
    const width = borderStyleToWidth(border.s);
    const color = sanitizeCssColor(border.cl?.rgb ?? "#000");
    const style = borderStyleToCss(border.s);
    parts.push(`${property}:${width} ${style} ${color}`);
}

function borderStyleToWidth(style: number | undefined): string {
    switch (style) {
        case BorderStyle.MEDIUM:
        case BorderStyle.MEDIUM_DASHED:
        case BorderStyle.MEDIUM_DASH_DOT:
        case BorderStyle.MEDIUM_DASH_DOT_DOT:
        case BorderStyle.SLANT_DASH_DOT:
            return "2px";
        case BorderStyle.THICK:
        case BorderStyle.DOUBLE:
            return "3px";
        default:
            return "1px";
    }
}

function borderStyleToCss(style: number | undefined): string {
    switch (style) {
        case BorderStyle.DOTTED:
            return "dotted";
        case BorderStyle.DASHED:
        case BorderStyle.DASH_DOT:
        case BorderStyle.DASH_DOT_DOT:
        case BorderStyle.MEDIUM_DASHED:
        case BorderStyle.MEDIUM_DASH_DOT:
        case BorderStyle.MEDIUM_DASH_DOT_DOT:
        case BorderStyle.SLANT_DASH_DOT:
            return "dashed";
        case BorderStyle.DOUBLE:
            return "double";
        default:
            return "solid";
    }
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

function formatCellValue(cell: ICellData | undefined, style: IStyleData | null): string {
    if (!cell || cell.v == null) return "";

    if (typeof cell.v === "boolean") {
        return cell.v ? "TRUE" : "FALSE";
    }

    // Apply the number-format pattern to numeric values (this also covers dates,
    // which Univer stores as serial numbers with a date pattern). On an invalid or
    // unsupported pattern, fall back to the raw value rather than losing the data.
    const pattern = style?.n?.pattern;
    if (pattern && isFiniteNumber(cell.v)) {
        try {
            return escapeHtml(formatNumfmt(pattern, cell.v));
        } catch {
            // Fall through to the raw value.
        }
    }

    return escapeHtml(String(cell.v));
}

/**
 * Returns the text color dictated by a number-format pattern for this cell's value
 * (e.g. `[Red]` on the negative section), or `null` when the pattern specifies no
 * color for the value or the cell is not a formatted number.
 */
function resolvePatternColor(style: IStyleData | null, cell: ICellData | undefined): string | null {
    const pattern = style?.n?.pattern;
    if (!pattern || !cell || !isFiniteNumber(cell.v)) return null;

    try {
        const color = formatNumfmtColor(pattern, cell.v);
        return typeof color === "string" ? color : null;
    } catch {
        return null;
    }
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
