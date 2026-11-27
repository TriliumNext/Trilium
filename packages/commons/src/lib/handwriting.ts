/**
 * A stroke in the saved content of a handwriting note, as the client's `serializeStroke()` writes
 * it and its `parseInkDocument()` reads it.
 */
export interface SerializedStroke {
    /** `"h"` for the highlighter; the pen is left out. */
    t?: "h";
    /** The color, left out for ink in the text color of the theme. */
    c?: string;
    w: number;
    /** `1` when the pressure is simulated. */
    s?: 1;
    /** The pressure sensitivity from 0 to 100, left out for the default one. */
    k?: number;
    /**
     * Flat `x, y, pressure` triples: positions in tenths of a world unit and the pressure between
     * 0 and 255. Every triple after the first holds the difference from the previous one.
     */
    p: number[];
}

/** How many steps a world unit is divided into in a saved stroke. */
export const POSITION_SCALE = 10;
const PRESSURE_SCALE = 255;
/** The widest stroke a document can hold: the highlighter at its largest thickness. */
export const MAX_STROKE_SIZE = 60;

/** Returns the `p` of a saved stroke from flat `x, y, pressure` triples in world units. */
export function encodePoints(points: number[]) {
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
export function decodePoints(encoded: unknown[]) {
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

export interface Line {
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
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

/**
 * Returns the flat `x, y, pressure` triples of a stroke around the closed polygon of `corners`, at
 * one pressure. The stroke starts and ends in the middle of the first side, where its two ends
 * make no corner.
 */
export function polygonToPoints(corners: number[][], pressure: number): number[] {
    const [ first, second ] = corners;
    const start = [ (first[0] + second[0]) / 2, (first[1] + second[1]) / 2 ];
    return pathToPoints([ start, ...corners.slice(1), first, start ], pressure);
}

/** The distance from a corner of a shape to the first point after it, in world units. */
const CORNER_STEP = 1;

/**
 * Returns the flat `x, y, pressure` triples of a stroke along the straight segments between
 * `vertices`, at one pressure. The client's `StrokeBuilder` moves each point only part of the way
 * to the next, which rounds a corner by about the distance between the points around it, so the
 * points lie `CORNER_STEP` from each vertex between two segments and twice as far apart with each
 * step away from it.
 */
export function pathToPoints(vertices: number[][], pressure: number): number[] {
    const points = [ vertices[0][0], vertices[0][1], pressure ];
    for (let index = 0; index + 1 < vertices.length; index++) {
        const [ fromX, fromY ] = vertices[index];
        const [ toX, toY ] = vertices[index + 1];
        const length = Math.hypot(toX - fromX, toY - fromY);
        if (!length) continue;
        const add = (distance: number) => points.push(
            fromX + (toX - fromX) * distance / length, fromY + (toY - fromY) * distance / length, pressure
        );
        const steps: number[] = [];
        for (let step = CORNER_STEP; step < length / 2; step *= 2) {
            steps.push(step);
        }

        if (index > 0) {
            for (const step of steps) {
                add(step);
            }
        }
        add(length / 2);
        if (index + 2 < vertices.length) {
            for (let i = steps.length - 1; i >= 0; i--) {
                add(length - steps[i]);
            }
        }
        add(length);
    }
    return points;
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}
