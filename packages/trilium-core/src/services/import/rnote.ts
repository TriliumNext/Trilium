import {
    encodePoints, lineToPoints, MAX_STROKE_SIZE, polygonToPoints, POSITION_SCALE, type SerializedStroke
} from "@triliumnext/commons";
import { gunzipSync, zlibSync } from "fflate";

import { decodeBase64, decodeUtf8, encodeUtf8 } from "../utils/binary.js";
import { escapeHtml } from "../utils/index.js";

/**
 * A converted RNote document: a handwriting note when it holds ink, and a text note when it holds
 * only typed text and images. `skipped` counts the elements of each kind the note cannot hold.
 */
export type RnoteConversion =
    | { type: "handwriting", content: string, skipped: Record<string, number> }
    | { type: "text", blocks: RnoteBlock[], skipped: Record<string, number> };

/** A block of a text note, in reading order: a paragraph of HTML, or a PNG shown at `width` by `height`. */
export type RnoteBlock =
    | { type: "paragraph", html: string }
    | { type: "image", png: Uint8Array, width: number, height: number };

/**
 * Converts an RNote document (`.rnote`, gzipped JSON). The pen strokes, the lines and the
 * rectangles become the strokes of a handwriting note; RNote measures in pixels at 96 dpi, as a
 * handwriting note does, so positions are kept. A document without them becomes the blocks of a
 * text note, from its text boxes and images. Returns `undefined` for a file that is not an RNote
 * document or that holds none of these.
 */
export function convertRnote(file: Uint8Array): RnoteConversion | undefined {
    const read = readSnapshot(file);
    if (!read) return undefined;
    const { snapshot, components } = read;

    const elements: RnoteElement[] = [];
    for (const [ index, component ] of components.entries()) {
        const value = asRecord(asRecord(component)?.value);
        if (!value) continue;
        const [ kind ] = Object.keys(value);
        elements.push({ index, kind, value: asRecord(value[kind]) });
    }

    const chrono: unknown[] = Array.isArray(snapshot.chrono_components) ? snapshot.chrono_components : [];
    const strokes: { order: number, json: string }[] = [];
    const skipped: Record<string, number> = {};
    for (const { index, kind, value } of elements) {
        const stroke = convertStroke(kind, value);
        if (!stroke) {
            skipped[kind] = (skipped[kind] ?? 0) + 1;
            continue;
        }
        const order = asRecord(asRecord(chrono[index])?.value)?.t;
        strokes.push({ order: isFiniteNumber(order) ? order : index, json: JSON.stringify(stroke) });
    }
    if (!strokes.length) return convertToText(elements);

    strokes.sort((a, b) => a.order - b.order);
    const config = asRecord(asRecord(snapshot.document)?.config);
    const document = [
        `"version":1`,
        `"paper":${JSON.stringify(convertPaper(asRecord(config?.background)?.pattern))}`,
        `"layout":"infinite"`
    ];
    document.push(`"strokes":[${strokes.map((stroke) => stroke.json).join(",")}]`);
    return { type: "handwriting", content: `{${document.join(",")}}`, skipped };
}

type JsonRecord = Record<string, unknown>;

/** An element of a document: its index among the stroke slots, its kind and its fields. */
interface RnoteElement {
    index: number;
    kind: string;
    value: JsonRecord | undefined;
}

/** The pressure of a stroke whose width does not follow the pressure. */
const EVEN_PRESSURE = 0.5;
/** The only pixel format of an image that `convertImage()` reads. */
const PREMULTIPLIED_RGBA = "R8g8b8a8Premultiplied";
/** The longest side, in pixels, that `stretchPixels()` stretches a picture to. */
const MAX_STRETCHED_SIDE = 8192;

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
        let widest = 0;
        for (const share of widths) widest = Math.max(widest, share);
        return buildStroke(look, width * widest, 0, points);
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

/**
 * Returns the blocks of a text note from the text boxes and the images of a document without ink,
 * from top to bottom and then from left to right. A text box repeated at the same place, as a
 * document converted from OneNote holds its title, is kept once.
 */
function convertToText(elements: RnoteElement[]): RnoteConversion | undefined {
    const placed: { top: number, left: number, block: RnoteBlock }[] = [];
    const skipped: Record<string, number> = {};
    const paragraphs = new Set<string>();
    for (const { kind, value } of elements) {
        const converted = value && convertBlock(kind, value);
        if (!converted) {
            skipped[kind] = (skipped[kind] ?? 0) + 1;
            continue;
        }
        if (converted.block.type === "paragraph") {
            const key = `${converted.top},${converted.left},${converted.block.html}`;
            if (paragraphs.has(key)) continue;
            paragraphs.add(key);
        }
        placed.push(converted);
    }
    if (!placed.length) return undefined;

    placed.sort((a, b) => a.top - b.top || a.left - b.left);
    return { type: "text", blocks: placed.map(({ block }) => block), skipped };
}

function convertBlock(kind: string, value: JsonRecord) {
    if (kind === "textstroke") return convertText(value);
    if (kind === "bitmapimage") return convertImage(value);
    return undefined;
}

/**
 * Returns a text box as a paragraph at the top left corner of the box. Its line breaks are kept,
 * and its color and the colors of its ranges become spans that carry the color both as `color` and
 * as `--tn-color`, so it adapts to the theme. Black text takes the theme's text color.
 */
function convertText(stroke: JsonRecord) {
    const { text } = stroke;
    const affine = asRecord(stroke.transform)?.affine;
    if (typeof text !== "string" || !text.trim() || !Array.isArray(affine) || !affine.every(isFiniteNumber)) {
        return undefined;
    }
    const style = asRecord(stroke.text_style);
    const baseColor = toHex(style?.color);

    // The ranges count the bytes of the UTF-8 text.
    const ranges: { start: number, end: number, color: string | undefined }[] = [];
    const attributes = style?.ranged_text_attributes;
    for (const attribute of Array.isArray(attributes) ? attributes : []) {
        const range = asRecord(asRecord(attribute)?.range);
        const textColor = asRecord(asRecord(attribute)?.attribute)?.text_color;
        if (!range || !textColor || !isFiniteNumber(range.start) || !isFiniteNumber(range.end)) continue;
        ranges.push({ start: range.start, end: range.end, color: toHex(textColor) });
    }

    const runs: { color: string | undefined, text: string }[] = [];
    let byte = 0;
    for (const character of text) {
        const range = ranges.findLast(({ start, end }) => byte >= start && byte < end);
        const color = range ? range.color : baseColor;
        const last = runs.at(-1);
        if (last && last.color === color) {
            last.text += character;
        } else {
            runs.push({ color, text: character });
        }
        byte += encodeUtf8(character).length;
    }

    const html = runs.map(({ color, text }) => {
        const escaped = text.split(/\r\n|\r|\n/).map(escapeHtml).join("<br>");
        return color ? `<span style="color:${color};--tn-color:${color};">${escaped}</span>` : escaped;
    }).join("");
    return { top: affine[7], left: affine[6], block: { type: "paragraph" as const, html: `<p>${html}</p>` } };
}

/**
 * Returns an image as a PNG, at the size and the top left corner its rectangle has in the
 * document. RNote stores the pixels as premultiplied RGBA.
 */
function convertImage(image: JsonRecord) {
    const pixels = asRecord(image.image);
    const width = pixels?.pixel_width;
    const height = pixels?.pixel_height;
    if (!pixels || typeof pixels.data !== "string" || pixels.memory_format !== PREMULTIPLIED_RGBA
        || !isFiniteNumber(width) || !isFiniteNumber(height) || width < 1 || height < 1) {
        return undefined;
    }
    const rectangle = asRecord(image.rectangle);
    const extents = asPosition(asRecord(rectangle?.cuboid)?.half_extents);
    const affine = asRecord(rectangle?.transform)?.affine;
    if (!extents || !Array.isArray(affine) || !affine.every(isFiniteNumber)) return undefined;

    let data: Uint8Array;
    try {
        data = decodeBase64(pixels.data);
    } catch {
        return undefined;
    }
    if (data.length !== width * height * 4) return undefined;

    // The 3x3 matrix is stored a column at a time.
    const [ a, b, , c, d, , tx, ty ] = affine;
    const halfWidth = Math.abs(extents[0]) * Math.hypot(a, b);
    const halfHeight = Math.abs(extents[1]) * Math.hypot(c, d);
    const stretched = stretchPixels(data, width, height, halfWidth / halfHeight);
    return {
        top: ty - halfHeight,
        left: tx - halfWidth,
        block: {
            type: "image" as const,
            png: encodePng(stretched.data, stretched.width, stretched.height),
            width: Math.round(2 * halfWidth),
            height: Math.round(2 * halfHeight)
        }
    };
}

/**
 * Returns RGBA pixels stretched to the shape `ratio` (width over height) by repeating rows or
 * columns, as a text note shows a picture in its own proportions. The side that grows stays
 * within `MAX_STRETCHED_SIDE` pixels, or the side it had.
 */
function stretchPixels(data: Uint8Array, width: number, height: number, ratio: number) {
    if (!Number.isFinite(ratio) || ratio <= 0) return { data, width, height };
    const targetWidth = Math.max(width, Math.min(MAX_STRETCHED_SIDE, Math.round(height * ratio)));
    const targetHeight = Math.max(height, Math.min(MAX_STRETCHED_SIDE, Math.round(width / ratio)));
    if (targetWidth === width && targetHeight === height) return { data, width, height };

    const stretched = new Uint8Array(targetWidth * targetHeight * 4);
    for (let y = 0; y < targetHeight; y++) {
        const fromRow = Math.floor(y * height / targetHeight) * width;
        for (let x = 0; x < targetWidth; x++) {
            const from = (fromRow + Math.floor(x * width / targetWidth)) * 4;
            stretched.set(data.subarray(from, from + 4), (y * targetWidth + x) * 4);
        }
    }
    return { data: stretched, width: targetWidth, height: targetHeight };
}

/** Encodes premultiplied RGBA pixels as a PNG of straight RGBA, each row unfiltered. */
function encodePng(premultiplied: Uint8Array, width: number, height: number) {
    const rowLength = width * 4 + 1;
    const rows = new Uint8Array(height * rowLength);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width * 4; x += 4) {
            const from = y * width * 4 + x;
            const to = y * rowLength + 1 + x;
            const alpha = premultiplied[from + 3];
            for (let channel = 0; channel < 3; channel++) {
                const value = premultiplied[from + channel];
                rows[to + channel] = alpha === 0 || alpha === 255
                    ? value
                    : Math.min(255, Math.round(value * 255 / alpha));
            }
            rows[to + 3] = alpha;
        }
    }

    const header = new Uint8Array(13);
    const view = new DataView(header.buffer);
    view.setUint32(0, width);
    view.setUint32(4, height);
    // A bit depth of 8, the RGBA color type, and the default compression, filter and interlace.
    header.set([ 8, 6, 0, 0, 0 ], 8);

    const chunks = [ pngChunk("IHDR", header), pngChunk("IDAT", zlibSync(rows)), pngChunk("IEND", new Uint8Array()) ];
    const png = new Uint8Array(PNG_SIGNATURE.length + chunks.reduce((total, chunk) => total + chunk.length, 0));
    png.set(PNG_SIGNATURE);
    let offset = PNG_SIGNATURE.length;
    for (const chunk of chunks) {
        png.set(chunk, offset);
        offset += chunk.length;
    }
    return png;
}

const PNG_SIGNATURE = [ 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a ];

/** Returns a PNG chunk: the length of `data`, the type, `data`, and the CRC-32 of the type and `data`. */
function pngChunk(type: string, data: Uint8Array) {
    const chunk = new Uint8Array(12 + data.length);
    const view = new DataView(chunk.buffer);
    view.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) {
        chunk[4 + i] = type.charCodeAt(i);
    }
    chunk.set(data, 8);
    const table = getCrcTable();
    let crc = 0xffffffff;
    for (let i = 4; i < 8 + data.length; i++) {
        crc = table[(crc ^ chunk[i]) & 0xff] ^ (crc >>> 8);
    }
    view.setUint32(8 + data.length, (crc ^ 0xffffffff) >>> 0);
    return chunk;
}

let crcTable: Uint32Array | undefined;

function getCrcTable() {
    if (!crcTable) {
        crcTable = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) {
                c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
            }
            crcTable[n] = c;
        }
    }
    return crcTable;
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
    const { a } = asRecord(color) ?? {};
    const alpha = isFiniteNumber(a) ? a : 1;
    if (alpha <= 0) return undefined;
    const hex = toHex(color);
    return {
        ...(alpha < 1 && { t: "h" as const }),
        ...(hex && { c: hex })
    };
}

/** Returns an RNote color as `#rrggbb`, or `undefined` for black and for no color. */
function toHex(color: unknown) {
    const { r, g, b } = asRecord(color) ?? {};
    if (!isFiniteNumber(r) || !isFiniteNumber(g) || !isFiniteNumber(b)) return undefined;
    const channels = [ r, g, b ].map((channel) => Math.round(Math.min(1, Math.max(0, channel)) * 255));
    const hex = `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
    return hex === "#000000" ? undefined : hex;
}

function convertPaper(pattern: unknown) {
    if (typeof pattern !== "string") return "blank";
    if (pattern.includes("grid")) return "grid";
    if (pattern.includes("dots")) return "dots";
    if (pattern.includes("lines")) return "ruled";
    return "blank";
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
