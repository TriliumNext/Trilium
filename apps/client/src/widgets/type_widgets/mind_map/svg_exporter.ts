import type { default as MindElixirInstance, Topic } from "mind-elixir";

import { sanitizeNoteContentHtml } from "../../../services/sanitize_content";
import { offsetWithin } from "./icons";

const SVG_NS = "http://www.w3.org/2000/svg";
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
            layers.appendChild(convertBox(nodes, topic.text, true));
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

/** Writes the text one `<text>` per line, for elements whose text is plain (tags and icons). */
function createSvgText(element: HTMLElement, style: CSSStyleDeclaration, { offsetLeft, offsetTop }: Offset) {
    const group = createSvgElement("g", {});
    const fontSize = Number.parseFloat(style.fontSize);
    const halfLeading = (Number.parseInt(style.lineHeight) - Number.parseInt(style.fontSize)) / 2;

    for (const [ index, line ] of getPlainText(element).split("\n").entries()) {
        const text = createSvgElement("text", {
            x: String(offsetLeft + Number.parseInt(style.paddingLeft)),
            y: String(offsetTop + Number.parseInt(style.paddingTop) + (halfLeading + fontSize) * (index + 1)),
            "text-anchor": "start",
            "font-family": style.fontFamily,
            "font-size": style.fontSize,
            "font-weight": style.fontWeight,
            fill: style.color
        });
        text.textContent = line;
        group.appendChild(text);
    }
    return group;
}

/** Writes the text as HTML inside a `<foreignObject>`, which wraps it as the map does. */
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

type Offset = ReturnType<typeof offsetWithin>;
