import type { SerializedStroke } from "@triliumnext/commons";
import { decodePoints, encodePoints, MAX_STROKE_SIZE } from "@triliumnext/commons/src/lib/handwriting.js";
import { getStroke, getStrokeOutlinePoints, type StrokePoint } from "perfect-freehand";

export const PAPER_STYLES = [ "ruled", "grid", "dots", "blank" ] as const;
export type PaperStyle = (typeof PAPER_STYLES)[number];

/** Whether the note is a column of pages, or a canvas without bounds. */
export const INK_LAYOUTS = [ "pages", "infinite" ] as const;
export type InkLayout = (typeof INK_LAYOUTS)[number];

/** The size of a page (A4 at 96 dpi) and the gap between two pages, in world units. */
export const PAGE_WIDTH = 794;
export const PAGE_HEIGHT = 1123;
export const PAGE_GAP = 24;

/** The shortest and the longest side of a sheet with a size of its own, and how many a note holds. */
const MIN_SHEET_SIDE = 16;
const MAX_SHEET_SIDE = 20000;
const MAX_SHEETS = 10000;

/** The size of a sheet, in world units. */
export interface SheetSize {
    width: number;
    height: number;
}

/** A sheet of a note laid out in pages: its top left corner and its size, in world units. */
export interface Sheet extends SheetSize {
    x: number;
    y: number;
}

export type InkTool = "pen" | "highlighter";

/** The color of a stroke that follows the theme's text color. */
export const AUTO_COLOR = "auto";
/** The opacity of the highlighter's ink. */
export const HIGHLIGHTER_ALPHA = 0.35;

export interface Bounds {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

export interface Stroke {
    tool: InkTool;
    /** A CSS color, or {@link AUTO_COLOR}. */
    color: string;
    size: number;
    /** Whether the input device reported no pressure, so the width follows the speed instead. */
    simulatePressure: boolean;
    /** Flat `x, y, pressure` triples in world units, with the pressure between 0 and 1. */
    points: number[];
    /**
     * How much the pressure changes the width, from 0 to 100, as set when the stroke was drawn.
     * `undefined` stands for {@link DEFAULT_PRESSURE_SENSITIVITY}.
     */
    sensitivity?: number;
    bounds: Bounds;
    /** The position of the stroke in the drawing order. */
    order: number;
    path?: Path2D;
    /** The JSON of the stroke in the saved document, kept as a stroke does not change once drawn. */
    json?: string;
}

/** A picture on the paper, under the ink. An image does not change: moving it makes a new one. */
export interface InkImage {
    /** Where the attachment holding the picture is served from, which matches {@link IMAGE_URL_PATTERN}. */
    url: string;
    /** The top left corner and the size, in world units. */
    x: number;
    y: number;
    width: number;
    height: number;
    bounds: Bounds;
    /** The position of the image in the drawing order of the images. */
    order: number;
}

/**
 * The URL of an image attachment of a note. The server's `checkImageAttachments()` finds the
 * attachments a note uses by this shape, and no other URL is loaded from a saved document.
 */
export const IMAGE_URL_PATTERN = /^api\/attachments\/[a-zA-Z0-9_]+\/image\/[^/?#]*$/;

/**
 * The URL of the PDF attachment that a note has as its paper. The server's
 * `checkImageAttachments()` finds the attachment by this shape, and no other URL is loaded from a
 * saved document.
 */
export const PDF_URL_PATTERN = /^api\/attachments\/[a-zA-Z0-9_]+\/open$/;

export interface InkDocument {
    paper: PaperStyle;
    layout: InkLayout;
    strokes: Stroke[];
    images?: InkImage[];
    /** The PDF whose pages lie on the sheets, which matches {@link PDF_URL_PATTERN}. */
    pdf?: string;
    /** The sizes of the first sheets, as a PDF gave them. The sheets after them are A4. */
    sheets?: SheetSize[];
    /** The view the note was last saved at. */
    view?: InkView;
}

/** A view of a note: the world point at the middle of the screen, and the zoom. */
export interface InkView {
    x: number;
    y: number;
    zoom: number;
}

interface SerializedImage {
    url: string;
    x: number;
    y: number;
    w: number;
    h: number;
}

interface SerializedDocument {
    version: 1;
    paper: PaperStyle;
    layout?: InkLayout;
    pdf?: string;
    /** The `[width, height]` of each sheet with a size of its own. */
    sheets?: number[][];
    images?: SerializedImage[];
    strokes: SerializedStroke[];
    view?: InkView;
}

/**
 * The pressure sensitivity of a stroke that saved none: perfect-freehand's `thinning` of 0.6,
 * which every stroke had before the sensitivity could be set.
 */
export const DEFAULT_PRESSURE_SENSITIVITY = 60;

export function createStroke(
    props: Pick<Stroke, "tool" | "color" | "size" | "simulatePressure" | "points" | "order" | "sensitivity">
): Stroke {
    const { sensitivity, ...rest } = props;
    return {
        ...rest,
        ...(sensitivity !== undefined && sensitivity !== DEFAULT_PRESSURE_SENSITIVITY && { sensitivity }),
        bounds: computeBounds(props.points, props.size)
    };
}

export function createImage(props: Omit<InkImage, "bounds">): InkImage {
    const { x, y, width, height } = props;
    return { ...props, bounds: { minX: x, minY: y, maxX: x + width, maxY: y + height } };
}

/**
 * Returns the saved document. It joins the JSON of each stroke, which `serializeStroke()` computes
 * once per stroke, so saving a large document does not encode every point again.
 */
export function serializeInkDocument(
    paper: PaperStyle, strokes: Iterable<Stroke>, view?: InkView, layout: InkLayout = "pages",
    images: InkImage[] = [], pdf?: string, sheets: SheetSize[] = []
): string {
    const sorted = [ ...strokes ].sort((a, b) => a.order - b.order);
    const parts: string[] = [];
    for (const stroke of sorted) {
        parts.push(serializeStroke(stroke));
    }
    const savedView = view
        ? `,"view":${JSON.stringify({ x: round(view.x, 10), y: round(view.y, 10), zoom: round(view.zoom, 1000) })}`
        : "";
    const savedSheets = sheets.length
        ? `,"sheets":${JSON.stringify(sheets.map(({ width, height }) => [ round(width, 10), round(height, 10) ]))}`
        : "";
    const savedImages = images.length
        ? `,"images":${JSON.stringify([ ...images ].sort((a, b) => a.order - b.order).map(serializeImage))}`
        : "";
    return `{"version":1,"paper":${JSON.stringify(paper)},"layout":${JSON.stringify(layout)}${savedView}${pdf ? `,"pdf":${JSON.stringify(pdf)}` : ""}${savedSheets}${savedImages},"strokes":[${parts.join(",")}]}`;
}

/** Returns the JSON of `stroke` in the saved document, computed on the first call. */
export function serializeStroke(stroke: Stroke): string {
    if (stroke.json === undefined) {
        const serialized: SerializedStroke = {
            ...(stroke.tool === "highlighter" && { t: "h" as const }),
            ...(stroke.color !== AUTO_COLOR && { c: stroke.color }),
            w: stroke.size,
            ...(stroke.simulatePressure && { s: 1 as const }),
            ...(stroke.sensitivity !== undefined && { k: stroke.sensitivity }),
            p: encodePoints(stroke.points)
        };
        stroke.json = JSON.stringify(serialized);
    }
    return stroke.json;
}

function serializeImage(image: InkImage): SerializedImage {
    return {
        url: image.url,
        x: round(image.x, 10), y: round(image.y, 10),
        w: round(image.width, 10), h: round(image.height, 10)
    };
}

export function parseInkDocument(content: string | null | undefined): InkDocument {
    const empty: InkDocument = { paper: "ruled", layout: "pages", strokes: [], images: [] };
    if (!content) return empty;

    let raw: Partial<SerializedDocument>;
    try {
        raw = JSON.parse(content);
    } catch {
        return empty;
    }
    if (!raw || !Array.isArray(raw.strokes)) return empty;

    const strokes: Stroke[] = [];
    for (const serialized of raw.strokes) {
        if (!Array.isArray(serialized?.p) || serialized.p.length < 3) continue;
        const points = decodePoints(serialized.p);
        if (!points) continue;
        strokes.push(createStroke({
            tool: serialized.t === "h" ? "highlighter" : "pen",
            color: typeof serialized.c === "string" ? serialized.c : AUTO_COLOR,
            size: isFiniteNumber(serialized.w) && serialized.w > 0 ? Math.min(MAX_STROKE_SIZE, serialized.w) : 3,
            simulatePressure: serialized.s === 1,
            points,
            order: strokes.length,
            sensitivity: isFiniteNumber(serialized.k) ? Math.round(Math.min(100, Math.max(0, serialized.k))) : undefined
        }));
    }

    const paper = PAPER_STYLES.includes(raw.paper as PaperStyle) ? raw.paper as PaperStyle : "ruled";
    // A note saved before pages existed keeps its drawing on a canvas without bounds.
    const layout = INK_LAYOUTS.includes(raw.layout as InkLayout)
        ? raw.layout as InkLayout
        : strokes.length ? "infinite" : "pages";
    const pdf = typeof raw.pdf === "string" && PDF_URL_PATTERN.test(raw.pdf) ? raw.pdf : undefined;
    const sheets = parseSheets(raw.sheets);
    return {
        paper, layout, strokes, images: parseImages(raw.images), view: parseView(raw.view),
        ...(pdf && { pdf }), ...(sheets.length && { sheets })
    };
}

function parseSheets(raw: unknown): SheetSize[] {
    const sheets: SheetSize[] = [];
    if (!Array.isArray(raw)) return sheets;
    for (const size of raw.slice(0, MAX_SHEETS)) {
        const [ width, height ] = Array.isArray(size) ? size : [];
        // A sheet that cannot be read ends the list: the sheets after it would be out of place.
        if (!isSheetSide(width) || !isSheetSide(height)) break;
        sheets.push({ width, height });
    }
    return sheets;
}

function isSheetSide(value: unknown): value is number {
    return isFiniteNumber(value) && value >= MIN_SHEET_SIDE && value <= MAX_SHEET_SIDE;
}

function parseImages(raw: unknown): InkImage[] {
    const images: InkImage[] = [];
    if (!Array.isArray(raw)) return images;
    for (const serialized of raw as Partial<SerializedImage>[]) {
        const { url, x, y, w, h } = serialized ?? {};
        if (typeof url !== "string" || !IMAGE_URL_PATTERN.test(url)) continue;
        if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(w) || !isFiniteNumber(h)) continue;
        if (w <= 0 || h <= 0) continue;
        images.push(createImage({ url, x, y, width: w, height: h, order: images.length }));
    }
    return images;
}

function parseView(view: unknown): InkView | undefined {
    if (!view || typeof view !== "object") return undefined;
    const { x, y, zoom } = view as Partial<Record<keyof InkView, unknown>>;
    if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(zoom) || zoom <= 0) return undefined;
    return { x, y, zoom };
}

/**
 * The sheets of a note laid out in pages: a column of sheets `PAGE_GAP` apart, each centered on
 * the middle of an A4 sheet. The first sheets have the `sizes` given, as the pages of a PDF, and
 * every sheet after them is A4, so a note without `sizes` is a column of A4 sheets from the
 * origin.
 */
export class PageLayout {

    /** The top of each sheet of `sizes`, then of the first sheet after them. */
    private tops: number[] = [ 0 ];

    constructor(readonly sizes: SheetSize[] = []) {
        for (const { height } of sizes) {
            this.tops.push(this.tops[this.tops.length - 1] + height + PAGE_GAP);
        }
    }

    /** Whether the first sheets have exactly the `sizes` given. */
    hasSizes(sizes: SheetSize[]) {
        return sizes.length === this.sizes.length && sizes.every(({ width, height }, index) =>
            width === this.sizes[index].width && height === this.sizes[index].height);
    }

    /** The top of sheet `index`, counted from zero, in world units. */
    getPageTop(index: number) {
        const count = this.sizes.length;
        if (index <= count) return this.tops[Math.max(0, index)];
        return this.tops[count] + (index - count) * (PAGE_HEIGHT + PAGE_GAP);
    }

    /** Where sheet `index`, counted from zero, lies. */
    getSheet(index: number): Sheet {
        const { width, height } = this.sizes[index] ?? { width: PAGE_WIDTH, height: PAGE_HEIGHT };
        return { x: (PAGE_WIDTH - width) / 2, y: this.getPageTop(index), width, height };
    }

    /**
     * The index of the sheet at `y`, in world units, the gap under a sheet counting as the sheet.
     * Above the first sheet, it is the first.
     */
    indexAt(y: number) {
        const count = this.sizes.length;
        if (y >= this.tops[count]) {
            return count + Math.floor((y - this.tops[count]) / (PAGE_HEIGHT + PAGE_GAP));
        }
        let low = 0;
        let high = count - 1;
        while (low < high) {
            const middle = Math.ceil((low + high) / 2);
            if (this.tops[middle] <= y) low = middle;
            else high = middle - 1;
        }
        return low;
    }

    /**
     * The index of the page that fills most of the view from `top` to `bottom`, in world units:
     * the first of those that fill it alike, and the nearest page when the view shows none.
     */
    getVisiblePage(top: number, bottom: number, pageCount: number) {
        const last = Math.max(0, pageCount - 1);
        const from = Math.min(last, this.indexAt(top));
        const to = Math.min(last, this.indexAt(bottom));
        let visible = from;
        let visibleHeight = -Infinity;
        for (let page = from; page <= to; page++) {
            const sheet = this.getSheet(page);
            const height = Math.min(bottom, sheet.y + sheet.height) - Math.max(top, sheet.y);
            if (height > visibleHeight) {
                visible = page;
                visibleHeight = height;
            }
        }
        return visible;
    }

    /**
     * How many pages a note shows: those up to the last one holding one of `items`, its strokes
     * and images, and an empty one after it.
     */
    getPageCount(items: Iterable<{ bounds: Bounds }>) {
        let lastUsed = -1;
        for (const { bounds } of items) {
            if (bounds.maxY >= 0) lastUsed = Math.max(lastUsed, this.indexAt(bounds.maxY));
        }
        return lastUsed + 2;
    }

}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

/** Rounds `value` to a multiple of `1 / precision`. */
function round(value: number, precision: number) {
    return Math.round(value * precision) / precision;
}

export function computeBounds(points: number[], size: number): Bounds {
    const bounds: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (let i = 0; i + 2 < points.length; i += 3) {
        bounds.minX = Math.min(bounds.minX, points[i]);
        bounds.maxX = Math.max(bounds.maxX, points[i]);
        bounds.minY = Math.min(bounds.minY, points[i + 1]);
        bounds.maxY = Math.max(bounds.maxY, points[i + 1]);
    }
    return {
        minX: bounds.minX - size,
        minY: bounds.minY - size,
        maxX: bounds.maxX + size,
        maxY: bounds.maxY + size
    };
}

export function boundsIntersect(a: Bounds, b: Bounds) {
    return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

const STREAMLINE = 0.35;
/** How far each smoothed point moves toward the pointer, as in perfect-freehand's `getStrokePoints()`. */
const STREAMLINE_STEP = 0.15 + (1 - STREAMLINE) * 0.85;
/** How fast a simulated pressure follows the speed, as in perfect-freehand's `getStrokeOutlinePoints()`. */
const PRESSURE_RATE = 0.275;

type OutlinedStroke = Pick<Stroke, "tool" | "size" | "simulatePressure" | "points" | "sensitivity">;

/**
 * Turns the raw points of a stroke into perfect-freehand's smoothed stroke points, one at a time.
 * It reproduces `getStrokePoints()` for three or more points, so a stroke outlined while it is
 * drawn matches the outline of the finished stroke. A simulated pressure is computed here as the
 * points arrive, so that any run of the points outlines to the same width as the whole stroke.
 */
export class StrokeBuilder {

    readonly points: StrokePoint[] = [];
    private runningLength = 0;
    private pastStart = false;
    private pressure = 0.5;

    constructor(private stroke: Pick<Stroke, "size" | "simulatePressure">) {}

    /** Adds a raw point. The `last` point of a finished stroke is kept where it is, unsmoothed. */
    add(x: number, y: number, pressure: number, last = false) {
        const next = this.next(this.points[this.points.length - 1], this.runningLength, this.pastStart, this.pressure, x, y, pressure, last);
        if (!next) return;
        if (next.skipped) {
            this.runningLength = next.runningLength;
            return;
        }
        this.points.push(next.point);
        if (this.points.length === 2) this.points[0].vector = next.point.vector;
        this.runningLength = next.runningLength;
        this.pastStart = this.points.length > 1;
        this.pressure = next.point.pressure;
    }

    /** Returns the stroke points that raw `extra` triples would add, without adding them. */
    preview(extra: number[]): StrokePoint[] {
        const added: StrokePoint[] = [];
        let previous = this.points[this.points.length - 1];
        let { runningLength, pastStart, pressure } = this;
        for (let i = 0; i + 2 < extra.length; i += 3) {
            const next = this.next(previous, runningLength, pastStart, pressure, extra[i], extra[i + 1], extra[i + 2], false);
            if (!next) continue;
            runningLength = next.runningLength;
            if (next.skipped) continue;
            added.push(next.point);
            previous = next.point;
            pastStart = true;
            pressure = next.point.pressure;
        }
        return added;
    }

    private next(
        previous: StrokePoint | undefined, runningLength: number, pastStart: boolean, lastPressure: number,
        x: number, y: number, rawPressure: number, last: boolean
    ) {
        if (!previous) {
            const pressure = this.stroke.simulatePressure ? this.pressure : rawPressure;
            return {
                skipped: false,
                runningLength: 0,
                point: { point: [ x, y ], pressure, vector: [ 1, 1 ], distance: 0, runningLength: 0 }
            };
        }

        const [ px, py ] = previous.point;
        const point = last ? [ x, y ] : [ px + (x - px) * STREAMLINE_STEP, py + (y - py) * STREAMLINE_STEP ];
        if (point[0] === px && point[1] === py) return undefined;

        const distance = Math.hypot(point[0] - px, point[1] - py);
        const length = runningLength + distance;
        if (!last && !pastStart && length < this.stroke.size) {
            return { skipped: true, runningLength: length, point: previous };
        }

        let pressure = rawPressure;
        if (this.stroke.simulatePressure) {
            const speed = Math.min(1, distance / this.stroke.size);
            const target = Math.min(1, 1 - speed);
            pressure = Math.min(1, lastPressure + (target - lastPressure) * (speed * PRESSURE_RATE));
        }
        return {
            skipped: false,
            runningLength: length,
            point: {
                point,
                pressure,
                vector: [ (px - point[0]) / distance, (py - point[1]) / distance ],
                distance,
                runningLength: length
            }
        };
    }
}

/**
 * Returns the predicted `x, y, pressure` triples that continue the last move of the pointer, from
 * `(fromX, fromY)` to `(toX, toY)`, cut off where they turn back or reach farther ahead than that
 * move went. Chrome's predictions swing around at the end of a stroke and outrun a pen that slows
 * down, and its outline would follow them.
 */
export function trimPrediction(
    fromX: number, fromY: number, toX: number, toY: number, predicted: number[]
) {
    const moveX = toX - fromX;
    const moveY = toY - fromY;
    let remaining = Math.hypot(moveX, moveY);
    const kept: number[] = [];
    let [ lastX, lastY ] = [ toX, toY ];
    for (let i = 0; i + 2 < predicted.length && remaining > 0; i += 3) {
        const stepX = predicted[i] - lastX;
        const stepY = predicted[i + 1] - lastY;
        if (stepX * moveX + stepY * moveY <= 0) break;
        const step = Math.hypot(stepX, stepY);
        const scale = Math.min(1, remaining / step);
        lastX += stepX * scale;
        lastY += stepY * scale;
        kept.push(lastX, lastY, predicted[i + 2]);
        remaining -= step;
    }
    return kept;
}

/** Builds the stroke points of a finished stroke. */
export function buildStrokePoints(stroke: Pick<Stroke, "size" | "simulatePressure" | "points">) {
    const builder = new StrokeBuilder(stroke);
    const { points } = stroke;
    for (let i = 0; i + 2 < points.length; i += 3) {
        builder.add(points[i], points[i + 1], points[i + 2], i + 5 >= points.length);
    }
    return builder.points;
}

/** Returns the outline of a finished stroke as a closed polygon of `[x, y]` points. */
export function getStrokeOutline(stroke: OutlinedStroke): number[][] {
    if (stroke.points.length <= 6) return getShortStrokeOutline(stroke);
    return outlineStrokePoints(stroke, buildStrokePoints(stroke));
}

/** Returns the path of a finished stroke, which the stroke keeps for the next time it is drawn. */
export function getStrokePath(stroke: Stroke) {
    stroke.path ??= outlineToPath(getStrokeOutline(stroke));
    return stroke.path;
}

/** Returns a path through the midpoints of the edges of `outline`, curved at its points. */
export function outlineToPath(outline: number[][]) {
    const path = new Path2D();
    if (outline.length < 2) return path;

    path.moveTo(outline[0][0], outline[0][1]);
    for (let i = 0; i < outline.length; i++) {
        const [ x, y ] = outline[i];
        const [ nextX, nextY ] = outline[(i + 1) % outline.length];
        path.quadraticCurveTo(x, y, (x + nextX) / 2, (y + nextY) / 2);
    }
    path.closePath();
    return path;
}

/** Returns the outline of a run of a stroke's points, which can be any part of the stroke. */
export function outlineStrokePoints(
    stroke: Pick<Stroke, "tool" | "size" | "sensitivity">, points: StrokePoint[]
): number[][] {
    return getStrokeOutlinePoints(points, { ...outlineOptions(stroke), simulatePressure: false });
}

/**
 * Returns the outline of a stroke of one or two raw points, which perfect-freehand widens into a
 * short line of its own; `StrokeBuilder` covers every longer stroke.
 */
export function getShortStrokeOutline(stroke: OutlinedStroke): number[][] {
    const input: number[][] = [];
    for (let i = 0; i + 2 < stroke.points.length; i += 3) {
        input.push([ stroke.points[i], stroke.points[i + 1], stroke.points[i + 2] ]);
    }
    return getStroke(input, {
        ...outlineOptions(stroke),
        streamline: STREAMLINE,
        simulatePressure: stroke.tool !== "highlighter" && stroke.simulatePressure,
        last: true
    });
}

function outlineOptions(stroke: Pick<Stroke, "tool" | "size" | "sensitivity">) {
    return {
        size: stroke.size,
        thinning: getThinning(stroke),
        smoothing: 0.5
    };
}

/** Whether the segment from `a` to `b`, widened by `radius`, touches the centerline of `stroke`. */
export function strokeHitsSegment(
    stroke: Stroke, ax: number, ay: number, bx: number, by: number, radius: number
) {
    const reach = radius + stroke.size / 2;
    const { bounds, points } = stroke;
    if (Math.max(ax, bx) + reach < bounds.minX || Math.min(ax, bx) - reach > bounds.maxX
        || Math.max(ay, by) + reach < bounds.minY || Math.min(ay, by) - reach > bounds.maxY) {
        return false;
    }

    const reachSquared = reach * reach;
    if (points.length === 3) {
        return pointToSegmentSquared(points[0], points[1], ax, ay, bx, by) <= reachSquared;
    }
    for (let i = 0; i + 5 < points.length; i += 3) {
        const distance = segmentToSegmentSquared(
            points[i], points[i + 1], points[i + 3], points[i + 4], ax, ay, bx, by
        );
        if (distance <= reachSquared) return true;
    }
    return false;
}

export function pointToSegmentSquared(
    px: number, py: number, ax: number, ay: number, bx: number, by: number
) {
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared === 0
        ? 0
        : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
    const cx = ax + t * dx - px;
    const cy = ay + t * dy - py;
    return cx * cx + cy * cy;
}

function segmentToSegmentSquared(
    ax: number, ay: number, bx: number, by: number,
    cx: number, cy: number, dx: number, dy: number
) {
    if (segmentsCross(ax, ay, bx, by, cx, cy, dx, dy)) return 0;
    return Math.min(
        pointToSegmentSquared(ax, ay, cx, cy, dx, dy),
        pointToSegmentSquared(bx, by, cx, cy, dx, dy),
        pointToSegmentSquared(cx, cy, ax, ay, bx, by),
        pointToSegmentSquared(dx, dy, ax, ay, bx, by)
    );
}

function segmentsCross(
    ax: number, ay: number, bx: number, by: number,
    cx: number, cy: number, dx: number, dy: number
) {
    const side = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) =>
        Math.sign((qx - px) * (ry - py) - (qy - py) * (rx - px));
    return side(ax, ay, bx, by, cx, cy) !== side(ax, ay, bx, by, dx, dy)
        && side(cx, cy, dx, dy, ax, ay) !== side(cx, cy, dx, dy, bx, by);
}

const CELL_SIZE = 512;
/** How many cells a stroke can cover before `StrokeIndex` keeps it apart, and checks it on every query. */
const MAX_STROKE_CELLS = 4096;

/**
 * A uniform grid over the world that finds the strokes near a rectangle without visiting all. A
 * stroke that covers more than `MAX_STROKE_CELLS` cells is kept in `wide` instead, and a query
 * over more cells than the grid holds visits the cells it holds, so neither costs more than the
 * strokes themselves however far they reach.
 */
export class StrokeIndex {
    private cells = new Map<string, Set<Stroke>>();
    private wide = new Set<Stroke>();

    add(stroke: Stroke) {
        if (countCells(stroke.bounds) > MAX_STROKE_CELLS) {
            this.wide.add(stroke);
            return;
        }
        for (const key of cellKeys(stroke.bounds)) {
            let cell = this.cells.get(key);
            if (!cell) {
                cell = new Set();
                this.cells.set(key, cell);
            }
            cell.add(stroke);
        }
    }

    remove(stroke: Stroke) {
        if (this.wide.delete(stroke)) return;
        for (const key of cellKeys(stroke.bounds)) {
            const cell = this.cells.get(key);
            if (!cell) continue;
            cell.delete(stroke);
            if (cell.size === 0) this.cells.delete(key);
        }
    }

    clear() {
        this.cells.clear();
        this.wide.clear();
    }

    /** Returns the strokes whose bounds intersect `bounds`, in drawing order. */
    query(bounds: Bounds): Stroke[] {
        const found = new Set<Stroke>();
        const cells = countCells(bounds) > this.cells.size
            ? this.cells.values()
            : Array.from(cellKeys(bounds), (key) => this.cells.get(key));
        for (const cell of [ ...cells, this.wide ]) {
            if (!cell) continue;
            for (const stroke of cell) {
                if (boundsIntersect(stroke.bounds, bounds)) found.add(stroke);
            }
        }
        return [ ...found ].sort((a, b) => a.order - b.order);
    }
}

/** How many cells of the grid `bounds` covers, or `Infinity` for bounds that are not finite. */
function countCells(bounds: Bounds) {
    const columns = Math.floor(bounds.maxX / CELL_SIZE) - Math.floor(bounds.minX / CELL_SIZE) + 1;
    const rows = Math.floor(bounds.maxY / CELL_SIZE) - Math.floor(bounds.minY / CELL_SIZE) + 1;
    const count = Math.max(0, columns) * Math.max(0, rows);
    return Number.isFinite(count) ? count : Infinity;
}

function* cellKeys(bounds: Bounds) {
    const fromX = Math.floor(bounds.minX / CELL_SIZE);
    const toX = Math.floor(bounds.maxX / CELL_SIZE);
    const fromY = Math.floor(bounds.minY / CELL_SIZE);
    const toY = Math.floor(bounds.maxY / CELL_SIZE);
    for (let x = fromX; x <= toX; x++) {
        for (let y = fromY; y <= toY; y++) {
            yield `${x},${y}`;
        }
    }
}

/** The shortest run of a stroke's centerline that the eraser cuts out, in world units. */
const MIN_CUT = 1e-6;

/**
 * Returns the pieces of `stroke` left outside the eraser, the segment from `a` to `b` widened by
 * `radius`, or `undefined` when the eraser misses its ink. Each piece ends where its round end
 * meets the eraser. The pieces of a stroke whose width follows the speed save the pressure it
 * simulated as their own, so that they keep the width they had in the stroke.
 */
export function splitStroke(
    stroke: Stroke, ax: number, ay: number, bx: number, by: number, radius: number
): Stroke[] | undefined {
    const thinning = getThinning(stroke);
    if (!strokeHitsSegment(stroke, ax, ay, bx, by, radius + stroke.size * thinning / 2)) return undefined;

    const points = stroke.simulatePressure ? withSimulatedPressure(stroke) : stroke.points;
    const reachAt = (pressure: number) => radius + stroke.size * (0.5 - thinning * (0.5 - pressure));
    if (points.length < 6) {
        const reach = reachAt(points[2]);
        return pointToSegmentSquared(points[0], points[1], ax, ay, bx, by) <= reach * reach ? [] : undefined;
    }

    const pieces: number[][] = [];
    let piece: number[] | undefined = points.slice(0, 3);
    let hit = false;
    for (let i = 0; i + 5 < points.length; i += 3) {
        const covered = coveredInterval(
            points[i], points[i + 1], points[i + 3], points[i + 4], ax, ay, bx, by,
            reachAt(Math.max(points[i + 2], points[i + 5]))
        );
        if (!covered) {
            piece ??= points.slice(i, i + 3);
            piece.push(points[i + 3], points[i + 4], points[i + 5]);
            continue;
        }
        hit = true;
        if (piece) {
            if (covered.from > 0) piece.push(...interpolatePoint(points, i, covered.from));
            pieces.push(piece);
            piece = undefined;
        }
        if (covered.to < 1) {
            piece = [ ...interpolatePoint(points, i, covered.to), points[i + 3], points[i + 4], points[i + 5] ];
        }
    }
    if (!hit) return undefined;
    if (piece) pieces.push(piece);

    const { tool, color, size, sensitivity, order } = stroke;
    return pieces
        .filter((piecePoints) => piecePoints.length >= 6)
        .map((piecePoints) => createStroke({
            tool, color, size, sensitivity, order, simulatePressure: false, points: piecePoints
        }));
}

/** Returns the raw points of `stroke` with the pressure that `StrokeBuilder` simulates for each. */
function withSimulatedPressure(stroke: Stroke) {
    const builder = new StrokeBuilder(stroke);
    const points = [ ...stroke.points ];
    for (let i = 0; i + 2 < points.length; i += 3) {
        builder.add(points[i], points[i + 1], points[i + 2], i + 5 >= points.length);
        points[i + 2] = builder.points[builder.points.length - 1].pressure;
    }
    return points;
}

/** Returns the point a fraction `t` of the way from raw point `i` of `points` to the next. */
function interpolatePoint(points: number[], i: number, t: number) {
    return [
        points[i] + (points[i + 3] - points[i]) * t,
        points[i + 1] + (points[i + 4] - points[i + 1]) * t,
        points[i + 2] + (points[i + 5] - points[i + 2]) * t
    ];
}

/**
 * Returns the fractions of the segment from `p` to `q` between which it lies within `reach` of
 * the segment from `a` to `b`, or `undefined` when it never does. The points within `reach` of a
 * segment are the union of a band and two discs, and form a convex shape that the segment from
 * `p` to `q` crosses at most once, so the run is the span of the runs through each of the three.
 * A run shorter than `MIN_CUT` does not count, so a piece that ends on the eraser is not cut again.
 */
function coveredInterval(
    px: number, py: number, qx: number, qy: number,
    ax: number, ay: number, bx: number, by: number, reach: number
) {
    const dx = qx - px;
    const dy = qy - py;
    let from = Infinity;
    let to = -Infinity;
    const include = (start: number, end: number) => {
        if (start > end) return;
        from = Math.min(from, start);
        to = Math.max(to, end);
    };

    const lengthSquared = dx * dx + dy * dy;
    for (const [ cx, cy ] of [ [ ax, ay ], [ bx, by ] ]) {
        const ox = px - cx;
        const oy = py - cy;
        const half = ox * dx + oy * dy;
        const rest = ox * ox + oy * oy - reach * reach;
        if (lengthSquared === 0) {
            if (rest <= 0) include(0, 1);
            continue;
        }
        const discriminant = half * half - lengthSquared * rest;
        if (discriminant < 0) continue;
        const root = Math.sqrt(discriminant);
        include((-half - root) / lengthSquared, (-half + root) / lengthSquared);
    }

    const eraserLength = Math.hypot(bx - ax, by - ay);
    if (eraserLength > 0) {
        const ux = (bx - ax) / eraserLength;
        const uy = (by - ay) / eraserLength;
        let start = -Infinity;
        let end = Infinity;
        // Keeps the fractions at which `value + step * t` lies between `min` and `max`.
        const clamp = (value: number, step: number, min: number, max: number) => {
            if (step === 0) {
                if (value < min || value > max) [ start, end ] = [ Infinity, -Infinity ];
                return;
            }
            const [ first, second ] = [ (min - value) / step, (max - value) / step ];
            start = Math.max(start, Math.min(first, second));
            end = Math.min(end, Math.max(first, second));
        };
        clamp((px - ax) * ux + (py - ay) * uy, dx * ux + dy * uy, 0, eraserLength);
        clamp((py - ay) * ux - (px - ax) * uy, dy * ux - dx * uy, -reach, reach);
        include(start, end);
    }

    from = Math.max(0, from);
    to = Math.min(1, to);
    if (from > to || (lengthSquared > 0 && (to - from) * Math.sqrt(lengthSquared) < MIN_CUT)) return undefined;
    return { from, to };
}

function getThinning(stroke: Pick<Stroke, "tool" | "sensitivity">) {
    return stroke.tool === "highlighter" ? 0 : (stroke.sensitivity ?? DEFAULT_PRESSURE_SENSITIVITY) / 100;
}
