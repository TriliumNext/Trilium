import { render } from "preact";
import { useRef, useState } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ScrollFade, ScrollFadeOptions, useScrollFade } from "./scroll_fade";

describe("useScrollFade", () => {
    let container: HTMLElement | undefined;

    // happy-dom lays nothing out, so every element reports what the test declares. Declared on the
    // prototype rather than on one element, since the hook measures as soon as its container is
    // drawn, which is before a test can reach it.
    let content = 1000;
    let travelled = 0;
    const originals = new Map<string, PropertyDescriptor | undefined>();

    beforeEach(() => {
        vi.useFakeTimers();
        content = 1000;
        travelled = 0;

        const sizes: Record<string, () => number> = {
            scrollHeight: () => content,
            clientHeight: () => 200,
            scrollWidth: () => content,
            clientWidth: () => 200,
            scrollTop: () => travelled,
            scrollLeft: () => travelled
        };
        for (const [ name, get ] of Object.entries(sizes)) {
            originals.set(name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name));
            Object.defineProperty(HTMLElement.prototype, name, { configurable: true, get });
        }
    });

    afterEach(() => {
        for (const [ name, descriptor ] of originals) {
            if (descriptor) {
                Object.defineProperty(HTMLElement.prototype, name, descriptor);
            } else {
                delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
            }
        }
        originals.clear();
        vi.useRealTimers();

        if (container) {
            render(null, container);
            container.remove();
            container = undefined;
        }
    });

    it("names the faded edges in its classes as the content scrolls", () => {
        const scroller = setup();
        expect(scroller.className).toContain("scroll-fade-end");
        expect(scroller.className).not.toContain("scroll-fade-start");

        scrollTo(scroller, 400);
        expect(scroller.className).toContain("scroll-fade-start");
        expect(scroller.className).toContain("scroll-fade-end");

        scrollTo(scroller, 800);
        expect(scroller.className).toContain("scroll-fade-start");
        expect(scroller.className).not.toContain("scroll-fade-end");
    });

    it("reports the overflow and measures on request", () => {
        let fade: ScrollFade | undefined;
        setup({ onRender: (result) => { fade = result; } });
        expect(fade?.overflow).toBe(800);

        content = 600;
        act(() => { fade?.measure(); });
        expect(fade?.overflow).toBe(400);
    });

    it("fades a smaller overflow for a caller that asks for one", () => {
        const scroller = setup({ contentSize: 205, options: { minOverflow: 1 } });

        expect(scroller.className).toContain("scroll-fade-end");
    });

    /** Cards arrive and leave without the box changing size, which no resize reports. */
    it("measures again when the content changes", async () => {
        const scroller = setup({ contentSize: 150 });
        expect(scroller.className).not.toContain("scroll-fade-end");

        content = 1000;
        await act(async () => {
            scroller.appendChild(document.createElement("div"));
            // The observer delivers on a microtask, and only then is the frame asked for.
            await Promise.resolve();
            vi.advanceTimersByTime(20);
        });

        expect(scroller.className).toContain("scroll-fade-end");
    });

    it("names the axis it was given, and carries the size and duration into CSS", () => {
        const scroller = setup({ options: { direction: "horizontal", size: 32, duration: 120 } });

        expect(scroller.className).toContain("scroll-fade-horizontal");
        expect(scroller.getAttribute("style")).toContain("--scroll-fade-size: 32px");
        expect(scroller.getAttribute("style")).toContain("--scroll-fade-duration: 120ms");
    });

    it("leaves the size and duration to CSS when it is given neither", () => {
        const scroller = setup();

        expect(scroller.getAttribute("style") ?? "").not.toContain("--scroll-fade-size");
        expect(scroller.className).toContain("scroll-fade-vertical");
    });

    /** Columns draw their card area only once open, so the element is not there on the first render. */
    it("picks up a container that is drawn after the first render", () => {
        const mountPoint = document.createElement("div");
        container = mountPoint;
        document.body.appendChild(mountPoint);

        let show: (ready: boolean) => void = () => {};

        function Harness() {
            const [ ready, setReady ] = useState(false);
            const ref = useRef<HTMLDivElement>(null);
            const { className } = useScrollFade(ref);
            show = setReady;

            return ready ? <div ref={ref} className={className} /> : <span />;
        }

        act(() => { render(<Harness />, mountPoint); });
        act(() => { show(true); });

        expect((mountPoint.firstElementChild as HTMLElement).className)
            .toContain("scroll-fade-end");
    });

    function setup({ contentSize, options, onRender }: {
        contentSize?: number,
        options?: ScrollFadeOptions,
        onRender?: (fade: ScrollFade) => void
    } = {}) {
        if (contentSize !== undefined) content = contentSize;

        const mountPoint = document.createElement("div");
        container = mountPoint;
        document.body.appendChild(mountPoint);

        function Harness() {
            const ref = useRef<HTMLDivElement>(null);
            const fade = useScrollFade(ref, options);
            onRender?.(fade);
            return <div ref={ref} className={fade.className} style={fade.style} />;
        }

        act(() => { render(<Harness />, mountPoint); });
        return mountPoint.firstElementChild as HTMLElement;
    }

    function scrollTo(scroller: HTMLElement, offset: number) {
        travelled = offset;
        act(() => {
            scroller.dispatchEvent(new Event("scroll"));
            vi.advanceTimersByTime(20);
        });
    }
});
