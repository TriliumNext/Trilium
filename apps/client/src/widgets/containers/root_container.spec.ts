import { afterEach, beforeEach, describe, expect, it } from "vitest";

import RootContainer from "./root_container";

/**
 * Stands in for `window.visualViewport`, which happy-dom does not implement. Only the parts the
 * root container reads (`height`) and listens on (`resize`) are modelled.
 */
class FakeVisualViewport extends EventTarget {
    height = 0;
    width = 0;
}

describe("RootContainer", () => {
    let visualViewport: FakeVisualViewport;

    beforeEach(() => {
        window.glob = { ...window.glob, device: "mobile" };
        visualViewport = new FakeVisualViewport();
        Object.defineProperty(window, "visualViewport", { value: visualViewport, configurable: true });
    });

    afterEach(() => {
        Object.defineProperty(window, "visualViewport", { value: undefined, configurable: true });
        window.glob = { ...window.glob, device: "desktop" };
    });

    /** Applies a new window/viewport geometry and lets the container react to it. */
    function resizeTo({ width, height, viewportHeight }: { width: number; height: number; viewportHeight?: number }) {
        Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
        Object.defineProperty(window, "innerHeight", { value: height, configurable: true });
        visualViewport.width = width;
        visualViewport.height = viewportHeight ?? height;
        visualViewport.dispatchEvent(new Event("resize"));
    }

    function renderInPortrait() {
        resizeTo({ width: 400, height: 800 });
        const rootContainer = new RootContainer(false);
        const $widget = rootContainer.render();
        resizeTo({ width: 400, height: 800 });
        return $widget;
    }

    it("does not report the virtual keyboard as opened after a portrait → landscape rotation", () => {
        const $widget = renderInPortrait();
        expect($widget.hasClass("virtual-keyboard-opened")).toBe(false);

        // Rotating shrinks the window itself; the viewport still fills it, so no keyboard is up.
        resizeTo({ width: 800, height: 400 });

        expect($widget.hasClass("virtual-keyboard-opened")).toBe(false);
    });

    it("reports the virtual keyboard as opened while it covers part of the viewport", () => {
        const $widget = renderInPortrait();

        // Keyboard in portrait: the window keeps its height, the visual viewport shrinks.
        resizeTo({ width: 400, height: 800, viewportHeight: 450 });
        expect($widget.hasClass("virtual-keyboard-opened")).toBe(true);

        resizeTo({ width: 400, height: 800 });
        expect($widget.hasClass("virtual-keyboard-opened")).toBe(false);

        // ... and the same once rotated to landscape.
        resizeTo({ width: 800, height: 400 });
        resizeTo({ width: 800, height: 400, viewportHeight: 200 });
        expect($widget.hasClass("virtual-keyboard-opened")).toBe(true);
    });
});
