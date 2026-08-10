/**
 * Office document formats that officeparser can process — used both for OCR text
 * extraction (server) and for the inline HTML preview of file notes/attachments.
 */
export const OFFICE_MIME_TYPES = new Set([
    // Office Open XML
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    // OpenDocument
    "application/vnd.oasis.opendocument.text",
    "application/vnd.oasis.opendocument.spreadsheet",
    "application/vnd.oasis.opendocument.presentation",
    // Rich Text Format
    "application/rtf",
    "text/rtf",
    // E-book
    "application/epub+zip",
    "application/x-epub+zip"
]);

/**
 * officeparser auto-detects most formats from the buffer's magic bytes, but for some MIME
 * types callers should pass the value as an explicit `fileType` parser hint instead of
 * relying on auto-detection:
 *  - RTF detection (via file-type) is unreliable — some valid RTF documents are not
 *    recognised and parsing then fails.
 *  - EPUB shares the ZIP container (PK magic bytes) with DOCX/ODT, so an explicit hint
 *    avoids any ambiguity in container-format detection.
 */
export const OFFICE_FILE_TYPE_HINTS: Record<string, "rtf" | "epub"> = {
    "application/rtf": "rtf",
    "text/rtf": "rtf",
    "application/epub+zip": "epub",
    "application/x-epub+zip": "epub"
};

export function isOfficeMimeType(mime: string | null | undefined): boolean {
    return !!mime && OFFICE_MIME_TYPES.has(mime);
}
