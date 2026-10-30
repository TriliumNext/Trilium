import { describe, expect, it, vi } from "vitest";

import { createFitObserver, fitSlideContent } from "./fit";

describe("fitSlideContent", () => {
    it("zooms out only the content that is larger than the slide", () => {
        const tall = buildContent({ height: zoom => 2 * zoom });
        fitSlideContent(tall);
        expect(Number(tall.style.zoom)).toBeCloseTo(0.5);

        // A second fit measures the content without the zoom it already has.
        fitSlideContent(tall);
        expect(Number(tall.style.zoom)).toBeCloseTo(0.5);

        const wide = buildContent({ width: zoom => 2 * zoom });
        fitSlideContent(wide);
        expect(Number(wide.style.zoom)).toBeCloseTo(0.5);

        const fitting = buildContent({ height: () => 1 });
        fitting.style.zoom = "0.5";
        fitSlideContent(fitting);
        expect(fitting.style.zoom).toBe("");

        const hidden = buildContent({ height: () => 0, hidden: true });
        fitSlideContent(hidden);
        expect(hidden.style.zoom).toBe("");
    });

    it("fits content with parts that do not scale with the zoom", () => {
        // Text as tall as the slide plus an image half as tall, which keeps its height.
        const content = buildContent({ height: zoom => zoom + 0.5 });
        fitSlideContent(content);
        expect(Number(content.style.zoom)).toBeCloseTo(0.5);
        expect(Number(content.style.zoom) + 0.5).toBeLessThanOrEqual(1);
    });

    it("stops zooming out when the zoom barely shrinks the overflow", () => {
        // A table editor's column resizer, 3px past a full-width table, overflows by the same share at
        // any zoom; the secant step would place the fit at a zoom of almost nothing.
        const content = buildContent({ width: zoom => 1 + 0.00234 * zoom });
        fitSlideContent(content);
        expect(Number(content.style.zoom)).toBeGreaterThan(0.99);
    });
});

describe("createFitObserver", () => {
    it("fits again when the size changes, but not for the size its own fit leaves", () => {
        let notify: ResizeObserverCallback = () => {};
        vi.stubGlobal("ResizeObserver", class {
            constructor(callback: ResizeObserverCallback) { notify = callback; }
            disconnect() {}
        });

        let naturalHeight = 2;
        const content = buildContent({ height: zoom => naturalHeight * zoom });
        const onFitted = vi.fn();
        const observer = createFitObserver(onFitted);
        const resize = () => notify([ { target: content } as unknown as ResizeObserverEntry ], observer);

        resize();
        expect(Number(content.style.zoom)).toBeCloseTo(0.5);
        expect(onFitted).toHaveBeenCalledTimes(1);

        // The notification for the zoom the fit applied.
        resize();
        expect(onFitted).toHaveBeenCalledTimes(1);

        // A stylesheet makes the content taller.
        naturalHeight = 4;
        resize();
        expect(Number(content.style.zoom)).toBeCloseTo(0.25);
        expect(onFitted).toHaveBeenCalledTimes(2);

        vi.unstubAllGlobals();
    });
});

interface ContentSize {
    /** The height relative to the slide's, for a given zoom. */
    height?: (zoom: number) => number;
    /** The scrolled width relative to the slide's, for a given zoom. */
    width?: (zoom: number) => number;
    hidden?: boolean;
}

/** Builds slide content whose measured size follows its zoom, as it does in a browser. */
function buildContent({ height = () => 1, width = () => 1, hidden }: ContentSize) {
    const slides = document.createElement("div");
    slides.className = "slides";
    const content = document.createElement("div");
    slides.appendChild(content);

    const zoom = () => Number(content.style.zoom || 1);
    const clientWidth = hidden ? 0 : 1280;
    slides.getBoundingClientRect = () => DOMRect.fromRect({ width: 640, height: 360 });
    content.getBoundingClientRect = () => DOMRect.fromRect({ width: 640, height: 360 * height(zoom()) });
    Object.defineProperty(content, "clientWidth", { get: () => clientWidth });
    Object.defineProperty(content, "scrollWidth", { get: () => clientWidth * width(zoom()) });
    Object.defineProperty(content, "offsetWidth", { get: () => clientWidth });
    Object.defineProperty(content, "offsetHeight", { get: () => 720 * height(zoom()) });
    return content;
}
