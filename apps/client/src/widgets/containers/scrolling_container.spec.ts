import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ScrollingContainer from "./scrolling_container";

describe("ScrollingContainer", () => {
    let paragraphTop: number;
    let isDisplayed: boolean;
    let frames: FrameRequestCallback[];

    beforeEach(() => {
        FakeResizeObserver.instances = [];
        vi.stubGlobal("ResizeObserver", FakeResizeObserver);
        frames = [];
        vi.stubGlobal("requestAnimationFrame",
            (callback: FrameRequestCallback) => frames.push(callback));
        paragraphTop = 0;
        isDisplayed = true;
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        document.body.innerHTML = "";
    });

    it("puts the block at the top back in place once shown again at another width", () => {
        const { scrollTo, observer } = render();

        isDisplayed = false;
        observer.resize(0, 0);
        isDisplayed = true;
        paragraphTop = -120;
        observer.resize(300, 400);

        expect(scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 880, behavior: "instant" });
    });

    it("keeps the anchor through a scroll event that arrives while hidden", () => {
        const { container, scrollTo, observer } = render();

        // A hidden element reads `scrollTop` as 0; the browser restores it once shown.
        isDisplayed = false;
        observer.resize(0, 0);
        scrollAndWaitForFrame(container, 0);
        isDisplayed = true;
        container.scrollTop = 1000;
        paragraphTop = 40;
        observer.resize(300, 400);

        expect(scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 1040, behavior: "instant" });
    });

    it("leaves the position alone on a resize while shown, and when scrolled to the top", () => {
        const { container, scrollTo, observer } = render();

        paragraphTop = -120;
        observer.resize(300, 400);

        scrollAndWaitForFrame(container, 0);
        observer.resize(0, 0);
        observer.resize(500, 400);

        expect(scrollTo).not.toHaveBeenCalled();
    });

    it("stops observing on cleanup", () => {
        const { scrollingContainer, container, observer } = render();
        const cancelAnimationFrame = vi.fn();
        vi.stubGlobal("cancelAnimationFrame", cancelAnimationFrame);

        container.dispatchEvent(new Event("scroll"));
        scrollingContainer.cleanup();

        expect(observer.disconnected).toBe(true);
        expect(cancelAnimationFrame).toHaveBeenCalledWith(frames.length);
    });

    /** Renders a container scrolled so that a paragraph sits right at its top edge. */
    function render() {
        const scrollingContainer = new ScrollingContainer();
        const container = scrollingContainer.render()[0];
        const paragraph = document.createElement("p");
        container.appendChild(paragraph);
        document.body.appendChild(container);

        vi.spyOn(container, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 500, 400));
        vi.spyOn(container, "getClientRects").mockImplementation(
            () => (isDisplayed ? [ new DOMRect() ] : []) as unknown as DOMRectList);
        vi.spyOn(paragraph, "getBoundingClientRect").mockImplementation(
            () => new DOMRect(0, paragraphTop, 500, 50));
        const scrollTo = vi.fn();
        container.scrollTo = scrollTo;
        scrollAndWaitForFrame(container, 1000);

        const observer = FakeResizeObserver.instances[0];
        return { scrollingContainer, container, scrollTo, observer };
    }

    function scrollAndWaitForFrame(container: HTMLElement, top: number) {
        container.scrollTop = top;
        container.dispatchEvent(new Event("scroll"));
        for (const callback of frames.splice(0)) callback(0);
    }
});

/** Reports a size of the observed container on demand, as the browser does after a layout. */
class FakeResizeObserver {
    static instances: FakeResizeObserver[] = [];
    disconnected = false;

    constructor(private callback: ResizeObserverCallback) {
        FakeResizeObserver.instances.push(this);
    }

    observe() {}

    disconnect() {
        this.disconnected = true;
    }

    resize(width: number, height: number) {
        const entry = { contentRect: new DOMRect(0, 0, width, height) } as ResizeObserverEntry;
        this.callback([ entry ], this as unknown as ResizeObserver);
    }
}
