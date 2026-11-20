// @vitest-environment happy-dom
/**
 * The reading position and the page rotations that the viewer reports for the outline, against
 * the page views of the thin viewer application and pdf.js' own viewports.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setupPositionTracking } from "./position";
import { allFeaturesPdf } from "./test/fixture_pdf";
import {
    type InstalledViewer, installViewerApp, type PageGeometry, uninstallViewerApp
} from "./test/viewer_app";

/** The two US Letter pages of the fixture, 612 by 792 points, stacked with a gap of 208 px. */
const STACKED = {
    0: { offsetTop: 0, clientHeight: 792 }, 1: { offsetTop: 1000, clientHeight: 792 }
};
/** The same pages side by side, as the horizontal scroll mode lays them out. */
const SIDE_BY_SIDE = {
    0: { offsetTop: 0, clientHeight: 792 }, 1: { offsetTop: 0, offsetLeft: 620, clientHeight: 792 }
};

let viewer: InstalledViewer;

beforeEach(() => {
    window.TRILIUM_NOTE_ID = "note-1";
    window.TRILIUM_NTX_ID = "ntx-1";
    window.TRILIUM_LOAD_TOKEN = "load-1";
});

afterEach(() => uninstallViewerApp());

describe("the reading position", () => {
    it("posts the point of the reading line, 100 px down the middle, on its page", async () => {
        await start(STACKED);

        expect(viewer.messagesOfType("pdfjs-viewer-position")).toStrictEqual([ {
            type: "pdfjs-viewer-position", loadToken: "load-1", pageNumber: 1, x: 300, y: 692,
            ntxId: "ntx-1", noteId: "note-1"
        } ]);
        await scroll(1100);
        expect(lastPosition()).toMatchObject({ pageNumber: 2, x: 300, y: 592 });
    });

    it("counts a reading line in a gap or a margin as the edge of the page above it", async () => {
        await start(STACKED);

        // The line runs 20 px above page 2, which starts below it.
        await scroll(880);
        expect(lastPosition()).toMatchObject({ pageNumber: 1, x: 300, y: 0 });
        await scroll(0, 400);
        expect(lastPosition()).toMatchObject({ pageNumber: 1, x: 612, y: 692 });
    });

    it("waits for scrolling to settle, and posts only a position that changed", async () => {
        const app = await start(STACKED);

        viewer.scrollTo(200);
        app.pdfViewer.container.dispatchEvent(new Event("scroll"));
        viewer.scrollTo(300);
        app.pdfViewer.container.dispatchEvent(new Event("scroll"));
        expect(viewer.messagesOfType("pdfjs-viewer-position")).toHaveLength(1);
        await settle();
        expect(viewer.messagesOfType("pdfjs-viewer-position")).toHaveLength(2);
        expect(lastPosition()).toMatchObject({ pageNumber: 1, y: 392 });

        app.eventBus.dispatch("pagechanging", { source: null, pageNumber: 1 });
        await settle();
        expect(viewer.messagesOfType("pdfjs-viewer-position")).toHaveLength(2);
    });

    it("posts at once after a change of zoom, scroll mode or spread mode", async () => {
        const app = await start(STACKED);

        for (const [ index, event ] of [
            "scalechanging", "scrollmodechanged", "spreadmodechanged"
        ].entries()) {
            viewer.scrollTo(10 * (index + 1));
            app.eventBus.dispatch(event, { source: null });
            expect(viewer.messagesOfType("pdfjs-viewer-position")).toHaveLength(index + 2);
        }
        expect(lastPosition()).toMatchObject({ y: 662 });
    });

    it("takes the page under the point in a row, and skips a page pdf.js detached", async () => {
        await start(SIDE_BY_SIDE);
        expect(lastPosition()).toMatchObject({ pageNumber: 1, x: 300 });

        await scroll(0, 600);
        expect(lastPosition()).toMatchObject({ pageNumber: 2, x: 280, y: 692 });

        // The scroll page mode keeps only the views of the shown pages in the viewer.
        viewer.pageView(0)?.div.remove();
        await scroll(0, 0);
        expect(lastPosition()).toMatchObject({ pageNumber: 2, x: 0, y: 692 });
    });
});

describe("the rotations of the pages", () => {
    it("posts the rotation of every page, and again with the position on a rotation", async () => {
        const app = await start({ ...STACKED, 1: { ...STACKED[1], pdfPageRotate: 90 } });
        expect(viewer.messagesOfType("pdfjs-viewer-rotations")).toStrictEqual([ {
            type: "pdfjs-viewer-rotations", loadToken: "load-1", rotations: [ 0, 90 ],
            ntxId: "ntx-1", noteId: "note-1"
        } ]);

        await viewer.rotatePage(0, 270);
        await viewer.rotatePage(1, 270);
        app.eventBus.dispatch("rotationchanging", {
            source: null, pagesRotation: 270, pageNumber: 1
        });

        expect(viewer.lastMessageOfType("pdfjs-viewer-rotations").rotations)
            .toStrictEqual([ 270, 0 ]);
        expect(viewer.messagesOfType("pdfjs-viewer-position")).toHaveLength(2);
        // Down the screen of a page turned by 270 degrees runs to smaller x.
        expect(lastPosition()).toMatchObject({ pageNumber: 1, x: 512, y: 492 });
    });

    it("posts the rotation of a page that pdf.js reads later only when it differs", async () => {
        const app = await start(STACKED);
        const view = viewer.pageView(1);
        if (!view) throw new Error("No page view.");

        view.pdfPageRotate = 90;
        app.eventBus.dispatch("pagerendered", { source: null, pageNumber: 2 });
        app.eventBus.dispatch("pagerendered", { source: null, pageNumber: 2 });
        app.eventBus.dispatch("pagerendered", { source: null, pageNumber: 1 });

        expect(viewer.messagesOfType("pdfjs-viewer-page-rotation")).toStrictEqual([ {
            type: "pdfjs-viewer-page-rotation", loadToken: "load-1", pageNumber: 2, rotation: 90,
            ntxId: "ntx-1", noteId: "note-1"
        } ]);
        expect(viewer.messagesOfType("pdfjs-viewer-rotations")).toHaveLength(1);
    });
});

/** Installs the fixture with `geometry` and starts the tracking, as the viewer does at load. */
async function start(geometry: Record<number, PageGeometry>) {
    viewer = await installViewerApp(allFeaturesPdf(), geometry);
    const app = window.PDFViewerApplication;
    if (!app) throw new Error("The viewer is not installed.");
    setupPositionTracking(app);
    await settle();
    return app;
}

/** Scrolls the container and lets the tracking post. */
async function scroll(scrollTop: number, scrollLeft = 0) {
    viewer.scrollTo(scrollTop, scrollLeft);
    window.PDFViewerApplication?.pdfViewer.container.dispatchEvent(new Event("scroll"));
    await settle();
}

function lastPosition() {
    return viewer.lastMessageOfType("pdfjs-viewer-position");
}

/** Waits past the debounce of a scroll. */
function settle() {
    return new Promise((resolve) => setTimeout(resolve, 150));
}
