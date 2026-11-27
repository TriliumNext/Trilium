import type { WebContents } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";

import { armFirstPaintGate, holdFirstPaint, isFirstPaintGateUrl, releaseFirstPaint } from "./first_paint_gate.js";

/** A `WebContents` with an id and a `destroyed` event that the test fires. */
function fakeWebContents(id: number) {
    let destroy = () => {};
    const webContents = {
        id,
        once: vi.fn((event: string, listener: () => void) => {
            if (event === "destroyed") destroy = listener;
        })
    };
    return { webContents: webContents as unknown as WebContents, destroy: () => destroy() };
}

describe("first paint gate", () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it("holds an armed window's request until its renderer releases it, once", () => {
        const { webContents } = fakeWebContents(1);
        armFirstPaintGate(webContents);
        const proceed = vi.fn();

        holdFirstPaint(1, proceed);
        expect(proceed).not.toHaveBeenCalled();
        // Another window's release leaves it held.
        releaseFirstPaint(2);
        expect(proceed).not.toHaveBeenCalled();
        releaseFirstPaint(1);
        expect(proceed).toHaveBeenCalledTimes(1);

        // A reload of the same window paints at once, and a late release does nothing.
        const reload = vi.fn();
        holdFirstPaint(1, reload);
        expect(reload).toHaveBeenCalledTimes(1);
        releaseFirstPaint(1);
        expect(proceed).toHaveBeenCalledTimes(1);
    });

    it("lets through at once a window that is not armed, or whose renderer released it first", () => {
        const unarmed = vi.fn();
        holdFirstPaint(3, unarmed);
        holdFirstPaint(undefined, unarmed);
        expect(unarmed).toHaveBeenCalledTimes(2);

        armFirstPaintGate(fakeWebContents(4).webContents);
        releaseFirstPaint(4);
        const proceed = vi.fn();
        holdFirstPaint(4, proceed);
        expect(proceed).toHaveBeenCalledTimes(1);
    });

    it("gives up on a renderer that never releases it, or that goes away", () => {
        vi.useFakeTimers();
        armFirstPaintGate(fakeWebContents(5).webContents);
        const stalled = vi.fn();
        holdFirstPaint(5, stalled);
        vi.advanceTimersByTime(1999);
        expect(stalled).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(stalled).toHaveBeenCalledTimes(1);

        const { webContents, destroy } = fakeWebContents(6);
        armFirstPaintGate(webContents);
        const destroyed = vi.fn();
        holdFirstPaint(6, destroyed);
        destroy();
        expect(destroyed).toHaveBeenCalledTimes(1);
        // The timeout of a released gate is cleared.
        vi.advanceTimersByTime(2000);
        expect(destroyed).toHaveBeenCalledTimes(1);
    });

    it("recognizes the gate script by its path only", () => {
        expect(isFirstPaintGateUrl("trilium-app://app/startup-gate.js")).toBe(true);
        expect(isFirstPaintGateUrl("trilium-app://app/startup-gate.js?v=1")).toBe(true);
        expect(isFirstPaintGateUrl("trilium-app://app/assets/startup-gate.js")).toBe(false);
        expect(isFirstPaintGateUrl("trilium-app://app/")).toBe(false);
        expect(isFirstPaintGateUrl("not a url")).toBe(false);
    });
});
