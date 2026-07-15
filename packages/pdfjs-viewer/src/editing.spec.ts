import { afterEach, describe, expect, it, vi } from "vitest";
import {
    ANNOTATION_EDITOR_MODE_NONE,
    AnnotationEditorUIManagerLike,
    commitPendingAnnotationEdits,
    getAnnotationEditorUIManager,
    isAnnotationEditingActive,
    setAnnotationEditorUIManager,
    suppressViewerUnloadPrompt
} from "./editing";

const INK_MODE = 15; // AnnotationEditorType.INK

function buildManager(overrides: Partial<AnnotationEditorUIManagerLike> = {}): AnnotationEditorUIManagerLike {
    return {
        getMode: () => INK_MODE,
        getActive: () => null,
        unselectAll: vi.fn(),
        ...overrides
    };
}

afterEach(() => {
    setAnnotationEditorUIManager(null);
    vi.restoreAllMocks();
});

describe("commitPendingAnnotationEdits", () => {
    it("commits in-progress edits via unselectAll when an editing tool is active", () => {
        const manager = buildManager();
        commitPendingAnnotationEdits(false, manager);
        expect(manager.unselectAll).toHaveBeenCalledOnce();

        // Also commits when an editor is active but no longer being edited.
        const withIdleEditor = buildManager({ getActive: () => ({ isInEditMode: () => false }) });
        commitPendingAnnotationEdits(false, withIdleEditor);
        expect(withIdleEditor.unselectAll).toHaveBeenCalledOnce();
    });

    it("does nothing without a manager or outside of an editing mode", () => {
        expect(() => commitPendingAnnotationEdits(false, null)).not.toThrow();

        const manager = buildManager({ getMode: () => ANNOTATION_EDITOR_MODE_NONE });
        commitPendingAnnotationEdits(false, manager);
        expect(manager.unselectAll).not.toHaveBeenCalled();
    });

    it("skips the commit while the user is mid-interaction", () => {
        // A stroke is being drawn (pointer down).
        const whileDrawing = buildManager();
        commitPendingAnnotationEdits(true, whileDrawing);
        expect(whileDrawing.unselectAll).not.toHaveBeenCalled();

        // A free-text editor is focused.
        const whileTyping = buildManager({ getActive: () => ({ isInEditMode: () => true }) });
        commitPendingAnnotationEdits(false, whileTyping);
        expect(whileTyping.unselectAll).not.toHaveBeenCalled();
    });

    it("never lets a commit failure propagate into the save", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const manager = buildManager({
            unselectAll: () => {
                throw new Error("pdf.js internal change");
            }
        });
        expect(() => commitPendingAnnotationEdits(false, manager)).not.toThrow();
        expect(warn).toHaveBeenCalledOnce();
    });
});

describe("isAnnotationEditingActive", () => {
    it("is true only when a manager exists and a tool is selected", () => {
        expect(isAnnotationEditingActive(null)).toBe(false);
        expect(isAnnotationEditingActive(buildManager({ getMode: () => ANNOTATION_EDITOR_MODE_NONE }))).toBe(false);
        expect(isAnnotationEditingActive(buildManager())).toBe(true);
    });
});

describe("suppressViewerUnloadPrompt", () => {
    it("stops the stock beforeunload prompt, but only when registered ahead of it", () => {
        // custom.mjs evaluates before viewer.mjs, so our listener registers first and can
        // cancel the stock one before it calls preventDefault().
        const windowTarget = new EventTarget();
        suppressViewerUnloadPrompt(windowTarget);
        windowTarget.addEventListener("beforeunload", (event) => event.preventDefault());
        const suppressed = new Event("beforeunload", { cancelable: true });
        windowTarget.dispatchEvent(suppressed);
        expect(suppressed.defaultPrevented).toBe(false);

        // Registration order is load-bearing: registered after the stock listener, the
        // suppression would come too late.
        const lateTarget = new EventTarget();
        lateTarget.addEventListener("beforeunload", (event) => event.preventDefault());
        suppressViewerUnloadPrompt(lateTarget);
        const tooLate = new Event("beforeunload", { cancelable: true });
        lateTarget.dispatchEvent(tooLate);
        expect(tooLate.defaultPrevented).toBe(true);
    });
});

describe("getAnnotationEditorUIManager", () => {
    it("returns the captured manager, falling back to the viewer's layer properties", () => {
        const fallbackManager = buildManager();
        vi.stubGlobal("window", {
            PDFViewerApplication: {
                pdfViewer: { _layerProperties: { annotationEditorUIManager: fallbackManager } }
            }
        });

        expect(getAnnotationEditorUIManager()).toBe(fallbackManager);

        const capturedManager = buildManager();
        setAnnotationEditorUIManager(capturedManager);
        expect(getAnnotationEditorUIManager()).toBe(capturedManager);

        vi.unstubAllGlobals();
    });
});
