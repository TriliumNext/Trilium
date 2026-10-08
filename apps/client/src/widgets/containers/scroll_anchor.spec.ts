import { afterEach, describe, expect, it, vi } from "vitest";

import { findScrollAnchor, restoreScrollAnchor } from "./scroll_anchor";

describe("findScrollAnchor", () => {
    afterEach(() => {
        document.body.innerHTML = "";
        vi.restoreAllMocks();
    });

    it("takes the first block that reaches past the top edge", () => {
        const container = buildContainer(`<p id="a"></p><p id="b"></p><p id="c"></p>`);
        placeAt(byId(container, "a"), 20, 50);
        placeAt(byId(container, "b"), 70, 50);
        placeAt(byId(container, "c"), 120, 50);
        expect(findScrollAnchor(container)).toEqual({ element: byId(container, "b"), offset: -30 });

        expect(findScrollAnchor(buildContainer(""))).toBeNull();
    });

    it("descends into a block that the top edge cuts through", () => {
        const container = buildContainer(
            `<div id="content"><p id="a"></p><figure id="b"></figure></div>`);
        placeAt(byId(container, "content"), -400, 1000);
        placeAt(byId(container, "a"), -400, 50);
        placeAt(byId(container, "b"), 110, 200);

        expect(findScrollAnchor(container)).toEqual({ element: byId(container, "b"), offset: 10 });
    });

    it("skips inline, positioned and hidden boxes", () => {
        const container = buildContainer(`
            <p id="text"><strong id="inline" style="display: inline"></strong></p>
            <div id="sticky" style="position: sticky"></div>
            <div id="hidden"></div>
            <p id="next"></p>`);
        placeAt(byId(container, "text"), 80, 50);
        placeAt(byId(container, "inline"), 110, 20);
        placeAt(byId(container, "sticky"), 100, 40);
        placeAt(byId(container, "hidden"), 0, 0, 0);
        placeAt(byId(container, "next"), 130, 50);

        // The paragraph stays the anchor, since its only child is inline.
        expect(findScrollAnchor(container))
            .toEqual({ element: byId(container, "text"), offset: -20 });

        placeAt(byId(container, "text"), 20, 50);
        expect(findScrollAnchor(container))
            .toEqual({ element: byId(container, "next"), offset: 30 });
    });
});

describe("restoreScrollAnchor", () => {
    afterEach(() => {
        document.body.innerHTML = "";
        vi.restoreAllMocks();
    });

    it("scrolls by the distance the anchor moved, and only when it moved", () => {
        const container = buildContainer(`<p id="a"></p>`);
        const element = byId(container, "a");
        const scrollTo = vi.fn();
        container.scrollTo = scrollTo;
        container.scrollTop = 500;

        placeAt(element, 80.5, 50);
        restoreScrollAnchor(container, { element, offset: -20 });
        expect(scrollTo).not.toHaveBeenCalled();

        placeAt(element, 160, 50);
        restoreScrollAnchor(container, { element, offset: -20 });
        expect(scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 580, behavior: "instant" });
    });

    it("leaves the position alone once the anchor left the container", () => {
        const container = buildContainer(`<p id="a"></p>`);
        const element = byId(container, "a");
        const scrollTo = vi.fn();
        container.scrollTo = scrollTo;
        placeAt(element, 400, 50);
        element.remove();

        restoreScrollAnchor(container, { element, offset: 0 });

        expect(scrollTo).not.toHaveBeenCalled();
    });
});

/** Builds a container whose visible area starts at y=100. */
function buildContainer(html: string) {
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);
    placeAt(container, 100, 400);
    return container;
}

function byId(container: HTMLElement, id: string) {
    const element = container.querySelector(`#${id}`);
    if (!element) {
        throw new Error(`No element with the ID ${id}.`);
    }
    return element;
}

/** Mocks the box of `element`, since happy-dom does no layout. */
function placeAt(element: Element, top: number, height: number, width = 100) {
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue(new DOMRect(0, top, width, height));
}
