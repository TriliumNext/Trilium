import { HTMLElement, parse } from "node-html-parser";

import becca from "../../becca/becca.js";
import type BNote from "../../becca/entities/bnote.js";
import { getLog } from "../log.js";
import { wrapStringOrBuffer } from "../utils/binary.js";
import { stripListItemIds } from "./strip_list_item_ids.js";

export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * The look that note content gets from the app's stylesheets rather than from its own markup, so a
 * table without borders of its own still has the borders and header shading it shows in Trilium.
 * Layout tables have no borders in the app either.
 */
const CONTENT_STYLESHEET = `
    figure.table table { border-collapse: collapse; border: 1px solid #bfbfbf; }
    figure.table td, figure.table th { border: 1px solid #bfbfbf; padding: 4px 6px; }
    figure.table th { background-color: #f2f2f2; font-weight: bold; }
    table.layout-table, table.layout-table td, table.layout-table th { border: none; }
    table.layout-table th { background-color: transparent; }
`;

/**
 * Converts the HTML of a text note into a Word document. Formatting that Word can hold (colors,
 * borders, cell shading, lists, images) is kept; what it cannot hold is logged and left out.
 */
export async function renderTextNoteToDocx(note: BNote, html: string): Promise<Uint8Array> {
    const [ { Document, Packer }, { htmlToContent } ] = await Promise.all([
        import("docx"),
        import("docx/html")
    ]);

    const warnings: string[] = [];
    const children = htmlToContent(prepareHtml(html), {
        stylesheet: CONTENT_STYLESHEET,
        images: resolveImage,
        onWarning: (warning) => warnings.push(warning.message)
    });

    if (warnings.length) {
        getLog().info(`DOCX export of note '${note.noteId}' left out or changed: ${warnings.join("; ")}`);
    }

    const document = new Document({
        title: note.title,
        sections: [ { children: [ ...children ] } ]
    });

    return Packer.pack(document, "uint8array");
}

/**
 * Removes what only means something inside this Trilium instance (editor bookkeeping, links to other
 * notes, which keep their text) and puts table widths where `htmlToContent()` reads them.
 */
export function prepareHtml(html: string) {
    const root = parse(stripListItemIds(html));

    for (const link of root.querySelectorAll("a[href]")) {
        const href = link.getAttribute("href") ?? "";
        if (href.startsWith("#root") || href.startsWith("#") && link.classList.contains("reference-link")) {
            link.replaceWith(link.innerHTML);
        }
    }

    for (const table of root.querySelectorAll("table")) {
        moveTableWidths(table);
    }

    return root.toString();
}

/**
 * CKEditor writes a table's width on its `<figure>` and the column widths in a `<colgroup>`;
 * `htmlToContent()` reads them from the `<table>` and its cells. The first row's cells are enough
 * for Word's column grid.
 */
function moveTableWidths(table: HTMLElement) {
    const figure = table.parentNode;
    const figureWidth = figure?.tagName === "FIGURE" ? getStyle(figure, "width") : undefined;
    if (figureWidth && !getStyle(table, "width")) {
        setStyle(table, "width", figureWidth);
    }

    const colgroup = table.childNodes.find((node): node is HTMLElement =>
        node instanceof HTMLElement && node.tagName === "COLGROUP");
    const columnWidths = (colgroup?.children ?? []).map((col) => getStyle(col, "width"));
    const firstRow = table.querySelector("tr");
    if (!columnWidths.length || !firstRow) {
        return;
    }

    let column = 0;
    for (const cell of firstRow.childNodes) {
        if (!(cell instanceof HTMLElement) || (cell.tagName !== "TD" && cell.tagName !== "TH")) {
            continue;
        }

        const span = Math.max(1, Number(cell.getAttribute("colspan")) || 1);
        const widths = columnWidths.slice(column, column + span);
        column += span;

        if (getStyle(cell, "width") || widths.some((width) => !width?.endsWith("%"))) {
            continue;
        }

        const total = widths.reduce((sum, width) => sum + parseFloat(width ?? ""), 0);
        setStyle(cell, "width", `${Number(total.toFixed(2))}%`);
    }
}

function getStyle(element: HTMLElement, property: string) {
    const style = element.getAttribute("style") ?? "";
    const match = style.match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, "i"));
    return match?.[1].trim();
}

function setStyle(element: HTMLElement, property: string, value: string) {
    const style = (element.getAttribute("style") ?? "").trim();
    const separator = style && !style.endsWith(";") ? ";" : "";
    element.setAttribute("style", `${style}${separator}${property}:${value};`);
}

/** Returns the bytes of an image that the note content refers to by its `api/` address. */
export function resolveImage(source: string): Uint8Array | undefined {
    const imageNote = source.match(/api\/images\/([a-zA-Z0-9_]+)/);
    if (imageNote) {
        const note = becca.getNote(imageNote[1]);
        return note?.mime.startsWith("image/") ? wrapStringOrBuffer(note.getContent()) : undefined;
    }

    const imageAttachment = source.match(/api\/attachments\/([a-zA-Z0-9_]+)\/image/);
    if (imageAttachment) {
        const attachment = becca.getAttachment(imageAttachment[1]);
        return attachment?.mime.startsWith("image/") ? attachment.getContent() : undefined;
    }

    return undefined;
}
