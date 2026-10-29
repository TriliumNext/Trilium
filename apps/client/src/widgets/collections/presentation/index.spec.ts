import { describe, expect, it } from "vitest";

import { fitSlideContent } from "./index";

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
    return content;
}
