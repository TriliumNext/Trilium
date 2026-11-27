import {
    dropRepeatedPoints, encodePoints, lineToPoints, MAX_STROKE_SIZE, polygonToPoints, type SerializedImage,
    serializeImportedHandwriting, type SerializedStroke, type SerializedTextBox, TEXT_BOX_PADDING
} from "@triliumnext/commons";
import { gunzipSync, zlibSync } from "fflate";

import { decodeBase64, decodeUtf8, encodeUtf8 } from "../utils/binary.js";
import { escapeHtml } from "../utils/index.js";

/**
 * A converted RNote document, which `serializeRnote()` turns into the content of a handwriting
 * note. `skipped` counts the elements of each kind the note cannot hold.
 */
export interface RnoteConversion {
    paper: string;
    /** The JSON of each stroke, in drawing order. */
    strokes: string[];
    images: RnoteImage[];
    texts: RnoteTextBox[];
    skipped: Record<string, number>;
}

/** A PNG and the rectangle it covers, in world units. */
export interface RnoteImage {
    png: Uint8Array;
    x: number;
    y: number;
    width: number;
    height: number;
}

/** A text box with a font size, in world units. */
export type RnoteTextBox = SerializedTextBox & { s: number };

/**
 * Converts an RNote document (`.rnote`, gzipped JSON) to the parts of a handwriting note. The pen
 * strokes, the lines and the rectangles become strokes, the images become images and the text
 * boxes become text boxes. RNote measures in pixels at 96 dpi, as a handwriting note does, so
 * positions are kept. Returns `undefined` for a file that is not an RNote document or that holds
 * none of these.
 */
export function convertRnote(file: Uint8Array): RnoteConversion | undefined {
    const read = readSnapshot(file);
    if (!read) return undefined;
    const { snapshot, components } = read;

    const chrono: unknown[] = Array.isArray(snapshot.chrono_components) ? snapshot.chrono_components : [];
    const strokes: Ordered<string>[] = [];
    const images: Ordered<RnoteImage>[] = [];
    const texts: Ordered<Omit<RnoteTextBox, "id">>[] = [];
    const skipped: Record<string, number> = {};
    for (const [ index, component ] of components.entries()) {
        const record = asRecord(asRecord(component)?.value);
        if (!record) continue;
        const [ kind ] = Object.keys(record);
        const value = asRecord(record[kind]);
        const time = asRecord(asRecord(chrono[index])?.value)?.t;
        const order = isFiniteNumber(time) ? time : index;

        const stroke = value && convertStroke(kind, value);
        const image = value && kind === "bitmapimage" ? convertImage(value) : undefined;
        const text = value && kind === "textstroke" ? convertText(value) : undefined;
        if (stroke) {
            strokes.push({ order, item: JSON.stringify(stroke) });
        } else if (image) {
            images.push({ order, item: image });
        } else if (text) {
            texts.push({ order, item: text });
        } else {
            skipped[kind] = (skipped[kind] ?? 0) + 1;
        }
    }
    if (!strokes.length && !images.length && !texts.length) return undefined;

    // A document converted from OneNote holds its title twice, as two text boxes at one place.
    const seen = new Set<string>();
    const uniqueTexts = inOrder(texts).filter(({ x, y, html }) => {
        const key = `${x},${y},${html}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    const config = asRecord(asRecord(snapshot.document)?.config);
    return {
        paper: convertPaper(asRecord(config?.background)?.pattern),
        strokes: inOrder(strokes),
        images: inOrder(images),
        texts: uniqueTexts.map((text, index) => ({ id: `rnote${index + 1}`, ...text })),
        skipped
    };
}

/**
 * Returns the content of the handwriting note of `conversion`. `imageUrls` holds the URL that
 * serves each of its images, which must match the client's `IMAGE_URL_PATTERN`. An image without
 * a URL is left out.
 */
export function serializeRnote(
    { paper, strokes, images, texts }: RnoteConversion, imageUrls: (string | undefined)[] = []
) {
    const savedImages: SerializedImage[] = [];
    for (const [ index, { x, y, width, height } ] of images.entries()) {
        const url = imageUrls[index];
        if (url) savedImages.push({ url, x, y, w: width, h: height });
    }
    return serializeImportedHandwriting({ paper, strokes, images: savedImages, texts });
}

type JsonRecord = Record<string, unknown>;

/** A converted element and its place in the drawing order. */
interface Ordered<T> {
    order: number;
    item: T;
}

function inOrder<T>(items: Ordered<T>[]) {
    return items.sort((a, b) => a.order - b.order).map(({ item }) => item);
}

/** The pressure of a stroke whose width does not follow the pressure. */
const EVEN_PRESSURE = 0.5;
/** The only pixel format of an image that `convertImage()` reads. */
const PREMULTIPLIED_RGBA = "R8g8b8a8Premultiplied";
/** The font size of a text box that holds none, as in RNote. */
const DEFAULT_FONT_SIZE = 32;
/** The width of a character of a text box without a width, as a share of its font size. */
const CHARACTER_WIDTH = 0.6;
/** The narrowest text box, which must match the client's `MIN_WIDTH` in TextBoxLayer.tsx. */
const MIN_TEXT_WIDTH = 80;

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

function convertStroke(kind: string, stroke: JsonRecord): SerializedStroke | undefined {
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

/** Builds a saved stroke from flat `x, y, pressure` triples, without its repeated points. */
function buildStroke(
    look: Pick<SerializedStroke, "t" | "c">, size: number, sensitivity: number, points: number[]
): SerializedStroke | undefined {
    if (!(size > 0)) return undefined;
    const kept = dropRepeatedPoints(points);
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
 * Returns a text box whose text starts where it does in the document, as one paragraph. Its line
 * breaks are kept, and its color and the colors of its ranges become spans that carry the color
 * both as `color` and as `--tn-color`, so it adapts to the theme. Black text takes the theme's
 * text color. The box keeps the font size, and one without a width is as wide as its longest line
 * at that size.
 */
function convertText(stroke: JsonRecord): Omit<RnoteTextBox, "id"> | undefined {
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

    // RNote can stretch a box more one way than the other, which a text box cannot. The font size
    // follows the smaller stretch, so the text takes no more lines and no taller ones than in RNote.
    const scaleX = Math.hypot(affine[0], affine[1]);
    const scaleY = Math.hypot(affine[3], affine[4]);
    const fontSize = isFiniteNumber(style?.font_size) && style.font_size > 0 ? style.font_size : DEFAULT_FONT_SIZE;
    const maxWidth = style?.max_width;
    let longestLine = 0;
    for (const line of text.split(/\r\n|\r|\n/)) {
        longestLine = Math.max(longestLine, line.length);
    }
    const width = isFiniteNumber(maxWidth) && maxWidth > 0 ? maxWidth : longestLine * fontSize * CHARACTER_WIDTH;
    return {
        x: affine[6] - TEXT_BOX_PADDING.x,
        y: affine[7] - TEXT_BOX_PADDING.y,
        w: Math.max(MIN_TEXT_WIDTH, width * scaleX + 2 * TEXT_BOX_PADDING.x),
        s: fontSize * Math.min(scaleX, scaleY),
        html: `<p>${html}</p>`
    };
}

/**
 * Returns an image as a PNG and the rectangle it covers in the document, which stretches the
 * picture when it has another shape. RNote stores the pixels as premultiplied RGBA.
 */
function convertImage(image: JsonRecord): RnoteImage | undefined {
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
    if (!(halfWidth > 0) || !(halfHeight > 0)) return undefined;
    return {
        png: encodePng(data, width, height),
        x: tx - halfWidth,
        y: ty - halfHeight,
        width: 2 * halfWidth,
        height: 2 * halfHeight
    };
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
