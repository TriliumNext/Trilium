import interceptPersistence from "./persistence";
import { extractAndSendToc, setupScrollToHeading, setupActiveHeadingTracking } from "./toc";
import { setupPdfPages } from "./pages";
import { setupPdfAttachments } from "./attachments";
import { setupPdfLayers } from "./layers";
import { setupPdfAnnotations, setupAnnotationLiveUpdates, extractFromSavedData } from "./annotations";
import { commitPendingAnnotationEdits, isAnnotationEditingActive, setAnnotationEditorUIManager, suppressViewerUnloadPrompt } from "./editing";

async function main() {
    const urlParams = new URLSearchParams(window.location.search);
    const isEditable = urlParams.get("editable") === "1";

    applyMinPixelRatio(urlParams);

    const hideToolbar = urlParams.get("toolbar") === "0";
    document.body.classList.toggle("read-only-document", !isEditable);
    document.body.classList.toggle("no-toolbar", hideToolbar);

    if (urlParams.get("sidebar") === "0") {
        hideSidebar();
    }

    if (isEditable) {
        interceptPersistence();
        // Trilium owns the unsaved-changes prompt; pdf.js' own one would fire on every
        // reload once an annotation exists, even after saving. Must stay before the first
        // await so it registers ahead of viewer.mjs' listener.
        suppressViewerUnloadPrompt();
    }

    configurePdfViewerOptions();

    // Wait for the PDF viewer application to be available.
    while (!window.PDFViewerApplication) {
        await new Promise(r => setTimeout(r, 50));
    }
    const app = window.PDFViewerApplication;

    manageParentCommands();

    // Needed to commit in-progress annotation edits before saving; pdf.js recreates the
    // manager for each loaded document.
    app.eventBus.on("annotationeditoruimanager", ({ uiManager }) => {
        setAnnotationEditorUIManager(uiManager);
    });

    app.eventBus.on("documentloaded", () => {
        setupPdfAnnotations();
    });

    if (isEditable) {
        app.eventBus.on("documentloaded", () => {
            manageSave();
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

/**
 * Forces a minimum device-pixel-ratio for canvas rasterization. PDF.js sizes each page's
 * canvas backing store by `globalThis.devicePixelRatio` (read dynamically at render time via
 * `OutputScale`), so on a standard-DPI display (DPR 1) pages render at 1× and text/headings
 * look coarsely anti-aliased. Overriding the getter to a higher minimum supersamples the
 * canvas — the same crispness a high-DPI screen gets for free — without changing layout size.
 */
function applyMinPixelRatio(urlParams: URLSearchParams) {
    const minPixelRatio = Number(urlParams.get("minPixelRatio"));
    if (!Number.isFinite(minPixelRatio) || minPixelRatio <= 0) return;
    if ((window.devicePixelRatio || 1) >= minPixelRatio) return;

    Object.defineProperty(window, "devicePixelRatio", {
        configurable: true,
        get: () => minPixelRatio
    });
}

function configurePdfViewerOptions() {
    const urlParams = new URLSearchParams(window.location.search);
    const locale = urlParams.get("locale");

    const pdfOptionsHandler = (event: CustomEvent) => {
        if (event.detail?.source === window && window.PDFViewerApplicationOptions) {
            window.PDFViewerApplicationOptions.set("disablePreferences", true);
            window.PDFViewerApplicationOptions.set("enableHighlightFloatingButton", true);
            window.PDFViewerApplicationOptions.set("enableComment", true);
            window.PDFViewerApplicationOptions.set("enableSignatureEditor", true);
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
    let pointerDown = false;
    let pointerDownOnPage = false;

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
            // An in-progress edit (e.g. an uncommitted ink drawing session) is not part of
            // annotationStorage yet and would be silently dropped by saveDocument().
            commitPendingAnnotationEdits(pointerDown);
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

    // While an annotation editing tool is active, most edits leave no observable trace:
    // only the first stroke of an ink drawing session flips hasSomethingToUndo — later
    // strokes accumulate in the uncommitted session without touching annotationStorage.
    // Treat the end of every pointer/keyboard interaction on a page as a potential
    // modification so the parent (re)schedules a save; a save without actual changes is
    // harmless. The pointer-down state also tells commitPendingAnnotationEdits() not to
    // commit while a stroke is still being drawn — the pointerup nudge below then
    // re-requests the save that had to skip the commit.
    const isOnPage = (event: Event) => event.target instanceof Element && !!event.target.closest(".page");
    window.addEventListener("pointerdown", (event) => {
        pointerDown = true;
        pointerDownOnPage = isOnPage(event);
    }, { capture: true });
    const onPointerEnd = (event: Event) => {
        pointerDown = false;
        // Strokes are tracked window-wide by pdf.js, so they can end outside the page —
        // what matters is where the interaction started.
        if ((pointerDownOnPage || isOnPage(event)) && isAnnotationEditingActive()) {
            onChange();
        }
    };
    window.addEventListener("pointerup", onPointerEnd, { capture: true });
    window.addEventListener("pointercancel", onPointerEnd, { capture: true });
    window.addEventListener("keyup", (event) => {
        if (isOnPage(event) && isAnnotationEditingActive()) {
            onChange();
        }
    }, { capture: true });
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
