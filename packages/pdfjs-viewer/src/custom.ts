import interceptPersistence from "./persistence";
import { extractAndSendToc, setupScrollToHeading, setupActiveHeadingTracking } from "./toc";
import { setupPdfPages } from "./pages";
import { setupPdfAttachments } from "./attachments";
import { setupPdfLayers } from "./layers";
import { setupPdfAnnotations, setupAnnotationLiveUpdates, extractFromSavedData } from "./annotations";

async function main() {
    const urlParams = new URLSearchParams(window.location.search);
    const isEditable = urlParams.get("editable") === "1";

    const hideToolbar = urlParams.get("toolbar") === "0";
    document.body.classList.toggle("read-only-document", !isEditable);
    document.body.classList.toggle("no-toolbar", hideToolbar);

    if (urlParams.get("sidebar") === "0") {
        hideSidebar();
    }

    if (isEditable) {
        interceptPersistence();
    }

    configurePdfViewerOptions();

    // Wait for the PDF viewer application to be available.
    while (!window.PDFViewerApplication) {
        await new Promise(r => setTimeout(r, 50));
    }
    const app = window.PDFViewerApplication;

    manageParentCommands();

    app.eventBus.on("documentloaded", () => {
        setupPdfAnnotations();
    });

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
            // Must be after manageSave() so we chain onto its onSetModified
            setupAnnotationLiveUpdates();
        });
    }
    await app.initializedPromise;
};

function configurePdfViewerOptions() {
    const urlParams = new URLSearchParams(window.location.search);
    const locale = urlParams.get("locale");

    const pdfOptionsHandler = (event: CustomEvent) => {
        if (event.detail?.source === window && window.PDFViewerApplicationOptions) {
            window.PDFViewerApplicationOptions.set("disablePreferences", true);
            window.PDFViewerApplicationOptions.set("enableHighlightFloatingButton", true);
            window.PDFViewerApplicationOptions.set("enableComment", true);
            if (locale) {
                window.PDFViewerApplicationOptions.set("localeProperties", { lang: locale });
            }
        }
    };

    const isInIframe = window.parent && window.parent !== window;
    if (isInIframe) {
        window.parent.addEventListener("webviewerloaded", pdfOptionsHandler, { once: true });
        window.addEventListener("pagehide", () => window.parent?.removeEventListener("webviewerloaded", pdfOptionsHandler));
    } else {
        document.addEventListener("webviewerloaded", pdfOptionsHandler, { once: true });
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
            // Re-extract annotations from the saved data so new
            // highlights get their overlaidText populated.
            extractFromSavedData(data);
        }
    });

    (app.pdfDocument.annotationStorage as any).onSetModified = () => {
        onChange();
    };  // works great for most cases, including forms.
    app.eventBus.on("switchannotationeditorparams", () => {
        onChange();
    });
    // Catches deletions of existing annotations, undo/redo, and comment deletion
    // which don't trigger onSetModified or switchannotationeditorparams.
    // Only trigger when there are actual unsaved changes, not on selection.
    app.eventBus.on("editingstateschanged", ({ details }: { details: Record<string, boolean> }) => {
        if (details.hasSomethingToUndo) {
            onChange();
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

function manageParentCommands() {
    window.addEventListener("message", event => {
        if (event.origin !== window.location.origin) return;

        if (event.data?.type === "trilium-print") {
            window.print();
        }

        if (event.data?.type === "trilium-find") {
            window.PDFViewerApplication?.findBar?.open();
        }
    });
}

main();
