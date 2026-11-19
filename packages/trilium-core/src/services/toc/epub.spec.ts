import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { DOCX_MIME, EPUB_MIME_TYPES, ODT_MIME } from "@triliumnext/commons";
import { strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { convertOfficeToHtml } from "../office_preview.js";
import { EPUB_TOC_READER, epubTocFormat, type TocPassOutcome, TocPassRefusal } from "./epub.js";
import { getHeadingIds, type TocFormat } from "./index.js";
import { docxTocFormat, getOfficeIssueCode, odtTocFormat } from "./office.js";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

/**
 * Reads the contract books through the real ToC pass and `officeparser`. Under the standalone
 * runner, this proves that the worker reads, rewrites and converts them as the server does.
 */
describe.each([
    { book: "toc_contract" }, { book: "toc_contract_ncx" }, { book: "toc_contract_ids" }
])("the EPUB contract $book", ({ book }) => {
    const bytes = readFixture(`${book}.epub`);
    const contract = JSON.parse(new TextDecoder().decode(readFixture(`${book}_epub.json`)));

    it("reads the entries, which of them the preview shows, and their ids", async () => {
        const toc = await generate(epubTocFormat as TocFormat, bytes);

        expect(toc).toStrictEqual({
            headings: contract.headings,
            isCut: contract.isCut,
            properties: { reader: EPUB_TOC_READER }
        });
        expect(getHeadingIds(contract.headings, contract.blobId, false, false))
            .toStrictEqual(contract.ids);
        expect(getHeadingIds(contract.headings, contract.protectedBlobId, true, false))
            .toStrictEqual(contract.protectedIds);
    });

    it("marks the preview with the ids of the shown entries, protected or not", async () => {
        for (const mime of EPUB_MIME_TYPES) {
            let tocPass: TocPassOutcome | undefined;
            const html = await convertOfficeToHtml(bytes, mime, {
                onTocPass: (outcome) => {
                    tocPass = outcome;
                }
            });
            // EPUB previews give headings no slug ids.
            expect(html).not.toMatch(/ id="(?:after-the-cover|chapter-1|heading-of-chapter-1)"/);

            for (const [ blobId, isProtected, ids ] of [
                [ contract.blobId, false, contract.ids ],
                [ contract.protectedBlobId, true, contract.protectedIds ]
            ] as const) {
                const shown = (ids as string[]).filter((_, index) =>
                    contract.headings[index].isShown !== false);
                const source = { blobId, isProtected, content: bytes, tocPass };
                const marked = await epubTocFormat.markPreview?.(html, source) ?? "";
                expect(readMarks(marked, "data-toc-heading").flatMap((value) => value.split(" "))
                    .toSorted()).toStrictEqual(shown.toSorted());
                expect(marked.replace(/ data-toc-heading="[^"]*"/g, "")).toBe(html);
            }
        }
    });
});

describe("the EPUB format", () => {
    it("is the format of file notes and attachments of either EPUB MIME type", () => {
        for (const mime of EPUB_MIME_TYPES) {
            expect(epubTocFormat.isFor("file", mime)).toBe(true);
            expect(epubTocFormat.isFor("code", mime)).toBe(false);
            expect(docxTocFormat.isFor("file", mime)).toBe(false);
            expect(odtTocFormat.isFor("file", mime)).toBe(false);
        }
        expect(epubTocFormat.isFor("file", DOCX_MIME)).toBe(false);
        expect(epubTocFormat.isFor("file", ODT_MIME)).toBe(false);
    });

    it("accepts its own reader only, and links only the entries that the preview shows", () => {
        const cache = { version: 1, targetBlobHash: "abc", headings: [] };
        const current = { reader: EPUB_TOC_READER };
        const isCurrent = (epub: unknown) => epubTocFormat.isCurrent({ ...cache, epub });

        expect(isCurrent(current)).toBe(true);
        expect(epubTocFormat.isCurrent({ ...cache, docx: current })).toBe(false);
        expect(isCurrent({ reader: EPUB_TOC_READER - 1 })).toBe(false);
        expect(isCurrent({ ...current, bookmarks: [] })).toBe(false);
        expect(isCurrent(null)).toBe(false);
        expect(docxTocFormat.isCurrent({ ...cache, epub: current })).toBe(false);
        const heading = { id: "0k3x9aa1h7q2mz", title: "A", level: 1 };
        expect(epubTocFormat.getLinkParams(heading)).toStrictEqual({ heading: heading.id });
        expect(epubTocFormat.getLinkParams({ ...heading, isShown: false })).toBeUndefined();
        expect(epubTocFormat.parseHeadingFields({ isShown: false }))
            .toStrictEqual({ isShown: false });
        expect(epubTocFormat.parseHeadingFields({})).toStrictEqual({});
        expect(epubTocFormat.parseHeadingFields({ isShown: true })).toBeNull();
        expect(epubTocFormat.getOtherTargets).toBeUndefined();
    });

    it("remembers a refusal of the ToC pass and logs its reason", () => {
        const refusal = new TocPassRefusal("CRC");

        expect(epubTocFormat.isPermanentFailure(refusal)).toBe(true);
        expect(epubTocFormat.isPermanentFailure(issue("DOCUMENT_DECRYPTION_FAILED"))).toBe(true);
        expect(epubTocFormat.isPermanentFailure(new RangeError("Out of memory"))).toBe(false);
        expect(epubTocFormat.describeFailure?.(refusal)).toBe("CRC");
        expect(epubTocFormat.describeFailure?.(issue("ZIP_TRUNCATED"))).toBe("ZIP_TRUNCATED");
        expect(epubTocFormat.describeFailure?.(new Error("[OfficeParser]: Secret"))).toBe("Error");
    });

    it("leaves a preview unmarked unless the pass marked the archive it was converted from",
        async () => {
        const html = "<h2 id=\"trilium_toc_0\">Chapter</h2>";
        const source = { blobId: "abc", isProtected: false, content: new Uint8Array(0) };

        for (const tocPass of [
            undefined, { status: "none" }, { status: "refused", reason: "CRC" },
            { status: "failed", error: new Error("Failed") }
        ] as (TocPassOutcome | undefined)[]) {
            expect(await epubTocFormat.markPreview?.(html, { ...source, tocPass })).toBe(html);
        }
    });

    it("refuses a book whose every chapter is encrypted, or that has no package document",
        async () => {
        const book = readFixture("toc_contract_ids.epub");
        const files = unzipSync(book);
        // The navigation document is in the spine too.
        const chapters = Object.keys(files).filter((name) => /\/(?:c\d|nav)\.xhtml$/.test(name));
        const encrypted = zipSync({
            ...files,
            "META-INF/encryption.xml": strToU8(
                "<encryption xmlns=\"urn:oasis:names:tc:opendocument:"
                + "xmlns:container\" xmlns:enc=\"http://www.w3.org/2001/04/xmlenc#\">"
                + chapters.map((name) => "<enc:EncryptedData><enc:EncryptionMethod Algorithm=\""
                    + "http://www.w3.org/2001/04/xmlenc#aes256-cbc\"/><enc:CipherData>"
                    + `<enc:CipherReference URI="${name}"/></enc:CipherData></enc:EncryptedData>`)
                    .join("") + "</encryption>")
        });
        const { "OEBPS/content.opf": _package, ...withoutPackage } = files;

        const errors = await Promise.all([ encrypted, zipSync(withoutPackage) ].map((bytes) =>
            failureOf(generate(epubTocFormat as TocFormat, bytes))));

        expect(errors.map(getOfficeIssueCode))
            .toStrictEqual([ "DOCUMENT_DECRYPTION_FAILED", "REQUIRED_PART_MISSING" ]);
        expect(errors.map((error) => epubTocFormat.isPermanentFailure(error)))
            .toStrictEqual([ true, true ]);
    });
});

async function generate(format: TocFormat, bytes: Uint8Array) {
    if (!format.generator) {
        throw new Error(`The format '${format.name}' has no generator.`);
    }
    return format.generator(bytes);
}

/** What `read` rejects with, `null` when it resolves. */
function failureOf(read: Promise<unknown>) {
    return read.then(() => null, (error: unknown) => error);
}

function readFixture(fileName: string) {
    return new Uint8Array(fs.readFileSync(path.join(FIXTURES, fileName)));
}

/** The values of the attribute `name` in `html`, in document order. */
function readMarks(html: string, name: string) {
    return Array.from(html.matchAll(new RegExp(`${name}="([^"]*)"`, "g")), ([ , value ]) => value);
}

/** An error of `officeparser` with the code `code`. */
function issue(code: string) {
    return Object.assign(new Error(`[OfficeParser]: ${code}`), { officeIssue: { code } });
}
