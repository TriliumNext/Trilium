import { type HTMLElement, type Node, NodeType, parse } from "node-html-parser";

/**
 * Formats exported HTML with one block per line and each container indented by its depth, so an
 * edit to one paragraph changes one line of a diff. An element is split across lines only when
 * every child is a block, because whitespace between inline children shows on the page; every
 * other element, and a fragment with text at its top level, keeps its content as parsed. Every tag
 * has its attributes separated by one space.
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

function formatNode(node: Node, depth: number): string[] {
    const indent = INDENT.repeat(depth);

    if (node.nodeType === NodeType.ELEMENT_NODE && canSplit(node as HTMLElement)) {
        const element = node as HTMLElement;
        const attributes = element.rawAttrs ? ` ${element.rawAttrs}` : "";
        return [
            `${indent}<${element.rawTagName}${attributes}>`,
            ...formatChildren(element, depth + 1),
            `${indent}</${element.rawTagName}>`
        ];
    }

    return [ indent + node.toString().trim() ];
}

function formatChildren(element: HTMLElement, depth: number) {
    return element.childNodes
        .filter((child) => !isWhitespace(child))
        .flatMap((child) => formatNode(child, depth));
}

/** Whether `element` (or the parsed root, which has no tag) can have its children on separate lines. */
function canSplit(element: HTMLElement) {
    if (element.rawTagName && !CONTAINER_TAGS.has(element.rawTagName.toLowerCase())) {
        return false;
    }

    const children = element.childNodes.filter((child) => !isWhitespace(child));
    return children.length > 0 && children.every((child) => {
        switch (child.nodeType) {
            case NodeType.ELEMENT_NODE:
                return BLOCK_TAGS.has((child as HTMLElement).rawTagName.toLowerCase());
            case NodeType.COMMENT_NODE:
                return true;
            default:
                return child.rawText.trimStart().startsWith("<!");
        }
    });
}

/** An attribute name, optionally followed by `=` and a quoted or unquoted value. */
const ATTRIBUTE = /[^\s"'<>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'<>=`]+))?/g;

/** Joins the attributes of `rawAttrs` with one space, without touching the text of their values. */
function normalizeAttributes(rawAttrs: string) {
    return Array.from(rawAttrs.matchAll(ATTRIBUTE), ([ attribute ]) => attribute.replace(/^([^=\s]+)\s*=\s*/, "$1="))
        .join(" ");
}

/** Whitespace as HTML defines it, which leaves out the significant U+00A0 that `trim()` removes. */
function isWhitespace(node: Node) {
    return node.nodeType === NodeType.TEXT_NODE && /^[ \t\n\f\r]*$/.test(node.rawText);
}
