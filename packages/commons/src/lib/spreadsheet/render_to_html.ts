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
    type CellDocumentSegment,
    type CellMatrix,
    CellValueType,
    computeBounds,
    getCellDocumentSegments,
    getCellDocumentText,
    getFloatingDrawings,
    getVisibleSheets,
    HorizontalAlign,
    type IBorderData,
    type IBorderStyleData,
    type ICellData,
    type IColumnData,
    isFiniteNumber,
    type IRange,
    type ISheetDrawing,
    type IStyleData,
    type ITextRotation,
    type IWorksheetData,
    parseWorkbookData,
    resolveCellStyle,
    VerticalAlign,
    WrapStrategy
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
        const images = placeFloatingImages(sheet, getFloatingDrawings(workbook, sheet.id));
        const table = renderSheet(sheet, workbook.styles ?? {}, images);
        parts.push(wrapWithFloatingImages(table, images));
    }

    return parts.join("\n");
}

// #region Images

/** A floating image resolved to its content-space box (header offsets removed), ready to emit. */
interface PlacedImage {
    src: string;
    left: number;
    top: number;
    width: number;
    height: number;
    /** CSS `transform` value for rotation/flip, or "" when the image is upright and unflipped. */
    transform: string;
}

/**
 * Resolves a sheet's floating drawings to renderable boxes in the grid's content coordinate space.
 * Univer measures `transform.left`/`top` from the viewport corner, *including* the row and column
 * headers; the HTML grid has no headers, so the header sizes are subtracted to land on A1. Drawings
 * with an unsafe source or no transform are dropped.
 */
function placeFloatingImages(sheet: IWorksheetData, drawings: ISheetDrawing[]): PlacedImage[] {
    const headerWidth = sheet.rowHeader?.hidden ? 0 : (isFiniteNumber(sheet.rowHeader?.width) ? sheet.rowHeader.width : 0);
    const headerHeight = sheet.columnHeader?.hidden ? 0 : (isFiniteNumber(sheet.columnHeader?.height) ? sheet.columnHeader.height : 0);

    const placed: PlacedImage[] = [];
    for (const drawing of drawings) {
        const src = sanitizeImageSource(drawing.source);
        if (!src || !drawing.transform) continue;

        placed.push({
            src,
            left: toFinite(drawing.transform.left) - headerWidth,
            top: toFinite(drawing.transform.top) - headerHeight,
            width: toFinite(drawing.transform.width),
            height: toFinite(drawing.transform.height),
            transform: cssTransform(drawing.transform)
        });
    }
    return placed;
}

/**
 * Builds the CSS `transform` for a drawing's rotation/flip, around the default centre origin (which
 * matches Univer). Flips are applied before the rotation (so they read in the image's own axes), and
 * an upright, unflipped image yields "" so no transform is emitted.
 */
function cssTransform(transform: NonNullable<ISheetDrawing["transform"]>): string {
    const parts: string[] = [];
    if (isFiniteNumber(transform.angle) && transform.angle % 360 !== 0) {
        parts.push(`rotate(${px(transform.angle)}deg)`);
    }
    if (transform.flipX) parts.push("scaleX(-1)");
    if (transform.flipY) parts.push("scaleY(-1)");
    return parts.join(" ");
}

/**
 * Wraps a rendered sheet table in a positioned container carrying the sheet's floating images, each
 * placed absolutely at its content-space coordinates (the table is rendered from A1 with no header
 * gutter, so those coordinates apply directly). The container's `min-height` is stretched to contain
 * images that float below the table so they don't overlap following content. Returns the table
 * unchanged when the sheet has no renderable floating images.
 */
function wrapWithFloatingImages(tableHtml: string, images: PlacedImage[]): string {
    if (images.length === 0) return tableHtml;

    let maxBottom = 0;
    const tags: string[] = [];
    for (const image of images) {
        maxBottom = Math.max(maxBottom, image.top + image.height);
        const transform = image.transform ? `;transform:${image.transform}` : "";
        tags.push(
            `<img class="spreadsheet-floating-image" style="position:absolute;left:${px(image.left)}px;top:${px(image.top)}px;width:${px(image.width)}px;height:${px(image.height)}px${transform}" src="${escapeHtml(image.src)}" alt="">`
        );
    }

    return `<div class="spreadsheet-sheet" style="position:relative;min-height:${px(maxBottom)}px">\n${tableHtml}\n${tags.join("\n")}\n</div>`;
}

/** Renders the images embedded in a cell's rich-text document (`cell.p.drawings`), in order. */
function renderCellImages(cell: ICellData): string {
    const doc = cell.p;
    const drawings = doc?.drawings;
    if (!drawings) return "";

    const order = Array.isArray(doc?.drawingsOrder) ? doc.drawingsOrder : Object.keys(drawings);
    const images: string[] = [];
    for (const id of order) {
        const drawing = drawings[id];
        const src = drawing ? sanitizeImageSource(drawing.source) : null;
        if (!drawing || !src) continue;

        const dims: string[] = [];
        if (isFiniteNumber(drawing.transform?.width)) dims.push(`width:${px(drawing.transform.width)}px`);
        if (isFiniteNumber(drawing.transform?.height)) dims.push(`height:${px(drawing.transform.height)}px`);
        const style = dims.length ? ` style="${dims.join(";")}"` : "";

        images.push(`<img class="spreadsheet-cell-image"${style} src="${escapeHtml(src)}" alt="">`);
    }
    return images.join("");
}

/**
 * Validates an image source for inclusion in shared/exported HTML. Accepts only the relative
 * attachment-image URL Trilium emits (`api/attachments/<id>/image/...`, served by both the app
 * and the share view) and inline `data:image/...` URLs. Anything else (`javascript:`, remote
 * `http(s)`, etc.) returns `null` so the image is dropped. The returned value is still escaped
 * before being placed in an attribute.
 */
function sanitizeImageSource(source: string | null | undefined): string | null {
    if (typeof source !== "string") return null;
    const trimmed = source.trim();
    if (/^api\/attachments\/[a-zA-Z0-9_]+\/image\//.test(trimmed)) return trimmed;
    if (/^data:image\/(?:png|jpe?g|gif|webp|bmp|svg\+xml)[;,]/i.test(trimmed)) return trimmed;
    return null;
}

/** Rounds a px measurement to 2 decimals and renders it without a trailing `.00`. */
function px(value: number): string {
    return String(Math.round(value * 100) / 100);
}

function toFinite(value: number | undefined): number {
    return isFiniteNumber(value) ? value : 0;
}

/**
 * Grows a sheet's max row/column to enclose its floating images. An image placed in content space
 * can reach below or to the right of the last populated cell; extending the bounds makes the grid
 * render enough empty rows/columns to contain it, matching the editor. Returns the bounds unchanged
 * when no image reaches past them.
 */
function extendBoundsForImages(sheet: IWorksheetData, maxRow: number, maxCol: number, images: PlacedImage[]): { maxRow: number; maxCol: number } {
    let bottomPx = 0;
    let rightPx = 0;
    for (const image of images) {
        bottomPx = Math.max(bottomPx, image.top + image.height);
        rightPx = Math.max(rightPx, image.left + image.width);
    }
    if (bottomPx <= 0 && rightPx <= 0) return { maxRow, maxCol };

    return {
        maxRow: Math.max(maxRow, trackIndexAtPx(bottomPx, sheet.defaultRowHeight ?? 24, sheet.rowCount, (i) => sheet.rowData?.[i])),
        maxCol: Math.max(maxCol, trackIndexAtPx(rightPx, sheet.defaultColumnWidth ?? 88, sheet.columnCount, (i) => sheet.columnData?.[i]))
    };
}

/**
 * Returns the 0-based index of the last row/column needed to reach `targetPx` from the sheet
 * origin, walking the per-track sizes (`h`/`w`, hidden tracks contributing 0) and falling back to
 * `defaultSize`. Bounded by `count` (or a large cap) so a zero/degenerate size can't loop forever.
 */
function trackIndexAtPx(targetPx: number, defaultSize: number, count: number | undefined, meta: (index: number) => { hd?: number; h?: number; w?: number } | undefined): number {
    if (targetPx <= 0 || defaultSize <= 0) return 0;
    const cap = isFiniteNumber(count) && count > 0 ? count : 100000;
    let cumulative = 0;
    let index = 0;
    while (cumulative < targetPx && index < cap) {
        const track = meta(index);
        const size = track?.h ?? track?.w;
        cumulative += track?.hd ? 0 : (isFiniteNumber(size) ? size : defaultSize);
        index++;
    }
    return index - 1;
}

// #endregion

function renderSheet(sheet: IWorksheetData, styles: Record<string, IStyleData | null>, images: PlacedImage[]): string {
    const { cellData, mergeData = [], columnData = {}, rowData = {} } = sheet;

    // Determine the actual bounds (only cells with data), then extend them to cover any floating
    // images that reach past the data so the grid encloses them like the editor does.
    const bounds = computeBounds(cellData, mergeData);
    const { maxRow, maxCol } = extendBoundsForImages(sheet, bounds?.maxRow ?? -1, bounds?.maxCol ?? -1, images);
    if (maxRow < 0 || maxCol < 0) {
        return "<p>Empty sheet.</p>";
    }

    // Render from the sheet origin (A1), not the first populated cell: Univer positions floating
    // images in absolute px from A1, and emitting the leading empty rows/columns keeps the grid in
    // step with the editor so those images line up. Only trailing empty rows/columns are trimmed.
    const minRow = 0;
    const minCol = 0;

    // Build a set of cells that are hidden by merges (non-origin cells).
    const mergeMap = buildMergeMap(mergeData, minRow, maxRow, minCol, maxCol);

    // Visible column widths, reused for the colgroup and the table's fixed total width.
    const defaultWidth = sheet.defaultColumnWidth ?? 88;
    const colWidths: number[] = [];
    for (let col = minCol; col <= maxCol; col++) {
        const colMeta = columnData[col];
        if (colMeta?.hd) continue;
        colWidths.push(isFiniteNumber(colMeta?.w) ? colMeta.w : defaultWidth);
    }
    const totalWidth = colWidths.reduce((sum, w) => sum + w, 0);

    const lines: string[] = [];
    lines.push(buildTableTag(sheet, totalWidth));

    lines.push("<colgroup>");
    for (const width of colWidths) {
        lines.push(`<col style="width:${px(width)}px">`);
    }
    lines.push("</colgroup>");

    const defaultHeight = sheet.defaultRowHeight ?? 24;

    for (let row = minRow; row <= maxRow; row++) {
        const rowMeta = rowData[row];
        if (rowMeta?.hd) continue;

        const height = isFiniteNumber(rowMeta?.h) ? rowMeta.h : defaultHeight;
        // Univer leaves a cell at the bottom of its row unless it sets `vt`, while HTML centres it.
        // The row carries that default because a `td` inherits `vertical-align`, so a cell that
        // sets its own still wins.
        lines.push(`<tr style="height:${height}px;vertical-align:bottom">`);

        const neighbours: RowNeighbours = { row, minCol, maxCol, cellData, columnData, mergeMap };

        for (let col = minCol; col <= maxCol; col++) {
            if (columnData[col]?.hd) continue;

            const mergeInfo = mergeMap.get(cellKey(row, col));
            if (mergeInfo?.kind === "member") continue;

            const cell = cellData[row]?.[col];
            const cellStyle = mergeAwareStyle(resolveCellStyle(cell?.s, styles), mergeInfo, row, col, cellData, styles);
            const declarations = [buildCssText(cellStyle, cell)];
            if (clipsOverflow(cell, cellStyle, col, mergeInfo, neighbours)) declarations.push("overflow:hidden");
            const cssText = declarations.filter(Boolean).join(";");
            const value = rotate(formatCellValue(cell, cellStyle), cellStyle?.tr)
                + (cell ? renderCellImages(cell) : "");

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
function buildTableTag(sheet: IWorksheetData, totalWidth: number): string {
    // Default to shown (matching the editor) unless explicitly disabled.
    const showGridlines = sheet.showGridlines !== 0;
    const className = showGridlines ? "spreadsheet-table show-gridlines" : "spreadsheet-table";

    const styles: string[] = [];
    if (showGridlines && sheet.gridlinesColor) {
        styles.push(`--spreadsheet-gridline-color:${sanitizeCssColor(sheet.gridlinesColor)}`);
    }
    // An explicit width is required for `table-layout: fixed` (the stylesheet) to honour the
    // column widths, so cell text overflows into empty neighbours like a spreadsheet instead of
    // wrapping and growing rows — which would shift the absolutely-positioned floating images.
    styles.push(`width:${px(totalWidth)}px`);

    return `<table class="${className}" style="${styles.join(";")}">`;
}

// #region Merge handling

/** The cell a merged range is rendered from, carrying the span it covers. */
interface MergeOrigin {
    kind: "origin";
    rowSpan: number;
    colSpan: number;
    /** Last row and column of the range, clamped to the rendered bounds. */
    endRow: number;
    endColumn: number;
}

/** A cell the range covers. It is not rendered; the anchor's content fills its place. */
interface MergeMember {
    kind: "member";
    anchorRow: number;
    anchorColumn: number;
}

/**
 * Replaces a merged range's border with the one composed from the cells on its edges. Excel keeps
 * a range's outline on the member cell each edge belongs to: the anchor holds the top and the
 * left, the cell in the range's last column holds the right, and the one in its last row holds the
 * bottom. Reading only the anchor drops the two far edges, so the range renders with no line
 * between it and the range beside it. An unmerged cell is returned untouched.
 */
function mergeAwareStyle(
    style: IStyleData | null,
    merge: MergeOrigin | undefined,
    row: number,
    col: number,
    cellData: CellMatrix,
    styles: Record<string, IStyleData | null>
): IStyleData | null {
    if (!merge) return style;

    const bd: IBorderData = {
        ...style?.bd,
        r: resolveCellStyle(cellData[row]?.[merge.endColumn]?.s, styles)?.bd?.r,
        b: resolveCellStyle(cellData[merge.endRow]?.[col]?.s, styles)?.bd?.b
    };
    return { ...style, bd };
}

type MergeInfo = MergeOrigin | MergeMember;

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
            kind: "origin",
            rowSpan: endRow - startRow + 1,
            colSpan: endCol - startCol + 1,
            endRow,
            endColumn: endCol
        });

        for (let r = startRow; r <= endRow; r++) {
            for (let c = startCol; c <= endCol; c++) {
                if (r === range.startRow && c === range.startColumn) continue;
                map.set(cellKey(r, c), { kind: "member", anchorRow: range.startRow, anchorColumn: range.startColumn });
            }
        }
    }

    return map;
}

// #endregion

// #region Style resolution

function buildCssText(style: IStyleData | null, cell?: ICellData): string {
    const parts: string[] = [];

    const ht = style?.ht ?? defaultHorizontalAlign(cell);
    if (ht != null) {
        const align = horizontalAlignToCss(ht);
        if (align) parts.push(`text-align:${align}`);
    }

    if (!style) return parts.join(";");

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

    if (style.vt != null) {
        const valign = verticalAlignToCss(style.vt);
        if (valign) parts.push(`vertical-align:${valign}`);
    }

    // Cells default to nowrap (overflow into empty neighbours, like the editor); a cell with the
    // WRAP strategy opts back into normal wrapping so its text breaks within the column width.
    if (style.tb === WrapStrategy.WRAP) {
        parts.push("white-space:normal");
        parts.push("overflow-wrap:break-word");
    }

    if (style.bd) {
        appendBorderCss(parts, "border-top", style.bd.t);
        appendBorderCss(parts, "border-right", style.bd.r);
        appendBorderCss(parts, "border-bottom", style.bd.b);
        appendBorderCss(parts, "border-left", style.bd.l);
    }

    return parts.join(";");
}

/** One row's rendered layout, which is what decides whose value a cell's text would spill over. */
interface RowNeighbours {
    row: number;
    minCol: number;
    maxCol: number;
    cellData: CellMatrix;
    columnData: Record<number, IColumnData>;
    mergeMap: Map<string, MergeInfo>;
}

/**
 * Whether a cell has to clip its text at its own edge. A spreadsheet spills text into a
 * neighbouring cell only while that neighbour is empty, and never spills a number or a boolean
 * (the overflow check in `@univerjs/engine-render`). The stylesheets let every cell spill, so
 * without this a long value is drawn over the value beside it. The spill direction follows the
 * alignment, and a wrapped cell never spills to begin with.
 */
function clipsOverflow(
    cell: ICellData | undefined,
    style: IStyleData | null,
    col: number,
    merge: MergeOrigin | undefined,
    neighbours: RowNeighbours
): boolean {
    if (!hasContent(cell) || style?.tb === WrapStrategy.WRAP) return false;
    if (cell?.t === CellValueType.NUMBER || cell?.t === CellValueType.BOOLEAN) return true;

    // Rightwards, a merged cell starts looking past the last column its own range covers.
    const before = () => neighbourHasContent(col, -1, neighbours);
    const after = () => neighbourHasContent(merge?.endColumn ?? col, 1, neighbours);
    switch (style?.ht) {
        case HorizontalAlign.RIGHT: return before();
        case HorizontalAlign.CENTER: return before() || after();
        default: return after();
    }
}

/**
 * Whether the cell rendered beside `from` shows anything. Adjacency follows the rendered row, not
 * the cell matrix: hidden columns are stepped over because nothing of them reaches the page, and a
 * column a merge covers reports that range's anchor, whose text is what fills the space there.
 */
function neighbourHasContent(from: number, step: -1 | 1, neighbours: RowNeighbours): boolean {
    const { row, minCol, maxCol, cellData, columnData, mergeMap } = neighbours;

    for (let col = from + step; col >= minCol && col <= maxCol; col += step) {
        if (columnData[col]?.hd) continue;

        const info = mergeMap.get(cellKey(row, col));
        return hasContent(info?.kind === "member"
            ? cellData[info.anchorRow]?.[info.anchorColumn]
            : cellData[row]?.[col]);
    }
    return false;
}

/** Whether a cell shows anything. A cell carrying only a style is empty, as it is in the editor. */
function hasContent(cell: ICellData | undefined): boolean {
    if (!cell) return false;
    if (cell.v != null && cell.v !== "") return true;
    return getCellDocumentText(cell) !== "";
}

/**
 * The alignment Univer falls back to for a cell that sets none: numbers to the right, booleans
 * centered, everything else left (`_horizontalHandler` in `@univerjs/engine-render`). Returns
 * `undefined` for the left case so no `text-align` is emitted and the table default stands.
 */
function defaultHorizontalAlign(cell: ICellData | undefined): HorizontalAlign | undefined {
    if (cell?.t === CellValueType.NUMBER) return HorizontalAlign.RIGHT;
    if (cell?.t === CellValueType.BOOLEAN) return HorizontalAlign.CENTER;
    return undefined;
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
    if (!cell) return "";

    const rendered = formatCellDocument(cell);
    if (rendered != null) return rendered;

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
 * Wraps a cell's text in the element that carries its rotation. The wrapper keeps the rotation off
 * the `td` itself, which would take the background and borders with it, and images anchored in the
 * cell stay upright as they do in the editor.
 */
function rotate(html: string, rotation: ITextRotation | null | undefined): string {
    if (!html) return html;

    const css = rotationCss(rotation);
    return css ? `<span style="${css}">${html}</span>` : html;
}

/**
 * The CSS for Univer's text rotation. A quarter turn and stacked text become a vertical writing
 * mode, which gives the text a real vertical box the row grows to fit; any other angle falls back
 * to a transform, which turns the glyphs without reserving room for them. Excel measures the angle
 * counter-clockwise and CSS turns clockwise, so the sign flips.
 */
function rotationCss(rotation: ITextRotation | null | undefined): string | null {
    if (!rotation) return null;
    // Stacked text: upright characters reading downwards.
    if (rotation.v) return "display:inline-block;writing-mode:vertical-rl;text-orientation:upright";

    const angle = isFiniteNumber(rotation.a) ? rotation.a : 0;
    if (angle === 0) return null;
    if (angle === 90) return "display:inline-block;writing-mode:vertical-rl;transform:rotate(180deg)";
    if (angle === -90) return "display:inline-block;writing-mode:vertical-rl";
    return `display:inline-block;transform:rotate(${px(-angle)}deg)`;
}

/**
 * Renders a cell from its rich-text document, or returns `null` when the plain value is the
 * better source. The document wins when the cell has no plain value, which is how Univer stores
 * some cells, and when it carries hyperlinks that the plain value cannot express. A formatted
 * number keeps its own rendering, since the document holds a display string that can go stale.
 */
function formatCellDocument(cell: ICellData): string | null {
    const segments = getCellDocumentSegments(cell);
    const hasPlainValue = cell.v != null && cell.v !== "";
    if (hasPlainValue && (isFiniteNumber(cell.v) || !segments.some((segment) => segment.url))) {
        return null;
    }

    const parts: string[] = [];
    for (const segment of segments) {
        const text = escapeHtml(segment.text);
        parts.push(segment.url
            ? `<a href="${escapeHtml(segment.url)}" target="_blank" rel="noopener noreferrer">${text}</a>`
            : text);
    }
    return parts.join("");
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
