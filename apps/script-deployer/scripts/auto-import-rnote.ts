/**
 * @trilium-script
 *
 * id: auto-import-rnote
 * type: backend
 * title: Auto-import Rnote to Canvas
 * executeButton: true
 * executeDescription: Converts all .rnote children of this note into Excalidraw canvas notes.
 */

import zlib from "zlib";

// ── Types (rnote v0.9+ / v0.13 JSON format) ────────────────────────────────

interface RnoteColor {
    r: number;
    g: number;
    b: number;
    a: number;
}

interface RnoteElement {
    pos: [number, number];
    pressure: number;
}

interface RnoteSegment {
    lineto?: { end: RnoteElement };
    quadbezto?: { cp: [number, number]; end: RnoteElement };
    cubbezto?: { cp1: [number, number]; cp2: [number, number]; end: RnoteElement };
}

interface RnotePath {
    start: RnoteElement;
    segments: RnoteSegment[];
}

interface RnoteSmoothStyle {
    stroke_width: number;
    stroke_color: RnoteColor;
    fill_color?: RnoteColor;
    pressure_curve: string;
    line_style?: string;
    line_cap?: string;
}

interface RnoteBrushStroke {
    path: RnotePath;
    style: { smooth?: RnoteSmoothStyle; rough?: Record<string, unknown>; textured?: Record<string, unknown> };
}

interface RnoteTextStyle {
    font_family?: string;
    font_size?: number;
    color?: RnoteColor;
}

interface RnoteTextStroke {
    text: string;
    transform: { affine: number[] | number[][] };
    // v0.13: style, v0.14: text_style
    style?: RnoteTextStyle;
    text_style?: RnoteTextStyle;
}

interface RnoteBitmapImage {
    // v0.13: image is base64 string, v0.14: image is { data, pixel_width, pixel_height, ... }
    image: string | { data: string; pixel_width?: number; pixel_height?: number; memory_format?: string };
    // v0.13: { mins, maxs }, v0.14: { cuboid: { half_extents }, transform: { affine } }
    rectangle:
        | { mins: [number, number]; maxs: [number, number] }
        | { cuboid: { half_extents: [number, number] }; transform: { affine: number[] } };
}

interface RnoteSlotEntry {
    value: {
        brushstroke?: RnoteBrushStroke;
        textstroke?: RnoteTextStroke;
        bitmapimage?: RnoteBitmapImage;
        vectorimage?: Record<string, unknown>;
        shapestroke?: Record<string, unknown>;
    } | null;
    version: number;
}

interface RnoteFile {
    version: string;
    data: {
        engine_snapshot: {
            document: {
                x: number;
                y: number;
                width: number;
                height: number;
            };
            stroke_components: RnoteSlotEntry[];
        };
    };
}

// ── Raw RGBA → PNG encoding ─────────────────────────────────────────────────

/** Encode raw RGBA pixels into a minimal PNG buffer using zlib. */
function encodeRawRgbaToPng(data: Buffer, width: number, height: number): Buffer {
    // Un-premultiply alpha (R8g8b8a8Premultiplied → straight RGBA)
    const straight = Buffer.from(data);
    for (let i = 0; i < straight.length; i += 4) {
        const a = straight[i + 3];
        if (a > 0 && a < 255) {
            straight[i] = Math.min(255, Math.round((straight[i] * 255) / a));
            straight[i + 1] = Math.min(255, Math.round((straight[i + 1] * 255) / a));
            straight[i + 2] = Math.min(255, Math.round((straight[i + 2] * 255) / a));
        }
    }

    // Build PNG filter rows: each row prefixed with filter byte 0 (None)
    const rowLen = width * 4;
    const rawRows = Buffer.alloc(height * (1 + rowLen));
    for (let y = 0; y < height; y++) {
        rawRows[y * (1 + rowLen)] = 0; // filter: None
        straight.copy(rawRows, y * (1 + rowLen) + 1, y * rowLen, y * rowLen + rowLen);
    }

    const compressed = zlib.deflateSync(rawRows);

    // CRC-32 (used by PNG chunks)
    const crcTable: number[] = [];
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        crcTable[n] = c;
    }
    function crc32(buf: Buffer): number {
        let crc = 0xffffffff;
        for (let i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
        return (crc ^ 0xffffffff) >>> 0;
    }

    function makeChunk(type: string, data: Buffer): Buffer {
        const len = Buffer.alloc(4);
        len.writeUInt32BE(data.length);
        const typeB = Buffer.from(type, "ascii");
        const payload = Buffer.concat([typeB, data]);
        const crcB = Buffer.alloc(4);
        crcB.writeUInt32BE(crc32(payload));
        return Buffer.concat([len, payload, crcB]);
    }

    // IHDR: width, height, bit depth 8, color type 6 (RGBA)
    const ihdrData = Buffer.alloc(13);
    ihdrData.writeUInt32BE(width, 0);
    ihdrData.writeUInt32BE(height, 4);
    ihdrData[8] = 8;  // bit depth
    ihdrData[9] = 6;  // color type: RGBA
    ihdrData[10] = 0; // compression
    ihdrData[11] = 0; // filter
    ihdrData[12] = 0; // interlace

    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), // PNG signature
        makeChunk("IHDR", ihdrData),
        makeChunk("IDAT", compressed),
        makeChunk("IEND", Buffer.alloc(0)),
    ]);
}

// ── Color conversion ────────────────────────────────────────────────────────

function convertColor(c: RnoteColor): string {
    const r = Math.round(c.r * 255);
    const g = Math.round(c.g * 255);
    const b = Math.round(c.b * 255);
    return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function convertOpacity(c: RnoteColor): number {
    return Math.round(c.a * 100);
}

// ── Excalidraw element helpers ──────────────────────────────────────────────

function generateId(): string {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let id = "";
    for (let i = 0; i < 20; i++) {
        id += chars[Math.floor(Math.random() * chars.length)];
    }
    return id;
}

function makeBaseElement(type: string, x: number, y: number, width: number, height: number) {
    return {
        id: generateId(),
        type,
        x,
        y,
        width,
        height,
        angle: 0,
        strokeColor: "#000000",
        backgroundColor: "transparent",
        fillStyle: "solid",
        strokeWidth: 1,
        strokeStyle: "solid",
        roughness: 0,
        opacity: 100,
        groupIds: [] as string[],
        frameId: null,
        index: null,
        roundness: null,
        seed: Math.floor(Math.random() * 2_000_000_000),
        version: 1,
        versionNonce: Math.floor(Math.random() * 2_000_000_000),
        isDeleted: false,
        boundElements: null,
        updated: Date.now(),
        link: null,
        locked: false,
    } as Record<string, unknown>;
}

// ── Bezier flattening ───────────────────────────────────────────────────────

const BEZIER_STEPS = 8;

function flattenQuadBezier(
    p0: [number, number], pr0: number,
    cp: [number, number],
    p1: [number, number], pr1: number,
): { pos: [number, number]; pressure: number }[] {
    const result: { pos: [number, number]; pressure: number }[] = [];
    for (let i = 1; i <= BEZIER_STEPS; i++) {
        const t = i / BEZIER_STEPS;
        const u = 1 - t;
        const x = u * u * p0[0] + 2 * u * t * cp[0] + t * t * p1[0];
        const y = u * u * p0[1] + 2 * u * t * cp[1] + t * t * p1[1];
        const p = u * pr0 + t * pr1;
        result.push({ pos: [x, y], pressure: p });
    }
    return result;
}

function flattenCubicBezier(
    p0: [number, number], pr0: number,
    cp1: [number, number], cp2: [number, number],
    p1: [number, number], pr1: number,
): { pos: [number, number]; pressure: number }[] {
    const result: { pos: [number, number]; pressure: number }[] = [];
    for (let i = 1; i <= BEZIER_STEPS; i++) {
        const t = i / BEZIER_STEPS;
        const u = 1 - t;
        const x = u * u * u * p0[0] + 3 * u * u * t * cp1[0] + 3 * u * t * t * cp2[0] + t * t * t * p1[0];
        const y = u * u * u * p0[1] + 3 * u * u * t * cp1[1] + 3 * u * t * t * cp2[1] + t * t * t * p1[1];
        const p = u * pr0 + t * pr1;
        result.push({ pos: [x, y], pressure: p });
    }
    return result;
}

// ── Converters ──────────────────────────────────────────────────────────────

interface ExcalidrawFile {
    mimeType: string;
    id: string;
    dataURL: string;
    created: number;
    lastRetrieved: number;
}

function convertBrushStroke(stroke: RnoteBrushStroke) {
    const style = stroke.style.smooth;
    if (!style) return null; // rough/textured styles not yet supported

    // Flatten path into points + pressures
    const allPoints: { pos: [number, number]; pressure: number }[] = [
        { pos: stroke.path.start.pos, pressure: stroke.path.start.pressure },
    ];

    let lastPos = stroke.path.start.pos;
    let lastPressure = stroke.path.start.pressure;

    for (const seg of stroke.path.segments) {
        if (seg.lineto) {
            const end = seg.lineto.end;
            allPoints.push({ pos: end.pos, pressure: end.pressure });
            lastPos = end.pos;
            lastPressure = end.pressure;
        } else if (seg.quadbezto) {
            const end = seg.quadbezto.end;
            const flattened = flattenQuadBezier(lastPos, lastPressure, seg.quadbezto.cp, end.pos, end.pressure);
            allPoints.push(...flattened);
            lastPos = end.pos;
            lastPressure = end.pressure;
        } else if (seg.cubbezto) {
            const end = seg.cubbezto.end;
            const flattened = flattenCubicBezier(lastPos, lastPressure, seg.cubbezto.cp1, seg.cubbezto.cp2, end.pos, end.pressure);
            allPoints.push(...flattened);
            lastPos = end.pos;
            lastPressure = end.pressure;
        }
    }

    if (allPoints.length < 2) return null;

    const originX = allPoints[0].pos[0];
    const originY = allPoints[0].pos[1];

    const points: number[][] = [];
    const pressures: number[] = [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    for (const pt of allPoints) {
        const px = pt.pos[0] - originX;
        const py = pt.pos[1] - originY;
        points.push([px, py]);
        pressures.push(pt.pressure);
        minX = Math.min(minX, px);
        minY = Math.min(minY, py);
        maxX = Math.max(maxX, px);
        maxY = Math.max(maxY, py);
    }

    const el = makeBaseElement("freedraw", originX, originY, maxX - minX, maxY - minY);
    el.points = points;
    el.pressures = pressures;
    el.simulatePressure = false;
    el.strokeColor = convertColor(style.stroke_color);
    el.strokeWidth = Math.max(1, Math.floor((style.stroke_width || 1) / 2));
    el.opacity = convertOpacity(style.stroke_color);
    el.lastCommittedPoint = points[points.length - 1] || null;

    return el;
}

function convertTextStroke(text: RnoteTextStroke) {
    if (!text.text) return null;

    // Extract position from affine transform
    // v0.13: nested arrays [[1,0,tx],[0,1,ty],[0,0,1]]
    // v0.14: flat array [1,0,0, 0,1,0, tx,ty,1]
    const affine = text.transform?.affine;
    let x = 0, y = 0;
    if (Array.isArray(affine?.[0])) {
        // nested: row-major 3x3
        const nested = affine as number[][];
        x = nested[0]?.[2] ?? 0;
        y = nested[1]?.[2] ?? 0;
    } else if (affine) {
        // flat 9-element array (column-major: [m00,m10,m20, m01,m11,m21, tx,ty,1])
        const flat = affine as number[];
        x = flat[6] ?? 0;
        y = flat[7] ?? 0;
    }
    const ts = text.text_style ?? text.style;
    const size = ts?.font_size ?? 12;
    const color = ts?.color ?? { r: 0, g: 0, b: 0, a: 1 };

    const lines = text.text.split("\n");
    const estWidth = Math.max(...lines.map((l) => l.length)) * size * 0.6;
    const estHeight = lines.length * size * 1.3;

    const el = makeBaseElement("text", x, y, estWidth, estHeight);
    el.text = text.text;
    el.fontSize = size;
    el.fontFamily = 5;
    el.textAlign = "left";
    el.verticalAlign = "top";
    el.strokeColor = convertColor(color);
    el.opacity = convertOpacity(color);
    el.containerId = null;
    el.originalText = text.text;
    el.autoResize = true;
    el.lineHeight = 1.25;

    return el;
}

function convertBitmapImage(img: RnoteBitmapImage, files: Record<string, ExcalidrawFile>) {
    if (!img.image) return null;

    // Extract base64 image data and encode as PNG if needed
    let dataURL: string;
    if (typeof img.image === "string") {
        // v0.13: already PNG base64
        dataURL = `data:image/png;base64,${img.image}`;
    } else {
        // v0.14: raw RGBA pixels, need to encode as PNG
        const rawBuf = Buffer.from(img.image.data, "base64");
        const pw = img.image.pixel_width ?? 0;
        const ph = img.image.pixel_height ?? 0;
        if (!pw || !ph) return null;
        const pngBuf = encodeRawRgbaToPng(rawBuf, pw, ph);
        dataURL = `data:image/png;base64,${pngBuf.toString("base64")}`;
    }

    // Extract bounds: v0.13 uses mins/maxs, v0.14 uses cuboid + transform
    let minX: number, minY: number, w: number, h: number;
    if ("mins" in img.rectangle) {
        [minX, minY] = img.rectangle.mins;
        const [maxX, maxY] = img.rectangle.maxs;
        w = maxX - minX;
        h = maxY - minY;
    } else {
        const [halfW, halfH] = img.rectangle.cuboid.half_extents;
        const affine = img.rectangle.transform.affine;
        // flat affine: tx=affine[6], ty=affine[7]
        const cx = affine[6] ?? 0;
        const cy = affine[7] ?? 0;
        minX = cx - halfW;
        minY = cy - halfH;
        w = halfW * 2;
        h = halfH * 2;
    }

    const fileId = generateId();
    files[fileId] = {
        mimeType: "image/png",
        id: fileId,
        dataURL,
        created: Date.now(),
        lastRetrieved: Date.now(),
    };

    const el = makeBaseElement("image", minX, minY, w, h);
    el.fileId = fileId;
    el.status = "saved";
    el.scale = [1, 1];

    return el;
}

// ── Main conversion ─────────────────────────────────────────────────────────

function convertRnote(doc: RnoteFile) {
    const snapshot = doc.data?.engine_snapshot;
    if (!snapshot) throw new Error("Not a valid .rnote file: missing engine_snapshot");

    const elements: Record<string, unknown>[] = [];
    const files: Record<string, ExcalidrawFile> = {};

    for (const entry of snapshot.stroke_components) {
        if (!entry.value) continue;

        if (entry.value.brushstroke) {
            const el = convertBrushStroke(entry.value.brushstroke);
            if (el) elements.push(el);
        } else if (entry.value.textstroke) {
            const el = convertTextStroke(entry.value.textstroke);
            if (el) elements.push(el);
        } else if (entry.value.bitmapimage) {
            const el = convertBitmapImage(entry.value.bitmapimage, files);
            if (el) elements.push(el);
        }
    }

    return {
        type: "excalidraw",
        version: 2,
        elements,
        files,
        appState: {
            gridModeEnabled: false,
            viewBackgroundColor: "#ffffff",
        },
    };
}

// ── Entry point ─────────────────────────────────────────────────────────────

const scriptNote = api.currentNote;
const childNotes = scriptNote.getChildNotes();

for (const note of childNotes) {
    if (note.type !== "file" || !note.title?.endsWith(".rnote")) {
        continue;
    }

    try {
        const content = note.getContent();
        const jsonBuffer = zlib.gunzipSync(content);
        const doc: RnoteFile = JSON.parse(jsonBuffer.toString("utf-8"));

        const excalidrawData = convertRnote(doc);
        const title = note.title.replace(/\.rnote$/, "");

        const { note: canvasNote } = api.createNewNote({
            parentNoteId: scriptNote.noteId,
            title,
            content: JSON.stringify(excalidrawData),
            type: "canvas",
        });

        api.log(`auto-import-rnote: converted "${note.title}" → canvas note ${canvasNote.noteId}`);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        api.log(`auto-import-rnote: failed for "${note.title}": ${msg}`);
    }
}
