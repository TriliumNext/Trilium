import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { DOCX_MIME, ODT_MIME, OFFICE_PREVIEW_TOO_LARGE_MESSAGE } from "@triliumnext/commons";
import { describe, expect, it } from "vitest";

import { ValidationError } from "../../errors.js";
import { convertOfficeToHtml } from "../office_preview.js";
import { getHeadingIds, type TocFormat } from "./index.js";
import {
    DOCX_TOC_READER, docxTocFormat, getOfficeIssueCode, isOfficeInputFailure, ODT_TOC_READER,
    odtTocFormat
} from "./office.js";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

/**
 * Reads the contract documents through the real `officeparser`. Under the standalone runner, this
 * proves that the worker's build of `officeparser` reads what the server's does.
 */
describe.each([
    { name: "docx", format: docxTocFormat, mime: DOCX_MIME, reader: DOCX_TOC_READER },
    { name: "odt", format: odtTocFormat, mime: ODT_MIME, reader: ODT_TOC_READER }
])("the $name contract", ({ name, format, mime, reader }) => {
    const bytes = new Uint8Array(fs.readFileSync(path.join(FIXTURES, `toc_contract.${name}`)));
    const contract = JSON.parse(fs.readFileSync(path.join(FIXTURES, `toc_contract_${name}.json`), "utf-8"));

    it("reads the headings, levels, ids and bookmarks of the contract", async () => {
        const toc = await generate(format, bytes);

        expect(toc).toStrictEqual({
            headings: contract.headings, isCut: false, properties: { reader, bookmarks: contract.bookmarks }
        });
        expect(getHeadingIds(contract.headings, contract.blobId, false, false)).toStrictEqual(contract.ids);
        expect(getHeadingIds(contract.headings, contract.protectedBlobId, true, false))
            .toStrictEqual(contract.protectedIds);
    });

    it("marks the preview with the ids and bookmarks of the cache, in either form of protection", async () => {
        const html = await convertOfficeToHtml(bytes, mime);

        for (const [ blobId, isProtected, ids ] of [
            [ contract.blobId, false, contract.ids ],
            [ contract.protectedBlobId, true, contract.protectedIds ]
        ] as const) {
            const marked = await format.markPreview?.(html, { blobId, isProtected, content: bytes }) ?? "";
            expect([ ...marked.matchAll(/data-toc-heading="([^"]*)"/g) ].map(([ , id ]) => id))
                .toStrictEqual(ids);
            expect([ ...marked.matchAll(/data-toc-bookmark="([^"]*)"/g) ].map(([ , name ]) => name).sort())
                .toStrictEqual(contract.bookmarks.toSorted());
            expect(marked.replace(/ data-toc-(?:heading|bookmark)="[^"]*"/g, "")).toBe(html);
        }
    });

    it("gives the headings of the preview no slug ids, so a bookmark named like one is found", async () => {
        const html = await convertOfficeToHtml(bytes, mime);

        expect(html).not.toContain("id=\"summary-1\"");
        expect([ ...html.matchAll(/\sid="summary"/g) ]).toHaveLength(1);
        expect(contract.bookmarks).toContain("summary");
    });
});

describe("the DOCX and ODT formats", () => {
    it("are formats of file notes and attachments of their own MIME type only", () => {
        expect(docxTocFormat.isFor("file", DOCX_MIME)).toBe(true);
        expect(docxTocFormat.isFor("file", ODT_MIME)).toBe(false);
        expect(docxTocFormat.isFor("code", DOCX_MIME)).toBe(false);
        expect(odtTocFormat.isFor("file", ODT_MIME)).toBe(true);
        expect(odtTocFormat.isFor("file", "application/vnd.oasis.opendocument.text-template")).toBe(false);
    });

    it("accept the properties of their own reader only, and link a heading to itself", () => {
        const cache = { version: 1, targetBlobHash: "abc", headings: [] };
        const current = { reader: DOCX_TOC_READER, bookmarks: [ "B" ] };

        expect(docxTocFormat.isCurrent({ ...cache, docx: current })).toBe(true);
        expect(docxTocFormat.isCurrent({ ...cache, odt: current })).toBe(false);
        expect(docxTocFormat.isCurrent({ ...cache, docx: { ...current, reader: DOCX_TOC_READER + 1 } })).toBe(false);
        expect(docxTocFormat.isCurrent({ ...cache, docx: { ...current, x: 1 } })).toBe(false);
        // A cache of reader 1 has no bookmarks.
        expect(docxTocFormat.isCurrent({ ...cache, docx: { reader: DOCX_TOC_READER } })).toBe(false);
        expect(docxTocFormat.isCurrent({ ...cache, docx: { ...current, bookmarks: [ 1 ] } })).toBe(false);
        expect(odtTocFormat.isCurrent({ ...cache, odt: null })).toBe(false);
        expect(docxTocFormat.getLinkParams({ id: "0k3x9aa1h7q2mz", title: "A", level: 1 }))
            .toStrictEqual({ heading: "0k3x9aa1h7q2mz" });
        expect(docxTocFormat.parseHeadingFields({ title: "A", level: 1, page: 3 })).toStrictEqual({});
    });

    it("list their bookmarks as anchors, sorted by name", () => {
        const cache = {
            version: 1, targetBlobHash: "abc", headings: [],
            odt: { reader: ODT_TOC_READER, bookmarks: [ "Zeta", "alpha", "Beta" ] }
        };

        expect(odtTocFormat.getOtherTargets?.(cache)).toStrictEqual([ "alpha", "Beta", "Zeta" ]
            .map((name) => ({ kind: "anchor", title: name, params: { bookmark: name } })));
        expect(docxTocFormat.getOtherTargets?.(cache)).toStrictEqual([]);
    });
});

describe("failures", () => {
    it("remembers the errors whose code says that the bytes cannot be read, and the size refusal", async () => {
        const errors = await Promise.all([
            new Uint8Array([ 1, 2, 3, 4 ]),
            // Cut after its entries: a cut through them reads as "invalid zip data", without a code.
            truncated(fs.readFileSync(path.join(FIXTURES, "toc_contract.docx")), 0.9)
        ].map((bytes) => generate(docxTocFormat, bytes).then(() => null, (error: unknown) => error)));

        expect(errors.map(getOfficeIssueCode)).toStrictEqual([ "IMPROPER_BUFFERS", "ZIP_TRUNCATED" ]);
        expect(errors.map(isOfficeInputFailure)).toStrictEqual([ true, true ]);
        expect(isOfficeInputFailure(issue("PASSWORD_REQUIRED"))).toBe(true);
        expect(isOfficeInputFailure(new ValidationError(`${OFFICE_PREVIEW_TOO_LARGE_MESSAGE} (1 bytes).`)))
            .toBe(true);
    });

    it("reads again a failure without a code, one about the call or the run, and any other", async () => {
        const truncatedOdt = await generate(odtTocFormat,
            truncated(fs.readFileSync(path.join(FIXTURES, "toc_contract.odt")), 0.5))
            .then(() => null, (error: unknown) => error);

        expect(truncatedOdt).toBeInstanceOf(Error);
        expect(String((truncatedOdt as Error).message)).toMatch(/^\[OfficeParser\]: /);
        for (const error of [
            truncatedOdt, new Error("[OfficeParser]: Array buffer allocation failed"),
            issue("INVALID_INPUT"), issue("OPERATION_ABORTED"), issue("FORMAT_UNSUPPORTED"),
            new ValidationError("MIME type 'x' is not a supported office format."),
            new TypeError("Failed to fetch dynamically imported module"), "Timeout", null
        ]) {
            expect(isOfficeInputFailure(error), String(error)).toBe(false);
        }
    });

    it("names the code for the log, else the name of the error, never its message", () => {
        expect(docxTocFormat.describeFailure?.(issue("ZIP_TRUNCATED"))).toBe("ZIP_TRUNCATED");
        expect(docxTocFormat.describeFailure?.(new Error("[OfficeParser]: Secret text"))).toBe("Error");
        expect(docxTocFormat.describeFailure?.("Timeout")).toBe("Timeout");
        expect(getOfficeIssueCode({ officeIssue: { code: 5 } })).toBeUndefined();
        expect(getOfficeIssueCode({ officeIssue: null })).toBeUndefined();
    });
});

async function generate(format: TocFormat, bytes: Uint8Array) {
    if (!format.generator) {
        throw new Error(`The format '${format.name}' has no generator.`);
    }
    return format.generator(bytes);
}

/** The start of `bytes`, a `fraction` of them, as an interrupted upload leaves a file. */
function truncated(bytes: Uint8Array, fraction: number) {
    return new Uint8Array(bytes.subarray(0, Math.floor(bytes.length * fraction)));
}

/** An error of `officeparser` with the code `code`. */
function issue(code: string) {
    return Object.assign(new Error(`[OfficeParser]: ${code}`), { officeIssue: { code } });
}
