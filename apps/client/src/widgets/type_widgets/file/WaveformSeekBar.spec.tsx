import { RefObject, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WaveformSeekBar } from "./WaveformSeekBar";

/** Canvas width the scrub tests work in: happy-dom lays nothing out, so the box is stated outright. */
const CANVAS_WIDTH = 200;

describe("WaveformSeekBar", () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        act(() => render(null, container));
        container.remove();
    });

    function fakeMedia({ duration = 100, currentTime = 0 } = {}) {
        const media = document.createElement("audio");
        Object.defineProperty(media, "duration", { value: duration, writable: true, configurable: true });
        media.currentTime = currentTime;
        return { current: media } as RefObject<HTMLAudioElement>;
    }

    function renderSeekBar(mediaRef = fakeMedia(), peaks: number[] | null = null) {
        act(() => render(<WaveformSeekBar mediaRef={mediaRef} peaks={peaks} />, container));
        const canvas = container.querySelector("canvas");
        if (!canvas) throw new Error("no canvas rendered");
        // The scrub maths reads the canvas' box, which happy-dom reports as zero-sized.
        canvas.getBoundingClientRect = () => ({ left: 0, width: CANVAS_WIDTH, right: CANVAS_WIDTH, top: 0, bottom: 20, height: 20, x: 0, y: 0, toJSON: () => ({}) });
        canvas.setPointerCapture = vi.fn();
        canvas.releasePointerCapture = vi.fn();
        canvas.hasPointerCapture = vi.fn(() => false);
        return { mediaRef, canvas };
    }

    const times = () => Array.from(container.querySelectorAll(".media-time")).map(el => el.textContent);

    const press = (canvas: HTMLCanvasElement, key: string) =>
        act(() => { canvas.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })); });

    const pointer = (canvas: HTMLCanvasElement, type: "pointerdown" | "pointermove", clientX: number) =>
        act(() => { canvas.dispatchEvent(new PointerEvent(type, { clientX, pointerId: 1, bubbles: true })); });

    it("mirrors the element's clock, seeded from one whose metadata already loaded", () => {
        const mediaRef = fakeMedia({ duration: 200, currentTime: 50 });
        renderSeekBar(mediaRef);

        expect(times()).toEqual([ "0:50", "-2:30" ]);

        const media = mediaRef.current;
        if (!media) throw new Error("no media");
        act(() => {
            media.currentTime = 100;
            media.dispatchEvent(new Event("timeupdate"));
        });
        expect(times()).toEqual([ "1:40", "-1:40" ]);
    });

    it("exposes the position to assistive technology as a slider", () => {
        const { canvas } = renderSeekBar(fakeMedia({ duration: 100, currentTime: 25 }));

        expect(canvas.getAttribute("role")).toBe("slider");
        expect(canvas.getAttribute("aria-valuenow")).toBe("25");
        expect(canvas.getAttribute("aria-valuetext")).toBe("0:25 / 1:40");
    });

    describe("scrubbing with a pointer", () => {
        it("seeks to the pressed position", () => {
            const { mediaRef, canvas } = renderSeekBar(fakeMedia({ duration: 100 }));

            pointer(canvas, "pointerdown", CANVAS_WIDTH * 0.25);

            expect(mediaRef.current?.currentTime).toBe(25);
            // Focus follows the press, since the default focus-on-click was suppressed to start the drag.
            expect(canvas.setPointerCapture).toHaveBeenCalledWith(1);
        });

        it("keeps seeking while dragging, and ignores movement that isn't a drag", () => {
            const { mediaRef, canvas } = renderSeekBar(fakeMedia({ duration: 100 }));

            // A hover with no button held must not scrub.
            pointer(canvas, "pointermove", CANVAS_WIDTH * 0.9);
            expect(mediaRef.current?.currentTime).toBe(0);

            canvas.hasPointerCapture = vi.fn(() => true);
            pointer(canvas, "pointermove", CANVAS_WIDTH * 0.5);
            expect(mediaRef.current?.currentTime).toBe(50);
        });

        it("clamps a drag that strays outside the bar", () => {
            const { mediaRef, canvas } = renderSeekBar(fakeMedia({ duration: 100 }));
            canvas.hasPointerCapture = vi.fn(() => true);

            pointer(canvas, "pointermove", -50);
            expect(mediaRef.current?.currentTime).toBe(0);

            pointer(canvas, "pointermove", CANVAS_WIDTH + 50);
            expect(mediaRef.current?.currentTime).toBe(100);
        });
    });

    describe("scrubbing with the keyboard", () => {
        it("steps by 5% and jumps to either end", () => {
            const mediaRef = fakeMedia({ duration: 100, currentTime: 50 });
            const { canvas } = renderSeekBar(mediaRef);
            const media = mediaRef.current;
            if (!media) throw new Error("no media");
            const seek = (key: string) => {
                press(canvas, key);
                // The bar steps from its rendered position, which follows the element's clock.
                act(() => { media.dispatchEvent(new Event("timeupdate")); });
            };

            seek("ArrowRight");
            expect(media.currentTime).toBeCloseTo(55);
            seek("ArrowLeft");
            expect(media.currentTime).toBeCloseTo(50);

            seek("End");
            expect(media.currentTime).toBe(100);
            // At the end, stepping further is clamped rather than overrunning.
            seek("ArrowRight");
            expect(media.currentTime).toBe(100);

            seek("Home");
            expect(media.currentTime).toBe(0);
            seek("ArrowLeft");
            expect(media.currentTime).toBe(0);
        });

        it("leaves other keys to the player", () => {
            const { mediaRef, canvas } = renderSeekBar(fakeMedia({ duration: 100, currentTime: 30 }));

            press(canvas, " ");
            expect(mediaRef.current?.currentTime).toBe(30);
        });
    });

    it("does nothing until the media has a duration to seek within", () => {
        const { mediaRef, canvas } = renderSeekBar(fakeMedia({ duration: 0 }));

        pointer(canvas, "pointerdown", CANVAS_WIDTH * 0.5);
        press(canvas, "End");

        expect(mediaRef.current?.currentTime).toBe(0);
        expect(times()).toEqual([ "0:00", "-0:00" ]);
    });
});
