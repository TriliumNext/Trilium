/**
 * Empty stand-in for heavy optional dependencies of officeparser (pdfjs-dist,
 * tesseract.js, puppeteer). officeparser only reaches them through dynamic imports
 * on code paths that office-format conversion never hits (PDF parsing, OCR, PDF
 * generation — PDFs have a dedicated viewer and never pass the isOfficeMimeType
 * gate), but without an alias Vite would either emit their multi-megabyte chunks
 * into the build output or fail dev import-analysis on unresolvable specifiers.
 * See the officeparser aliases in vite.config.mts.
 */
export default {};
