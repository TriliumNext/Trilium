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
 * conditional formatting, filters, charts, comments, frozen panes and defined names are dropped.
 * Data validation is carried for the common constraint types (dropdown lists, numeric/date/text
 * bounds) via the SHEET_DATA_VALIDATION_PLUGIN resource. Rich text is flattened to plain text and
 * hyperlinks keep their display text but lose the link. Theme/indexed colors are resolved
 * against the standard Office palette (see `THEME_COLORS`), which is approximate when the
 * file ships a custom theme.
 */

import ExcelJS from "exceljs";

import "./exceljs_augmentation.js";

import {
    BorderStyle,
    CellValueType,
    type DataValidationRule,
    HorizontalAlign,
    type IBorderData,
    type IBorderStyleData,
    type ICellData,
    type IColumnData,
    type IRange,
    type IRowData,
    type IStyleData,
    type IWorkbookData,
    type IWorksheetData,
    type PersistedData,
    SHEET_DATA_VALIDATION_RESOURCE,
    SHEET_DRAWING_RESOURCE,
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
    const drawingsBySheet: Record<string, SheetDrawings> = {};
    const validationsBySheet: Record<string, DataValidationRule[]> = {};

    wb.eachSheet((ws, sheetIndex) => {
        // Deterministic ids keyed off position; the workbook id/locale are reassigned on load
        // (see persistence.tsx) and sheet view state keys off this id, so stability is all we need.
        const id = `sheet-${sheetIndex}`;
        sheetOrder.push(id);
        const sheet = readSheet(ws, id);
        sheets[id] = sheet;

        const drawings = readImages(wb, ws, sheet, id);
        if (drawings) drawingsBySheet[id] = drawings;

        const validations = readDataValidations(ws, id);
        if (validations.length > 0) validationsBySheet[id] = validations;
    });

    const workbook: IWorkbookData = { sheetOrder, styles: {}, sheets };

    // Both plugin payloads are JSON strings keyed by sheet id, matching the shape the editor
    // persists; Univer reconciles their unit ids on load.
    const resources: IWorkbookData["resources"] = [];
    // Floating images go in the SHEET_DRAWING_PLUGIN resource.
    if (Object.keys(drawingsBySheet).length > 0) {
        resources.push({ name: SHEET_DRAWING_RESOURCE, data: JSON.stringify(drawingsBySheet) });
    }
    // Data-validation rules (dropdowns, numeric/date bounds) go in the SHEET_DATA_VALIDATION_PLUGIN resource.
    if (Object.keys(validationsBySheet).length > 0) {
        resources.push({ name: SHEET_DATA_VALIDATION_RESOURCE, data: JSON.stringify(validationsBySheet) });
    }
    if (resources.length > 0) workbook.resources = resources;

    return { version: 1, workbook };
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
        showGridlines: ws.views?.[0]?.showGridLines === false ? 0 : 1,
        // Record Univer's default header gutters so the share renderer's image-offset subtraction
        // matches the offset baked into each drawing's transform (see HEADER_WIDTH/HEIGHT below).
        rowHeader: { width: HEADER_WIDTH, hidden: 0 },
        columnHeader: { height: HEADER_HEIGHT, hidden: 0 }
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

// #region Images

/** Univer's default header gutter sizes (px); drawing transforms are measured including them. */
const HEADER_WIDTH = 46;
const HEADER_HEIGHT = 20;

interface SheetDrawings {
    data: Record<string, object>;
    order: string[];
}

interface CellAnchor {
    row: number;
    rowOffset: number;
    column: number;
    columnOffset: number;
}

/**
 * Reads a worksheet's floating images into Univer drawings. Each image's bytes (from exceljs media)
 * become an inline base64 `data:` URL, and its exceljs cell anchor inverts into Univer's
 * `sheetTransform` from/to plus an absolute `transform`. Returns null when the sheet has no
 * embeddable images. Unsupported formats (anything but png/jpeg/gif) are skipped.
 */
function readImages(wb: ExcelJS.Workbook, ws: ExcelJS.Worksheet, sheet: IWorksheetData, sheetId: string): SheetDrawings | null {
    const images = ws.getImages();
    if (images.length === 0) return null;

    const data: Record<string, object> = {};
    const order: string[] = [];
    images.forEach((image, index) => {
        const drawing = buildDrawing(wb, sheet, sheetId, image, index);
        if (!drawing) return;
        data[drawing.drawingId] = drawing;
        order.push(drawing.drawingId);
    });

    return order.length > 0 ? { data, order } : null;
}

function buildDrawing(wb: ExcelJS.Workbook, sheet: IWorksheetData, sheetId: string, image: ReturnType<ExcelJS.Worksheet["getImages"]>[number], index: number): { drawingId: string } & Record<string, unknown> | null {
    const source = mediaToDataUrl(wb.getImage(Number(image.imageId)));
    if (!source) return null;

    const box = anchorToBox(sheet, image.range);
    if (!box) return null;

    // Univer keeps the orientation fields on every transform; imports are always upright.
    const orientation = { angle: 0, flipX: false, flipY: false, skewX: 0, skewY: 0 };
    const cellAnchor = { from: box.from, to: box.to, ...orientation };

    return {
        // The unitId is reconciled against the loaded workbook, so a placeholder is fine.
        unitId: "imported",
        subUnitId: sheetId,
        drawingId: `image-${sheetId}-${index}`,
        drawingType: 0,
        imageSourceType: "BASE64",
        source,
        // The transform is in viewport space (includes the header gutters), matching the editor.
        transform: { left: box.left + HEADER_WIDTH, top: box.top + HEADER_HEIGHT, width: box.width, height: box.height, ...orientation },
        sheetTransform: cellAnchor,
        axisAlignSheetTransform: cellAnchor
    };
}

/** Converts an exceljs media entry to a base64 `data:` URL, or null for an unsupported format. */
function mediaToDataUrl(media: { extension?: string; buffer?: Uint8Array | ArrayBuffer } | undefined): string | null {
    const mime = imageMime(media?.extension);
    if (!mime || !media?.buffer) return null;
    const bytes = media.buffer instanceof Uint8Array ? media.buffer : new Uint8Array(media.buffer);
    return `data:${mime};base64,${bytesToBase64(bytes)}`;
}

function imageMime(extension: string | undefined): string | null {
    switch ((extension ?? "").toLowerCase()) {
        case "png": return "image/png";
        case "jpeg":
        case "jpg": return "image/jpeg";
        case "gif": return "image/gif";
        default: return null;
    }
}

/**
 * Inverts an exceljs image range into Univer's content-space box: the `from`/`to` cell anchors plus
 * the absolute `left`/`top`/`width`/`height`. The top-left comes from `tl`; the bottom-right from
 * `br` (two-cell anchor) or `tl + ext` (one-cell anchor).
 */
function anchorToBox(sheet: IWorksheetData, range: ExcelJS.ImageRange): { from: CellAnchor; to: CellAnchor; left: number; top: number; width: number; height: number } | null {
    const tl = range?.tl as { col: number; row: number } | undefined;
    if (!tl) return null;

    const left = colPointPx(sheet, tl.col);
    const top = rowPointPx(sheet, tl.row);

    const br = range.br as { col: number; row: number } | undefined;
    const ext = (range as { ext?: { width: number; height: number } }).ext;

    let to: CellAnchor;
    let right: number;
    let bottom: number;
    if (br) {
        to = pointToAnchor(sheet, br.col, br.row);
        right = colPointPx(sheet, br.col);
        bottom = rowPointPx(sheet, br.row);
    } else if (ext) {
        right = left + ext.width;
        bottom = top + ext.height;
        to = pxToAnchor(sheet, right, bottom);
    } else {
        return null;
    }

    return { from: pointToAnchor(sheet, tl.col, tl.row), to, left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

/** A fractional `{col, row}` point → Univer cell anchor (index + px offset into that cell). */
function pointToAnchor(sheet: IWorksheetData, col: number, row: number): CellAnchor {
    const column = Math.floor(col);
    const rowIndex = Math.floor(row);
    return {
        row: rowIndex,
        rowOffset: (row - rowIndex) * rowHeightPx(sheet, rowIndex),
        column,
        columnOffset: (col - column) * columnWidthPx(sheet, column)
    };
}

/** An absolute px point → Univer cell anchor, walking the per-track sizes to find the cell. */
function pxToAnchor(sheet: IWorksheetData, x: number, y: number): CellAnchor {
    const [column, columnOffset] = trackAtPx(x, (c) => columnWidthPx(sheet, c));
    const [row, rowOffset] = trackAtPx(y, (r) => rowHeightPx(sheet, r));
    return { row, rowOffset, column, columnOffset };
}

function trackAtPx(target: number, sizeOf: (index: number) => number): [number, number] {
    if (target <= 0) return [0, 0];
    let cumulative = 0;
    for (let index = 0; index < 100_000; index++) {
        const size = sizeOf(index);
        if (size <= 0) continue;
        if (cumulative + size > target) return [index, target - cumulative];
        cumulative += size;
    }
    return [0, 0];
}

/** Absolute x of a fractional column point (content space, no header gutter). */
function colPointPx(sheet: IWorksheetData, col: number): number {
    const column = Math.floor(col);
    let sum = 0;
    for (let c = 0; c < column; c++) sum += columnWidthPx(sheet, c);
    return sum + (col - column) * columnWidthPx(sheet, column);
}

function rowPointPx(sheet: IWorksheetData, row: number): number {
    const rowIndex = Math.floor(row);
    let sum = 0;
    for (let r = 0; r < rowIndex; r++) sum += rowHeightPx(sheet, r);
    return sum + (row - rowIndex) * rowHeightPx(sheet, rowIndex);
}

function columnWidthPx(sheet: IWorksheetData, col: number): number {
    const w = sheet.columnData?.[col]?.w;
    return isFiniteNumber(w) ? w : (sheet.defaultColumnWidth ?? 88);
}

function rowHeightPx(sheet: IWorksheetData, row: number): number {
    const h = sheet.rowData?.[row]?.h;
    return isFiniteNumber(h) ? h : (sheet.defaultRowHeight ?? 24);
}

/** Base64-encodes raw bytes in both Node (server import) and the browser. */
function bytesToBase64(bytes: Uint8Array): string {
    if (typeof Buffer !== "undefined") {
        return Buffer.from(bytes).toString("base64");
    }
    let binary = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
}

// #endregion

// #region Data validation

/** A 0-based cell coordinate, used while coalescing per-cell validations back into ranges. */
interface CellRef {
    row: number;
    column: number;
}

/**
 * Reads a worksheet's data-validation rules into Univer rules. exceljs expands a rule's `sqref`
 * (e.g. `D2:I6`) into one entry per cell, so cells sharing an identical config are grouped and
 * their addresses coalesced back into rectangular ranges. Only constraint types Univer understands
 * are emitted; a validation with no usable constraint is skipped. Returns an empty array when the
 * sheet has none.
 */
function readDataValidations(ws: ExcelJS.Worksheet, sheetId: string): DataValidationRule[] {
    const model = ws.dataValidations.model;

    // Group cells by an identical validation config; the key is order-stable across the sheet.
    const groups = new Map<string, { config: ExcelJS.DataValidation; cells: CellRef[] }>();
    for (const [address, config] of Object.entries(model)) {
        /* v8 ignore next -- defensive: exceljs model entries always carry a type */
        if (!config?.type) continue;
        const cell = parseAddress(address);
        /* v8 ignore next -- defensive: exceljs validation keys are always well-formed addresses */
        if (!cell) continue;
        const key = JSON.stringify([config.type, config.operator ?? null, config.formulae ?? null]);
        const group = groups.get(key) ?? { config, cells: [] };
        group.cells.push({ row: cell.row, column: cell.col });
        groups.set(key, group);
    }

    const rules: DataValidationRule[] = [];
    let index = 0;
    for (const { config, cells } of groups.values()) {
        const rule = buildValidationRule(config, coalesceRanges(cells), `dv-${sheetId}-${index}`);
        if (rule) {
            rules.push(rule);
            index++;
        }
    }
    return rules;
}

/**
 * Translates one exceljs validation config into a Univer rule, or null when its constraint can't be
 * represented (an empty list). exceljs's type/operator strings already match Univer's enums; a
 * `list`'s inline options are JSON-encoded the way Univer's list validator expects, while numeric,
 * date, text-length and custom constraints carry their formula bounds and operator verbatim.
 */
function buildValidationRule(config: ExcelJS.DataValidation, ranges: IRange[], uid: string): DataValidationRule | null {
    const rule: DataValidationRule = { uid, type: config.type, ranges };

    if (config.type === "list") {
        const raw = config.formulae?.[0];
        if (raw == null) return null;
        const inline = parseInlineListOptions(String(raw));
        // An inline list ("a,b,c") becomes a JSON option array; a range reference ($A$1:$A$3) is
        // passed through as the formula, which Univer resolves the same way.
        rule.formula1 = inline ? JSON.stringify(inline) : String(raw);
        return rule;
    }

    /* v8 ignore next -- defensive: exceljs's DataValidation.formulae is always an array */
    const [formula1, formula2] = config.formulae ?? [];
    if (formula1 != null) rule.formula1 = String(formula1);
    if (formula2 != null) rule.formula2 = String(formula2);
    if (config.operator) rule.operator = config.operator;
    return rule;
}

/**
 * Parses Excel's inline list syntax — a single comma-separated string wrapped in double quotes,
 * e.g. `"a,b,c"` — into its option array. Returns null when the formula isn't an inline list (a
 * range/name reference) so the caller can pass it through as a formula instead. Empty options are
 * dropped, matching Univer's `serializeListOptions`.
 */
function parseInlineListOptions(formula: string): string[] | null {
    if (formula.length < 2 || !formula.startsWith("\"") || !formula.endsWith("\"")) return null;
    // Excel does not trim whitespace inside an inline list, so options are split verbatim.
    return formula.slice(1, -1).split(",").filter((option) => option.length > 0);
}

/**
 * Merges a set of cells into a minimal-ish list of rectangular ranges with a greedy sweep: each
 * unclaimed cell grows right as far as contiguous cells allow, then down as many full-width rows as
 * possible. A solid block collapses to a single range; scattered cells stay separate.
 */
function coalesceRanges(cells: CellRef[]): IRange[] {
    const present = new Set(cells.map((c) => cellKey(c.row, c.column)));
    const claimed = new Set<string>();
    const ranges: IRange[] = [];

    const sorted = [...cells].sort((a, b) => a.row - b.row || a.column - b.column);
    for (const { row, column } of sorted) {
        if (claimed.has(cellKey(row, column))) continue;

        let endColumn = column;
        while (present.has(cellKey(row, endColumn + 1)) && !claimed.has(cellKey(row, endColumn + 1))) endColumn++;

        let endRow = row;
        while (rowSpanFree(present, claimed, endRow + 1, column, endColumn)) endRow++;

        for (let r = row; r <= endRow; r++) {
            for (let c = column; c <= endColumn; c++) claimed.add(cellKey(r, c));
        }
        ranges.push({ startRow: row, endRow, startColumn: column, endColumn });
    }
    return ranges;
}

/** True when every cell of `row` across `[startColumn, endColumn]` is present and unclaimed. */
function rowSpanFree(present: Set<string>, claimed: Set<string>, row: number, startColumn: number, endColumn: number): boolean {
    for (let c = startColumn; c <= endColumn; c++) {
        if (!present.has(cellKey(row, c)) || claimed.has(cellKey(row, c))) return false;
    }
    return true;
}

function cellKey(row: number, column: number): string {
    return `${row},${column}`;
}

// #endregion

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
