import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import { trackPointer } from "./pointer_tracking.js";

describe("trackPointer", () => {
    let element: HTMLElement;
    let options: Record<"onMove" | "onEnd" | "onCancel", Mock>;

    beforeEach(() => {
        element = document.createElement("div");
        document.body.append(element);
        vi.spyOn(element, "setPointerCapture").mockImplementation(() => {});
        options = { onMove: vi.fn(), onEnd: vi.fn(), onCancel: vi.fn() };
    });

    afterEach(() => {
        element.remove();
    });

    function start() {
        const event = new PointerEvent("pointerdown", { pointerId: 1, clientX: 100, clientY: 50 });
        return trackPointer(event, element, options);
    }

    function dispatch(type: string, init: PointerEventInit = {}) {
        window.dispatchEvent(new PointerEvent(type, { pointerId: 1, ...init }));
    }

    it("reports moves past the threshold and the release", () => {
        start();
        expect(element.setPointerCapture).toHaveBeenCalledWith(1);

        dispatch("pointermove", { clientX: 101, clientY: 51 });
        expect(options.onMove).not.toHaveBeenCalled();
        dispatch("pointermove", { pointerId: 2, clientX: 200, clientY: 50 });
        expect(options.onMove).not.toHaveBeenCalled();

        dispatch("pointermove", { clientX: 104, clientY: 50 });
        dispatch("pointermove", { clientX: 101, clientY: 50 });
        expect(options.onMove.mock.calls).toEqual([[104], [101]]);

        dispatch("pointerup", { pointerId: 2 });
        expect(options.onEnd).not.toHaveBeenCalled();
        dispatch("pointerup");
        expect(options.onEnd).toHaveBeenCalledWith(true);

        dispatch("pointermove", { clientX: 150, clientY: 50 });
        expect(options.onMove).toHaveBeenCalledTimes(2);
    });

    it("reports a release without a move", () => {
        start();
        dispatch("pointerup");
        expect(options.onEnd).toHaveBeenCalledWith(false);
    });

    it("cancels on Escape, a pointercancel, a lost capture and another pointer's press", () => {
        const cancellations = [
            () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
            () => dispatch("pointercancel"),
            () => dispatch("lostpointercapture"),
            () => dispatch("pointerdown", { pointerId: 2 })
        ];

        for (const cancel of cancellations) {
            options.onCancel.mockClear();
            start();
            window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
            dispatch("pointercancel", { pointerId: 2 });
            dispatch("pointerdown");
            expect(options.onCancel).not.toHaveBeenCalled();

            cancel();
            expect(options.onCancel).toHaveBeenCalledTimes(1);
            dispatch("pointerup");
            expect(options.onEnd).not.toHaveBeenCalled();
        }
    });

    it("cancels through the returned function once, and not after the release", () => {
        const cancel = start();
        cancel();
        cancel();
        expect(options.onCancel).toHaveBeenCalledTimes(1);

        const cancelLater = start();
        dispatch("pointerup");
        cancelLater();
        expect(options.onCancel).toHaveBeenCalledTimes(1);
    });
});
