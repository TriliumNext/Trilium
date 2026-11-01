import { convertOfficeToHtml } from "@triliumnext/core/src/services/office_preview.js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

/**
 * Canary for the officeparser aliases in vite.config.mts: the standalone build bypasses
 * the package's prebuilt `browser` entry and bundles `officeparser/dist/index.mjs`
 * directly (with pdfjs-dist/tesseract.js stubbed out). That reaches into officeparser's
 * dist/ internals, so an upstream upgrade could silently break the alias target or the
 * stubbed-out code paths. This spec resolves officeparser through the same aliases, so
 * a breaking upgrade fails here instead of at runtime in the browser.
 */
describe("office preview with aliased officeparser", () => {
    it("converts a DOCX fixture to HTML through the slim entry", async () => {
        const docx = readFixture("demo.docx");
        const html = await convertOfficeToHtml(docx, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");

        expect(html).toContain("Welcome to Trilium Notes!");
        // An embeddable fragment, not a standalone document.
        expect(html).not.toContain("<html");
    });

    it("converts an XLSX spreadsheet fixture to HTML", async () => {
        const xlsx = readFixture("demo.xlsx");
        const html = await convertOfficeToHtml(xlsx, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");

        expect(html).toContain("<table");
    });
});

describe("convertOfficeToHtml guards", () => {
    it("rejects a non-office MIME type", async () => {
        await expect(convertOfficeToHtml(new Uint8Array([1]), "application/pdf"))
            .rejects.toThrow(/not a supported office format/);
    });

    it("refuses a document above the preview size cap", async () => {
        const oversized = new Uint8Array(20 * 1024 * 1024 + 1);

        await expect(convertOfficeToHtml(oversized, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"))
            .rejects.toThrow(/too large/);
    });

    it("rejects a buffer that neither the spreadsheet pipeline nor officeparser can read", async () => {
        // Garbage with an XLSX MIME exercises the exceljs -> officeparser fallback; since the
        // bytes are not any known format, the officeparser attempt then fails too.
        const garbage = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]);

        await expect(convertOfficeToHtml(garbage, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))
            .rejects.toThrow();
    });
});

function readFixture(name: string): Uint8Array {
    // Vitest serves transformed modules from Vite's virtual /@fs/ root — strip it to get
    // a real filesystem path (no-op when the marker is absent). On Windows the marker
    // lands mid-path (`C:\@fs\C:\Users\…`) rather than at the start, so everything up to
    // and including it is dropped; POSIX paths lose their leading slash in that cut and
    // get it restored.
    let path = fileURLToPath(new URL(`../../server/src/services/ocr/processors/samples/${name}`, import.meta.url));
    const marker = path.match(/[/\\]@fs[/\\]/);
    if (marker?.index !== undefined) {
        path = path.slice(marker.index + marker[0].length);
        if (!/^[A-Za-z]:/.test(path)) {
            path = `/${path}`;
        }
    }

    return new Uint8Array(readFileSync(path));
}
