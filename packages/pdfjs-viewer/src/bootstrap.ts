import interceptPersistence from "./persistence";
import { extractAndSendToc, setupScrollToHeading, setupActiveHeadingTracking } from "./toc";
import { setupPdfPages } from "./pages";
import { setupPdfAttachments } from "./attachments";
import { setupPdfLayers } from "./layers";
import { setupPdfAnnotations, setupAnnotationLiveUpdates } from "./annotations";
import { commitPendingAnnotationEdits, isAnnotationEditingActive, setAnnotationEditorUIManager, suppressViewerUnloadPrompt } from "./editing";

export async function main() {
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
export function applyMinPixelRatio(urlParams: URLSearchParams) {
    const minPixelRatio = Number(urlParams.get("minPixelRatio"));
    if (!Number.isFinite(minPixelRatio) || minPixelRatio <= 0) return;
    if ((window.devicePixelRatio || 1) >= minPixelRatio) return;

    Object.defineProperty(window, "devicePixelRatio", {
        configurable: true,
        get: () => minPixelRatio
    });
}

export function configurePdfViewerOptions() {
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

export function hideSidebar() {
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

export function manageSave() {
    const app = window.PDFViewerApplication;
    const storage = app.pdfDocument.annotationStorage;
    let pointerDown = false;
    let pointerDownOnPage = false;

    // What the document held when the parent was last told about it. Compared against, rather
    // than trusted, because pdf.js reports far more than actual changes — see reportIfChanged.
    let reportedHash = serializedHash() ?? "";

    /**
     * A digest of everything `saveDocument()` would write out, or `null` while the document
     * cannot be serialized at all. pdf.js serializes an annotation it has not modified to nothing
     * at all, so this stays put while the ones already stored in the document are registered, and
     * moves as soon as one is genuinely edited.
     *
     * Unserializable is a state pdf.js passes through rather than an error: it stores an editor
     * before finishing it, so pressing "Add signature" leaves one with no outlines in
     * `annotationStorage` until the signature dialog resolves. Callers substitute the hash they
     * already hold, which counts the document as unchanged until the editor is complete.
     */
    function serializedHash(): string | null {
        try {
            return (storage as any).serializable.hash;
        } catch {
            return null;
        }
    }

    /**
     * Reports a possible modification, without asking whether the document really changed —
     * for signals that can be raised by an edit `annotationStorage` cannot see yet. An ink
     * drawing session lives outside it until committed, so an interaction that might have
     * extended one has to be passed on blind.
     */
    function onChange() {
        reportedHash = serializedHash() ?? reportedHash;
        storage.resetModified();
        announceModified();
    }

    /**
     * Reports a modification only when the document really did change.
     *
     * Both signals routed here fire freely on their own: registering the annotations already
     * stored on a page raises the storage hook once per annotation, on every toolbar press and
     * as each annotated page scrolls into view, and a tool's colour picker announces a parameter
     * change even with nothing selected, where it only sets what the *next* annotation will look
     * like. Either one had the parent re-serialise and re-upload the whole PDF for nothing
     * (#11059).
     *
     * Safe for the parameter change because pdf.js applies it before this runs: its own listener
     * was registered at start-up, ours during `documentloaded`, and the event bus calls them in
     * registration order.
     */
    function reportIfChanged() {
        // Cleared whether or not this turns into an announcement: pdf.js raises the storage hook
        // once per dirtying, so a flag left set would swallow the next real change.
        storage.resetModified();

        const hash = serializedHash() ?? reportedHash;
        if (hash === reportedHash) return;
        reportedHash = hash;
        announceModified();
    }

    function announceModified() {
        window.parent.postMessage({
            type: "pdfjs-viewer-document-modified",
            ntxId: window.TRILIUM_NTX_ID,
            noteId: window.TRILIUM_NOTE_ID
        } satisfies PdfDocumentModifiedMessage, window.location.origin);
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
        }
    });

    (app.pdfDocument.annotationStorage as any).onSetModified = () => {
        reportIfChanged();
    };  // works great for most cases, including forms.
    app.eventBus.on("switchannotationeditorparams", () => {
        reportIfChanged();
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

export function manageParentCommands() {
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

