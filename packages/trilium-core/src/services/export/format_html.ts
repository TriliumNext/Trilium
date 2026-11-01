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
    normalizeAllAttributes(root);
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
            for (const line of formatElement(child as HTMLElement, depth)) {
                lines.push(line);
            }
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

/**
 * Normalizes the attributes of every element below `root`. Walks the tree by hand, since
 * `querySelectorAll("*")` grows faster than quadratically with the element count.
 */
function normalizeAllAttributes(root: HTMLElement) {
    const pending = [ ...root.childNodes ];
    for (let node = pending.pop(); node; node = pending.pop()) {
        if (node.nodeType === NodeType.ELEMENT_NODE) {
            const element = node as HTMLElement;
            element.rawAttrs = normalizeAttributes(element.rawAttrs);
            for (const child of element.childNodes) {
                pending.push(child);
            }
        }
    }
}

/**
 * An attribute name, optionally followed by `=` and a quoted or unquoted value. HTML separates
 * attributes only at ASCII whitespace, so `[\t\n\f\r ]` stands in for `\s`, which also matches
 * U+00A0 and the other Unicode spaces.
 */
const ATTRIBUTE = /[^\t\n\f\r "'<>/=]+(?:[\t\n\f\r ]*=[\t\n\f\r ]*(?:"[^"]*"|'[^']*'|[^\t\n\f\r "'<>=`]+))?/g;

/** The name of an attribute and its `=`, with the whitespace around the `=`. */
const NAME_AND_EQUALS = /^([^\t\n\f\r =]+)[\t\n\f\r ]*=[\t\n\f\r ]*/;

/** Joins the attributes of `rawAttrs` with one space, without touching the text of their values. */
function normalizeAttributes(rawAttrs: string) {
    return Array.from(rawAttrs.matchAll(ATTRIBUTE), ([ attribute ]) => attribute.replace(NAME_AND_EQUALS, "$1="))
        .join(" ");
}
