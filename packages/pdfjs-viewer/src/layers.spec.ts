// @vitest-environment happy-dom
/**
 * Drives the optional-content (layer) plumbing against a real `OptionalContentConfig` built by
 * pdf.js from the fixtures in {@link ./test/fixture_pdf}, rather than a stand-in with
 * hand-chosen fields. Driving the real thing is what surfaced the nested-group handling
 * covered below: a fake built from our own assumptions would have agreed with them.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { setupPdfLayers } from "./layers";
import { allFeaturesPdf, barePdf, buildPdf, layeredPdf } from "./test/fixture_pdf";
import { InstalledViewer, installViewerApp, uninstallViewerApp } from "./test/viewer_app";

let viewer: InstalledViewer;

afterEach(() => uninstallViewerApp());

describe("layer extraction", () => {
    it("reports each named layer with the visibility pdf.js resolved for it", async () => {
        viewer = await installViewerApp(allFeaturesPdf());

        await setupPdfLayers();

        // `visible` comes from the /ON and /OFF arrays via pdf.js' own resolution, not from
        // anything we compute — the sidebar checkboxes mirror it directly.
        expect(viewer.lastMessageOfType("pdfjs-viewer-layers")).toEqual({
            type: "pdfjs-viewer-layers",
            layers: [
                { id: expect.any(String), name: "Visible layer", visible: true },
                { id: expect.any(String), name: "Hidden layer", visible: false }
            ]
        });
    });

    it("drops groups pdf.js reports without a name", async () => {
        viewer = await installViewerApp(layeredPdf());

        await setupPdfLayers();

        // The nameless OCG in the fixture must not reach the sidebar as an unlabelled row.
        const { layers } = viewer.lastMessageOfType("pdfjs-viewer-layers");
        expect(layers.map((layer: any) => layer.name)).not.toContain(null);
    });

    it("includes layers nested under a group label and layers missing from /Order", async () => {
        viewer = await installViewerApp(layeredPdf());

        await setupPdfLayers();

        // pdf.js reports both of these as `{ name, order }` wrappers rather than plain ids:
        // "Nested layer" sits under a "Grouped" label, and "Unordered layer" is absent from
        // /Order so pdf.js gathers it into a synthetic null-named entry. Grouped layers are
        // routine in CAD and Illustrator exports, so dropping them hid real content.
        expect(viewer.lastMessageOfType("pdfjs-viewer-layers").layers).toEqual([
            { id: expect.any(String), name: "Visible layer", visible: true },
            { id: expect.any(String), name: "Hidden layer", visible: false },
            { id: expect.any(String), name: "Nested layer", visible: true },
            { id: expect.any(String), name: "Unordered layer", visible: true }
        ]);
    });

    it("reports an empty list for a document with no optional content", async () => {
        viewer = await installViewerApp(barePdf());

        await setupPdfLayers();

        expect(viewer.lastMessageOfType("pdfjs-viewer-layers")).toEqual({
            type: "pdfjs-viewer-layers",
            layers: []
        });
    });

    it("reads the document's own config when the viewer holds none", async () => {
        viewer = await installViewerApp(allFeaturesPdf());
        const app = window.PDFViewerApplication;
        if (app) {
            app.pdfViewer.optionalContentConfigPromise = undefined as never;
        }

        await setupPdfLayers();

        expect(viewer.lastMessageOfType("pdfjs-viewer-layers").layers.map((layer: any) => layer.name))
            .toEqual([ "Visible layer", "Hidden layer" ]);
    });

    it("reports an empty list when pdf.js resolves no config at all", async () => {
        viewer = await installViewerApp(allFeaturesPdf());
        const app = window.PDFViewerApplication;
        if (app) {
            app.pdfViewer.optionalContentConfigPromise = Promise.resolve(null) as never;
        }

        await setupPdfLayers();

        expect(viewer.lastMessageOfType("pdfjs-viewer-layers")).toEqual({
            type: "pdfjs-viewer-layers",
            layers: []
        });
    });

    it("skips order entries that are neither a group id nor a nested group", async () => {
        viewer = await installViewerApp(allFeaturesPdf());
        const config = await viewer.optionalContentConfig();
        const [ visibleId ] = config.getOrder();
        vi.spyOn(config, "getOrder").mockReturnValue([ null, { name: "Label only" }, visibleId ]);

        await setupPdfLayers();

        expect(viewer.lastMessageOfType("pdfjs-viewer-layers").layers)
            .toEqual([ { id: visibleId, name: "Visible layer", visible: true } ]);
    });

    it("reports an empty list when extraction throws", async () => {
        viewer = await installViewerApp(allFeaturesPdf());
        vi.spyOn(console, "error").mockImplementation(() => {});
        const app = window.PDFViewerApplication;
        if (app) {
            app.pdfViewer.optionalContentConfigPromise = Promise.reject(new Error("boom")) as never;
        }

        await setupPdfLayers();

        expect(viewer.lastMessageOfType("pdfjs-viewer-layers")).toEqual({
            type: "pdfjs-viewer-layers",
            layers: []
        });
    });
});

describe("layer toggling", () => {
    it("flips visibility on the shared config, announces it, and re-reports the layers", async () => {
        viewer = await installViewerApp(allFeaturesPdf());
        await setupPdfLayers();

        const config = await viewer.optionalContentConfig();
        const hiddenId = config?.getOrder()[1];
        const announced = vi.fn();
        // pdf.js' real EventBus, so a rename of this event name breaks the test.
        viewer.eventBus.on("optionalcontentconfig", announced);

        viewer.sendFromParent({ type: "trilium-toggle-layer", layerId: hiddenId, visible: true });
        await vi.waitFor(() => expect(viewer.messagesOfType("pdfjs-viewer-layers")).toHaveLength(2));

        // The viewer re-renders off the event, so it has to fire with the same config object.
        expect(announced).toHaveBeenCalledTimes(1);
        await expect(announced.mock.calls[0][0].promise).resolves.toBe(config);

        // And the follow-up message reflects the new state pdf.js now resolves.
        expect(viewer.lastMessageOfType("pdfjs-viewer-layers").layers).toEqual([
            { id: expect.any(String), name: "Visible layer", visible: true },
            { id: hiddenId, name: "Hidden layer", visible: true }
        ]);
    });

    it("drops a toggle while the viewer has no page view or config to apply it to", async () => {
        viewer = await installViewerApp(allFeaturesPdf());
        await setupPdfLayers();
        const app = window.PDFViewerApplication;
        if (!app) throw new Error("viewer not installed");
        const pdfViewer = app.pdfViewer;
        const announced = vi.fn();
        viewer.eventBus.on("optionalcontentconfig", announced);

        (app as any).pdfViewer = undefined;
        viewer.sendFromParent({ type: "trilium-toggle-layer", layerId: "12R", visible: false });
        app.pdfViewer = pdfViewer;
        pdfViewer.optionalContentConfigPromise = Promise.resolve(null) as never;
        viewer.sendFromParent({ type: "trilium-toggle-layer", layerId: "12R", visible: false });
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(announced).not.toHaveBeenCalled();
        expect(viewer.messagesOfType("pdfjs-viewer-layers")).toHaveLength(1);
    });

    it("logs a toggle pdf.js rejects and leaves the reported layers alone", async () => {
        viewer = await installViewerApp(allFeaturesPdf());
        await setupPdfLayers();
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        const config = await viewer.optionalContentConfig();
        vi.spyOn(config, "setVisibility").mockImplementation(() => {
            throw new Error("boom");
        });

        viewer.sendFromParent({ type: "trilium-toggle-layer", layerId: "12R", visible: false });
        await vi.waitFor(() => expect(error).toHaveBeenCalled());

        expect(viewer.messagesOfType("pdfjs-viewer-layers")).toHaveLength(1);
    });

    it("ignores toggle requests from another origin", async () => {
        viewer = await installViewerApp(allFeaturesPdf());
        await setupPdfLayers();

        window.dispatchEvent(new MessageEvent("message", {
            data: { type: "trilium-toggle-layer", layerId: "12R", visible: false },
            origin: "https://evil.example"
        }));
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(viewer.messagesOfType("pdfjs-viewer-layers")).toHaveLength(1);
    });
});

describe("nesting depth", () => {
    it("reaches layers nested more than one level deep", async () => {
        // pdf.js allows nesting up to MAX_NESTED_LEVELS, so the flattening has to recurse
        // rather than special-case a single level.
        viewer = await installViewerApp(buildPdf([
            "<< /Type /Catalog /Pages 2 0 R /OCProperties << /OCGs [4 0 R] "
                + "/D << /Order [[(Outer) [(Inner) 4 0 R]]] /ON [4 0 R] >> >> >>",
            "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>",
            "<< /Type /OCG /Name (Deeply nested layer) >>"
        ]));

        await setupPdfLayers();

        expect(viewer.lastMessageOfType("pdfjs-viewer-layers").layers)
            .toEqual([ { id: expect.any(String), name: "Deeply nested layer", visible: true } ]);
    });
});
