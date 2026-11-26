import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import InkSurface from "./ink_surface";

describe("ink surface input", () => {
    let container: HTMLDivElement;
    let surface: InkSurface;
    const onChange = vi.fn();

    beforeEach(() => {
        vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => stubContext());
        vi.stubGlobal("Path2D", class { moveTo() {} quadraticCurveTo() {} closePath() {} });
        vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
        Element.prototype.setPointerCapture ??= () => {};
        container = document.createElement("div");
        document.body.append(container);
        onChange.mockReset();
        surface = new InkSurface(container, { onChange, onGestureStart: () => {}, onStateChange: () => {} });
    });

    afterEach(() => {
        surface.destroy();
        container.remove();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it("pans with a finger unless finger drawing is on", async () => {
        swipe("touch", 1, 100);
        await nextFrame();
        expect(onChange).not.toHaveBeenCalled();
        expect(container.style.getPropertyValue("--ink-y")).toBe("40px");

        surface.fingerDrawing = true;
        swipe("touch", 2, 100);
        expect(onChange).toHaveBeenCalledOnce();
    });

    it("draws with a pen over a resting palm, which stays ignored until lifted", async () => {
        pointer("pointerdown", "touch", 1, 200);
        pointer("pointermove", "touch", 1, 210);
        swipe("pen", 2, 100);
        expect(onChange).toHaveBeenCalledOnce();

        pointer("pointermove", "touch", 1, 260);
        pointer("pointerdown", "touch", 3, 100);
        pointer("pointermove", "touch", 3, 150);
        pointer("pointerup", "touch", 3, 150);
        pointer("pointerup", "touch", 1, 260);
        await nextFrame();
        // 10 px from the palm before the pen landed and 50 px from the new finger, none from the
        // palm's move while it was ignored.
        expect(container.style.getPropertyValue("--ink-y")).toBe("60px");
    });

    it("keeps a pen stroke when fingers touch the screen while it is drawn", () => {
        pointer("pointerdown", "pen", 1, 100);
        pointer("pointermove", "pen", 1, 120);
        pointer("pointerdown", "touch", 2, 300);
        pointer("pointerdown", "touch", 3, 320);
        pointer("pointermove", "pen", 1, 140);
        pointer("pointerup", "pen", 1, 140);
        expect(onChange).toHaveBeenCalledOnce();
    });

    function swipe(type: string, pointerId: number, y: number) {
        pointer("pointerdown", type, pointerId, y);
        pointer("pointermove", type, pointerId, y + 20);
        pointer("pointermove", type, pointerId, y + 40);
        pointer("pointerup", type, pointerId, y + 40);
    }

    function pointer(kind: string, pointerType: string, pointerId: number, y: number) {
        container.dispatchEvent(new PointerEvent(kind, {
            pointerId, pointerType, clientX: 50, clientY: y, button: 0,
            buttons: kind === "pointerup" ? 0 : 1, pressure: 0.5, bubbles: true
        }));
    }
});

/** A 2D context whose every method does nothing, as happy-dom draws no canvas. */
function stubContext() {
    const target: Record<string | symbol, unknown> = {};
    return new Proxy(target, {
        get: (object, key) => (key in object ? object[key] : (object[key] = () => {})),
        set: (object, key, value) => {
            object[key] = value;
            return true;
        }
    }) as unknown as CanvasRenderingContext2D;
}

function nextFrame() {
    return new Promise((resolve) => requestAnimationFrame(resolve));
}
