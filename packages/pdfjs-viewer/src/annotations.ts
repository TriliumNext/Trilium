// PDF annotation type constants (from PDF spec / pdfjs-dist AnnotationType)
export const AnnotationType = {
    TEXT: 1,
    FREETEXT: 3,
    HIGHLIGHT: 9,
    INK: 15,
} as const;

/**
 * Annotation types we display in the sidebar — one per tool the viewer's editing toolbar offers,
 * plus the sticky notes other editors leave behind. The mapping from tool to type is not the
 * obvious one: a highlight drawn free-hand rather than over selected text is written as Ink, and
 * the text tool produces FreeText, so covering only Highlight hid most of what users draw.
 */
const COMMENT_TYPES = new Set<number>([
    AnnotationType.TEXT,
    AnnotationType.FREETEXT,
    AnnotationType.HIGHLIGHT,
    AnnotationType.INK,
]);

/**
 * Settles once pdf.js has applied the document's initial view, which restores the last-read
 * position and would undo a scroll made before it. Already settled unless
 * {@link trackInitialView} was called.
 */
let initialViewApplied: Promise<void> = Promise.resolve();

const TYPE_NAMES: Record<number, string> = {
    [AnnotationType.TEXT]: "text",
    [AnnotationType.FREETEXT]: "freetext",
    [AnnotationType.HIGHLIGHT]: "highlight",
    [AnnotationType.INK]: "ink",
};

/**
 * Process a raw PDF.js annotation object into a normalized PdfAnnotationInfo,
 * or return null if it should be skipped.
 */
export function processAnnotation(ann: Record<string, any>, pageNumber: number): PdfAnnotationInfo | null {
    if (!COMMENT_TYPES.has(ann.annotationType)) {
        return null;
    }

    // Both can be empty: a drawing carries no text at all, and pdf.js only fills overlaidText
    // for a highlight whose quadpoints cover extractable glyphs — never on a scanned page. The
    // sidebar labels such an entry by its type, so the annotation is still reachable.
    const contents = ann.contentsObj?.str || "";
    const highlightedText = ann.overlaidText || "";

    return {
        id: ann.id,
        type: resolveTypeName(ann),
        contents,
        highlightedText,
        author: ann.titleObj?.str || "",
        pageNumber,
        color: ann.color ? rgbToHex(ann.color) : null,
        creationDate: ann.creationDate || null,
        modificationDate: ann.modificationDate || null
    };
}

/**
 * The kind the sidebar names an annotation by. A highlight drawn free-hand is stored as an Ink
 * annotation tagged `/IT /InkHighlight` — a storage detail of pdf.js, not something the reader
 * chose, so it is reported as the highlight it is rather than as a drawing.
 */
function resolveTypeName(ann: Record<string, any>): string {
    if (ann.annotationType === AnnotationType.INK && ann.it === "InkHighlight") {
        return TYPE_NAMES[AnnotationType.HIGHLIGHT];
    }

    return TYPE_NAMES[ann.annotationType];
}

/**
 * Holds back {@link scrollToAnnotation} until pdf.js has applied the initial view. pdf.js applies
 * it at `documentinit` and, when the pages differ in size, once more after `pagesPromise`. Must be
 * called before the document loads.
 */
export function trackInitialView(app: NonNullable<Window["PDFViewerApplication"]>) {
    initialViewApplied = new Promise((resolve) => {
        app.eventBus.on("documentinit", () => {
            void app.pdfViewer.pagesPromise.then(() => requestAnimationFrame(() => resolve()));
        }, { once: true });
    });
}

export async function setupPdfAnnotations() {
    await extractAndSendAnnotations();

    window.addEventListener("message", (event) => {
        if (event.origin !== window.location.origin) return;

        if (event.data?.type === "trilium-scroll-to-annotation") {
            void scrollToAnnotation(event.data.annotationId, event.data.pageNumber);
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
        const storage = app.pdfDocument.annotationStorage;
        const annotations = await extractFromDocument(app.pdfDocument);
        sendAnnotations([ ...applyEditorOverrides(annotations, storage), ...unsavedAnnotations(storage) ]);
    } catch (error) {
        console.error("Error extracting annotations:", error);
        sendAnnotations([]);
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

/**
 * Layers the in-session editing state over the annotations read from the document: until a
 * save is written back, deletions and edits live only in the editor, not in the file.
 *
 * Returns a new array rather than removing entries from the one being iterated — splicing
 * shifted the following annotation into the index the loop had just consumed, skipping it, so
 * deleting adjacent annotations left every second one in the sidebar until the next save.
 */
function applyEditorOverrides(annotations: PdfAnnotationInfo[], storage: any): PdfAnnotationInfo[] {
    const remaining: PdfAnnotationInfo[] = [];

    for (const ann of annotations) {
        const editor = storage.getEditor?.(ann.id);
        if (editor?.deleted) {
            continue;
        }
        if (editor?.color && ann.type !== "freetext") {
            ann.color = editor.color;
        }
        if (editor?.comment?.text) {
            ann.contents = editor.comment.text;
        }
        remaining.push(ann);
    }

    return remaining;
}

/**
 * Sidebar entries for annotations that exist only in the editor so far.
 *
 * pdf.js keeps what the reader draws out of the loaded document until the file is written back,
 * and {@link applyEditorOverrides} can only amend what the document already holds — so a sidebar
 * built from the document alone stays empty however much is annotated, until the note is reopened
 * (#11059). `annotationStorage.serializable` is the same view `saveDocument()` writes from: keyed
 * by the editor's own id, which is also the id of the element it renders, so an entry built here
 * is one {@link scrollToAnnotation} can navigate to.
 */
function unsavedAnnotations(storage: any): PdfAnnotationInfo[] {
    const unsaved: PdfAnnotationInfo[] = [];

    for (const [ id, serialized ] of storage?.serializable?.map ?? []) {
        // `id` names the document annotation an editor was built from; the entry for one of those
        // is already in the list, carrying the text and author only the document knows.
        if (serialized.id || serialized.deleted) {
            continue;
        }
        const type = TYPE_NAMES[serialized.annotationType];
        if (!type) {
            continue;
        }

        unsaved.push({
            id,
            type,
            // A free-text box serializes the words it was given; nothing else carries text. A
            // highlight's overlaidText is derived from the file's glyphs, so it only appears once
            // the document has been written back.
            contents: typeof serialized.value === "string" ? serialized.value : "",
            highlightedText: "",
            author: "",
            pageNumber: serialized.pageIndex + 1,
            // As in applyEditorOverrides: a text box's colour is that of its text, not a tint.
            color: serialized.color && type !== "freetext" ? rgbToHex(serialized.color) : null,
            creationDate: null,
            modificationDate: null
        });
    }

    return unsaved;
}

function sendAnnotations(annotations: PdfAnnotationInfo[]) {
    window.parent.postMessage({
        type: "pdfjs-viewer-annotations",
        annotations,
        ntxId: window.TRILIUM_NTX_ID,
        noteId: window.TRILIUM_NOTE_ID
    } satisfies PdfViewerAnnotationsMessage, window.location.origin);
}

/**
 * Centres an annotation in the viewer, or turns to the top of `pageNumber` when `annotationId` is
 * not given or names no annotation on the page.
 *
 * Works from the annotation's rectangle in the document rather than from its rendered element:
 * pdf.js renders a page only once it nears the viewport, and while an annotation tool is active it
 * hides each editable annotation's element behind an editor.
 *
 * The scroll is instant and followed by `pdfViewer.update()`, which records the new position. On a
 * resize, pdf.js reapplies an "auto" zoom and scrolls back to the position it last recorded, and a
 * viewer shown again after being hidden resizes in the same frame as the scroll.
 */
async function scrollToAnnotation(annotationId: string | undefined, pageNumber: number) {
    await initialViewApplied;
    const app = window.PDFViewerApplication;
    if (!app) return;

    const rect = annotationId ? await findAnnotationRect(annotationId, pageNumber) : null;
    // In single-page scroll mode the viewer holds only the current page's element, so the page
    // is turned to before its element is measured.
    app.pdfViewer.currentPageNumber = pageNumber;
    const pageView = app.pdfViewer.getPageView(pageNumber - 1);
    if (!rect || !pageView) {
        app.pdfViewer.update();
        return;
    }

    // The viewport maps PDF units, which grow upwards, to the page's CSS pixels at the current
    // zoom and rotation.
    const [ x1, y1 ] = pageView.viewport.convertToViewportPoint(rect[0], rect[1]);
    const [ x2, y2 ] = pageView.viewport.convertToViewportPoint(rect[2], rect[3]);
    const { div } = pageView;
    const container = app.pdfViewer.container;
    container.scrollTo({
        left: div.offsetLeft + div.clientLeft + (x1 + x2 - container.clientWidth) / 2,
        top: div.offsetTop + div.clientTop + (y1 + y2 - container.clientHeight) / 2,
        behavior: "instant"
    });
    app.pdfViewer.update();
}

/**
 * The rectangle of an annotation in PDF units, or `null` if it is not on the page or was deleted.
 * An annotation edited in this session is read from `annotationStorage`, which holds where it is
 * now and is keyed by the editor's id, with `id` naming the document annotation it edits.
 */
async function findAnnotationRect(annotationId: string, pageNumber: number): Promise<number[] | null> {
    const app = window.PDFViewerApplication;
    if (!app) return null;

    const storage: any = app.pdfDocument.annotationStorage;
    for (const [ id, serialized ] of storage?.serializable?.map ?? []) {
        if (id === annotationId || serialized.id === annotationId) {
            return serialized.deleted ? null : serialized.rect ?? null;
        }
    }

    try {
        const page = await app.pdfDocument.getPage(pageNumber);
        const annotations = await page.getAnnotations({ intent: "display" });
        return annotations.find((ann: Record<string, any>) => ann.id === annotationId)?.rect ?? null;
    } catch {
        // A page number past the end of the document, from a link to an older version of it.
        return null;
    }
}

export function rgbToHex(rgb: Uint8ClampedArray | Record<number, number> | number[]): string {
    const r = rgb[0];
    const g = rgb[1];
    const b = rgb[2];
    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}
