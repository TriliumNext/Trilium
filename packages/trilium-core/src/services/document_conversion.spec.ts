import { DOCX_MIME, ODT_MIME } from "@triliumnext/commons";
import { Document, Packer, Paragraph, Table, TableCell, TableRow, TextRun } from "docx";
import { strToU8, zipSync } from "fflate";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

import { buildNote } from "../test/becca_easy_mocking.js";
import { getContext } from "./context.js";
import {
    cleanDocumentHtml, convertDocumentNoteToText, readDocxBodyFontSize
} from "./document_conversion.js";
import { renderTextNoteToDocx } from "./export/docx.js";
import noteService from "./notes.js";

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

describe("readDocxBodyFontSize", () => {
    function docxWithStyles(styles: string) {
        return zipSync({ "word/styles.xml": strToU8(`<w:styles>${styles}</w:styles>`) });
    }

    it("reads the Normal style, then the document defaults, then Word's own size", () => {
        const defaults = `<w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="19"/></w:rPr></w:rPrDefault></w:docDefaults>`;

        expect(readDocxBodyFontSize(docxWithStyles(defaults
            + `<w:style w:type="paragraph" w:styleId="Normal"><w:rPr><w:sz w:val="24"/></w:rPr></w:style>`))).toBe(12);
        expect(readDocxBodyFontSize(docxWithStyles(defaults
            + `<w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="normal"/></w:style>`))).toBe(9.5);
        expect(readDocxBodyFontSize(docxWithStyles(""))).toBe(10);
        expect(readDocxBodyFontSize(new Uint8Array([ 1, 2, 3 ]))).toBeUndefined();
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
        expect(content).toMatch(/<figure class="table"><table>.*<td style="background-color:#BCD9F5;--tn-background:#BCD9F5">/s);
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
        expect(content).toMatch(/<td colspan="2"><p>Notes<\/p>/);
        expect(content.match(/<td/g)).toHaveLength(7);
    });

    it("converts an OpenDocument text, with its top heading demoted below the note's title", async () => {
        const note = createFileNote(ODT_MIME, new Uint8Array(fs.readFileSync(path.join(FIXTURES, "toc_contract.odt"))),
            "Contract.odt");

        await getContext().init(() => convertDocumentNoteToText(note));

        expect(note.type).toBe("text");
        expect(String(note.getContent())).toContain("<h2>Contract document</h2>");
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
