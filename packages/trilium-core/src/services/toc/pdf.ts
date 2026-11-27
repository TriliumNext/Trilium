import { findTocFormatName, PDF_TOC_READER, type PdfTocHeading } from "@triliumnext/commons";

import type { TocFormat } from "./index.js";

/** The errors of pdf.js for a file that it can never open. */
const PERMANENT_FAILURES = new Set([ "InvalidPDFException", "PasswordException" ]);

/** The outline of a PDF file: a heading links to its page, and to itself through `heading`. */
const pdfTocFormat: TocFormat<PdfTocHeading> = {
    name: "pdf",
    isFor: (type, mime) => findTocFormatName(type, mime) === "pdf",
    isCurrent({ pdf }) {
        return typeof pdf === "object" && pdf !== null && Object.keys(pdf).length === 1
            && (pdf as Record<string, unknown>).reader === PDF_TOC_READER;
    },
    getLinkParams: ({ id, page }) => page === undefined
        ? undefined
        : { page: String(page), heading: id },
    parseHeadingFields({ page, left, top }) {
        if (!isPage(page) || !isAnchor(left) || !isAnchor(top)) {
            return null;
        }
        return {
            ...(page === undefined ? {} : { page }),
            ...(left === undefined ? {} : { left }),
            ...(top === undefined ? {} : { top })
        };
    },
    isPermanentFailure: (error) => error instanceof Error && PERMANENT_FAILURES.has(error.name)
};

export default pdfTocFormat;

/** Whether `value` is absent or a page number, 1 for the first. */
function isPage(value: unknown): value is number | undefined {
    return value === undefined
        || (typeof value === "number" && Number.isInteger(value) && value >= 1);
}

/** Whether `value` is absent or a coordinate of PDF user space. */
function isAnchor(value: unknown): value is number | undefined {
    return value === undefined || (typeof value === "number" && Number.isFinite(value));
}
