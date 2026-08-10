import type { MindElixirInstance } from "mind-elixir";

import { sanitizeNoteContentHtml } from "../../../services/sanitize_content";
import { type ExportedIcon, renderExportedIcons } from "./icons";
import { loadImageData } from "./images";

const SVG_NS = "http://www.w3.org/2000/svg";
const XHTML_NS = "http://www.w3.org/1999/xhtml";
const XLINK_NS = "http://www.w3.org/1999/xlink";

/**
 * Renders the mind map to an SVG string for the preview attachment (share pages,
 * include-note, `api/images`) using mind-elixir's native exporter.
 *
 * The native exporter clones the map's SVG layers directly, which makes it orders of
 * magnitude faster than a DOM screenshot library (~7ms vs ~1100ms with snapdom for the
 * demo map, see #10478) — but it has one known gap: labels of arrows ("custom links")
 * and summaries live in an HTML overlay (`.label-container`) rather than in the SVG
 * layers it clones, so they are missing from its output (the reason the preview was
 * previously generated with snapdom). {@link postProcessExportedSvg} re-adds them and
 * relaxes the exporter's exact-fit text boxes so rasterization cannot clip them. It also
 * carries in the node icons, which are a font the export is given none of (see icons.ts).
 *
 * Note that upstream considers `exportSvg()` deprecated in favor of DOM screenshot
 * libraries and will not fix the label gap (see
 * https://github.com/SSShooter/mind-elixir-core/issues/359) — but a screenshot pass is
 * far too slow to run on every save (it once did, via snapdom — see #10478), so Trilium
 * deliberately uses the native exporter everywhere: this helper also feeds the
 * user-triggered SVG/PNG export actions in MindMap.tsx. If a future mind-elixir release
 * removes `exportSvg()` (a loud, type-level break), vendor the exporter instead of
 * switching back to a screenshot library.
 */
export async function renderMindMapPreviewSvg(mind: MindElixirInstance): Promise<string> {
    const [ svgText, icons ] = await Promise.all([
        mind.exportSvg().text(),
        // Drawn alongside the export rather than after it: each is a drawing of its own, and the
        // first of them may have a font to wait on before there is anything to draw with.
        renderExportedIcons(mind.nodes)
    ]);
    return inlineExportedImages(postProcessExportedSvg(mind, svgText, icons));
}

/**
 * Carries the pictures of the nodes into the SVG itself, as data of their own.
 *
 * The exporter points each of them at the address it was drawn from, and that address is of no use
 * to whoever ends up holding the SVG: it is read as a picture — on a share page, in an included
 * note, as the note's own image — and a picture drawn by the browser is not allowed to fetch
 * anything from anywhere, whatever it points at. The same is true of the rasterizer the PNG export
 * runs through, which would additionally be barred from reading back a canvas it had tainted.
 *
 * Each picture is redrawn to about the size it is shown at rather than carried at its full weight,
 * since the SVG is written afresh on every save: a photograph on a node would otherwise be paid for,
 * a third over again for being written as text, at every pause in the editing.
 *
 * @param svgText the exported SVG.
 * @param load how a picture is fetched and redrawn; the caller's own in the tests.
 * @returns the SVG with every picture it could take in carried inside it. One it could not — a map
 *          made elsewhere pointing at another site, a picture no longer there — is left pointing
 *          where it did, which is no worse than it was.
 */
export async function inlineExportedImages(svgText: string, load: ImageLoader = loadImageData): Promise<string> {
    const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
    const images = Array.from(doc.querySelectorAll("image"));

    const loaded = await Promise.all(images.map((image) => {
        const href = image.getAttribute("href") ?? "";
        if (!href || href.startsWith("data:")) {
            return null;
        }
        return load(href, Number.parseFloat(image.getAttribute("width") ?? "") || 0);
    }));

    let inlined = false;
    for (const [ index, data ] of loaded.entries()) {
        if (data) {
            images[index].setAttribute("href", data);
            inlined = true;
        }
    }

    return inlined ? new XMLSerializer().serializeToString(doc) : svgText;
}

/** Fetches a picture and redraws it, given the width it is shown at. See {@link inlineExportedImages}. */
export type ImageLoader = (url: string, displayWidth: number) => Promise<string | null>;

// The exporter emits exact-fit foreignObject boxes: the text's measured width in the
// page's font, to the third decimal, with `white-space: pre-wrap`. Any context that
// resolves fonts even fractionally wider — PNG rasterization at scale, an <img> on a
// machine with different fonts — soft-wraps the text and the exact-fit height clips the
// wrapped line ("Hi there" renders as "Hi"). The boxes are invisible and the text is
// left-anchored, so widening them slightly is visually free.
const SIZE_SLACK_RATIO = 1.02;
const SIZE_SLACK_PX = 2;

/**
 * Post-processes mind-elixir's `exportSvg()` output to make it robust and complete:
 *
 * - Re-adds the arrow/summary labels the exporter misses. Labels are absolutely
 *   positioned `div.svg-label` elements inside `mind.nodes` (their offset parent is the
 *   `position: relative` `me-nodes` element), so their `offsetLeft`/`offsetTop` are in
 *   the same coordinate space as the exported SVG layers. Each label is appended to the
 *   exporter's inner `<svg>` (the one holding the map layers) as a `<foreignObject>`
 *   replicating the label's box and text style.
 * - Adds slack to every `<foreignObject>`'s exact-fit size so text is not clipped when
 *   the SVG is rasterized with slightly different font metrics (see the slack constants).
 * - Backs translucent node boxes with the canvas color (see {@link backTranslucentNodeBoxes}).
 * - Writes in the node icons the exporter cannot draw (see {@link placeExportedIcons}).
 *
 * @param mind the live mind map instance the SVG was exported from.
 * @param svgText the output of `mind.exportSvg().text()`.
 * @param icons the drawings of the map's icons, as `renderExportedIcons` made them.
 * @returns the post-processed SVG, or the input unchanged if it cannot be parsed.
 */
export function postProcessExportedSvg(mind: MindElixirInstance, svgText: string, icons: ExportedIcon[] = []): string {
    const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
    // The exporter produces <svg> [ <rect background>, <svg map layers> ] — label
    // coordinates are relative to the inner svg.
    const contentSvg = doc.documentElement?.querySelector(":scope > svg");
    if (!contentSvg) {
        return svgText;
    }

    const canvasColor = mind.theme?.cssVar?.["--bgcolor"];
    if (canvasColor) {
        backTranslucentNodeBoxes(contentSvg, canvasColor);
    }

    // Before the icons are written in: the fit is carried over by pairing the pictures of the map
    // with those of the export in the order they were written, which any picture added here breaks.
    carryImageFit(contentSvg, mind);
    placeExportedIcons(contentSvg, icons);

    const labels = mind.nodes.querySelectorAll<HTMLElement>(".svg-label");
    for (const label of Array.from(labels)) {
        contentSvg.appendChild(doc.importNode(buildLabelForeignObject(label), true));
    }

    for (const foreignObject of Array.from(doc.querySelectorAll("foreignObject"))) {
        addSizeSlack(foreignObject, "width");
        addSizeSlack(foreignObject, "height");
    }

    return new XMLSerializer().serializeToString(doc);
}

/**
 * Paints an opaque copy of the map canvas behind every translucent node box.
 *
 * The node backgrounds the editor offers are tints (see NodePanel) meant to composite
 * against the canvas, but the exporter draws the branch lines first and the node boxes over them
 * (each box being a direct `<rect>` child of the map layers, filled with the node's computed
 * background), so a tint alone would show the lines through the node. Nodes with no background of
 * their own are fully transparent and are left as they are, so the lines keep running under them.
 *
 * @param contentSvg the exporter's inner svg, holding the map layers.
 * @param canvasColor the map background, as the exporter fills its own backdrop with.
 */
function backTranslucentNodeBoxes(contentSvg: Element, canvasColor: string) {
    for (const box of Array.from(contentSvg.querySelectorAll(":scope > rect"))) {
        const alpha = getFillAlpha(box.getAttribute("fill"));
        if (alpha === null || alpha <= 0 || alpha >= 1) {
            continue;
        }

        const backing = box.cloneNode(false) as Element;
        backing.setAttribute("fill", canvasColor);
        contentSvg.insertBefore(backing, box);
    }
}

/**
 * Tells each exported picture what to do with a box that is not its shape.
 *
 * A node draws its picture with `object-fit`, which the exporter does not carry over: it writes the
 * box and the address and nothing else, so a picture cut to a square on the map would be drawn
 * whole and squashed into that square in the preview. The same instruction in SVG is
 * `preserveAspectRatio`, set here from what each picture was drawn with.
 *
 * The exporter appends one `<image>` per `<img>` of the map, in the order it finds them, and emits
 * no others — so the two line up. Where they do not, nothing is said rather than the wrong thing.
 */
function carryImageFit(contentSvg: Element, mind: MindElixirInstance) {
    const drawn = Array.from(mind.nodes.querySelectorAll("img"));
    const exported = Array.from(contentSvg.querySelectorAll("image"));
    if (drawn.length !== exported.length) {
        return;
    }

    for (const [ index, image ] of exported.entries()) {
        // Unset, a picture is stretched to its box, which is what CSS does with `object-fit` unset
        // — and what a box of the picture's own shape, the usual case, makes no difference to.
        const fit = drawn[index].style.objectFit || "fill";
        image.setAttribute("preserveAspectRatio", FIT_ALIGNMENTS[fit] ?? FIT_ALIGNMENTS.fill);
    }
}

/** What each `object-fit` is called in SVG. */
const FIT_ALIGNMENTS: Record<string, string> = {
    fill: "none",
    contain: "xMidYMid meet",
    cover: "xMidYMid slice"
};

/**
 * Writes the node icons into the exported map (see `renderExportedIcons` for why they are drawn).
 *
 * Each drawing is written once however many nodes wear it and stamped out of that one copy: a map is
 * commonly a handful of icons over a great many nodes, and a drawing carried as text inside the SVG
 * is far and away the heaviest thing in it. An icon that is a character rather than a drawing is
 * written as the character, which the export needs nothing of its own to draw.
 */
function placeExportedIcons(contentSvg: Element, icons: ExportedIcon[]) {
    const doc = contentSvg.ownerDocument;
    /** The icons already written, by the drawing each of them is. */
    const stamps = new Map<string, string>();
    let defs: Element | undefined;

    for (const icon of icons) {
        if (icon.image) {
            let id = stamps.get(icon.image);
            if (!id) {
                id = `mind-map-icon-${stamps.size}`;
                stamps.set(icon.image, id);

                defs ??= contentSvg.appendChild(doc.createElementNS(SVG_NS, "defs"));
                defs.appendChild(buildIconStamp(doc, id, icon.image));
            }
            contentSvg.appendChild(buildIconUse(doc, id, icon));
        } else if (icon.text) {
            contentSvg.appendChild(buildIconText(doc, icon));
        }
    }
}

/**
 * The one copy of a drawing, held in a square of its own so that every use of it can be given a size
 * — which is what a `<symbol>` carries over a bare `<image>`, whose own size a `<use>` cannot change.
 */
function buildIconStamp(doc: Document, id: string, image: string) {
    const symbol = doc.createElementNS(SVG_NS, "symbol");
    symbol.setAttribute("id", id);
    symbol.setAttribute("viewBox", "0 0 1 1");

    const picture = doc.createElementNS(SVG_NS, "image");
    picture.setAttribute("href", image);
    picture.setAttribute("width", "1");
    picture.setAttribute("height", "1");
    symbol.appendChild(picture);

    return symbol;
}

function buildIconUse(doc: Document, id: string, { x, y, size }: ExportedIcon) {
    const use = doc.createElementNS(SVG_NS, "use");
    use.setAttribute("href", `#${id}`);
    // The older spelling alongside it, for whatever reads the file that has not caught up with the
    // newer one — a rasterizer of its own, a drawing program.
    use.setAttributeNS(XLINK_NS, "xlink:href", `#${id}`);
    use.setAttribute("x", String(x));
    use.setAttribute("y", String(y));
    use.setAttribute("width", String(size));
    use.setAttribute("height", String(size));

    return use;
}

/**
 * An icon that is a character, written on the middle line of its square and nudged down by the part
 * of a character that hangs below that line — the plain way of centring text in SVG, rather than the
 * `dominant-baseline` that says so outright and that not everything reading the file honours.
 */
function buildIconText(doc: Document, { x, y, size, color, text }: ExportedIcon) {
    const element = doc.createElementNS(SVG_NS, "text");
    element.setAttribute("x", String(x + size / 2));
    element.setAttribute("y", String(y + size / 2));
    element.setAttribute("dy", "0.35em");
    element.setAttribute("text-anchor", "middle");
    element.setAttribute("font-size", String(size));
    element.setAttribute("fill", color);
    element.textContent = text ?? "";

    return element;
}

/**
 * The alpha of a fill the exporter took from a computed style, or `null` when it carries none.
 * Computed sRGB colors are always serialized as `rgb()`/`rgba()`, so a translucent one arrives in
 * the `rgba()` form whichever notation the node's background was written in.
 */
function getFillAlpha(fill: string | null) {
    const alpha = /^rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)$/.exec(fill ?? "")?.[1];
    return (alpha !== undefined ? Number.parseFloat(alpha) : null);
}

function addSizeSlack(element: Element, attribute: "width" | "height") {
    const value = Number.parseFloat(element.getAttribute(attribute) ?? "");
    if (!Number.isFinite(value) || value <= 0) {
        return;
    }
    element.setAttribute(attribute, String(Math.ceil(value * SIZE_SLACK_RATIO + SIZE_SLACK_PX)));
}

/**
 * Builds a `<foreignObject>` mirroring an on-screen `.svg-label` element, carrying
 * over its box (position, size, background, border radius) and text styling. Built in
 * the page's document so the label HTML is parsed leniently as HTML; the caller
 * imports it into the SVG document.
 */
function buildLabelForeignObject(label: HTMLElement): SVGElement {
    const style = getComputedStyle(label);

    // The computed width/height carry the fractional used value, but degrade to "auto" when the
    // element is not rendered (e.g. a hidden tab) — fall back to the always-numeric offset size
    // then. The anti-clipping slack is applied later by the shared foreignObject pass.
    const width = Number.parseFloat(style.width) || label.offsetWidth;
    const height = Number.parseFloat(style.height) || label.offsetHeight;

    const foreignObject = document.createElementNS(SVG_NS, "foreignObject");
    foreignObject.setAttribute("x", String(label.offsetLeft));
    foreignObject.setAttribute("y", String(label.offsetTop));
    foreignObject.setAttribute("width", String(width));
    foreignObject.setAttribute("height", String(height));

    const div = document.createElementNS(XHTML_NS, "div") as HTMLElement;
    div.setAttribute("style",
        "box-sizing: border-box; width: 100%; height: 100%; " +
        `font-family: ${style.fontFamily}; font-size: ${style.fontSize}; ` +
        `font-weight: ${style.fontWeight}; line-height: ${style.lineHeight}; ` +
        `color: ${style.color}; padding: ${style.padding}; ` +
        `background-color: ${style.backgroundColor}; border-radius: ${style.borderRadius};`);
    div.innerHTML = sanitizeNoteContentHtml(label.innerHTML);

    foreignObject.appendChild(div);
    return foreignObject;
}
