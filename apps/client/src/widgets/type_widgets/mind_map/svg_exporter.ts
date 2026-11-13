import type { default as MindElixirInstance, Topic } from "mind-elixir";

import { sanitizeNoteContentHtml } from "../../../services/sanitize_content";
import { offsetWithin } from "./icons";

const SVG_NS = "http://www.w3.org/2000/svg";
const XML_NS = "http://www.w3.org/XML/1998/namespace";
const PADDING = 100;

/**
 * Renders the map to a standalone SVG document by cloning its SVG layers (branch lines, arrows,
 * summaries) and redrawing every node box, text, tag, icon, link and picture in SVG.
 *
 * Ported from mind-elixir 5's `exportSvg()`, which version 6 removed in favor of a DOM screenshot
 * engine; that engine is too slow to run on every save (see `renderMindMapPreviewSvg()`).
 *
 * @returns the serialized SVG: an outer `<svg>` holding the background `<rect>` and an inner `<svg>`
 *          with the map layers, which `postProcessExportedSvg()` relies on.
 */
export function exportMindMapSvg(mind: MindElixirInstance): string {
    const nodes = mind.nodes;
    const width = nodes.offsetWidth + PADDING * 2;
    const height = nodes.offsetHeight + PADDING * 2;

    const svg = createSvgElement("svg", { version: "1.1", width: `${width}px`, height: `${height}px` });
    svg.appendChild(createSvgElement("rect", {
        x: "0",
        y: "0",
        width: String(width),
        height: String(height),
        fill: String(mind.theme.cssVar["--bgcolor"] ?? "")
    }));

    const layers = createSvgElement("svg", { x: String(PADDING), y: String(PADDING), overflow: "visible" });
    for (const subLines of nodes.querySelectorAll<SVGSVGElement>(".subLines")) {
        const clone = subLines.cloneNode(true) as SVGSVGElement;
        const parent = subLines.parentElement;
        const { offsetLeft, offsetTop } = parent ? offsetWithin(parent, nodes) : { offsetLeft: 0, offsetTop: 0 };
        clone.setAttribute("x", String(offsetLeft));
        clone.setAttribute("y", String(offsetTop));
        layers.appendChild(clone);
    }
    for (const selector of [ ".lines", ".topiclinks", ".summary" ]) {
        const layer = nodes.querySelector(selector);
        if (layer) {
            layers.appendChild(layer.cloneNode(true));
        }
    }

    for (const topic of nodes.querySelectorAll<Topic>(".me-tpc")) {
        if (topic.nodeObj.dangerouslySetInnerHTML) {
            layers.appendChild(convertBox(nodes, topic, true));
        } else {
            layers.appendChild(createBoxRect(topic, getComputedStyle(topic), offsetWithin(topic, nodes)));
            layers.appendChild(convertBox(nodes, topic.text, false));
        }
    }
    for (const element of nodes.querySelectorAll<HTMLElement>(".tags > span, .icons > span")) {
        layers.appendChild(convertBox(nodes, element, false));
    }
    for (const link of nodes.querySelectorAll<HTMLAnchorElement>(".hyper-link")) {
        layers.appendChild(convertLink(nodes, link));
    }
    for (const image of nodes.querySelectorAll("img")) {
        layers.appendChild(convertImage(nodes, image));
    }

    svg.appendChild(layers);
    return new XMLSerializer().serializeToString(svg);
}

function convertBox(nodes: HTMLElement, element: HTMLElement, useForeignObject: boolean) {
    const style = getComputedStyle(element);
    const position = offsetWithin(element, nodes);
    const group = createSvgElement("g", {});
    group.appendChild(createBoxRect(element, style, position));
    group.appendChild(useForeignObject
        ? createForeignObjectText(element, style, position)
        : createSvgText(element, style, position));
    return group;
}

function createBoxRect(element: HTMLElement, style: CSSStyleDeclaration, { offsetLeft, offsetTop }: Offset) {
    return createSvgElement("rect", {
        x: String(offsetLeft),
        y: String(offsetTop),
        rx: style.borderRadius,
        ry: style.borderRadius,
        width: style.width,
        height: style.height,
        fill: style.backgroundColor,
        stroke: style.borderColor,
        "stroke-width": style.borderWidth
    });
}

/**
 * Writes plain text one `<text>` per line, placed where the browser laid each line out.
 *
 * SVG renderers outside the browser (librsvg, which image viewers use) skip `<foreignObject>`, so
 * plain text is written as SVG text. That does not wrap, so the line breaks and positions come from
 * {@link measureTextLines}. Each line is centred on its line box with `dy`, like the icon text in
 * export.ts, because not every renderer honours `dominant-baseline`.
 *
 * @param element the element holding the text.
 * @param style the computed style of `element`.
 * @param offset the position of `element` in the coordinate space of the exported layers.
 */
export function createSvgText(element: HTMLElement, style: CSSStyleDeclaration, { offsetLeft, offsetTop }: Offset) {
    const group = createSvgElement("g", {});
    for (const line of measureTextLines(element) ?? estimateTextLines(element, style)) {
        const text = createSvgElement("text", {
            x: String(round(offsetLeft + line.x)),
            y: String(round(offsetTop + line.centerY)),
            dy: "0.35em",
            "text-anchor": "start",
            "font-family": style.fontFamily,
            "font-size": style.fontSize,
            "font-weight": style.fontWeight,
            "font-style": style.fontStyle,
            fill: style.color
        });
        text.setAttributeNS(XML_NS, "xml:space", "preserve");
        text.textContent = line.text;
        group.appendChild(text);
    }
    return group;
}

interface TextLine {
    text: string;
    /** The left edge of the line, relative to the element's border box. */
    x: number;
    /** The vertical middle of the line's glyphs, relative to the element's border box. */
    centerY: number;
}

/**
 * Splits the text of an element into the lines the browser wrapped it into, from the client rects
 * of a `Range` over the text. Text on one line costs one `getClientRects()` call; wrapped text is
 * measured one character at a time.
 *
 * Client rects are in screen space, which the map's zoom scales, so they are converted back to the
 * unscaled layout space of `offsetLeft`/`offsetTop`.
 *
 * @returns the lines, or `null` when the element is not laid out (a hidden map, or no layout engine).
 */
function measureTextLines(element: HTMLElement): TextLine[] | null {
    const box = element.getBoundingClientRect();
    const textNodes = getTextNodes(element);
    const range = document.createRange();
    if (!box.width || !textNodes.length || typeof range.getClientRects !== "function") {
        return null;
    }

    const scale = element.offsetWidth / box.width || 1;
    const toLine = (text: string, rect: DOMRect): TextLine => ({
        text,
        x: (rect.left - box.left) * scale,
        centerY: (rect.top + rect.height / 2 - box.top) * scale
    });

    range.selectNodeContents(element);
    const rects = Array.from(range.getClientRects()).filter((rect) => rect.width && rect.height);
    if (!rects.length) {
        return null;
    }
    if (rects.every((rect) => Math.abs(rect.top - rects[0].top) < rects[0].height / 2)) {
        return [ toLine((element.textContent ?? "").replace(/\n/g, "").trimEnd(), rects[0]) ];
    }

    const lines: { text: string; rect: DOMRect }[] = [];
    for (const node of textNodes) {
        for (let index = 0; index < node.data.length; index++) {
            const character = node.data[index];
            const current = lines.at(-1);
            if (character === "\n") {
                continue;
            }
            range.setStart(node, index);
            range.setEnd(node, index + 1);
            const rect = range.getBoundingClientRect();
            if (current && (!rect.height || rect.top < current.rect.top + current.rect.height / 2)) {
                current.text += character;
            } else if (rect.height) {
                lines.push({ text: character, rect });
            }
        }
    }
    return lines
        .map(({ text, rect }) => toLine(text.trimEnd(), rect))
        .filter((line) => line.text);
}

/** The lines of an element that is not laid out: its hard line breaks, spaced by its line height. */
function estimateTextLines(element: HTMLElement, style: CSSStyleDeclaration): TextLine[] {
    const fontSize = Number.parseFloat(style.fontSize) || 16;
    const lineHeight = Number.parseFloat(style.lineHeight) || fontSize * 1.2;
    const x = (Number.parseFloat(style.borderLeftWidth) || 0) + (Number.parseFloat(style.paddingLeft) || 0);
    const top = (Number.parseFloat(style.borderTopWidth) || 0) + (Number.parseFloat(style.paddingTop) || 0);

    return (element.textContent ?? "").split("\n")
        .map((text, index) => ({ text: text.trimEnd(), x, centerY: top + lineHeight * (index + 0.5) }))
        .filter((line) => line.text);
}

function getTextNodes(element: HTMLElement) {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        nodes.push(node as Text);
    }
    return nodes;
}

function round(value: number) {
    return Math.round(value * 100) / 100;
}

/** Writes the text as HTML inside a `<foreignObject>`, for topics written in HTML. */
function createForeignObjectText(element: HTMLElement, style: CSSStyleDeclaration, { offsetLeft, offsetTop }: Offset) {
    const foreignObject = createSvgElement("foreignObject", {
        x: String(offsetLeft + Number.parseInt(style.paddingLeft)),
        y: String(offsetTop + Number.parseInt(style.paddingTop)),
        width: style.width,
        height: style.height
    });

    const div = document.createElement("div");
    div.setAttribute("style", `font-family: ${style.fontFamily}; font-size: ${style.fontSize}; `
        + `font-weight: ${style.fontWeight}; color: ${style.color}; white-space: pre-wrap;`);
    const html = (element as Partial<Topic>).nodeObj?.dangerouslySetInnerHTML;
    if (html) {
        div.innerHTML = sanitizeNoteContentHtml(html);
    } else {
        div.textContent = getPlainText(element);
    }

    foreignObject.appendChild(div);
    return foreignObject;
}

function convertLink(nodes: HTMLElement, link: HTMLAnchorElement) {
    const style = getComputedStyle(link);
    const { offsetLeft, offsetTop } = offsetWithin(link, nodes);
    const anchor = createSvgElement("a", { href: link.href });
    const text = createSvgElement("text", {
        x: String(offsetLeft),
        y: String(offsetTop + Number.parseInt(style.fontSize)),
        "text-anchor": "start",
        "font-family": style.fontFamily,
        "font-size": style.fontSize,
        "font-weight": style.fontWeight,
        fill: style.color
    });
    text.textContent = link.textContent;
    anchor.appendChild(text);
    return anchor;
}

function convertImage(nodes: HTMLElement, image: HTMLImageElement) {
    const style = getComputedStyle(image);
    const { offsetLeft, offsetTop } = offsetWithin(image, nodes);
    return createSvgElement("image", {
        x: String(offsetLeft),
        y: String(offsetTop),
        width: style.width,
        height: style.height,
        href: image.src
    });
}

function getPlainText(element: HTMLElement) {
    const text = (element as Partial<Topic>).text ?? element.childNodes[0];
    return text?.textContent ?? "";
}

function createSvgElement(name: string, attributes: Record<string, string>) {
    const element = document.createElementNS(SVG_NS, name);
    for (const [ key, value ] of Object.entries(attributes)) {
        element.setAttribute(key, value);
    }
    return element;
}

export type Offset = ReturnType<typeof offsetWithin>;
