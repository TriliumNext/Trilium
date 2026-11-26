import { pointToSegmentSquared } from "./ink_document";

export interface Line {
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
}

/** How far a stroke can stray from the line between its ends, as a share of that line's length. */
const LINE_DEVIATION = 0.1;
/** How much longer than the line between its ends the path of a stroke can be. */
const LINE_DETOUR = 1.25;

/**
 * Returns the line between the ends of a stroke that was drawn as a straight line, from its flat
 * `x, y, pressure` triples. A stroke shorter than `minLength`, one that bends away from the line
 * or one that runs back and forth along it is not a line.
 */
export function recognizeLine(points: number[], minLength: number): Line | undefined {
    if (points.length < 6) return undefined;
    const fromX = points[0];
    const fromY = points[1];
    const toX = points[points.length - 3];
    const toY = points[points.length - 2];
    const dx = toX - fromX;
    const dy = toY - fromY;
    const length = Math.hypot(dx, dy);
    if (length < minLength || length === 0) return undefined;

    let pathLength = 0;
    for (let i = 3; i + 2 < points.length; i += 3) {
        const deviation = Math.abs((points[i] - fromX) * dy - (points[i + 1] - fromY) * dx) / length;
        if (deviation > LINE_DEVIATION * length) return undefined;
        pathLength += Math.hypot(points[i] - points[i - 3], points[i + 1] - points[i - 2]);
    }
    if (pathLength > LINE_DETOUR * length) return undefined;
    return { fromX, fromY, toX, toY };
}

/**
 * Returns the flat `x, y, pressure` triples of a stroke along `line` at one pressure, so at one
 * width. The point in the middle keeps the stroke out of the outline of a two-point stroke, which
 * gives its middle a pressure of its own.
 */
export function lineToPoints({ fromX, fromY, toX, toY }: Line, pressure: number): number[] {
    return [
        fromX, fromY, pressure,
        (fromX + toX) / 2, (fromY + toY) / 2, pressure,
        toX, toY, pressure
    ];
}

/** The step between the angles tried for the box around a stroke, in degrees. */
const ANGLE_STEP = 0.5;
/** How close to an axis, in degrees, the sides of a rectangle are drawn to be laid along it. */
const AXIS_SNAP = 15;
/** How far a stroke can stray from the sides between its corners, as a share of the shorter side. */
const SIDE_DEVIATION = 0.14;
/** How far from a right angle each corner of a stroke drawn as a rectangle can be, in degrees. */
const CORNER_SKEW = 25;
/** The smallest corner of a stroke drawn as a triangle, in degrees. */
const MIN_TRIANGLE_ANGLE = 15;
/** How close to an axis, in degrees, a side of a triangle is drawn to be laid along it. */
const TRIANGLE_AXIS_SNAP = 10;
/** The shortest and the longest path of a stroke around a shape, as a share of its perimeter. */
const MIN_ROUND = 0.75;
const MAX_ROUND = 1.35;
/** How far apart the ends of a closed stroke can be, as a share of half the perimeter. */
const CLOSING_GAP = 0.12;
/** The distance from a corner of a shape to the first point after it, in world units. */
const CORNER_STEP = 1;

/**
 * Returns the four corners of the rectangle that a stroke was drawn as, from its flat
 * `x, y, pressure` triples. The stroke goes once around four corners, each within `CORNER_SKEW`
 * degrees of a right angle, close to the sides between them, and ends where it started. The
 * rectangle takes the mean length and the mean direction of the opposite sides drawn, and its
 * sides lie along the axes when that direction is within `AXIS_SNAP` degrees of them.
 */
export function recognizeRectangle(points: number[], minSize: number): number[][] | undefined {
    if (points.length < 12) return undefined;
    const corners = findCorners(points);
    if (!corners) return undefined;

    const sides = getSides(corners);
    const width = (sides[0].length + sides[2].length) / 2;
    const height = (sides[1].length + sides[3].length) / 2;
    const shortSide = Math.min(width, height);
    if (shortSide < minSize || Math.min(...sides.map((side) => side.length)) === 0) return undefined;
    if (getCornerAngles(sides).some((angle) => Math.abs(angle - 90) > CORNER_SKEW)) return undefined;
    if (!goesAround(points, corners, sides, SIDE_DEVIATION * shortSide)) return undefined;

    // The second and fourth sides, turned back by a quarter, point along the first and third.
    const alongX = sides[0].x - sides[2].x + sides[1].y - sides[3].y;
    const alongY = sides[0].y - sides[2].y - sides[1].x + sides[3].x;
    let angle = Math.atan2(alongY, alongX) * 180 / Math.PI;
    const axis = Math.round(angle / 90) * 90;
    if (Math.abs(angle - axis) <= AXIS_SNAP) angle = axis;
    const cos = Math.cos(angle * Math.PI / 180);
    const sin = Math.sin(angle * Math.PI / 180);
    const centerX = (corners[0][0] + corners[1][0] + corners[2][0] + corners[3][0]) / 4;
    const centerY = (corners[0][1] + corners[1][1] + corners[2][1] + corners[3][1]) / 4;
    return CORNER_SIGNS.map(([ signU, signV ]) => [
        centerX + (signU * width * cos - signV * height * sin) / 2,
        centerY + (signU * width * sin + signV * height * cos) / 2
    ]);
}

/**
 * Returns the three corners of the triangle that a stroke was drawn as, from its flat
 * `x, y, pressure` triples. The stroke goes once around three corners of at least
 * `MIN_TRIANGLE_ANGLE` degrees each, close to the sides between them, and ends where it started.
 * The triangle keeps the corners drawn, turned around their middle so that the side nearest to an
 * axis lies along it when it is within `TRIANGLE_AXIS_SNAP` degrees of it.
 */
export function recognizeTriangle(points: number[], minSize: number): number[][] | undefined {
    if (points.length < 12) return undefined;
    const corners = findTriangleCorners(points);
    const sides = getSides(corners);
    const shortSide = Math.min(...sides.map((side) => side.length));
    if (shortSide < minSize) return undefined;
    if (getCornerAngles(sides).some((angle) => !(angle >= MIN_TRIANGLE_ANGLE))) return undefined;
    if (!goesAround(points, corners, sides, SIDE_DEVIATION * shortSide)) return undefined;

    let turn = Infinity;
    for (const side of sides) {
        const angle = Math.atan2(side.y, side.x) * 180 / Math.PI;
        const offAxis = angle - Math.round(angle / 90) * 90;
        if (Math.abs(offAxis) < Math.abs(turn)) turn = offAxis;
    }
    if (Math.abs(turn) > TRIANGLE_AXIS_SNAP) return corners;

    const cos = Math.cos(-turn * Math.PI / 180);
    const sin = Math.sin(-turn * Math.PI / 180);
    const centerX = (corners[0][0] + corners[1][0] + corners[2][0]) / 3;
    const centerY = (corners[0][1] + corners[1][1] + corners[2][1]) / 3;
    return corners.map(([ x, y ]) => [
        centerX + (x - centerX) * cos - (y - centerY) * sin,
        centerY + (x - centerX) * sin + (y - centerY) * cos
    ]);
}

const CORNER_SIGNS = [ [ -1, -1 ], [ 1, -1 ], [ 1, 1 ], [ -1, 1 ] ];

type Side = { x: number, y: number, length: number };

/** The vector and the length of the side from each corner of a closed polygon to the next. */
function getSides(corners: number[][]): Side[] {
    return corners.map(([ x, y ], index) => {
        const [ nextX, nextY ] = corners[(index + 1) % corners.length];
        return { x: nextX - x, y: nextY - y, length: Math.hypot(nextX - x, nextY - y) };
    });
}

/** The angle inside each corner of a polygon, in degrees, from the `sides` that leave them. */
function getCornerAngles(sides: Side[]) {
    return sides.map((side, index) => {
        const previous = sides[(index + sides.length - 1) % sides.length];
        const cosine = -(side.x * previous.x + side.y * previous.y) / (side.length * previous.length);
        return Math.acos(Math.max(-1, Math.min(1, cosine))) * 180 / Math.PI;
    });
}

/**
 * Whether a stroke goes once around the polygon of `corners`, within `tolerance` of its sides, and
 * ends where it started.
 */
function goesAround(points: number[], corners: number[][], sides: Side[], tolerance: number) {
    let pathLength = 0;
    for (let i = 0; i + 2 < points.length; i += 3) {
        const deviation = Math.min(...corners.map(([ x, y ], index) => {
            const [ nextX, nextY ] = corners[(index + 1) % corners.length];
            return pointToSegmentSquared(points[i], points[i + 1], x, y, nextX, nextY);
        }));
        if (deviation > tolerance ** 2) return false;
        if (i) pathLength += Math.hypot(points[i] - points[i - 3], points[i + 1] - points[i - 2]);
    }
    let perimeter = 0;
    for (const side of sides) {
        perimeter += side.length;
    }
    return pathLength >= MIN_ROUND * perimeter && pathLength <= MAX_ROUND * perimeter
        && getClosingGap(points) <= CLOSING_GAP * perimeter / 2;
}

/**
 * Returns the three points of a stroke that lie furthest apart: the one furthest from the middle
 * of the stroke, the one furthest from that point, and the one furthest from the line through
 * both. For a stroke around a triangle, these are its corners.
 */
function findTriangleCorners(points: number[]): number[][] {
    const count = points.length / 3;
    let middleX = 0;
    let middleY = 0;
    for (let i = 0; i + 2 < points.length; i += 3) {
        middleX += points[i] / count;
        middleY += points[i + 1] / count;
    }
    const furthest = (distance: (x: number, y: number) => number) => {
        let best = [ points[0], points[1] ];
        let bestDistance = -Infinity;
        for (let i = 0; i + 2 < points.length; i += 3) {
            const candidate = distance(points[i], points[i + 1]);
            if (candidate > bestDistance) {
                bestDistance = candidate;
                best = [ points[i], points[i + 1] ];
            }
        }
        return best;
    };

    const first = furthest((x, y) => Math.hypot(x - middleX, y - middleY));
    const second = furthest((x, y) => Math.hypot(x - first[0], y - first[1]));
    const third = furthest((x, y) =>
        Math.abs((x - first[0]) * (second[1] - first[1]) - (y - first[1]) * (second[0] - first[0])));
    return [ first, second, third ];
}

/**
 * Returns the four points of a stroke that reach furthest into the corners of the smallest box
 * around it, at any angle, in the order they lie around the box.
 */
function findCorners(points: number[]): number[][] | undefined {
    let box = fitBox(points, 0);
    for (let angle = ANGLE_STEP; angle < 90; angle += ANGLE_STEP) {
        const candidate = fitBox(points, angle);
        if (candidate.width * candidate.height < box.width * box.height) box = candidate;
    }
    const { minU, maxU, minV, maxV, width, height, cos, sin } = box;
    if (!width || !height) return undefined;

    const corners = CORNER_SIGNS.map(() => [ 0, 0 ]);
    const reaches = CORNER_SIGNS.map(() => -Infinity);
    for (let i = 0; i + 2 < points.length; i += 3) {
        const u = (points[i] * cos + points[i + 1] * sin - (minU + maxU) / 2) / width;
        const v = (points[i + 1] * cos - points[i] * sin - (minV + maxV) / 2) / height;
        for (const [ index, [ signU, signV ] ] of CORNER_SIGNS.entries()) {
            const reach = signU * u + signV * v;
            if (reach > reaches[index]) {
                reaches[index] = reach;
                corners[index] = [ points[i], points[i + 1] ];
            }
        }
    }
    return corners;
}

/**
 * Returns the flat `x, y, pressure` triples of a stroke around the closed polygon of `corners`, at
 * one pressure. `StrokeBuilder` moves each point only part of the way to the next, which rounds a
 * corner by about the distance between the points around it, so the points lie `CORNER_STEP` from
 * each corner and twice as far apart with each step away from it. The stroke starts and ends in
 * the middle of the first side, where its two ends make no corner.
 */
export function polygonToPoints(corners: number[][], pressure: number): number[] {
    const sides = corners.map((from, index) => {
        const to = corners[(index + 1) % corners.length];
        const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
        const steps: number[] = [];
        for (let step = CORNER_STEP; step < length / 2; step *= 2) {
            steps.push(step);
        }
        return { from, to, length, steps };
    });

    const points: number[] = [];
    const add = ({ from, to, length }: (typeof sides)[number], distance: number) => {
        const share = length ? distance / length : 0;
        points.push(from[0] + (to[0] - from[0]) * share, from[1] + (to[1] - from[1]) * share, pressure);
    };
    add(sides[0], sides[0].length / 2);
    for (const [ index, side ] of sides.entries()) {
        for (let i = side.steps.length - 1; i >= 0; i--) {
            add(side, side.length - side.steps[i]);
        }
        const next = sides[(index + 1) % sides.length];
        add(next, 0);
        for (const step of next.steps) {
            add(next, step);
        }
        add(next, next.length / 2);
    }
    return points;
}

/** The bounds of a stroke along axes turned by `angle` degrees, `u` along the first and `v` the second. */
function fitBox(points: number[], angle: number) {
    const cos = Math.cos(angle * Math.PI / 180);
    const sin = Math.sin(angle * Math.PI / 180);
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (let i = 0; i + 2 < points.length; i += 3) {
        const u = points[i] * cos + points[i + 1] * sin;
        const v = points[i + 1] * cos - points[i] * sin;
        minU = Math.min(minU, u);
        maxU = Math.max(maxU, u);
        minV = Math.min(minV, v);
        maxV = Math.max(maxV, v);
    }
    return { angle, cos, sin, minU, maxU, minV, maxV, width: maxU - minU, height: maxV - minV };
}

/**
 * The shortest distance from an end of a stroke to the quarter of its points at the other end, so
 * that a stroke that runs past its start counts as closed.
 */
function getClosingGap(points: number[]) {
    const last = points.length - 3;
    const quarter = Math.max(1, Math.floor(points.length / 12));
    let gap = Infinity;
    for (let k = 0; k < quarter; k++) {
        gap = Math.min(
            gap,
            Math.hypot(points[3 * k] - points[last], points[3 * k + 1] - points[last + 1]),
            Math.hypot(points[last - 3 * k] - points[0], points[last - 3 * k + 1] - points[1])
        );
    }
    return gap;
}
