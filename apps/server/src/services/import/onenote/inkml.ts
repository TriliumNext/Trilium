/**
 * Converts OneNote InkML (handwriting / drawing strokes) into a single SVG image.
 *
 * OneNote returns a page's ink separately from its HTML (see graph.parsePageContent): the default
 * HTML output drops the strokes, leaving only `<!-- InkNode is not supported -->` placeholders, while
 * the actual strokes arrive as an InkML part when the page is fetched with `includeInkML=true`. We
 * render those strokes to one SVG so they can be embedded as an inline image in the imported note.
 *
 * OneNote hands back all of a page's ink as a single positionless blob, so the SVG necessarily lands
 * as one image (in reading order, after the page text) rather than overlaid at the strokes' original
 * canvas coordinates — the same limitation Obsidian's importer has.
 *
 * Ported from Obsidian's MIT-licensed OneNote importer
 * (https://github.com/obsidianmd/obsidian-importer — src/formats/onenote/inkml.ts), adapted to parse
 * with node-html-parser (server-side) instead of the browser DOMParser, and to strip OneNote's XML
 * namespace prefixes.
 */

import { HTMLElement, parse } from "node-html-parser";

/** Padding around the rendered strokes, in coordinate units. */
const PADDING = 10;

/** Cap the SVG's displayed size so a high-resolution ink canvas doesn't render as a giant image. */
const MAX_DISPLAY_SIZE = 800;

interface Brush {
    color: string;
    width: number;
    height: number;
    transparency: number;
}

interface Trace {
    coords: number[][];
    brush: Brush;
}

const DEFAULT_BRUSH: Brush = { color: "#000000", width: 70, height: 70, transparency: 0 };

/**
 * OneNote's automatic ink colors. Like its automatic *text* color (see removeDefaultTextColor in
 * converter.ts), the default pen isn't a chosen color: it's black on OneNote's light canvas but
 * inverts to white in dark mode. These two are rendered theme-adaptively (see AUTO_INK_STYLE) rather
 * than baked as a hard color that would be unreadable under the opposite theme; every deliberately
 * picked color is left exactly as OneNote sent it.
 */
const AUTOMATIC_INK_COLORS = new Set(["#000000", "#000", "black", "#ffffff", "#fff", "white"]);

/** The class carried by an automatic-colored shape; the color itself comes from {@link AUTO_INK_STYLE}. */
const AUTO_INK_CLASS = "ink-auto";

/**
 * Theme-adaptive styling for automatic-colored strokes. `color-scheme: light dark` enables the
 * `light-dark()` function; the used scheme is inherited from the embedding `<img>` — Trilium sets
 * `color-scheme` from its active theme on `:root` (theme-next/base.css) and Chromium propagates it
 * into the referenced SVG — so the ink follows Trilium's light/dark toggle instead of rendering as
 * unreadable black-on-dark. Paths take the color on `stroke`, single-point dots on `fill`; qualifying
 * each rule by element keeps the fill rule from overriding a path's `fill="none"` and flooding it solid.
 * Emitted only when at least one automatic stroke is present.
 */
const AUTO_INK_STYLE =
    `<style>svg{color-scheme:light dark}` +
    `path.${AUTO_INK_CLASS}{stroke:light-dark(#000,#fff)}` +
    `circle.${AUTO_INK_CLASS}{fill:light-dark(#000,#fff)}</style>`;

/**
 * The on-screen stroke thickness. Pens carry equal width/height, but highlighters (rectangle tip)
 * carry a small width and a large height — so taking the larger dimension renders highlighters as the
 * wide swath they are rather than a thin pen line.
 */
function strokeWidth(brush: Brush): number {
    return Math.max(brush.width, brush.height);
}

/** Whether a brush color is OneNote's mode-adaptive automatic ink (default black / its white inverse). */
function isAutomaticColor(color: string): boolean {
    return AUTOMATIC_INK_COLORS.has(color.trim().toLowerCase());
}

export function inkmlToSvg(inkml: string): string | null {
    if (!inkml || inkml.trim().length === 0) {
        return null;
    }

    const root = parse(cleanInkml(stripNamespaces(inkml)), { lowerCaseTagName: true });
    const brushes = parseBrushes(root);
    const traces = parseTraces(root, brushes);
    if (traces.length === 0) {
        return null;
    }

    const { minX, minY, maxX, maxY } = boundingBox(traces);
    if (!Number.isFinite(minX)) {
        return null;
    }

    const width = maxX - minX + PADDING * 2;
    const height = maxY - minY + PADDING * 2;
    const scale = Math.min(1, MAX_DISPLAY_SIZE / Math.max(width, height, 1));

    const hasAutomaticInk = traces.some((trace) => isAutomaticColor(trace.brush.color));
    const shapes = traces.flatMap((trace) => traceToSvg(trace, minX, minY)).join("");
    return (
        `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(width * scale)}" height="${Math.round(height * scale)}" ` +
        `viewBox="0 0 ${width} ${height}">${hasAutomaticInk ? AUTO_INK_STYLE : ""}${shapes}</svg>`
    );
}

/** Strips XML namespace prefixes from element names (`<inkml:trace>` → `<trace>`) for plain-name querying. */
function stripNamespaces(xml: string): string {
    return xml.replace(/<(\/?)[a-zA-Z][\w.-]*:/g, "<$1");
}

/** Drops any trailing junk after the closing `</ink>` tag (the MIME split usually handles this already). */
function cleanInkml(content: string): string {
    const match = content.match(/<\/ink>/);
    return match && match.index !== undefined ? content.slice(0, match.index + match[0].length) : content;
}

function parseBrushes(root: HTMLElement): Map<string, Brush> {
    const brushes = new Map<string, Brush>();
    for (const el of root.querySelectorAll("brush")) {
        const id = el.getAttribute("xml:id") ?? el.getAttribute("id");
        if (!id) {
            continue;
        }
        const brush: Brush = { ...DEFAULT_BRUSH };
        for (const prop of el.querySelectorAll("brushproperty")) {
            const name = prop.getAttribute("name");
            const value = prop.getAttribute("value");
            if (!name || value == null) {
                continue;
            }
            if (name === "color") {
                brush.color = value;
            } else if (name === "width") {
                brush.width = Number.parseFloat(value) || brush.width;
            } else if (name === "height") {
                brush.height = Number.parseFloat(value) || brush.height;
            } else if (name === "transparency") {
                brush.transparency = Number.parseFloat(value) || 0;
            }
        }
        brushes.set(id, brush);
    }
    return brushes;
}

function parseTraces(root: HTMLElement, brushes: Map<string, Brush>): Trace[] {
    const traces: Trace[] = [];
    for (const el of root.querySelectorAll("trace")) {
        let ref = el.getAttribute("brushref") ?? "";
        if (ref.startsWith("#")) {
            ref = ref.slice(1);
        }
        const coords = parseCoords(el.textContent ?? "");
        if (coords.length > 0) {
            traces.push({ coords, brush: brushes.get(ref) ?? DEFAULT_BRUSH });
        }
    }
    return traces;
}

/** Parses a trace's `x y` (comma-separated) coordinate list, scaling fractional values for precision. */
function parseCoords(text: string): number[][] {
    return text
        .replace(/\n/g, "")
        .split(",")
        .map((coord) =>
            coord
                .trim()
                .split(/\s+/)
                .filter((part) => part.length > 0)
                .map((axis) => {
                    const num = Number.parseFloat(axis);
                    return Number.isInteger(num) ? Math.round(num) : Math.round(num * 10000);
                })
        )
        .filter((coord) => coord.length >= 2 && coord.every(Number.isFinite));
}

function boundingBox(traces: Trace[]): { minX: number; minY: number; maxX: number; maxY: number } {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const trace of traces) {
        for (const [x, y] of trace.coords) {
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
        }
    }
    return { minX, minY, maxX, maxY };
}

function traceToSvg(trace: Trace, minX: number, minY: number): string[] {
    const { color, transparency } = trace.brush;
    const width = strokeWidth(trace.brush);
    const opacity = 1 - transparency;
    const opacityAttr = opacity < 1 ? ` opacity="${opacity.toFixed(2)}"` : "";
    const point = (coord: number[]) => [coord[0] - minX + PADDING, coord[1] - minY + PADDING];
    const automatic = isAutomaticColor(color);

    if (trace.coords.length === 1) {
        const [x, y] = point(trace.coords[0]);
        const fillAttr = automatic ? ` class="${AUTO_INK_CLASS}"` : ` fill="${color}"`;
        return [`<circle cx="${x}" cy="${y}" r="${width / 2}"${fillAttr}${opacityAttr}/>`];
    }

    const path = trace.coords.map((coord, index) => `${index === 0 ? "M" : "L"} ${point(coord).join(" ")}`).join(" ");
    const strokeAttr = automatic ? ` class="${AUTO_INK_CLASS}"` : ` stroke="${color}"`;
    return [`<path d="${path}"${strokeAttr} stroke-width="${width}" fill="none" stroke-linecap="round" stroke-linejoin="round"${opacityAttr}/>`];
}

export default { inkmlToSvg };
