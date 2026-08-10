// @vitest-environment happy-dom
/**
 * Drives the table-of-contents extraction against a real `PDFDocumentProxy`, so the outline
 * shapes, destination arrays and page-index lookups all come from pdf.js rather than a fake.
 * See {@link ./test/fixture_pdf} for why.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { allFeaturesPdf, barePdf } from "./test/fixture_pdf";
import { InstalledViewer, installViewerApp, uninstallViewerApp } from "./test/viewer_app";
import { extractAndSendToc, setupActiveHeadingTracking, setupScrollToHeading } from "./toc";

/** Page boxes for the two-page fixture: 800px pages stacked with a 10px gap. */
const PAGE_GEOMETRY = {
    0: { offsetTop: 0, clientHeight: 800 },
    1: { offsetTop: 810, clientHeight: 800 }
};

describe("outline extraction", () => {
    let viewer: InstalledViewer;

    afterEach(() => uninstallViewerApp());

    it("converts a nested pdf.js outline into the tree the sidebar renders", async () => {
        viewer = await installViewerApp(allFeaturesPdf());

        await extractAndSendToc();

        // Ids are positional and stable, and the child is nested under its parent rather than
        // flattened — the sidebar relies on both for expand/collapse and scroll targeting.
        expect(viewer.lastMessageOfType("pdfjs-viewer-toc")).toEqual({
            type: "pdfjs-viewer-toc",
            data: [
                {
                    title: "Chapter 1",
                    level: 0,
                    id: "pdf-outline-0",
                    dest: expect.any(Array),
                    items: [
                        {
                            title: "Section 1.1",
                            level: 1,
                            id: "pdf-outline-0-0",
                            dest: expect.any(Array),
                            items: []
                        }
                    ]
                },
                {
                    title: "Chapter 2",
                    level: 0,
                    id: "pdf-outline-1",
                    dest: expect.any(Array),
                    items: []
                }
            ]
        });
    });

    it("reports a null table of contents for a document without an outline", async () => {
        viewer = await installViewerApp(barePdf());

        await extractAndSendToc();

        // The sidebar distinguishes "no outline" from "not extracted yet", so the message
        // still has to be sent — with a null payload.
        expect(viewer.lastMessageOfType("pdfjs-viewer-toc")).toEqual({
            type: "pdfjs-viewer-toc",
            data: null
        });
    });

    it("falls back to a null table of contents when extraction throws", async () => {
        viewer = await installViewerApp(allFeaturesPdf());
        vi.spyOn(viewer.pdfDocument, "getOutline").mockRejectedValue(new Error("boom"));

        await extractAndSendToc();

        expect(viewer.lastMessageOfType("pdfjs-viewer-toc")).toEqual({
            type: "pdfjs-viewer-toc",
            data: null
        });
    });
});

describe("scroll to heading", () => {
    let viewer: InstalledViewer;

    beforeEach(async () => {
        viewer = await installViewerApp(allFeaturesPdf());
        // Populates the module-level outline map the listener reads. The listener is
        // registered after install so the harness can strip it again on teardown.
        await extractAndSendToc();
        setupScrollToHeading();
    });

    afterEach(() => uninstallViewerApp());

    it("navigates to the destination of the requested heading", async () => {
        viewer.sendFromParent({ type: "trilium-scroll-to-heading", headingId: "pdf-outline-0-0" });
        await vi.waitFor(() => expect(viewer.pdfLinkService.goToDestination).toHaveBeenCalled());

        // The nested heading targets page 1 at y=600 in the fixture; pdf.js hands back the
        // explicit destination array, which is what goToDestination consumes.
        const [ dest ] = viewer.pdfLinkService.goToDestination.mock.calls[0];
        expect(dest[3]).toBe(600);
        expect(await viewer.pdfDocument.getPageIndex(dest[0])).toBe(0);
    });

    it("ignores unknown heading ids and foreign-origin messages", async () => {
        viewer.sendFromParent({ type: "trilium-scroll-to-heading", headingId: "nope" });
        window.dispatchEvent(new MessageEvent("message", {
            data: { type: "trilium-scroll-to-heading", headingId: "pdf-outline-0" },
            origin: "https://evil.example"
        }));

        // Give both messages a chance to be mishandled before asserting the negative.
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(viewer.pdfLinkService.goToDestination).not.toHaveBeenCalled();
    });
});

describe("active heading tracking", () => {
    let viewer: InstalledViewer;

    beforeEach(() => vi.useFakeTimers());

    afterEach(() => {
        vi.useRealTimers();
        uninstallViewerApp();
    });

    /** Installs the fixture and starts tracking, with the outline map already built. */
    async function startTracking() {
        viewer = await installViewerApp(allFeaturesPdf(), PAGE_GEOMETRY);
        await extractAndSendToc();
        setupActiveHeadingTracking();
        return viewer;
    }

    it("reports the heading nearest the top of the viewport as the user scrolls", async () => {
        await startTracking();

        // Headings sit at screen y=50 (Chapter 1), y=200 (Section 1.1) and y=910 (Chapter 2),
        // derived from the PDF's bottom-up coordinates against the page boxes above.
        expect(viewer.lastMessageOfType("pdfjs-viewer-active-heading")?.headingId).toBe("pdf-outline-0");

        viewer.scrollTo(200);
        viewer.eventBus.dispatch("pagechanging", { source: null, pageNumber: 1 });
        await vi.advanceTimersByTimeAsync(100);
        expect(viewer.lastMessageOfType("pdfjs-viewer-active-heading")?.headingId).toBe("pdf-outline-0-0");

        viewer.scrollTo(900);
        viewer.eventBus.dispatch("pagechanging", { source: null, pageNumber: 2 });
        await vi.advanceTimersByTimeAsync(100);
        expect(viewer.lastMessageOfType("pdfjs-viewer-active-heading")?.headingId).toBe("pdf-outline-1");
    });

    it("debounces bursts of scrolling into a single update", async () => {
        await startTracking();
        const before = viewer.messagesOfType("pdfjs-viewer-active-heading").length;

        viewer.scrollTo(900);
        for (let i = 0; i < 5; i++) {
            viewer.eventBus.dispatch("pagechanging", { source: null, pageNumber: 2 });
            await vi.advanceTimersByTimeAsync(20);
        }
        await vi.advanceTimersByTimeAsync(100);

        const sent = viewer.messagesOfType("pdfjs-viewer-active-heading").slice(before);
        expect(sent).toHaveLength(1);
        expect(sent[0].headingId).toBe("pdf-outline-1");
    });

    it("stays silent while the active heading has not changed", async () => {
        await startTracking();
        const before = viewer.messagesOfType("pdfjs-viewer-active-heading").length;

        viewer.eventBus.dispatch("pagechanging", { source: null, pageNumber: 1 });
        await vi.advanceTimersByTimeAsync(100);

        expect(viewer.messagesOfType("pdfjs-viewer-active-heading")).toHaveLength(before);
    });
});

