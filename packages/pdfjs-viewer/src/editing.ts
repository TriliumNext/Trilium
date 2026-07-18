/**
 * Glue around pdf.js' annotation *editing* state, used by the save flow in `custom.ts`.
 *
 * pdf.js keeps in-progress edits — an ink/highlight drawing session, or a free-text editor
 * that is still focused — outside of `annotationStorage` until they are committed, which
 * normally only happens on a mode switch, Escape or focus loss. `saveDocument()` serializes
 * `annotationStorage` only, so saving while such an edit is pending silently drops it. The
 * stock viewer does not hit this because its Ctrl+S keyboard handler commits first; Trilium's
 * postMessage-driven save has to commit explicitly.
 */

/** Matches `AnnotationEditorType.NONE` in pdf.js — no annotation editing tool is active. */
export const ANNOTATION_EDITOR_MODE_NONE = 0;

/** The subset of pdf.js' `AnnotationEditorUIManager` that the save flow relies on. */
export interface AnnotationEditorUIManagerLike {
    getMode(): number;
    getActive(): { isInEditMode(): boolean } | null;
    unselectAll(): void;
}

let currentUIManager: AnnotationEditorUIManagerLike | null = null;

/**
 * Stores the manager announced via the `annotationeditoruimanager` event bus event.
 * pdf.js recreates the manager for each loaded document.
 */
export function setAnnotationEditorUIManager(uiManager: AnnotationEditorUIManagerLike | null) {
    currentUIManager = uiManager;
}

export function getAnnotationEditorUIManager(): AnnotationEditorUIManagerLike | null {
    // Prefer the instance captured from the event bus, but fall back to the viewer's layer
    // properties in case the event fired before our listener was registered.
    return currentUIManager
        ?? (window.PDFViewerApplication?.pdfViewer as any)?._layerProperties?.annotationEditorUIManager
        ?? null;
}

/**
 * Whether an annotation editing tool (ink, highlight, free text, ...) is currently active.
 * While one is, edits can accumulate without any observable event — only the first stroke of
 * an ink drawing session flips `hasSomethingToUndo`; later strokes stay in the uncommitted
 * session without touching `annotationStorage` — so user interactions need to be treated as
 * potential modifications.
 */
export function isAnnotationEditingActive(uiManager: AnnotationEditorUIManagerLike | null = getAnnotationEditorUIManager()): boolean {
    return !!uiManager && uiManager.getMode() !== ANNOTATION_EDITOR_MODE_NONE;
}

/**
 * Commits pending annotation edits into `annotationStorage` so that a subsequent
 * `saveDocument()` includes them — unless the user is literally mid-interaction: committing
 * during an ink stroke would cut the stroke short, and committing a focused free-text editor
 * would steal the caret. Skipped edits are picked up by a later save, re-requested by the
 * interaction-end listeners in `manageSave()`.
 */
export function commitPendingAnnotationEdits(isPointerDown: boolean, uiManager: AnnotationEditorUIManagerLike | null = getAnnotationEditorUIManager()) {
    try {
        if (!uiManager || uiManager.getMode() === ANNOTATION_EDITOR_MODE_NONE) return;
        if (isPointerDown || uiManager.getActive()?.isInEditMode()) return;

        // unselectAll() commits the active editor and ends any in-progress drawing session —
        // the same code path pdf.js runs when Escape is pressed.
        uiManager.unselectAll();
    } catch (e) {
        // The commit is best-effort; never let it break the save itself.
        console.warn("Could not commit pending annotation edits:", e);
    }
}

/**
 * Suppresses the stock viewer's "confirm that you want to leave" prompt. pdf.js prompts
 * whenever `annotationStorage` is non-empty (`onBeforeUnload`/`_hasChanges()` in viewer.mjs),
 * and the storage keeps its entries for the lifetime of the document — so once anything has
 * been annotated, every reload prompts forever, even long after Trilium stored the document.
 * The prompt is also redundant in this embedding: every modification is announced to the
 * parent via `pdfjs-viewer-document-modified`, and the Trilium client's own beforeunload
 * guard already blocks unloading until the resulting upload has finished.
 *
 * Must be called while custom.mjs is still evaluating, before viewer.mjs registers its own
 * listener: beforeunload listeners run in registration order, and only an earlier listener
 * can cancel the stock one via `stopImmediatePropagation()`.
 */
export function suppressViewerUnloadPrompt(target: EventTarget = window) {
    target.addEventListener("beforeunload", (event) => {
        event.stopImmediatePropagation();
    });
}
