// @vitest-environment happy-dom
/**
 * Drives the table-of-contents extraction against a real `PDFDocumentProxy`, so the outline
 * shapes, destination arrays and page-index lookups all come from pdf.js rather than a fake.
 * See {@link ./test/fixture_pdf} for why.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { allFeaturesPdf, barePdf, buildPdf } from "./test/fixture_pdf";
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


/**
 * Outline entries in the other shapes pdf.js reports: a named destination, one that names
 * nothing, a `/Fit` destination without a y coordinate, and a link to a URL with no
 * destination at all.
 */
function mixedDestinationsPdf() {
    return buildPdf([
        "<< /Type /Catalog /Pages 2 0 R /Outlines 4 0 R "
            + "/Dests << /intro [3 0 R /XYZ 0 500 0] >> >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>",
        "<< /Type /Outlines /First 5 0 R /Last 8 0 R /Count 4 >>",
        "<< /Title (Named) /Parent 4 0 R /Dest /intro /Next 6 0 R >>",
        "<< /Title (Missing) /Parent 4 0 R /Dest /missing /Prev 5 0 R /Next 7 0 R >>",
        "<< /Title (Fit) /Parent 4 0 R /Dest [3 0 R /Fit] /Prev 6 0 R /Next 8 0 R >>",
        "<< /Title (Link) /Parent 4 0 R /A << /S /URI /URI (https://example.com) >> /Prev 7 0 R >>"
    ]);
}

describe("outlines with named or partial destinations", () => {
    let viewer: InstalledViewer;

    afterEach(() => {
        vi.useRealTimers();
        uninstallViewerApp();
    });

    it("resolves named destinations and skips the entries that lead nowhere", async () => {
        viewer = await installViewerApp(mixedDestinationsPdf());
        await extractAndSendToc();
        setupScrollToHeading();

        expect(viewer.lastMessageOfType("pdfjs-viewer-toc").data.map((item: any) => item.title))
            .toEqual([ "Named", "Missing", "Fit", "Link" ]);

        viewer.sendFromParent({ type: "trilium-scroll-to-heading", headingId: "pdf-outline-1" });
        viewer.sendFromParent({ type: "trilium-scroll-to-heading", headingId: "pdf-outline-3" });
        viewer.sendFromParent({ type: "trilium-scroll-to-heading", headingId: "pdf-outline-0" });
        await vi.waitFor(() => expect(viewer.pdfLinkService.goToDestination).toHaveBeenCalled());

        // Only "Named" leads anywhere: "Missing" resolves to nothing and "Link" has no destination.
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(viewer.pdfLinkService.goToDestination).toHaveBeenCalledOnce();
        const [ dest ] = viewer.pdfLinkService.goToDestination.mock.calls[0];
        expect(dest[3]).toBe(500);
    });

    it("places a destination without a y coordinate at the bottom of its page", async () => {
        vi.useFakeTimers();
        viewer = await installViewerApp(mixedDestinationsPdf(), { 0: { offsetTop: 0, clientHeight: 800 } });
        await extractAndSendToc();
        setupActiveHeadingTracking();

        // "Named" sits at screen y=300 and "Fit", taken as y=0, at the bottom of the page, y=800.
        viewer.scrollTo(800);
        viewer.eventBus.dispatch("pagechanging", { source: null, pageNumber: 1 });
        await vi.advanceTimersByTimeAsync(100);
        expect(viewer.lastMessageOfType("pdfjs-viewer-active-heading")?.headingId).toBe("pdf-outline-2");

        viewer.scrollTo(300);
        viewer.eventBus.dispatch("pagechanging", { source: null, pageNumber: 1 });
        await vi.advanceTimersByTimeAsync(100);
        expect(viewer.lastMessageOfType("pdfjs-viewer-active-heading")?.headingId).toBe("pdf-outline-0");
    });

    it("logs a destination pdf.js fails to resolve", async () => {
        viewer = await installViewerApp(mixedDestinationsPdf());
        await extractAndSendToc();
        setupScrollToHeading();
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        vi.spyOn(viewer.pdfDocument, "getDestination").mockRejectedValue(new Error("boom"));

        viewer.sendFromParent({ type: "trilium-scroll-to-heading", headingId: "pdf-outline-0" });
        await vi.waitFor(() => expect(error).toHaveBeenCalled());

        expect(viewer.pdfLinkService.goToDestination).not.toHaveBeenCalled();
    });
});

describe("before the outline is extracted", () => {
    afterEach(() => uninstallViewerApp());

    it("ignores a request to scroll to a heading", async () => {
        // A fresh module, so no earlier test has left an outline behind.
        vi.resetModules();
        const toc = await import("./toc");
        const viewer = await installViewerApp(allFeaturesPdf());
        toc.setupScrollToHeading();

        viewer.sendFromParent({ type: "trilium-scroll-to-heading", headingId: "pdf-outline-0" });
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(viewer.pdfLinkService.goToDestination).not.toHaveBeenCalled();
    });
});
