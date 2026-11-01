import { readFileSync } from "node:fs";
import { join } from "node:path";

import opentype from "opentype.js";
import ttf2woff2 from "ttf2woff2";

import { paper, PaperOffset } from "./headless_paper";
import type { IconPackData } from "./provider";
import { getModulePath, measureFont } from "./utils";

const UNITS_PER_EM = 1000;
const ASCENDER = 850;
const DESCENDER = -150;
/** The first code point of the Private Use Area, where the glyphs are numbered from. */
const FIRST_CODE_POINT = 0xe000;
/** One number in SVG path data. */
const PATH_NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;

export interface IconSource {
    /** The icon's class name, including the pack's prefix, such as `cke-bold`. */
    id: string;
    svg: string;
}

/**
 * Builds a font out of SVG icons, one glyph per icon, numbered from the Private Use Area in the
 * order given.
 *
 * Every shape is drawn in one color, including the parts an icon draws at reduced opacity. An icon
 * that cannot be traced is skipped with a warning.
 *
 * @param familyName the font's family name.
 * @param prefix the pack's prefix, which each icon's search term leaves out.
 * @param sources the icons, each with a unique `id`.
 * @returns the manifest and the WOFF2 font of the pack.
 */
export function buildSvgFont(familyName: string, prefix: string, sources: IconSource[]) {
    paper.setup(new paper.Size(1, 1));
    const textFont = loadTextFont();

    const glyphs = [
        new opentype.Glyph({
            name: ".notdef",
            unicode: 0,
            advanceWidth: UNITS_PER_EM,
            path: new opentype.Path()
        })
    ];
    const icons: IconPackData["manifest"]["icons"] = {};

    const ids = new Set<string>();
    for (const { id } of sources) {
        if (ids.has(id)) {
            throw new Error(`Two icons map to the same class name: ${id}.`);
        }
        ids.add(id);
    }

    for (const { id, svg } of sources) {
        let path: opentype.Path;
        try {
            path = svgToGlyphPath(svg, textFont);
        } catch (e) {
            console.warn(`Skipping icon ${id}: ${e instanceof Error ? e.message : e}`);
            continue;
        }

        const codePoint = FIRST_CODE_POINT + glyphs.length - 1;
        glyphs.push(new opentype.Glyph({
            name: id,
            unicode: codePoint,
            advanceWidth: UNITS_PER_EM,
            path
        }));
        icons[id] = {
            glyph: String.fromCodePoint(codePoint),
            terms: [ id.slice(prefix.length + 1) ]
        };
    }

    const font = new opentype.Font({
        familyName,
        styleName: "Regular",
        unitsPerEm: UNITS_PER_EM,
        ascender: ASCENDER,
        descender: DESCENDER,
        glyphs
    });
    const otf = Buffer.from(font.toArrayBuffer());

    return {
        manifest: {
            icons,
            metrics: measureFont(parseFont(otf))
        },
        woff2: ttf2woff2(otf)
    };
}

/**
 * Traces an SVG icon into the outline of one glyph, centered in the em square.
 *
 * Fonts fill by the nonzero rule, so each filled shape is reoriented from the rule it declares,
 * each stroke is expanded into the outline it paints, and each `<text>` is laid out in Arimo, the
 * metric-compatible stand-in for the Arial the icons ask for.
 */
function svgToGlyphPath(svg: string, textFont: opentype.Font): opentype.Path {
    paper.project.clear();
    const viewBox = readViewBox(svg);
    // Without `width`/`height`, the import keeps the viewBox's own coordinates.
    const unsized = separateArcFlags(svg.replace(/<svg\b[^>]*>/, (tag) => (
        tag.replace(/\s(width|height)="[^"]*"/g, "")
    )));
    const root = paper.project.importSVG(unsized, {
        expandShapes: true,
        insert: true,
        onImport: (node: Element, item: paper.Item) => {
            item.data = { filled: paints(node, "fill"), stroked: paints(node, "stroke") };
        }
    });

    const shapes: paper.PathItem[] = [];
    for (const item of root.getItems({ recursive: true })) {
        if (item instanceof paper.PointText) {
            shapes.push(textToPath(item, textFont));
        } else if ((item instanceof paper.Path || item instanceof paper.CompoundPath)
            && !(item.parent instanceof paper.CompoundPath) && !item.clipMask) {
            shapes.push(...pathToShapes(item));
        }
    }
    if (!shapes.length) {
        throw new Error("nothing is drawn");
    }

    let outline = shapes[0];
    for (const shape of shapes.slice(1)) {
        outline = outline.unite(shape, { insert: false });
    }

    const scale = UNITS_PER_EM / Math.max(viewBox.width, viewBox.height);
    const middleX = viewBox.x + viewBox.width / 2;
    const middleY = viewBox.y + viewBox.height / 2;
    const glyphMiddleY = (ASCENDER + DESCENDER) / 2;
    const toFont = (point: paper.Point) => ({
        x: round(UNITS_PER_EM / 2 + (point.x - middleX) * scale),
        y: round(glyphMiddleY - (point.y - middleY) * scale)
    });

    const path = new opentype.Path();
    for (const contour of contoursOf(outline)) {
        const segments = contour.segments;
        if (segments.length < 2) continue;

        const start = toFont(segments[0].point);
        path.moveTo(start.x, start.y);
        for (const curve of contour.curves) {
            const end = toFont(curve.point2);
            if (curve.isStraight()) {
                path.lineTo(end.x, end.y);
            } else {
                const control1 = toFont(curve.point1.add(curve.handle1));
                const control2 = toFont(curve.point2.add(curve.handle2));
                path.curveTo(control1.x, control1.y, control2.x, control2.y, end.x, end.y);
            }
        }
        path.close();
    }

    return path;
}

/**
 * Puts a space between the flags of each arc command in the SVG's path data. SVG lets them run
 * together with what follows (`a.8.8 0 00-.856 0`), which paper.js reads as one number.
 */
function separateArcFlags(svg: string) {
    const pathDataAttribute = /(\sd=)(["'])(.*?)\2/gs;
    return svg.replace(pathDataAttribute, (attribute, name: string, quote: string, d: string) => {
        if (!/[aA]/.test(d)) return attribute;
        return `${name}${quote}${tokenizePathData(d).join(" ")}${quote}`;
    });
}

/** Splits path data into its commands and parameters, an arc's two flags as a digit each. */
function tokenizePathData(data: string) {
    const tokens: string[] = [];
    let command = "";
    let parameter = 0;
    let index = 0;
    const skipSeparators = () => {
        while (index < data.length && /[\s,]/.test(data[index])) index++;
    };

    for (skipSeparators(); index < data.length; skipSeparators()) {
        const char = data[index];
        if (/[a-zA-Z]/.test(char)) {
            tokens.push(char);
            command = char;
            parameter = 0;
            index++;
            continue;
        }

        const isArcFlag = (command === "a" || command === "A")
            && (parameter % 7 === 3 || parameter % 7 === 4);
        const token = isArcFlag ? char : PATH_NUMBER.exec(data.slice(index))?.[0];
        if (!token) {
            throw new Error(`unreadable path data at "${data.slice(index, index + 10)}"`);
        }
        tokens.push(token);
        parameter++;
        index += token.length;
    }

    return tokens;
}

/** The filled and stroked areas of one path, in the SVG's own coordinates. */
function pathToShapes(item: paper.Path | paper.CompoundPath): paper.PathItem[] {
    const shapes: paper.PathItem[] = [];
    const globalMatrix = item.parent.globalMatrix;

    if (item.data.filled) {
        const fill = item.clone({ insert: false }) as paper.PathItem;
        fill.transform(globalMatrix);
        // SVG fills a sub-path without `z` as if it were closed; paper.js would cut its last curve.
        for (const contour of contoursOf(fill)) {
            contour.closePath();
        }
        fill.reorient(item.fillRule !== "evenodd", true);
        shapes.push(fill);
    }

    if (item.data.stroked && item.strokeWidth > 0) {
        const line = item.clone({ insert: false }) as paper.Path | paper.CompoundPath;
        line.transform(globalMatrix);
        const { a, b, c, d } = globalMatrix;
        const width = item.strokeWidth * Math.sqrt(Math.abs(a * d - b * c));
        shapes.push(PaperOffset.offsetStroke(line, width / 2, {
            cap: item.strokeCap as "butt" | "round",
            join: item.strokeJoin as "miter" | "round" | "bevel",
            limit: item.miterLimit,
            insert: false
        }) as paper.PathItem);
    }

    return shapes;
}

/**
 * Whether an element paints its fill or its stroke, read off the SVG rather than paper.js, whose
 * import strokes every path black when it runs on jsdom. SVG fills by default and strokes only
 * when asked to.
 */
function paints(node: Element, property: "fill" | "stroke") {
    // The import also reports the document itself, which is no element.
    const styleDeclaration = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`);
    let element: Element | null = node;
    for (; element?.nodeType === 1; element = element.parentElement) {
        const value = element.getAttribute(property)
            ?? styleDeclaration.exec(element.getAttribute("style") ?? "")?.[1];
        if (value) {
            return value.trim() !== "none";
        }
    }
    return property === "fill";
}

function textToPath(item: paper.PointText, textFont: opentype.Font): paper.PathItem {
    const content = item.content;
    for (const char of content) {
        if (textFont.charToGlyph(char).index === 0) {
            throw new Error(`the text font has no glyph for "${char}"`);
        }
    }

    const outline = new paper.CompoundPath({
        pathData: textFont.getPath(content, 0, 0, item.fontSize as number).toPathData(3),
        insert: false
    });
    outline.transform(item.globalMatrix);
    return outline;
}

/** The sub-paths of a path, each drawn as one contour of the glyph. */
function contoursOf(item: paper.PathItem) {
    return item instanceof paper.CompoundPath
        ? item.children as paper.Path[]
        : [ item as paper.Path ];
}

function readViewBox(svg: string) {
    const match = /viewBox="([^"]+)"/.exec(svg);
    if (!match) {
        throw new Error("the SVG has no viewBox");
    }

    const [ x, y, width, height ] = match[1].trim().split(/[\s,]+/).map(Number);
    return { x, y, width, height };
}

function loadTextFont() {
    return parseFont(readFileSync(
        join(getModulePath("@fontsource/arimo"), "files", "arimo-latin-400-normal.woff")
    ));
}

function parseFont(bytes: Buffer) {
    return opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
}

function round(value: number) {
    return Math.round(value * 100) / 100;
}
