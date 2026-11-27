import {
    encodePoints, lineToPoints, MAX_STROKE_SIZE, polygonToPoints, POSITION_SCALE, type SerializedStroke
} from "@triliumnext/commons";
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

type JsonRecord = Record<string, unknown>;

/** The pressure of a stroke whose width does not follow the pressure. */
const EVEN_PRESSURE = 0.5;

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
    const positions: number[][] = [];
    const widths: number[] = [];
    for (const element of elements) {
        const position = asPosition(asRecord(element)?.pos);
        if (!position) continue;
        positions.push(position);
        widths.push(getWidthShare(style.pressure_curve, asRecord(element)?.pressure));
    }
    if (!widths.length) return undefined;

    const width = isFiniteNumber(style.stroke_width) ? style.stroke_width : 2;
    const look = convertColor(style.stroke_color);
    if (!look) return undefined;

    // The highlighter has one width, and so has a stroke drawn at one pressure.
    if (look.t || widths.every((share) => share === widths[0])) {
        const points = positions.flatMap(([ x, y ]) => [ x, y, EVEN_PRESSURE ]);
        return buildStroke(look, width * Math.max(...widths), 0, points);
    }
    // At a sensitivity of 100, a stroke is as wide as twice its size times the pressure.
    const points = positions.flatMap(([ x, y ], index) => [ x, y, widths[index] ]);
    return buildStroke(look, width / 2, 100, points);
}

function convertShapeStroke(stroke: JsonRecord): SerializedStroke | undefined {
    const style = firstValue(stroke.style);
    const shape = asRecord(stroke.shape);
    const look = convertColor(style?.stroke_color);
    if (!style || !shape || !look) return undefined;

    const points = getShapePoints(shape);
    if (!points) return undefined;
    const width = isFiniteNumber(style.stroke_width) ? style.stroke_width : 2;
    return buildStroke(look, width, 0, points);
}

/** Returns the points of a stroke along a line or around a rectangle, or `undefined` for another shape. */
function getShapePoints(shape: JsonRecord): number[] | undefined {
    const line = asRecord(shape.line);
    if (line) {
        const start = asPosition(line.start);
        const end = asPosition(line.end);
        if (!start || !end) return undefined;
        return lineToPoints({ fromX: start[0], fromY: start[1], toX: end[0], toY: end[1] }, EVEN_PRESSURE);
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
    return polygonToPoints(corners, EVEN_PRESSURE);
}

/**
 * Builds a saved stroke from flat `x, y, pressure` triples. A point that falls on the previous one
 * once rounded to the precision of a saved stroke is left out.
 */
function buildStroke(
    look: Pick<SerializedStroke, "t" | "c">, size: number, sensitivity: number, points: number[]
): SerializedStroke | undefined {
    if (!(size > 0)) return undefined;
    const kept: number[] = [];
    let previous: number[] | undefined;
    for (let i = 0; i + 2 < points.length; i += 3) {
        const rounded = [ Math.round(points[i] * POSITION_SCALE), Math.round(points[i + 1] * POSITION_SCALE) ];
        if (previous && rounded[0] === previous[0] && rounded[1] === previous[1]) continue;
        kept.push(points[i], points[i + 1], points[i + 2]);
        previous = rounded;
    }
    if (!kept.length) return undefined;

    return {
        ...look,
        w: Math.min(MAX_STROKE_SIZE, Math.round(size * 100) / 100),
        // The highlighter ignores the sensitivity.
        ...(!look.t && { k: sensitivity }),
        p: encodePoints(kept)
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
