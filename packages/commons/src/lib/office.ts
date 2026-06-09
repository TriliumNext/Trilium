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
    "text/rtf"
]);

/**
 * officeparser auto-detects the zip-based office formats from magic bytes, but its RTF
 * detection (via file-type) is unreliable — some valid RTF documents are not recognised
 * and parsing then fails. For these MIME types callers should pass the value as an
 * explicit `fileType` parser hint instead of relying on auto-detection.
 */
export const OFFICE_FILE_TYPE_HINTS: Record<string, "rtf"> = {
    "application/rtf": "rtf",
    "text/rtf": "rtf"
};

export function isOfficeMimeType(mime: string | null | undefined): boolean {
    return !!mime && OFFICE_MIME_TYPES.has(mime);
}
