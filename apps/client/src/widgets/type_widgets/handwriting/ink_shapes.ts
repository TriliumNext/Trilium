import type { Line } from "@triliumnext/commons";
import { pathToPoints, polygonToPoints } from "@triliumnext/commons/src/lib/handwriting.js";

import { pointToSegmentSquared } from "./ink_document";

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
/**
 * How far a stroke can stray from an ellipse, as a share of the way from the center of the
 * ellipse to its edge. The corners of a rectangle are 41% outside the ellipse in its box.
 */
const ELLIPSE_DEVIATION = 0.2;
/** The share of its length from which the width of an ellipse makes it a circle. */
const CIRCLE_RATIO = 0.85;
/**
 * The most points of a stroke tried as an ellipse, as `trimToLoop()` compares the points of its
 * two ends with each other. The shapes drawn with a pen on a tablet had 120 to 200.
 */
const MAX_STROKE_POINTS = 4000;
/** The distance between the points of a stroke around an ellipse, in world units, and their number. */
const ELLIPSE_STEP = 6;
const MIN_ELLIPSE_POINTS = 24;
const MAX_ELLIPSE_POINTS = 160;

/** How far back toward its start a stroke comes for its shaft to have ended, as a share of its reach. */
const TIP_RETREAT = 0.03;
/** The shortest and the longest barb of an arrow, as a share of the length of its shaft. */
const MIN_BARB = 0.1;
const MAX_BARB = 0.6;
/** The smallest and the largest angle between a barb of an arrow and its shaft, in degrees. */
const MIN_BARB_ANGLE = 10;
const MAX_BARB_ANGLE = 70;
/** How far along the head of an arrow the stroke is back at the tip, as shares of the head's path. */
const MIN_BARB_RETURN = 0.3;
const MAX_BARB_RETURN = 0.9;
/** How far from the tip the stroke can be when it comes back to it, as a share of the shorter barb. */
const BARB_RETURN_GAP = 0.3;
/** How much longer than its three straight runs the path of the head of an arrow can be. */
const BARB_DETOUR = 1.3;

export interface Arrow extends Line {
    barbLength: number;
    /** The angle between each barb and the shaft, in degrees. */
    barbAngle: number;
}

export interface Ellipse {
    centerX: number;
    centerY: number;
    /** Half the length of the ellipse along its own axes, the first of them turned by `angle`. */
    radiusX: number;
    radiusY: number;
    /** In degrees, clockwise on the screen. */
    angle: number;
}

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

/**
 * Returns the ellipse that a stroke was drawn as, from its flat `x, y, pressure` triples. The
 * stroke goes once around the ellipse inside the smallest box around it, within
 * `ELLIPSE_DEVIATION` of the way from its center to its edge, and ends where it started. An
 * ellipse nearly as wide as long is a circle, and any other lies along the axes when it was drawn
 * within `AXIS_SNAP` degrees of them.
 */
export function recognizeEllipse(stroke: number[], minSize: number): Ellipse | undefined {
    if (stroke.length < 12 || stroke.length > 3 * MAX_STROKE_POINTS) return undefined;
    const points = trimToLoop(stroke);
    const box = fitBox(points, getLongAxisAngle(points));
    const { cos, sin } = box;
    let radiusX = box.width / 2;
    let radiusY = box.height / 2;
    if (Math.min(radiusX, radiusY) * 2 < minSize) return undefined;

    const centerU = (box.minU + box.maxU) / 2;
    const centerV = (box.minV + box.maxV) / 2;
    let pathLength = 0;
    for (let i = 0; i + 2 < points.length; i += 3) {
        const u = points[i] * cos + points[i + 1] * sin - centerU;
        const v = points[i + 1] * cos - points[i] * sin - centerV;
        if (Math.abs(Math.hypot(u / radiusX, v / radiusY) - 1) > ELLIPSE_DEVIATION) return undefined;
        if (i) pathLength += Math.hypot(points[i] - points[i - 3], points[i + 1] - points[i - 2]);
    }
    const perimeter = getEllipsePerimeter(radiusX, radiusY);
    if (pathLength < MIN_ROUND * perimeter || pathLength > MAX_ROUND * perimeter) return undefined;
    if (getClosingGap(points) > CLOSING_GAP * perimeter / 2) return undefined;

    let { angle } = box;
    const quarters = Math.round(angle / 90);
    if (Math.min(radiusX, radiusY) >= CIRCLE_RATIO * Math.max(radiusX, radiusY)) {
        radiusX = radiusY = (radiusX + radiusY) / 2;
        angle = 0;
    } else if (Math.abs(angle - quarters * 90) <= AXIS_SNAP) {
        if (quarters % 2) [ radiusX, radiusY ] = [ radiusY, radiusX ];
        angle = 0;
    }
    return {
        centerX: centerU * cos - centerV * sin,
        centerY: centerU * sin + centerV * cos,
        radiusX, radiusY, angle
    };
}

/**
 * Returns the flat `x, y, pressure` triples of a stroke around `ellipse`, at one pressure, with a
 * point about every `ELLIPSE_STEP` units. The stroke ends on its first point.
 */
export function ellipseToPoints({ centerX, centerY, radiusX, radiusY, angle }: Ellipse, pressure: number) {
    const cos = Math.cos(angle * Math.PI / 180);
    const sin = Math.sin(angle * Math.PI / 180);
    const steps = Math.ceil(getEllipsePerimeter(radiusX, radiusY) / ELLIPSE_STEP);
    const count = Math.max(MIN_ELLIPSE_POINTS, Math.min(MAX_ELLIPSE_POINTS, steps));
    const points: number[] = [];
    for (let i = 0; i <= count; i++) {
        const x = radiusX * Math.cos(2 * Math.PI * i / count);
        const y = radiusY * Math.sin(2 * Math.PI * i / count);
        points.push(centerX + x * cos - y * sin, centerY + x * sin + y * cos, pressure);
    }
    return points;
}

/**
 * Returns the arrow that a stroke was drawn as, from its flat `x, y, pressure` triples. The stroke
 * goes along the shaft to the tip, where it first turns back toward its start, then out along one
 * barb, back to the tip and out along the other barb, on the other side of the shaft. The arrow
 * keeps the ends of the shaft drawn, and its two barbs take the mean length and the mean angle of
 * those drawn.
 */
export function recognizeArrow(points: number[], minSize: number): Arrow | undefined {
    const count = points.length / 3;
    if (count < 8) return undefined;
    const fromX = points[0];
    const fromY = points[1];
    const fromStart = (i: number) => Math.hypot(points[3 * i] - fromX, points[3 * i + 1] - fromY);
    let reach = 0;
    for (let i = 1; i < count; i++) {
        reach = Math.max(reach, fromStart(i));
    }
    // The stroke can come back to the tip a little further out than it first got there.
    let tip = 0;
    let shaftLength = 0;
    for (let i = 1; i < count; i++) {
        const distance = fromStart(i);
        if (distance > shaftLength) {
            shaftLength = distance;
            tip = i;
        } else if (distance < shaftLength - TIP_RETREAT * reach) {
            break;
        }
    }
    const toX = points[3 * tip];
    const toY = points[3 * tip + 1];
    if (!recognizeLine(points.slice(0, 3 * tip + 3), minSize)) return undefined;

    // The head: how far along it each point is, and how far from the tip.
    const along = [ 0 ];
    const away = [ 0 ];
    for (let i = tip + 1; i < count; i++) {
        const step = Math.hypot(points[3 * i] - points[3 * i - 3], points[3 * i + 1] - points[3 * i - 2]);
        along.push(along[along.length - 1] + step);
        away.push(Math.hypot(points[3 * i] - toX, points[3 * i + 1] - toY));
    }
    const headLength = along[along.length - 1];
    let back = -1;
    for (let i = 0; i < away.length; i++) {
        if (along[i] < MIN_BARB_RETURN * headLength || along[i] > MAX_BARB_RETURN * headLength) continue;
        if (back < 0 || away[i] < away[back]) back = i;
    }
    if (back < 0) return undefined;
    const furthest = (from: number, to: number) => {
        let best = from;
        for (let i = from; i <= to; i++) {
            if (away[i] > away[best]) best = i;
        }
        return best;
    };
    const barbs = [ furthest(0, back), furthest(back, away.length - 1) ];
    const shortBarb = Math.min(away[barbs[0]], away[barbs[1]]);
    const longBarb = Math.max(away[barbs[0]], away[barbs[1]]);
    if (shortBarb < MIN_BARB * shaftLength || longBarb > MAX_BARB * shaftLength) return undefined;
    if (away[back] > BARB_RETURN_GAP * shortBarb) return undefined;
    if (headLength > BARB_DETOUR * (2 * away[barbs[0]] + away[barbs[1]])) return undefined;

    // The angle of each barb from the shaft, as seen from the tip, negative on one side of it.
    const angles = barbs.map((barb) => {
        const x = points[3 * (tip + barb)] - toX;
        const y = points[3 * (tip + barb) + 1] - toY;
        const cross = (fromX - toX) * y - (fromY - toY) * x;
        const dot = (fromX - toX) * x + (fromY - toY) * y;
        return Math.atan2(cross, dot) * 180 / Math.PI;
    });
    if (angles[0] * angles[1] >= 0) return undefined;
    if (angles.some((angle) => Math.abs(angle) < MIN_BARB_ANGLE || Math.abs(angle) > MAX_BARB_ANGLE)) {
        return undefined;
    }
    return {
        fromX, fromY, toX, toY,
        barbLength: (shortBarb + longBarb) / 2,
        barbAngle: (Math.abs(angles[0]) + Math.abs(angles[1])) / 2
    };
}

/**
 * Returns the flat `x, y, pressure` triples of a stroke along `arrow`, at one pressure: the shaft
 * to the tip, one barb, and by way of the tip again the other.
 */
export function arrowToPoints({ fromX, fromY, toX, toY, barbLength, barbAngle }: Arrow, pressure: number) {
    const shaftAngle = Math.atan2(fromY - toY, fromX - toX);
    const barb = (side: number) => {
        const angle = shaftAngle + side * barbAngle * Math.PI / 180;
        return [ toX + barbLength * Math.cos(angle), toY + barbLength * Math.sin(angle) ];
    };
    return pathToPoints([ [ fromX, fromY ], [ toX, toY ], barb(1), [ toX, toY ], barb(-1) ], pressure);
}

/**
 * Returns the points of the shape that a stroke was drawn as, at one pressure: a rectangle, a
 * triangle, an ellipse or an arrow.
 */
export function shapeToPoints(points: number[], minSize: number, pressure: number) {
    const corners = recognizeRectangle(points, minSize) ?? recognizeTriangle(points, minSize);
    if (corners) return polygonToPoints(corners, pressure);
    const ellipse = recognizeEllipse(points, minSize);
    if (ellipse) return ellipseToPoints(ellipse, pressure);
    const arrow = recognizeArrow(points, minSize);
    return arrow && arrowToPoints(arrow, pressure);
}

const CORNER_SIGNS = [ [ -1, -1 ], [ 1, -1 ], [ 1, 1 ], [ -1, 1 ] ];

/**
 * The angle of the direction along which a stroke spreads most, in degrees between -90 and 90.
 * Each segment of the stroke counts by its length, so that the speed of the pointer, which sets
 * how close the points are, does not turn it.
 */
function getLongAxisAngle(points: number[]) {
    let total = 0;
    let middleX = 0;
    let middleY = 0;
    const segments: number[][] = [];
    for (let i = 3; i + 2 < points.length; i += 3) {
        const length = Math.hypot(points[i] - points[i - 3], points[i + 1] - points[i - 2]);
        const x = (points[i] + points[i - 3]) / 2;
        const y = (points[i + 1] + points[i - 2]) / 2;
        segments.push([ x, y, length ]);
        total += length;
        middleX += x * length;
        middleY += y * length;
    }
    if (!total) return 0;

    let spreadX = 0;
    let spreadY = 0;
    let spreadBoth = 0;
    for (const [ x, y, length ] of segments) {
        const dx = x - middleX / total;
        const dy = y - middleY / total;
        spreadX += dx * dx * length;
        spreadY += dy * dy * length;
        spreadBoth += dx * dy * length;
    }
    return Math.atan2(2 * spreadBoth, spreadX - spreadY) * 90 / Math.PI;
}

/** Ramanujan's approximation of the perimeter of an ellipse. */
function getEllipsePerimeter(radiusX: number, radiusY: number) {
    return Math.PI * (3 * (radiusX + radiusY) - Math.sqrt((3 * radiusX + radiusY) * (radiusX + 3 * radiusY)));
}

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
    const { minU, maxU, minV, maxV, width, height, cos, sin } = fitSmallestBox(points);
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

/** The box of the smallest area around a stroke, at any angle from 0 to 90 degrees. */
function fitSmallestBox(points: number[]) {
    let box = fitBox(points, 0);
    for (let angle = ANGLE_STEP; angle < 90; angle += ANGLE_STEP) {
        const candidate = fitBox(points, angle);
        if (candidate.width * candidate.height < box.width * box.height) box = candidate;
    }
    return box;
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
 * Returns the part of a stroke between its two points nearest to each other, one in its first
 * quarter and one in its last. A stroke around a shape often runs past its start, and the ends
 * left out here lie beside the loop, not on it.
 */
function trimToLoop(points: number[]) {
    const count = points.length / 3;
    const quarter = Math.max(1, Math.floor(count / 4));
    let from = 0;
    let to = count - 1;
    let gap = Infinity;
    for (let i = 0; i < quarter; i++) {
        for (let j = count - quarter; j < count; j++) {
            const distance = Math.hypot(points[3 * i] - points[3 * j], points[3 * i + 1] - points[3 * j + 1]);
            if (distance < gap) {
                gap = distance;
                from = i;
                to = j;
            }
        }
    }
    return points.slice(3 * from, 3 * to + 3);
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
