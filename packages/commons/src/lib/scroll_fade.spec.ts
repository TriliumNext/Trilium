// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    getScrollFadeClasses, type ScrollFadeState, type ScrollFadeWatch, type ScrollFadeWatchOptions,
    watchScrollFade
} from "./scroll_fade.js";

describe("watchScrollFade", () => {
    // happy-dom lays nothing out, so the container reports the sizes that a test sets.
    let content: number;
    let travelled: number;
    let watch: ScrollFadeWatch | undefined;

    beforeEach(() => {
        vi.useFakeTimers();
        content = 1000;
        travelled = 0;
    });

    afterEach(() => {
        watch?.disconnect();
        watch = undefined;
        document.body.replaceChildren();
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it("reports the edges that content lies past as the container scrolls", () => {
        const { element, onChange } = setup();
        expect(onChange).toHaveBeenLastCalledWith({
            isStartFaded: false, isEndFaded: true, overflow: 800, clientSize: 200, isRtl: false
        });

        scrollTo(element, 400);
        expect(onChange).toHaveBeenLastCalledWith(
            expect.objectContaining({ isStartFaded: true, isEndFaded: true }));

        scrollTo(element, 800);
        expect(onChange).toHaveBeenLastCalledWith(
            expect.objectContaining({ isStartFaded: true, isEndFaded: false }));

        // A scroll that keeps the state reports nothing.
        scrollTo(element, 800);
        expect(onChange).toHaveBeenCalledTimes(3);
    });

    it("fades no edge while the content overflows by no more than the fade reaches", () => {
        content = 150;
        expect(lastState(setup().onChange)).toMatchObject({ isEndFaded: false, overflow: -50 });

        content = 218;
        expect(lastState(setup().onChange)).toMatchObject({ isEndFaded: false, overflow: 18 });
        expect(lastState(setup({ options: { size: 10 } }).onChange).isEndFaded).toBe(true);

        content = 205;
        expect(lastState(setup({ options: { minOverflow: 1 } }).onChange).isEndFaded).toBe(true);
    });

    it("measures horizontally, and reports a right-to-left container", () => {
        const horizontal = { direction: "horizontal" } as const;
        travelled = -400;
        expect(lastState(setup({ options: horizontal, rtl: true }).onChange)).toMatchObject({
            isStartFaded: true, isEndFaded: true, isRtl: true
        });
        expect(lastState(setup({ options: horizontal }).onChange).isRtl).toBe(false);
        expect(lastState(setup({ rtl: true }).onChange).isRtl).toBe(false);
    });

    it("measures once a frame after a resize or a change to the content", async () => {
        const resizeObservers = stubResizeObserver();
        const { element, onChange } = setup({ children: 1 });
        const [ resizeObserver ] = resizeObservers;
        expect(resizeObserver.observed).toEqual([ element, element.firstElementChild ]);
        const requestFrame = vi.spyOn(globalThis, "requestAnimationFrame");

        content = 150;
        resizeObserver.callback();
        resizeObserver.callback();
        expect(requestFrame).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(20);
        expect(lastState(onChange).isEndFaded).toBe(false);

        content = 1000;
        const added = document.createElement("div");
        element.appendChild(added);
        // The mutation observer delivers on a microtask.
        await Promise.resolve();
        expect(resizeObserver.observed).toContain(added);
        vi.advanceTimersByTime(20);
        expect(lastState(onChange).isEndFaded).toBe(true);
    });

    it("measures on request, for a change that nothing reports", () => {
        const { onChange } = setup();
        content = 150;
        watch?.measure();
        expect(lastState(onChange).isEndFaded).toBe(false);
    });

    it("stops watching once disconnected", async () => {
        const resizeObservers = stubResizeObserver();
        const { element, onChange } = setup();
        const [ resizeObserver ] = resizeObservers;
        const cancelFrame = vi.spyOn(globalThis, "cancelAnimationFrame");

        resizeObserver.callback();
        watch?.disconnect();
        expect(cancelFrame).toHaveBeenCalledTimes(1);
        expect(resizeObserver.isDisconnected).toBe(true);

        content = 150;
        vi.advanceTimersByTime(20);
        scrollTo(element, 400);
        element.appendChild(document.createElement("div"));
        await Promise.resolve();
        vi.advanceTimersByTime(20);
        expect(onChange).toHaveBeenCalledTimes(1);
    });

    function setup({ options, rtl = false, children = 0 }: {
        options?: ScrollFadeWatchOptions;
        rtl?: boolean;
        children?: number;
    } = {}) {
        const element = document.createElement("div");
        element.style.direction = rtl ? "rtl" : "ltr";
        for (let index = 0; index < children; index++) {
            element.appendChild(document.createElement("div"));
        }
        const sizes: Record<string, () => number> = {
            scrollHeight: () => content,
            scrollWidth: () => content,
            clientHeight: () => 200,
            clientWidth: () => 200,
            scrollTop: () => travelled,
            scrollLeft: () => travelled
        };
        for (const [ name, get ] of Object.entries(sizes)) {
            Object.defineProperty(element, name, { configurable: true, get });
        }
        document.body.appendChild(element);

        watch?.disconnect();
        const onChange = vi.fn<(state: ScrollFadeState) => void>();
        watch = watchScrollFade(element, onChange, options);
        return { element, onChange };
    }

    function scrollTo(element: HTMLElement, offset: number) {
        travelled = offset;
        element.dispatchEvent(new Event("scroll"));
    }
});

describe("getScrollFadeClasses", () => {
    it("names the axis, each faded edge and a right-to-left container", () => {
        const state: ScrollFadeState = {
            isStartFaded: false, isEndFaded: false, overflow: 0, clientSize: 0, isRtl: false
        };
        expect(getScrollFadeClasses("vertical", state))
            .toEqual([ "scroll-fade", "scroll-fade-vertical" ]);
        expect(getScrollFadeClasses("horizontal", {
            ...state, isStartFaded: true, isEndFaded: true, isRtl: true
        })).toEqual([
            "scroll-fade", "scroll-fade-horizontal", "scroll-fade-start", "scroll-fade-end",
            "scroll-fade-rtl"
        ]);
    });
});

function lastState(onChange: { mock: { lastCall?: [ScrollFadeState] } }) {
    const state = onChange.mock.lastCall?.[0];
    if (!state) {
        throw new Error("No state was reported.");
    }
    return state;
}

interface FakeResizeObserver {
    callback: () => void;
    observed: Element[];
    isDisconnected: boolean;
}

/** Replaces `ResizeObserver`, which happy-dom never calls back, with one a test calls back. */
function stubResizeObserver() {
    const instances: FakeResizeObserver[] = [];
    vi.stubGlobal("ResizeObserver", class implements FakeResizeObserver {

        observed: Element[] = [];
        isDisconnected = false;

        constructor(readonly callback: () => void) {
            instances.push(this);
        }

        observe(element: Element) {
            this.observed.push(element);
        }

        disconnect() {
            this.isDisconnected = true;
        }
    
    });
    return instances;
}
