import {
    PDF_TOC_READER, type PdfOutline, type PdfOutlineHeading, readPdfOutline, toPdfTocHeadings
} from "@triliumnext/commons/src/lib/pdf_toc.js";
import { MAX_TOC_DEPTH } from "@triliumnext/commons/src/lib/toc.js";
import type { PDFDocumentProxy } from "pdfjs-dist";

import { digestBlobId, getDocumentBlobId } from "./digest";
import { whenDocumentLoaded } from "./navigation";

/** The outline of the loaded document, read once. */
let outline: { pdf: object; read: Promise<PdfOutline> } | null = null;
/** The headings that have a page, by page and position on it, for the active heading. */
let headingPositions: Array<{ key: string; pageIndex: number; y: number }> = [];

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
 * Sends the outline to the sidebar. Each heading has a key, `outline-<n>` for its position in the
 * outline, which only this viewer knows; levels past `MAX_TOC_DEPTH` are shown at that depth.
 */
export async function extractAndSendToc() {
    const app = window.PDFViewerApplication;
    let headings: PdfOutlineHeading[] = [];
    try {
        ({ headings } = await ensureOutline(app.pdfDocument));
    } catch {
        // Sent as a document without an outline.
    }

    headingPositions = headings
        .flatMap(({ page, dest }, index) => page === undefined ? [] : [ {
            key: getHeadingKey(index),
            pageIndex: page - 1,
            // The top of an `/XYZ` destination; other kinds count as the bottom of the page.
            y: typeof dest?.[3] === "number" ? dest[3] : 0
        } ])
        // By page, then from the top of the page down: PDF coordinates grow upwards.
        .sort((a, b) => a.pageIndex - b.pageIndex || b.y - a.y);

    const items = headings.map(({ title, level }, index) => ({
        id: getHeadingKey(index), title, level: Math.min(level, MAX_TOC_DEPTH)
    }));
    window.parent.postMessage({
        type: "pdfjs-viewer-toc",
        data: items.length > 0 ? items : null,
        ntxId: window.TRILIUM_NTX_ID,
        noteId: window.TRILIUM_NOTE_ID
    } satisfies PdfViewerTocMessage, window.location.origin);
}

/** The key of the heading at `index` of the outline, shared by the sidebar and the viewer. */
export function getHeadingKey(index: number) {
    return `outline-${index}`;
}

export function setupActiveHeadingTracking() {
    const app = window.PDFViewerApplication;
    let lastActiveHeading: string | null = null;

    // Offset from top of viewport to consider a heading "active"
    // This makes the heading active when it's near the top, not when fully scrolled past
    const ACTIVE_HEADING_OFFSET = 100;

    function updateActiveHeading() {
        if (headingPositions.length === 0) return;

        const viewer = app.pdfViewer;
        const container = viewer.container;
        const scrollTop = container.scrollTop;

        // Find the heading closest to the top of the viewport
        let activeHeadingId: string | null = null;
        let bestDistance = Infinity;

        for (const heading of headingPositions) {
            // Get the page view to calculate actual position
            const pageView = viewer.getPageView(heading.pageIndex);
            if (!pageView || !pageView.div) {
                continue;
            }

            const pageTop = pageView.div.offsetTop;
            const pageHeight = pageView.div.clientHeight;

            // Convert PDF Y coordinate (bottom-up) to screen position (top-down)
            const headingScreenY = pageTop + (pageHeight - heading.y);

            // Calculate distance from top of viewport
            const distance = Math.abs(headingScreenY - scrollTop);

            // If this heading is closer to the top of viewport, and it's not too far below
            if (headingScreenY <= scrollTop + ACTIVE_HEADING_OFFSET && distance < bestDistance) {
                activeHeadingId = heading.key;
                bestDistance = distance;
            }
        }

        if (activeHeadingId !== lastActiveHeading) {
            lastActiveHeading = activeHeadingId;
            window.parent.postMessage({
                type: "pdfjs-viewer-active-heading",
                headingId: activeHeadingId,
                ntxId: window.TRILIUM_NTX_ID,
                noteId: window.TRILIUM_NOTE_ID
            } satisfies PdfViewerActiveHeadingMessage, window.location.origin);
        }
    }

    // Debounced scroll handler
    let scrollTimeout: number | null = null;
    const debouncedUpdate = () => {
        if (scrollTimeout) {
            clearTimeout(scrollTimeout);
        }
        scrollTimeout = window.setTimeout(updateActiveHeading, 100);
    };

    app.eventBus.on("pagechanging", debouncedUpdate);

    // Also listen to scroll events for more granular updates within a page
    const container = app.pdfViewer.container;
    container.addEventListener("scroll", debouncedUpdate);

    // Initial update
    updateActiveHeading();
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
