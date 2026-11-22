// @vitest-environment happy-dom
/**
 * Drives the navigation scheduler against real pdf.js documents: links to headings by saved id,
 * pages and annotations, posted before and after the document loads, and the revisions that the
 * parent saved from a load.
 */
import { createHash } from "node:crypto";

import { readPdfOutline } from "@triliumnext/commons/src/lib/pdf_toc.js";
import {
    assignHeadingIds, getBlobTag, MAX_TOC_HEADINGS
} from "@triliumnext/commons/src/lib/toc.js";
import { blobIdFromDigest, PROTECTED_BLOB_PREFIX } from "@triliumnext/commons/src/lib/utils.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { setupNavigation, trackDocument } from "./navigation";
import { allFeaturesPdf, buildPdf, longOutlinePdf } from "./test/fixture_pdf";
import { type InstalledViewer, installViewerApp, uninstallViewerApp } from "./test/viewer_app";

/** Both pages of the all-features fixture are US Letter, 792 points tall, stacked 1000 px apart. */
const PAGES = { 0: { offsetTop: 0, clientHeight: 792 }, 1: { offsetTop: 1000, clientHeight: 792 } };

let viewer: InstalledViewer;

afterEach(() => {
    uninstallViewerApp();
    vi.unstubAllGlobals();
});

describe("requests before the document is ready", () => {
    it("applies a request posted before the document loads, once it has", async () => {
        const ids = await idsOf(allFeaturesPdf());
        const requests = [
            { type: "trilium-scroll-to-heading", headingId: ids[2], pageNumber: 1 },
            { type: "trilium-scroll-to-annotation", pageNumber: 2 },
            { type: "trilium-scroll-to-annotation", annotationId: "18R", pageNumber: 2 }
        ];
        for (const request of requests) {
            viewer = await installViewerApp(allFeaturesPdf(), PAGES);
            const app = startTracking();

            viewer.sendFromParent(request);
            await settle();
            expect(app.pdfViewer.currentPageNumber, request.type).toBe(1);

            loadDocument();
            await vi.waitFor(() => expect(app.pdfViewer.currentPageNumber).toBe(2));
            uninstallViewerApp();
        }
    });

    it("waits for pdf.js to apply its initial view, which would undo an earlier scroll", async () => {
        viewer = await installViewerApp(allFeaturesPdf(), PAGES);
        const app = startTracking();
        let pagesLoaded = () => {};
        (app.pdfViewer as any).pagesPromise = new Promise<void>((resolve) => { pagesLoaded = resolve; });
        viewer.eventBus.dispatch("documentloaded", { source: null });

        viewer.sendFromParent({ type: "trilium-scroll-to-annotation", annotationId: "18R", pageNumber: 2 });
        await settle();
        expect(viewer.scrollRequests).not.toHaveBeenCalled();

        // pdf.js restores the last-read position at `documentinit`, and again once every page is
        // sized when the pages differ in size.
        viewer.eventBus.dispatch("documentinit", { source: null });
        await settle();
        expect(viewer.scrollRequests).not.toHaveBeenCalled();

        pagesLoaded();
        await vi.waitFor(() => expect(viewer.scrollRequests).toHaveBeenCalled());
    });

    it("drops a request whose viewer is torn down before the initial view settles", async () => {
        viewer = await installViewerApp(allFeaturesPdf(), PAGES);
        const app = startTracking();
        let pagesLoaded = () => {};
        (app.pdfViewer as any).pagesPromise = new Promise<void>((resolve) => { pagesLoaded = resolve; });
        viewer.eventBus.dispatch("documentloaded", { source: null });

        viewer.sendFromParent({ type: "trilium-scroll-to-annotation", annotationId: "18R", pageNumber: 2 });
        delete window.PDFViewerApplication;
        viewer.eventBus.dispatch("documentinit", { source: null });
        pagesLoaded();
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(viewer.scrollRequests).not.toHaveBeenCalled();
        expect(app.pdfViewer.currentPageNumber).toBe(1);
    });

    it("ignores requests from another origin", async () => {
        viewer = await installViewerApp(allFeaturesPdf(), PAGES);
        const app = startTracking();
        loadDocument();

        for (const data of [
            { type: "trilium-scroll-to-annotation", annotationId: "5R", pageNumber: 2 },
            { type: "trilium-scroll-to-heading", headingId: "0k3x9aa1h7q2mz", pageNumber: 2 }
        ]) {
            window.dispatchEvent(new MessageEvent("message", { data, origin: "https://evil.example" }));
        }
        await settle();

        expect(app.pdfViewer.currentPageNumber).toBe(1);
        expect(viewer.scrollRequests).not.toHaveBeenCalled();
    });
});

describe("headings", () => {
    it("goes to the destination of a heading a link names, and has pdf.js record the position", async () => {
        const bytes = outlinePdf();
        viewer = await installViewerApp(bytes.slice());
        const app = startTracking();
        loadDocument();
        const ids = await idsOf(bytes);

        viewer.sendFromParent({ type: "trilium-scroll-to-heading", headingId: ids[3], pageNumber: 1 });

        await vi.waitFor(() => expect(app.pdfViewer.update).toHaveBeenCalled());
        expect(viewer.scrollPageIntoView).toHaveBeenCalledExactlyOnceWith({
            pageNumber: 2, destArray: [ expect.anything(), { name: "Fit" } ]
        });
        expect(viewer.scrollPageIntoView.mock.invocationCallOrder[0])
            .toBeLessThan(vi.mocked(app.pdfViewer.update).mock.invocationCallOrder[0]);
        expect(app.pdfViewer.currentPageNumber).toBe(2);
    });

    it("turns to the page a heading without a destination inherits from the heading below it", async () => {
        const bytes = outlinePdf(3);
        viewer = await installViewerApp(bytes.slice());
        const app = startTracking();
        loadDocument();
        // A link made when "Methods" was on page 2.
        const ids = await idsOf(outlinePdf(2));

        viewer.sendFromParent({ type: "trilium-scroll-to-heading", headingId: ids[2], pageNumber: 2 });
        await vi.waitFor(() => expect(app.pdfViewer.currentPageNumber).toBe(3));

        // The same for a named destination that resolves to nothing, and with the current ids.
        const current = await idsOf(bytes);
        viewer.sendFromParent({
            type: "trilium-scroll-to-heading", headingId: current[4], pageNumber: 1
        });
        await vi.waitFor(() => expect(app.pdfViewer.currentPageNumber).toBe(2));
        viewer.sendFromParent({
            type: "trilium-scroll-to-heading", headingId: current[2], pageNumber: 1
        });
        await vi.waitFor(() => expect(app.pdfViewer.currentPageNumber).toBe(3));
        expect(viewer.scrollPageIntoView).not.toHaveBeenCalled();
    });

    it("turns to the link's page for a heading it cannot place, or one that leads nowhere", async () => {
        const bytes = outlinePdf();
        viewer = await installViewerApp(bytes.slice());
        const app = startTracking();
        loadDocument();
        const ids = await idsOf(bytes);

        viewer.sendFromParent({ type: "trilium-scroll-to-heading", headingId: "0k3x9aa1h7q2mz", pageNumber: 2 });
        await vi.waitFor(() => expect(app.pdfViewer.currentPageNumber).toBe(2));

        viewer.sendFromParent({ type: "trilium-scroll-to-heading", headingId: ids[6], pageNumber: 3 });
        await vi.waitFor(() => expect(app.pdfViewer.currentPageNumber).toBe(3));

        // Without a page there is nowhere to go.
        viewer.sendFromParent({ type: "trilium-scroll-to-heading", headingId: ids[6] });
        viewer.sendFromParent({
            type: "trilium-scroll-to-heading", headingId: "outline-99", pageNumber: 0
        });
        viewer.sendFromParent({ type: "trilium-scroll-to-heading", headingId: "elsewhere" });
        await settle();
        expect(app.pdfViewer.currentPageNumber).toBe(3);
        expect(app.pdfViewer.update).toHaveBeenCalledTimes(2);
    });

    it("turns to the link's page for a request that names no heading", async () => {
        viewer = await installViewerApp(outlinePdf());
        const app = startTracking();
        loadDocument();

        viewer.sendFromParent({ type: "trilium-scroll-to-heading", pageNumber: 3 });

        await vi.waitFor(() => expect(app.pdfViewer.currentPageNumber).toBe(3));
        expect(viewer.scrollPageIntoView).not.toHaveBeenCalled();
    });

    it("turns to the link's page when the outline cannot be read", async () => {
        viewer = await installViewerApp(outlinePdf());
        const app = startTracking();
        loadDocument();
        vi.spyOn(viewer.pdfDocument, "getOutline").mockRejectedValue(new Error("Bad outline"));

        viewer.sendFromParent({
            type: "trilium-scroll-to-heading", headingId: "0k3x9aa1h7q2mz", pageNumber: 3
        });

        await vi.waitFor(() => expect(app.pdfViewer.currentPageNumber).toBe(3));
        expect(viewer.scrollPageIntoView).not.toHaveBeenCalled();
    });

    it("opens the last page for a page past the end, from a link to a longer version", async () => {
        const error = vi.spyOn(console, "error");
        viewer = await installViewerApp(outlinePdf());
        const app = startTracking();
        loadDocument();

        viewer.sendFromParent({ type: "trilium-scroll-to-heading", headingId: "0k3x9aa1h7q2mz", pageNumber: 9 });
        await vi.waitFor(() => expect(app.pdfViewer.currentPageNumber).toBe(3));
        app.pdfViewer.currentPageNumber = 1;
        viewer.sendFromParent({ type: "trilium-scroll-to-annotation", annotationId: "5R", pageNumber: 9 });
        await vi.waitFor(() => expect(app.pdfViewer.currentPageNumber).toBe(3));

        expect(error).not.toHaveBeenCalled();
    });

    it("turns to the page of a heading whose destination scrollPageIntoView() cannot read", async () => {
        viewer = await installViewerApp(outlinePdf());
        const app = startTracking();
        loadDocument();
        // pdf.js drops such a destination from the outlines it reads itself.
        vi.spyOn(viewer.pdfDocument, "getOutline").mockResolvedValue([
            { title: "Bare", dest: [ { num: 4, gen: 0 } ], items: [] }
        ] as any);
        const [ bareId ] = assignHeadingIds([ { title: "Bare", level: 1 } ], "", false);

        viewer.sendFromParent({
            type: "trilium-scroll-to-heading", headingId: bareId, pageNumber: 1
        });

        await vi.waitFor(() => expect(app.pdfViewer.currentPageNumber).toBe(2));
        expect(viewer.scrollPageIntoView).not.toHaveBeenCalled();
    });

    it("turns to the page when pdf.js does not move to the destination", async () => {
        const bytes = outlinePdf();
        viewer = await installViewerApp(bytes.slice());
        const app = startTracking();
        loadDocument();
        viewer.scrollPageIntoView.mockImplementation(() => {});
        const ids = await idsOf(bytes);

        viewer.sendFromParent({
            type: "trilium-scroll-to-heading", headingId: ids[0], pageNumber: 1
        });

        await vi.waitFor(() => expect(app.pdfViewer.currentPageNumber).toBe(2));
        expect(viewer.scrollPageIntoView).toHaveBeenCalledOnce();
    });
});

describe("an outline cut at MAX_TOC_HEADINGS", () => {
    it("lands a heading of a cut outline, and an id of version 1 on its page", async () => {
        // "Summary" is the last entry kept, and one more follows it.
        const bytes = longOutlinePdf(MAX_TOC_HEADINGS + 1, MAX_TOC_HEADINGS - 1);
        viewer = await installViewerApp(bytes.slice());
        const app = startTracking();
        loadDocument();
        const ids = await idsOf(bytes);
        const oldIds = await idsOf(bytes, false, { isCutIgnored: true });
        expect(ids[MAX_TOC_HEADINGS - 1]).toMatch(/.[0-9A-Za-z]{10}$/);
        expect(oldIds[MAX_TOC_HEADINGS - 1]).toMatch(/^[0-9a-z]{14}$/);

        viewer.sendFromParent({
            type: "trilium-scroll-to-heading", headingId: ids[MAX_TOC_HEADINGS - 1], pageNumber: 1
        });
        await vi.waitFor(() => expect(app.pdfViewer.currentPageNumber).toBe(3));

        viewer.sendFromParent({
            type: "trilium-scroll-to-heading",
            headingId: oldIds[MAX_TOC_HEADINGS - 1],
            pageNumber: 2
        });
        await vi.waitFor(() => expect(app.pdfViewer.currentPageNumber).toBe(2));
    }, 60_000);
});

describe("headings bound to the bytes", () => {
    it("lands a bound id on the same bytes, with Web Crypto and with the bundled hash", async () => {
        for (const isWebCryptoAvailable of [ true, false ]) {
            if (!isWebCryptoAvailable) {
                vi.stubGlobal("crypto", {});
            }
            const bytes = outlinePdf();
            viewer = await installViewerApp(bytes.slice());
            const app = startTracking();
            loadDocument();
            const getData = vi.spyOn(viewer.pdfDocument, "getData");
            const ids = await idsOf(bytes);
            expect(ids[1]).toMatch(/\.[0-9A-Za-z]{10}$/);

            viewer.sendFromParent({ type: "trilium-scroll-to-heading", headingId: ids[1], pageNumber: 1 });

            await vi.waitFor(() => expect(app.pdfViewer.currentPageNumber).toBe(3));
            expect(getData).toHaveBeenCalledOnce();
            uninstallViewerApp();
        }
    });

    it("lands an id made under the other protection, and gives the page for other bytes", async () => {
        const bytes = outlinePdf();
        viewer = await installViewerApp(bytes.slice());
        const app = startTracking();
        loadDocument();
        const getData = vi.spyOn(viewer.pdfDocument, "getData");
        const protectedIds = await idsOf(bytes, true);
        expect(protectedIds[1]).toMatch(/\.p$/);

        viewer.sendFromParent({ type: "trilium-scroll-to-heading", headingId: protectedIds[1], pageNumber: 1 });
        await vi.waitFor(() => expect(app.pdfViewer.currentPageNumber).toBe(3));
        expect(getData).toHaveBeenCalledOnce();

        // An id of the same outline in other bytes, such as before an annotation was saved.
        const otherIds = await idsOf(outlinePdf(3));
        viewer.sendFromParent({ type: "trilium-scroll-to-heading", headingId: otherIds[1], pageNumber: 1 });
        await vi.waitFor(() => expect(app.pdfViewer.currentPageNumber).toBe(1));
        expect(getData).toHaveBeenCalledTimes(2);
    });

    it("shares one digest between links, and keeps it for later ones", async () => {
        const bytes = outlinePdf();
        viewer = await installViewerApp(bytes.slice());
        const app = startTracking();
        loadDocument();
        const getData = vi.spyOn(viewer.pdfDocument, "getData");
        const ids = await idsOf(bytes);

        viewer.sendFromParent({ type: "trilium-scroll-to-heading", headingId: ids[1], pageNumber: 1 });
        viewer.sendFromParent({ type: "trilium-scroll-to-heading", headingId: ids[0], pageNumber: 1 });
        await vi.waitFor(() => expect(app.pdfViewer.currentPageNumber).toBe(2));
        viewer.sendFromParent({ type: "trilium-scroll-to-heading", headingId: ids[1], pageNumber: 1 });
        await vi.waitFor(() => expect(app.pdfViewer.currentPageNumber).toBe(3));

        expect(getData).toHaveBeenCalledOnce();
    });

    it("lets a newer request move the view while an older one waits for its digest", async () => {
        const bytes = outlinePdf();
        viewer = await installViewerApp(bytes.slice());
        const app = startTracking();
        loadDocument();
        const ids = await idsOf(bytes);
        let releaseData = () => {};
        vi.spyOn(viewer.pdfDocument, "getData").mockImplementation(() => new Promise((resolve) => {
            releaseData = () => resolve(bytes.slice());
        }));

        viewer.sendFromParent({ type: "trilium-scroll-to-heading", headingId: ids[1], pageNumber: 1 });
        await settle();
        viewer.sendFromParent({ type: "trilium-scroll-to-annotation", pageNumber: 2 });
        await vi.waitFor(() => expect(app.pdfViewer.currentPageNumber).toBe(2));

        releaseData();
        await settle();
        expect(app.pdfViewer.currentPageNumber).toBe(2);
        expect(viewer.scrollPageIntoView).not.toHaveBeenCalled();
    });

    it("gives the link's page when the digest fails", async () => {
        const bytes = outlinePdf();
        viewer = await installViewerApp(bytes.slice());
        const app = startTracking();
        loadDocument();
        const ids = await idsOf(bytes);
        vi.spyOn(viewer.pdfDocument, "getData").mockRejectedValue(new Error("Out of memory"));

        viewer.sendFromParent({ type: "trilium-scroll-to-heading", headingId: ids[1], pageNumber: 2 });

        await vi.waitFor(() => expect(app.pdfViewer.currentPageNumber).toBe(2));
        expect(viewer.scrollPageIntoView).not.toHaveBeenCalled();
    });
});

describe("headings of a saved revision", () => {
    /** A blob that the parent saved from the loaded bytes, such as after an annotation. */
    const SAVED_BLOB_ID = "SavedBlob0123456789x";

    it("lands a heading bound to a save that the parent reported for this load", async () => {
        window.TRILIUM_LOAD_TOKEN = "load-1";
        const bytes = introductionPdf();
        viewer = await installViewerApp(bytes.slice());
        const app = startTracking();
        loadDocument();
        const savedIds = await idsOf(bytes, false, { blobId: SAVED_BLOB_ID });
        expect(savedIds[1]).toMatch(/\.SavedBlob0$/);
        const request = {
            type: "trilium-scroll-to-heading", headingId: savedIds[1], pageNumber: 1
        };

        viewer.sendFromParent(request);
        await vi.waitFor(() => expect(app.pdfViewer.update).toHaveBeenCalledTimes(1));
        viewer.sendFromParent({
            type: "trilium-saved-revision", loadToken: "load-2", blobId: SAVED_BLOB_ID
        });
        viewer.sendFromParent({
            type: "trilium-saved-revision", loadToken: "load-1", blobId: SAVED_BLOB_ID,
            isProtected: true
        });
        viewer.sendFromParent(request);
        await vi.waitFor(() => expect(app.pdfViewer.update).toHaveBeenCalledTimes(2));
        expect(viewer.scrollPageIntoView).not.toHaveBeenCalled();
        expect(app.pdfViewer.currentPageNumber).toBe(1);

        viewer.sendFromParent({
            type: "trilium-saved-revision", loadToken: "load-1", blobId: SAVED_BLOB_ID,
            isProtected: false
        });
        viewer.sendFromParent(request);

        await vi.waitFor(() => expect(viewer.scrollPageIntoView).toHaveBeenCalledExactlyOnceWith({
            pageNumber: 2, destArray: [ expect.anything(), { name: "XYZ" }, 0, 300, 0 ]
        }));
    });

    it("drops the revisions of a document when another one loads", async () => {
        window.TRILIUM_LOAD_TOKEN = "load-1";
        const bytes = introductionPdf();
        viewer = await installViewerApp(bytes.slice());
        startTracking();
        loadDocument();
        viewer.sendFromParent({
            type: "trilium-saved-revision", loadToken: "load-1", blobId: SAVED_BLOB_ID
        });
        uninstallViewerApp();

        viewer = await installViewerApp(bytes.slice());
        const app = startTracking();
        loadDocument();
        const savedIds = await idsOf(bytes, false, { blobId: SAVED_BLOB_ID });
        viewer.sendFromParent({
            type: "trilium-scroll-to-heading", headingId: savedIds[1], pageNumber: 1
        });

        await vi.waitFor(() => expect(app.pdfViewer.update).toHaveBeenCalledOnce());
        expect(viewer.scrollPageIntoView).not.toHaveBeenCalled();
    });

    /** Two pages, and two sibling "Introduction" entries on page 2, at the tops 700 and 300. */
    function introductionPdf() {
        return buildPdf([
            "<< /Type /Catalog /Pages 2 0 R /Outlines 5 0 R >>",
            "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>",
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>",
            "<< /Type /Outlines /First 6 0 R /Last 7 0 R /Count 2 >>",
            "<< /Title (Introduction) /Parent 5 0 R /Dest [4 0 R /XYZ 0 700 0] /Next 7 0 R >>",
            "<< /Title (Introduction) /Parent 5 0 R /Dest [4 0 R /XYZ 0 300 0] /Prev 6 0 R >>"
        ]);
    }
});

describe("annotations", () => {
    /** Where the last scroll request puts the centre of the container, in container pixels. */
    function centreOfLastScroll() {
        const { left, top } = viewer.scrollRequests.mock.lastCall?.[0] ?? {};
        return { x: left + 600 / 2, y: top + 800 / 2 };
    }

    /** Replaces what pdf.js holds for the annotations edited in this session. */
    function editedInSession(entries: [ string, Record<string, unknown> ][]) {
        vi.spyOn(viewer.pdfDocument.annotationStorage, "serializable", "get").mockReturnValue({
            map: new Map(entries), hash: "x", transfer: []
        } as any);
    }

    async function start() {
        viewer = await installViewerApp(allFeaturesPdf(), PAGES);
        const app = startTracking();
        loadDocument();
        return app;
    }

    it("centres an annotation, from its rectangle in the document", async () => {
        await start();

        // Object 18 is the ink stroke at [400 400 500 450] on page 2. Nothing has rendered it,
        // which does not matter: the page's viewport places it.
        viewer.sendFromParent({ type: "trilium-scroll-to-annotation", annotationId: "18R", pageNumber: 2 });

        await vi.waitFor(() => expect(viewer.scrollRequests).toHaveBeenCalled());
        // PDF y grows upwards, so y 425 on a 792-point page is 367 px from its top.
        expect(centreOfLastScroll()).toEqual({ x: 450, y: 1000 + 367 });
    });

    it("turns to the annotation's page before measuring it, for single-page mode", async () => {
        // In single-page scroll mode, setting `currentPageNumber` puts the page's element into
        // the viewer, which holds only the current page.
        const app = await start();
        const turnToPage = vi.fn();
        Object.defineProperty(app.pdfViewer, "currentPageNumber", { get: () => 1, set: turnToPage });

        viewer.sendFromParent({ type: "trilium-scroll-to-annotation", annotationId: "18R", pageNumber: 2 });

        await vi.waitFor(() => expect(viewer.scrollRequests).toHaveBeenCalled());
        expect(turnToPage).toHaveBeenCalledExactlyOnceWith(2);
        expect(turnToPage.mock.invocationCallOrder[0])
            .toBeLessThan(viewer.scrollRequests.mock.invocationCallOrder[0]);
        expect(centreOfLastScroll()).toEqual({ x: 450, y: 1000 + 367 });
    });

    it("has pdf.js record the new position at once, so a resize in the same frame keeps it", async () => {
        const app = await start();

        viewer.sendFromParent({ type: "trilium-scroll-to-annotation", annotationId: "18R", pageNumber: 2 });
        await vi.waitFor(() => expect(app.pdfViewer.update).toHaveBeenCalledOnce());
        expect(viewer.scrollRequests).toHaveBeenCalledWith(expect.objectContaining({ behavior: "instant" }));
        expect(viewer.scrollRequests.mock.invocationCallOrder[0])
            .toBeLessThan(vi.mocked(app.pdfViewer.update).mock.invocationCallOrder[0]);

        viewer.sendFromParent({ type: "trilium-scroll-to-annotation", pageNumber: 1 });
        await vi.waitFor(() => expect(app.pdfViewer.update).toHaveBeenCalledTimes(2));
    });

    it("finds an annotation where it was moved to, or drawn, in this session", async () => {
        await start();
        editedInSession([
            [ "pdfjs_internal_editor_0", { annotationType: 9, id: null, pageIndex: 0, rect: [ 0, 0, 100, 100 ] } ],
            [ "pdfjs_internal_editor_1", { annotationType: 9, id: "5R", pageIndex: 0, rect: [ 300, 392, 300, 392 ] } ]
        ]);

        viewer.sendFromParent({
            type: "trilium-scroll-to-annotation", annotationId: "pdfjs_internal_editor_0", pageNumber: 1
        });
        await vi.waitFor(() => expect(viewer.scrollRequests).toHaveBeenCalledTimes(1));
        expect(centreOfLastScroll()).toEqual({ x: 50, y: 742 });

        viewer.sendFromParent({ type: "trilium-scroll-to-annotation", annotationId: "5R", pageNumber: 1 });
        await vi.waitFor(() => expect(viewer.scrollRequests).toHaveBeenCalledTimes(2));
        expect(centreOfLastScroll()).toEqual({ x: 300, y: 400 });
    });

    it("turns to the page when the annotation is gone, or none is named", async () => {
        const app = await start();
        editedInSession([
            [ "pdfjs_internal_editor_0", { id: "17R", pageIndex: 1, deleted: true } ],
            [ "pdfjs_internal_editor_1", { id: null, pageIndex: 0 } ]
        ]);

        viewer.sendFromParent({ type: "trilium-scroll-to-annotation", annotationId: "17R", pageNumber: 2 });
        await vi.waitFor(() => expect(app.pdfViewer.currentPageNumber).toBe(2));

        // An editor pdf.js has not given a rectangle yet.
        viewer.sendFromParent({
            type: "trilium-scroll-to-annotation", annotationId: "pdfjs_internal_editor_1", pageNumber: 1
        });
        await vi.waitFor(() => expect(app.pdfViewer.currentPageNumber).toBe(1));
        viewer.sendFromParent({ type: "trilium-scroll-to-annotation", pageNumber: 2 });
        await vi.waitFor(() => expect(app.pdfViewer.currentPageNumber).toBe(2));

        viewer.sendFromParent({ type: "trilium-scroll-to-annotation", annotationId: "99R", pageNumber: 1 });
        await vi.waitFor(() => expect(app.pdfViewer.currentPageNumber).toBe(1));

        // No page at all, or one that is not a page.
        viewer.sendFromParent({ type: "trilium-scroll-to-annotation", annotationId: "5R" });
        viewer.sendFromParent({ type: "trilium-scroll-to-annotation", pageNumber: 1.5 });
        await settle();
        expect(app.pdfViewer.currentPageNumber).toBe(1);
        expect(viewer.scrollRequests).not.toHaveBeenCalled();
    });

    it("turns to the page when the page of the annotation cannot be read", async () => {
        const app = await start();
        vi.spyOn(viewer.pdfDocument, "getPage").mockRejectedValue(new Error("The worker stopped."));

        viewer.sendFromParent({ type: "trilium-scroll-to-annotation", annotationId: "18R", pageNumber: 2 });
        await settle();

        // A failed lookup is a request that found nothing to move to.
        expect(app.pdfViewer.currentPageNumber).toBe(1);
        expect(viewer.scrollRequests).not.toHaveBeenCalled();
    });
});

/** Follows the load of the installed document, with the one listener for requests. */
function startTracking() {
    const app = window.PDFViewerApplication;
    if (!app) throw new Error("The viewer is not installed.");
    trackDocument(app);
    setupNavigation();
    return app;
}

/** What pdf.js dispatches as it loads the document and applies its initial view. */
function loadDocument() {
    viewer.eventBus.dispatch("documentloaded", { source: null });
    viewer.eventBus.dispatch("documentinit", { source: null });
}

/**
 * The saved ids of the outline of `bytes`, as the server computes them for its blob, or for
 * `blobId` when given. With `isCutIgnored`, the ids of a cut outline as the reader of version 1
 * gave them.
 */
async function idsOf(
    bytes: Uint8Array, isProtected = false,
    { isCutIgnored = false, blobId: givenBlobId }: { isCutIgnored?: boolean; blobId?: string } = {}
) {
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const task = getDocument({ data: bytes.slice() });
    const { headings: outline, isCut } = await readPdfOutline(await task.promise);
    await task.destroy();
    const content = isProtected
        ? Buffer.concat([ Buffer.from(PROTECTED_BLOB_PREFIX), bytes ])
        : Buffer.from(bytes);
    const blobId = givenBlobId
        ?? blobIdFromDigest(new Uint8Array(createHash("sha512").update(content).digest()));
    return assignHeadingIds(outline, getBlobTag(blobId), isProtected,
        { isCut: isCut && !isCutIgnored });
}

/**
 * Three pages, and an outline: two sibling "Summary" on pages 2 and 3, "Part I" without a
 * destination over "Methods" on `methodsPage`, "Missing", whose named destination names nothing,
 * over "Found" on page 2, and "Nowhere", which leads nowhere.
 */
function outlinePdf(methodsPage = 2) {
    return buildPdf([
        "<< /Type /Catalog /Pages 2 0 R /Outlines 6 0 R >>",
        "<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>",
        "<< /Type /Outlines /First 7 0 R /Last 12 0 R /Count 5 >>",
        "<< /Title (Summary) /Parent 6 0 R /Dest [4 0 R /XYZ 0 700 0] /Next 8 0 R >>",
        "<< /Title (Summary) /Parent 6 0 R /Dest [5 0 R /XYZ 0 600 0] /Prev 7 0 R /Next 9 0 R >>",
        "<< /Title (Part I) /Parent 6 0 R /First 10 0 R /Last 10 0 R /Count 1 /Prev 8 0 R /Next 11 0 R >>",
        `<< /Title (Methods) /Parent 9 0 R /Dest [${methodsPage + 2} 0 R /Fit] >>`,
        "<< /Title (Missing) /Parent 6 0 R /Dest (no-such) /First 13 0 R /Last 13 0 R /Count 1 "
            + "/Prev 9 0 R /Next 12 0 R >>",
        "<< /Title (Nowhere) /Parent 6 0 R /Prev 11 0 R >>",
        "<< /Title (Found) /Parent 11 0 R /Dest [4 0 R /Fit] >>"
    ]);
}

/** Gives queued requests the time to do what they would. */
function settle() {
    return new Promise((resolve) => setTimeout(resolve, 30));
}
