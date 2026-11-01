import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type NoteContext from "../../components/note_context";
import ScrollingContainer from "./scrolling_container";

describe("ScrollingContainer", () => {
    let paragraphTop: number;
    let isDisplayed: boolean;

    beforeEach(() => {
        FakeResizeObserver.instances = [];
        vi.stubGlobal("ResizeObserver", FakeResizeObserver);
        vi.useFakeTimers();
        paragraphTop = 0;
        isDisplayed = true;
    });

    afterEach(() => {
        vi.useRealTimers();
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
        scrollAndStop(container, 0);
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

        scrollAndStop(container, 0);
        observer.resize(0, 0);
        observer.resize(500, 400);

        expect(scrollTo).not.toHaveBeenCalled();
    });

    it("records the top block once the scroll stops, and not while it moves", () => {
        const endScroll = (container: HTMLElement) => {
            container.dispatchEvent(new Event("scrollend"));
        };
        const wait = (ms: number) => () => vi.advanceTimersByTime(ms);
        // While the scroll still moves, the anchor stays the one from where it stopped before.
        // Without `scrollend`, a pause in the scroll events stands for it.
        const stops = [
            { hasScrollEnd: true, stop: wait(1000), restoredTop: 880 },
            { hasScrollEnd: true, stop: endScroll, restoredTop: 910 },
            { hasScrollEnd: false, stop: wait(100), restoredTop: 880 },
            { hasScrollEnd: false, stop: wait(150), restoredTop: 910 }
        ];
        for (const { hasScrollEnd, stop, restoredTop } of stops) {
            if (hasScrollEnd) {
                Object.defineProperty(HTMLElement.prototype, "onscrollend", {
                    configurable: true, writable: true, value: null
                });
            }
            paragraphTop = 0;
            const { container, scrollTo, observer } = render();
            Reflect.deleteProperty(HTMLElement.prototype, "onscrollend");

            paragraphTop = -30;
            container.dispatchEvent(new Event("scroll"));
            expect(vi.getTimerCount()).toBe(hasScrollEnd ? 0 : 1);
            stop(container);
            isDisplayed = false;
            observer.resize(0, 0);
            isDisplayed = true;
            paragraphTop = -120;
            observer.resize(300, 400);

            expect(scrollTo).toHaveBeenCalledExactlyOnceWith({
                top: restoredTop,
                behavior: "instant"
            });
        }
    });

    it("stops observing and listening to scrolls on cleanup", () => {
        const { scrollingContainer, container, observer, paragraphRect } = render();

        container.dispatchEvent(new Event("scroll"));
        scrollingContainer.cleanup();
        const reads = paragraphRect.mock.calls.length;
        container.dispatchEvent(new Event("scroll"));
        container.dispatchEvent(new Event("scrollend"));
        vi.runAllTimers();

        expect(paragraphRect).toHaveBeenCalledTimes(reads);
        expect(observer.disconnected).toBe(true);
    });

    it("keeps the position while switching to editing, until the user scrolls", async () => {
        const { scrollingContainer, container, scrollTo } = render();
        const noteContext = { ntxId: "ntx" } as NoteContext;
        scrollingContainer.setNoteContextEvent({ noteContext });

        await scrollingContainer.handleEventInChildren("readOnlyTemporarilyDisabled", { noteContext });
        const hold = FakeResizeObserver.instances[1];
        expect(hold).toBeDefined();

        container.scrollTop = 0;
        hold.resize(500, 2000);
        expect(scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 1000, behavior: "instant" });

        container.dispatchEvent(new Event("wheel"));
        hold.resize(500, 3000);
        expect(scrollTo).toHaveBeenCalledOnce();
        expect(hold.disconnected).toBe(true);
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
        const paragraphRect = vi.spyOn(paragraph, "getBoundingClientRect").mockImplementation(
            () => new DOMRect(0, paragraphTop, 500, 50));
        const scrollTo = vi.fn();
        container.scrollTo = scrollTo;
        scrollAndStop(container, 1000);

        const observer = FakeResizeObserver.instances[FakeResizeObserver.instances.length - 1];
        return { scrollingContainer, container, scrollTo, observer, paragraphRect };
    }

    /** Scrolls `container` to `top` and stops, with or without `scrollend`. */
    function scrollAndStop(container: HTMLElement, top: number) {
        container.scrollTop = top;
        container.dispatchEvent(new Event("scroll"));
        container.dispatchEvent(new Event("scrollend"));
        vi.runOnlyPendingTimers();
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
        if (this.disconnected) return;
        const entry = { contentRect: new DOMRect(0, 0, width, height) } as ResizeObserverEntry;
        this.callback([ entry ], this as unknown as ResizeObserver);
    }
}
