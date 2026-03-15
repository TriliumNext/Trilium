import interceptPersistence from "./persistence";
import { extractAndSendToc, setupScrollToHeading, setupActiveHeadingTracking } from "./toc";
import { setupPdfPages } from "./pages";
import { setupPdfAttachments } from "./attachments";
import { setupPdfLayers } from "./layers";

async function main() {
    const urlParams = new URLSearchParams(window.location.search);
    const isEditable = urlParams.get("editable") === "1";

    document.body.classList.toggle("read-only-document", !isEditable);

    if (urlParams.get("sidebar") === "0") {
        hideSidebar();
    }

    if (isEditable) {
        interceptPersistence(getCustomAppOptions(urlParams));
    }

    configurePdfViewerOptions();

    // Wait for the PDF viewer application to be available.
    while (!window.PDFViewerApplication) {
        await new Promise(r => setTimeout(r, 50));
    }
    const app = window.PDFViewerApplication;

    if (isEditable) {
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
    }
    await app.initializedPromise;
};

function configurePdfViewerOptions() {
    const pdfOptionsHandler = (event: CustomEvent) => {
        if (event.detail?.source === window && window.PDFViewerApplicationOptions) {
            window.PDFViewerApplicationOptions.set("disablePreferences", true);
            window.PDFViewerApplicationOptions.set("enableHighlightFloatingButton", true);
        }
    };
    if (window.parent && window.parent !== window) {
        window.parent.addEventListener("webviewerloaded", pdfOptionsHandler, { once: true });
        window.addEventListener("pagehide", () => window.parent?.removeEventListener("webviewerloaded", pdfOptionsHandler));
    }
}

function hideSidebar() {
    window.TRILIUM_HIDE_SIDEBAR = true;
    const toggleButtonEl = document.getElementById("viewsManagerToggleButton");
    if (toggleButtonEl) {
        const spacer = toggleButtonEl.nextElementSibling.nextElementSibling;
        if (spacer instanceof HTMLElement && spacer.classList.contains("toolbarButtonSpacer")) {
            spacer.remove();
        }
        toggleButtonEl.style.display = "none";
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

    function onChange() {
        if (!storage) return;
        window.parent.postMessage({
            type: "pdfjs-viewer-document-modified",
            ntxId: window.TRILIUM_NTX_ID,
            noteId: window.TRILIUM_NOTE_ID
        } satisfies PdfDocumentModifiedMessage, window.location.origin);
        storage.resetModified();
    }

    window.addEventListener("message", async (event) => {
        if (event.origin !== window.location.origin) return;

        if (event.data?.type === "trilium-request-blob") {
            const app = window.PDFViewerApplication;
            const data = await app.pdfDocument.saveDocument();
            window.parent.postMessage({
                type: "pdfjs-viewer-blob",
                data,
                ntxId: window.TRILIUM_NTX_ID,
                noteId: window.TRILIUM_NOTE_ID
            } satisfies PdfDocumentBlobResultMessage, window.location.origin);
        }
    });

    (app.pdfDocument.annotationStorage as any).onSetModified = () => {
        onChange();
    };  // works great for most cases, including forms.
    app.eventBus.on("switchannotationeditorparams", () => {
        onChange();
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
