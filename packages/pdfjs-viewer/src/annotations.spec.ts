// @vitest-environment happy-dom
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
    AnnotationType,
    extractFromSavedData,
    processAnnotation,
    rgbToHex,
    setupAnnotationLiveUpdates,
    setupPdfAnnotations
} from "./annotations";
import { allFeaturesPdf } from "./test/fixture_pdf";
import { InstalledViewer, installViewerApp, uninstallViewerApp } from "./test/viewer_app";

const SAMPLE_HIGHLIGHT = {
    annotationType: 9,
    annotationFlags: 4,
    borderStyle: { width: 0, rawWidth: 1, style: 1, dashArray: [3], horizontalCornerRadius: 0, verticalCornerRadius: 0 },
    color: { "0": 128, "1": 235, "2": 255 },
    backgroundColor: null,
    borderColor: null,
    rotation: 0,
    contentsObj: { str: "Comment goes here.", dir: "ltr" },
    hasAppearance: true,
    id: "18R",
    modificationDate: null,
    rect: [352.43, 276.30, 489.91, 314.61],
    subtype: "Highlight",
    hasOwnCanvas: false,
    noRotate: false,
    noHTML: false,
    isEditable: true,
    structParent: -1,
    titleObj: { str: "", dir: "ltr" },
    creationDate: "D:20260425093822",
    popupRef: "24R",
    opacity: 1,
    quadPoints: { "0": 353.35, "1": 313.98, "2": 489.05, "3": 313.98, "4": 353.35, "5": 276.95, "6": 489.05, "7": 276.95 },
    overlaidText: "First slide"
};

describe("processAnnotation", () => {
    it("extracts all fields from a highlight annotation", () => {
        const result = processAnnotation(SAMPLE_HIGHLIGHT, 3)!;
        expect(result).not.toBeNull();
        expect(result.id).toBe("18R");
        expect(result.type).toBe("highlight");
        expect(result.contents).toBe("Comment goes here.");
        expect(result.highlightedText).toBe("First slide");
        expect(result.author).toBe("");
        expect(result.pageNumber).toBe(3);
        expect(result.color).toBe("#80ebff");
        expect(result.creationDate).toBe("D:20260425093822");
        expect(result.modificationDate).toBeNull();
    });

    it("extracts author from titleObj.str", () => {
        const withAuthor = { ...SAMPLE_HIGHLIGHT, titleObj: { str: "John Doe", dir: "ltr" } };
        expect(processAnnotation(withAuthor, 1)!.author).toBe("John Doe");
    });

    it("skips non-comment types and empty annotations", () => {
        const link = { ...SAMPLE_HIGHLIGHT, annotationType: 2 }; // LINK
        expect(processAnnotation(link, 1)).toBeNull();

        const empty = { ...SAMPLE_HIGHLIGHT, contentsObj: { str: "", dir: "ltr" }, overlaidText: "" };
        expect(processAnnotation(empty, 1)).toBeNull();
    });

    it("keeps annotations with only one of contents or highlightedText", () => {
        const highlightOnly = { ...SAMPLE_HIGHLIGHT, contentsObj: { str: "", dir: "ltr" } };
        expect(processAnnotation(highlightOnly, 1)).not.toBeNull();
        expect(processAnnotation(highlightOnly, 1)!.highlightedText).toBe("First slide");

        const commentOnly = { ...SAMPLE_HIGHLIGHT, annotationType: AnnotationType.TEXT, overlaidText: undefined };
        expect(processAnnotation(commentOnly, 1)).not.toBeNull();
        expect(processAnnotation(commentOnly, 1)!.contents).toBe("Comment goes here.");
    });

    it("handles null color", () => {
        expect(processAnnotation({ ...SAMPLE_HIGHLIGHT, color: null }, 1)!.color).toBeNull();
    });
});

describe("rgbToHex", () => {
    it("converts various color formats to hex", () => {
        expect(rgbToHex({ 0: 128, 1: 235, 2: 255 })).toBe("#80ebff");
        expect(rgbToHex([255, 0, 0])).toBe("#ff0000");
        expect(rgbToHex([0, 0, 0])).toBe("#000000");
        expect(rgbToHex([255, 255, 255])).toBe("#ffffff");
    });
});

/**
 * The rest of the file drives the extraction against a real `PDFDocumentProxy`, so the
 * annotation objects, the page loop and the save round-trip are pdf.js' own rather than
 * hand-built stand-ins. See {@link ./test/fixture_pdf}.
 */
describe("extraction from a real document", () => {
    let viewer: InstalledViewer;

    afterEach(() => uninstallViewerApp());

    /** The two annotations the fixture expects to surface, in page order. */
    const EXPECTED = [
        expect.objectContaining({
            id: "5R",
            type: "highlight",
            contents: "A remark",
            author: "Alice",
            pageNumber: 1,
            color: "#ff0000"
        }),
        expect.objectContaining({
            id: "14R",
            type: "text",
            contents: "A sticky note",
            author: "Bob",
            pageNumber: 1,
            color: "#0000ff"
        })
    ];

    it("walks every page and keeps only the annotations worth showing", async () => {
        viewer = await installViewerApp(allFeaturesPdf());

        await setupPdfAnnotations();

        // Page 2 holds a link (wrong type) and a highlight with no comment or highlighted
        // text; neither should reach the sidebar, and the page loop still has to visit it.
        expect(viewer.lastMessageOfType("pdfjs-viewer-annotations").annotations).toEqual(EXPECTED);
    });

    it("lets editor state override the colour and comment of a stored annotation", async () => {
        viewer = await installViewerApp(allFeaturesPdf());
        // getEditor() is pinned as existing by the contract spec; its return is stubbed here
        // because populating a real editor needs the annotation-editing UI layer.
        vi.spyOn(viewer.pdfDocument.annotationStorage, "getEditor").mockImplementation((id: string) =>
            id === "5R" ? { color: "#00ff00", comment: { text: "Edited in the viewer" } } : null);

        await setupPdfAnnotations();

        const [ highlight ] = viewer.lastMessageOfType("pdfjs-viewer-annotations").annotations;
        expect(highlight).toMatchObject({ id: "5R", color: "#00ff00", contents: "Edited in the viewer" });
    });

    it("removes deleted annotations even when they are adjacent", async () => {
        viewer = await installViewerApp(allFeaturesPdf());
        vi.spyOn(viewer.pdfDocument.annotationStorage, "getEditor").mockReturnValue({ deleted: true });

        await setupPdfAnnotations();

        // Both fixture annotations are adjacent in the page's /Annots order, which is what
        // used to break: removing one from the array under iteration shifted the next into
        // the consumed index, so it was skipped and stayed in the sidebar — showing an
        // annotation the user had deleted until a save round-trip replaced the list.
        expect(viewer.lastMessageOfType("pdfjs-viewer-annotations").annotations).toEqual([]);
    });

    it("keeps the annotations that were not deleted", async () => {
        viewer = await installViewerApp(allFeaturesPdf());
        vi.spyOn(viewer.pdfDocument.annotationStorage, "getEditor")
            .mockImplementation((id: string) => (id === "5R" ? { deleted: true } : null));

        await setupPdfAnnotations();

        const { annotations } = viewer.lastMessageOfType("pdfjs-viewer-annotations");
        expect(annotations.map((annotation: any) => annotation.id)).toEqual([ "14R" ]);
    });

    it("reports an empty list when extraction fails", async () => {
        viewer = await installViewerApp(allFeaturesPdf());
        vi.spyOn(console, "error").mockImplementation(() => {});
        vi.spyOn(viewer.pdfDocument, "getPage").mockRejectedValue(new Error("boom"));

        await setupPdfAnnotations();

        expect(viewer.lastMessageOfType("pdfjs-viewer-annotations")).toEqual({
            type: "pdfjs-viewer-annotations",
            annotations: []
        });
    });
});

describe("re-extraction from saved bytes", () => {
    let viewer: InstalledViewer;

    afterEach(() => {
        delete (globalThis as any).pdfjsLib;
        uninstallViewerApp();
    });

    it("reopens freshly saved bytes and tears the temporary document down", async () => {
        viewer = await installViewerApp(allFeaturesPdf());
        const saved = await viewer.pdfDocument.saveDocument();

        // The viewer exposes pdf.js on the global; hand it the real module so the temporary
        // document is opened by the same code path that runs in the browser.
        const destroy = vi.fn();
        (globalThis as any).pdfjsLib = {
            getDocument: (...args: any[]) => {
                const task = (getDocument as any)(...args);
                const teardown = task.destroy.bind(task);
                task.destroy = () => {
                    destroy();
                    return teardown();
                };
                return task;
            }
        };

        await extractFromSavedData(saved);

        // Saving and reopening must not lose the annotations the sidebar is showing.
        expect(viewer.lastMessageOfType("pdfjs-viewer-annotations").annotations)
            .toEqual([ expect.objectContaining({ contents: "A remark" }), expect.objectContaining({ contents: "A sticky note" }) ]);
        // The temporary document owns a worker, so failing to destroy it leaks one per save.
        expect(destroy).toHaveBeenCalledTimes(1);
    });

    it("logs and gives up when the saved bytes cannot be reopened", async () => {
        viewer = await installViewerApp(allFeaturesPdf());
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        (globalThis as any).pdfjsLib = { getDocument };

        // Real pdf.js rejecting real garbage, rather than a stand-in that throws on cue —
        // which also keeps the loading task real, so the `finally` teardown is exercised.
        await extractFromSavedData(new Uint8Array([ 1, 2, 3 ]));

        expect(error).toHaveBeenCalled();
        expect(viewer.messagesOfType("pdfjs-viewer-annotations")).toHaveLength(0);
    });
});

describe("live updates", () => {
    let viewer: InstalledViewer;

    afterEach(() => {
        vi.useRealTimers();
        uninstallViewerApp();
    });

    it("chains onto an existing onSetModified and debounces the refresh", async () => {
        viewer = await installViewerApp(allFeaturesPdf());
        const storage = viewer.pdfDocument.annotationStorage as any;
        const previous = vi.fn();
        storage.onSetModified = previous;
        vi.useFakeTimers();

        setupAnnotationLiveUpdates();
        storage.onSetModified();
        storage.onSetModified();

        // The save flow installs its own onSetModified first; dropping it would stop the
        // parent being told the document is dirty.
        expect(previous).toHaveBeenCalledTimes(2);
        expect(viewer.messagesOfType("pdfjs-viewer-annotations")).toHaveLength(0);

        await vi.advanceTimersByTimeAsync(500);
        expect(viewer.messagesOfType("pdfjs-viewer-annotations")).toHaveLength(1);
    });

    it("also refreshes on editor parameter and editing state changes", async () => {
        viewer = await installViewerApp(allFeaturesPdf());
        vi.useFakeTimers();
        setupAnnotationLiveUpdates();

        // Deletions and undo/redo surface only through these two events.
        viewer.eventBus.dispatch("annotationeditorparamschanged", { source: null });
        await vi.advanceTimersByTimeAsync(500);
        expect(viewer.messagesOfType("pdfjs-viewer-annotations")).toHaveLength(1);

        viewer.eventBus.dispatch("editingstateschanged", { source: null, details: {} });
        await vi.advanceTimersByTimeAsync(500);
        expect(viewer.messagesOfType("pdfjs-viewer-annotations")).toHaveLength(2);
    });
});

describe("scrolling to an annotation", () => {
    let viewer: InstalledViewer;

    afterEach(() => uninstallViewerApp());

    /** Appends the element pdf.js would render for an annotation. */
    function renderAnnotation(id: string) {
        const el = document.createElement("div");
        el.setAttribute("data-annotation-id", id);
        viewer.viewerEl.append(el);
        return el;
    }

    it("scrolls straight to an annotation that is already rendered", async () => {
        viewer = await installViewerApp(allFeaturesPdf());
        await setupPdfAnnotations();
        renderAnnotation("5R");

        viewer.sendFromParent({ type: "trilium-scroll-to-annotation", annotationId: "5R", pageNumber: 1 });

        await vi.waitFor(() => expect(viewer.scrollRequests).toHaveBeenCalled());
        expect(viewer.scrollRequests).toHaveBeenCalledWith(expect.objectContaining({ behavior: "smooth" }));
    });

    it("jumps to the page and waits for an annotation that has not rendered yet", async () => {
        viewer = await installViewerApp(allFeaturesPdf());
        await setupPdfAnnotations();

        viewer.sendFromParent({ type: "trilium-scroll-to-annotation", annotationId: "14R", pageNumber: 2 });

        // The annotation is not in the DOM, so scrollToAnnotation estimates the page
        // position and scrolls the container there (bypassing currentPageNumber setter
        // because PDF.js's virtual scroller may have removed off-screen page divs).
        await vi.waitFor(() => expect(viewer.scrollRequests).toHaveBeenCalled());
        expect(viewer.scrollRequests).toHaveBeenCalledWith(expect.objectContaining({ behavior: "smooth" }));

        // Once pdf.js renders the annotation, the observer picks it up.
        renderAnnotation("14R");
        await vi.waitFor(() => expect(viewer.scrollRequests).toHaveBeenCalledTimes(2));
    });
});
