import { describe, expect, it, vi } from "vitest";

import {
    applyDrawingView, type DrawingView, getBoundedView, getCenteredView, getFrame, getFrameView,
    getFrameViewAt, getWidenedFrame, getZoomToFitView, takeAppliedView
} from "./drawing_view";

interface Box {
    x: number;
    y: number;
    width: number;
    height: number;
}

vi.mock("@excalidraw/excalidraw", () => ({
    CaptureUpdateAction: { NEVER: "never" },
    getCommonBounds: (elements: Box[]) => [
        Math.min(...elements.map(({ x }) => x)),
        Math.min(...elements.map(({ y }) => y)),
        Math.max(...elements.map(({ x, width }) => x + width)),
        Math.max(...elements.map(({ y, height }) => y + height))
    ]
}));

describe("getBoundedView", () => {
    const IMAGE = { type: "image", locked: true, x: 100, y: 50, width: 1000, height: 1000 };
    const FITTED = { zoom: { value: 0.5 }, scrollX: 400, scrollY: -50 };

    function bound(
        elements: object[], zoom: number, scrollX: number, scrollY: number, width = 1000
    ) {
        const appState = { width, height: 500, zoom: { value: zoom }, scrollX, scrollY };
        return getBoundedView(elements as never, appState as never);
    }

    it("keeps the view of a drawing over a locked image inside the image", () => {
        expect(bound([ IMAGE ], 0.25, 0, 0)).toEqual(FITTED);
        expect(bound([ IMAGE ], 0.5, 400, -50)).toBeNull();
        expect(bound([ IMAGE ], 2, -300, -400)).toBeNull();
        expect(bound([ IMAGE ], 2, 0, -900))
            .toEqual({ zoom: { value: 2 }, scrollX: -100, scrollY: -800 });
        // Centered along the axis on which the view is longer than the image.
        expect(bound([ IMAGE ], 0.625, 0, 0))
            .toEqual({ zoom: { value: 0.625 }, scrollX: 200, scrollY: -50 });

        const deleted = { type: "rectangle", isDeleted: true, x: 0, y: 0, width: 10, height: 10 };
        expect(bound([ deleted, IMAGE ], 0.25, 0, 0)).toEqual(FITTED);
    });

    it("leaves alone a drawing whose bottom shape is not a locked image", () => {
        const rectangle = { type: "rectangle", x: 0, y: 0, width: 10, height: 10 };
        expect(bound([ { ...IMAGE, locked: false } ], 0.25, 0, 0)).toBeNull();
        expect(bound([ { ...IMAGE, type: "rectangle" } ], 0.25, 0, 0)).toBeNull();
        expect(bound([ rectangle, IMAGE ], 0.25, 0, 0)).toBeNull();
        expect(bound([], 0.25, 0, 0)).toBeNull();
        expect(bound([ IMAGE ], 0.25, 0, 0, 0)).toBeNull();
    });
});

describe("getFrame", () => {
    it("is the box in scene units at its scale, to thousandths, and gives the view back", () => {
        const view = { zoom: { value: 2 }, scrollX: -100.0004, scrollY: 50 } as never;
        const frame = getFrame(view, 1000, 500);
        expect(frame).toEqual({ x: 100, y: -50, width: 500, height: 250, scale: 2 });
        expect(getFrameView(frame)).toEqual({ zoom: { value: 2 }, scrollX: -100, scrollY: 50 });
    });

    it("fills a box of another width with the frame, within Excalidraw's zoom limits", () => {
        const frame = { x: 100, y: -50, width: 500, height: 250, scale: 2 };
        expect(getFrameViewAt(frame, 800))
            .toEqual({ zoom: { value: 1.6 }, scrollX: -100, scrollY: 50 });
        expect(getFrameViewAt(frame, 1000)).toEqual(getFrameView(frame));
        expect(getFrameViewAt(frame, 10).zoom.value).toBe(0.1);
        expect(getFrameViewAt(frame, 100_000).zoom.value).toBe(30);
    });

    it("widens around its center at its scale", () => {
        const frame = { x: 100, y: -50, width: 500, height: 250, scale: 2 };
        expect(getWidenedFrame(frame, 1400))
            .toEqual({ x: 0, y: -50, width: 700, height: 250, scale: 2 });
        expect(getWidenedFrame(frame, 600))
            .toEqual({ x: 200, y: -50, width: 300, height: 250, scale: 2 });
    });
});

describe("applyDrawingView", () => {
    it("shows the view, which counts as applied once", () => {
        const updateScene = vi.fn();
        const api = { updateScene } as never;
        const view = { zoom: { value: 2 }, scrollX: 1, scrollY: 2 } as DrawingView;

        applyDrawingView(api, view);
        expect(updateScene).toHaveBeenCalledExactlyOnceWith({
            appState: view, captureUpdate: "never"
        });
        expect(takeAppliedView(api, { ...view, scrollX: 3 })).toBe(false);
        expect(takeAppliedView(api, { ...view })).toBe(true);
        expect(takeAppliedView(api, { ...view })).toBe(false);
    });
});

describe("getCenteredView", () => {
    it("centers the shapes of a drawing at the same zoom, and nothing without them", () => {
        const view = { zoom: { value: 2 }, scrollX: 0, scrollY: 0 } as never;
        const shape = { x: 100, y: 50, width: 200, height: 100 };

        expect(getCenteredView([ shape ] as never, view, 1000, 500))
            .toEqual({ zoom: { value: 2 }, scrollX: 50, scrollY: 25 });
        expect(getCenteredView([ { ...shape, isDeleted: true } ] as never, view, 1000, 500))
            .toBeNull();
    });
});

describe("getZoomToFitView", () => {
    const fit = (elements: object[], width = 1000) =>
        getZoomToFitView(elements as never, width, 500);

    it("fits the shapes in steps of 10%, from 10% to 100%, as Excalidraw does", () => {
        expect(fit([ { x: 100, y: 50, width: 3000, height: 1000 } ])).toEqual({
            zoom: { value: 0.3 },
            scrollX: expect.closeTo(500 / 0.3 - 1600),
            scrollY: expect.closeTo(250 / 0.3 - 550)
        });
        expect(fit([ { x: 0, y: 0, width: 10, height: 10 } ]))
            .toEqual({ zoom: { value: 1 }, scrollX: 495, scrollY: 245 });
        expect(fit([ { x: 0, y: 0, width: 100000, height: 10 } ]))
            .toEqual({ zoom: { value: 0.1 }, scrollX: -45000, scrollY: 2495 });
    });

    it("leaves out deleted shapes, and fits nothing without shapes or a size", () => {
        const shape = { x: 0, y: 0, width: 10, height: 10 };
        const deleted = { x: 0, y: 0, width: 5000, height: 5000, isDeleted: true };
        expect(fit([ deleted, shape ])).toEqual(fit([ shape ]));
        expect(fit([ deleted ])).toBeNull();
        expect(fit([])).toBeNull();
        expect(fit([ shape ], 0)).toBeNull();
    });

    it("fits the shapes between the panels that cover the drawing", () => {
        const shape = { x: 0, y: 0, width: 1200, height: 100 };
        const fitBetween = (left: number, right: number) =>
            getZoomToFitView([ shape ] as never, 1000, 500, { left, right });

        // 600 of the 1000 are free, from 0 to 600 and from 200 to 800.
        expect(fitBetween(0, 400)).toEqual({ zoom: { value: 0.5 }, scrollX: 0, scrollY: 450 });
        expect(fitBetween(200, 200)).toEqual({ zoom: { value: 0.5 }, scrollX: 400, scrollY: 450 });
        // Panels across the whole width leave the whole width.
        expect(fitBetween(600, 400)).toEqual(fit([ shape ]));
    });
});
