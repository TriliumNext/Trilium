import { strToU8, zipSync } from "fflate";
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
