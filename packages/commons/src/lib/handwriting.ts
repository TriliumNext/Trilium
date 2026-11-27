/**
 * The media type of a handwriting note. A handwriting note is a `code` note of this media type, as
 * a Markdown note is a `code` note of a Markdown one: an instance that does not know handwriting
 * notes then shows the note as code, where its consistency check would turn a note of a type it
 * does not know into a file.
 */
export const HANDWRITING_MIME = "application/vnd.triliumnotes.handwriting+json";

/** Whether a note of `type` and `mime` is a handwriting note. */
export function isHandwritingNote(type: string | null | undefined, mime: string | null | undefined) {
    return type === "code" && mime === HANDWRITING_MIME;
}

/**
 * The version of the saved content that this build writes, which lists the strokes, the images
 * and the text boxes of a note as its `objects`. `parseInkDocument()` of the client reads any
 * version up to it.
 */
export const HANDWRITING_FORMAT_VERSION = 2;

/**
 * What every object in the `objects` of a saved handwriting note holds. The objects are in
 * drawing order, the first one at the bottom.
 */
export interface SerializedObject {
    /** Tells the objects of a note apart, and stays the same for as long as the object exists. */
    id: string;
    /** When the object was made, in milliseconds since the Unix epoch. Left out when unknown. */
    at?: number;
}

/**
 * A stroke in the saved content of a handwriting note, as the client's `serializeStroke()` writes
 * it and its `parseInkDocument()` reads it. A stroke is an object without `o`. An importer leaves
 * out the `id`, which `serializeImportedHandwriting()` gives.
 */
export interface SerializedStroke extends Partial<SerializedObject> {
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

/** An image of a handwriting note, which is saved as an object whose `o` is `"image"`. */
export interface SerializedImage {
    /** Where the attachment holding the picture is served from: `api/attachments/{id}/image/{title}`. */
    url: string;
    x: number;
    y: number;
    w: number;
    h: number;
}

/** A text box of a handwriting note, which is saved as an object whose `o` is `"text"`. */
export interface SerializedTextBox {
    id: string;
    x: number;
    y: number;
    w: number;
    /** The font size, left out for the font size of text notes. */
    s?: number;
    html: string;
}

/**
 * The space between the edge of a text box and its text, across and down, in world units. It must
 * match the padding of `.handwriting-text-box` in the client's Handwriting.css.
 */
export const TEXT_BOX_PADDING = { x: 8, y: 4 };

/** The parts of a handwriting note that an importer builds. */
export interface ImportedHandwriting {
    paper: string;
    /** The JSON of each `SerializedStroke`, in drawing order. */
    strokes: string[];
    images?: SerializedImage[];
    texts?: SerializedTextBox[];
}

/**
 * Returns the content of a handwriting note on a canvas without bounds, as the client's
 * `parseInkDocument()` reads it: the images at the bottom, then the strokes, then the text boxes,
 * which is how the client shows them. Positions and sizes are rounded to the precision of a saved
 * stroke. The images and the strokes are numbered for their `id`.
 */
export function serializeImportedHandwriting({ paper, strokes, images = [], texts = [] }: ImportedHandwriting) {
    const round = (value: number) => Math.round(value * POSITION_SCALE) / POSITION_SCALE;
    const objects = [
        ...images.map(({ url, x, y, w, h }, index) => JSON.stringify(
            { o: "image", id: `i${index + 1}`, url, x: round(x), y: round(y), w: round(w), h: round(h) }
        )),
        ...strokes.map((stroke, index) => `{"id":"s${index + 1}",${stroke.slice(1)}`),
        ...texts.map(({ id, x, y, w, s, html }) => JSON.stringify(
            { o: "text", id, x: round(x), y: round(y), w: round(w), ...(s !== undefined && { s: round(s) }), html }
        ))
    ];
    return `{"version":${HANDWRITING_FORMAT_VERSION},"paper":${JSON.stringify(paper)},"layout":"infinite",`
        + `"objects":[${objects.join(",")}]}`;
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

/**
 * Returns flat `x, y, pressure` triples without the points that fall on the one before them once
 * rounded to the precision of a saved stroke.
 */
export function dropRepeatedPoints(points: number[]) {
    const kept: number[] = [];
    let previousX: number | undefined;
    let previousY: number | undefined;
    for (let i = 0; i + 2 < points.length; i += 3) {
        const x = Math.round(points[i] * POSITION_SCALE);
        const y = Math.round(points[i + 1] * POSITION_SCALE);
        if (x === previousX && y === previousY) continue;
        kept.push(points[i], points[i + 1], points[i + 2]);
        previousX = x;
        previousY = y;
    }
    return kept;
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
