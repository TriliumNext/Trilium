import type { RevealApi } from "reveal.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
    createFitObserver, fitSlideContent, followSlideLinks, keepKeyboardInPresentation
} from "./index";

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

describe("keepKeyboardInPresentation", () => {
    afterEach(() => {
        vi.useRealTimers();
        document.body.replaceChildren();
    });

    it("takes focus back from a frame that is clicked, as Chromium and Firefox report it", () => {
        vi.useFakeTimers();
        for (const tag of [ "iframe", "webview" ]) {
            // Chromium: focus entering the frame is a `focusin` on its element.
            const clicked = buildFrame(tag);
            clicked.frame.focus();
            expect(document.activeElement, tag).not.toBe(clicked.frame);

            // Firefox: only the window blurs, and the frame is the active element just after.
            const firefox = buildFrame(tag);
            firefox.container.addEventListener("focusin", stopFocusIn, true);
            firefox.frame.focus();
            expect(document.activeElement, tag).toBe(firefox.frame);
            window.dispatchEvent(new Event("blur"));
            vi.runAllTimers();
            expect(document.activeElement, tag).not.toBe(firefox.frame);
            firefox.container.removeEventListener("focusin", stopFocusIn, true);
        }

        // A frame outside the presentation keeps its focus.
        const outside = document.createElement("iframe");
        document.body.append(outside);
        outside.focus();
        window.dispatchEvent(new Event("blur"));
        vi.runAllTimers();
        expect(document.activeElement).toBe(outside);
    });
});

/** Keeps a `focusin` from reaching the guard, as Firefox does not dispatch one for a click into a frame. */
function stopFocusIn(e: Event) {
    e.stopPropagation();
}

/** Mounts a frame in the light DOM: happy-dom does not match `:focus` inside a shadow root. */
function buildFrame(tag: string) {
    const container = document.createElement("div");
    document.body.append(container);
    keepKeyboardInPresentation(container);
    const frame = document.createElement(tag);
    frame.tabIndex = 0;
    container.append(frame);
    return { container, frame };
}

describe("followSlideLinks", () => {
    it("moves to the slide a link points at, for links added after it starts", () => {
        const container = document.createElement("div");
        const target = document.createElement("section");
        target.id = "slide-target";
        container.append(target);
        const api = {
            getIndices: vi.fn(() => ({ h: 2, v: 1, f: undefined })),
            slide: vi.fn()
        };
        const stop = followSlideLinks(container, api as unknown as RevealApi);

        const link = document.createElement("a");
        link.className = "reference-link";
        link.href = "#/slide-target";
        const label = document.createElement("span");
        link.append(label);
        container.append(link);
        label.click();
        expect(api.getIndices).toHaveBeenCalledWith(target);
        expect(api.slide).toHaveBeenCalledWith(2, 1, undefined);

        // A link to a note that is not a slide, or a link after stopping, does not move.
        api.slide.mockClear();
        link.href = "#/slide-missing";
        link.click();
        link.href = "#/slide-target";
        stop();
        link.click();
        expect(api.slide).not.toHaveBeenCalled();
    });
});
