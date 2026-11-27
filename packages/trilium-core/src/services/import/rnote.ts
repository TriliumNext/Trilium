import { gunzipSync } from "fflate";

import { decodeUtf8 } from "../utils/binary.js";

export interface RnoteConversion {
    /** The content of a handwriting note. */
    content: string;
    /** How many elements of each kind the handwriting note cannot hold, such as text and images. */
    skipped: Record<string, number>;
}

/**
 * Converts an RNote document (`.rnote`, gzipped JSON) into the content of a handwriting note. The
 * pen strokes, the lines and the rectangles become strokes; RNote measures in pixels at 96 dpi,
 * as a handwriting note does, so positions are kept. Returns `undefined` for a file that is not an
 * RNote document or that holds no ink.
 */
export function convertRnote(file: Uint8Array): RnoteConversion | undefined {
    const read = readSnapshot(file);
    if (!read) return undefined;
    const { snapshot, components } = read;

    const chrono: unknown[] = Array.isArray(snapshot.chrono_components) ? snapshot.chrono_components : [];
    const strokes: { order: number, json: string }[] = [];
    const skipped: Record<string, number> = {};
    for (const [ index, component ] of components.entries()) {
        const value = asRecord(asRecord(component)?.value);
        if (!value) continue;
        const [ kind ] = Object.keys(value);
        const stroke = convertStroke(kind, asRecord(value[kind]));
        if (!stroke) {
            skipped[kind] = (skipped[kind] ?? 0) + 1;
            continue;
        }
        const order = asRecord(asRecord(chrono[index])?.value)?.t;
        strokes.push({ order: isFiniteNumber(order) ? order : index, json: JSON.stringify(stroke) });
    }
    if (!strokes.length) return undefined;

    strokes.sort((a, b) => a.order - b.order);
    const config = asRecord(asRecord(snapshot.document)?.config);
    const document = [
        `"version":1`,
        `"paper":${JSON.stringify(convertPaper(asRecord(config?.background)?.pattern))}`,
        `"layout":"infinite"`
    ];
    const view = convertCamera(asRecord(snapshot.camera));
    if (view) document.push(`"view":${JSON.stringify(view)}`);
    document.push(`"strokes":[${strokes.map((stroke) => stroke.json).join(",")}]`);
    return { content: `{${document.join(",")}}`, skipped };
}

/** A stroke as `parseInkDocument()` of the client's `ink_document.ts` reads it. */
interface SerializedStroke {
    t?: "h";
    c?: string;
    w: number;
    k?: number;
    p: number[];
}

type JsonRecord = Record<string, unknown>;

// These match the constants of the same names in the client's `ink_document.ts`.
const POSITION_SCALE = 10;
const PRESSURE_SCALE = 255;
const MAX_STROKE_SIZE = 60;

/** The pressure of a stroke whose width does not follow the pressure. */
const EVEN_PRESSURE = 0.5;
/** The distance from a corner of a shape to the first point after it, in world units. */
const CORNER_STEP = 1;

const GZIP_MAGIC = [ 0x1f, 0x8b ];

function readSnapshot(file: Uint8Array) {
    if (file[0] !== GZIP_MAGIC[0] || file[1] !== GZIP_MAGIC[1]) return undefined;
    let parsed: unknown;
    try {
        parsed = JSON.parse(decodeUtf8(gunzipSync(file)));
    } catch {
        return undefined;
    }
    const snapshot = asRecord(asRecord(asRecord(parsed)?.data)?.engine_snapshot);
    const components: unknown = snapshot?.stroke_components;
    return snapshot && Array.isArray(components) ? { snapshot, components: components as unknown[] } : undefined;
}

function convertStroke(kind: string, stroke: JsonRecord | undefined): SerializedStroke | undefined {
    if (!stroke) return undefined;
    if (kind === "brushstroke") return convertBrushStroke(stroke);
    if (kind === "shapestroke") return convertShapeStroke(stroke);
    return undefined;
}

function convertBrushStroke(stroke: JsonRecord): SerializedStroke | undefined {
    const style = firstValue(stroke.style);
    const path = asRecord(stroke.path);
    if (!style || !path || !Array.isArray(path.segments)) return undefined;

    // Each segment is a line or a curve to its `end`; a curve is followed through its ends.
    const elements = [ path.start, ...path.segments.map((segment) => firstValue(segment)?.end) ];
    const positions: number[] = [];
    const widths: number[] = [];
    for (const element of elements) {
        const position = asPosition(asRecord(element)?.pos);
        if (!position) continue;
        positions.push(...position);
        widths.push(getWidthShare(style.pressure_curve, asRecord(element)?.pressure));
    }
    if (!widths.length) return undefined;

    const width = isFiniteNumber(style.stroke_width) ? style.stroke_width : 2;
    const look = convertColor(style.stroke_color);
    if (!look) return undefined;

    // The highlighter has one width, and so has a stroke drawn at one pressure.
    const widest = Math.max(...widths);
    if (look.t || widths.every((share) => share === widths[0])) {
        return buildStroke(look, width * widest, 0, positions, () => EVEN_PRESSURE);
    }
    // At a sensitivity of 100, a stroke is as wide as twice its size times the pressure.
    return buildStroke(look, width / 2, 100, positions, (index) => widths[index]);
}

function convertShapeStroke(stroke: JsonRecord): SerializedStroke | undefined {
    const style = firstValue(stroke.style);
    const shape = asRecord(stroke.shape);
    const look = convertColor(style?.stroke_color);
    if (!style || !shape || !look) return undefined;

    const vertices = getShapeVertices(shape);
    if (!vertices) return undefined;
    const positions = pathToPositions(vertices);
    const width = isFiniteNumber(style.stroke_width) ? style.stroke_width : 2;
    return buildStroke(look, width, 0, positions, () => EVEN_PRESSURE);
}

/** Returns the vertices of the path along a line or around a rectangle, or `undefined` for another shape. */
function getShapeVertices(shape: JsonRecord): number[][] | undefined {
    const line = asRecord(shape.line);
    if (line) {
        const start = asPosition(line.start);
        const end = asPosition(line.end);
        return start && end ? [ start, end ] : undefined;
    }

    const rect = asRecord(shape.rect);
    const extents = asPosition(asRecord(rect?.cuboid)?.half_extents);
    const affine = asRecord(rect?.transform)?.affine;
    if (!extents || !extents[0] || !extents[1] || !Array.isArray(affine) || !affine.every(isFiniteNumber)) {
        return undefined;
    }
    // The 3x3 matrix is stored a column at a time.
    const [ a, b, , c, d, , tx, ty ] = affine;
    const corners = [ [ -1, -1 ], [ 1, -1 ], [ 1, 1 ], [ -1, 1 ] ].map(([ signX, signY ]) => {
        const x = signX * extents[0];
        const y = signY * extents[1];
        return [ a * x + c * y + tx, b * x + d * y + ty ];
    });
    // The path starts and ends in the middle of a side, where its two ends make no corner.
    const [ first, second ] = corners;
    const start = [ (first[0] + second[0]) / 2, (first[1] + second[1]) / 2 ];
    return [ start, ...corners.slice(1), first, start ];
}

/**
 * Returns flat `x, y` pairs along the straight segments between `vertices`. The client's
 * `StrokeBuilder` moves each point only part of the way to the next, which rounds a corner by
 * about the distance between the points around it, so the points lie `CORNER_STEP` from each
 * vertex and twice as far apart with each step away from it, as in the client's `pathToPoints()`.
 */
function pathToPositions(vertices: number[][]) {
    const positions = [ ...vertices[0] ];
    for (let index = 0; index + 1 < vertices.length; index++) {
        const [ fromX, fromY ] = vertices[index];
        const [ toX, toY ] = vertices[index + 1];
        const length = Math.hypot(toX - fromX, toY - fromY);
        if (!length) continue;
        const add = (distance: number) => positions.push(
            fromX + (toX - fromX) * distance / length, fromY + (toY - fromY) * distance / length
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
            for (const step of steps.reverse()) {
                add(length - step);
            }
        }
        add(length);
    }
    return positions;
}

/**
 * Builds a saved stroke from flat `x, y` pairs. Points are stored in tenths of a unit as the
 * difference from the previous one, and a point that falls on the previous one is left out.
 */
function buildStroke(
    look: Pick<SerializedStroke, "t" | "c">, size: number, sensitivity: number, positions: number[],
    getPressure: (index: number) => number
): SerializedStroke | undefined {
    if (!(size > 0)) return undefined;
    const encoded: number[] = [];
    let previous: number[] | undefined;
    for (let i = 0; i + 1 < positions.length; i += 2) {
        const current = [
            Math.round(positions[i] * POSITION_SCALE),
            Math.round(positions[i + 1] * POSITION_SCALE),
            Math.round(getPressure(i / 2) * PRESSURE_SCALE)
        ];
        if (previous && current[0] === previous[0] && current[1] === previous[1]) continue;
        encoded.push(...current.map((value, axis) => value - (previous?.[axis] ?? 0)));
        previous = current;
    }
    if (!encoded.length) return undefined;

    return {
        ...look,
        w: Math.min(MAX_STROKE_SIZE, Math.round(size * 100) / 100),
        // The highlighter ignores the sensitivity.
        ...(!look.t && { k: sensitivity }),
        p: encoded
    };
}

/** The share of its full width that a stroke has at `pressure`, under one of RNote's pressure curves. */
function getWidthShare(curve: unknown, pressure: unknown) {
    const clamped = isFiniteNumber(pressure) ? Math.min(1, Math.max(0, pressure)) : 1;
    switch (curve) {
        case "const": return 1;
        case "sqrt": return Math.sqrt(clamped);
        case "cbrt": return Math.cbrt(clamped);
        case "pow2": return clamped ** 2;
        case "pow3": return clamped ** 3;
        default: return clamped;
    }
}

/**
 * Returns the tool and the color of a stroke, or `undefined` for one that cannot be seen. Black
 * ink takes the color of the text, which is left out of a saved stroke, and translucent ink is
 * the highlighter's.
 */
function convertColor(color: unknown): Pick<SerializedStroke, "t" | "c"> | undefined {
    const { r, g, b, a } = asRecord(color) ?? {};
    if (!isFiniteNumber(r) || !isFiniteNumber(g) || !isFiniteNumber(b)) return {};
    const alpha = isFiniteNumber(a) ? a : 1;
    if (alpha <= 0) return undefined;

    const channels = [ r, g, b ].map((channel) => Math.round(Math.min(1, Math.max(0, channel)) * 255));
    const hex = `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
    return {
        ...(alpha < 1 && { t: "h" as const }),
        ...(hex !== "#000000" && { c: hex })
    };
}

function convertPaper(pattern: unknown) {
    if (typeof pattern !== "string") return "blank";
    if (pattern.includes("grid")) return "grid";
    if (pattern.includes("dots")) return "dots";
    if (pattern.includes("lines")) return "ruled";
    return "blank";
}

/** Returns the view of the note from RNote's camera, whose `offset` is the corner of the window in screen pixels. */
function convertCamera(camera: JsonRecord | undefined) {
    const offset = asPosition(camera?.offset);
    const size = asPosition(camera?.size);
    const zoom = camera?.zoom;
    if (!offset || !size || !isFiniteNumber(zoom) || zoom <= 0) return undefined;
    return {
        x: Math.round((offset[0] + size[0] / 2) / zoom * 10) / 10,
        y: Math.round((offset[1] + size[1] / 2) / zoom * 10) / 10,
        zoom: Math.round(zoom * 1000) / 1000
    };
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

function asRecord(value: unknown): JsonRecord | undefined {
    return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : undefined;
}

/** Returns the value of the only key of an object that stands for a Rust enum, such as `{ "lineto": { … } }`. */
function firstValue(value: unknown) {
    const record = asRecord(value);
    return record ? asRecord(Object.values(record)[0]) : undefined;
}

function asPosition(value: unknown): [ number, number ] | undefined {
    if (!Array.isArray(value)) return undefined;
    const [ x, y ] = value;
    return isFiniteNumber(x) && isFiniteNumber(y) ? [ x, y ] : undefined;
}
