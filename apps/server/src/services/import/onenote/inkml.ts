/**
 * Converts OneNote InkML (handwriting and drawing strokes) into the strokes of a handwriting note.
 *
 * OneNote returns the ink of a page separately from its HTML (see `parsePageContent()` in
 * graph.ts): the HTML holds only `<!-- InkNode is not supported -->` placeholders, and the strokes
 * arrive as an InkML part when the page is fetched with `includeInkML=true`. The traces are in
 * himetric units from the top left corner of the page, which is also where the `left` and `top`
 * of the text boxes in the HTML are measured from, in pixels at 96 dpi. A handwriting note
 * measures in those pixels, so the ink keeps its place next to the text.
 */

import { dropRepeatedPoints, encodePoints, MAX_STROKE_SIZE, type SerializedStroke } from "@triliumnext/commons";
import { HTMLElement, parse } from "node-html-parser";

import { parseColor } from "./converter.js";

/** How many pixels at 96 dpi each unit of an InkML channel is. */
const PIXELS_PER_UNIT: Record<string, number> = {
    himetric: 96 / 2540,
    cm: 96 / 2.54,
    mm: 96 / 25.4,
    in: 96,
    pt: 96 / 72
};

interface Brush {
    color: string;
    /** The size of the tip, in himetric units. */
    width: number;
    height: number;
    transparency: number;
    ignorePressure: boolean;
}

const DEFAULT_BRUSH: Brush = { color: "#000000", width: 70, height: 70, transparency: 0, ignorePressure: false };

/** How a context scales the values of its traces. */
interface TraceFormat {
    /** How many pixels a unit of the X and Y channels is. */
    scale: number;
    /** The value of the F channel at full pressure, or `undefined` for traces without pressure. */
    maxPressure?: number;
}

const DEFAULT_FORMAT: TraceFormat = { scale: PIXELS_PER_UNIT.himetric };

/** The pressure of a stroke whose width does not follow the pressure. */
const EVEN_PRESSURE = 0.5;

/**
 * Ink with less saturation than this (0-100) and no lighter than `DARK_INK_MAX_LIGHTNESS`, or at
 * least as light as `LIGHT_INK_MIN_LIGHTNESS`, takes the text color of the theme. InkML does not
 * tell the automatic pen from a chosen color, and each OneNote client has its own near-black
 * (`#404040`, `#333333`), which a dark theme would hide, as a light theme hides the near-white ink
 * written on OneNote's dark canvas.
 */
const NEUTRAL_INK_MAX_SATURATION = 20;
const DARK_INK_MAX_LIGHTNESS = 50;
const LIGHT_INK_MIN_LIGHTNESS = 90;

/** Returns the strokes of `inkml` in drawing order, positioned in pixels from the top left corner of the page. */
export function inkmlToStrokes(inkml: string): SerializedStroke[] {
    if (!inkml.trim()) return [];

    const root = parse(cleanInkml(stripNamespaces(inkml)), { lowerCaseTagName: true });
    const brushes = parseBrushes(root);
    const formats = parseFormats(root);

    const strokes: SerializedStroke[] = [];
    for (const trace of root.querySelectorAll("trace")) {
        const brush = brushes.get(getReference(trace, "brushref")) ?? DEFAULT_BRUSH;
        const format = formats.get(getReference(trace, "contextref")) ?? DEFAULT_FORMAT;
        const stroke = convertTrace(trace.textContent, brush, format);
        if (stroke) strokes.push(stroke);
    }
    return strokes;
}

function convertTrace(text: string, brush: Brush, format: TraceFormat): SerializedStroke | undefined {
    const isHighlighter = brush.transparency > 0;
    const hasPressure = format.maxPressure !== undefined && !brush.ignorePressure && !isHighlighter;

    const points: number[] = [];
    for (const point of text.split(",")) {
        const [ x, y, force ] = point.trim().split(/\s+/).map(Number.parseFloat);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        const pressure = hasPressure && format.maxPressure && Number.isFinite(force)
            ? Math.min(1, Math.max(0, force / format.maxPressure))
            : EVEN_PRESSURE;
        points.push(x * format.scale, y * format.scale, pressure);
    }
    const kept = dropRepeatedPoints(points);
    if (!kept.length) return undefined;

    // A pen has a round tip. The tip of a highlighter is a tall rectangle, which is as wide a swath
    // as its longer side.
    const size = Math.max(brush.width, brush.height) * PIXELS_PER_UNIT.himetric;
    const color = convertColor(brush.color);
    return {
        ...(isHighlighter && { t: "h" as const }),
        ...(color && { c: color }),
        w: Math.min(MAX_STROKE_SIZE, Math.max(0.5, Math.round(size * 100) / 100)),
        // The highlighter ignores the sensitivity, and a stroke with pressure has the default one.
        ...(!isHighlighter && !hasPressure && { k: 0 }),
        p: encodePoints(kept)
    };
}

/** Returns the color as `#rrggbb`, or `undefined` for ink that takes the text color of the theme. */
function convertColor(color: string) {
    const parsed = parseColor(color.trim());
    if (!parsed) return undefined;
    const lightness = parsed.lightness();
    const isNeutral = parsed.saturationl() < NEUTRAL_INK_MAX_SATURATION;
    if (isNeutral && (lightness <= DARK_INK_MAX_LIGHTNESS || lightness >= LIGHT_INK_MIN_LIGHTNESS)) return undefined;
    return parsed.hex().toLowerCase();
}

/** Strips XML namespace prefixes from element names (`<inkml:trace>` → `<trace>`) for plain-name querying. */
function stripNamespaces(xml: string): string {
    return xml.replace(/<(\/?)[a-zA-Z][\w.-]*:/g, "<$1");
}

/** Drops what follows the closing `</ink>` tag, which the MIME split can leave. */
function cleanInkml(content: string): string {
    const match = content.match(/<\/ink>/);
    return match && match.index !== undefined ? content.slice(0, match.index + match[0].length) : content;
}

/** Returns the ID that the `attribute` of a trace refers to, without its `#`. */
function getReference(trace: HTMLElement, attribute: string) {
    const reference = trace.getAttribute(attribute) ?? "";
    return reference.startsWith("#") ? reference.slice(1) : reference;
}

function getId(element: HTMLElement) {
    return element.getAttribute("xml:id") ?? element.getAttribute("id");
}

function parseBrushes(root: HTMLElement): Map<string, Brush> {
    const brushes = new Map<string, Brush>();
    for (const element of root.querySelectorAll("brush")) {
        const id = getId(element);
        if (!id) continue;
        const brush: Brush = { ...DEFAULT_BRUSH };
        for (const property of element.querySelectorAll("brushproperty")) {
            const name = property.getAttribute("name");
            const value = property.getAttribute("value");
            if (value === undefined) continue;
            if (name === "color") {
                brush.color = value;
            } else if (name === "width") {
                brush.width = Number.parseFloat(value) || brush.width;
            } else if (name === "height") {
                brush.height = Number.parseFloat(value) || brush.height;
            } else if (name === "transparency") {
                brush.transparency = Number.parseFloat(value) || 0;
            } else if (name === "ignorePressure") {
                brush.ignorePressure = value === "true";
            }
        }
        brushes.set(id, brush);
    }
    return brushes;
}

function parseFormats(root: HTMLElement): Map<string, TraceFormat> {
    const formats = new Map<string, TraceFormat>();
    for (const context of root.querySelectorAll("context")) {
        const id = getId(context);
        if (!id) continue;
        const format: TraceFormat = { ...DEFAULT_FORMAT };
        for (const channel of context.querySelectorAll("channel")) {
            const name = channel.getAttribute("name");
            if (name === "X") {
                format.scale = PIXELS_PER_UNIT[channel.getAttribute("units") ?? ""] ?? format.scale;
            } else if (name === "F") {
                const max = Number.parseFloat(channel.getAttribute("max") ?? "");
                if (max > 0) format.maxPressure = max;
            }
        }
        formats.set(id, format);
    }
    return formats;
}
