import type { MindElixirInstance } from "mind-elixir";

import { sanitizeNoteContentHtml } from "../../../services/sanitize_content";

const SVG_NS = "http://www.w3.org/2000/svg";
const XHTML_NS = "http://www.w3.org/1999/xhtml";

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
 * relaxes the exporter's exact-fit text boxes so rasterization cannot clip them.
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
    const svgText = await mind.exportSvg().text();
    return postProcessExportedSvg(mind, svgText);
}

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
 *
 * @param mind the live mind map instance the SVG was exported from.
 * @param svgText the output of `mind.exportSvg().text()`.
 * @returns the post-processed SVG, or the input unchanged if it cannot be parsed.
 */
export function postProcessExportedSvg(mind: MindElixirInstance, svgText: string): string {
    const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
    // The exporter produces <svg> [ <rect background>, <svg map layers> ] — label
    // coordinates are relative to the inner svg.
    const contentSvg = doc.documentElement?.querySelector(":scope > svg");
    if (!contentSvg) {
        return svgText;
    }

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
