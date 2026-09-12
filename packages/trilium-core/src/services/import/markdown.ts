import { renderToHtml as renderToHtmlShared } from "@triliumnext/commons/src/lib/markdown_renderer.js";
import { HTMLElement, Node, NodeType, parse as parseHtml } from "node-html-parser";

import { sanitizeHtml } from "../sanitizer.js";
import { getTaskStates } from "../task_states.js";

function renderToHtml(content: string, title: string, opts?: { obsidian?: boolean }): string {
    const html = renderToHtmlShared(content, title, {
        sanitize: sanitizeHtml,
        taskStates: getTaskStates(),
        obsidian: opts?.obsidian
    });
    return normalizeToEditorMarkup(html);
}

export default {
    renderToHtml
};

/**
 * Restores what the Markdown exporter gives up on a `<details>` block and on a table it keeps as
 * raw HTML: the `trilium-collapsible` class, the `<figure class="table">` wrapper, and the absence
 * of whitespace between block children, which the exporter indents for readability. All three are
 * what CKEditor downcasts, so a note that goes out to Markdown and comes back keeps the content it
 * started with instead of changing on its next save.
 */
function normalizeToEditorMarkup(html: string): string {
    if (!html.includes("<details") && !html.includes("<table")) {
        return html;
    }

    const root = parseHtml(html);
    const collapsibles = root.querySelectorAll("details");
    const tables = root.querySelectorAll("table");
    if (!collapsibles.length && !tables.length) {
        return html;
    }

    for (const collapsible of collapsibles) {
        // The plugin builds the element around `class`, so writing the attributes back in that
        // order keeps a collapsible the user has expanded (`open=""`) byte-identical too.
        const { class: classNames, ...rest } = collapsible.attributes;
        const classList = classNames ? classNames.split(/\s+/) : [];
        if (!classList.includes(COLLAPSIBLE_CLASS)) {
            classList.push(COLLAPSIBLE_CLASS);
        }
        collapsible.setAttributes({ class: classList.join(" "), ...rest });
        removeLayoutWhitespace(collapsible, COLLAPSIBLE_CONTAINER_TAGS);
    }

    // Innermost table first: wrapping re-serializes the element, so an inner table has to carry
    // its own wrapper by the time the one around it is rewritten.
    for (const table of tables.reverse()) {
        removeLayoutWhitespace(table, TABLE_CONTAINER_TAGS);

        const parent = table.parentNode;
        if (parent instanceof HTMLElement && parent.tagName === "FIGURE") {
            continue;
        }
        table.insertAdjacentHTML("beforebegin", `<figure class="table">${table.toString()}</figure>`);
        table.remove();
    }
    return root.toString();
}

/**
 * Drops whitespace-only text nodes from an element whose children are blocks, and recurses into
 * `containerTags`, the tags the exporter indents into. An element holding text of its own is left
 * alone, so spacing that separates inline content survives. Whitespace inside `<pre>` and inside a
 * table cell is never reached — neither is one of the containers.
 */
function removeLayoutWhitespace(element: HTMLElement, containerTags: Set<string>) {
    const isText = (node: Node) => node.nodeType === NodeType.TEXT_NODE;
    const holdsText = (node: Node) => isText(node) && node.rawText.trim() !== "";

    if (!element.childNodes.some(holdsText)) {
        element.childNodes = element.childNodes.filter((node) => !isText(node) || holdsText(node));
    }

    for (const child of element.childNodes) {
        if (child instanceof HTMLElement && containerTags.has(child.tagName)) {
            removeLayoutWhitespace(child, containerTags);
        }
    }
}

/** The styling hook `collapsible_editing.ts` downcasts onto every `<details>` it writes. */
const COLLAPSIBLE_CLASS = "trilium-collapsible";

/** Mirrors `DETAILS_CONTAINER_TAGS` in `services/export/markdown.ts`. */
const COLLAPSIBLE_CONTAINER_TAGS = new Set(["DETAILS", "UL", "OL", "LI", "BLOCKQUOTE"]);

/** Mirrors `TABLE_CONTAINER_TAGS` in `@triliumnext/turndown-plugin-gfm`. */
const TABLE_CONTAINER_TAGS = new Set(["TABLE", "THEAD", "TBODY", "TFOOT", "TR", "COLGROUP"]);
