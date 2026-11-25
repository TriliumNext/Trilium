import { DOCX_MIME, ODT_MIME } from "@triliumnext/commons";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

import { buildNote } from "../test/becca_easy_mocking.js";
import { getContext } from "./context.js";
import { cleanDocumentHtml, convertDocumentNoteToText } from "./document_conversion.js";
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
