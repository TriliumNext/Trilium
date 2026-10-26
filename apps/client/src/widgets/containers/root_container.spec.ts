import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import LoadResults from "../../services/load_results";
import options from "../../services/options";
import RootContainer from "./root_container";

const { applyThemeFromOptions, hasCustomThemeContentChanged } = vi.hoisted(() => ({
    applyThemeFromOptions: vi.fn(),
    hasCustomThemeContentChanged: vi.fn().mockReturnValue(false)
}));

vi.mock("../../services/theme.js", () => ({
    applyThemeFromOptions,
    hasCustomThemeContentChanged,
    onEffectiveThemeStyleChange: vi.fn().mockReturnValue(vi.fn()),
    updateColorSchemeClasses: vi.fn(),
    updateThemeCapabilities: vi.fn()
}));

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
        document.body.classList.remove("sticky-table-headers-disabled");
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

    it("keeps the height of the last keyboard for a menu to take its place", () => {
        renderInPortrait();
        const keyboardHeight = () => document.body.style.getPropertyValue("--tn-keyboard-height");

        resizeTo({ width: 400, height: 800, viewportHeight: 450 });
        expect(keyboardHeight()).toBe("350px");

        // Closing the keyboard leaves the height for a menu that replaces it as it closes.
        resizeTo({ width: 400, height: 800 });
        expect(keyboardHeight()).toBe("350px");
        document.body.style.removeProperty("--tn-keyboard-height");
    });

    it("measures how far the layout shrinks for the keyboard on Android", () => {
        const $widget = renderInPortrait();
        const layoutHeight = { value: 800 };
        vi.spyOn($widget[0], "getBoundingClientRect").mockImplementation(
            () => ({ height: layoutHeight.value }) as DOMRect);
        const shrink = () => document.body.style.getPropertyValue("--tn-layout-shrink");

        // `interactive-widget=resizes-content` shrinks the window and the layout with the keyboard.
        layoutHeight.value = 450;
        resizeTo({ width: 400, height: 450 });
        expect(shrink()).toBe("350px");

        layoutHeight.value = 800;
        resizeTo({ width: 400, height: 800 });
        expect(shrink()).toBe("0px");
        document.body.style.removeProperty("--tn-layout-shrink");
        document.body.style.removeProperty("--tn-layout-overhang");
    });

    it("marks the body while sticky table headers are off, and follows a change", () => {
        const isMarked = () => document.body.classList.contains("sticky-table-headers-disabled");
        options.set("textNoteStickyTableHeadersEnabled", "true");
        const rootContainer = new RootContainer(false);
        rootContainer.render();
        expect(isMarked()).toBe(false);

        options.set("textNoteStickyTableHeadersEnabled", "false");
        const loadResults = new LoadResults([]);
        loadResults.addOption("textNoteStickyTableHeadersEnabled");
        rootContainer.entitiesReloadedEvent({ loadResults });
        expect(isMarked()).toBe(true);
    });

    it("keeps backdrop effects on a mobile device only on iOS", () => {
        const isDisabled = () => document.body.classList.contains("backdrop-effects-disabled");
        const userAgent = vi.spyOn(navigator, "userAgent", "get");
        options.set("backdropEffectsEnabled", "true");

        userAgent.mockReturnValue("Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) Mobile");
        new RootContainer(false).render();
        expect(isDisabled()).toBe(false);

        userAgent.mockReturnValue("Mozilla/5.0 (Linux; Android 15; Pixel 9) Mobile");
        new RootContainer(false).render();
        expect(isDisabled()).toBe(true);

        userAgent.mockRestore();
        document.body.classList.remove("backdrop-effects-disabled", "ios");
    });
});

describe("entitiesReloadedEvent theme content change", () => {
    afterEach(() => {
        applyThemeFromOptions.mockClear();
        hasCustomThemeContentChanged.mockReturnValue(false);
    });

    it("re-applies the theme when the active custom theme note content is reloaded", () => {
        hasCustomThemeContentChanged.mockReturnValue(true);
        const container = new RootContainer(false);
        const loadResults = new LoadResults([]);
        container.entitiesReloadedEvent({ loadResults });
        expect(applyThemeFromOptions).toHaveBeenCalledOnce();
    });

    it("does not re-apply the theme when neither the theme option nor its content changed", () => {
        const container = new RootContainer(false);
        const loadResults = new LoadResults([]);
        container.entitiesReloadedEvent({ loadResults });
        expect(applyThemeFromOptions).not.toHaveBeenCalled();
    });
});
