import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

import * as ckeditorIcons from "@ckeditor/ckeditor5-icons";
import opentype from "opentype.js";
import ttf2woff2 from "ttf2woff2";

import { paper, PaperOffset } from "../headless_paper";
import type { IconPackData } from "../provider";
import { getModulePath, measureFont } from "../utils";

const PREFIX = "cke";
const UNITS_PER_EM = 1000;
const ASCENDER = 850;
const DESCENDER = -150;
/** The first code point of the Private Use Area, where the glyphs are numbered from. */
const FIRST_CODE_POINT = 0xe000;

/** Trilium's own editor icons, next to the plugins that use them. */
const TRILIUM_ICON_DIRS = [
    "src/icons",
    "src/plugins/ai_assistant/theme/icons",
    "src/plugins/snippets/theme/icons"
];

/**
 * Presentation attributes for the icons that CKEditor styles from its stylesheet instead of from
 * the SVG. Each value matches the rule the editor applies to that icon.
 */
const STYLESHEET_PRESENTATION: Record<string, string> = {
    // `.ck-widget__type-around__button svg *`
    IconReturnArrow: `fill="none" stroke="currentColor" stroke-width="1.5" `
        + `stroke-linecap="round" stroke-linejoin="round"`
};

interface IconSource {
    id: string;
    svg: string;
}

/**
 * Builds a font out of the SVG icons of the text editor: those CKEditor 5 ships and those Trilium's
 * own plugins add. The User Guide uses them to name a toolbar button in running text.
 *
 * Every shape is drawn in one color, including the parts an icon draws at reduced opacity.
 */
export default function buildIcons(): IconPackData {
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

    for (const { id, svg } of collectSources()) {
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
            terms: [ id.slice(PREFIX.length + 1) ]
        };
    }

    const font = new opentype.Font({
        familyName: "Trilium Text Editor Icons",
        styleName: "Regular",
        unitsPerEm: UNITS_PER_EM,
        ascender: ASCENDER,
        descender: DESCENDER,
        glyphs
    });
    const otf = Buffer.from(font.toArrayBuffer());
    const packageJsonPath = join(getModulePath("@ckeditor/ckeditor5-icons"), "package.json");
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));

    return {
        name: "Text Editor Icons",
        prefix: PREFIX,
        icon: `${PREFIX} ${PREFIX}-pilcrow`,
        manifest: {
            icons,
            metrics: measureFont(parseFont(otf))
        },
        fontFile: {
            name: "text-editor-icons.woff2",
            mime: "font/woff2",
            content: ttf2woff2(otf)
        },
        meta: {
            version: packageJson.version,
            website: "https://ckeditor.com/docs/ckeditor5/latest/",
            description: "The icons of the text editor's toolbar: those of CKEditor 5 and those "
                + "Trilium adds, to name a button when documenting the editor."
        }
    };
}

/** The upstream icons first, then Trilium's under `cke-trilium-*`, which keeps the names apart. */
function collectSources(): IconSource[] {
    const sources: IconSource[] = [];

    for (const [ exportName, svg ] of Object.entries(ckeditorIcons)) {
        if (!exportName.startsWith("Icon") || typeof svg !== "string") continue;
        const presentation = STYLESHEET_PRESENTATION[exportName];
        sources.push({
            id: `${PREFIX}-${toKebabCase(exportName.slice("Icon".length))}`,
            svg: presentation ? svg.replace(/^<svg\b/, `<svg ${presentation}`) : svg
        });
    }

    const ckeditorPackageDir = join(__dirname, "../../../../packages/ckeditor5");
    for (const dir of TRILIUM_ICON_DIRS) {
        const fullDir = join(ckeditorPackageDir, dir);
        for (const file of readdirSync(fullDir).filter((f) => f.endsWith(".svg")).sort()) {
            const name = basename(file, ".svg");
            sources.push({
                id: name === "trilium" ? `${PREFIX}-trilium` : `${PREFIX}-trilium-${name}`,
                svg: readFileSync(join(fullDir, file), "utf-8")
            });
        }
    }

    const seen = new Set<string>();
    for (const { id } of sources) {
        if (seen.has(id)) {
            throw new Error(`Two editor icons map to the same class name: ${id}.`);
        }
        seen.add(id);
    }

    return sources;
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
    const unsized = svg.replace(/<svg\b[^>]*>/, (tag) => (
        tag.replace(/\s(width|height)="[^"]*"/g, "")
    ));
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

/** `AIAdjustLength` → `ai-adjust-length`, `Heading1` → `heading-1`. */
function toKebabCase(name: string) {
    return name
        .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
        .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
        .replace(/([a-zA-Z])([0-9])/g, "$1-$2")
        .toLowerCase();
}

function round(value: number) {
    return Math.round(value * 100) / 100;
}
