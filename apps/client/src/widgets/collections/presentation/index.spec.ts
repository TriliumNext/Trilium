import { describe, expect, it, vi } from "vitest";

import { createFitObserver, fitSlideContent, setViewportSize } from "./index";

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
});

describe("setViewportSize", () => {
    it("sizes the viewport in slide pixels from the scale that Reveal.js applied", () => {
        const container = document.createElement("div");
        // offsetHeight would round this to 619.
        container.getBoundingClientRect = () => ({ width: 1100, height: 618.75 }) as DOMRect;

        // 1100px less the 4% margin gives a scale of 0.825, which Reveal.js rounds to 0.83.
        setViewportSize(container, { getScale: () => 0.83 });
        expect(parseFloat(container.style.getPropertyValue("--viewport-width"))).toBeCloseTo(1100 / 0.83);
        expect(parseFloat(container.style.getPropertyValue("--viewport-height"))).toBeCloseTo(618.75 / 0.83);

        // Before the first layout there is no scale yet, and the CSS fallbacks stay.
        const unscaled = document.createElement("div");
        setViewportSize(unscaled, { getScale: () => 0 });
        expect(unscaled.style.getPropertyValue("--viewport-width")).toBe("");
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
