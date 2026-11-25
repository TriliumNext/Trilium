import type { IStylesOptions } from "docx";
import { HTMLElement, parse } from "node-html-parser";

import becca from "../../becca/becca.js";
import type BNote from "../../becca/entities/bnote.js";
import { getLog } from "../log.js";
import { wrapStringOrBuffer } from "../utils/binary.js";
import {
    CONTENT_PLACEHOLDER, DEFAULT_TEXT_WIDTH, getDocxTemplate, prepareDocxTemplate,
    readDocxBodyFontSize
} from "./docx_template.js";
import { stripListItemIds } from "./strip_list_item_ids.js";

/** The size of body text in the document, in points. */
const BODY_FONT_SIZE = 11;

/**
 * The look that note content gets from the app's stylesheets rather than from its own markup, so a
 * table without borders of its own still has the borders and header shading it shows in Trilium.
 * Layout tables have no borders in the app either. The `text-*` sizes are those of the editor's
 * font size classes (`--ck-content-font-size-*`) relative to the size of body text, in points.
 */
function buildContentStylesheet(bodyFontSize: number) {
    return `
        figure.table table { border-collapse: collapse; border: 1px solid #bfbfbf; }
        figure.table td, figure.table th { border: 1px solid #bfbfbf; padding: 4px 6px; }
        figure.table th { background-color: #f2f2f2; font-weight: bold; }
        table.layout-table, table.layout-table td, table.layout-table th { border: none; }
        table.layout-table th { background-color: transparent; }
        .text-tiny { font-size: ${(bodyFontSize * 0.7).toFixed(1)}pt; }
        .text-small { font-size: ${(bodyFontSize * 0.85).toFixed(1)}pt; }
        .text-big { font-size: ${(bodyFontSize * 1.4).toFixed(1)}pt; }
        .text-huge { font-size: ${(bodyFontSize * 1.8).toFixed(1)}pt; }
    `;
}

/**
 * Word's defaults for body text, and headings in bold and in the text color, where the defaults
 * of `docx` have no spacing and blue headings. Text in table cells has no spacing after its
 * paragraphs, which would leave a gap at the bottom of every cell. Sizes are in half-points,
 * spacing in twentieths of a point.
 */
const DOCUMENT_STYLES: IStylesOptions = {
    default: {
        document: {
            run: { font: "Calibri", size: BODY_FONT_SIZE * 2 },
            paragraph: { spacing: { after: 160, line: 276 } }
        },
        heading1: headingStyle(20),
        heading2: headingStyle(16),
        heading3: headingStyle(13),
        heading4: headingStyle(12),
        heading5: headingStyle(11),
        heading6: headingStyle(11)
    },
    paragraphStyles: [ {
        id: "TableText",
        name: "Table Text",
        basedOn: "Normal",
        quickFormat: true,
        paragraph: { spacing: { after: 0 } }
    } ]
};

/** Gives text in table cells the `TableText` style of {@link DOCUMENT_STYLES}. */
const STYLE_MAP = {
    "figure.table td, figure.table th, figure.table td p, figure.table th p": "TableText"
};

/**
 * Converts the HTML of a text note into a Word document. Formatting that Word can hold (colors,
 * borders, cell shading, lists, images) is kept; what it cannot hold is logged and left out.
 *
 * A note with a `~docxTemplate` relation is written into that Word document instead, in place of
 * its body, so it takes the template's styles, headers, footers and page setup.
 */
export async function renderTextNoteToDocx(note: BNote, html: string): Promise<Uint8Array> {
    const template = getDocxTemplate(note);
    const shell = template ? prepareDocxTemplate(template) : undefined;
    const textWidth = shell?.textWidth ?? DEFAULT_TEXT_WIDTH;
    const [ docx, { htmlToContent } ] = await Promise.all([
        import("docx"),
        import("docx/html")
    ]);
    const { Document, Packer, patchDocument, PatchType } = docx;

    const bodyFontSize = (template && readDocxBodyFontSize(template)) || BODY_FONT_SIZE;
    const warnings: string[] = [];
    const children = htmlToContent(prepareHtml(html, textWidth), {
        stylesheet: buildContentStylesheet(bodyFontSize),
        styleMap: STYLE_MAP,
        images: resolveImage,
        maxImageWidth: Math.floor(textWidth / TWIPS_PER_PIXEL),
        onWarning: (warning) => warnings.push(warning.message)
    });

    if (warnings.length) {
        getLog().info(
            `DOCX export of note '${note.noteId}' left out or changed: ${warnings.join("; ")}`);
    }

    if (shell) {
        return patchDocument({
            outputType: "uint8array",
            data: shell.data,
            patches: {
                [CONTENT_PLACEHOLDER]: { type: PatchType.DOCUMENT, children: [ ...children ] }
            },
            keepOriginalStyles: false,
            properties: { title: note.title }
        });
    }

    const document = new Document({
        title: note.title,
        styles: DOCUMENT_STYLES,
        sections: [ { children: [ ...children ] } ]
    });

    return Packer.pack(document, "uint8array");
}

function headingStyle(points: number) {
    return {
        run: { bold: true, color: "auto", size: points * 2 },
        paragraph: { spacing: { before: 240, after: 80 }, keepNext: true }
    };
}

const TWIPS_PER_PIXEL = 15;
const TWIPS_PER_POINT = 20;

/**
 * Removes what only means something inside this Trilium instance (editor bookkeeping, links to
 * other notes, which keep their text) and puts table widths where `htmlToContent()` reads them.
 * `textWidth` is the width of the text on the page, in twips.
 */
export function prepareHtml(html: string, textWidth = DEFAULT_TEXT_WIDTH) {
    const root = parse(stripListItemIds(html));

    for (const link of root.querySelectorAll("a[href]")) {
        const href = link.getAttribute("href") ?? "";
        const isReferenceLink = href.startsWith("#") && link.classList.contains("reference-link");
        if (href.startsWith("#root") || isReferenceLink) {
            link.replaceWith(link.innerHTML);
        }
    }

    for (const table of root.querySelectorAll("table")) {
        moveTableWidths(table, textWidth);
    }

    return root.toString();
}

/**
 * CKEditor writes a table's width on its `<figure>` and the column widths in a `<colgroup>`;
 * `htmlToContent()` reads them from the `<table>` and its cells. The first row's cells are enough
 * for Word's column grid.
 *
 * A table that is not inside another gets its width in points, the whole width of the text when
 * it has none: `htmlToContent()` resolves percentages against {@link DEFAULT_TEXT_WIDTH}, which
 * leaves tables narrower than the text of a template with a wider page or narrower margins.
 */
function moveTableWidths(table: HTMLElement, textWidth: number) {
    const figure = table.parentNode;
    const figureWidth = figure?.tagName === "FIGURE" ? getStyle(figure, "width") : undefined;
    const width = getStyle(table, "width") ?? figureWidth;
    if (!table.closest("td, th")) {
        const percent = width === undefined ? 100 : parsePercent(width);
        if (percent !== undefined) {
            const points = textWidth * percent / 100 / TWIPS_PER_POINT;
            setStyle(table, "width", `${Number(points.toFixed(2))}pt`);
        }
    } else if (figureWidth && !getStyle(table, "width")) {
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
    const style = (element.getAttribute("style") ?? "")
        .replace(new RegExp(`(?:^|;)\\s*${property}\\s*:[^;]*`, "i"), "")
        .trim()
        .replace(/^;/, "");
    const separator = style && !style.endsWith(";") ? ";" : "";
    element.setAttribute("style", `${style}${separator}${property}:${value};`);
}

function parsePercent(width: string) {
    const match = width.match(/^([\d.]+)%$/);
    return match ? Number(match[1]) : undefined;
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
