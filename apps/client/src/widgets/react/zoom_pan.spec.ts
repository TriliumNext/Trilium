import { describe, expect, it } from "vitest";

import { clampPan, wheelTargetScale, zoomStep, zoomToPointPosition } from "./zoom_pan";

describe("zoomStep", () => {
    it("is the increment react-zoom-pan-pinch needs for a ×1.2 step, at any scale", () => {
        // The library adds the step to the current scale, so what is asserted is where each press
        // lands rather than the increment itself.
        expect(1 + zoomStep(1, "in")).toBeCloseTo(1.2);
        expect(1 - zoomStep(1, "out")).toBeCloseTo(1 / 1.2);

        // A fixed increment would be a leap here and a crawl at the other end; these stay a fifth
        // of what is on screen apart.
        expect(0.6 + zoomStep(0.6, "in")).toBeCloseTo(0.72);
        expect(8 + zoomStep(8, "in")).toBeCloseTo(9.6);

        // A step out undoes a step in, so the readout returns to where it started.
        const zoomedIn = 3 + zoomStep(3, "in");
        expect(zoomedIn - zoomStep(zoomedIn, "out")).toBeCloseTo(3);
    });
});

describe("wheelTargetScale", () => {
    // A wheel reports deltaY down the page for a notch out, and up the page for a notch in.
    const OUT = 100;
    const IN = -100;

    it("makes a notch the same tenth of the view at any scale", () => {
        expect(wheelTargetScale(0.5, IN)).toBeCloseTo(0.55);
        expect(wheelTargetScale(8, IN)).toBeCloseTo(8.8);

        // The library's own arithmetic would have put that first notch on 2.0 — a diagram fitted at
        // 50% jumping past 200% on one scroll.
        expect(0.5 + 0.015 * 100).toBe(2);
    });

    it("returns to where it started when a notch is taken back", () => {
        // The library cannot do this: it adds or subtracts one step, so a notch each way leaves the
        // content at 1 - k² of where it was and scrubbing walks the view steadily smaller.
        expect(wheelTargetScale(wheelTargetScale(1, IN), OUT)).toBeCloseTo(1);

        let scale = 1;
        for (let i = 0; i < 20; i++) scale = wheelTargetScale(wheelTargetScale(scale, IN), OUT);
        expect(scale).toBeCloseTo(1);
    });

    it("moves the scale by the fraction of a notch a trackpad reports", () => {
        expect(wheelTargetScale(1, IN / 10)).toBeCloseTo(1.1 ** 0.1);
        // Ten of those fractions make exactly the one notch they are a tenth of.
        let scale = 1;
        for (let i = 0; i < 10; i++) scale = wheelTargetScale(scale, IN / 10);
        expect(scale).toBeCloseTo(1.1);
    });

    it("lands on the fitted view rather than stepping over it", () => {
        // Scrolling in fast and out slowly sends different totals — Firefox accelerates a fast wheel
        // — which leaves the ladder off the fitted view, and the factor then keeps it there.
        expect(wheelTargetScale(1.09, OUT)).toBe(1);
        expect(wheelTargetScale(0.99, IN)).toBe(1);
        // From there the ladder is the usual one again.
        expect(wheelTargetScale(1, IN)).toBeCloseTo(1.1);
        expect(wheelTargetScale(1, OUT)).toBeCloseTo(1 / 1.1);

        // A notch that stays on one side of the fitted view is left alone, in either direction.
        expect(wheelTargetScale(1.21, OUT)).toBeCloseTo(1.1);
        expect(wheelTargetScale(0.826, IN)).toBeCloseTo(0.9086);
    });

    it("reads deltaY in the unit deltaMode names, so a notch is a notch in Firefox too", () => {
        // Firefox reports lines on Windows and Linux, three to a notch; Chromium reports pixels.
        expect(wheelTargetScale(1, -3, WheelEvent.DOM_DELTA_LINE)).toBeCloseTo(wheelTargetScale(1, IN));
        expect(wheelTargetScale(1, 3, WheelEvent.DOM_DELTA_LINE)).toBeCloseTo(wheelTargetScale(1, OUT));
        // Taken as pixels, three units would have been a thirtieth of a notch.
        expect(wheelTargetScale(1, -3)).toBeCloseTo(1.1 ** 0.03);

        // A page is a coarser jump than a notch, and an unknown mode falls back to pixels.
        expect(wheelTargetScale(1, -1, WheelEvent.DOM_DELTA_PAGE)).toBeCloseTo(1.1 ** 3);
        expect(wheelTargetScale(1, IN, 99)).toBeCloseTo(1.1);
    });
});

describe("clampPan", () => {
    const bounds = { minPositionX: -100, maxPositionX: 0, minPositionY: -50, maxPositionY: 0 };

    it("leaves an in-bounds position unchanged", () => {
        expect(clampPan(-40, -20, bounds)).toEqual({ x: -40, y: -20 });
    });

    it("clamps a position past either edge", () => {
        expect(clampPan(20, 20, bounds)).toEqual({ x: 0, y: 0 });
        expect(clampPan(-200, -200, bounds)).toEqual({ x: -100, y: -50 });
    });
});

describe("zoomToPointPosition", () => {
    it("leaves the position unchanged when the cursor sits on the content origin", () => {
        // Cursor at (posX0, posY0) → content point 0, so scaling moves nothing.
        expect(zoomToPointPosition(1, 50, 50, 3, 50, 50)).toEqual({ x: 50, y: 50 });
    });

    it("shifts the position so the cursor's content point stays under the cursor when zooming in", () => {
        // scale 1→2 at cursor (100,100) over origin: content point 100 must stay put → pos = 100 - 100*2.
        expect(zoomToPointPosition(1, 0, 0, 2, 100, 100)).toEqual({ x: -100, y: -100 });
    });

    it("shifts the other way when zooming out, from a non-zero starting transform", () => {
        // content point = (120-20)/2 = 50; new pos = 120 - 50*1 = 70 (x), (90-(-10))/2=50 → 90-50=40 (y).
        expect(zoomToPointPosition(2, 20, -10, 1, 120, 90)).toEqual({ x: 70, y: 40 });
    });

    it("keeps the cursor's content point invariant across the scale change", () => {
        const [ scale0, posX0, posY0, scale1, cursorX, cursorY ] = [ 1.5, 12, -8, 4.2, 230, 70 ];
        const { x, y } = zoomToPointPosition(scale0, posX0, posY0, scale1, cursorX, cursorY);
        expect((cursorX - x) / scale1).toBeCloseTo((cursorX - posX0) / scale0);
        expect((cursorY - y) / scale1).toBeCloseTo((cursorY - posY0) / scale0);
    });
});
