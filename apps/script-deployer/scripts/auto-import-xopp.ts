/**
 * @trilium-script
 *
 * id: auto-import-xopp
 * type: backend
 * title: Auto-import XOPP to Canvas
 * executeButton: true
 * executeDescription: Converts all .xopp children of this note into Excalidraw canvas notes.
 */

import zlib from "zlib";

// ── Color mapping ────────────────────────────────────────────────────────────

const XOPP_COLORS: Record<string, string> = {
    black: "#000000",
    blue: "#3333cc",
    red: "#ff0000",
    green: "#008000",
    gray: "#808080",
    lightblue: "#00c0ff",
    lightgreen: "#00ff00",
    magenta: "#ff00ff",
    orange: "#ff8000",
    yellow: "#ffff00",
    white: "#ffffff",
};

function convertColor(color: string | null): string {
    if (!color) return "#000000";
    const lower = color.toLowerCase();
    if (XOPP_COLORS[lower]) return XOPP_COLORS[lower];
    if (lower.startsWith("#")) {
        return lower.length > 7 ? lower.slice(0, 7) : lower;
    }
    return "#000000";
}

function extractOpacity(color: string | null): number {
    if (!color) return 100;
    if (color.startsWith("#") && color.length === 9) {
        const alpha = parseInt(color.slice(7, 9), 16);
        return Math.round((alpha / 255) * 100);
    }
    return 100;
}

// ── Excalidraw element helpers ───────────────────────────────────────────────

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

// ── xml2js element accessors ─────────────────────────────────────────────────

/** Get attribute from an xml2js node. */
function attr(node: Record<string, unknown>, name: string): string | null {
    const attrs = node.$ as Record<string, string> | undefined;
    return attrs?.[name] ?? null;
}

/** Get text content from an xml2js node. */
function text(node: Record<string, unknown>): string {
    return (node._ as string | undefined)?.trim() ?? "";
}

/** Get child elements by tag name, always as array. */
function children(node: Record<string, unknown>, tag: string): Record<string, unknown>[] {
    const val = node[tag];
    if (!val) return [];
    return Array.isArray(val) ? val : [val as Record<string, unknown>];
}

// ── Converters ───────────────────────────────────────────────────────────────

interface ExcalidrawFile {
    mimeType: string;
    id: string;
    dataURL: string;
    created: number;
    lastRetrieved: number;
}

function convertStroke(strokeNode: Record<string, unknown>, yOffset: number) {
    const coordText = text(strokeNode);
    const coords = coordText.split(/\s+/).map(Number);
    if (coords.length < 4) return null;

    const originX = coords[0];
    const originY = coords[1] + yOffset;
    const points: number[][] = [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    for (let i = 0; i < coords.length; i += 2) {
        const px = coords[i] - originX;
        const py = (coords[i + 1] + yOffset) - originY;
        points.push([px, py]);
        minX = Math.min(minX, px);
        minY = Math.min(minY, py);
        maxX = Math.max(maxX, px);
        maxY = Math.max(maxY, py);
    }

    const widthAttr = attr(strokeNode, "width") || "2";
    const widths = widthAttr.trim().split(/\s+/).map(Number);
    const hasPressure = widths.length > 1;

    let pressures: number[] = [];
    if (hasPressure) {
        const maxW = Math.max(...widths);
        pressures = widths.map((w) => maxW > 0 ? w / maxW : 0.5);
        while (pressures.length < points.length) {
            pressures.push(pressures[pressures.length - 1] || 0.5);
        }
        pressures = pressures.slice(0, points.length);
    }

    const color = attr(strokeNode, "color") || "black";
    const tool = attr(strokeNode, "tool") || "pen";
    const isHighlighter = tool === "highlighter";

    const el = makeBaseElement("freedraw", originX, originY, maxX - minX, maxY - minY);
    el.points = points;
    el.pressures = hasPressure ? pressures : [];
    el.simulatePressure = !hasPressure;
    el.strokeColor = convertColor(color);
    el.strokeWidth = Math.floor(widths[0] || 1);
    el.opacity = isHighlighter ? 40 : extractOpacity(color);
    el.lastCommittedPoint = points[points.length - 1] || null;

    return el;
}

function convertText(textNode: Record<string, unknown>, yOffset: number) {
    const x = parseFloat(attr(textNode, "x") ?? "0");
    const y = parseFloat(attr(textNode, "y") ?? "0") + yOffset;
    const size = parseFloat(attr(textNode, "size") ?? "12");
    const color = attr(textNode, "color") || "black";
    const content = text(textNode);

    if (!content) return null;

    const lines = content.split("\n");
    const estWidth = Math.max(...lines.map((l) => l.length)) * size * 0.6;
    const estHeight = lines.length * size * 1.3;

    const el = makeBaseElement("text", x, y, estWidth, estHeight);
    el.text = content;
    el.fontSize = size;
    el.fontFamily = 5;
    el.textAlign = "left";
    el.verticalAlign = "top";
    el.strokeColor = convertColor(color);
    el.opacity = extractOpacity(color);
    el.containerId = null;
    el.originalText = content;
    el.autoResize = true;
    el.lineHeight = 1.25;

    return el;
}

function convertImage(
    imageNode: Record<string, unknown>,
    yOffset: number,
    files: Record<string, ExcalidrawFile>,
) {
    const left = parseFloat(attr(imageNode, "left") ?? "");
    const top = parseFloat(attr(imageNode, "top") ?? "") + yOffset;
    const right = parseFloat(attr(imageNode, "right") ?? "");
    const bottom = parseFloat(attr(imageNode, "bottom") ?? "") + yOffset;

    if (isNaN(left) || isNaN(top) || isNaN(right) || isNaN(bottom)) return null;

    const imgData = text(imageNode);
    if (!imgData) return null;

    const fileId = generateId();
    files[fileId] = {
        mimeType: "image/png",
        id: fileId,
        dataURL: `data:image/png;base64,${imgData}`,
        created: Date.now(),
        lastRetrieved: Date.now(),
    };

    const el = makeBaseElement("image", left, top, right - left, bottom - top);
    el.fileId = fileId;
    el.status = "saved";
    el.scale = [1, 1];

    return el;
}

// ── Main conversion ──────────────────────────────────────────────────────────

function convertXoppXml(doc: Record<string, unknown>) {
    const xournal = doc.xournal as Record<string, unknown> | undefined;
    if (!xournal) throw new Error("Not a valid .xopp file: missing <xournal> root element");

    const pages = children(xournal, "page");
    const elements: Record<string, unknown>[] = [];
    const files: Record<string, ExcalidrawFile> = {};
    let yOffset = 0;
    const PAGE_GAP = 80;

    for (const page of pages) {
        const pageHeight = parseFloat(attr(page, "height") ?? "792");
        const pageWidth = parseFloat(attr(page, "width") ?? "612");

        // Page boundary rectangle
        const bgRect = makeBaseElement("rectangle", 0, yOffset, pageWidth, pageHeight);
        bgRect.strokeColor = "#d0d0d0";
        bgRect.strokeWidth = 1;
        bgRect.strokeStyle = "dashed";
        bgRect.backgroundColor = "transparent";
        bgRect.opacity = 50;
        elements.push(bgRect);

        const layers = children(page, "layer");
        for (const layer of layers) {
            for (const stroke of children(layer, "stroke")) {
                const el = convertStroke(stroke, yOffset);
                if (el) elements.push(el);
            }
            for (const txt of children(layer, "text")) {
                const el = convertText(txt, yOffset);
                if (el) elements.push(el);
            }
            for (const img of children(layer, "image")) {
                const el = convertImage(img, yOffset, files);
                if (el) elements.push(el);
            }
        }

        yOffset += pageHeight + PAGE_GAP;
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

// ── Entry point (manually run) ───────────────────────────────────────────────

const scriptNote = api.currentNote;
const childNotes = scriptNote.getChildNotes();

for (const note of childNotes) {
    if (note.type !== "file" || !note.title?.endsWith(".xopp")) {
        continue;
    }

    const content = note.getContent();
    const xmlBuffer = zlib.gunzipSync(content);
    const xmlString = xmlBuffer.toString("utf-8");

    api.xml2js.parseString(xmlString, (err: Error | null, result: Record<string, unknown>) => {
        if (err) {
            api.log(`auto-import-xopp: failed to parse XML for "${note.title}": ${err.message}`);
            return;
        }

        try {
            const excalidrawData = convertXoppXml(result);
            const title = note.title.replace(/\.xopp$/, "");

            const { note: canvasNote } = api.createNewNote({
                parentNoteId: scriptNote.noteId,
                title,
                content: JSON.stringify(excalidrawData),
                type: "canvas",
            });

            api.log(`auto-import-xopp: converted "${note.title}" → canvas note ${canvasNote.noteId}`);
        } catch (convErr) {
            const msg = convErr instanceof Error ? convErr.message : String(convErr);
            api.log(`auto-import-xopp: conversion failed for "${note.title}": ${msg}`);
        }
    });
}
