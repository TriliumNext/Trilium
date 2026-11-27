import {
    PDF_TOC_READER, type PdfOutline, readPdfOutline, toPdfTocHeadings
} from "@triliumnext/commons/src/lib/pdf_toc.js";
import type { PDFDocumentProxy } from "pdfjs-dist";

import { digestBlobId, getDocumentBlobId } from "./digest";
import { whenDocumentLoaded } from "./navigation";

/** The outline of the loaded document, read once. */
let outline: { pdf: object; read: Promise<PdfOutline> } | null = null;

/**
 * The outline of `pdf` as the generators read it, with the levels of the file, each heading's
 * own destination and the page it inherits. Read once per document.
 */
export function ensureOutline(pdf: PDFDocumentProxy): Promise<PdfOutline> {
    if (outline?.pdf !== pdf) {
        outline = { pdf, read: readPdfOutline(pdf) };
    }
    return outline.read;
}

/**
 * Answers `trilium-build-toc`: the table of contents of the loaded document, or of the bytes in
 * the request, and the `blobId` of those bytes in the form that `isProtected` names. Runs before
 * the first `await` of `main()`, and for read-only documents too.
 */
export function setupTocBuild() {
    window.addEventListener("message", (event) => {
        if (event.origin !== window.location.origin || event.data?.type !== "trilium-build-toc") {
            return;
        }

        const { requestId, isProtected, data } = event.data;
        void answerBuild(requestId, isProtected === true, data instanceof Uint8Array ? data : null);
    });
}

async function answerBuild(requestId: number, isProtected: boolean, data: Uint8Array | null) {
    const address = { ntxId: window.TRILIUM_NTX_ID, noteId: window.TRILIUM_NOTE_ID };
    let message: PdfViewerTocBuildMessage;
    try {
        const build = data
            ? await buildSavedToc(data, isProtected)
            : await buildLoadedToc(isProtected);
        message = { type: "pdfjs-viewer-toc-build", requestId, ...build, ...address };
    } catch {
        message = { type: "pdfjs-viewer-toc-build", requestId, failed: true, ...address };
    }
    window.parent.postMessage(message, window.location.origin);
}

/** The table of contents of the loaded document, which shares its outline and digest. */
async function buildLoadedToc(isProtected: boolean) {
    const { pdfDocument } = await whenDocumentLoaded();
    const started = performance.now();
    const [ read, blobId ] = await Promise.all([
        ensureOutline(pdfDocument), getDocumentBlobId(pdfDocument, isProtected)
    ]);
    return toBuild(read, blobId, started);
}

/**
 * The table of contents of `data`, the bytes of a save, opened without a password: one that needs
 * a password fails. The loading task is destroyed whether the open succeeds or not.
 */
async function buildSavedToc(data: Uint8Array, isProtected: boolean) {
    const started = performance.now();
    // Digested first, since pdf.js takes the bytes it opens.
    const blobId = await digestBlobId(data, isProtected);
    const task = window.pdfjsLib.getDocument({ data });
    try {
        return toBuild(await readPdfOutline(await task.promise), blobId, started);
    } finally {
        await task.destroy();
    }
}

function toBuild({ headings, isCut }: PdfOutline, blobId: string, started: number) {
    return {
        blobId,
        headings: toPdfTocHeadings(headings),
        isCut,
        properties: { reader: PDF_TOC_READER },
        elapsedMs: performance.now() - started
    };
}
