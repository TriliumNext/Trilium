import "@triliumnext/commons/src/lib/spreadsheet/exceljs_augmentation.js";

import { toArrayBuffer } from "@triliumnext/commons/src/lib/spreadsheet/parse_from_xlsx.js";
import ExcelJS from "exceljs";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { ValidationError } from "../errors.js";
import { convertOfficeToHtml } from "./office_preview.js";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

describe("convertOfficeToHtml", () => {
    it("refuses a document above the preview size limit", async () => {
        const tooLarge = new Uint8Array(20 * 1024 * 1024 + 1);

        const conversion = convertOfficeToHtml(tooLarge, "application/rtf");
        await expect(conversion).rejects.toBeInstanceOf(ValidationError);
        await expect(conversion).rejects.toThrow("Office document is too large to preview (20971521 bytes).");
    });

    it("lets officeparser detect the format of a DOCX, which has no file type hint", async () => {
        expect(await convertOfficeToHtml(buildDocx("Hello from Word"), DOCX_MIME)).toContain("Hello from Word");
    });

    it("hands a file labeled as a workbook that exceljs cannot open to officeparser", async () => {
        const rtf = String.raw`{\rtf1\ansi Hello {\b World}}`;

        expect(await convertOfficeToHtml(rtf, XLSX_MIME)).toContain("World");
    });

    it("hands a DOCX labeled as a workbook to officeparser instead of rendering an empty sheet", async () => {
        const html = await convertOfficeToHtml(buildDocx("Hello from Word"), XLSX_MIME);

        expect(html).toContain("Hello from Word");
        expect(html).not.toContain("Empty spreadsheet.");
    });

    it("renders a workbook without sheets through the spreadsheet pipeline", async () => {
        expect(await convertOfficeToHtml(buildXlsx("<sheets/>"), XLSX_MIME)).toBe("<p>Empty spreadsheet.</p>");
    });

    it("hands a workbook that exceljs cannot parse to officeparser", async () => {
        const conversion = convertOfficeToHtml(buildXlsx("<sheets>"), XLSX_MIME);

        await expect(conversion).resolves.not.toContain("Empty spreadsheet.");
    });

    it("loads the patched exceljs, which keeps a validation range as one entry (#11228)", async () => {
        // Both runners load exceljs's `lib/` through Node, so this checks `patches/exceljs@4.4.0.patch`
        // is applied there. An unpatched exceljs expands the range into 65,536 entries.
        const wb = new ExcelJS.Workbook();
        wb.addWorksheet("S").getCell("A1").dataValidation = { type: "list", formulae: [ '"a,b"' ] };
        const files = unzipSync(new Uint8Array(await wb.xlsx.writeBuffer()));
        const sheet = strFromU8(files["xl/worksheets/sheet1.xml"]);
        if (!sheet.includes('sqref="A1"')) throw new Error("validation fixture missing");
        files["xl/worksheets/sheet1.xml"] = strToU8(sheet.replace('sqref="A1"', 'sqref="A1:A65536"'));

        const loaded = new ExcelJS.Workbook();
        await loaded.xlsx.load(toArrayBuffer(zipSync(files)));
        expect(Object.keys(loaded.worksheets[0].dataValidations.model)).toEqual([ "A1:A65536" ]);
    });
});

/** Builds the smallest DOCX package officeparser reads: one paragraph holding `text`. */
function buildDocx(text: string) {
    return zipSync({
        "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`),
        "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`),
        "word/document.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body>
</w:document>`)
    });
}

/** Builds a spreadsheet package whose `xl/workbook.xml` holds `sheets` as its sheet list. */
function buildXlsx(sheets: string) {
    return zipSync({
        "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
</Types>`),
        "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`),
        "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${sheets}</workbook>`)
    });
}
