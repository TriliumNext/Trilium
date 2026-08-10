// @vitest-environment happy-dom
/**
 * Contract tests against the pinned pdf.js.
 *
 * Everything here asserts something we *depend on* about upstream rather than something we
 * implement, so the whole file is a canary: it should go red when `pdfjs-dist` is bumped or
 * the vendored viewer is re-synced (`scripts/update-viewer.ts`) in a way that breaks us —
 * which is precisely when we want to hear about it, instead of finding out from a user whose
 * attachments stopped listing. pdf.js 6.1 turning `getAttachments()` into a `Map` is the
 * change this file exists to have caught.
 *
 * Note the build split: tests load the `legacy` build while the viewer loads the browser
 * build. They are the same source, so data shapes are genuinely bound, but this file does not
 * validate the vendored bundle itself — the Playwright suite in `e2e/` covers that.
 */
import { AnnotationEditorType, AnnotationType as UpstreamAnnotationType } from "pdfjs-dist/legacy/build/pdf.mjs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AnnotationType } from "./annotations";
import { ANNOTATION_EDITOR_MODE_NONE } from "./editing";
import { allFeaturesPdf, layeredPdf } from "./test/fixture_pdf";
import { InstalledViewer, installViewerApp, uninstallViewerApp } from "./test/viewer_app";

let viewer: InstalledViewer;

/** Swaps in the layer-heavy fixture and returns its optional-content config. */
async function installLayeredDocument() {
    uninstallViewerApp();
    viewer = await installViewerApp(layeredPdf());
    return await viewer.optionalContentConfig();
}

beforeEach(async () => {
    viewer = await installViewerApp(allFeaturesPdf());
});

afterEach(() => {
    uninstallViewerApp();
});

describe("annotation type constants", () => {
    it("match the upstream enums they mirror", () => {
        // annotations.ts re-declares these rather than importing them, because the viewer
        // bundle owns pdf.js at runtime; that copy has to be kept honest from here.
        expect(AnnotationType.TEXT).toBe(UpstreamAnnotationType.TEXT);
        expect(AnnotationType.HIGHLIGHT).toBe(UpstreamAnnotationType.HIGHLIGHT);

        // editing.ts documents this as "Matches AnnotationEditorType.NONE in pdf.js".
        expect(ANNOTATION_EDITOR_MODE_NONE).toBe(AnnotationEditorType.NONE);

        // editing.spec.ts drives the manager with INK as a representative active mode.
        expect(AnnotationEditorType.INK).toBe(15);
    });
});

describe("PDFDocumentProxy shape", () => {
    it("still exposes every method our extraction calls", () => {
        const { pdfDocument } = viewer;
        for (const method of [
            "getOutline",
            "getDestination",
            "getPageIndex",
            "getPage",
            "getAttachments",
            "getAttachmentContent",
            "getOptionalContentConfig",
            "saveDocument"
        ]) {
            expect(pdfDocument, `PDFDocumentProxy.${method}() is gone`).toHaveProperty(method, expect.any(Function));
        }
        expect(pdfDocument.numPages).toBe(2);
    });

    it("returns attachments as a Map keyed by the id getAttachmentContent takes", async () => {
        // The 6.1 regression: this was a plain object before, and `collectAttachments`
        // iterates it with `Array.from(attachments, ...)`, which silently yields nothing
        // for an object. Assert the container type, not just the contents.
        const attachments = await viewer.pdfDocument.getAttachments();
        expect(attachments).toBeInstanceOf(Map);
        expect([...attachments.keys()]).toEqual([ "notes.txt" ]);
        expect(attachments.get("notes.txt")).toMatchObject({ filename: "notes.txt" });

        // Content is fetched separately, keyed by the same map key, and is length-bearing.
        const content = await viewer.pdfDocument.getAttachmentContent("notes.txt");
        expect(content?.length).toBeGreaterThan(0);
    });

    it("returns outline destinations as [pageRef, ...] that getPageIndex accepts", async () => {
        const outline = await viewer.pdfDocument.getOutline();
        expect(outline).toHaveLength(2);

        // toc.ts reads `item.title`, recurses through `item.items`, and treats `dest[0]` as a
        // page reference and `dest[3]` as the y coordinate.
        const [ chapterOne, chapterTwo ] = outline;
        expect(chapterOne.title).toBe("Chapter 1");
        expect(chapterOne.items).toHaveLength(1);
        expect(chapterOne.items[0].title).toBe("Section 1.1");
        expect(chapterTwo.items).toEqual([]);

        expect(Array.isArray(chapterOne.dest)).toBe(true);
        expect(typeof chapterOne.dest[3]).toBe("number");
        expect(chapterOne.dest[3]).toBe(750);

        // The opaque ref in slot 0 must still resolve to a page index.
        expect(await viewer.pdfDocument.getPageIndex(chapterOne.dest[0])).toBe(0);
        expect(await viewer.pdfDocument.getPageIndex(chapterTwo.dest[0])).toBe(1);
    });

    it("wraps annotation text in contentsObj/titleObj and colour in an indexable triple", async () => {
        const page = await viewer.pdfDocument.getPage(1);
        const annotations = await page.getAnnotations({ intent: "display" });

        // processAnnotation() reads exactly these fields; a rename makes every sidebar
        // entry silently blank rather than throwing.
        const highlight = annotations.find((annotation: any) => annotation.annotationType === UpstreamAnnotationType.HIGHLIGHT);
        expect(highlight).toBeDefined();
        expect(highlight.contentsObj?.str).toBe("A remark");
        expect(highlight.titleObj?.str).toBe("Alice");
        expect(highlight.id).toBeTruthy();
        expect([ highlight.color[0], highlight.color[1], highlight.color[2] ]).toEqual([ 255, 0, 0 ]);

        const sticky = annotations.find((annotation: any) => annotation.annotationType === UpstreamAnnotationType.TEXT);
        expect(sticky?.contentsObj?.str).toBe("A sticky note");
    });

    it("exposes optional-content groups with the name/usage/visible fields we filter on", async () => {
        const config = await viewer.pdfDocument.getOptionalContentConfig();
        expect(config).not.toBeNull();
        expect(config).toEqual(expect.objectContaining({
            getOrder: expect.any(Function),
            getGroup: expect.any(Function),
            setVisibility: expect.any(Function)
        }));

        const order = config?.getOrder();
        expect(order).toHaveLength(2);

        // layers.ts drops any group missing `name` or `usage`, and reports `visible`.
        const groups = order?.map((id: any) => config?.getGroup(id));
        expect(groups?.map((group: any) => ({ name: group.name, visible: group.visible, hasUsage: !!group.usage })))
            .toEqual([
                { name: "Visible layer", visible: true, hasUsage: true },
                { name: "Hidden layer", visible: false, hasUsage: true }
            ]);

        // The toggle path mutates the same config object in place.
        config?.setVisibility(order[1], true);
        expect(config?.getGroup(order[1]).visible).toBe(true);
    });

    it("orders optional-content groups as ids and { name, order } wrappers only", async () => {
        // `flattenOrder` in layers.ts walks exactly these two shapes. pdf.js builds them in
        // parseOrder/parseNestedOrder: a group id string, or a wrapper holding nested groups —
        // the latter used both for labelled groups and for a synthetic, null-named entry
        // collecting groups left out of /Order. If a third shape ever appears, or nesting stops
        // being expressed this way, layers silently vanish from the sidebar; fail here instead.
        const config = await installLayeredDocument();
        const order = config.getOrder();

        expect(order).toEqual([
            expect.any(String),
            expect.any(String),
            expect.any(String),
            { name: "Grouped", order: [ expect.any(String) ] },
            { name: null, order: [ expect.any(String) ] }
        ]);
        // Specifically: never a bare nested array, which the old flattening looked for.
        expect(order.some((item: any) => Array.isArray(item))).toBe(false);
    });

    it("keeps annotationStorage's modification hooks reachable", () => {
        // `onSetModified` is a private monkey-patch point (custom.ts, annotations.ts) with no
        // public type. We cannot bind its contract, but we can catch it disappearing.
        const storage = viewer.pdfDocument.annotationStorage;
        expect(storage).toBeDefined();
        expect(storage).toHaveProperty("resetModified", expect.any(Function));
        expect("onSetModified" in storage).toBe(true);
    });
});
