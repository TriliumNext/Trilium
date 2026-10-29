import { describe, expect, it } from "vitest";

import { fitSlideContent } from "./index";

describe("fitSlideContent", () => {
    it("zooms out only the content that is larger than the slide", () => {
        const content = buildContent(1280, 1440);
        fitSlideContent(content);
        expect(content.style.zoom).toBe("0.5");

        // A second fit measures the content without the zoom it already has.
        fitSlideContent(content);
        expect(content.style.zoom).toBe("0.5");

        const wide = buildContent(2560, 360);
        fitSlideContent(wide);
        expect(wide.style.zoom).toBe("0.5");

        const fitting = buildContent(1280, 720);
        fitting.style.zoom = "0.5";
        fitSlideContent(fitting);
        expect(fitting.style.zoom).toBe("");

        const hidden = buildContent(0, 0);
        fitSlideContent(hidden);
        expect(hidden.style.zoom).toBe("");
    });
});

/** Builds an element whose measured size shrinks with its zoom, as it does in a browser. */
function buildContent(width: number, height: number) {
    const content = document.createElement("div");
    const zoom = () => Number(content.style.zoom || 1);
    Object.defineProperty(content, "scrollWidth", { get: () => width * zoom() });
    Object.defineProperty(content, "scrollHeight", { get: () => height * zoom() });
    return content;
}
