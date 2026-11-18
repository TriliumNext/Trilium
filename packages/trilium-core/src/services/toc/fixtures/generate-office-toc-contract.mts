/**
 * Writes `toc_contract.docx` and `toc_contract.odt`, the documents whose headings the DOCX and
 * ODT formats must read, and `toc_contract_docx.json` and `toc_contract_odt.json`, their headings
 * and ids as the reader of the preview reads them. Run it after a change of the reader, of the ids
 * or of `officeparser`, from the repository root:
 *
 *     node_modules/.bin/tsx packages/trilium-core/src/services/toc/fixtures/generate-office-toc-contract.mts
 *
 * Check the JSON by hand before it is committed: the specs compare the formats with it.
 */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { strToU8, unzipSync, zipSync, type Zippable } from "fflate";

import { DOCX_MIME, ODT_MIME } from "../../../../../commons/src/lib/office.js";
import { assignHeadingIds, getBlobTag } from "../../../../../commons/src/lib/toc.js";
import { blobIdFromDigest, PROTECTED_BLOB_PREFIX } from "../../../../../commons/src/lib/utils.js";
import { convertOfficeToHtml } from "../../office_preview.js";
import { initZipProvider, type ZipProvider } from "../../zip_provider.js";
import {
    readBookmarkNames, readPreviewBookmarks, readPreviewHeadings
} from "../office_headings.js";

// The reader of bookmarks opens the archive through the zip provider, which the app sets up.
initZipProvider({
    async readZipFile(source, processEntry) {
        for (const [ fileName, bytes ] of Object.entries(unzipSync(source as Uint8Array))) {
            await processEntry({ fileName }, async () => bytes);
        }
    }
} as Pick<ZipProvider, "readZipFile"> as ZipProvider);

const fixturesDir = import.meta.dirname;
/** A fixed date for the entries of the archives, so that the same script writes the same bytes. */
const MTIME = new Date("2026-01-01T00:00:00Z");

await writeContract("docx", DOCX_MIME, buildContractDocx());
await writeContract("odt", ODT_MIME, buildContractOdt());

async function writeContract(name: string, mime: string, bytes: Uint8Array) {
    writeFileSync(join(fixturesDir, `toc_contract.${name}`), bytes);
    const html = await convertOfficeToHtml(bytes, mime);
    const { headings, isCut } = readPreviewHeadings(html);
    const outline = headings.map(({ title, level }) => ({ title, level }));
    const bookmarks = readPreviewBookmarks(html, await readBookmarkNames(bytes, mime));
    const blobId = digest(bytes);
    const protectedBlobId = digest(Buffer.concat([ Buffer.from(PROTECTED_BLOB_PREFIX), bytes ]));
    const contract = {
        blobId,
        protectedBlobId,
        headings: outline,
        isCut,
        bookmarks: bookmarks.map(({ name }) => name),
        ids: assignHeadingIds(outline, getBlobTag(blobId), false, { isCut }),
        protectedIds: assignHeadingIds(outline, getBlobTag(protectedBlobId), true, { isCut })
    };
    writeFileSync(join(fixturesDir, `toc_contract_${name}.json`),
        `${JSON.stringify(contract, null, 4)}\n`);
}

function digest(content: Uint8Array) {
    return blobIdFromDigest(new Uint8Array(createHash("sha512").update(content).digest()));
}

function zip(files: Record<string, string>, storedFirst?: string) {
    const entries: Zippable = {};
    if (storedFirst) {
        entries[storedFirst] = [ strToU8(files[storedFirst]), { level: 0, mtime: MTIME } ];
    }
    for (const [ path, content ] of Object.entries(files)) {
        if (path !== storedFirst) {
            entries[path] = [ strToU8(content), { mtime: MTIME } ];
        }
    }
    return zipSync(entries);
}

/**
 * A Word document with a `Title`, a level 1 then a level 3, two sibling "Summary" headings,
 * "Exercises" under two chapters, an empty heading, a heading with a footnote, a tab and a break,
 * a level 7 under a level 6, a heading in a table, a heading with the bookmark of Word's table of
 * contents and one with a user bookmark, and two paragraphs that `officeparser` does not read as
 * headings: one in a localized style (`berschrift1`) and a heading with numbering of its own.
 * Its bookmarks: one named like the slug of "Summary", `title`, which DOMPurify removes as an
 * id, `footnote-1`, the id of the footnote, one that a hyperlink names, and two on one paragraph.
 */
function buildContractDocx() {
    const W = "xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\" "
        + "xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"";
    const style = (id: string, name: string, outlineLevel?: number) =>
        `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/>`
        + (outlineLevel === undefined
            ? ""
            : `<w:pPr><w:outlineLvl w:val="${outlineLevel}"/></w:pPr>`)
        + "</w:style>";
    const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${W}>`
        + style("Normal", "Normal")
        + [ 1, 2, 3, 4, 5, 6, 7 ].map((level) =>
            style(`Heading${level}`, `heading ${level}`, level - 1)).join("")
        + style("Title", "Title")
        + style("berschrift1", "heading 1", 0)
        + "</w:styles>";
    const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
    const paragraph = (styleId: string | null, content: string, properties = "") =>
        `<w:p><w:pPr>${styleId ? `<w:pStyle w:val="${styleId}"/>` : ""}${properties}</w:pPr>`
        + `${content}</w:p>`;
    const heading = (level: number, text: string) => paragraph(`Heading${level}`, run(text));
    const bookmark = (id: number, name: string, content: string) =>
        `<w:bookmarkStart w:id="${id}" w:name="${name}"/>${content}<w:bookmarkEnd w:id="${id}"/>`;

    const body = [
        paragraph("Title", run("Contract document")),
        heading(1, "Chapter 1"),
        heading(3, "Skipped to three"),
        heading(2, "Summary"),
        paragraph("Normal", run("Body text.")),
        heading(2, "Summary"),
        heading(2, "Exercises"),
        heading(1, "Chapter 2"),
        heading(2, "Exercises"),
        paragraph("Heading2", ""),
        paragraph("Heading2", run("Notes")
            + "<w:r><w:footnoteReference w:id=\"1\"/></w:r>"
            + "<w:r><w:tab/></w:r>" + run("with a tab")
            + "<w:r><w:br/></w:r>" + run("and a break")),
        heading(6, "Level six"),
        heading(7, "Level seven"),
        "<w:tbl><w:tr><w:tc>" + heading(2, "In a table") + "</w:tc></w:tr></w:tbl>",
        paragraph("Heading2", "<w:bookmarkStart w:id=\"1\" w:name=\"_Toc100200300\"/>"
            + run("Listed in the table of contents") + "<w:bookmarkEnd w:id=\"1\"/>"),
        paragraph("Heading2", "<w:bookmarkStart w:id=\"2\" w:name=\"Appendix\"/>"
            + run("Appendix") + "<w:bookmarkEnd w:id=\"2\"/>"),
        paragraph("Normal", bookmark(3, "summary", run("Named like a heading's slug"))),
        paragraph("Normal", bookmark(4, "title", run("Named like a property of the document"))),
        paragraph("Normal", bookmark(5, "footnote-1", run("Named like the footnote"))),
        paragraph("Normal",
            "<w:hyperlink w:anchor=\"Linked\">" + run("A link to Linked") + "</w:hyperlink>"),
        paragraph("Normal", bookmark(6, "Linked", run("Linked from above"))),
        paragraph("Normal", bookmark(7, "First", bookmark(8, "Second", run("Two bookmarks")))),
        paragraph("berschrift1", run("Lokalisierte Überschrift")),
        paragraph("Heading2", run("Numbered on its own"),
            "<w:numPr><w:ilvl w:val=\"0\"/><w:numId w:val=\"1\"/></w:numPr>")
    ].join("");

    const relationship = (id: string, type: string, target: string) =>
        `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/`
        + `relationships/${type}" Target="${target}"/>`;
    const override = (part: string, type: string) => `<Override PartName="/word/${part}" `
        + "ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml."
        + `${type}+xml"/>`;
    return zip({
        "[Content_Types].xml": "<?xml version=\"1.0\" encoding=\"UTF-8\"?>"
            + "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">"
            + "<Default Extension=\"rels\" "
            + "ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>"
            + "<Default Extension=\"xml\" ContentType=\"application/xml\"/>"
            + override("document.xml", "document.main") + override("styles.xml", "styles")
            + override("footnotes.xml", "footnotes") + "</Types>",
        "_rels/.rels": "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Relationships "
            + "xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">"
            + relationship("rId1", "officeDocument", "word/document.xml") + "</Relationships>",
        "word/_rels/document.xml.rels": "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Relationships "
            + "xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">"
            + relationship("rId1", "styles", "styles.xml")
            + relationship("rId2", "footnotes", "footnotes.xml") + "</Relationships>",
        "word/styles.xml": styles,
        "word/footnotes.xml": "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
            + `<w:footnotes ${W}><w:footnote w:id="1"><w:p>${run("A footnote.")}</w:p>`
            + "</w:footnote></w:footnotes>",
        "word/document.xml": "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
            + `<w:document ${W}><w:body>${body}<w:sectPr/></w:body></w:document>`
    });
}

/**
 * An OpenDocument text with the headings of the Word document, and an endnote, headings in a
 * list, a section and a text box, a numbered heading whose label LibreOffice caches, hidden text,
 * and a paragraph in a heading style, which is not a heading. Its bookmarks: those of the Word
 * document, one that a cross-reference names, and two inside a tracked deletion, named like the
 * `xml:id` of a heading and the name of a table, which are not shown.
 */
function buildContractOdt() {
    const NS = [
        "office=\"urn:oasis:names:tc:opendocument:xmlns:office:1.0\"",
        "style=\"urn:oasis:names:tc:opendocument:xmlns:style:1.0\"",
        "text=\"urn:oasis:names:tc:opendocument:xmlns:text:1.0\"",
        "table=\"urn:oasis:names:tc:opendocument:xmlns:table:1.0\"",
        "draw=\"urn:oasis:names:tc:opendocument:xmlns:drawing:1.0\"",
        "svg=\"urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0\"",
        "dc=\"http://purl.org/dc/elements/1.1/\""
    ].map((namespace) => `xmlns:${namespace}`).join(" ") + " office:version=\"1.3\"";
    const styles = `<?xml version="1.0" encoding="UTF-8"?><office:document-styles ${NS}>`
        + "<office:styles><style:style style:name=\"Standard\" style:family=\"paragraph\"/>"
        + [ 1, 2, 3, 4, 5, 6 ].map((level) => `<style:style style:name="Heading_20_${level}" `
            + `style:display-name="Heading ${level}" style:family="paragraph" `
            + `style:default-outline-level="${level}"/>`).join("")
        + "<style:style style:name=\"Title\" style:family=\"paragraph\"/>"
        + "</office:styles></office:document-styles>";
    const heading = (level: number, content: string) =>
        `<text:h text:style-name="Heading_20_${Math.min(level, 6)}" text:outline-level="${level}">`
        + `${content}</text:h>`;
    const paragraph = (styleName: string, content: string) =>
        `<text:p text:style-name="${styleName}">${content}</text:p>`;
    const note = (id: string, noteClass: string, citation: string) =>
        `<text:note text:id="${id}" text:note-class="${noteClass}">`
        + `<text:note-citation>${citation}</text:note-citation>`
        + `<text:note-body><text:p>A note.</text:p></text:note-body></text:note>`;

    const body = [
        "<text:tracked-changes><text:changed-region text:id=\"ct1\"><text:deletion>"
            + "<office:change-info><dc:creator>A</dc:creator></office:change-info>"
            + "<text:p><text:bookmark text:name=\"id123\"/>"
            + "<text:bookmark text:name=\"Table1\"/>Deleted</text:p>"
            + "</text:deletion></text:changed-region></text:tracked-changes>",
        paragraph("Title", "Contract document<text:change text:change-id=\"ct1\"/>"),
        heading(1, "Chapter 1"),
        heading(3, "Skipped to three"),
        heading(2, "Summary"),
        paragraph("Standard", "Body text."),
        heading(2, "Summary"),
        heading(2, "Exercises"),
        heading(1, "Chapter 2"),
        heading(2, "Exercises"),
        heading(2, ""),
        heading(2, `Notes${note("ftn1", "footnote", "1")}<text:tab/>with a tab`
            + "<text:line-break/>and a break"),
        heading(2, `Closing remarks${note("edn1", "endnote", "i")}`),
        heading(6, "Level six"),
        heading(7, "Level seven"),
        "<table:table table:name=\"Table1\"><table:table-column/><table:table-row>"
            + "<table:table-cell>" + heading(2, "In a table")
            + "</table:table-cell></table:table-row></table:table>",
        heading(2, "<text:bookmark-start text:name=\"__RefHeading___Toc100_200\"/>"
            + "Listed in the table of contents"
            + "<text:bookmark-end text:name=\"__RefHeading___Toc100_200\"/>"),
        heading(2, "<text:bookmark text:name=\"Appendix\"/>Appendix"),
        "<text:list><text:list-item>" + heading(2, "In a list") + "</text:list-item></text:list>",
        "<text:section text:name=\"Section1\">"
            + "<text:h text:style-name=\"Heading_20_2\" text:outline-level=\"2\" xml:id=\"id123\">"
            + "In a section</text:h></text:section>",
        paragraph("Standard", "<draw:frame draw:name=\"Frame1\" svg:width=\"5cm\"><draw:text-box>"
            + heading(2, "In a text box") + "</draw:text-box></draw:frame>"),
        heading(2, "<text:number>2.4</text:number>Numbered"),
        heading(2, "Visible <text:hidden-text text:condition=\"\" text:string-value=\"hidden\" "
            + "text:is-hidden=\"true\"/>text"),
        paragraph("Heading_20_2", "A paragraph in a heading style"),
        paragraph("Standard", "<text:bookmark text:name=\"summary\"/>Named like a heading's slug"),
        paragraph("Standard",
            "<text:bookmark text:name=\"title\"/>Named like a property of the document"),
        paragraph("Standard",
            "<text:bookmark text:name=\"footnote-ftn1\"/>Named like the footnote"),
        paragraph("Standard", "<text:bookmark-ref text:ref-name=\"Linked\" "
            + "text:reference-format=\"text\">Linked</text:bookmark-ref>"),
        paragraph("Standard", "<text:bookmark text:name=\"Linked\"/>Linked from above"),
        paragraph("Standard", "<text:bookmark text:name=\"First\"/>"
            + "<text:bookmark text:name=\"Second\"/>Two bookmarks")
    ].join("");

    return zip({
        mimetype: ODT_MIME,
        "META-INF/manifest.xml": "<?xml version=\"1.0\" encoding=\"UTF-8\"?><manifest:manifest "
            + "xmlns:manifest=\"urn:oasis:names:tc:opendocument:xmlns:manifest:1.0\" "
            + "manifest:version=\"1.3\">"
            + [ [ "/", ODT_MIME ], [ "content.xml", "text/xml" ], [ "styles.xml", "text/xml" ] ]
                .map(([ part, type ]) => `<manifest:file-entry manifest:full-path="${part}" `
                    + `manifest:media-type="${type}"/>`)
                .join("")
            + "</manifest:manifest>",
        "styles.xml": styles,
        "content.xml": `<?xml version="1.0" encoding="UTF-8"?><office:document-content ${NS}>`
            + `<office:body><office:text>${body}</office:text></office:body>`
            + "</office:document-content>"
    }, "mimetype");
}
