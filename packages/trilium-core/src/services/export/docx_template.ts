import { DOCX_MIME } from "@triliumnext/commons";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

import type BNote from "../../becca/entities/bnote.js";
import { ValidationError } from "../../errors.js";
import { decodeUtf8, wrapStringOrBuffer } from "../utils/binary.js";

/** The relation that points a note, or the notes under it, at the Word document to export into. */
export const DOCX_TEMPLATE_RELATION = "docxTemplate";

/** The key of the paragraph that `patchDocument()` replaces with the note's content. */
export const CONTENT_PLACEHOLDER = "trilium_content";

const RELATIONSHIP_TYPES = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/** The relationships of a document's body that only its content refers to. */
const CONTENT_RELATIONSHIP_TYPES = new Set([
    `${RELATIONSHIP_TYPES}/image`,
    `${RELATIONSHIP_TYPES}/hyperlink`
]);

/** The style that `renderTextNoteToDocx()` gives text in table cells. */
const TABLE_TEXT_STYLE = `<w:style w:type="paragraph" w:customStyle="1" w:styleId="TableText">`
    + `<w:name w:val="Table Text"/><w:basedOn w:val="Normal"/><w:qFormat/>`
    + `<w:pPr><w:spacing w:after="0"/></w:pPr></w:style>`;

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
 * Turns a Word document into the shell that a note's content is patched into: its body becomes a
 * single `{{trilium_content}}` paragraph followed by the page setup of its last section, and the
 * pictures only that body showed are removed. Styles, headers, footers, the theme and embedded
 * fonts stay, and the `TableText` style is added when the document lacks it.
 */
export function prepareDocxTemplate(docx: Uint8Array): Uint8Array {
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

    const document = emptyBody(strFromU8(documentXml));
    files["word/document.xml"] = strToU8(document);

    const relsPath = "word/_rels/document.xml.rels";
    if (files[relsPath]) {
        files[relsPath] = strToU8(removeUnusedRelationships(strFromU8(files[relsPath]), document));
        removeUnreferencedMedia(files);
    }

    const styles = files["word/styles.xml"];
    if (styles) {
        const xml = strFromU8(styles);
        if (!xml.includes(`w:styleId="TableText"`)) {
            const withStyle = xml.replace("</w:styles>", `${TABLE_TEXT_STYLE}</w:styles>`);
            files["word/styles.xml"] = strToU8(withStyle);
        }
    }

    return zipSync(files);
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
