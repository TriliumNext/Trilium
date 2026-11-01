import { describe, expect, it, vi } from "vitest";

import { getBoundedView, getCenteredView } from "./drawing_view";

interface Box {
    x: number;
    y: number;
    width: number;
    height: number;
}

vi.mock("@excalidraw/excalidraw", () => ({
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
