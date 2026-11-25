import { DOCX_MIME } from "@triliumnext/commons";
import {
    Document, Footer, HeadingLevel, ImageRun, Packer, Paragraph, TextRun
} from "docx";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { getContext } from "../context.js";
import noteService from "../notes.js";
import { renderTextNoteToDocx } from "./docx.js";
import { prepareDocxTemplate, readDocxBodyFontSize } from "./docx_template.js";

/** A 1×1 PNG. */
const PNG = new Uint8Array([
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1,
    8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 218, 99, 252, 207,
    192, 80, 15, 0, 4, 133, 1, 128, 132, 169, 140, 33, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66,
    96, 130
]);

/**
 * A filled-in form: a 9.5pt body, teal headings, a footer and a landscape page, with a picture and
 * text in its body, and without a numbering part, as Word saves a document that has no lists.
 */
async function buildTemplate() {
    const picture = new ImageRun({
        type: "png", data: PNG, transformation: { width: 9, height: 9 }
    });
    const docx = await Packer.pack(new Document({
        styles: {
            default: {
                document: { run: { size: 19 } },
                heading2: { run: { color: "00425B", size: 26 } }
            }
        },
        sections: [ {
            properties: { page: { size: { orientation: "landscape" } } },
            footers: { default: new Footer({ children: [ new Paragraph("Form footer") ] }) },
            children: [
                new Paragraph({ text: "Last year's review", heading: HeadingLevel.HEADING_2 }),
                new Paragraph({ children: [ new TextRun("Old answers"), picture ] })
            ]
        } ]
    }), "uint8array");

    const files = unzipSync(docx);
    delete files["word/numbering.xml"];
    for (const path of [ "word/_rels/document.xml.rels", "[Content_Types].xml" ]) {
        files[path] = strToU8(strFromU8(files[path])
            .replace(/<(Relationship|Override)\b[^>]*numbering[^>]*\/>/g, ""));
    }
    return zipSync(files);
}

function readPart(docx: Uint8Array, path: string) {
    const part = unzipSync(docx)[path];
    return part ? strFromU8(part) : undefined;
}

describe("prepareDocxTemplate", () => {
    it("empties the body to the placeholder and page setup, dropping its pictures", async () => {
        const { data: shell, textWidth } = prepareDocxTemplate(await buildTemplate());

        const document = readPart(shell, "word/document.xml");
        const body = document?.match(/<w:body>([\s\S]*)<\/w:body>/)?.[1];
        expect(body).toMatch(
            /^<w:p><w:r><w:t>\{\{trilium_content\}\}<\/w:t><\/w:r><\/w:p><w:sectPr\b/);
        expect(body).toContain(`w:orient="landscape"`);
        expect(body).toContain("<w:footerReference");
        expect(body).not.toContain("Old answers");

        const files = Object.keys(unzipSync(shell));
        expect(files.filter((path) => path.startsWith("word/media/"))).toEqual([]);
        const relationships = readPart(shell, "word/_rels/document.xml.rels");
        expect(relationships).not.toContain("relationships/image");
        expect(readPart(shell, "word/styles.xml")).toContain(`w:styleId="TableText"`);
        expect(textWidth).toBe(16838 - 2 * 1440);
    });

    it("refuses a file that is not a Word document", () => {
        expect(() => prepareDocxTemplate(new Uint8Array([ 1, 2, 3 ]))).toThrow(
            expect.objectContaining({ name: "ValidationError" }));
    });
});

describe("readDocxBodyFontSize", () => {
    function docxWithStyles(styles: string) {
        return zipSync({ "word/styles.xml": strToU8(`<w:styles>${styles}</w:styles>`) });
    }

    it("reads the Normal style, then the document defaults, then Word's own size", () => {
        const defaults = `<w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="19"/></w:rPr>`
            + `</w:rPrDefault></w:docDefaults>`;
        const normal = (properties: string) =>
            `<w:style w:type="paragraph" w:styleId="Normal">${properties}</w:style>`;

        expect(readDocxBodyFontSize(docxWithStyles(defaults
            + normal(`<w:rPr><w:sz w:val="24"/></w:rPr>`)))).toBe(12);
        expect(readDocxBodyFontSize(docxWithStyles(defaults
            + normal(`<w:name w:val="normal"/>`)))).toBe(9.5);
        expect(readDocxBodyFontSize(docxWithStyles(""))).toBe(10);
        expect(readDocxBodyFontSize(new Uint8Array([ 1, 2, 3 ]))).toBeUndefined();
    });
});

describe("renderTextNoteToDocx with a template", () => {
    let counter = 0;

    function createNotes(templateMime: string, templateContent: Uint8Array) {
        counter++;
        return getContext().init(() => {
            const template = noteService.createNewNote({
                parentNoteId: "root", title: `${counter}-Form.docx`, content: templateContent,
                type: "file", mime: templateMime
            }).note;
            const parent = noteService.createNewNote({
                parentNoteId: "root", title: `${counter}-Reviews`, content: "", type: "text"
            }).note;
            parent.addRelation("docxTemplate", template.noteId, true);
            const note = noteService.createNewNote({
                parentNoteId: parent.noteId, title: `${counter}-Review`, content: "", type: "text"
            }).note;
            return note;
        });
    }

    it("writes the note into the inherited template, with its styles, footer, sizes", async () => {
        const note = createNotes(DOCX_MIME, await buildTemplate());

        const docx = await renderTextNoteToDocx(note, `<h2>Strengths</h2>`
            + `<p><span class="text-huge">Annual review</span></p>`
            + `<ul><li>Ownership</li></ul><ol><li>First</li><li>Second</li></ol>`
            + `<figure class="table"><table><tbody><tr><td>Cell</td></tr></tbody></table>`
            + `</figure>`);

        const document = readPart(docx, "word/document.xml") ?? "";
        expect(document).not.toContain("Old answers");
        expect(document).not.toContain("trilium_content");
        expect(document).toMatch(/<w:pStyle w:val="Heading2"\/>.*Strengths/s);
        // 1.8 × the template's 9.5pt body, in half-points.
        expect(document).toMatch(/<w:sz w:val="34"\/>.*Annual review/s);
        expect(document).toMatch(/<w:pStyle w:val="TableText"\/>.*Cell/s);
        expect(document.match(/<w:numId w:val="\d+"\/>/g)).toHaveLength(3);
        expect(document).toContain(`w:orient="landscape"`);
        expect(document).toContain("<w:footerReference");

        expect(readPart(docx, "word/styles.xml")).toMatch(/w:styleId="Heading2".*?00425B/s);
        expect(readPart(docx, "word/numbering.xml")).toContain("<w:abstractNum ");
        expect(Object.values(unzipSync(docx)).some((part) =>
            strFromU8(part).includes("Form footer"))).toBe(true);
        expect(readPart(docx, "docProps/core.xml"))
            .toContain(`<dc:title>${counter}-Review</dc:title>`);
    });

    it("sizes tables against the width of the text on the template's page", async () => {
        const note = createNotes(DOCX_MIME, await buildTemplate());

        const docx = await renderTextNoteToDocx(note,
            `<figure class="table"><table><tbody><tr><td>a</td><td>b</td></tr></tbody></table>`
            + `</figure><figure class="table" style="width:50%;"><table><tbody>`
            + `<tr><td>c</td></tr></tbody></table></figure>`);

        // A landscape A4 page with 1-inch margins leaves 16838 - 2 × 1440 twips for the text.
        const document = readPart(docx, "word/document.xml") ?? "";
        const tables = document.match(/<w:tbl>.*?<\/w:tbl>/gs) ?? [];
        expect(tables).toHaveLength(2);
        const [ full, half ] = tables.map((table) => ({
            width: table.match(/<w:tblW w:type="dxa" w:w="(\d+)"\/>/)?.[1],
            grid: [ ...table.matchAll(/<w:gridCol w:w="(\d+)"\/>/g) ]
                .reduce((sum, match) => sum + Number(match[1]), 0)
        }));
        expect(full).toEqual({ width: "13958", grid: 13958 });
        expect(half).toEqual({ width: "6979", grid: 6979 });
    });

    it("refuses a template that is not a Word document, whatever its content", async () => {
        const note = createNotes("application/pdf", await buildTemplate());

        await expect(renderTextNoteToDocx(note, "<p>x</p>"))
            .rejects.toThrow(/is not a Word document/);
    });
});
