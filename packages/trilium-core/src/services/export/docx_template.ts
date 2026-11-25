import { DOCX_MIME } from "@triliumnext/commons";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

import type BNote from "../../becca/entities/bnote.js";
import { ValidationError } from "../../errors.js";
import { decodeUtf8, wrapStringOrBuffer } from "../utils/binary.js";

/** The relation that points a note, or the notes under it, at the Word document to export into. */
export const DOCX_TEMPLATE_RELATION = "docxTemplate";

/**
 * The key of the paragraph that `patchDocument()` replaces with the note's content: `{{content}}`,
 * which a template can hold where the note goes. Spaces inside the braces are allowed.
 */
export const CONTENT_PLACEHOLDER = "content";

const CONTENT_MARKER = /\{\{\s*content\s*\}\}/;

/**
 * The width of the text on the page of `docx`'s own documents, in twips: an A4 page with 1-inch
 * margins. A template without page setup has it too.
 */
export const DEFAULT_TEXT_WIDTH = 9026;

const RELATIONSHIP_TYPES = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/** The relationships of a document's body that only its content refers to. */
const CONTENT_RELATIONSHIP_TYPES = new Set([
    `${RELATIONSHIP_TYPES}/image`,
    `${RELATIONSHIP_TYPES}/hyperlink`
]);

/** The style that `renderTextNoteToDocx()` gives text in table cells. */
const TABLE_TEXT_STYLE = "TableText";

/** The style that `renderTextNoteToDocx()` gives the note's paragraphs in a template. */
export const NOTE_TEXT_STYLE = "NoteText";

/**
 * Returns the bytes of the Word document that the `~docxTemplate` relation of `note` points at,
 * owned or inherited, or `undefined` without one. A target that is not a Word document is refused.
 */
export function getDocxTemplate(note: BNote): Uint8Array | undefined {
    const template = note.getRelationTarget(DOCX_TEMPLATE_RELATION);
    if (!template) {
        return undefined;
    }

    if (template.type !== "file" || template.mime !== DOCX_MIME) {
        throw new ValidationError(
            `The ~${DOCX_TEMPLATE_RELATION} of note '${note.noteId}' points at note `
            + `'${template.noteId}', which is not a Word document.`);
    }
    if (!template.isContentAvailable()) {
        throw new ValidationError(
            `The Word template '${template.noteId}' is protected; `
            + "a protected session is required.");
    }

    return wrapStringOrBuffer(template.getContent());
}

/**
 * Turns a Word document into the shell that a note's content is patched into. A document with a
 * `{{content}}` paragraph in its body is kept whole, and the note replaces that paragraph.
 * Otherwise its body becomes a single `{{content}}` paragraph followed by the page setup of its
 * last section, and the pictures only that body showed are removed. Styles, headers, footers, the theme and
 * embedded fonts stay either way, and the `TableText` style is added when the document lacks it.
 *
 * A `{{content}}` paragraph also gives the note's text its look: the {@link NOTE_TEXT_STYLE}
 * style, added when the document lacks it, is based on the paragraph's style and has the
 * character formatting of its first run, such as its font and size.
 *
 * Also returns the width of the text on the page where the note goes, in twips, since
 * `patchDocument()` sizes tables for {@link DEFAULT_TEXT_WIDTH} whatever the template's page,
 * and the font size of {@link NOTE_TEXT_STYLE}, in points, when the run sets one.
 */
export function prepareDocxTemplate(docx: Uint8Array): PreparedDocxTemplate {
    let files: Record<string, Uint8Array>;
    try {
        files = unzipSync(docx);
    } catch {
        throw new ValidationError("The Word template is not a valid DOCX file.");
    }

    const documentXml = files["word/document.xml"];
    if (!documentXml) {
        throw new ValidationError("The Word template is not a valid DOCX file.");
    }

    const original = strFromU8(documentXml);
    const marker = findContentMarker(original);
    if (marker) {
        files["word/document.xml"] = documentXml;
    } else {
        const document = emptyBody(original);
        files["word/document.xml"] = strToU8(document);

        const relsPath = "word/_rels/document.xml.rels";
        if (files[relsPath]) {
            const rels = removeUnusedRelationships(strFromU8(files[relsPath]), document);
            files[relsPath] = strToU8(rels);
            removeUnreferencedMedia(files);
        }
    }
    const textWidth = readTextWidth(strFromU8(files["word/document.xml"]), marker?.index ?? 0);

    const styles = files["word/styles.xml"];
    const runProperties = marker && readRunProperties(marker.paragraph);
    const contentStyle = styles && marker ? NOTE_TEXT_STYLE : undefined;
    if (styles) {
        let xml = strFromU8(styles);
        const added: string[] = [];
        if (marker && !hasStyle(xml, NOTE_TEXT_STYLE)) {
            const basedOn = readParagraphStyle(marker.paragraph) ?? readDefaultParagraphStyle(xml);
            added.push(paragraphStyle(NOTE_TEXT_STYLE, "Note Text", basedOn, runProperties ?? ""));
        }
        if (!hasStyle(xml, TABLE_TEXT_STYLE)) {
            added.push(paragraphStyle(TABLE_TEXT_STYLE, "Table Text", contentStyle ?? "Normal", "",
                `<w:pPr><w:spacing w:after="0"/></w:pPr>`));
        }
        if (added.length) {
            xml = xml.replace("</w:styles>", `${added.join("")}</w:styles>`);
            files["word/styles.xml"] = strToU8(xml);
        }
    }

    const halfPoints = readSize(runProperties);
    return {
        data: zipSync(files),
        textWidth,
        contentStyle,
        contentFontSize: halfPoints ? halfPoints / 2 : undefined
    };
}

export interface PreparedDocxTemplate {
    data: Uint8Array;
    /** The width of the text on the page where the note goes, in twips. */
    textWidth: number;
    /** The paragraph style of the note's text, when the template has a `{{content}}` line. */
    contentStyle?: string;
    /** The font size of {@link contentStyle}, in points, when the line sets one. */
    contentFontSize?: number;
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

/**
 * Replaces the content of `<w:body>` with the placeholder paragraph, keeping the `<w:sectPr>` that
 * closes the body: the page size, margins, and references to the headers and footers.
 */
function emptyBody(document: string) {
    const bodyStart = document.search(/<w:body\b[^>]*>/);
    const bodyEnd = document.lastIndexOf("</w:body>");
    if (bodyStart < 0 || bodyEnd < 0) {
        throw new ValidationError("The Word template is not a valid DOCX file.");
    }

    const contentStart = document.indexOf(">", bodyStart) + 1;
    const body = document.slice(contentStart, bodyEnd);
    const sectionStart = body.lastIndexOf("<w:sectPr");
    const lastBlockEnd = Math.max(body.lastIndexOf("</w:p>"), body.lastIndexOf("</w:tbl>"));
    const sectionProperties = sectionStart > lastBlockEnd ? body.slice(sectionStart).trim() : "";

    const placeholder = `<w:p><w:r><w:t>{{${CONTENT_PLACEHOLDER}}}</w:t></w:r></w:p>`;
    return document.slice(0, contentStart) + placeholder + sectionProperties
        + document.slice(bodyEnd);
}

/**
 * The paragraph whose text is `{{content}}` in `document`, which Word can have split across
 * several runs, and its position, or `undefined` without one.
 */
function findContentMarker(document: string) {
    for (const paragraph of document.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)) {
        const text = [ ...paragraph[0].matchAll(/<w:t\b[^>]*>([^<]*)<\/w:t>/g) ]
            .map((run) => run[1])
            .join("");
        if (CONTENT_MARKER.test(text)) {
            return { index: paragraph.index, paragraph: paragraph[0] };
        }
    }
    return undefined;
}

/** The `<w:rPr>` of the first run of `paragraph` with text, without its character style. */
function readRunProperties(paragraph: string) {
    for (const [ run ] of paragraph.matchAll(/<w:r(?![A-Za-z])[^>]*>[\s\S]*?<\/w:r>/g)) {
        if (/<w:t\b/.test(run)) {
            return run.match(/<w:rPr>[\s\S]*?<\/w:rPr>/)?.[0]
                .replace(/<w:rStyle\b[^>]*\/>/, "");
        }
    }
    return undefined;
}

function readParagraphStyle(paragraph: string) {
    const properties = paragraph.match(/<w:pPr>[\s\S]*?<\/w:pPr>/)?.[0];
    return properties?.match(/<w:pStyle\s+w:val="([^"]+)"/)?.[1];
}

/** The id of the style that paragraphs without one of their own have. */
function readDefaultParagraphStyle(styles: string) {
    for (const [ style ] of styles.matchAll(/<w:style\b[^>]*>/g)) {
        if (style.includes(`w:type="paragraph"`) && /\bw:default="(1|true|on)"/.test(style)) {
            return style.match(/\bw:styleId="([^"]+)"/)?.[1] ?? "Normal";
        }
    }
    return "Normal";
}

function hasStyle(styles: string, id: string) {
    return styles.includes(`w:styleId="${id}"`);
}

function paragraphStyle(
    id: string, name: string, basedOn: string, runProperties: string, paragraphProperties = ""
) {
    return `<w:style w:type="paragraph" w:customStyle="1" w:styleId="${id}">`
        + `<w:name w:val="${name}"/><w:basedOn w:val="${basedOn}"/><w:qFormat/>`
        + `${paragraphProperties}${runProperties}</w:style>`;
}

/**
 * The width of the page minus its margins, in twips, of the section that the body's content at
 * position `from` of `document` is in: the first `<w:sectPr>` after it closes that section.
 */
function readTextWidth(document: string, from: number) {
    const sectionStart = document.indexOf("<w:sectPr", from);
    const section = sectionStart < 0 ? "" : document.slice(sectionStart);
    const pageWidth = readTwips(section.match(/<w:pgSz\b[^>]*>/)?.[0], "w");
    const margins = section.match(/<w:pgMar\b[^>]*>/)?.[0];
    if (!pageWidth || !margins) {
        return DEFAULT_TEXT_WIDTH;
    }

    const left = readTwips(margins, "left") ?? readTwips(margins, "start") ?? 0;
    const right = readTwips(margins, "right") ?? readTwips(margins, "end") ?? 0;
    const textWidth = pageWidth - left - right - (readTwips(margins, "gutter") ?? 0);
    return textWidth > 0 ? textWidth : DEFAULT_TEXT_WIDTH;
}

function readTwips(element: string | undefined, attribute: string) {
    const value = element?.match(new RegExp(`\\bw:${attribute}="(-?\\d+)"`))?.[1];
    return value === undefined ? undefined : Number(value);
}

/** Removes the pictures and links of the body that `document` no longer refers to. */
function removeUnusedRelationships(rels: string, document: string) {
    return rels.replace(/<Relationship\b[^>]*\/>/g, (relationship) => {
        const id = relationship.match(/\bId="([^"]+)"/)?.[1];
        const type = relationship.match(/\bType="([^"]+)"/)?.[1];
        const isUnused = id && type && CONTENT_RELATIONSHIP_TYPES.has(type)
            && !document.includes(`"${id}"`);
        return isUnused ? "" : relationship;
    });
}

/** Removes the files under `word/media/` that no relationship of the package points at. */
function removeUnreferencedMedia(files: Record<string, Uint8Array>) {
    const targets = new Set<string>();
    for (const [ path, content ] of Object.entries(files)) {
        if (!path.endsWith(".rels")) {
            continue;
        }
        for (const [ , target ] of strFromU8(content).matchAll(/\bTarget="([^"]+)"/g)) {
            targets.add(target.split("/").at(-1) ?? target);
        }
    }

    for (const path of Object.keys(files)) {
        if (path.startsWith("word/media/") && !targets.has(path.split("/").at(-1) ?? path)) {
            delete files[path];
        }
    }
}
