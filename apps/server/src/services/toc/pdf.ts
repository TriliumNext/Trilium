import { PDF_TOC_READER, readPdfOutline, toPdfTocHeadings } from "@triliumnext/commons";
import { type GeneratedToc, registerTocGenerator } from "@triliumnext/core";

/** Lets the server read the outline of PDF files itself, with `unpdf`. */
export function registerPdfTocGenerator() {
    registerTocGenerator("pdf", readPdfToc);
}

/** The outline of the PDF file `content`, as a ToC cache stores it. */
export async function readPdfToc(content: Uint8Array | string): Promise<GeneratedToc> {
    // Loaded on the first read, so that pdf.js stays out of the startup.
    const { getDocumentProxy } = await import("unpdf");
    // pdf.js takes the buffer it is given, and a small Node buffer shares its memory with others.
    const bytes = typeof content === "string"
        ? new TextEncoder().encode(content)
        : new Uint8Array(content);
    const pdf = await getDocumentProxy(bytes);
    try {
        const { headings, isCut } = await readPdfOutline(pdf);
        return {
            headings: toPdfTocHeadings(headings), isCut, properties: { reader: PDF_TOC_READER }
        };
    } finally {
        await pdf.loadingTask.destroy();
    }
}
