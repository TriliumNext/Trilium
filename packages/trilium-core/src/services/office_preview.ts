import { isOfficeMimeType, OFFICE_FILE_TYPE_HINTS } from "@triliumnext/commons";

import { ValidationError } from "../errors.js";
import { wrapStringOrBuffer } from "./utils/binary.js";

/**
 * Conversion is CPU-bound and runs on the main thread (or the standalone service worker),
 * so a very large document would block other requests. Above this size we refuse the
 * preview and let the client fall back to download / open.
 */
const MAX_OFFICE_PREVIEW_BYTES = 20 * 1024 * 1024;

// MIME of an `.xlsx` upload (Office Open XML spreadsheet), previewed through the native
// spreadsheet pipeline rather than officeparser.
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * Converts an office document (DOCX/XLSX/PPTX, ODT/ODS/ODP, RTF and EPUB) to an embeddable
 * HTML fragment. XLSX goes through Trilium's own spreadsheet pipeline (the same one behind
 * Spreadsheet notes, sharing and printing): unlike officeparser's grid, it renders borders,
 * merged cells, column widths and number formats, and styles everything inline so the
 * output needs no accompanying stylesheet. Everything else is converted by officeparser.
 * Both libraries are loaded lazily on first use (dynamic import), so neither weighs on the
 * initial standalone bundle.
 *
 * The result is NOT sanitized — the client must sanitize it before injecting into the DOM.
 */
export async function convertOfficeToHtml(content: string | Uint8Array, mime: string): Promise<string> {
    if (!isOfficeMimeType(mime)) {
        throw new ValidationError(`MIME type '${mime}' is not a supported office format.`);
    }

    const buffer = wrapStringOrBuffer(content);
    if (buffer.byteLength > MAX_OFFICE_PREVIEW_BYTES) {
        throw new ValidationError(`Office document is too large to preview (${buffer.byteLength} bytes).`);
    }

    if (mime === XLSX_MIME) {
        try {
            return await convertXlsxToHtml(buffer);
        } catch {
            // Not a workbook exceljs can read (e.g. a mislabeled or exotic file) —
            // fall through and let officeparser have a go at it.
        }
    }

    const fileType = OFFICE_FILE_TYPE_HINTS[mime];
    const { OfficeConverter } = await import("officeparser");
    const { value } = await OfficeConverter.convert(buffer, "html", {
        // Pass the explicit fileType only when auto-detection is unreliable (RTF/EPUB).
        // Embedded images need no extra config: the parser always emits them as data: URIs,
        // which the client-side sanitizer permits on <img>.
        parseConfig: fileType ? { fileType } : undefined,
        generatorConfig: {
            // Charts would be emitted as a Chart.js <script> (loaded from a CDN) that the
            // client-side sanitizer strips anyway, so don't bother generating them.
            includeCharts: false,
            // Emit an embeddable fragment instead of a full standalone <html> document.
            htmlConfig: { standalone: false }
        }
    });

    // Defensive: officeparser types `value` as string for the 'html' destination, so the
    // fallback arm is unreachable unless the library breaks its own contract.
    /* v8 ignore next */
    return typeof value === "string" ? value : "";
}

/**
 * Renders an `.xlsx` workbook through the native spreadsheet pipeline: the same
 * parse-to-Univer-JSON step the importer uses, then the shared/print HTML renderer.
 * Dynamically imported so exceljs only loads when an `.xlsx` is actually previewed,
 * keeping it out of the core barrel (and the standalone/browser bundle).
 */
async function convertXlsxToHtml(buffer: Uint8Array): Promise<string> {
    const [{ parseXlsxToWorkbook }, { renderSpreadsheetToHtml }] = await Promise.all([
        import("@triliumnext/commons/src/lib/spreadsheet/parse_from_xlsx.js"),
        import("@triliumnext/commons/src/lib/spreadsheet/render_to_html.js")
    ]);

    const workbook = await parseXlsxToWorkbook(buffer);

    // The renderer consumes the persisted note-content shape, which is the stringified
    // parse result (see importSpreadsheet in the import service).
    return renderSpreadsheetToHtml(JSON.stringify(workbook));
}
