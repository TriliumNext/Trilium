import { getStroke } from "perfect-freehand";

export const PAPER_STYLES = [ "ruled", "grid", "dots", "blank" ] as const;
export type PaperStyle = (typeof PAPER_STYLES)[number];

export type InkTool = "pen" | "highlighter";

/** The color of a stroke that follows the theme's text color. */
export const AUTO_COLOR = "auto";

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
}

export interface InkDocument {
    paper: PaperStyle;
    strokes: Stroke[];
}

interface SerializedStroke {
    /** `"h"` for the highlighter; the pen is left out. */
    t?: "h";
    c: string;
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
    strokes: SerializedStroke[];
}

const POSITION_SCALE = 10;
const PRESSURE_SCALE = 255;

export function createStroke(
    props: Pick<Stroke, "tool" | "color" | "size" | "simulatePressure" | "points" | "order">
): Stroke {
    return { ...props, bounds: computeBounds(props.points, props.size) };
}

export function serializeInkDocument(paper: PaperStyle, strokes: Iterable<Stroke>): string {
    const sorted = [ ...strokes ].sort((a, b) => a.order - b.order);
    const doc: SerializedDocument = {
        version: 1,
        paper,
        strokes: sorted.map((stroke) => {
            const serialized: SerializedStroke = {
                c: stroke.color,
                w: stroke.size,
                p: encodePoints(stroke.points)
            };
            if (stroke.tool === "highlighter") serialized.t = "h";
            if (stroke.simulatePressure) serialized.s = 1;
            return serialized;
        })
    };
    return JSON.stringify(doc);
}

export function parseInkDocument(content: string | null | undefined): InkDocument {
    const empty: InkDocument = { paper: "ruled", strokes: [] };
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
        strokes.push(createStroke({
            tool: serialized.t === "h" ? "highlighter" : "pen",
            color: typeof serialized.c === "string" ? serialized.c : AUTO_COLOR,
            size: typeof serialized.w === "number" ? serialized.w : 3,
            simulatePressure: serialized.s === 1,
            points: decodePoints(serialized.p),
            order: strokes.length
        }));
    }

    const paper = PAPER_STYLES.includes(raw.paper as PaperStyle) ? raw.paper as PaperStyle : "ruled";
    return { paper, strokes };
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

function decodePoints(encoded: number[]) {
    const points: number[] = [];
    const current = [ 0, 0, 0 ];
    for (let i = 0; i + 2 < encoded.length; i += 3) {
        current[0] += encoded[i];
        current[1] += encoded[i + 1];
        current[2] += encoded[i + 2];
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

/**
 * Returns the outline of a stroke as a closed polygon of `[x, y]` points. `extraPoints` are flat
 * triples drawn after the stroke's own, for input that the browser predicts.
 */
export function getStrokeOutline(
    stroke: Pick<Stroke, "tool" | "size" | "simulatePressure" | "points">,
    extraPoints: number[] = [],
    complete = true
): number[][] {
    const input: number[][] = [];
    for (const points of [ stroke.points, extraPoints ]) {
        for (let i = 0; i + 2 < points.length; i += 3) {
            input.push([ points[i], points[i + 1], points[i + 2] ]);
        }
    }

    const isHighlighter = stroke.tool === "highlighter";
    return getStroke(input, {
        size: stroke.size,
        thinning: isHighlighter ? 0 : 0.6,
        smoothing: 0.5,
        streamline: 0.35,
        simulatePressure: !isHighlighter && stroke.simulatePressure,
        last: complete
    });
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

function pointToSegmentSquared(
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

/** A uniform grid over the world that finds the strokes near a rectangle without visiting all. */
export class StrokeIndex {
    private cells = new Map<string, Set<Stroke>>();

    add(stroke: Stroke) {
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
        for (const key of cellKeys(stroke.bounds)) {
            const cell = this.cells.get(key);
            if (!cell) continue;
            cell.delete(stroke);
            if (cell.size === 0) this.cells.delete(key);
        }
    }

    clear() {
        this.cells.clear();
    }

    /** Returns the strokes whose bounds intersect `bounds`, in drawing order. */
    query(bounds: Bounds): Stroke[] {
        const found = new Set<Stroke>();
        for (const key of cellKeys(bounds)) {
            const cell = this.cells.get(key);
            if (!cell) continue;
            for (const stroke of cell) {
                if (boundsIntersect(stroke.bounds, bounds)) found.add(stroke);
            }
        }
        return [ ...found ].sort((a, b) => a.order - b.order);
    }
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
