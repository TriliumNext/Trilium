// PDF annotation type constants (from PDF spec / pdfjs-dist AnnotationType)
export const AnnotationType = {
    TEXT: 1,
    HIGHLIGHT: 9,
} as const;

/** Annotation types we display in the sidebar. */
const COMMENT_TYPES = new Set([
    AnnotationType.TEXT,
    AnnotationType.HIGHLIGHT,
]);

const TYPE_NAMES: Record<number, string> = {
    [AnnotationType.TEXT]: "text",
    [AnnotationType.HIGHLIGHT]: "highlight",
};

/**
 * Process a raw PDF.js annotation object into a normalized PdfAnnotationInfo,
 * or return null if it should be skipped.
 */
export function processAnnotation(ann: Record<string, any>, pageNumber: number): PdfAnnotationInfo | null {
    if (!COMMENT_TYPES.has(ann.annotationType)) {
        return null;
    }

    const contents = ann.contentsObj?.str || "";
    const highlightedText = ann.overlaidText || "";

    // Skip annotations that have no meaningful content
    if (!contents && !highlightedText) {
        return null;
    }

    return {
        id: ann.id,
        type: TYPE_NAMES[ann.annotationType] ?? "unknown",
        contents,
        highlightedText,
        author: ann.titleObj?.str || "",
        pageNumber,
        color: ann.color ? rgbToHex(ann.color) : null,
        creationDate: ann.creationDate || null,
        modificationDate: ann.modificationDate || null
    };
}

export async function setupPdfAnnotations() {
    await extractAndSendAnnotations();

    window.addEventListener("message", (event) => {
        if (event.origin !== window.location.origin) return;

        if (event.data?.type === "trilium-scroll-to-annotation") {
            scrollToAnnotation(event.data.annotationId, event.data.pageNumber);
        }

        if (event.data?.type === "trilium-request-annotations") {
            extractAndSendAnnotations();
        }

        if (event.data?.type === "trilium-set-annotation-color") {
            setAnnotationColor(event.data.annotationId, event.data.color);
        }

        if (event.data?.type === "trilium-delete-annotation") {
            deleteAnnotationById(event.data.annotationId, event.data.pageNumber);
        }
    });
}

/**
 * Must be called AFTER manageSave() so we can chain onto the
 * onSetModified callback it installs.
 */
export function setupAnnotationLiveUpdates() {
    const app = window.PDFViewerApplication!;
    const storage = app.pdfDocument.annotationStorage;

    let debounceTimer: number | null = null;
    const debouncedRefresh = () => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = window.setTimeout(() => extractAndSendAnnotations(), 500);
    };

    // Chain onto the existing onSetModified set by manageSave.
    // Fires when annotations are added/removed.
    const previousOnSetModified = (storage as any).onSetModified;
    (storage as any).onSetModified = () => {
        previousOnSetModified?.();
        debouncedRefresh();
    };

    // Fires when editor properties change (e.g. color, thickness).
    app.eventBus.on("annotationeditorparamschanged", debouncedRefresh);

    // Catches deletions, undo/redo, and comment deletion which
    // don't trigger onSetModified or annotationeditorparamschanged.
    app.eventBus.on("editingstateschanged", debouncedRefresh);
}

async function extractAndSendAnnotations() {
    const app = window.PDFViewerApplication;
    try {
        const annotations = await extractFromDocument(app.pdfDocument);
        applyEditorOverrides(annotations, app.pdfDocument.annotationStorage);
        sendAnnotations(annotations);
    } catch (error) {
        console.error("Error extracting annotations:", error);
        sendAnnotations([]);
    }
}

/**
 * Re-extract annotations from freshly saved PDF bytes.
 * Opens a temporary document to read the latest data (including
 * newly created highlights with their overlaidText), then closes it.
 */
export async function extractFromSavedData(data: ArrayBuffer | Uint8Array) {
    let loadingTask: any;
    try {
        loadingTask = (globalThis as any).pdfjsLib.getDocument({ data });
        const tempDoc = await loadingTask.promise;
        const annotations = await extractFromDocument(tempDoc);
        sendAnnotations(annotations);
    } catch (error) {
        console.error("Error extracting annotations from saved data:", error);
    } finally {
        // PDFDocumentProxy.destroy() was removed in pdf.js v6; tear the temporary
        // document (and its worker) down via the loading task instead.
        await loadingTask?.destroy();
    }
}

async function extractFromDocument(pdfDocument: any): Promise<PdfAnnotationInfo[]> {
    const numPages = pdfDocument.numPages;
    const annotations: PdfAnnotationInfo[] = [];

    for (let i = 1; i <= numPages; i++) {
        const page = await pdfDocument.getPage(i);
        const pageAnnotations = await page.getAnnotations({ intent: "display" });

        for (const ann of pageAnnotations) {
            const processed = processAnnotation(ann, i);
            if (processed) {
                annotations.push(processed);
            }
        }
    }

    return annotations;
}

function applyEditorOverrides(annotations: PdfAnnotationInfo[], storage: any) {
    for (const ann of annotations) {
        const editor = storage.getEditor?.(ann.id);
        if (!editor) continue;
        if (editor.deleted) {
            annotations.splice(annotations.indexOf(ann), 1);
            continue;
        }
        if (editor.color) {
            ann.color = editor.color;
        }
        if (editor.comment?.text) {
            ann.contents = editor.comment.text;
        }
    }
}

function sendAnnotations(annotations: PdfAnnotationInfo[]) {
    window.parent.postMessage({
        type: "pdfjs-viewer-annotations",
        annotations
    } satisfies PdfViewerAnnotationsMessage, window.location.origin);
}

// Tracks the pending MutationObserver so a new scroll request can cancel the old one.
// Without this, clicking annotation B while A's observer is still waiting causes A's
// observer to fire later and scroll back to A.
let activeScrollObserver: MutationObserver | null = null;

function scrollToAnnotation(annotationId: string, pageNumber: number) {
    // Cancel any pending scroll from a previous request before starting a new one.
    if (activeScrollObserver) {
        activeScrollObserver.disconnect();
        activeScrollObserver = null;
    }

    const app = window.PDFViewerApplication;
    const container = app.pdfViewer.container as HTMLElement;

    function scrollToEl(el: Element) {
        const containerRect = container.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        const offsetTop = elRect.top - containerRect.top + container.scrollTop;
        container.scrollTo({
            top: offsetTop - container.clientHeight / 2 + elRect.height / 2,
            behavior: "smooth"
        });
    }

    // Try to find the element directly (nearby pages are pre-rendered)
    const el = document.querySelector(`[data-annotation-id="${CSS.escape(annotationId)}"]`);
    if (el) {
        scrollToEl(el);
        return;
    }

    // Element not in DOM yet. Scroll the container to the estimated position of the
    // target page instead of using app.pdfViewer.currentPageNumber = pageNumber.
    //
    // The currentPageNumber setter calls PDF.js's scrollPageIntoView, which checks
    // the page div's offsetParent. When the PDF is cached and loads fast, PDF.js's
    // virtual scroller may have removed off-screen page divs from the DOM, making
    // their offsetParent null → "offsetParent is not set -- cannot scroll" → the
    // viewport never moves → the annotation div never renders → MutationObserver times out.
    //
    // Scrolling the container directly bypasses that check. PDF.js's scroll handler
    // then renders pages around the new viewport position, making the annotation
    // element appear in the DOM.
    const numPages = app.pdfDocument?.numPages ?? 1;
    const estimatedTop = (container.scrollHeight / numPages) * (pageNumber - 1);
    container.scrollTo({ top: estimatedTop, behavior: "smooth" });

    const observer = new MutationObserver(() => {
        const found = document.querySelector(`[data-annotation-id="${CSS.escape(annotationId)}"]`);
        if (found) {
            observer.disconnect();
            if (activeScrollObserver === observer) {
                activeScrollObserver = null;
            }
            scrollToEl(found);
        }
    });
    activeScrollObserver = observer;
    observer.observe(document.getElementById("viewer")!, { childList: true, subtree: true });
    // Clean up if annotation never appears
    setTimeout(() => {
        observer.disconnect();
        if (activeScrollObserver === observer) {
            activeScrollObserver = null;
        }
    }, 3000);
}

export function rgbToHex(rgb: Uint8ClampedArray | Record<number, number> | number[]): string {
    const r = rgb[0];
    const g = rgb[1];
    const b = rgb[2];
    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

function hexToRgb(hex: string): [number, number, number] {
    const v = parseInt(hex.replace("#", ""), 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function setAnnotationColor(annotationId: string, color: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const storage: any = window.PDFViewerApplication?.pdfDocument?.annotationStorage;
    if (!storage) return;

    const editor = storage.getEditor?.(annotationId);
    if (editor) {
        // PDF.js stores highlight colours as an RGB array (0-255 per channel).
        // Setting .color and calling onSetModified triggers the auto-save flow.
        editor.color = hexToRgb(color);
        storage.onSetModified?.();
    } else {
        storage.setValue?.(annotationId, { color: hexToRgb(color) });
    }
}

function deleteAnnotationById(annotationId: string, _pageNumber: number) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const storage: any = window.PDFViewerApplication?.pdfDocument?.annotationStorage;
    if (!storage) return;

    const editor = storage.getEditor?.(annotationId);
    if (editor) {
        if (typeof editor.remove === "function") {
            editor.remove();
        } else {
            storage.setValue?.(annotationId, { deleted: true });
            storage.onSetModified?.();
        }
    } else {
        storage.setValue?.(annotationId, { deleted: true });
        storage.onSetModified?.();
    }
}
