import { isConvertibleToText, isDefaultHyperlinkColor } from "@triliumnext/commons";
import { t } from "i18next";
import { HTMLElement, parse } from "node-html-parser";

import type BNote from "../becca/entities/bnote.js";
import { ValidationError } from "../errors.js";
import noteService from "./notes.js";
import { convertOfficeToHtml } from "./office_preview.js";
import { sanitizeHtml } from "./sanitizer.js";
import { getSql } from "./sql/index.js";

/**
 * Converts a file note holding a word-processing document (DOCX, ODT, RTF) into a text note in
 * place. A named revision keeps the original file, so the conversion can be undone. Embedded
 * pictures arrive as `data:` URIs, which `updateNoteData()` stores as attachments.
 */
export async function convertDocumentNoteToText(note: BNote) {
    if (note.type !== "file" || !isConvertibleToText(note.mime)) {
        throw new ValidationError(`Note '${note.noteId}' is not a document that can be converted to text.`);
    }

    if (!note.isContentAvailable()) {
        throw new ValidationError(`Note '${note.noteId}' content is not available; a protected session may be required.`);
    }

    const html = sanitizeHtml(cleanDocumentHtml(await convertOfficeToHtml(note.getContent(), note.mime)));

    getSql().transactional(() => {
        note.saveRevision({ description: t("note_conversion.revision_before_text"), source: "manual" });

        note.title = note.title.replace(/\.(docx|odt|rtf)$/i, "") || note.title;
        note.type = "text";
        note.mime = "text/html";
        note.save();

        noteService.updateNoteData(note.noteId, html);
    });
}

/** The inline styles a text note keeps from a converted document; the rest is page layout. */
const KEPT_STYLES = new Set([ "color", "background-color", "text-align", "width" ]);

/**
 * Turns the HTML of the office preview into the HTML of a text note: tables in the `<figure>` the
 * editor writes, highlights as the editor's spans, colors with the variables that adapt them to
 * the theme, and without the wrappers and the styles of the word processor's page.
 */
export function cleanDocumentHtml(html: string) {
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
    }

    for (const mark of root.querySelectorAll("mark")) {
        mark.tagName = "span";
        mark.removeAttribute("data-color");
    }

    // The colors of the word processor's heading styles differ between versions, so headings follow
    // the theme. A link keeps a color its author chose, as in the preview.
    for (const element of root.querySelectorAll(":is(h1, h2, h3, h4, h5, h6), :is(h1, h2, h3, h4, h5, h6) *")) {
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
 * Keeps the styles in {@link KEPT_STYLES}, minus the default `text-align: left`, and repeats each
 * color in the `--tn-*` variable that adapts it to the theme.
 */
function keepStyles(element: HTMLElement) {
    const kept: string[] = [];

    for (const [ property, value ] of readStyles(element)) {
        if (!KEPT_STYLES.has(property) || property === "text-align" && /^(left|start)$/i.test(value)) {
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
        element.setAttribute("style", kept.map(([ property, value ]) => `${property}:${value};`).join(""));
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
