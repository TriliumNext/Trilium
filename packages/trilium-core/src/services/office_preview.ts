import { isOfficeMimeType, OFFICE_FILE_TYPE_HINTS } from "@triliumnext/commons";

import { ValidationError } from "../errors.js";
import { wrapStringOrBuffer } from "./utils/binary.js";

/**
 * Conversion is CPU-bound and runs on the main thread (or the standalone service worker),
 * so a very large document would block other requests. Above this size we refuse the
 * preview and let the client fall back to download / open.
 */
const MAX_OFFICE_PREVIEW_BYTES = 20 * 1024 * 1024;

/**
 * Converts an office document (DOCX/XLSX/PPTX, ODT/ODS/ODP and RTF) to an embeddable HTML
 * fragment using officeparser. The heavy library is loaded lazily on first use (dynamic
 * import), so it never weighs on the initial standalone bundle.
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

    const fileType = OFFICE_FILE_TYPE_HINTS[mime];
    const { OfficeConverter } = await import("officeparser");
    const { value } = await OfficeConverter.convert(buffer, "html", {
        // Pass the explicit fileType only when auto-detection is unreliable (RTF).
        parseConfig: fileType ? { fileType } : undefined,
        generatorConfig: {
            // Charts would be emitted as a Chart.js <script> (loaded from a CDN) that the
            // client-side sanitizer strips anyway, so don't bother generating them.
            includeCharts: false,
            // Emit an embeddable fragment instead of a full standalone <html> document.
            htmlConfig: { standalone: false }
        }
    });

    // value is a string for the 'html' destination.
    return typeof value === "string" ? value : "";
}
