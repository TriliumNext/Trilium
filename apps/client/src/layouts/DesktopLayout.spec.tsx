import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildNote } from "../test/easy-froca.js";
import { renderInto } from "../test/render.js";
import DesktopLayout from "./DesktopLayout.js";

describe("DesktopLayout", () => {
    const originalOrientation = window.glob.layoutOrientation;

    beforeEach(() => {
        buildNote({ id: "_lbVisibleLaunchers", title: "Visible Launchers" });
        // The tab bar's history buttons follow these launchers.
        buildNote({ id: "_lbBackInHistory", title: "Back", type: "launcher" });
        buildNote({ id: "_lbForwardInHistory", title: "Forward", type: "launcher" });
    });

    afterEach(() => {
        window.glob.layoutOrientation = originalOrientation;
    });

    it("puts the launch bar beside the main container in the vertical layout", () => {
        window.glob.layoutOrientation = "vertical";
        let container: HTMLElement | undefined;
        // In `act()`, so the tab row widget is attached by its effect.
        act(() => { container = renderInto(<DesktopLayout />); });
        const root = container?.querySelector("#root-widget");

        expect(root?.classList.contains("vertical-layout")).toBe(true);
        const launcherPane = root?.querySelector("#launcher-pane");
        expect(launcherPane?.classList.contains("vertical")).toBe(true);
        expect(launcherPane?.parentElement?.id).toBe("horizontal-main-container");
        expect(launcherPane?.querySelector("#launcher-container")).not.toBeNull();
        // The menu heads the bar.
        expect(launcherPane?.firstElementChild?.classList.contains("global-menu")).toBe(true);
        // Outside the desktop app, the tab bar heads the pane beside the launch bar.
        const tabBar = root?.querySelector(".tab-row-container");
        expect(tabBar?.parentElement?.id).toBe("rest-pane");
        expect(tabBar?.querySelector(".tab-row-widget.full-width")).toBeNull();
        expect(tabBar?.querySelector(".tab-row-widget")).not.toBeNull();
    });

    it("puts the launch bar above the main container in the horizontal layout", () => {
        window.glob.layoutOrientation = "horizontal";
        let container: HTMLElement | undefined;
        // In `act()`, so the tab row widget is attached by its effect.
        act(() => { container = renderInto(<DesktopLayout />); });
        const root = container?.querySelector("#root-widget");

        expect(root?.classList.contains("horizontal-layout")).toBe(true);
        const launcherPane = root?.querySelector("#launcher-pane");
        expect(launcherPane?.classList.contains("horizontal")).toBe(true);
        expect(launcherPane?.parentElement).toBe(root);
        expect(launcherPane?.nextElementSibling?.id).toBe("horizontal-main-container");
        // The menu ends the bar.
        expect(launcherPane?.lastElementChild?.classList.contains("global-menu")).toBe(true);
        // The tab bar spans the window above the launch bar.
        const tabBar = root?.firstElementChild;
        expect(tabBar?.classList.contains("tab-row-container")).toBe(true);
        expect(tabBar?.nextElementSibling).toBe(launcherPane);
        expect(tabBar?.querySelector(".tab-row-widget.full-width")).not.toBeNull();
        expect(root?.querySelector("#rest-pane .tab-row-container")).toBeNull();
    });
});
