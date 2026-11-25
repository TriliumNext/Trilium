import { DOCX_MIME, isConvertibleToText, isDefaultHyperlinkColor } from "@triliumnext/commons";
import { unzipSync } from "fflate";
import { t } from "i18next";
import { HTMLElement, parse } from "node-html-parser";

import type BNote from "../becca/entities/bnote.js";
import { ValidationError } from "../errors.js";
import noteService from "./notes.js";
import { convertOfficeToHtml } from "./office_preview.js";
import { sanitizeHtml } from "./sanitizer.js";
import { getSql } from "./sql/index.js";
import { decodeUtf8, wrapStringOrBuffer } from "./utils/binary.js";

/**
 * Converts a file note holding a word-processing document (DOCX, ODT, RTF) into a text note in
 * place. A named revision keeps the original file, so the conversion can be undone. Embedded
 * pictures arrive as `data:` URIs, which `updateNoteData()` stores as attachments.
 */
export async function convertDocumentNoteToText(note: BNote) {
    if (note.type !== "file" || !isConvertibleToText(note.mime)) {
        throw new ValidationError(
            `Note '${note.noteId}' is not a document that can be converted to text.`);
    }

    if (!note.isContentAvailable()) {
        throw new ValidationError(
            `Note '${note.noteId}' content is not available; a protected session may be required.`);
    }

    const content = wrapStringOrBuffer(note.getContent());
    const bodyFontSize = note.mime === DOCX_MIME ? readDocxBodyFontSize(content) : undefined;
    const documentHtml = await convertOfficeToHtml(content, note.mime);
    const html = sanitizeHtml(cleanDocumentHtml(documentHtml, { bodyFontSize }));

    getSql().transactional(() => {
        note.saveRevision({
            description: t("note_conversion.revision_before_text"),
            source: "manual"
        });

        note.title = note.title.replace(/\.(docx|odt|rtf)$/i, "") || note.title;
        note.type = "text";
        note.mime = "text/html";
        note.save();

        noteService.updateNoteData(note.noteId, html);
    });
}

/**
 * The font size of body text in a Word document, in points: that of its `Normal` style, or else
 * of its document defaults, or else Word's own 10pt.
 */
export function readDocxBodyFontSize(docx: Uint8Array): number | undefined {
    let styles: string;
    try {
        const files = unzipSync(docx, { filter: (file) => file.name === "word/styles.xml" });
        styles = decodeUtf8(files["word/styles.xml"] ?? new Uint8Array());
    } catch {
        return undefined;
    }

    const normalStyle = styles
        .match(/<w:style\b[^>]*w:styleId="Normal"[^>]*>[\s\S]*?<\/w:style>/)?.[0];
    const runDefaults = styles.match(/<w:rPrDefault>[\s\S]*?<\/w:rPrDefault>/)?.[0];
    const halfPoints = readSize(normalStyle) ?? readSize(runDefaults);
    return halfPoints ? halfPoints / 2 : 10;
}

function readSize(xml: string | undefined) {
    const value = xml?.match(/<w:sz\s+w:val="(\d+)"/)?.[1];
    return value ? Number(value) : undefined;
}

/** The inline styles a text note keeps from a converted document; the rest is page layout. */
const KEPT_STYLES = new Set([ "color", "background-color", "text-align", "width" ]);

/**
 * Turns the HTML of the office preview into the HTML of a text note: tables in the `<figure>` the
 * editor writes, highlights as the editor's spans, colors with the variables that adapt them to
 * the theme, and without the wrappers and the styles of the word processor's page.
 */
export function cleanDocumentHtml(
    html: string,
    { bodyFontSize = 12 }: { bodyFontSize?: number } = {}
) {
    const root = parse(html);

    // Innermost first, so that each wrapper still holds its own children.
    for (const wrapper of root.querySelectorAll("div.container, div.table-container").reverse()) {
        wrapper.replaceWith(...wrapper.childNodes);
    }

    for (const table of root.querySelectorAll("table")) {
        if (table.parentNode?.tagName !== "FIGURE") {
            const figure = new HTMLElement("figure", {}, `class="table"`);
            table.replaceWith(figure);
            figure.appendChild(table);
        }
        fillShortRows(table);
    }

    for (const mark of root.querySelectorAll("mark")) {
        mark.tagName = "span";
        mark.removeAttribute("data-color");
    }

    // The colors of the word processor's heading styles differ between versions, so headings follow
    // the theme. A link keeps a color its author chose, as in the preview.
    const headings = "h1, h2, h3, h4, h5, h6";
    for (const element of root.querySelectorAll(`:is(${headings}), :is(${headings}) *`)) {
        removeStyle(element, "color");
    }
    for (const element of root.querySelectorAll("a[style], a [style]")) {
        const color = readStyles(element).find(([ property ]) => property === "color");
        if (color && isDefaultHyperlinkColor(color[1])) {
            removeStyle(element, "color");
        }
    }
    for (const underline of root.querySelectorAll("a u")) {
        underline.replaceWith(...underline.childNodes);
    }

    for (const span of root.querySelectorAll("span[style]")) {
        const fontSize = readStyles(span).find(([ property ]) => property === "font-size");
        const sizeClass = fontSize && !span.closest(headings)
            ? getFontSizeClass(fontSize[1], bodyFontSize)
            : undefined;
        if (sizeClass) {
            span.classList.add(sizeClass);
        }
    }

    for (const element of root.querySelectorAll("[style]")) {
        keepStyles(element);
    }

    for (const item of root.querySelectorAll("li[value]")) {
        item.removeAttribute("value");
    }

    for (const span of root.querySelectorAll("span").reverse()) {
        if (!Object.keys(span.attributes).length) {
            span.replaceWith(...span.childNodes);
        }
    }

    return root.toString();
}

/**
 * The editor's font size class nearest to a size relative to the body text, or none for a size
 * near the body text's own. The bounds lie halfway between the sizes of the classes
 * (`--ck-content-font-size-*`: 0.7, 0.85, 1, 1.4 and 1.8em).
 */
function getFontSizeClass(value: string, bodyFontSize: number) {
    const match = value.match(/^([\d.]+)(pt|px)$/i);
    if (!match) {
        return undefined;
    }

    const points = match[2].toLowerCase() === "px" ? Number(match[1]) * 0.75 : Number(match[1]);
    const ratio = points / bodyFontSize;
    if (ratio < 0.775) {
        return "text-tiny";
    }
    if (ratio < 0.925) {
        return "text-small";
    }
    if (ratio < 1.2) {
        return undefined;
    }
    return ratio < 1.6 ? "text-big" : "text-huge";
}

/**
 * The office preview pads a row with fewer cells than the table's grid with empty `<td>`s, where
 * the word processor stretches its last cell to the end of the row. This gives that cell the
 * `colspan` instead. A row shortened by a `rowspan` above it is not widened.
 */
function fillShortRows(table: HTMLElement) {
    const rows = getRows(table);
    for (const row of rows) {
        let cell = getCells(row).at(-1);
        while (cell && isPadding(cell)) {
            cell.remove();
            cell = getCells(row).at(-1);
        }
    }

    const widths: number[] = [];
    const coveredByRowspan: number[] = [];
    for (const [ index, row ] of rows.entries()) {
        let width = coveredByRowspan[index] ?? 0;
        for (const cell of getCells(row)) {
            const colspan = readSpan(cell, "colspan");
            width += colspan;
            for (let below = 1; below < readSpan(cell, "rowspan"); below++) {
                coveredByRowspan[index + below] = (coveredByRowspan[index + below] ?? 0) + colspan;
            }
        }
        widths.push(width);
    }

    const tableWidth = Math.max(0, ...widths);
    for (const [ index, row ] of rows.entries()) {
        const last = getCells(row).at(-1);
        if (last && widths[index] < tableWidth) {
            const colspan = readSpan(last, "colspan") + tableWidth - widths[index];
            last.setAttribute("colspan", String(colspan));
        }
    }
}

/** A cell with neither attributes nor content, which only the office preview's padding writes. */
function isPadding(cell: HTMLElement) {
    return !cell.rawAttrs.trim() && !cell.children.length && !cell.rawText.trim();
}

function getRows(table: HTMLElement) {
    const rows: HTMLElement[] = [];
    for (const child of table.children) {
        if (child.tagName === "TR") {
            rows.push(child);
        } else if ([ "THEAD", "TBODY", "TFOOT" ].includes(child.tagName)) {
            rows.push(...child.children.filter((row) => row.tagName === "TR"));
        }
    }
    return rows;
}

function getCells(row: HTMLElement) {
    return row.children.filter((cell) => cell.tagName === "TD" || cell.tagName === "TH");
}

function readSpan(cell: HTMLElement, attribute: "colspan" | "rowspan") {
    return Math.max(1, Number(cell.getAttribute(attribute)) || 1);
}

/**
 * Keeps the styles in {@link KEPT_STYLES}, minus the default `text-align: left`, and repeats each
 * color in the `--tn-*` variable that adapts it to the theme.
 */
function keepStyles(element: HTMLElement) {
    const kept: string[] = [];

    for (const [ property, value ] of readStyles(element)) {
        const isDefaultAlignment = property === "text-align" && /^(left|start)$/i.test(value);
        if (!KEPT_STYLES.has(property) || isDefaultAlignment) {
            continue;
        }

        kept.push(`${property}:${value};`);
        if (property === "color") {
            kept.push(`--tn-color:${value};`);
        } else if (property === "background-color") {
            kept.push(`--tn-background:${value};`);
        }
    }

    if (kept.length) {
        element.setAttribute("style", kept.join(""));
    } else {
        element.removeAttribute("style");
    }
}

function removeStyle(element: HTMLElement, removed: string) {
    const kept = readStyles(element).filter(([ property ]) => property !== removed);
    if (kept.length) {
        const style = kept.map(([ property, value ]) => `${property}:${value};`).join("");
        element.setAttribute("style", style);
    } else {
        element.removeAttribute("style");
    }
}

function readStyles(element: HTMLElement): [ string, string ][] {
    const styles: [ string, string ][] = [];

    for (const declaration of (element.getAttribute("style") ?? "").split(";")) {
        const separator = declaration.indexOf(":");
        if (separator > 0) {
            styles.push([
                declaration.slice(0, separator).trim().toLowerCase(),
                declaration.slice(separator + 1).trim()
            ]);
        }
    }

    return styles;
}
