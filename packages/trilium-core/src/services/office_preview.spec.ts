import "@triliumnext/commons/src/lib/spreadsheet/exceljs_augmentation.js";

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { EPUB_MIME_TYPES } from "@triliumnext/commons";
import { toArrayBuffer } from "@triliumnext/commons/src/lib/spreadsheet/parse_from_xlsx.js";
import ExcelJS from "exceljs";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { OfficeConverter } from "officeparser";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ValidationError } from "../errors.js";
import { convertOfficeToHtml, convertXlsxToWorkbook } from "./office_preview.js";
import type { TocPassOutcome } from "./toc/epub.js";

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

describe("convertOfficeToHtml for an EPUB", () => {
    const book = new Uint8Array(fs.readFileSync(path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        "toc/fixtures/toc_contract_ids.epub")));

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("converts the marked archive, without slug ids, and reports the pass", async () => {
        for (const mime of EPUB_MIME_TYPES) {
            const outcomes: TocPassOutcome[] = [];
            const html = await convertOfficeToHtml(book, mime,
                { onTocPass: (outcome) => outcomes.push(outcome) });

            expect(outcomes.map(({ status }) => status)).toStrictEqual([ "marked" ]);
            for (const number of [ 0, 1, 2, 3 ]) {
                expect(html.split(`id="trilium_toc_${number}"`)).toHaveLength(2);
            }
            expect(html).not.toContain("id=\"heading-of-chapter-1\"");
        }
        const outcomes: TocPassOutcome[] = [];
        await convertOfficeToHtml(buildDocx("Word"), DOCX_MIME,
            { onTocPass: (outcome) => outcomes.push(outcome) });
        expect(outcomes).toStrictEqual([]);
    });

    it("converts the original bytes after a failure of the marked archive's conversion",
        async () => {
        const failure = new RangeError("Out of memory");
        const refusal = Object.assign(new Error("[OfficeParser]: corrupt"), {
            officeIssue: { code: "FILE_CORRUPTED" }
        });
        for (const [ error, expected ] of [
            [ failure, { status: "failed", error: failure } ],
            [ refusal, { status: "refused", reason: "REWRITE" } ]
        ] as const) {
            const convert = OfficeConverter.convert.bind(OfficeConverter);
            const spy = vi.spyOn(OfficeConverter, "convert")
                .mockImplementationOnce(() => Promise.reject(error))
                .mockImplementation(convert);
            const outcomes: TocPassOutcome[] = [];

            const html = await convertOfficeToHtml(book, EPUB_MIME_TYPES[0], {
                onTocPass: (outcome) => {
                    // Reported once, after the conversion of the body returned.
                    expect(spy).toHaveBeenCalledTimes(2);
                    outcomes.push(outcome);
                }
            });

            expect(outcomes).toStrictEqual([ expected ]);
            expect(html).toContain("CHAPTER I.");
            expect(html).not.toContain("trilium_toc_");
            vi.restoreAllMocks();
        }
    });

    it("throws the failure of the original's conversion, and reports nothing", async () => {
        const failure = new RangeError("Out of memory");
        vi.spyOn(OfficeConverter, "convert").mockRejectedValue(failure);
        const onTocPass = vi.fn();

        await expect(convertOfficeToHtml(book, EPUB_MIME_TYPES[0], { onTocPass }))
            .rejects.toBe(failure);
        expect(onTocPass).not.toHaveBeenCalled();
    });
});

describe("convertXlsxToWorkbook", () => {
    it("refuses a workbook above the preview size limit", async () => {
        const tooLarge = new Uint8Array(20 * 1024 * 1024 + 1);

        const conversion = convertXlsxToWorkbook(tooLarge, XLSX_MIME);
        await expect(conversion).rejects.toBeInstanceOf(ValidationError);
        await expect(conversion).rejects.toThrow("Workbook is too large to preview (20971521 bytes).");
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
