import { type HTMLElement, type Node, NodeType, parse } from "node-html-parser";

/**
 * Formats exported HTML with one block per line and each container indented by its depth, so an
 * edit to one paragraph changes one line of a diff. A container with a block child is split at its
 * blocks, and each run of text and inline elements between them stays on one line: whitespace
 * next to a block does not render, while whitespace between inline elements does. Every other
 * element keeps its content as parsed, and every tag has its attributes separated by one space.
 */
export function formatHtml(html: string) {
    const root = parse(html, { comment: true });
    for (const element of root.querySelectorAll("*")) {
        element.rawAttrs = normalizeAttributes(element.rawAttrs);
    }
    return canSplit(root) ? formatChildren(root, 0).join("\n") : root.toString();
}

const INDENT = "  ";

const CONTAINER_TAGS = new Set([
    "html", "head", "body", "div", "section", "article", "aside", "header", "footer", "nav", "main",
    "figure", "blockquote", "details", "ul", "ol", "li", "dl", "table", "thead", "tbody", "tfoot",
    "tr", "colgroup"
]);

const BLOCK_TAGS = new Set([
    ...CONTAINER_TAGS,
    "p", "h1", "h2", "h3", "h4", "h5", "h6", "pre", "hr", "address", "figcaption", "summary", "dt",
    "dd", "caption", "col", "th", "td",
    "base", "link", "meta", "noscript", "script", "style", "title"
]);

function formatElement(element: HTMLElement, depth: number): string[] {
    const indent = INDENT.repeat(depth);
    if (!canSplit(element)) {
        return [ indent + element.toString() ];
    }

    const attributes = element.rawAttrs ? ` ${element.rawAttrs}` : "";
    return [
        `${indent}<${element.rawTagName}${attributes}>`,
        ...formatChildren(element, depth + 1),
        `${indent}</${element.rawTagName}>`
    ];
}

/** Writes each block child of `element` on its own lines, and the inline content between them on one. */
function formatChildren(element: HTMLElement, depth: number) {
    const indent = INDENT.repeat(depth);
    const lines: string[] = [];
    let inline = "";

    const flushInline = () => {
        const text = inline.replace(/^[ \t\n\f\r]+|[ \t\n\f\r]+$/g, "");
        if (text) {
            lines.push(indent + text);
        }
        inline = "";
    };

    for (const child of element.childNodes) {
        if (isBlock(child)) {
            flushInline();
            lines.push(...formatElement(child as HTMLElement, depth));
        } else {
            inline += child.toString();
        }
    }
    flushInline();
    return lines;
}

/** Whether `element` (or the parsed root, which has no tag) is a container with a block child. */
function canSplit(element: HTMLElement) {
    const isContainer = !element.rawTagName || CONTAINER_TAGS.has(element.rawTagName.toLowerCase());
    return isContainer && element.childNodes.some(isBlock);
}

function isBlock(node: Node) {
    return node.nodeType === NodeType.ELEMENT_NODE && BLOCK_TAGS.has((node as HTMLElement).rawTagName.toLowerCase());
}

/** An attribute name, optionally followed by `=` and a quoted or unquoted value. */
const ATTRIBUTE = /[^\s"'<>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'<>=`]+))?/g;

/** Joins the attributes of `rawAttrs` with one space, without touching the text of their values. */
function normalizeAttributes(rawAttrs: string) {
    return Array.from(rawAttrs.matchAll(ATTRIBUTE), ([ attribute ]) => attribute.replace(/^([^=\s]+)\s*=\s*/, "$1="))
        .join(" ");
}
