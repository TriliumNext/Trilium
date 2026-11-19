import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { trackVirtualKeyboard } from "./virtual_keyboard";

/**
 * Stands in for `window.visualViewport`, which happy-dom does not implement. Only the parts the
 * tracking reads (`height`) and listens on (`resize`) are modelled.
 */
class FakeVisualViewport extends EventTarget {
    height = 0;
    width = 0;
}

describe("trackVirtualKeyboard", () => {
    let visualViewport: FakeVisualViewport;
    let root: HTMLElement;
    let stopTracking: (() => void) | undefined;

    beforeEach(() => {
        visualViewport = new FakeVisualViewport();
        Object.defineProperty(window, "visualViewport", { value: visualViewport, configurable: true });
        root = document.body.appendChild(document.createElement("div"));
    });

    afterEach(() => {
        stopTracking?.();
        root.remove();
        Object.defineProperty(window, "visualViewport", { value: undefined, configurable: true });
        for (const name of [ "--tn-keyboard-height", "--tn-layout-shrink", "--tn-layout-overhang" ]) {
            document.body.style.removeProperty(name);
        }
        vi.restoreAllMocks();
    });

    /** Applies a new window/viewport geometry and lets the tracking react to it. */
    function resizeTo({ width, height, viewportHeight }: { width: number; height: number; viewportHeight?: number }) {
        Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
        Object.defineProperty(window, "innerHeight", { value: height, configurable: true });
        visualViewport.width = width;
        visualViewport.height = viewportHeight ?? height;
        visualViewport.dispatchEvent(new Event("resize"));
    }

    function trackInPortrait() {
        resizeTo({ width: 400, height: 800 });
        stopTracking = trackVirtualKeyboard(root);
        resizeTo({ width: 400, height: 800 });
    }

    const isKeyboardOpened = () => root.classList.contains("virtual-keyboard-opened");

    it("does not report the virtual keyboard as opened after a portrait → landscape rotation", () => {
        trackInPortrait();
        expect(isKeyboardOpened()).toBe(false);

        // Rotating shrinks the window itself; the viewport still fills it, so no keyboard is up.
        resizeTo({ width: 800, height: 400 });
        expect(isKeyboardOpened()).toBe(false);
    });

    it("reports the virtual keyboard as opened while it covers part of the viewport", () => {
        trackInPortrait();

        // Keyboard in portrait: the window keeps its height, the visual viewport shrinks.
        resizeTo({ width: 400, height: 800, viewportHeight: 450 });
        expect(isKeyboardOpened()).toBe(true);

        resizeTo({ width: 400, height: 800 });
        expect(isKeyboardOpened()).toBe(false);

        // ... and the same once rotated to landscape.
        resizeTo({ width: 800, height: 400 });
        resizeTo({ width: 800, height: 400, viewportHeight: 200 });
        expect(isKeyboardOpened()).toBe(true);
    });

    it("keeps the height of the last keyboard for a menu to take its place", () => {
        trackInPortrait();
        const keyboardHeight = () => document.body.style.getPropertyValue("--tn-keyboard-height");

        resizeTo({ width: 400, height: 800, viewportHeight: 450 });
        expect(keyboardHeight()).toBe("350px");

        // Closing the keyboard leaves the height for a menu that replaces it as it closes.
        resizeTo({ width: 400, height: 800 });
        expect(keyboardHeight()).toBe("350px");
    });

    it("measures how far the layout shrinks for the keyboard on Android", () => {
        const layoutHeight = { value: 800 };
        vi.spyOn(root, "getBoundingClientRect").mockImplementation(() => ({ height: layoutHeight.value }) as DOMRect);
        trackInPortrait();
        const shrink = () => document.body.style.getPropertyValue("--tn-layout-shrink");

        // `interactive-widget=resizes-content` shrinks the window and the layout with the keyboard.
        layoutHeight.value = 450;
        resizeTo({ width: 400, height: 450 });
        expect(shrink()).toBe("350px");

        layoutHeight.value = 800;
        resizeTo({ width: 400, height: 800 });
        expect(shrink()).toBe("0px");
    });

    it("stops following the keyboard once stopped", () => {
        trackInPortrait();
        stopTracking?.();
        stopTracking = undefined;

        resizeTo({ width: 400, height: 800, viewportHeight: 450 });
        expect(isKeyboardOpened()).toBe(false);
    });
});
