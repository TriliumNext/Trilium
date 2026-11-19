/**
 * Writes `toc_contract.docx` and `toc_contract.odt`, the documents whose headings the DOCX and
 * ODT formats must read, and `toc_contract_docx.json` and `toc_contract_odt.json`, their headings,
 * bookmarks and ids as the generators of the formats read them. Writes the books
 * `toc_contract.epub`, `toc_contract_ncx.epub` and `toc_contract_ids.epub`, whose tables of
 * contents the EPUB format must read and place, and `toc_contract_epub.json`,
 * `toc_contract_ncx_epub.json` and `toc_contract_ids_epub.json`, their entries, which of them the
 * preview shows, and their ids.
 * Run it after a change of the readers, of the ToC pass, of the ids or of `officeparser`, from
 * the repository root:
 *
 *     node_modules/.bin/tsx packages/trilium-core/src/services/toc/fixtures/generate-office-toc-contract.mts
 *
 * Check the JSON by hand before it is committed: the specs compare the formats with it.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { strToU8, zipSync, type Zippable } from "fflate";

import { EPUB_MIME_TYPES, ODT_MIME } from "../../../../../commons/src/lib/office.js";
import { epubTocFormat } from "../epub.js";
import type { TocFormat } from "../index.js";
import { docxTocFormat, odtTocFormat } from "../office.js";
import { buildContract, fixturesDir, writeContract } from "./contract.mjs";

/** A fixed date for the entries of the archives, so that the same script writes the same bytes. */
const MTIME = new Date("2026-01-01T00:00:00Z");
/** The container of an EPUB, which names its package document. */
const CONTAINER = "<?xml version=\"1.0\"?><container version=\"1.0\" "
    + "xmlns=\"urn:oasis:names:tc:opendocument:xmlns:container\"><rootfiles>"
    + "<rootfile full-path=\"OEBPS/content.opf\" media-type=\"application/oebps-package+xml\"/>"
    + "</rootfiles></container>";

await writeOfficeContract("docx", docxTocFormat, buildContractDocx());
await writeOfficeContract("odt", odtTocFormat, buildContractOdt());
await writeEpubContract("toc_contract", buildContractEpub());
await writeEpubContract("toc_contract_ncx", buildContractNcxEpub());
await writeEpubContract("toc_contract_ids", buildContractIdsEpub());

/**
 * Writes the document `toc_contract.<name>` and `toc_contract_<name>.json`: its headings and
 * bookmarks as the generator of `format` reads them, and the ids of the headings.
 */
async function writeOfficeContract(name: string, format: TocFormat, bytes: Uint8Array) {
    writeFileSync(join(fixturesDir, `toc_contract.${name}`), bytes);
    const { headings, isCut, bookmarks } = await generate(format, bytes);
    writeContract(`toc_contract_${name}.json`,
        buildContract(bytes, headings, isCut, { headings, isCut, bookmarks }));
}

/**
 * Writes the book `<name>.epub` and `<name>_epub.json`: its entries as the EPUB format reads them,
 * with `isShown: false` on those that the preview does not show, and the ids of the entries.
 */
async function writeEpubContract(name: string, bytes: Uint8Array) {
    writeFileSync(join(fixturesDir, `${name}.epub`), bytes);
    const { raw, headings, isCut } = await generate(epubTocFormat as TocFormat, bytes);
    writeContract(`${name}_epub.json`,
        buildContract(bytes, headings, isCut, { headings: raw, isCut }));
}

/**
 * What the generator of `format` reads from `bytes`: the headings as it writes them (`raw`), their
 * titles and levels, and the bookmarks of an office format.
 */
async function generate(format: TocFormat, bytes: Uint8Array) {
    if (!format.generator) {
        throw new Error(`The format '${format.name}' has no generator.`);
    }
    const { headings: raw, isCut = false, properties } = await format.generator(bytes);
    const headings = raw.map(({ title, level }) =>
        ({ title: String(title), level: Number(level) }));
    const { bookmarks } = properties ?? {};
    return { raw, headings, isCut, bookmarks: Array.isArray(bookmarks) ? bookmarks : [] };
}

function zip(files: Record<string, string | Uint8Array>, storedFirst?: string) {
    const toBytes = (content: string | Uint8Array) =>
        (typeof content === "string" ? strToU8(content) : content);
    const entries: Zippable = {};
    if (storedFirst) {
        entries[storedFirst] = [ toBytes(files[storedFirst]), { level: 0, mtime: MTIME } ];
    }
    for (const [ path, content ] of Object.entries(files)) {
        if (path !== storedFirst) {
            entries[path] = [ toBytes(content), { mtime: MTIME } ];
        }
    }
    return zipSync(entries);
}

/**
 * An EPUB 3 whose navigation document is in the spine, with its own heading and a hidden
 * `landmarks` navigation that are no entries. Its table of contents: a part without a target over
 * a whole chapter and its places (a heading, a section whose id the parser drops, two "Summary"
 * entries, a span in a paragraph, a fragment that is not there), "Exercises" in two chapters, an
 * entry titled by an image, an empty label whose child nests under the entry before it, an entry
 * and its child in a chapter that `encryption.xml` lists, a chapter without a heading, endnotes, a
 * part whose first chapter is encrypted, a table with a cell that two entries name, a row and the
 * table itself, and the targets of review #5: an image, a rule, a hyperlink, a span in a hyperlink
 * and a page break. Its chapters hold `<h2` as text in `<pre>`, `<script>`, `<style>` and a
 * comment, and a deflated picture is in the archive.
 */
function buildContractEpub() {
    const nav = navItems([
        [ "<span>Part One</span>", [
            [ "<a href=\"ch1.xhtml\">Chapter 1</a>", [
                link("ch1.xhtml#scope", "Scope"), link("ch1.xhtml#background", "Background"),
                link("ch1.xhtml#summary-1", "Summary"), link("ch1.xhtml#summary-2", "Summary"),
                link("ch1.xhtml#note", "A note"), link("ch1.xhtml#missing", "Missing"),
                link("ch1.xhtml#exercises", "Exercises")
            ] ],
            [ "<a href=\"ch2.xhtml\">Chapter 2</a>", [
                link("ch2.xhtml#exercises", "Exercises"),
                [ "<a href=\"ch2.xhtml#figure\"><img src=\"fig.png\" alt=\"Figure 1\"/></a>" ],
                [ "<a href=\"ch2.xhtml#empty\"> </a>", [ link("ch2.xhtml#moved", "Moved up") ] ],
                [ "<a href=\"locked.xhtml\">Locked</a>", [ link("locked.xhtml#inside", "Inside") ] ]
            ] ]
        ] ],
        link("dedication.xhtml", "Dedication"),
        link("endnotes.xhtml", "Endnotes"),
        [ "<span>Part Two</span>", [ link("sealed.xhtml", "Sealed"), link("open.xhtml", "Open") ] ],
        [ "<a href=\"tables.xhtml\">Tables</a>", [
            link("tables.xhtml#cell", "Cell"), link("tables.xhtml#cell", "Same cell"),
            link("tables.xhtml#row4", "Row four"), link("tables.xhtml#table", "The table")
        ] ],
        [ "<a href=\"kinds.xhtml\">Kinds</a>", [
            link("kinds.xhtml#cover", "Cover"), link("kinds.xhtml#rule", "Rule"),
            link("kinds.xhtml#ref", "A link"), link("kinds.xhtml#inner", "Inside a link"),
            link("kinds.xhtml#p45", "Page 45")
        ] ]
    ]);
    const chapters: Record<string, string> = {
        "ch1.xhtml": "<h1>Chapter 1</h1><h2 id=\"scope\">Scope</h2>"
            + "<section id=\"background\"><h2>Background</h2><p>Text.</p></section>"
            + "<h2 id=\"summary-1\">Summary</h2><p>A <span id=\"note\">noted</span> word.</p>"
            + "<h2 id=\"summary-2\">Summary</h2><h2 id=\"exercises\">Exercises</h2>"
            + "<pre>&lt;h2&gt;Not a heading</pre><script>var tag = \"<h2>\";</script>"
            + "<style>p::before { content: \"<h2>\"; }</style>"
            + "<!-- <h2 id=\"scope\">A comment</h2> -->",
        "ch2.xhtml": "<h1>Chapter 2</h1><h2 id=\"exercises\">Exercises</h2>"
            + "<figure id=\"figure\"><img src=\"fig.png\" alt=\"Figure 1\"/></figure>"
            + "<p id=\"empty\">An empty label</p><h3 id=\"moved\">Moved up</h3>",
        "locked.xhtml": "<h1>Locked</h1><p id=\"inside\">Inside</p>",
        "dedication.xhtml": "<p>To the reader.</p>",
        "endnotes.xhtml": "<section epub:type=\"endnotes\" role=\"doc-endnotes\"><h2>Endnotes</h2>"
            + "<ol><li id=\"note-1\"><p>A note.</p></li></ol></section>",
        "sealed.xhtml": "<h1>Sealed</h1>",
        "open.xhtml": "<h1>Open</h1>",
        "tables.xhtml": "<h2>Trilium Toc 0</h2><table id=\"table\"><tr><td>One</td></tr>"
            + "<tr><td>Two</td></tr><tr><td id=\"cell\">Three</td></tr>"
            + "<tr id=\"row4\"><td>Four</td></tr></table>",
        "kinds.xhtml": "<p>Intro</p><img id=\"cover\" src=\"fig.png\" alt=\"Cover\"/>"
            + "<h2>After the cover</h2><p>See <a id=\"ref\" href=\"#end\">the end</a>.</p>"
            + "<p>Go <a href=\"#end\">to <span id=\"inner\">here</span></a>.</p>"
            + "<hr id=\"rule\"/><p>After the rule</p>"
            + "<p>Page <span id=\"p45\" epub:type=\"pagebreak\" title=\"45\"/>break</p>"
            + "<p id=\"end\">The end</p>"
    };
    const navigation = xhtmlDocument("<h1>Contents</h1>"
        + `<nav epub:type="toc"><h2>Table of contents</h2><ol>${nav}</ol></nav>`
        + "<nav epub:type=\"landmarks\" hidden=\"\"><h2>Guide</h2><ol>"
        + "<li><a epub:type=\"bodymatter\" href=\"ch1.xhtml\">Start</a></li></ol></nav>");
    return buildEpub3(chapters, navigation, [ "locked.xhtml", "sealed.xhtml" ]);
}

/**
 * An EPUB 2 with an NCX of nested `navPoint`s, whose chapters title themselves with a paragraph
 * and a `<div>`, an entry aimed at a `<span>`, and a chapter with an `id` that the marker prefix
 * `trilium_toc_` starts, so the markers start `trilium_toc2_`.
 */
function buildContractNcxEpub() {
    const point = (id: string, title: string, src: string, children = "") =>
        `<navPoint id="${id}"><navLabel><text>${title}</text></navLabel><content src="${src}"/>`
        + `${children}</navPoint>`;
    const ncx = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>"
        + "<ncx xmlns=\"http://www.daisy.org/z3986/2005/ncx/\" version=\"2005-1\"><head/>"
        + "<docTitle><text>Contract book</text></docTitle><navMap>"
        + point("n1", "Chapter One", "c1.xhtml", point("n2", "First section", "c1.xhtml#s1"))
        + point("n3", "Chapter Two", "c2.xhtml", point("n4", "A span", "c2.xhtml#sp"))
        + point("n5", "Chapter Three", "c3.xhtml")
        + "</navMap></ncx>";
    const chapters: Record<string, string> = {
        "c1.xhtml": "<p class=\"chapter-title\"><b>Chapter One</b></p>"
            + "<p id=\"s1\">First section</p>",
        "c2.xhtml": "<div class=\"title\">Chapter Two</div>"
            + "<p>Text with <span id=\"sp\">a span</span>.</p>",
        "c3.xhtml": "<p id=\"trilium_toc_0\">Chapter Three</p>"
    };
    const names = Object.keys(chapters);
    return zip({
        mimetype: EPUB_MIME_TYPES[0],
        "META-INF/container.xml": CONTAINER,
        "OEBPS/content.opf": packageDocument("2.0",
            names.map((name, index) => manifestItem(`c${index}`, name)).join("")
                + "<item id=\"ncx\" href=\"toc.ncx\" media-type=\"application/x-dtbncx+xml\"/>",
            " toc=\"ncx\"", names.map((_, index) => `<itemref idref="c${index}"/>`).join("")),
        "OEBPS/toc.ncx": ncx,
        ...Object.fromEntries(names.map((name) =>
            [ `OEBPS/${name}`, xhtmlDocument(chapters[name]) ]))
    }, "mimetype");
}

/**
 * The books of reviews #6 and #7 as one, each case under an id of its own: three sections whose
 * ids the parser drops, matched by a heading's id in another chapter, by a later heading of their
 * own chapter, and by a named anchor in another chapter, and a target that only `<a name>` names.
 */
function buildContractIdsEpub() {
    const nav = navItems([
        link("c1.xhtml#sec", "Section"), link("c1.xhtml#introduction", "Introduction"),
        link("c1.xhtml#legacy", "Legacy"), link("c4.xhtml#chap01", "Chapter I")
    ]);
    return buildEpub3({
        "c1.xhtml": "<section id=\"sec\"><h2>Heading of chapter 1</h2><p>Text</p></section>"
            + "<section id=\"introduction\"><p>An epigraph</p><h2>Introduction</h2></section>"
            + "<section id=\"legacy\"><h2>Legacy</h2><p>Text</p></section>",
        "c2.xhtml": "<h2 id=\"sec\">Another chapter's heading</h2>",
        "c3.xhtml": "<a name=\"legacy\"></a><p>A named anchor</p>",
        "c4.xhtml": "<p>Before</p><h2><a name=\"chap01\"></a>CHAPTER I.</h2><p>Text</p>"
    }, xhtmlDocument(`<nav epub:type="toc"><ol>${nav}</ol></nav>`), []);
}

type NavItem = [ label: string, children?: NavItem[] ];

function link(href: string, title: string): NavItem {
    return [ `<a href="${href}">${title}</a>` ];
}

function navItems(items: NavItem[]): string {
    return items.map(([ label, children ]) =>
        `<li>${label}${children ? `<ol>${navItems(children)}</ol>` : ""}</li>`).join("");
}

function xhtmlDocument(body: string) {
    return "<?xml version=\"1.0\" encoding=\"UTF-8\"?><!DOCTYPE html>"
        + "<html xmlns=\"http://www.w3.org/1999/xhtml\" "
        + "xmlns:epub=\"http://www.idpf.org/2007/ops\">"
        + `<head><title>Contract book</title></head><body>${body}</body></html>`;
}

function manifestItem(id: string, href: string, properties = "") {
    return `<item id="${id}" href="${href}" media-type="application/xhtml+xml"${properties}/>`;
}

function packageDocument(
    version: string, manifest: string, spineAttributes: string, spine: string
) {
    return "<?xml version=\"1.0\" encoding=\"UTF-8\"?>"
        + `<package xmlns="http://www.idpf.org/2007/opf" version="${version}" `
        + "unique-identifier=\"id\"><metadata xmlns:dc=\"http://purl.org/dc/elements/1.1/\">"
        + "<dc:identifier id=\"id\">contract</dc:identifier><dc:title>Contract book</dc:title>"
        + "<dc:language>en</dc:language></metadata>"
        + `<manifest>${manifest}</manifest><spine${spineAttributes}>${spine}</spine></package>`;
}

/**
 * An EPUB 3 of `chapters`, in that order in the spine after its navigation document `navigation`
 * (`linear="no"`), with a picture, and `encryption.xml` listing the chapters of `encrypted`.
 */
function buildEpub3(chapters: Record<string, string>, navigation: string, encrypted: string[]) {
    const names = Object.keys(chapters);
    const picture = Uint8Array.from({ length: 4096 }, (_, index) => (index * 31) % 7);
    const encryption = "<?xml version=\"1.0\"?>"
        + "<encryption xmlns=\"urn:oasis:names:tc:opendocument:xmlns:container\" "
        + "xmlns:enc=\"http://www.w3.org/2001/04/xmlenc#\">"
        + encrypted.map((name) => "<enc:EncryptedData><enc:EncryptionMethod "
            + "Algorithm=\"http://www.w3.org/2001/04/xmlenc#aes256-cbc\"/><enc:CipherData>"
            + `<enc:CipherReference URI="OEBPS/${name}"/></enc:CipherData></enc:EncryptedData>`)
            .join("")
        + "</encryption>";
    return zip({
        mimetype: EPUB_MIME_TYPES[0],
        "META-INF/container.xml": CONTAINER,
        ...(encrypted.length > 0 ? { "META-INF/encryption.xml": encryption } : {}),
        "OEBPS/content.opf": packageDocument("3.0",
            manifestItem("nav", "nav.xhtml", " properties=\"nav\"")
                + names.map((name, index) => manifestItem(`c${index}`, name)).join("")
                + "<item id=\"fig\" href=\"fig.png\" media-type=\"image/png\"/>",
            "", "<itemref idref=\"nav\" linear=\"no\"/>"
                + names.map((_, index) => `<itemref idref="c${index}"/>`).join("")),
        "OEBPS/nav.xhtml": navigation,
        "OEBPS/fig.png": picture,
        ...Object.fromEntries(names.map((name) =>
            [ `OEBPS/${name}`, xhtmlDocument(chapters[name]) ]))
    }, "mimetype");
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
