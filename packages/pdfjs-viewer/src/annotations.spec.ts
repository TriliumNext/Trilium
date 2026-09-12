// @vitest-environment happy-dom
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
    AnnotationType,
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

    it("skips types the sidebar does not list", () => {
        const link = { ...SAMPLE_HIGHLIGHT, annotationType: 2 }; // LINK
        expect(processAnnotation(link, 1)).toBeNull();

        const widget = { ...SAMPLE_HIGHLIGHT, annotationType: 20 }; // WIDGET (a form field)
        expect(processAnnotation(widget, 1)).toBeNull();
    });

    it("reads a free-text box's own words as its contents", () => {
        const freeText = {
            ...SAMPLE_HIGHLIGHT,
            annotationType: AnnotationType.FREETEXT,
            contentsObj: { str: "Typed in the box", dir: "ltr" },
            overlaidText: undefined
        };

        const result = processAnnotation(freeText, 2)!;
        expect(result.type).toBe("freetext");
        expect(result.contents).toBe("Typed in the box");
        expect(result.highlightedText).toBe("");
    });

    it("reports a free-hand highlight as a highlight, not as a drawing", () => {
        // pdf.js stores it as Ink and marks it with /IT; only the pen's own strokes are drawings.
        const inkHighlight = { ...SAMPLE_HIGHLIGHT, annotationType: AnnotationType.INK, it: "InkHighlight" };
        expect(processAnnotation(inkHighlight, 1)!.type).toBe("highlight");

        const penStroke = { ...SAMPLE_HIGHLIGHT, annotationType: AnnotationType.INK, it: undefined };
        expect(processAnnotation(penStroke, 1)!.type).toBe("ink");

        // /IT is shared with other types, where it says nothing about the tool used.
        const stampedHighlight = { ...SAMPLE_HIGHLIGHT, it: "InkHighlight" };
        expect(processAnnotation(stampedHighlight, 1)!.type).toBe("highlight");
    });

    it("keeps an annotation carrying no text at all", () => {
        // pdf.js writes a free-hand highlight as Ink, which never has contents or overlaidText;
        // dropping those hid every highlight not drawn over selected text (#11059).
        const drawing = {
            ...SAMPLE_HIGHLIGHT,
            annotationType: AnnotationType.INK,
            contentsObj: { str: "", dir: "ltr" },
            overlaidText: null
        };

        const result = processAnnotation(drawing, 4)!;
        expect(result).not.toBeNull();
        expect(result.type).toBe("ink");
        expect(result.contents).toBe("");
        expect(result.highlightedText).toBe("");
        expect(result.pageNumber).toBe(4);
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

    /** The annotations the fixture expects to surface, in page order. */
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
        }),
        expect.objectContaining({
            id: "17R",
            type: "highlight",
            contents: "",
            highlightedText: "",
            pageNumber: 2
        }),
        expect.objectContaining({
            id: "18R",
            type: "ink",
            contents: "",
            highlightedText: "",
            pageNumber: 2,
            color: "#000000"
        }),
        expect.objectContaining({
            id: "19R",
            type: "freetext",
            contents: "Typed in the box",
            pageNumber: 2
        }),
        expect.objectContaining({
            id: "20R",
            type: "highlight",
            contents: "",
            highlightedText: "",
            pageNumber: 2,
            color: "#ffff00"
        })
    ];

    it("walks every page and lists every annotation kind the sidebar shows", async () => {
        viewer = await installViewerApp(allFeaturesPdf());

        await setupPdfAnnotations();

        // Page 2's link is the only annotation filtered out — the highlight with nothing to
        // show, the ink drawing and the free-text box all belong in the sidebar (#11059).
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

    it("keeps a text box's font colour out of the sidebar's tint", async () => {
        viewer = await installViewerApp(allFeaturesPdf());
        // Every stored annotation becomes an editor once a tool is active, so this state is
        // reached just by pressing a toolbar button. A FreeTextEditor's `color` is the colour of
        // its *text*, not a fill — taking it would paint the row in the text's colour, and only
        // while a tool happened to be selected.
        vi.spyOn(viewer.pdfDocument.annotationStorage, "getEditor").mockImplementation((id: string) =>
            (id === "19R" ? { color: "#000000" } : null));

        await setupPdfAnnotations();

        const { annotations } = viewer.lastMessageOfType("pdfjs-viewer-annotations");
        expect(annotations.find((annotation: any) => annotation.id === "19R").color).toBeNull();
    });

    it("lists annotations that so far exist only in the editor", async () => {
        viewer = await installViewerApp(allFeaturesPdf());
        // What pdf.js holds for annotations drawn in this session: keyed by the editor's own id,
        // with `id` naming the document annotation it came from — null for one that is new.
        // Until the file is written back these are the only record of them, so a sidebar built
        // from the document alone stays empty however much the reader annotates (#11059).
        vi.spyOn(viewer.pdfDocument.annotationStorage, "serializable", "get").mockReturnValue({
            map: new Map<string, any>([
                [ "pdfjs_internal_editor_0", { annotationType: 9, id: null, pageIndex: 2, color: [ 255, 255, 152 ] } ],
                [ "pdfjs_internal_editor_1", { annotationType: 3, id: null, pageIndex: 0, color: [ 0, 0, 0 ], value: "typed words" } ],
                // An existing annotation being edited: already listed from the document.
                [ "pdfjs_internal_editor_2", { annotationType: 9, id: "5R", pageIndex: 0, color: [ 0, 255, 0 ] } ],
                // A signature: a kind the sidebar does not list, so it stays out here as well.
                [ "pdfjs_internal_editor_3", { annotationType: 13, id: null, pageIndex: 0, isSignature: true } ]
            ]),
            hash: "x",
            transfer: []
        } as any);

        await setupPdfAnnotations();

        const { annotations } = viewer.lastMessageOfType("pdfjs-viewer-annotations");
        expect(annotations.filter((annotation: any) => annotation.id.startsWith("pdfjs_internal_editor"))).toEqual([
            expect.objectContaining({ id: "pdfjs_internal_editor_0", type: "highlight", pageNumber: 3, color: "#ffff98" }),
            // pdf.js serializes a text box's *font* colour under `color`; the sidebar tints a row with
            // this field, and a black tint behind a note is not what anyone drew.
            expect.objectContaining({ id: "pdfjs_internal_editor_1", type: "freetext", contents: "typed words", pageNumber: 1, color: null })
        ]);
        // The document's own annotations are still there, and the edited one is not duplicated.
        expect(annotations.filter((annotation: any) => annotation.id === "5R")).toHaveLength(1);
        expect(annotations.some((annotation: any) => annotation.id === "pdfjs_internal_editor_3")).toBe(false);
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
        expect(annotations.map((annotation: any) => annotation.id)).toEqual([ "14R", "17R", "18R", "19R", "20R" ]);
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

    it("ignores a scroll request from another origin", async () => {
        viewer = await installViewerApp(allFeaturesPdf());
        await setupPdfAnnotations();
        renderAnnotation("5R");

        window.dispatchEvent(new MessageEvent("message", {
            data: { type: "trilium-scroll-to-annotation", annotationId: "5R", pageNumber: 1 },
            origin: "https://evil.example"
        }));
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(viewer.scrollRequests).not.toHaveBeenCalled();
    });

    it("scrolls to an annotation that only exists in the editor", async () => {
        viewer = await installViewerApp(allFeaturesPdf());
        await setupPdfAnnotations();
        // pdf.js gives an editor no data-annotation-id — it is not in the document yet — so the
        // element carries the editor's own id and that is what the sidebar entry holds.
        const editorEl = document.createElement("div");
        editorEl.id = "pdfjs_internal_editor_0";
        viewer.viewerEl.append(editorEl);

        viewer.sendFromParent({
            type: "trilium-scroll-to-annotation", annotationId: "pdfjs_internal_editor_0", pageNumber: 1
        });

        await vi.waitFor(() => expect(viewer.scrollRequests).toHaveBeenCalled());
    });

    it("jumps to the page and waits for an annotation that has not rendered yet", async () => {
        viewer = await installViewerApp(allFeaturesPdf());
        await setupPdfAnnotations();

        viewer.sendFromParent({ type: "trilium-scroll-to-annotation", annotationId: "14R", pageNumber: 2 });

        // Nothing to scroll to yet, so the viewer is asked to page there first.
        await vi.waitFor(() => expect(window.PDFViewerApplication?.pdfViewer.currentPageNumber).toBe(2));
        expect(viewer.scrollRequests).not.toHaveBeenCalled();

        // Other things render meanwhile; only the annotation itself ends the wait.
        viewer.viewerEl.append(document.createElement("div"));
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(viewer.scrollRequests).not.toHaveBeenCalled();
        // Once pdf.js renders the annotation, the observer picks it up.
        renderAnnotation("14R");
        await vi.waitFor(() => expect(viewer.scrollRequests).toHaveBeenCalled());
    });
});
