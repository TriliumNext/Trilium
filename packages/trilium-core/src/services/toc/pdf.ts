import { PDF_TOC_READER, type PdfTocHeading } from "@triliumnext/commons";

import type { TocFormat } from "./index.js";

/** The errors of pdf.js for a file that it can never open. */
const PERMANENT_FAILURES = new Set([ "InvalidPDFException", "PasswordException" ]);

/** The outline of a PDF file: a heading links to its page, and to itself through `heading`. */
const pdfTocFormat: TocFormat<PdfTocHeading> = {
    name: "pdf",
    isFor: (type, mime) => type === "file" && mime === "application/pdf",
    isCurrent({ pdf }) {
        return typeof pdf === "object" && pdf !== null && Object.keys(pdf).length === 1
            && (pdf as Record<string, unknown>).reader === PDF_TOC_READER;
    },
    getLinkParams: ({ id, page }) => page === undefined
        ? undefined
        : { page: String(page), heading: id },
    parseHeadingFields({ page }) {
        if (page === undefined) {
            return {};
        }
        return typeof page === "number" && Number.isInteger(page) && page >= 1 ? { page } : null;
    },
    isPermanentFailure: (error) => error instanceof Error && PERMANENT_FAILURES.has(error.name)
};

export default pdfTocFormat;
