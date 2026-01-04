import interceptPersistence from "./persistence";
import { extractAndSendToc, setupScrollToHeading, setupActiveHeadingTracking } from "./toc";
import { setupPdfPages } from "./pages";
import { setupPdfAttachments } from "./attachments";
import { setupPdfLayers } from "./layers";

async function main() {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get("sidebar") === "0") {
        hideSidebar();
    }

    interceptPersistence(getCustomAppOptions(urlParams));

    // Wait for the PDF viewer application to be available.
    while (!window.PDFViewerApplication) {
        await new Promise(r => setTimeout(r, 50));
    }
    const app = window.PDFViewerApplication;

    app.eventBus.on("documentloaded", () => {
        manageSave();
        manageDownload();
        extractAndSendToc();
        setupScrollToHeading();
        setupActiveHeadingTracking();
        setupPdfPages();
        setupPdfAttachments();
        setupPdfLayers();
    });
    await app.initializedPromise;
};

function hideSidebar() {
    window.TRILIUM_HIDE_SIDEBAR = true;
    const toggleButtonEl = document.getElementById("viewsManagerToggleButton");
    if (toggleButtonEl) {
        const spacer = toggleButtonEl.nextElementSibling.nextElementSibling;
        if (spacer instanceof HTMLElement && spacer.classList.contains("toolbarButtonSpacer")) {
            spacer.remove();
        }
        toggleButtonEl.remove();
    }
}

function getCustomAppOptions(urlParams: URLSearchParams) {
    return {
        localeProperties: {
            // Read from URL query
            lang: urlParams.get("lang") || "en"
        }
    };
}

function manageSave() {
    const app = window.PDFViewerApplication;
    const storage = app.pdfDocument.annotationStorage;
    let timeout = null;

    function debouncedSave() {
        if (timeout) {
            clearTimeout(timeout);
        }
        timeout = setTimeout(async () => {
            if (!storage) return;
            const data = await app.pdfDocument.saveDocument();
            window.parent.postMessage({
                type: "pdfjs-viewer-document-modified",
                data,
                ntxId: window.TRILIUM_NTX_ID,
                noteId: window.TRILIUM_NOTE_ID
            } satisfies PdfDocumentModifiedMessage, window.location.origin);
            storage.resetModified();
            timeout = null;
        }, 2_000);
    }

    app.pdfDocument.annotationStorage.onSetModified = debouncedSave;  // works great for most cases, including forms.
    app.eventBus.on("annotationeditorcommit", debouncedSave);
    app.eventBus.on("annotationeditorparamschanged", debouncedSave);
    app.eventBus.on("annotationeditorstateschanged", evt => {   // needed for detecting when annotations are moved around.
        const { activeEditorId } = evt;

        // When activeEditorId becomes null, an editor was just committed
        if (activeEditorId === null) {
            debouncedSave();
        }
    });
}

function manageDownload() {
    window.addEventListener("message", event => {
        if (event.origin !== window.location.origin) return;

        if (event.data?.type === "trilium-request-download") {
            const app = window.PDFViewerApplication;
            app.eventBus.dispatch("download", { source: window });
        }
    });
}

main();
