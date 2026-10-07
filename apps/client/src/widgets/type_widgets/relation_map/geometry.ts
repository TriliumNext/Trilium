import { getArrowOutline } from "../../note_map/rendering";

export interface Point {
    x: number;
    y: number;
}

/** A note box, in unzoomed map pixels. */
export interface Box extends Point {
    width: number;
    height: number;
}

/** A relation to lay out, between two boxes or from a box to itself. */
export interface ConnectionShape {
    id: string;
    sourceId: string;
    targetId: string;
    /** Draws an arrowhead at the source end as well as at the target end. */
    arrowAtSource: boolean;
    /** Positions of the labels along the line, from 0 at the source to 1 at the target. */
    labelAt: number[];
}

/**
 * Where a label goes: at `x`, `y` on the line, turned by `angle` degrees to run along it and kept
 * upright, as on the note map. `side` places the text below or above the line, or after the point
 * (`end`), all in the turned frame.
 */
export interface LabelPlacement extends Point {
    angle: number;
    side: "below" | "above" | "end";
}

export interface ConnectionLayout {
    /** SVG path data of the line. */
    path: string;
    /** Outlines of the arrowheads, as SVG `points`. */
    arrows: string[];
    /** The labels, in the order of `ConnectionShape.labelAt`. */
    labels: LabelPlacement[];
}

/** Length of an arrowhead. The rounded stroke of `.relation-map-arrow` adds about half a pixel on every side. */
const ARROW_LENGTH_PX = 9;
/** Gap between a box and the end of a line. */
const BOX_GAP = 3;
/** Distance between the middles of relations that run between the same two boxes. */
const PARALLEL_SPACING = 30;
/** Radius of a box's first loop; each further loop is `LOOP_SPACING` wider. */
const LOOP_RADIUS = 18;
const LOOP_SPACING = 10;

/**
 * Lays out the relations between the boxes in `boxes`, keyed by note ID. A relation whose box has
 * not been measured yet, or whose boxes overlap too much for a line, is left out.
 *
 * Relations between the same two boxes bow apart, so that their lines and labels do not overlap,
 * and the loops of a box grow one around the other.
 */
export function layoutConnections(shapes: ConnectionShape[], boxes: Map<string, Box>) {
    const layouts = new Map<string, ConnectionLayout>();

    for (const group of groupByBoxPair(shapes)) {
        for (const [ index, shape ] of group.entries()) {
            const source = boxes.get(shape.sourceId);
            const target = boxes.get(shape.targetId);
            if (!source || !target) continue;

            const layout = shape.sourceId === shape.targetId
                ? layoutLoop(source, index, shape)
                : layoutLine(source, target, {
                    ...shape,
                    // Measured from the box with the lower ID, so that relations in both directions fan out.
                    bend: (index - (group.length - 1) / 2) * PARALLEL_SPACING * (shape.sourceId < shape.targetId ? 1 : -1)
                });
            if (layout) layouts.set(shape.id, layout);
        }
    }

    return layouts;
}

/**
 * Lays out a line from the border of `source` to the border of `target`, or to a point while a
 * relation is being drawn. The line is a quadratic curve whose middle lies `bend` pixels to the left
 * of the straight line, looking from `source`. Returns `null` when there is no room for a line.
 */
export function layoutLine(source: Box, target: Box | Point, { bend = 0, arrowAtSource = false, labelAt = [] }: {
    bend?: number;
    arrowAtSource?: boolean;
    labelAt?: number[];
} = {}): ConnectionLayout | null {
    const from = centerOf(source);
    const to = "width" in target ? centerOf(target) : target;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = Math.hypot(dx, dy);
    if (!distance) return null;

    // The curve passes halfway between the middle of the straight line and its control point.
    const control = {
        x: (from.x + to.x) / 2 + (dy / distance) * bend * 2,
        y: (from.y + to.y) / 2 - (dx / distance) * bend * 2
    };
    const start = exitPoint(source, control);
    const end = "width" in target ? exitPoint(target, control) : target;
    if (!start || !end) return null;

    return {
        path: `M ${round(start.x)} ${round(start.y)} Q ${round(control.x)} ${round(control.y)} ${round(end.x)} ${round(end.y)}`,
        arrows: arrowsAt([ [ control, end ], ...(arrowAtSource ? [ [ control, start ] as const ] : []) ]),
        labels: labelAt.map((t) => placeLabel(start, control, end, t, bend))
    };
}

/**
 * Lays out a relation from a box to itself: an arc around the box's top-right corner, from its top
 * edge to its right edge. `index` makes each further loop of the box wider than the one before.
 * Its labels are level and start at the arc, outside it.
 */
function layoutLoop(box: Box, index: number, { arrowAtSource, labelAt }: ConnectionShape): ConnectionLayout {
    const radius = LOOP_RADIUS + index * LOOP_SPACING;
    const corner = { x: box.x + box.width, y: box.y };
    const start = { x: corner.x - radius, y: corner.y };
    const end = { x: corner.x, y: corner.y + radius };
    // The arc runs three quarters of a circle clockwise, from the left of the corner to below it.
    const pointAt = (t: number): LabelPlacement => {
        const angle = Math.PI + t * 1.5 * Math.PI;
        return { x: corner.x + radius * Math.cos(angle), y: corner.y + radius * Math.sin(angle), angle: 0, side: "end" };
    };

    return {
        path: `M ${round(start.x)} ${round(start.y)} A ${radius} ${radius} 0 1 1 ${round(end.x)} ${round(end.y)}`,
        arrows: arrowsAt([
            [ { x: end.x + radius, y: end.y }, end ],
            ...(arrowAtSource ? [ [ { x: start.x, y: start.y - radius }, start ] as const ] : [])
        ]),
        labels: labelAt.map(pointAt)
    };
}

/** Groups the relations by the pair of boxes they run between, in either direction. */
function groupByBoxPair(shapes: ConnectionShape[]) {
    const groups = new Map<string, ConnectionShape[]>();
    for (const shape of shapes) {
        const key = [ shape.sourceId, shape.targetId ].sort().join("\n");
        groups.set(key, [ ...(groups.get(key) ?? []), shape ]);
    }
    return groups.values();
}

/**
 * Where the ray from the center of `box` toward `point` leaves the box, plus `BOX_GAP`, or `null`
 * when `point` is inside the box.
 */
function exitPoint(box: Box, point: Point): Point | null {
    const center = centerOf(box);
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    const scale = Math.min(
        dx ? box.width / 2 / Math.abs(dx) : Infinity,
        dy ? box.height / 2 / Math.abs(dy) : Infinity
    );
    if (scale >= 1) return null;

    const distance = Math.hypot(dx, dy);
    return {
        x: center.x + dx * scale + (dx / distance) * BOX_GAP,
        y: center.y + dy * scale + (dy / distance) * BOX_GAP
    };
}

/** The outlines of arrowheads pointing along each `[from, tip]` pair, as SVG `points`. */
function arrowsAt(directions: (readonly [ Point, Point ])[]) {
    return directions
        .map(([ from, tip ]) => getArrowOutline(from, tip, 0, ARROW_LENGTH_PX))
        .filter((outline) => outline !== null)
        .map((outline) => outline.map(([ x, y ]) => `${round(x)},${round(y)}`).join(" "));
}

/**
 * Places a label at `t` along the curve, turned along it and kept upright. On a bowed line the text
 * goes on the outer side of the bow, so that the labels of relations between the same boxes move
 * apart; on a straight line it goes below.
 */
function placeLabel(start: Point, control: Point, end: Point, t: number, bend: number): LabelPlacement {
    const point = quadraticAt(start, control, end, t);
    const tangentX = (1 - t) * (control.x - start.x) + t * (end.x - control.x);
    const tangentY = (1 - t) * (control.y - start.y) + t * (end.y - control.y);
    let angle = Math.atan2(tangentY, tangentX);
    if (angle > Math.PI / 2) angle -= Math.PI;
    if (angle < -Math.PI / 2) angle += Math.PI;

    let side: LabelPlacement["side"] = "below";
    if (bend) {
        // "Below" in the turned frame, against the direction the middle of the curve is pushed to.
        const belowX = -Math.sin(angle);
        const belowY = Math.cos(angle);
        const pushX = control.x - (start.x + end.x) / 2;
        const pushY = control.y - (start.y + end.y) / 2;
        side = belowX * pushX + belowY * pushY >= 0 ? "below" : "above";
    }

    return { ...point, angle: round(angle * 180 / Math.PI), side };
}

function quadraticAt(start: Point, control: Point, end: Point, t: number): Point {
    const u = 1 - t;
    return {
        x: u * u * start.x + 2 * u * t * control.x + t * t * end.x,
        y: u * u * start.y + 2 * u * t * control.y + t * t * end.y
    };
}

function centerOf(box: Box): Point {
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

function round(value: number) {
    return Math.round(value * 100) / 100;
}
