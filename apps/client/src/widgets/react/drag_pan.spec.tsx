import { render } from "preact";
import { useRef, useState } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DragPanOptions, useDragPan } from "./drag_pan";

// Spread rather than replaced: the hook reaches the shared hooks module, which reads far more of
// this than the one export under test.
vi.mock("../../services/utils", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../services/utils")>()),
    isMobile: () => false
}));

describe("useDragPan", () => {
    let container: HTMLElement | undefined;

    // happy-dom lays nothing out, so every element reports what the test declares. Declared on the
    // prototype rather than on one element, since the hook measures as soon as its container is
    // drawn, which is before a test can reach it.
    let scrollWidth = 2000;
    const originals = new Map<string, PropertyDescriptor | undefined>();

    beforeEach(() => {
        vi.useFakeTimers();
        scrollWidth = 2000;
        for (const [ name, get ] of [
            [ "scrollWidth", () => scrollWidth ], [ "clientWidth", () => 500 ]
        ] as const) {
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

    it("pans the container by the distance the pointer moved", () => {
        const scroller = setup();

        press(scroller, 100);
        move(scroller, 60);

        expect(scroller.scrollLeft).toBe(40);
        expect(scroller.className).toContain("panning");

        release(scroller, 60);
        expect(scroller.className).not.toContain("panning");
    });

    /**
     * Boards draw their scroller only once the notes have loaded, so the element the hook is given
     * is not there on the first render. A ref triggers no render of its own when it is filled in.
     */
    it("picks up a container that is drawn after the first render", () => {
        const mountPoint = document.createElement("div");
        container = mountPoint;
        document.body.appendChild(mountPoint);

        let show: (ready: boolean) => void = () => {};

        function Harness() {
            const [ ready, setReady ] = useState(false);
            const ref = useRef<HTMLDivElement>(null);
            const { isPannable } = useDragPan(ref);
            show = setReady;

            return ready
                ? <div ref={ref} className={isPannable ? "pannable" : ""} />
                : <span />;
        }

        act(() => { render(<Harness />, mountPoint); });
        act(() => { show(true); });

        const scroller = mountPoint.firstElementChild as HTMLElement;
        expect(scroller.className).toContain("pannable");

        press(scroller, 100);
        move(scroller, 60);
        expect(scroller.scrollLeft).toBe(40);
    });

    it("offers no pan while the content fits", () => {
        const scroller = setup({ width: 300 });

        expect(scroller.className).not.toContain("pannable");

        press(scroller, 100);
        move(scroller, 60);

        expect(scroller.scrollLeft).toBe(0);
    });

    /** The background is the board's own; a press on anything standing on it belongs to that. */
    it("starts from the container's background and nothing else", () => {
        const scroller = setup();
        const child = document.createElement("div");
        scroller.appendChild(child);

        press(scroller, 100, { target: child });
        move(scroller, 60);

        expect(scroller.scrollLeft).toBe(0);
    });

    it("takes the predicate it is given over the background rule", () => {
        const scroller = setup({ options: { canStart: () => true } });
        const child = document.createElement("div");
        scroller.appendChild(child);

        press(scroller, 100, { target: child });
        move(scroller, 60);

        expect(scroller.scrollLeft).toBe(40);
    });

    it("ignores a press of any button but the first", () => {
        const scroller = setup();

        press(scroller, 100, { button: 2 });
        move(scroller, 60);

        expect(scroller.scrollLeft).toBe(0);
    });

    it("glides on after the pointer is up, and settles", () => {
        const scroller = setup();

        press(scroller, 400);
        move(scroller, 300, 16);
        release(scroller, 300);

        const released = scroller.scrollLeft;
        act(() => { vi.advanceTimersByTime(50); });
        const glided = scroller.scrollLeft;
        expect(glided).toBeGreaterThan(released);

        act(() => { vi.advanceTimersByTime(2000); });
        const settled = scroller.scrollLeft;
        act(() => { vi.advanceTimersByTime(2000); });
        expect(scroller.scrollLeft).toBe(settled);
    });

    it("does not glide when the pointer was still before it was let go", () => {
        const scroller = setup();

        press(scroller, 400);
        move(scroller, 300, 16);
        // Long enough that the last stretch carries no speed at all.
        move(scroller, 299, 400);
        release(scroller, 299);

        const released = scroller.scrollLeft;
        act(() => { vi.advanceTimersByTime(500); });
        expect(scroller.scrollLeft).toBe(released);
    });

    /** The pointer was taken away rather than let go, so the movement was never finished. */
    it("does not glide when the gesture is cancelled", () => {
        const scroller = setup();

        press(scroller, 400);
        move(scroller, 300, 16);
        act(() => { scroller.dispatchEvent(pointer("pointercancel", 300, 0, {})); });

        const cancelled = scroller.scrollLeft;
        act(() => { vi.advanceTimersByTime(500); });

        expect(scroller.scrollLeft).toBe(cancelled);
        expect(scroller.className).not.toContain("panning");
    });

    it("stops a glide when the next pan starts", () => {
        const scroller = setup();

        press(scroller, 400);
        move(scroller, 300, 16);
        release(scroller, 300);
        act(() => { vi.advanceTimersByTime(20); });

        press(scroller, 200);
        const held = scroller.scrollLeft;
        act(() => { vi.advanceTimersByTime(500); });

        expect(scroller.scrollLeft).toBe(held);
    });

    let clock = 0;

    function setup({ width = 2000, options }: {
        width?: number,
        options?: DragPanOptions
    } = {}) {
        clock = 0;
        scrollWidth = width;
        const mountPoint = document.createElement("div");
        container = mountPoint;
        document.body.appendChild(mountPoint);

        function Harness() {
            const ref = useRef<HTMLDivElement>(null);
            const { isPannable, isPanning } = useDragPan(ref, options);
            return (
                <div
                    ref={ref}
                    className={`${isPannable ? "pannable" : ""} ${isPanning ? "panning" : ""}`}
                />
            );
        }

        act(() => { render(<Harness />, mountPoint); });

        const scroller = mountPoint.firstElementChild as HTMLElement;
        scroller.scrollLeft = 0;
        return scroller;
    }

    function pointer(type: string, clientX: number, elapsed: number, extra: Record<string, unknown>) {
        clock += elapsed;
        const event = new Event(type, { bubbles: true, cancelable: true });
        for (const [ name, value ] of Object.entries({
            clientX, pointerId: 1, button: 0, timeStamp: clock, ...extra
        })) {
            Object.defineProperty(event, name, { value, configurable: true });
        }
        return event;
    }

    function press(scroller: HTMLElement, clientX: number, extra: Record<string, unknown> = {}) {
        const { target, ...rest } = extra as { target?: HTMLElement };
        const event = pointer("pointerdown", clientX, 0, rest);
        act(() => { (target ?? scroller).dispatchEvent(event); });
    }

    function move(scroller: HTMLElement, clientX: number, elapsed = 16) {
        act(() => { scroller.dispatchEvent(pointer("pointermove", clientX, elapsed, {})); });
    }

    function release(scroller: HTMLElement, clientX: number) {
        act(() => { scroller.dispatchEvent(pointer("pointerup", clientX, 0, {})); });
    }
});
