import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
    assignHeadingIds, blobIdFromDigest, getBlobTag, MAX_TOC_HEADINGS, PDF_TOC_READER
} from "@triliumnext/commons";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ registerTocGenerator: vi.fn() }));

vi.mock("@triliumnext/core", async (importOriginal) => ({
    ...await importOriginal<typeof import("@triliumnext/core")>(),
    registerTocGenerator: mocks.registerTocGenerator
}));

const { readPdfToc, registerPdfTocGenerator } = await import("./pdf.js");

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)),
    "../../../../../packages/trilium-core/src/services/toc/fixtures");
const contractPdf = readFileSync(join(FIXTURES, "toc_contract.pdf"));
const contract = JSON.parse(readFileSync(join(FIXTURES, "toc_contract.json"), "utf-8"));

describe("readPdfToc", () => {
    it("reads the contract PDF as the viewer does, and its ids are the contract's", async () => {
        const toc = await readPdfToc(contractPdf);

        expect(toc).toStrictEqual({
            headings: contract.headings, isCut: false, properties: { reader: PDF_TOC_READER }
        });
        const blobId = blobIdFromDigest(new Uint8Array(createHash("sha512").update(contractPdf).digest()));
        expect(blobId).toBe(contract.blobId);
        expect(assignHeadingIds(toc.headings as { title: string; level: number }[], getBlobTag(blobId), false))
            .toStrictEqual(contract.ids);
        // pdf.js takes the buffer it reads, so it reads a copy.
        expect(contractPdf.length).toBeGreaterThan(0);
    });

    it("reads content given as text", async () => {
        // The fixture is ASCII, so its text is its bytes.
        expect((await readPdfToc(contractPdf.toString("latin1"))).headings).toStrictEqual(contract.headings);
    });

    it("reads a PDF without an outline", async () => {
        const bare = "%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n"
            + "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n"
            + "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n"
            + "trailer\n<< /Root 1 0 R >>\n%%EOF\n";

        expect(await readPdfToc(new TextEncoder().encode(bare)))
            .toStrictEqual({ headings: [], isCut: false, properties: { reader: PDF_TOC_READER } });
    });

    it("reports an outline cut at MAX_TOC_HEADINGS", async () => {
        const count = MAX_TOC_HEADINGS + 1;
        const objects = [
            "<< /Type /Catalog /Pages 2 0 R /Outlines 4 0 R >>",
            "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>",
            `<< /Type /Outlines /First 5 0 R /Last ${4 + count} 0 R /Count ${count} >>`,
            ...Array.from({ length: count }, (_, index) => index < count - 1
                ? `<< /Title (Section ${index}) /Parent 4 0 R /Next ${6 + index} 0 R >>`
                : `<< /Title (Section ${index}) /Parent 4 0 R >>`)
        ];
        const body = objects.map((object, index) => `${index + 1} 0 obj\n${object}\nendobj\n`);
        const pdf = `%PDF-1.7\n${body.join("")}trailer\n<< /Root 1 0 R >>\n%%EOF\n`;

        const toc = await readPdfToc(new TextEncoder().encode(pdf));

        expect(toc.isCut).toBe(true);
        expect(toc.headings).toHaveLength(MAX_TOC_HEADINGS);
    });

    it("passes on the error of pdf.js for a file that is not a PDF", async () => {
        await expect(readPdfToc(new TextEncoder().encode("Not a PDF at all")))
            .rejects.toMatchObject({ name: "InvalidPDFException" });
    });
});

describe("registerPdfTocGenerator", () => {
    it("registers readPdfToc for the PDF format", () => {
        registerPdfTocGenerator();

        expect(mocks.registerTocGenerator).toHaveBeenCalledWith("pdf", readPdfToc);
    });
});
