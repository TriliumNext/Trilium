import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { readDocxTableLayouts, type TableLayout } from "./docx_table_layout.js";

describe("readDocxTableLayouts", () => {
    it("reads the borders and padding of the table style, the cell and the paragraph defaults", () => {
        const layouts = readDocxTableLayouts(docx({
            "word/document.xml": `<w:document><w:body>${BODY}</w:body></w:document>`,
            "word/styles.xml": STYLES
        }));

        expect(layouts.map((layout) => layout.columnWidths)).toEqual([ [ 2000, 0 ], [] ]);
        expect(cellStyles(layouts[0], 0, 0)).toEqual({
            "border-style": "double double dotted none",
            "border-width": "0.25pt 0.5pt 1pt 0pt",
            "border-color": "#000000 #00FF00 #FF0000 #000000",
            padding: "6pt 5.4pt 8pt 0pt",
            "vertical-align": "top"
        });
        expect(cellStyles(layouts[0], 0, 1)).toMatchObject({
            "border-style": "double none dotted solid",
            "border-width": "0.25pt 0pt 1pt 0.5pt",
            padding: "0pt 5.4pt 0pt 5.4pt"
        });
        expect(cellStyles(layouts[1], 0, 0)).toMatchObject({
            "border-style": "dashed none dotted none",
            padding: "1pt 5.4pt 8pt 5.4pt"
        });
    });

    it("reads no tables from a file that is not a Word document or has no body", () => {
        expect(readDocxTableLayouts(new Uint8Array([ 1, 2, 3 ]))).toEqual([]);
        expect(readDocxTableLayouts(docx({ "word/styles.xml": STYLES }))).toEqual([]);
        expect(readDocxTableLayouts(docx({ "word/document.xml": "<w:document></w:document>" })))
            .toEqual([]);
    });
});

/**
 * A default table style based on a style the document lacks, beside a style without an id. Its
 * top border has neither a size nor a color, and its inner vertical borders no `w:val`.
 */
const STYLES = `<w:styles>`
    + `<w:docDefaults><w:pPrDefault><w:pPr><w:spacing w:before="20" w:after="160"/></w:pPr></w:pPrDefault></w:docDefaults>`
    + `<w:style w:type="paragraph"><w:name w:val="Nameless"/></w:style>`
    + `<w:style w:type="table" w:default="1" w:styleId="Grid"><w:basedOn w:val="Gone"/><w:tblPr><w:tblBorders>`
    + `<w:top w:val="double" w:color="auto"/><w:left w:val="nil"/>`
    + `<w:bottom w:val="dotted" w:sz="8" w:color="FF0000"/><w:insideV w:sz="4"/>`
    + `</w:tblBorders></w:tblPr></w:style>`
    + `</w:styles>`;

const paragraph = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

/**
 * A row inside a content control and a cell inside custom XML, among whitespace, and a content
 * control without content. The second cell holds only a table, whose cell has a dashed top.
 */
const BODY = `<w:tbl>
    <w:tblGrid><w:gridCol w:w="2000"/><w:gridCol/></w:tblGrid>
    <w:sdt><w:sdtContent><w:tr>
        <w:tc><w:tcPr><w:tcMar><w:top w:w="100"/><w:left w:w="0" w:type="nil"/><w:right w:w="50" w:type="pct"/>`
    + `<w:bottom w:type="dxa"/></w:tcMar>`
    + `<w:tcBorders><w:right w:val="triple" w:sz="4" w:color="00FF00"/></w:tcBorders></w:tcPr>${paragraph("A")}</w:tc>
        <w:customXml><w:tc><w:tbl><w:tr><w:tc>`
    + `<w:tcPr><w:tcBorders><w:top w:val="dashSmallGap"/></w:tcBorders></w:tcPr>${paragraph("Nested")}`
    + `</w:tc></w:tr></w:tbl></w:tc></w:customXml>
    </w:tr></w:sdtContent></w:sdt>
    <w:sdt><w:sdtPr/></w:sdt>
</w:tbl>`;

function docx(files: Record<string, string>) {
    return zipSync(Object.fromEntries(
        Object.entries(files).map(([ path, xml ]) => [ path, strToU8(xml) ])));
}

function cellStyles(layout: TableLayout, row: number, column: number) {
    return Object.fromEntries(layout.rows[row][column]);
}
