// @vitest-environment happy-dom
/**
 * Drives the outline of the sidebar and the build of the ToC cache against a real
 * `PDFDocumentProxy`, so the outline shapes, destination arrays and page-index lookups all come
 * from pdf.js rather than a fake. See {@link ./test/fixture_pdf} for why.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { PDF_TOC_READER } from "@triliumnext/commons/src/lib/pdf_toc.js";
import { blobIdFromDigest } from "@triliumnext/commons/src/lib/utils.js";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { trackDocument } from "./navigation";
import { allFeaturesPdf, barePdf, buildPdf } from "./test/fixture_pdf";
import { type InstalledViewer, installViewerApp, uninstallViewerApp } from "./test/viewer_app";
import { extractAndSendToc, setupActiveHeadingTracking, setupTocBuild } from "./toc";

const TEST_DIR = join(dirname(fileURLToPath(import.meta.url)), "test");
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)),
    "../../trilium-core/src/services/toc/fixtures");

/** Page boxes for the two-page fixture: 800px pages stacked with a 10px gap. */
const PAGE_GEOMETRY = {
    0: { offsetTop: 0, clientHeight: 800 },
    1: { offsetTop: 810, clientHeight: 800 }
};

describe("the outline of the sidebar", () => {
    let viewer: InstalledViewer;

    afterEach(() => uninstallViewerApp());

    it("sends the headings in document order, each with its key in this viewer", async () => {
        viewer = await installViewerApp(allFeaturesPdf());

        await extractAndSendToc();

        expect(viewer.lastMessageOfType("pdfjs-viewer-toc")).toEqual({
            type: "pdfjs-viewer-toc",
            data: [
                { id: "outline-0", title: "Chapter 1", level: 1 },
                { id: "outline-1", title: "Section 1.1", level: 2 },
                { id: "outline-2", title: "Chapter 2", level: 1 }
            ]
        });
    });

    it("shows a heading deeper than 32 levels at level 32", async () => {
        viewer = await installViewerApp(barePdf());
        let deepest = { title: "Level 34", dest: null, items: [] as unknown[] };
        for (let level = 33; level >= 1; level--) {
            deepest = { title: `Level ${level}`, dest: null, items: [ deepest ] };
        }
        vi.spyOn(viewer.pdfDocument, "getOutline").mockResolvedValue([ deepest ] as any);

        await extractAndSendToc();

        const levels = viewer.lastMessageOfType("pdfjs-viewer-toc").data.map(({ level }: { level: number }) => level);
        expect(levels.slice(30)).toEqual([ 31, 32, 32, 32 ]);
    });

    it("reports a null table of contents for a document without an outline", async () => {
        viewer = await installViewerApp(barePdf());

        await extractAndSendToc();

        // The sidebar distinguishes "no outline" from "not extracted yet", so the message
        // still has to be sent — with a null payload.
        expect(viewer.lastMessageOfType("pdfjs-viewer-toc")).toEqual({ type: "pdfjs-viewer-toc", data: null });
    });

    it("falls back to a null table of contents when extraction throws", async () => {
        viewer = await installViewerApp(allFeaturesPdf());
        vi.spyOn(viewer.pdfDocument, "getOutline").mockRejectedValue(new Error("boom"));

        await extractAndSendToc();

        expect(viewer.lastMessageOfType("pdfjs-viewer-toc")).toEqual({ type: "pdfjs-viewer-toc", data: null });
    });
});

describe("active heading tracking", () => {
    let viewer: InstalledViewer;

    beforeEach(() => vi.useFakeTimers());

    afterEach(() => {
        vi.useRealTimers();
        uninstallViewerApp();
    });

    /** Installs the fixture and starts tracking, with the outline already read. */
    async function startTracking(data = allFeaturesPdf(), geometry: Record<number, typeof PAGE_GEOMETRY[0]> = PAGE_GEOMETRY) {
        viewer = await installViewerApp(data, geometry);
        await extractAndSendToc();
        setupActiveHeadingTracking();
        return viewer;
    }

    it("reports the heading nearest the top of the viewport as the user scrolls", async () => {
        await startTracking();

        // Headings sit at screen y=50 (Chapter 1), y=200 (Section 1.1) and y=910 (Chapter 2),
        // derived from the PDF's bottom-up coordinates against the page boxes above.
        expect(viewer.lastMessageOfType("pdfjs-viewer-active-heading")?.headingId).toBe("outline-0");

        viewer.scrollTo(200);
        viewer.eventBus.dispatch("pagechanging", { source: null, pageNumber: 1 });
        await vi.advanceTimersByTimeAsync(100);
        expect(viewer.lastMessageOfType("pdfjs-viewer-active-heading")?.headingId).toBe("outline-1");

        viewer.scrollTo(900);
        viewer.eventBus.dispatch("pagechanging", { source: null, pageNumber: 2 });
        await vi.advanceTimersByTimeAsync(100);
        expect(viewer.lastMessageOfType("pdfjs-viewer-active-heading")?.headingId).toBe("outline-2");
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
        expect(sent[0].headingId).toBe("outline-2");
    });

    it("stays silent while the active heading has not changed", async () => {
        await startTracking();
        const before = viewer.messagesOfType("pdfjs-viewer-active-heading").length;

        viewer.eventBus.dispatch("pagechanging", { source: null, pageNumber: 1 });
        await vi.advanceTimersByTimeAsync(100);

        expect(viewer.messagesOfType("pdfjs-viewer-active-heading")).toHaveLength(before);
    });

    it("places a destination without a y coordinate at the bottom of its page, and skips headings without one", async () => {
        await startTracking(mixedDestinationsPdf(), { 0: { offsetTop: 0, clientHeight: 800 } });

        // "Named" sits at screen y=300 and "Fit", taken as y=0, at the bottom of the page, y=800.
        viewer.scrollTo(800);
        viewer.eventBus.dispatch("pagechanging", { source: null, pageNumber: 1 });
        await vi.advanceTimersByTimeAsync(100);
        expect(viewer.lastMessageOfType("pdfjs-viewer-active-heading")?.headingId).toBe("outline-2");

        viewer.scrollTo(300);
        viewer.eventBus.dispatch("pagechanging", { source: null, pageNumber: 1 });
        await vi.advanceTimersByTimeAsync(100);
        expect(viewer.lastMessageOfType("pdfjs-viewer-active-heading")?.headingId).toBe("outline-0");
    });

    it("does nothing for a document without an outline", async () => {
        await startTracking(barePdf());

        viewer.eventBus.dispatch("pagechanging", { source: null, pageNumber: 1 });
        await vi.advanceTimersByTimeAsync(100);

        expect(viewer.messagesOfType("pdfjs-viewer-active-heading")).toHaveLength(0);
    });
});

describe("the build of the ToC cache", () => {
    const contractPdf = new Uint8Array(readFileSync(join(FIXTURES, "toc_contract.pdf")));
    const contract = JSON.parse(readFileSync(join(FIXTURES, "toc_contract.json"), "utf-8"));
    let viewer: InstalledViewer;

    afterEach(() => {
        uninstallViewerApp();
        vi.unstubAllGlobals();
    });

    /** Installs `data` with the listener for builds, before the document has loaded. */
    async function install(data: Uint8Array) {
        viewer = await installViewerApp(data.slice());
        const app = window.PDFViewerApplication;
        if (!app) throw new Error("The viewer is not installed.");
        trackDocument(app);
        setupTocBuild();
    }

    function loadDocument() {
        viewer.eventBus.dispatch("documentloaded", { source: null });
    }

    async function answerOf(requestId: number) {
        await vi.waitFor(() => expect(viewer.messagesOfType("pdfjs-viewer-toc-build")
            .find((message) => message.requestId === requestId)).toBeDefined());
        return viewer.messagesOfType("pdfjs-viewer-toc-build").find((message) => message.requestId === requestId);
    }

    it("answers a request posted before the document loads with what the server reads from it", async () => {
        await install(contractPdf);
        viewer.sendFromParent({ type: "trilium-build-toc", requestId: 7, isProtected: false });
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(viewer.messagesOfType("pdfjs-viewer-toc-build")).toHaveLength(0);

        loadDocument();

        expect(await answerOf(7)).toEqual({
            type: "pdfjs-viewer-toc-build",
            requestId: 7,
            blobId: contract.blobId,
            headings: contract.headings,
            properties: { reader: PDF_TOC_READER },
            elapsedMs: expect.any(Number)
        });
    });

    it("names the bytes in the form of the document's protection, with Web Crypto and with the bundled hash", async () => {
        for (const isWebCryptoAvailable of [ true, false ]) {
            if (!isWebCryptoAvailable) {
                vi.stubGlobal("crypto", {});
            }
            await install(contractPdf);
            loadDocument();

            viewer.sendFromParent({ type: "trilium-build-toc", requestId: 1, isProtected: true });
            viewer.sendFromParent({ type: "trilium-build-toc", requestId: 2, isProtected: false });

            expect((await answerOf(1)).blobId).toBe(contract.protectedBlobId);
            expect((await answerOf(2)).blobId).toBe(contract.blobId);
            uninstallViewerApp();
        }
    });

    it("reads the bytes of a save on their own, and destroys their loading task", async () => {
        await install(contractPdf);
        loadDocument();
        const tasks = recordLoadingTasks();
        const saved = allFeaturesPdf();
        const blobId = blobIdFromDigest(new Uint8Array(createHash("sha512").update(saved).digest()));

        viewer.sendFromParent({ type: "trilium-build-toc", requestId: 3, isProtected: false, data: saved });

        expect(await answerOf(3)).toMatchObject({
            blobId,
            headings: [
                { title: "Chapter 1", level: 1, page: 1 },
                { title: "Section 1.1", level: 2, page: 1 },
                { title: "Chapter 2", level: 1, page: 2 }
            ]
        });
        expect(tasks).toHaveLength(1);
        expect(tasks[0].destroy).toHaveBeenCalledOnce();
    });

    it("fails for saved bytes that need a password, and destroys the rejected task", async () => {
        await install(contractPdf);
        loadDocument();
        const tasks = recordLoadingTasks();
        const locked = new Uint8Array(readFileSync(join(TEST_DIR, "encrypted_user_password.pdf")));
        const ownerOnly = new Uint8Array(readFileSync(join(TEST_DIR, "encrypted_owner_password.pdf")));

        viewer.sendFromParent({ type: "trilium-build-toc", requestId: 4, isProtected: false, data: locked });
        viewer.sendFromParent({ type: "trilium-build-toc", requestId: 5, isProtected: false, data: ownerOnly });

        expect(await answerOf(4)).toEqual({ type: "pdfjs-viewer-toc-build", requestId: 4, failed: true });
        // A file with an owner password only opens without one.
        expect((await answerOf(5)).headings.map(({ title }: { title: string }) => title))
            .toEqual([ "Chapter 1", "Section 1.1", "Chapter 2" ]);
        expect(tasks).toHaveLength(2);
        expect(tasks[0].destroy).toHaveBeenCalledOnce();
        expect(tasks[1].destroy).toHaveBeenCalledOnce();
    });

    it("fails when the outline of the loaded document cannot be read", async () => {
        await install(contractPdf);
        vi.spyOn(viewer.pdfDocument, "getOutline").mockRejectedValue(new Error("The worker stopped."));
        loadDocument();

        viewer.sendFromParent({ type: "trilium-build-toc", requestId: 6, isProtected: false });

        expect(await answerOf(6)).toEqual({ type: "pdfjs-viewer-toc-build", requestId: 6, failed: true });
    });

    it("ignores a request from another origin", async () => {
        await install(contractPdf);
        loadDocument();

        window.dispatchEvent(new MessageEvent("message", {
            data: { type: "trilium-build-toc", requestId: 8, isProtected: false },
            origin: "https://evil.example"
        }));
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(viewer.messagesOfType("pdfjs-viewer-toc-build")).toHaveLength(0);
    });

    /** The loading tasks the build opens bytes with, each with a spy on `destroy()`. */
    function recordLoadingTasks() {
        const tasks: ReturnType<typeof getDocument>[] = [];
        vi.spyOn(window.pdfjsLib, "getDocument").mockImplementation((src) => {
            const task = getDocument(src);
            vi.spyOn(task, "destroy");
            tasks.push(task);
            return task;
        });
        return tasks;
    }
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
