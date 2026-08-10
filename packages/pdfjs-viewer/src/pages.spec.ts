// @vitest-environment happy-dom
/**
 * Page reporting and thumbnail generation, driven against a real `PDFDocumentProxy` so the
 * page count and viewport geometry come from pdf.js. See {@link ./test/fixture_pdf}.
 *
 * Rasterisation itself is the one thing not exercised here: happy-dom has no 2D canvas
 * context, and pdf.js cannot render into `@napi-rs/canvas` (its `clip()` rejects the arguments
 * pdf.js passes). The tests below therefore cover the geometry and the render *call*, and
 * leave the pixels to the Playwright suite in `e2e/`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { setupPdfPages } from "./pages";
import { allFeaturesPdf } from "./test/fixture_pdf";
import { InstalledViewer, installViewerApp, uninstallViewerApp } from "./test/viewer_app";

let viewer: InstalledViewer;

afterEach(() => uninstallViewerApp());

describe("page reporting", () => {
    it("reports the page count as soon as a document is present", async () => {
        viewer = await installViewerApp(allFeaturesPdf());

        setupPdfPages();

        // The fixture has two pages, and the viewer starts on the first.
        expect(viewer.lastMessageOfType("pdfjs-viewer-page-info")).toEqual({
            type: "pdfjs-viewer-page-info",
            totalPages: 2,
            currentPage: 1
        });
    });

    it("re-reports once pdf.js has initialised the pages", async () => {
        viewer = await installViewerApp(allFeaturesPdf());
        setupPdfPages();

        viewer.eventBus.dispatch("pagesinit", { source: null });

        // `pagesinit` arrives after the viewer has laid the pages out, which is when the
        // current page number becomes meaningful.
        expect(viewer.messagesOfType("pdfjs-viewer-page-info")).toHaveLength(2);
    });

    it("forwards page changes as the user moves through the document", async () => {
        viewer = await installViewerApp(allFeaturesPdf());
        setupPdfPages();

        viewer.eventBus.dispatch("pagechanging", { source: null, pageNumber: 2 });

        expect(viewer.lastMessageOfType("pdfjs-viewer-current-page")).toEqual({
            type: "pdfjs-viewer-current-page",
            currentPage: 2
        });
    });

    it("pages the viewer when the parent asks to scroll", async () => {
        viewer = await installViewerApp(allFeaturesPdf());
        setupPdfPages();

        viewer.sendFromParent({ type: "trilium-scroll-to-page", pageNumber: 2 });

        await vi.waitFor(() => expect(window.PDFViewerApplication?.pdfViewer.currentPageNumber).toBe(2));
    });

    it("ignores commands from another origin", async () => {
        viewer = await installViewerApp(allFeaturesPdf());
        setupPdfPages();

        window.dispatchEvent(new MessageEvent("message", {
            data: { type: "trilium-scroll-to-page", pageNumber: 2 },
            origin: "https://evil.example"
        }));
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(window.PDFViewerApplication?.pdfViewer.currentPageNumber).toBe(1);
    });
});

describe("thumbnail generation", () => {
    /**
     * Stands in for the 2D canvas happy-dom does not provide. Only the DOM side is faked —
     * the page, its viewport and the `render()` call all remain pdf.js'.
     */
    function stubCanvas(dataUrl = "data:image/jpeg;base64,fixture") {
        const context = {};
        vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as never);
        vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(dataUrl);
        return context;
    }

    it("renders the page at thumbnail scale and returns it as a data URL", async () => {
        viewer = await installViewerApp(allFeaturesPdf());
        stubCanvas();
        const page = await viewer.pdfDocument.getPage(1);
        const render = vi.spyOn(page, "render").mockReturnValue({ promise: Promise.resolve() } as never);
        vi.spyOn(viewer.pdfDocument, "getPage").mockResolvedValue(page);
        setupPdfPages();

        viewer.sendFromParent({ type: "trilium-request-thumbnail", pageNumber: 1 });
        await vi.waitFor(() => expect(viewer.messagesOfType("pdfjs-viewer-thumbnail")).toHaveLength(1));

        // The canvas is sized from pdf.js' own viewport for the scale, so a change in how
        // getViewport() computes dimensions shows up here. The fixture page is 612x792, so
        // scale 0.2 gives 122.4x158.4 — which the canvas attributes truncate to whole pixels,
        // costing a sub-pixel sliver off the right and bottom edges of every thumbnail.
        const [ { canvas, viewport } ] = render.mock.calls[0];
        expect([ viewport.width, viewport.height ]).toEqual([ 122.4, 158.4 ]);
        expect([ canvas.width, canvas.height ]).toEqual([ 122, 158 ]);

        expect(viewer.lastMessageOfType("pdfjs-viewer-thumbnail")).toEqual({
            type: "pdfjs-viewer-thumbnail",
            pageNumber: 1,
            dataUrl: "data:image/jpeg;base64,fixture"
        });
    });

    it("gives up quietly when no 2D context is available", async () => {
        viewer = await installViewerApp(allFeaturesPdf());
        // happy-dom's own behaviour, and the same as a browser that has exhausted its canvas
        // budget: getContext() returns null and there is nothing to draw into.
        setupPdfPages();

        viewer.sendFromParent({ type: "trilium-request-thumbnail", pageNumber: 1 });
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(viewer.messagesOfType("pdfjs-viewer-thumbnail")).toHaveLength(0);
    });

    it("logs and sends nothing when the page cannot be loaded", async () => {
        viewer = await installViewerApp(allFeaturesPdf());
        stubCanvas();
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        vi.spyOn(viewer.pdfDocument, "getPage").mockRejectedValue(new Error("boom"));
        setupPdfPages();

        viewer.sendFromParent({ type: "trilium-request-thumbnail", pageNumber: 99 });
        await vi.waitFor(() => expect(error).toHaveBeenCalled());

        expect(viewer.messagesOfType("pdfjs-viewer-thumbnail")).toHaveLength(0);
    });
});
