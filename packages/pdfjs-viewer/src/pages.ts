export function setupPdfPages() {
    const app = window.PDFViewerApplication;

    // Send initial page info when pages are initialized
    app.eventBus.on("pagesinit", () => {
        sendPageInfo();
    });

    // Also send immediately if document is already loaded
    if (app.pdfDocument && app.pdfViewer) {
        sendPageInfo();
    }

    // Track current page changes
    app.eventBus.on("pagechanging", (evt: any) => {
        window.parent.postMessage({
            type: "pdfjs-viewer-current-page",
            currentPage: evt.pageNumber
        } satisfies PdfViewerCurrentPageMessage, window.location.origin);
    });

    window.addEventListener("message", async(event) => {
        // Only accept messages from the same origin to prevent malicious iframes
        if (event.origin !== window.location.origin) return;

        if (event.data?.type === "trilium-scroll-to-page") {
            const pageNumber = event.data.pageNumber;
            app.pdfViewer.currentPageNumber = pageNumber;
        }

        if (event.data?.type === "trilium-request-thumbnail") {
            const pageNumber = event.data.pageNumber;
            await generateThumbnail(pageNumber);
        }
    });
}

function sendPageInfo() {
    const app = window.PDFViewerApplication;

    window.parent.postMessage({
        type: "pdfjs-viewer-page-info",
        totalPages: app.pdfDocument.numPages,
        currentPage: app.pdfViewer.currentPageNumber
    } satisfies PdfViewerPageInfoMessage, window.location.origin);
}

async function generateThumbnail(pageNumber: number) {
    const app = window.PDFViewerApplication;

    try {
        const page = await app.pdfDocument.getPage(pageNumber);

        // Create canvas for thumbnail
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        if (!context) return;

        // Set thumbnail size (smaller than actual page)
        const viewport = page.getViewport({ scale: 0.2 });
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        // Render page to canvas
        await page.render({
            canvas: canvas,
            viewport: viewport
        }).promise;

        // Convert to data URL
        const dataUrl = canvas.toDataURL('image/jpeg', 0.7);

        // Send thumbnail to parent
        window.parent.postMessage({
            type: "pdfjs-viewer-thumbnail",
            pageNumber,
            dataUrl
        } satisfies PdfViewerThumbnailMessage, window.location.origin);
    } catch (error) {
        console.error(`Error generating thumbnail for page %d:`, pageNumber, error);
    }
}
