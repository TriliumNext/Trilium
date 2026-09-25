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

import { fnv1a } from "../utils.js";
import {
    BorderStyle,
    type CellDocumentSegment,
    DEFAULT_CELL_PADDING,
    type IPaddingData,
    type CellMatrix,
    CellValueType,
    computeBounds,
    getCellDocumentSegments,
    getCellDocumentText,
    getFloatingDrawings,
    getVisibleSheets,
    hasContent,
    HorizontalAlign,
    type IBorderData,
    type IBorderStyleData,
    type ICellData,
    type IColumnData,
    isFiniteNumber,
    type IRange,
    type IRowData,
    type ISourceRect,
    type ISheetDrawing,
    type IStyleData,
    type ITextRotation,
    type IWorksheetData,
    parseWorkbookData,
    type PersistedData,
    resolveCellStyle,
    VerticalAlign,
    WrapStrategy
} from "./workbook_model.js";

/**
 * Renders a spreadsheet note as HTML, from either its raw JSON content or an already-parsed
 * workbook. Returns an HTML string containing one `<table>` per visible sheet, preceded by a
 * `<style>` holding the cell styling (see {@link StyleClasses}) when the workbook has any.
 */
export function renderSpreadsheetToHtml(content: string | PersistedData, options: SpreadsheetRenderOptions = {}): string {
    const { ok, data } = parseWorkbookData(content);
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

    // A trimmed render answers a card, which shows a few rows of one sheet: the rest is weight
    // nobody sees. Floating images are left out with it — they are positioned in absolute pixels
    // from A1, so one anchored past the corner would hang off a grid that no longer reaches it.
    const sheets = options.trim ? visibleSheets.slice(0, 1) : visibleSheets;

    const classes = new StyleClasses();
    const parts: string[] = [];
    for (const sheet of sheets) {
        if (sheets.length > 1) {
            parts.push(`<h3>${escapeHtml(sheet.name)}</h3>`);
        }
        const images = options.trim ? [] : placeFloatingImages(sheet, getFloatingDrawings(workbook, sheet.id));
        const table = renderSheet(sheet, workbook.styles ?? {}, images, classes, options);
        parts.push(wrapWithFloatingImages(table, images));
    }

    // The stylesheet is only complete once every sheet has been rendered, so it is built last
    // and put in front, where a consumer that has to lift it out finds it without a parse.
    const stylesheet = buildStylesheet(sheets, classes);
    const body = parts.join("\n");

    return stylesheet ? `${stylesheet}\n${body}` : body;
}

export interface SpreadsheetRenderOptions {
    /**
     * Renders only the top-left corner of the first visible sheet, for a preview shown in a card
     * or a list rather than opened. A workbook that fills a card runs to megabytes otherwise, of
     * which a card shows the first handful of rows.
     */
    trim?: boolean;
}

/** How much of a sheet a trimmed render keeps — comfortably more than a card has room for. */
const TRIMMED_ROWS = 20;
const TRIMMED_COLUMNS = 15;

/**
 * Builds the `<style>` a render is preceded by: the gridline rule when any sheet asks for
 * gridlines, then one rule per distinct style. Returns "" when there is nothing to write.
 */
function buildStylesheet(sheets: IWorksheetData[], classes: StyleClasses): string {
    const rules = sheets.some((sheet) => sheet.showGridlines !== 0) ? [GRIDLINE_RULE] : [];
    rules.push(...classes.toRules());

    return rules.length ? `<style>\n${rules.join("\n")}\n</style>` : "";
}

/**
 * Gridlines for the sheets that enable them. Drawn as a real border rather than a box-shadow so
 * they sit in the same border-collapse model as the cells' own borders and line up with them, and
 * skipped on filled cells because a fill covers the grid, as it does in the editor. The selector's
 * context is in `:where()` so a cell's own border, emitted as a `.sst-*` rule, outranks it.
 *
 * Hosts set `--spreadsheet-gridline-color`, and `--spreadsheet-gridline-width` where a hairline is
 * wanted (print). A sheet carrying its own gridline color sets the first on the table element,
 * which shadows the host's for that sheet.
 */
const GRIDLINE_RULE = ":where(.spreadsheet-table.show-gridlines) td:not(.has-fill)"
    + "{border:var(--spreadsheet-gridline-width,1px) solid var(--spreadsheet-gridline-color,#ccc)}";

/**
 * Collects the declarations a render emits and hands back a class for each distinct one, so a
 * style shared by thousands of cells is written once in a `<style>` instead of on every cell.
 * Workbooks have very few distinct cell styles (Excel itself stores them in a shared table), so
 * this trades a per-cell `style` attribute for a short class name.
 *
 * Class names are derived from the declarations, not from a counter: the same style yields the
 * same name in every document, so two spreadsheets rendered onto one page share a rule rather
 * than colliding, and nothing has to be threaded through the renderer to keep names unique.
 * Every rule is scoped under `.spreadsheet-table`, so a name that happened to match an
 * application class still cannot reach anything outside a rendered sheet.
 */
class StyleClasses {
    private readonly names = new Map<string, string>();

    /**
     * Returns the class for `declarations`, or "" when there is nothing to style.
     *
     * A hash collision would show one style where another was meant, never a wrong document, and
     * 32 bits is far more than the handful of distinct styles a workbook carries.
     */
    classFor(declarations: string): string {
        if (!declarations) return "";

        let name = this.names.get(declarations);
        if (!name) {
            name = `sst-${fnv1a(declarations).toString(36)}`;
            this.names.set(declarations, name);
        }
        return name;
    }

    /**
     * Builds a rule per distinct style collected.
     *
     * The declarations cannot contain `<` or `/`: colors are validated against a pattern and every
     * other author-supplied value goes through `sanitizeCssValue`, which strips both. That is what
     * keeps a cell's styling from closing its rule, or the element these rules are written into.
     */
    toRules(): string[] {
        const rules: string[] = [];
        for (const [declarations, name] of this.names) {
            rules.push(`.spreadsheet-table .${name}{${declarations}}`);
        }
        return rules;
    }
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
    /** How far the image runs past each edge of the box, when only part of it is shown. */
    crop: Required<ISourceRect> | null;
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
            transform: cssTransform(drawing.transform),
            crop: cropInsets(drawing.srcRect)
        });
    }
    return placed;
}

/** A drawing's crop insets, or `null` when the whole image is shown. */
function cropInsets(srcRect: ISourceRect | null | undefined): Required<ISourceRect> | null {
    if (!srcRect) return null;

    const side = (value: number | undefined) => (isFiniteNumber(value) ? value : 0);
    const insets = { left: side(srcRect.left), top: side(srcRect.top), right: side(srcRect.right), bottom: side(srcRect.bottom) };
    return insets.left || insets.top || insets.right || insets.bottom ? insets : null;
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
        const box = `position:absolute;left:${px(image.left)}px;top:${px(image.top)}px`
            + `;width:${px(image.width)}px;height:${px(image.height)}px${transform}`;
        const src = escapeHtml(image.src);

        if (!image.crop) {
            tags.push(`<img class="spreadsheet-floating-image" style="${box}" src="${src}" alt="">`);
            continue;
        }

        // A cropped drawing keeps the box as its window and holds the whole image inside it,
        // enlarged by the insets and pulled back by them, which is how the editor draws it.
        const { left, top, right, bottom } = image.crop;
        tags.push(
            `<span class="spreadsheet-floating-image" style="${box};display:block;overflow:hidden">`
            + `<img style="position:absolute;left:${px(-left)}px;top:${px(-top)}px`
            + `;width:${px(image.width + left + right)}px;height:${px(image.height + top + bottom)}px" src="${src}" alt="">`
            + `</span>`
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

    const defaultHeight = sheet.defaultRowHeight ?? 24;
    const defaultWidth = sheet.defaultColumnWidth ?? 88;
    return {
        maxRow: Math.max(maxRow, trackIndexAtPx(bottomPx, sheet.rowCount, (i) => {
            const meta = sheet.rowData?.[i];
            return meta?.hd ? 0 : rowHeight(meta, defaultHeight);
        })),
        maxCol: Math.max(maxCol, trackIndexAtPx(rightPx, sheet.columnCount, (i) => {
            const meta = sheet.columnData?.[i];
            return meta?.hd ? 0 : (isFiniteNumber(meta?.w) ? meta.w : defaultWidth);
        }))
    };
}

/**
 * A row's rendered height. Univer keeps the height it measured for a self-sizing row in `ah` and
 * uses that unless the row was sized by hand (`ia === 0`), where `h` wins (`getRowHeight` in
 * `@univerjs/core`). Reading only `h` leaves a self-sizing row at the sheet default, which shortens
 * the grid and pulls the floating images, placed in the editor's coordinates, out of line with it.
 */
function rowHeight(meta: IRowData | undefined, defaultHeight: number): number {
    const measured = meta?.ah;
    if ((meta?.ia == null || meta.ia === 1) && isFiniteNumber(measured)) return measured;

    const height = meta?.h;
    return isFiniteNumber(height) ? height : defaultHeight;
}

/**
 * Returns the 0-based index of the last row/column needed to reach `targetPx` from the sheet
 * origin, walking the per-track sizes. Bounded by `count` (or a large cap) so a degenerate size
 * can't loop forever, and an axis whose tracks all measure zero extends by nothing at all.
 */
function trackIndexAtPx(targetPx: number, count: number | undefined, size: (index: number) => number): number {
    if (targetPx <= 0) return 0;
    const cap = isFiniteNumber(count) && count > 0 ? count : 100000;
    let cumulative = 0;
    let index = 0;
    while (cumulative < targetPx && index < cap) {
        cumulative += size(index);
        index++;
    }
    return cumulative > 0 ? index - 1 : 0;
}

// #endregion

function renderSheet(sheet: IWorksheetData, styles: Record<string, IStyleData | null>, images: PlacedImage[], classes: StyleClasses, options: SpreadsheetRenderOptions = {}): string {
    const { cellData, mergeData = [], columnData = {}, rowData = {} } = sheet;

    // A sheet often carries formatting far past its data: a fill applied to whole rows leaves tens
    // of thousands of empty cells, each of which would become a `td` the browser has to lay out for
    // a band it draws as one rectangle. The grid is bounded by the cells that hold something, and
    // falls back to every cell for a sheet that is nothing but formatting. Then it is extended to
    // cover any floating image that reaches past the data, so the grid encloses it as the editor does.
    // A merge widens it as before, except one applied to entire rows or columns, which would
    // pull the sheet back out to the far edge of the grid.
    const bounds = computeBounds(cellData, boundingMerges(mergeData, sheet), (cell) => holdsSomething(cell, styles))
        ?? computeBounds(cellData, mergeData);
    const extended = extendBoundsForImages(sheet, bounds?.maxRow ?? -1, bounds?.maxCol ?? -1, images);
    // A trimmed render keeps the corner a card has room for. The cap applies last, so it bounds
    // whatever the data, a merge or an image asked for rather than competing with them.
    const maxRow = options.trim ? Math.min(extended.maxRow, TRIMMED_ROWS - 1) : extended.maxRow;
    const maxCol = options.trim ? Math.min(extended.maxCol, TRIMMED_COLUMNS - 1) : extended.maxCol;
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
    const merged = mergeMap.size > 0;
    const cssCache = new Map<string, string>();

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

    const cols: string[] = [];
    for (let index = 0; index < colWidths.length;) {
        let span = 1;
        while (index + span < colWidths.length && colWidths[index + span] === colWidths[index]) span++;
        cols.push(`<col${span > 1 ? ` span="${span}"` : ""} class="${classes.classFor(`width:${px(colWidths[index])}px`)}">`);
        index += span;
    }
    lines.push(`<colgroup>${cols.join("")}</colgroup>`);

    const defaultHeight = sheet.defaultRowHeight ?? 24;
    const heights: number[] = [];
    for (let row = minRow; row <= maxRow; row++) {
        heights[row] = rowData[row]?.hd ? 0 : rowHeight(rowData[row], defaultHeight);
    }

    for (let row = minRow; row <= maxRow; row++) {
        const rowMeta = rowData[row];
        if (rowMeta?.hd) continue;

        const height = heights[row];
        // Univer leaves a cell at the bottom of its row unless it sets `vt`, while HTML centres it.
        // The row carries that default because a `td` inherits `vertical-align`, so a cell that
        // sets its own still wins.
        const rowClass = classes.classFor(`height:${height}px;vertical-align:bottom`);

        const neighbours: RowNeighbours = { row, minCol, maxCol, cellData, columnData, mergeMap, defaultWidth };
        const cells: string[] = [];

        for (let col = minCol; col <= maxCol; col++) {
            if (columnData[col]?.hd) continue;

            const mergeInfo = merged ? mergeMap.get(cellKey(row, col)) : undefined;
            if (mergeInfo?.kind === "member") continue;

            const cell = cellData[row]?.[col];
            const cellStyle = mergeAwareStyle(resolveCellStyle(cell?.s, styles), mergeInfo, row, col, cellData, styles);
            const bound = spillBound(cell, cellStyle, col, mergeInfo, neighbours);
            const padding = cellPadding(cellStyle);
            const boxHeight = spannedHeight(heights, row, mergeInfo?.endRow ?? row)
                - padding.t - padding.b
                - collapsedBorderHeight(cellStyle, row, mergeInfo?.endRow ?? row, col, rowData, cellData, styles);
            const base = cssTextFor(cellStyle, cell, mergeInfo, cssCache);
            const cssText = hasContent(cell)
                ? `${base ? `${base};` : ""}padding:${px(padding.t)}px ${px(padding.r)}px ${px(padding.b)}px ${px(padding.l)}px`
                : base;
            const text = rotate(formatCellValue(cell, cellStyle), cellStyle, classes);
            const value = (isTurned(cellStyle?.tr)
                ? turnedBox(text, boxHeight, cellStyle, classes)
                : cellBox(text, bound, boxHeight, classes)) + (cell ? renderCellImages(cell) : "");

            const attrs: string[] = [];
            // Cells with a background fill carry `has-fill` so the stylesheet can suppress
            // gridlines under the fill, matching the editor (a fill covers the grid).
            const names = [cellStyle?.bg?.rgb ? "has-fill" : "", classes.classFor(cssText)].filter(Boolean);
            if (names.length) attrs.push(`class="${names.join(" ")}"`);
            if (mergeInfo) {
                if (mergeInfo.rowSpan > 1) attrs.push(`rowspan="${mergeInfo.rowSpan}"`);
                if (mergeInfo.colSpan > 1) attrs.push(`colspan="${mergeInfo.colSpan}"`);
            }

            cells.push(`<td${attrs.length ? " " + attrs.join(" ") : ""}>${value}</td>`);
        }

        // A row on one line: it reads like the grid it came from, and drops a newline per cell,
        // which on a large sheet is tens of thousands of them. Whitespace between cells has no
        // effect on a table's layout, so nothing depends on the newlines being there.
        lines.push(`<tr class="${rowClass}">${cells.join("")}</tr>`);
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

// #region Dark mode

/**
 * What Excel renders an automatic font in. `parse_from_xlsx` drops that default so a cell can
 * take the editor's themed text color; static HTML has no such default to fall back on.
 */
const AUTOMATIC_TEXT_COLOR = "#000";

/** The CSS values of the color names `numfmt` answers with for a `[Red]`-style pattern. */
const NAMED_COLORS: Record<string, string> = {
    black: "#000000", blue: "#0000ff", cyan: "#00ffff", green: "#008000",
    magenta: "#ff00ff", red: "#ff0000", white: "#ffffff", yellow: "#ffff00"
};

/**
 * The declarations setting `property` to `color`: the color as it stands, then again paired with
 * what a dark theme shows instead, for the browser to choose between by `color-scheme` — which the
 * client sets from `--theme-style` and the share theme sets outright. Print declares none and so
 * takes the light half, which is what belongs on paper.
 *
 * The plain declaration comes first and is never dropped. A browser that does not know
 * `light-dark()` discards the second and renders as it always did, which matters as far down as
 * the iOS 15 the mobile app still builds for: an unrecognised value takes its whole declaration
 * with it, so a cell would lose the fill or border entirely rather than merely fail to darken.
 *
 * `build` wraps the color in whatever else the property needs, a border's width and style.
 */
function themedDeclarations(property: string, color: string, build: (color: string) => string = (it) => it): string[] {
    const declarations = [`${property}:${build(color)}`];

    const inverted = invertColor(color);
    if (inverted) declarations.push(`${property}:${build(`light-dark(${color},${inverted})`)}`);

    return declarations;
}

/**
 * Inverts a color the way Univer does on a dark theme, so a preview matches the editor
 * (`invertColorByMatrix`, which its canvas color service runs over every color it paints).
 *
 * Each channel keeps a third of its own value and loses two thirds of the other two, then gains
 * one. That inverts lightness while leaving the channel ordering — the hue — alone: a pale yellow
 * fill comes back dark brown rather than the blue a plain `255 - c` would give, and a dark fill
 * comes back pale. A grey inverts to its exact complement either way.
 *
 * The coefficients are Univer's own rounded literals rather than exact thirds, which is what keeps
 * the two implementations agreeing to the byte.
 */
function invertColor(color: string): string | null {
    let inverted = INVERTED_COLORS.get(color);
    if (inverted === undefined) {
        inverted = invertColorUncached(color);
        INVERTED_COLORS.set(color, inverted);
    }
    return inverted;
}

/** A workbook draws from a handful of colors, and every cell using one asks for the same answer. */
const INVERTED_COLORS = new Map<string, string | null>();

function invertColorUncached(color: string): string | null {
    const rgb = parseColor(color);
    if (!rgb) return null;

    const [r, g, b] = rgb.map((channel) => channel / 255);
    const inverted = [
        0.333 * r - 0.667 * g - 0.667 * b + 1,
        -0.667 * r + 0.333 * g - 0.667 * b + 1,
        -0.667 * r - 0.667 * g + 0.333 * b + 1
    ];

    return `#${inverted
        .map((channel) => Math.round(Math.min(1, Math.max(0, channel)) * 255))
        .map((channel) => channel.toString(16).padStart(2, "0"))
        .join("")}`;
}

/** Reads `#rgb`, `#rrggbb` and the named colors, which is every form the renderer emits. */
function parseColor(color: string): [number, number, number] | null {
    const named = NAMED_COLORS[color.toLowerCase()];
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(named ?? color)?.[1];
    if (!hex) return null;

    const pairs = hex.length === 3 ? [...hex].map((c) => c + c) : [hex.slice(0, 2), hex.slice(2, 4), hex.slice(4, 6)];
    return pairs.map((pair) => Number.parseInt(pair, 16)) as [number, number, number];
}

// #endregion

// #region Style resolution

/**
 * `buildCssText` for a cell, reusing the result across the cells that share a style. Beyond the
 * style, the declarations depend on the cell's value type (`defaultHorizontalAlign`) and, where the
 * style carries a number format, on the value itself (`resolvePatternColor`). So a formatted cell,
 * a cell whose style is written inline rather than shared, and a merge origin (whose borders
 * `mergeAwareStyle` rewrites per range) are all built every time.
 */
function cssTextFor(
    style: IStyleData | null,
    cell: ICellData | undefined,
    merge: MergeOrigin | undefined,
    cache: Map<string, string>
): string {
    const shared = cell?.s;
    if (merge || style?.n?.pattern || (shared !== undefined && typeof shared !== "string")) {
        return buildCssText(style, cell);
    }

    const key = `${shared ?? ""}|${cell?.t ?? ""}`;
    let cssText = cache.get(key);
    if (cssText === undefined) {
        cssText = buildCssText(style, cell);
        cache.set(key, cssText);
    }
    return cssText;
}

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
    if (style.bg?.rgb) parts.push(...themedDeclarations("background-color", sanitizeCssColor(style.bg.rgb)));

    // A color produced by the number-format pattern (e.g. `[Red]` for negatives) takes
    // precedence over the cell's own text color, matching Univer's rendering. A filled cell that
    // sets neither falls back to the color Excel shows an automatic font in, rather than to the
    // surrounding text color: the fill comes from the workbook while that color comes from the
    // theme around it, so a pale fill is unreadable wherever the theme is dark.
    const patternColor = resolvePatternColor(style, cell);
    const textColor = patternColor ?? style.cl?.rgb ?? (style.bg?.rgb ? AUTOMATIC_TEXT_COLOR : undefined);
    if (textColor) parts.push(...themedDeclarations("color", sanitizeCssColor(textColor)));

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
    defaultWidth: number;
}

/** How far a cell's text can run past its own edges, in px on each side. */
interface SpillBound {
    before: number;
    after: number;
}

/**
 * The room a cell's text has before it reaches a cell that shows something. A spreadsheet runs text
 * across the empty cells beside it and cuts it at the first occupied one, and keeps a number, a
 * boolean or a cell set to CLIP inside its own edges (the overflow check in
 * `@univerjs/engine-render`, and `WrapStrategy` in `@univerjs/core`). Text that nothing stops is
 * given the room to the edge of the sheet, since the box that carries it clips both axes at once
 * and so always needs a width. Returns `null` only when there is nothing to bound.
 */
function spillBound(
    cell: ICellData | undefined,
    style: IStyleData | null,
    col: number,
    merge: MergeOrigin | undefined,
    neighbours: RowNeighbours
): SpillBound | null {
    if (!hasContent(cell) || style?.tb === WrapStrategy.WRAP) return null;

    // Turned text stays in its own cell, as do a number, a boolean and a cell set to CLIP.
    if (cell?.t === CellValueType.NUMBER || cell?.t === CellValueType.BOOLEAN
        || style?.tb === WrapStrategy.CLIP || isTurned(style?.tr)) {
        return { before: 0, after: 0 };
    }

    // Text runs the way its alignment points; rightwards a merged cell starts past its own range.
    const leftwards = () => spillRoom(col, -1, neighbours).width;
    const rightwards = () => spillRoom(merge?.endColumn ?? col, 1, neighbours).width;

    // Centred text has to stay centred on its own cell, so the room it is given is the same on
    // both sides: growing one side further would carry the middle of the text away from the
    // middle of the cell, which is where the editor keeps it.
    if (style?.ht === HorizontalAlign.CENTER) {
        const room = Math.min(leftwards(), rightwards());
        return { before: room, after: room };
    }

    return style?.ht === HorizontalAlign.RIGHT
        ? { before: leftwards(), after: 0 }
        : { before: 0, after: rightwards() };
}

/**
 * The rendered width beside `from`, and whether a cell showing something is what ended it. The walk
 * follows the rendered row: a hidden column takes up no width because nothing of it reaches the
 * page, and a column a merge covers shows that range's anchor.
 */
function spillRoom(from: number, step: -1 | 1, neighbours: RowNeighbours): { width: number; stopped: boolean } {
    const { minCol, maxCol, columnData, defaultWidth } = neighbours;

    let width = 0;
    for (let col = from + step; col >= minCol && col <= maxCol; col += step) {
        if (columnData[col]?.hd) continue;
        if (hasContent(cellShownAt(col, neighbours))) return { width, stopped: true };

        const columnWidth = columnData[col]?.w;
        width += isFiniteNumber(columnWidth) ? columnWidth : defaultWidth;
    }
    return { width, stopped: false };
}

/** The cell filling `col` in this row: a column a merge covers shows the range's anchor. */
function cellShownAt(col: number, neighbours: RowNeighbours): ICellData | undefined {
    const { row, cellData, mergeMap } = neighbours;

    const info = mergeMap.size ? mergeMap.get(cellKey(row, col)) : undefined;
    return info?.kind === "member" ? cellData[info.anchorRow]?.[info.anchorColumn] : cellData[row]?.[col];
}

/**
 * A cell's text is laid out on the font's own leading, as the editor lays it out. The page around it
 * sets a line height for prose, which is taller than a spreadsheet row expects and pushes the text
 * out of the bottom of a box measured from the row.
 */
const CELL_LINE_HEIGHT = "line-height:normal";

/**
 * Wraps a cell's text in the box that fixes its size. An HTML row grows to whatever it holds, while
 * a spreadsheet row is exactly as tall as it says and clips what does not fit, so without this the
 * grid drifts from the geometry the sheet declares and every absolutely placed image drifts with
 * it. The box also carries the room the text has to run sideways, widened by it and clipped there,
 * with the negative margins cancelling the extra width so the table's own layout is untouched.
 */
function cellBox(html: string, bound: SpillBound | null, height: number, classes: StyleClasses): string {
    if (!html) return html;

    const parts = ["display:block", "overflow:hidden"];
    if (height > 0) parts.push(`max-height:${px(height)}px`);
    if (bound && (bound.before || bound.after)) {
        parts.push(`width:calc(100% + ${px(bound.before + bound.after)}px)`);
        if (bound.before) parts.push(`margin-left:${px(-bound.before)}px`);
        if (bound.after) parts.push(`margin-right:${px(-bound.after)}px`);
    }
    parts.push(CELL_LINE_HEIGHT);

    // A box is shaped by its row's height rather than by anything the cell says, so a sheet has
    // only a handful of distinct ones however many cells it holds.
    return `<span class="${classes.classFor(parts.join(";"))}">${html}</span>`;
}

/** Whether a cell's text is turned at all, in any of the ways Univer can turn it. */
function isTurned(rotation: ITextRotation | null | undefined): boolean {
    if (!rotation) return false;
    return Boolean(rotation.v) || (isFiniteNumber(rotation.a) && rotation.a !== 0);
}

/**
 * Whether a rotation is painted by a transform rather than laid out, which is every angle other
 * than a quarter turn. Only those hang from a cell edge; a quarter turn is a writing mode, which
 * the cell's own alignments already place.
 */
function rotatesByTransform(rotation: ITextRotation | null | undefined): boolean {
    if (!rotation || rotation.v || !isFiniteNumber(rotation.a)) return false;
    return rotation.a !== 0 && rotation.a !== 90 && rotation.a !== -90;
}

/**
 * The box a turned cell's text sits in. It fills the cell rather than hugging the text, so what it
 * clips is the cell itself: a box only as tall as the text's own line would cut a band across the
 * turn and drop everything above and below it. Filling the cell takes the placement away from the
 * cell's alignments, so the box carries them itself.
 */
function turnedBox(html: string, height: number, style: IStyleData | null, classes: StyleClasses): string {
    if (!html) return html;

    const parts = [
        "display:flex",
        "overflow:hidden",
        `align-items:${turnedAlign(style?.vt)}`,
        `justify-content:${turnedJustify(style)}`
    ];
    if (height > 0) parts.push(`height:${px(height)}px`);
    parts.push(CELL_LINE_HEIGHT);

    return `<span class="${classes.classFor(parts.join(";"))}">${html}</span>`;
}

/** Where a turned cell puts its text down the cell, following the cell's vertical alignment. */
function turnedAlign(verticalAlign: number | null | undefined): string {
    if (verticalAlign === VerticalAlign.MIDDLE) return "center";
    return verticalAlign === VerticalAlign.TOP ? "flex-start" : "flex-end";
}

/** Where it puts it across the cell: the cell's own alignment when it states one, else the side the turn is anchored to. */
function turnedJustify(style: IStyleData | null): string {
    const align = style?.ht ?? (tiltAnchor(style) === "right" ? HorizontalAlign.RIGHT : HorizontalAlign.LEFT);
    if (align === HorizontalAlign.CENTER) return "center";
    return align === HorizontalAlign.RIGHT ? "flex-end" : "flex-start";
}

/** The height a cell covers, summing the rows a `rowspan` reaches across. */
function spannedHeight(heights: number[], from: number, to: number): number {
    let total = 0;
    for (let row = from; row <= to; row++) total += heights[row];
    return total;
}

/**
 * The height a cell's borders take from its row. Under `border-collapse` an edge is shared with the
 * cell across it and the wider of the two borders wins, so a cell with none of its own still gives
 * up half an edge to a bordered neighbour. Reading only the cell's own borders leaves a cell that
 * fills its row exactly, which a turned one does, a border's half taller than the row it sits in.
 */
function collapsedBorderHeight(
    style: IStyleData | null,
    row: number,
    endRow: number,
    col: number,
    rowData: Record<number, IRowData>,
    cellData: CellMatrix,
    styles: Record<string, IStyleData | null>
): number {
    const width = (border: IBorderStyleData | null | undefined) =>
        (!border || border.s === BorderStyle.NONE ? 0 : Number.parseFloat(borderStyleToWidth(border.s)));

    const above = resolveCellStyle(cellData[renderedRow(row, -1, rowData)]?.[col]?.s, styles);
    const below = resolveCellStyle(cellData[renderedRow(endRow, 1, rowData)]?.[col]?.s, styles);

    return (Math.max(width(style?.bd?.t), width(above?.bd?.b))
        + Math.max(width(style?.bd?.b), width(below?.bd?.t))) / 2;
}

/** The row an edge is shared with: the nearest one that is drawn, since a hidden row draws nothing. */
function renderedRow(from: number, step: -1 | 1, rowData: Record<number, IRowData>): number {
    let row = from + step;
    while (row >= 0 && rowData[row]?.hd) row += step;
    return row;
}

/** The padding a cell is laid out with, which the box has to leave room for inside the row. */
function cellPadding(style: IStyleData | null): Required<IPaddingData> {
    const padding = style?.pd;
    const side = (value: number | undefined, fallback: number) => (isFiniteNumber(value) ? value : fallback);
    return {
        t: side(padding?.t, DEFAULT_CELL_PADDING.t),
        r: side(padding?.r, DEFAULT_CELL_PADDING.r),
        b: side(padding?.b, DEFAULT_CELL_PADDING.b),
        l: side(padding?.l, DEFAULT_CELL_PADDING.l)
    };
}

/**
 * The merges that say something about how far a sheet reaches. One applied to entire rows or columns
 * is a formatting gesture rather than a statement that the sheet runs that far, so it is left out
 * and clamped into the content instead.
 *
 * Across, that gesture is recognised by the sheet declaring every column Excel has: a banner merged
 * by hand stops well short of that, and keeps widening the grid as any other merge does. Down, the
 * same test is not available, because a sheet's row count is capped at the rows it uses rather than
 * carried over from the file. So a merge is taken as the gesture there when it reaches the last
 * declared row *and* covers at least the rows every sheet starts with, which no one merges by hand.
 */
function boundingMerges(mergeData: IRange[], sheet: IWorksheetData): IRange[] {
    const columnCount = sheet.columnCount ?? 0;
    const lastRow = (sheet.rowCount ?? 0) - 1;

    return mergeData.filter((range) =>
        !(columnCount >= EXCEL_COLUMN_COUNT && range.startColumn === 0 && range.endColumn >= columnCount - 1)
        && !(range.startRow === 0 && range.endRow >= lastRow && range.endRow - range.startRow + 1 >= DEFAULT_ROW_COUNT));
}

/** The rows a sheet starts with, which both importers floor at and the editor creates. */
const DEFAULT_ROW_COUNT = 1000;

/** The columns an Excel sheet has, which only a sheet formatted across all of them declares. */
const EXCEL_COLUMN_COUNT = 16384;

/**
 * Whether a cell holds something the grid has to reach, which is what it is bounded by. A formula
 * counts even when its result is blank, since the cell is part of the sheet's data, and so does a
 * border: an empty bordered cell is a drawn box, a form or a table outline someone means to keep.
 * A fill does not, because it comes from colouring whole rows, which would carry the grid out to
 * the far edge for a band nobody reads.
 */
function holdsSomething(cell: ICellData, styles: Record<string, IStyleData | null>): boolean {
    if (cell.f || hasContent(cell)) return true;

    const borders = resolveCellStyle(cell.s, styles)?.bd;
    return Boolean(borders && (borders.t?.s || borders.r?.s || borders.b?.s || borders.l?.s));
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
    parts.push(...themedDeclarations(property, color, (it) => `${width} ${style} ${it}`));
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
function rotate(html: string, style: IStyleData | null, classes: StyleClasses): string {
    if (!html) return html;

    const css = rotationCss(style?.tr, style?.vt);
    return css ? `<span class="${classes.classFor(css)}">${html}</span>` : html;
}

/**
 * The CSS for Univer's text rotation. Univer measures the angle the way CSS turns, clockwise from
 * the horizontal, so a negative angle lifts the text and a positive one drops it. A quarter turn
 * and stacked text become a vertical writing mode, which gives the text a real vertical box the row
 * grows to fit; any other angle falls back to a transform, which turns the glyphs without reserving
 * room for them.
 */
function rotationCss(rotation: ITextRotation | null | undefined, verticalAlign: number | null | undefined): string | null {
    // `vertical-align` keeps the turned text off the line box's baseline, whose descender gap
    // would otherwise add height the row has to absorb.
    const ROTATED = "display:inline-block;vertical-align:top";

    if (!rotation) return null;
    // Stacked text: upright characters reading downwards.
    if (rotation.v) return `${ROTATED};writing-mode:vertical-rl;text-orientation:upright`;

    const angle = isFiniteNumber(rotation.a) ? rotation.a : 0;
    if (angle === 0) return null;
    if (angle === -90) return `${ROTATED};writing-mode:vertical-rl;transform:rotate(180deg)`;
    if (angle === 90) return `${ROTATED};writing-mode:vertical-rl`;

    // A middle-aligned cell turns its text about the centre, which leaves the shape centred.
    if (verticalAlign === VerticalAlign.MIDDLE) return `${ROTATED};transform:rotate(${px(angle)}deg)`;

    // Otherwise the text hangs from the cell edge it is aligned to, turning about the end of the
    // string that meets it: lifting text meets the bottom with its start and the top with its end.
    // Turning about that corner swings the text's own line height past it, so the shift takes that
    // back; `lh` is the line height itself, which keeps the correction right at any font size.
    const swing = Math.round(Math.sin(Math.abs(angle) * (Math.PI / 180)) * 1000) / 1000;
    const fromTop = verticalAlign === VerticalAlign.TOP;
    const lifts = angle < 0;
    const origin = `${lifts === fromTop ? "right" : "left"} ${fromTop ? "top" : "bottom"}`;
    return `${ROTATED};transform:translateX(calc(1lh * ${lifts === fromTop ? -swing : swing})) rotate(${px(angle)}deg)`
        + `;transform-origin:${origin}`;
}

/**
 * The side of its cell turned text is anchored to, or `null` when the cell has no turned text. The
 * string meets the cell edge it is aligned to with one of its ends, and which end that is flips
 * between an alignment to the top and one to the bottom or the middle.
 */
function tiltAnchor(style: IStyleData | null): "left" | "right" | null {
    const rotation = style?.tr;
    if (!rotatesByTransform(rotation) || !isFiniteNumber(rotation?.a)) return null;

    const lifts = rotation.a < 0;
    return lifts === (style?.vt === VerticalAlign.TOP) ? "right" : "left";
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
    if (!ESCAPABLE.test(text)) return text;

    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

const ESCAPABLE = /[&<>"']/;

// #endregion
