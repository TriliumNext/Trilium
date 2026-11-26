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
    bounds: Bounds;
    /** The position of the stroke in the drawing order. */
    order: number;
    path?: Path2D;
    /** The JSON of the stroke in the saved document, kept as a stroke does not change once drawn. */
    json?: string;
}

export interface InkDocument {
    paper: PaperStyle;
    layout: InkLayout;
    strokes: Stroke[];
    /** The view the note was last saved at. */
    view?: InkView;
}

/** A view of a note: the world point at the middle of the screen, and the zoom. */
export interface InkView {
    x: number;
    y: number;
    zoom: number;
}

interface SerializedStroke {
    /** `"h"` for the highlighter; the pen is left out. */
    t?: "h";
    /** The color, left out for {@link AUTO_COLOR}. */
    c?: string;
    w: number;
    /** `1` when the pressure is simulated. */
    s?: 1;
    /**
     * Flat `x, y, pressure` triples: positions in tenths of a world unit and the pressure between
     * 0 and 255. Every triple after the first holds the difference from the previous one.
     */
    p: number[];
}

interface SerializedDocument {
    version: 1;
    paper: PaperStyle;
    layout?: InkLayout;
    strokes: SerializedStroke[];
    view?: InkView;
}

const POSITION_SCALE = 10;
/** The widest stroke a document can hold: the highlighter at its largest thickness. */
const MAX_STROKE_SIZE = 60;
const PRESSURE_SCALE = 255;

export function createStroke(
    props: Pick<Stroke, "tool" | "color" | "size" | "simulatePressure" | "points" | "order">
): Stroke {
    return { ...props, bounds: computeBounds(props.points, props.size) };
}

/**
 * Returns the saved document. It joins the JSON of each stroke, which `serializeStroke()` computes
 * once per stroke, so saving a large document does not encode every point again.
 */
export function serializeInkDocument(
    paper: PaperStyle, strokes: Iterable<Stroke>, view?: InkView, layout: InkLayout = "pages"
): string {
    const sorted = [ ...strokes ].sort((a, b) => a.order - b.order);
    const parts: string[] = [];
    for (const stroke of sorted) {
        parts.push(serializeStroke(stroke));
    }
    const savedView = view
        ? `,"view":${JSON.stringify({ x: round(view.x, 10), y: round(view.y, 10), zoom: round(view.zoom, 1000) })}`
        : "";
    return `{"version":1,"paper":${JSON.stringify(paper)},"layout":${JSON.stringify(layout)}${savedView},"strokes":[${parts.join(",")}]}`;
}

/** Returns the JSON of `stroke` in the saved document, computed on the first call. */
export function serializeStroke(stroke: Stroke): string {
    if (stroke.json === undefined) {
        const serialized: SerializedStroke = {
            ...(stroke.tool === "highlighter" && { t: "h" as const }),
            ...(stroke.color !== AUTO_COLOR && { c: stroke.color }),
            w: stroke.size,
            ...(stroke.simulatePressure && { s: 1 as const }),
            p: encodePoints(stroke.points)
        };
        stroke.json = JSON.stringify(serialized);
    }
    return stroke.json;
}

export function parseInkDocument(content: string | null | undefined): InkDocument {
    const empty: InkDocument = { paper: "ruled", layout: "pages", strokes: [] };
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
            order: strokes.length
        }));
    }

    const paper = PAPER_STYLES.includes(raw.paper as PaperStyle) ? raw.paper as PaperStyle : "ruled";
    // A note saved before pages existed keeps its drawing on a canvas without bounds.
    const layout = INK_LAYOUTS.includes(raw.layout as InkLayout)
        ? raw.layout as InkLayout
        : strokes.length ? "infinite" : "pages";
    return { paper, layout, strokes, view: parseView(raw.view) };
}

function parseView(view: unknown): InkView | undefined {
    if (!view || typeof view !== "object") return undefined;
    const { x, y, zoom } = view as Partial<Record<keyof InkView, unknown>>;
    if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(zoom) || zoom <= 0) return undefined;
    return { x, y, zoom };
}

/** The top of page `index`, counted from zero, in world units. */
export function getPageTop(index: number) {
    return index * (PAGE_HEIGHT + PAGE_GAP);
}

/** How many pages a note shows: those up to the last one holding ink, and an empty one after it. */
export function getPageCount(strokes: Iterable<Stroke>) {
    let lastInked = -1;
    for (const stroke of strokes) {
        lastInked = Math.max(lastInked, Math.floor(stroke.bounds.maxY / (PAGE_HEIGHT + PAGE_GAP)));
    }
    return lastInked + 2;
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

/** Rounds `value` to a multiple of `1 / precision`. */
function round(value: number, precision: number) {
    return Math.round(value * precision) / precision;
}

function encodePoints(points: number[]) {
    const encoded: number[] = [];
    let previous = [ 0, 0, 0 ];
    for (let i = 0; i + 2 < points.length; i += 3) {
        const current = [
            Math.round(points[i] * POSITION_SCALE),
            Math.round(points[i + 1] * POSITION_SCALE),
            Math.round(points[i + 2] * PRESSURE_SCALE)
        ];
        encoded.push(current[0] - previous[0], current[1] - previous[1], current[2] - previous[2]);
        previous = current;
    }
    return encoded;
}

/** Returns the points of a saved stroke, or `undefined` when one of its values is not a finite number. */
function decodePoints(encoded: unknown[]) {
    const points: number[] = [];
    const current = [ 0, 0, 0 ];
    for (let i = 0; i + 2 < encoded.length; i += 3) {
        const [ dx, dy, dp ] = [ encoded[i], encoded[i + 1], encoded[i + 2] ];
        if (!isFiniteNumber(dx) || !isFiniteNumber(dy) || !isFiniteNumber(dp)) return undefined;
        current[0] += dx;
        current[1] += dy;
        current[2] += dp;
        if (!current.every(Number.isFinite)) return undefined;
        points.push(
            current[0] / POSITION_SCALE,
            current[1] / POSITION_SCALE,
            current[2] / PRESSURE_SCALE
        );
    }
    return points;
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

type OutlinedStroke = Pick<Stroke, "tool" | "size" | "simulatePressure" | "points">;

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
export function outlineStrokePoints(stroke: Pick<Stroke, "tool" | "size">, points: StrokePoint[]): number[][] {
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

function outlineOptions(stroke: Pick<Stroke, "tool" | "size">) {
    return {
        size: stroke.size,
        thinning: stroke.tool === "highlighter" ? 0 : 0.6,
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
