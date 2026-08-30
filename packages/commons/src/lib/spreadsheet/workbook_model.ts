/**
 * Shared reader for UniversJS workbook JSON, used by the spreadsheet emitters
 * (`render_to_html`, `render_to_xlsx`, `render_to_csv`).
 *
 * Only the subset of UniversJS types needed for rendering is defined here, to avoid
 * depending on `@univerjs/core`. This is intentionally a superset of every emitter's
 * needs: HTML uses gridlines/number-format colors, XLSX uses formulas/wrap/rotation,
 * CSV uses just values and bounds — they all share one model.
 *
 * Parsing is deliberately lenient (`parseWorkbookData` returns `null` on failure)
 * because each emitter reports errors differently: HTML returns placeholder markup,
 * XLSX throws. The shared layer hands back the parsed data and lets the caller decide.
 */

// #region UniversJS type subset

export interface PersistedData {
    version: number;
    workbook: IWorkbookData;
}

export interface IWorkbookData {
    sheetOrder: string[];
    name?: string;
    styles?: Record<string, IStyleData | null>;
    sheets: Record<string, IWorksheetData>;
    /** Plugin payloads (e.g. floating drawings); each `data` is itself a JSON string. */
    resources?: IResource[];
}

export interface IResource {
    name: string;
    data: string;
}

export interface IWorksheetData {
    id: string;
    name: string;
    hidden?: number;
    rowCount?: number;
    columnCount?: number;
    defaultColumnWidth?: number;
    defaultRowHeight?: number;
    mergeData?: IRange[];
    cellData: CellMatrix;
    rowData?: Record<number, IRowData>;
    columnData?: Record<number, IColumnData>;
    showGridlines?: number;
    gridlinesColor?: string | null;
    rowHeader?: ISheetHeader;
    columnHeader?: ISheetHeader;
}

/** The row-number / column-letter gutters. Univer's drawing transforms are offset by their size. */
export interface ISheetHeader {
    width?: number;
    height?: number;
    hidden?: number;
}

export type CellMatrix = Record<number, Record<number, ICellData>>;

export interface ICellData {
    v?: string | number | boolean | null;
    t?: number | null;
    s?: IStyleData | string | null;
    f?: string | null;
    /** Rich-text document payload; carries images anchored inside the cell. */
    p?: ICellDocumentData | null;
}

export interface ICellDocumentData {
    /** Univer's unit id for the cell document. */
    id?: string;
    /** Layout Univer recomputes from the cell's own style every time it renders the cell. */
    documentStyle?: Record<string, unknown>;
    drawings?: Record<string, ISheetDrawing>;
    drawingsOrder?: string[];
    /** Text content, present when the cell holds rich text such as a link or mixed formatting. */
    body?: ICellDocumentBody;
}

export interface ICellDocumentBody {
    /** Univer's flat text buffer, with structure encoded as control characters. */
    dataStream?: string;
    /** Spans of `dataStream` carrying extra properties, hyperlinks among them. */
    customRanges?: ICellCustomRange[];
    /** Formatting runs and the paragraph/section markers Univer lays the text out from. */
    textRuns?: { ts: Record<string, unknown>; st: number; ed: number }[];
    paragraphs?: { startIndex: number }[];
    sectionBreaks?: { startIndex: number }[];
}

/** A span of a cell's document text. `startIndex` and `endIndex` are both inclusive. */
export interface ICellCustomRange {
    rangeId?: string;
    rangeType?: CustomRangeType;
    startIndex?: number;
    endIndex?: number;
    properties?: { url?: string; refId?: string };
}

export interface ISheetDrawing {
    drawingId?: string;
    imageSourceType?: string;
    source?: string;
    transform?: IDrawingTransform | null;
    /** Cell-anchored extent (top-left/bottom-right), used by the XLSX emitter's two-cell anchor. */
    sheetTransform?: ISheetDrawingAnchor | null;
    /** How much of the image is cropped away, in px of the drawing's own box on each side. */
    srcRect?: ISourceRect | null;
}

/**
 * A drawing's crop. Univer draws the whole image enlarged by these insets and offset by them, with
 * the drawing's box as the window onto it, so each value is how far past that edge the image runs.
 */
export interface ISourceRect {
    left?: number;
    top?: number;
    right?: number;
    bottom?: number;
}

export interface ISheetDrawingAnchor {
    from?: IDrawingCellAnchor;
    to?: IDrawingCellAnchor;
}

/** A drawing corner anchored to a cell plus a px offset into it (`row`/`column` are 0-based). */
export interface IDrawingCellAnchor {
    row?: number;
    rowOffset?: number;
    column?: number;
    columnOffset?: number;
}

/** A drawing's absolute box. `left`/`top` are px from the sheet origin (A1); cell images omit them. */
export interface IDrawingTransform {
    left?: number;
    top?: number;
    width?: number;
    height?: number;
    /** Clockwise rotation in degrees, applied around the box centre. */
    angle?: number;
    flipX?: boolean;
    flipY?: boolean;
}

export interface IStyleData {
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
    tb?: number | null;
    tr?: ITextRotation | null;
    bd?: IBorderData | null;
    n?: INumberFormat | null;
    pd?: IPaddingData | null;
}

/** Cell padding in px. Univer leaves out the sides it does not set; see `DEFAULT_CELL_PADDING`. */
export interface IPaddingData {
    t?: number;
    r?: number;
    b?: number;
    l?: number;
}

/** The padding Univer lays a cell out with when its style names none. */
export const DEFAULT_CELL_PADDING = { t: 0, r: 2, b: 2, l: 2 };

export interface INumberFormat {
    pattern?: string | null;
}

export interface ITextDecoration {
    s?: number;
}

export interface IColorStyle {
    rgb?: string | null;
}

export interface ITextRotation {
    a?: number;
    v?: number;
}

export interface IBorderData {
    t?: IBorderStyleData | null;
    r?: IBorderStyleData | null;
    b?: IBorderStyleData | null;
    l?: IBorderStyleData | null;
}

export interface IBorderStyleData {
    s?: number;
    cl?: IColorStyle;
}

export interface IRange {
    startRow: number;
    endRow: number;
    startColumn: number;
    endColumn: number;
}

export interface IRowData {
    h?: number;
    hd?: number;
    /** Height Univer measured for a row that sizes itself to its content. */
    ah?: number;
    /** Whether the row sizes itself to its content. Absent counts as yes. */
    ia?: number;
}

export interface IColumnData {
    w?: number;
    hd?: number;
}

// Univer's cell value type (`ICellData.t`). Tells the editor how to render/sort a value
// independently of the JS type of `v` (e.g. FORCE_STRING keeps a numeric-looking string
// left-aligned and un-coerced).
export const enum CellValueType {
    STRING = 1,
    NUMBER = 2,
    BOOLEAN = 3,
    FORCE_STRING = 4
}

/** Univer's kinds of `ICellCustomRange` (`CustomRangeType` in @univerjs/core). */
export const enum CustomRangeType {
    HYPERLINK = 0
}

// Alignment enums (from UniversJS).
export const enum HorizontalAlign {
    LEFT = 1,
    CENTER = 2,
    RIGHT = 3
}

export const enum VerticalAlign {
    TOP = 1,
    MIDDLE = 2,
    BOTTOM = 3
}

// Wrap strategies (from UniversJS). OVERFLOW runs long text across the empty cells beside it,
// CLIP cuts it at the cell edge, and WRAP breaks it inside the cell.
export const enum WrapStrategy {
    UNSPECIFIED = 0,
    OVERFLOW = 1,
    CLIP = 2,
    WRAP = 3
}

// Border style enum — mirrors Univer's `BorderStyleTypes` (@univerjs/core).
export const enum BorderStyle {
    NONE = 0,
    THIN = 1,
    HAIR = 2,
    DOTTED = 3,
    DASHED = 4,
    DASH_DOT = 5,
    DASH_DOT_DOT = 6,
    DOUBLE = 7,
    MEDIUM = 8,
    MEDIUM_DASHED = 9,
    MEDIUM_DASH_DOT = 10,
    MEDIUM_DASH_DOT_DOT = 11,
    SLANT_DASH_DOT = 12,
    THICK = 13
}

// #endregion

export interface WorkbookParseResult {
    /** `false` only when the content is not valid JSON (vs. valid JSON that lacks a workbook). */
    ok: boolean;
    data: PersistedData | null;
}

/**
 * Reads the content of a spreadsheet note. `ok` is `false` only when a string is not valid
 * JSON; valid-but-empty JSON (e.g. `null`, `{}`) returns `ok: true` with the parsed value, so
 * callers can distinguish an unparseable payload from a structurally empty one. Callers should
 * additionally check `data.workbook?.sheets` and report an empty/invalid workbook in their own
 * format.
 *
 * Already-parsed data is passed through, so a caller holding a workbook — the XLSX preview,
 * which gets one from `parseXlsxToWorkbook` — does not serialize it just to have it parsed back.
 */
export function parseWorkbookData(content: string | PersistedData): WorkbookParseResult {
    if (typeof content !== "string") {
        return { ok: true, data: content };
    }

    try {
        return { ok: true, data: JSON.parse(content) };
    } catch {
        return { ok: false, data: null };
    }
}

/**
 * Returns the sheets to render, in `sheetOrder`, skipping hidden ones. Falls back to
 * `Object.keys` order when `sheetOrder` is absent.
 */
export function getVisibleSheets(workbook: IWorkbookData): IWorksheetData[] {
    const sheetIds = workbook.sheetOrder ?? Object.keys(workbook.sheets);
    return sheetIds
        .map((id) => workbook.sheets[id])
        .filter((s): s is IWorksheetData => Boolean(s) && !s.hidden);
}

/**
 * Resolves a cell's style reference to a concrete style object. Univer stores a cell's
 * style either inline (an object) or as a key into the workbook's shared `styles` table.
 */
export function resolveCellStyle(
    s: ICellData["s"],
    styles: Record<string, IStyleData | null>
): IStyleData | null {
    if (!s) return null;
    if (typeof s === "string") return styles[s] ?? null;
    return s;
}

/** A run of a cell's document text, carrying the hyperlink it sits inside. */
export interface CellDocumentSegment {
    text: string;
    url?: string;
}

/**
 * Splits a cell's rich-text document into runs of plain and linked text. Univer stores a
 * hyperlink as a `customRange` holding the target and the offsets it covers in `dataStream`,
 * so the runs are cut on those offsets. A run keeps its `url` only when the target is safe to
 * export, so an emitter can use it as-is. Returns an empty array when the cell carries no
 * document, which is the common case: Univer writes `p` only for a rich-text cell.
 */
export function getCellDocumentSegments(cell: ICellData | undefined): CellDocumentSegment[] {
    const body = cell?.p?.body;
    const stream = typeof body?.dataStream === "string" ? body.dataStream : "";
    if (!stream) return [];

    const segments: CellDocumentSegment[] = [];
    let cursor = 0;
    for (const link of linkRanges(body?.customRanges, stream.length)) {
        if (link.start > cursor) {
            segments.push({ text: stripDataStreamControls(stream.slice(cursor, link.start)) });
        }
        segments.push({ text: stripDataStreamControls(stream.slice(link.start, link.end + 1)), url: link.url });
        cursor = link.end + 1;
    }
    if (cursor < stream.length) {
        segments.push({ text: stripDataStreamControls(stream.slice(cursor)) });
    }

    return trimTrailingBreaks(segments);
}

/**
 * Returns the plain text of a cell Univer stored as a rich-text document. Univer writes `p`
 * without a matching `v` for some cells, such as a link typed into an empty cell, so an emitter
 * that reads only `v` renders them blank.
 */
export function getCellDocumentText(cell: ICellData | undefined): string {
    return getCellDocumentSegments(cell).map((segment) => segment.text).join("");
}

/** Whether a cell shows anything. A cell carrying only a style is empty, as it is in the editor. */
export function hasContent(cell: ICellData | undefined): boolean {
    if (!cell) return false;
    if (cell.v != null && cell.v !== "") return true;
    return getCellDocumentText(cell) !== "";
}

/**
 * Builds the rich-text document Univer stores for a hyperlinked cell: the text terminated by a
 * paragraph and a section break, plus one custom range covering it. `rangeId` identifies the link
 * inside the cell. Returns `null` when there is no text to link or the target is not safe to
 * store, so the caller keeps the cell as plain text.
 *
 * `documentStyle` stays empty because Univer overwrites its margins, page size and render config
 * from the cell's own style on every render.
 */
export function buildLinkedCellDocument(text: string, url: unknown, rangeId: string): ICellDocumentData | null {
    const target = sanitizeLinkUrl(url);
    if (!text || !target) return null;

    return {
        id: "d",
        documentStyle: {},
        body: {
            dataStream: `${text}\r\n`,
            textRuns: [{ ts: {}, st: 0, ed: text.length }],
            paragraphs: [{ startIndex: text.length }],
            sectionBreaks: [{ startIndex: text.length + 1 }],
            customRanges: [{
                rangeId,
                rangeType: CustomRangeType.HYPERLINK,
                startIndex: 0,
                endIndex: text.length - 1,
                properties: { url: target, refId: rangeId }
            }]
        }
    };
}

/** Converts a whole `dataStream` to plain text, dropping the terminator it ends with. */
export function normalizeDataStream(dataStream: unknown): string {
    if (typeof dataStream !== "string") return "";
    return stripDataStreamControls(dataStream).replace(/\n+$/, "");
}

/** The hyperlink ranges to cut on, in document order, clamped to the stream and non-overlapping. */
function linkRanges(customRanges: ICellCustomRange[] | undefined, length: number) {
    const links: { start: number; end: number; url: string }[] = [];
    for (const range of customRanges ?? []) {
        const url = sanitizeLinkUrl(range?.properties?.url);
        if (!url) continue;
        if (!isFiniteNumber(range.startIndex) || !isFiniteNumber(range.endIndex)) continue;

        const start = Math.max(0, Math.trunc(range.startIndex));
        const end = Math.min(length - 1, Math.trunc(range.endIndex));
        if (end >= start) links.push({ start, end, url });
    }
    links.sort((a, b) => a.start - b.start);

    const ordered: typeof links = [];
    let cursor = 0;
    for (const link of links) {
        if (link.start < cursor) continue;
        ordered.push(link);
        cursor = link.end + 1;
    }
    return ordered;
}

/**
 * Validates a hyperlink target before it reaches an export. Accepts the absolute `http`, `https`
 * and `mailto` URLs Univer's link dialog writes; anything else, `javascript:` among them, returns
 * `null` so the run is exported as plain text.
 */
function sanitizeLinkUrl(url: unknown): string | null {
    if (typeof url !== "string") return null;
    const trimmed = url.trim();
    return /^(?:https?:\/\/|mailto:)[^\u0000-\u0020\u007F]+$/i.test(trimmed) ? trimmed : null;
}

/**
 * Removes the structural placeholders Univer encodes as C0 control characters, the backspace
 * character standing in for an embedded drawing, and turns its paragraph and section breaks
 * into newlines.
 */
function stripDataStreamControls(text: string): string {
    return text
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
        .replace(/\r\n|[\r\n]/g, "\n");
}

/** Drops the terminator every stream ends with, along with any run it leaves empty. */
function trimTrailingBreaks(segments: CellDocumentSegment[]): CellDocumentSegment[] {
    while (segments.length > 0) {
        const last = segments[segments.length - 1];
        last.text = last.text.replace(/\n+$/, "");
        if (last.text) break;
        segments.pop();
    }
    return segments;
}

export interface Bounds {
    minRow: number;
    maxRow: number;
    minCol: number;
    maxCol: number;
}

/**
 * Computes the inclusive bounding rectangle of all populated cells, extended to cover any merged
 * ranges. Returns `null` when there are no cells and no merges (empty sheet). Pass `counts` to
 * bound the rectangle by a subset of the cells, such as only the ones holding something.
 */
export function computeBounds(
    cellData: CellMatrix,
    mergeData: IRange[] = [],
    counts?: (cell: ICellData) => boolean
): Bounds | null {
    let minRow = Infinity;
    let maxRow = -Infinity;
    let minCol = Infinity;
    let maxCol = -Infinity;

    for (const rowStr of Object.keys(cellData)) {
        const row = Number(rowStr);
        const cols = cellData[row];
        for (const colStr of Object.keys(cols)) {
            const col = Number(colStr);
            if (counts && !counts(cols[col])) continue;

            if (minRow > row) minRow = row;
            if (maxRow < row) maxRow = row;
            if (minCol > col) minCol = col;
            if (maxCol < col) maxCol = col;
        }
    }

    for (const range of mergeData) {
        if (minRow > range.startRow) minRow = range.startRow;
        if (maxRow < range.endRow) maxRow = range.endRow;
        if (minCol > range.startColumn) minCol = range.startColumn;
        if (maxCol < range.endColumn) maxCol = range.endColumn;
    }

    if (minRow > maxRow) return null;
    return { minRow, maxRow, minCol, maxCol };
}

/** Checks that a value is a finite number (guards against stringified payloads from JSON). */
export function isFiniteNumber(v: unknown): v is number {
    return typeof v === "number" && Number.isFinite(v);
}

/** Univer stores floating sheet images (drawings) under this workbook resource. */
export const SHEET_DRAWING_RESOURCE = "SHEET_DRAWING_PLUGIN";

/** Univer stores per-sheet data-validation rules (dropdowns, numeric/date constraints) here. */
export const SHEET_DATA_VALIDATION_RESOURCE = "SHEET_DATA_VALIDATION_PLUGIN";

/**
 * A Univer data-validation rule. Matches `IDataValidationRule` from `@univerjs/core` (the subset the
 * XLSX importer emits). For a `list` dropdown, `formula1` is the JSON-encoded option array that
 * Univer's list validator parses via `deserializeListOptions`; for numeric/date constraints,
 * `formula1`/`formula2` are the bound values and `operator` selects the comparison.
 */
export interface DataValidationRule {
    uid: string;
    /** Univer's `DataValidationType` string (e.g. "list", "whole", "decimal", "date", "custom"). */
    type: string;
    /** Univer's `DataValidationOperator` string, for numeric/date/text-length constraints. */
    operator?: string;
    formula1?: string;
    formula2?: string;
    ranges: IRange[];
}

/**
 * Extracts the floating drawings for one sheet from the `SHEET_DRAWING_PLUGIN` resource, in
 * their stored z-order. The resource `data` is itself a JSON string keyed by sheet id:
 * `{ [sheetId]: { data: { [drawingId]: drawing }, order: string[] } }`. Returns an empty array
 * when the resource is absent, unparseable, or carries no drawings for the sheet.
 */
export function getFloatingDrawings(workbook: IWorkbookData, sheetId: string): ISheetDrawing[] {
    const resource = workbook.resources?.find((r) => r.name === SHEET_DRAWING_RESOURCE);
    if (!resource?.data) return [];

    let parsed: unknown;
    try {
        parsed = JSON.parse(resource.data);
    } catch {
        return [];
    }

    const sheetEntry = (parsed as Record<string, { data?: Record<string, ISheetDrawing>; order?: string[] }> | null)?.[sheetId];
    const data = sheetEntry?.data;
    if (!data) return [];

    const order = Array.isArray(sheetEntry?.order) ? sheetEntry.order : Object.keys(data);
    return order.map((id) => data[id]).filter((d): d is ISheetDrawing => Boolean(d));
}

/**
 * Extracts the data-validation rules for one sheet from the `SHEET_DATA_VALIDATION_PLUGIN` resource.
 * The resource `data` is a JSON string keyed by sheet id: `{ [sheetId]: DataValidationRule[] }`.
 * Returns an empty array when the resource is absent, unparseable, or carries none for the sheet.
 */
export function getDataValidations(workbook: IWorkbookData, sheetId: string): DataValidationRule[] {
    const resource = workbook.resources?.find((r) => r.name === SHEET_DATA_VALIDATION_RESOURCE);
    if (!resource?.data) return [];

    let parsed: unknown;
    try {
        parsed = JSON.parse(resource.data);
    } catch {
        return [];
    }

    const rules = (parsed as Record<string, DataValidationRule[]> | null)?.[sheetId];
    return Array.isArray(rules) ? rules.filter((r): r is DataValidationRule => Boolean(r)) : [];
}
