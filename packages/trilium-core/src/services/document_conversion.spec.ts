import { DOCX_MIME, ODT_MIME } from "@triliumnext/commons";
import {
    BorderStyle, Document, HeightRule, Packer, PageBreak, Paragraph, Table, TableCell, TableRow,
    TextRun, VerticalAlignTable
} from "docx";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

import { buildNote } from "../test/becca_easy_mocking.js";
import { getContext } from "./context.js";
import { cleanDocumentHtml, convertDocumentNoteToText } from "./document_conversion.js";
import { readDocxTableLayouts } from "./docx_table_layout.js";
import { renderTextNoteToDocx } from "./export/docx.js";
import noteService from "./notes.js";
import { convertOfficeToHtml } from "./office_preview.js";
import { sanitizeHtml } from "./sanitizer.js";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "toc", "fixtures");

/** A 1×1 PNG. */
const PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("cleanDocumentHtml", () => {
    it("keeps the colors and alignment of a note and drops the styles of the word processor", () => {
        const html = cleanDocumentHtml(`<div class="container">`
            + `<h2 id="x"><span style="color: #2E74B5">Feedback</span></h2>`
            + `<p style="text-align: left; margin-top: 0pt; line-height: 1.15">Overall: `
            + `<span style="color: #138613; font-family: Calibri, sans-serif"><b>strong</b></span> and `
            + `<mark data-color="#E6E64C" style="background-color: #E6E64C">estimates</mark>, see `
            + `<a href="https://example.com"><span style="color: #000080"><u>the wiki</u></span></a> and `
            + `<a href="https://example.org"><span style="color: #C00000">the form</span></a>.</p>`
            + `<p style="text-align: center">Centered</p>`
            + `<div class="table-container"><table><tr><td style="background-color: #BCD9F5"><p>Cell</p></td></tr></table></div>`
            + `<ol><li value="1" style="text-align: left">Item</li></ol></div>`);

        expect(html).toBe(`<h2 id="x">Feedback</h2>`
            + `<p>Overall: <span style="color:#138613;--tn-color:#138613;"><b>strong</b></span> and `
            + `<span style="background-color:#E6E64C;--tn-background:#E6E64C;">estimates</span>, see `
            + `<a href="https://example.com">the wiki</a> and `
            + `<a href="https://example.org"><span style="color:#C00000;--tn-color:#C00000;">the form</span></a>.</p>`
            + `<p style="text-align:center;">Centered</p>`
            + `<figure class="table"><table><tr><td style="background-color:#BCD9F5;--tn-background:#BCD9F5;"><p>Cell</p></td></tr></table></figure>`
            + `<ol><li>Item</li></ol>`);
    });

    it("gives a size relative to the body text the editor's nearest font size", () => {
        const html = cleanDocumentHtml(`<p><span style="font-size: 20pt"><b>Title</b></span> `
            + `<span style="font-size: 10.5pt">body</span> <span style="font-size: 8.5pt">small</span> `
            + `<span style="font-size: 6pt">tiny</span> <span style="font-size: 18px">big</span></p>`
            + `<h2><span style="font-size: 13pt">Heading</span></h2>`, { bodyFontSize: 9.5 });

        expect(html).toBe(`<p><span class="text-huge"><b>Title</b></span> body `
            + `<span class="text-small">small</span> <span class="text-tiny">tiny</span> `
            + `<span class="text-big">big</span></p><h2>Heading</h2>`);
    });

    it("gives the last cell of a padded row the rest of the row, but not a row under a rowspan", () => {
        const html = cleanDocumentHtml(`<table>`
            + `<tr><td>a</td><td>b</td><td>notes</td><td></td></tr>`
            + `<tr><td><p class="empty-paragraph"><br></p></td><td>c</td><td>d</td><td>e</td></tr>`
            + `<tr><td>f</td><td><p class="empty-paragraph"><br></p></td><td></td><td> </td></tr>`
            + `</table>`
            + `<table><tr><td rowspan="2">merged</td><td>f</td></tr><tr><td>g</td></tr></table>`);

        expect(html).toBe(`<figure class="table"><table>`
            + `<tr><td>a</td><td>b</td><td colspan="2">notes</td></tr>`
            + `<tr><td><p class="empty-paragraph"><br></p></td><td>c</td><td>d</td><td>e</td></tr>`
            + `<tr><td>f</td><td colspan="3"><p class="empty-paragraph"><br></p></td></tr>`
            + `</table></figure>`
            + `<figure class="table"><table><tr><td rowspan="2">merged</td><td>f</td></tr>`
            + `<tr><td>g</td></tr></table></figure>`);
    });
});

describe("table layout", () => {
    /** A Word document of `body`, with no styles of its own. */
    function docxWithBody(body: string) {
        return zipSync({ "word/document.xml": strToU8(`<w:document><w:body>${body}</w:body></w:document>`) });
    }

    const cell = (properties: string, text: string) =>
        `<w:tc><w:tcPr>${properties}</w:tcPr><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;

    it("skips the cells that continue a merge, and leaves tables alone when they don't match", () => {
        const docx = docxWithBody(`<w:tbl><w:tblGrid><w:gridCol w:w="1000"/><w:gridCol w:w="1000"/></w:tblGrid>`
            + `<w:tr>${cell(`<w:vMerge w:val="restart"/><w:vAlign w:val="bottom"/>`, "A")}${cell("", "B")}</w:tr>`
            + `<w:tr>${cell("<w:vMerge/>", "")}${cell(`<w:vAlign w:val="center"/>`, "C")}</w:tr></w:tbl>`);
        const merged = `<table><tr><td rowspan="2">A</td><td>B</td></tr><tr><td>C</td></tr></table>`;
        const tableLayouts = readDocxTableLayouts(docx);

        const html = cleanDocumentHtml(merged, { tableLayouts });
        expect(html).toMatch(/<td rowspan="2" style="[^"]*vertical-align:bottom;[^"]*">A/);
        expect(html).toMatch(/<td style="[^"]*vertical-align:middle;[^"]*">C/);

        const unmatched = cleanDocumentHtml(merged + merged, { tableLayouts });
        expect(unmatched).not.toContain("vertical-align");
        expect(unmatched).not.toContain("colgroup");
    });
});

describe("page breaks", () => {
    it("writes the editor's page break for the document's, but not for the rule above its notes", () => {
        const html = cleanDocumentHtml(`<p>one</p><hr class="page-break"><p>two</p>`
            + `<div class="document-notes-section"><hr class="page-break"><p>A note.</p></div>`);

        expect(html).toBe(`<p>one</p><div class="page-break" style="page-break-after:always;"></div><p>two</p>`
            + `<div class="document-notes-section"><hr class="page-break"><p>A note.</p></div>`);
    });

    it("keeps a page break the author typed, but not where Word last broke the pages", async () => {
        const docx = await Packer.pack(new Document({ sections: [ { children: [
            new Paragraph({ children: [ new TextRun("one"), new PageBreak() ] }),
            new Paragraph("two and three")
        ] } ] }), "uint8array");
        // Word records where it broke the pages at its last save, here inside the second paragraph.
        const files = unzipSync(docx);
        files["word/document.xml"] = strToU8(strFromU8(files["word/document.xml"])
            .replace(`<w:t xml:space="preserve">two and three</w:t>`,
                `<w:t xml:space="preserve">two and </w:t><w:lastRenderedPageBreak/><w:t xml:space="preserve">three</w:t>`));

        const html = sanitizeHtml(cleanDocumentHtml(
            await convertOfficeToHtml(zipSync(files), DOCX_MIME, { pageBreaks: true })));

        expect(html.replace(/\s+</g, "<")).toContain(`<p>one</p>`
            + `<div class="page-break" style="page-break-after:always"></div><p>two and three</p>`);
        expect(html).not.toContain("<br");
    });
});

describe("convertDocumentNoteToText", () => {
    let counter = 0;

    function createFileNote(mime: string, content: Uint8Array, title: string) {
        counter++;
        return getContext().init(() => noteService.createNewNote({
            parentNoteId: "root",
            title: `${counter}-${title}`,
            content,
            type: "file",
            mime
        }).note);
    }

    it("turns a Word document into a text note with its colors, tables and pictures", async () => {
        const docx = await renderTextNoteToDocx(buildNote({ type: "text", title: "Feedback" }),
            `<h2>Feedback</h2>`
            + `<p>Overall: <span style="color:hsl(120, 75%, 30%);"><strong>strong quarter</strong></span></p>`
            + `<figure class="table"><table><tbody><tr><td style="background-color:hsl(210, 75%, 85%);">Strengths</td>`
            + `<td><ul><li>Ownership</li></ul></td></tr></tbody></table></figure>`
            + `<p><img src="${PNG_DATA_URL}"></p>`);
        const note = createFileNote(DOCX_MIME, docx, "Feedback.docx");

        await getContext().init(() => convertDocumentNoteToText(note));

        expect(note.type).toBe("text");
        expect(note.mime).toBe("text/html");
        expect(note.title).toBe(`${counter}-Feedback`);

        const content = String(note.getContent());
        expect(content).toContain(">Feedback</h2>");
        expect(content).toContain(`<span style="color:#138613;--tn-color:#138613"><b>strong quarter</b></span>`);
        expect(content).toMatch(/<figure class="table"><table[^>]*>.*<td style="background-color:#BCD9F5;--tn-background:#BCD9F5[;"]/s);
        expect(content).toMatch(/<ul>\s*<li>Ownership<\/li><\/ul>/);
        expect(content).not.toContain("data:image");
        const [ picture ] = note.getAttachments();
        expect(picture?.role).toBe("image");
        expect(content).toContain(`src="api/attachments/${picture?.attachmentId}/image/`);

        const revision = note.getRevisions().at(-1);
        expect(revision?.type).toBe("file");
        expect(revision?.mime).toBe(DOCX_MIME);
        expect(revision?.title).toBe(`${counter}-Feedback.docx`);
        expect(new Uint8Array(revision?.getContent() as Uint8Array)).toEqual(docx);
    });

    it("keeps a row whose last cell reaches the end of the table, and the sizes of the text", async () => {
        // A row with fewer cells than the grid, as Google Docs writes one, and a 20pt run on a
        // document whose body is Word's default 10pt.
        const cell = (text: string) => new TableCell({ children: [ new Paragraph(text) ] });
        const table = new Table({ columnWidths: [ 2000, 2000, 2000, 2000 ], rows: [
            new TableRow({ children: [ cell("Grade"), cell("Outcome"), cell("Notes") ] }),
            new TableRow({
                children: [ cell("Signature"), cell("Date"), cell("Owner"), cell("Date") ]
            })
        ] });
        const title = new Paragraph({
            children: [ new TextRun({ text: "Annual review", size: 40 }) ]
        });
        const document = new Document({ sections: [ { children: [ title, table ] } ] });
        const docx = await Packer.pack(document, "uint8array");
        const note = createFileNote(DOCX_MIME, docx, "Evaluation.docx");

        await getContext().init(() => convertDocumentNoteToText(note));

        const content = String(note.getContent());
        expect(content).toContain(`<span class="text-huge">Annual review</span>`);
        expect(content).toMatch(/<td colspan="2"[^>]*><p>Notes<\/p>/);
        expect(content.match(/<td/g)).toHaveLength(7);
    });

    it("keeps the borders, padding, alignment, heights and column widths of a Word table", async () => {
        const border = { style: BorderStyle.SINGLE, size: 6, color: "B9D5DD" };
        const table = new Table({
            columnWidths: [ 2000, 6000 ],
            borders: {
                top: border, bottom: border, left: border, right: border,
                insideHorizontal: border, insideVertical: border
            },
            margins: { top: 0, bottom: 0, left: 115, right: 115 },
            rows: [
                new TableRow({
                    height: { value: 504, rule: HeightRule.ATLEAST },
                    children: [
                        new TableCell({
                            verticalAlign: VerticalAlignTable.CENTER,
                            children: [ new Paragraph("Name") ]
                        }),
                        new TableCell({ children: [
                            new Paragraph("Alexandra"),
                            new Paragraph({ text: "Nemes", spacing: { after: 100 } })
                        ] })
                    ]
                }),
                new TableRow({ children: [
                    new TableCell({
                        borders: { bottom: { style: BorderStyle.DASHED, size: 12, color: "E64C4C" } },
                        children: [ new Paragraph("Role") ]
                    }),
                    new TableCell({ children: [ new Paragraph("Developer") ] })
                ] })
            ]
        });
        const docx = await Packer.pack(new Document({
            styles: { default: { document: { paragraph: { spacing: { after: 200 } } } } },
            sections: [ { children: [ table ] } ]
        }), "uint8array");
        const note = createFileNote(DOCX_MIME, docx, "Details.docx");

        await getContext().init(() => convertDocumentNoteToText(note));

        const content = String(note.getContent());
        expect(content).toMatch(/<table class="ck-table-resized"><colgroup>/);
        expect(content).toMatch(/<col style="width:25%"\s*\/?><col style="width:75%"\s*\/?>/);
        expect(cellStyles(content, "Name")).toEqual({
            "border-style": "solid",
            "border-width": "0.75pt",
            "border-color": "#B9D5DD",
            "--tn-border-color": "#B9D5DD",
            // 10pt after the cell's paragraph, from the document's defaults.
            padding: "0pt 5.75pt 10pt 5.75pt",
            "vertical-align": "middle",
            height: "25.2pt"
        });
        expect(cellStyles(content, "Alexandra")).toMatchObject({
            padding: "0pt 5.75pt 5pt 5.75pt", "vertical-align": "top", height: "25.2pt"
        });
        const role = cellStyles(content, "Role");
        expect(role).toMatchObject({
            "border-style": "solid solid dashed solid",
            "border-width": "0.75pt 0.75pt 1.5pt 0.75pt",
            "border-color": "#B9D5DD #B9D5DD #E64C4C #B9D5DD"
        });
        expect(role).not.toHaveProperty("--tn-border-color");
        expect(role).not.toHaveProperty("height");
    });

    it("converts an OpenDocument text, with its top heading demoted below the note's title", async () => {
        const note = createFileNote(ODT_MIME, new Uint8Array(fs.readFileSync(path.join(FIXTURES, "toc_contract.odt"))),
            "Contract.odt");

        await getContext().init(() => convertDocumentNoteToText(note));

        expect(note.type).toBe("text");
        expect(String(note.getContent())).toContain("<h2>Contract document</h2>");
    });

    it("leaves a note alone when its file is replaced while it converts", async () => {
        const docx = await renderTextNoteToDocx(buildNote({ type: "text", title: "Draft" }),
            "<p>First draft</p>");
        const replacement = await renderTextNoteToDocx(buildNote({ type: "text", title: "Draft" }),
            "<p>Second draft</p>");
        const note = createFileNote(DOCX_MIME, docx, "Draft.docx");

        const conversion = getContext().init(() => convertDocumentNoteToText(note));
        getContext().init(() => note.setContent(replacement));

        await expect(conversion).rejects.toThrow(
            expect.objectContaining({ name: "ValidationError" }));
        expect(note.type).toBe("file");
        expect(new Uint8Array(note.getContent() as Uint8Array)).toEqual(replacement);
        expect(note.getRevisions()).toHaveLength(0);
    });

    it("refuses notes that are not word-processing documents", async () => {
        const textNote = getContext().init(() => noteService.createNewNote({
            parentNoteId: "root", title: "Text", content: "<p>x</p>", type: "text"
        }).note);
        const pdfNote = createFileNote("application/pdf", new Uint8Array([ 37, 80, 68, 70 ]), "Paper.pdf");

        for (const note of [ textNote, pdfNote ]) {
            await expect(getContext().init(() => convertDocumentNoteToText(note))).rejects.toThrow(
                expect.objectContaining({ name: "ValidationError" }));
        }
        expect(pdfNote.type).toBe("file");
    });
});

/** The inline styles of the table cell of `html` whose text starts with `text`. */
function cellStyles(html: string, text: string) {
    const style = html.match(new RegExp(`<td[^>]*?style="([^"]*)"[^>]*>(?:<[^>]+>)*${text}`))?.[1];
    expect(style).toBeDefined();
    return Object.fromEntries((style ?? "").split(";").filter(Boolean).map((declaration) => {
        const separator = declaration.indexOf(":");
        return [ declaration.slice(0, separator).trim(), declaration.slice(separator + 1).trim() ];
    }));
}
