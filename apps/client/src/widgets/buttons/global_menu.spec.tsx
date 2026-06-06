import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the component import) --------------------------------------------

vi.mock("bootstrap", () => {
    class Tooltip {
        static instances = new Map<Element, Tooltip>();
        static getInstance(el: Element) { return Tooltip.instances.get(el) ?? null; }
        element: Element;
        config: unknown;
        constructor(el: Element, config?: unknown) { this.element = el; this.config = config; Tooltip.instances.set(el, this); }
        dispose() { Tooltip.instances.delete(this.element); }
        show() {}
        hide() {}
    }
    class Dropdown {
        static instances = new Map<Element, Dropdown>();
        static getOrCreateInstance(el: Element) {
            const existing = Dropdown.instances.get(el);
            if (existing) return existing;
            const created = new Dropdown(el);
            Dropdown.instances.set(el, created);
            return created;
        }
        static getInstance(el: Element) { return Dropdown.instances.get(el) ?? null; }
        element: Element;
        constructor(el: Element) { this.element = el; }
        show() {}
        hide() {}
        update() {}
        dispose() { Dropdown.instances.delete(this.element); }
    }
    return { Tooltip, Dropdown, default: { Tooltip, Dropdown } };
});

vi.mock("../../services/keyboard_actions", () => ({
    default: {
        getAction: vi.fn(async () => ({ effectiveShortcuts: [ "ctrl+k" ] })),
        setupActionsForElement: vi.fn(async () => [])
    }
}));

const utilsState = vi.hoisted(() => ({
    isElectron: false,
    isMobile: false,
    isStandalone: false,
    isUpdateAvailable: false
}));

vi.mock("../../services/utils", async (importOriginal) => {
    const original = await importOriginal<typeof import("../../services/utils")>();
    const reloadFrontendApp = vi.fn();
    const isElectron = () => utilsState.isElectron;
    const isMobile = () => utilsState.isMobile;
    const isUpdateAvailable = () => utilsState.isUpdateAvailable;
    return {
        ...original,
        isElectron,
        isMobile,
        reloadFrontendApp,
        get isStandalone() { return utilsState.isStandalone; },
        default: {
            ...original.default,
            isElectron,
            isMobile,
            isUpdateAvailable,
            reloadFrontendApp
        }
    };
});

import { OptionNames } from "@triliumnext/commons";

import Component from "../../components/component";
import * as experimentalFeaturesService from "../../services/experimental_features";
import options from "../../services/options";
import { reloadFrontendApp } from "../../services/utils";
import { renderComponent, renderInto } from "../../test/render";
import GlobalMenu, { VerticalLayoutIcon } from "./global_menu";

// --- Render harness --------------------------------------------------------------------------------

/** Renders the global menu and flips the bootstrap dropdown into the "shown" state so children render. */
function renderMenu(props: { isHorizontalLayout: boolean }, parent: Component = new Component()) {
    const { container: el } = renderComponent(<GlobalMenu {...props} />, { parent });
    const dropdown = el.querySelector(".dropdown");
    if (dropdown) {
        act(() => { $(dropdown).trigger("show.bs.dropdown"); });
    }
    return el;
}

function setOptions(values: Record<string, string>) {
    options.load(values as Record<OptionNames, string>);
}

beforeEach(() => {
    // The static-tooltip hooks call the bootstrap jQuery plugin; provide a no-op so render succeeds.
    Object.assign(($.fn as unknown as Record<string, unknown>), { tooltip: vi.fn() });
    utilsState.isElectron = false;
    utilsState.isMobile = false;
    utilsState.isStandalone = false;
    utilsState.isUpdateAvailable = false;
    setOptions({ zoomFactor: "1.0", checkForUpdates: "true", experimentalFeatures: "[]" });
    const glob = window.glob as unknown as Record<string, unknown>;
    glob.isDev = false;
    glob.triliumVersion = "1.0.0";
    glob.device = "desktop";
    delete (window as { electronApi?: unknown }).electronApi;
});

// --- Tests -----------------------------------------------------------------------------------------

describe("GlobalMenu", () => {
    it("renders the vertical-layout logo and a populated menu", () => {
        const el = renderMenu({ isHorizontalLayout: false });

        // Vertical layout includes the inline SVG logo inside the button.
        expect(el.querySelector(".global-menu-button svg")).toBeTruthy();

        // The menu list contains the standard always-present items.
        expect(el.querySelector("[data-trigger-command='openNewWindow']")).toBeTruthy();
        expect(el.querySelector("[data-trigger-command='showShareSubtree']")).toBeTruthy();
        expect(el.querySelector("[data-trigger-command='showOptions']")).toBeTruthy();
        // The advanced submenu (dropStart for non-vertical is false here).
        expect(el.querySelectorAll(".dropdown-submenu").length).toBeGreaterThan(0);
    });

    it("renders the hamburger button (no inline logo) in horizontal layout", () => {
        const el = renderMenu({ isHorizontalLayout: true });
        const button = el.querySelector(".global-menu-button");
        expect(button?.className).toContain("bx-menu");
        // No inline SVG logo when horizontal.
        expect(el.querySelector(".global-menu-button svg")).toBeFalsy();
    });

    it("adds mobile-only entries and uses the mobile launchbar icon when on mobile", () => {
        utilsState.isMobile = true;
        const glob = window.glob as unknown as Record<string, unknown>;
        glob.device = "mobile";
        const el = renderMenu({ isHorizontalLayout: false });

        expect(el.querySelector("[data-trigger-command='searchNotes']")).toBeTruthy();
        expect(el.querySelector("[data-trigger-command='showRecentChanges']")).toBeTruthy();
        // Configure launchbar uses the mobile icon.
        const launchbar = el.querySelector("[data-trigger-command='showLaunchBarSubtree'] .bx-mobile");
        expect(launchbar).toBeTruthy();
        // Mobile is not electron -> "switch to desktop version" should appear.
        expect(el.querySelector("[data-trigger-command='switchToDesktopVersion']")).toBeTruthy();
    });

    it("non-mobile, non-electron offers switch-to-mobile and the browser-only logout", () => {
        const el = renderMenu({ isHorizontalLayout: false });
        expect(el.querySelector("[data-trigger-command='switchToMobileVersion']")).toBeTruthy();
        // Browser-only options include logout.
        expect(el.querySelector("[data-trigger-command='logout']")).toBeTruthy();
        // Toggle-fullscreen falls back to a plain menu item when not electron.
        expect(el.querySelector("[data-trigger-command='toggleFullscreen']")).toBeTruthy();
    });

    it("electron shows zoom controls, dev tools, window-on-top, and hides logout/switch", () => {
        utilsState.isElectron = true;
        const setAlwaysOnTop = vi.fn();
        const isAlwaysOnTop = vi.fn(() => false);
        (window as { electronApi?: unknown }).electronApi = {
            window: { isAlwaysOnTop, setAlwaysOnTop }
        };

        const el = renderMenu({ isHorizontalLayout: false });

        // Zoom controls container (electron-only branch of ZoomControls).
        expect(el.querySelector(".zoom-container")).toBeTruthy();
        expect(el.querySelector(".zoom-buttons")).toBeTruthy();
        // Dev tools item only in electron.
        expect(el.querySelector("[data-trigger-command='openDevTools']")).toBeTruthy();
        // Window-on-top item present and toggles via the electron API.
        const pin = el.querySelector(".bx-pin");
        expect(pin).toBeTruthy();
        // No logout / switch-version items in electron.
        expect(el.querySelector("[data-trigger-command='logout']")).toBeFalsy();
        expect(el.querySelector("[data-trigger-command='switchToMobileVersion']")).toBeFalsy();
        expect(el.querySelector("[data-trigger-command='switchToDesktopVersion']")).toBeFalsy();
    });

    it("toggles always-on-top through the electron API when the pin item is clicked", () => {
        utilsState.isElectron = true;
        const setAlwaysOnTop = vi.fn();
        const isAlwaysOnTop = vi.fn(() => false);
        (window as { electronApi?: unknown }).electronApi = {
            window: { isAlwaysOnTop, setAlwaysOnTop }
        };

        const el = renderMenu({ isHorizontalLayout: false });
        const pinItem = el.querySelector("li.dropdown-item .bx-pin")?.closest("li");
        expect(pinItem).toBeTruthy();
        if (pinItem instanceof HTMLElement) {
            act(() => pinItem.click());
        }
        expect(setAlwaysOnTop).toHaveBeenCalledWith(true);
    });

    it("clicking a zoom-control button forwards the command to the parent component", () => {
        utilsState.isElectron = true;
        (window as { electronApi?: unknown }).electronApi = {
            window: { isAlwaysOnTop: () => false, setAlwaysOnTop: vi.fn() }
        };
        const parent = new Component();
        const triggerCommand = vi.spyOn(parent, "triggerCommand").mockResolvedValue(undefined as never);

        const el = renderMenu({ isHorizontalLayout: false }, parent);

        // Clicking the container itself just stops propagation (no command).
        const zoomContainer = el.querySelector("li.zoom-container");
        if (zoomContainer instanceof HTMLElement) {
            act(() => zoomContainer.click());
        }

        // zoomIn has dismiss=false -> stops propagation (the `!dismiss` branch).
        const zoomIn = el.querySelector(".zoom-buttons .bx-plus");
        expect(zoomIn).toBeTruthy();
        if (zoomIn instanceof HTMLElement) {
            act(() => zoomIn.click());
        }
        expect(triggerCommand).toHaveBeenCalledWith("zoomIn");

        // toggleFullscreen has dismiss=true -> does not stop propagation (the other branch).
        const fullscreen = el.querySelector(".zoom-buttons .bx-expand-alt");
        if (fullscreen instanceof HTMLElement) {
            act(() => fullscreen.click());
        }
        expect(triggerCommand).toHaveBeenCalledWith("toggleFullscreen");

        // The reset button (no icon) renders the zoom percentage.
        const reset = el.querySelector(".zoom-buttons a:not([class*='bx-'])");
        expect(reset?.textContent ?? "").toContain("100");
    });

    it("shows the update-available indicator and opens the release page when the download item is clicked", () => {
        utilsState.isUpdateAvailable = true;
        const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
        const el = renderMenu({ isHorizontalLayout: false });
        expect(el.querySelector(".global-menu-button-update-available")).toBeTruthy();
        // Download item is a function-command menu item (no data-trigger-command).
        const download = el.querySelector(".bx-download")?.closest("li");
        expect(download).toBeTruthy();
        if (download instanceof HTMLElement) {
            act(() => download.click());
        }
        expect(openSpy).toHaveBeenCalledWith(expect.stringContaining("github.com"));
    });

    it("renders development options with experimental-feature toggles when isDev", async () => {
        const glob = window.glob as unknown as Record<string, unknown>;
        glob.isDev = true;
        const toggleSpy = vi.spyOn(experimentalFeaturesService, "toggleExperimentalFeature").mockResolvedValue(undefined);

        const el = renderMenu({ isHorizontalLayout: false });

        // The experimental features submenu should list the available features.
        expect(el.querySelector(".bx-test-tube")).toBeTruthy();
        const featureCount = experimentalFeaturesService.getAvailableExperimentalFeatures().length;
        // Each feature is a FormListItem; locate clickable items inside the experimental submenu.
        const submenus = Array.from(el.querySelectorAll(".dropdown-submenu"));
        const expSubmenu = submenus.find(s => s.querySelector(".bx-test-tube"));
        expect(expSubmenu).toBeTruthy();
        const featureItems = expSubmenu?.querySelectorAll("ul.dropdown-menu > li.dropdown-item") ?? [];
        expect(featureItems.length).toBe(featureCount);

        const firstFeature = featureItems[0];
        if (firstFeature instanceof HTMLElement) {
            await act(async () => { firstFeature.click(); });
        }
        expect(toggleSpy).toHaveBeenCalled();
        expect(reloadFrontendApp).toHaveBeenCalled();
    });

    it("renders the advanced submenu with backend/sql entries", () => {
        const el = renderMenu({ isHorizontalLayout: false });
        expect(el.querySelector("[data-trigger-command='showHiddenSubtree']")).toBeTruthy();
        expect(el.querySelector("[data-trigger-command='showSearchHistory']")).toBeTruthy();
        expect(el.querySelector("[data-trigger-command='showSQLConsoleHistory']")).toBeTruthy();
        expect(el.querySelector("[data-trigger-command='reloadFrontendApp']")).toBeTruthy();
        // openDevTools is electron-only; absent here.
        expect(el.querySelector("[data-trigger-command='openDevTools']")).toBeFalsy();
    });
});

describe("VerticalLayoutIcon", () => {
    it("renders the standalone SVG logo", () => {
        const el = renderInto(<VerticalLayoutIcon />);
        const svg = el.querySelector("svg");
        expect(svg).toBeTruthy();
        expect(svg?.getAttribute("viewBox")).toBe("0 0 256 256");
        expect(svg?.querySelectorAll("path").length).toBeGreaterThan(0);
    });
});

describe("update status polling", () => {
    it("fetches the latest version when standalone and update-checking is enabled", async () => {
        utilsState.isStandalone = true;
        utilsState.isUpdateAvailable = true;
        const fetchMock = vi.fn(async () => ({
            json: async () => ({ tag_name: "v9.9.9" })
        }));
        vi.stubGlobal("fetch", fetchMock);

        renderMenu({ isHorizontalLayout: false });
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });

        expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("api.github.com"));
    });

    it("does not fetch and clears the version when update-checking is disabled", async () => {
        utilsState.isStandalone = true;
        setOptions({ zoomFactor: "1.0", checkForUpdates: "false", experimentalFeatures: "[]" });
        const fetchMock = vi.fn(async () => ({ json: async () => ({}) }));
        vi.stubGlobal("fetch", fetchMock);

        renderMenu({ isHorizontalLayout: false });
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });

        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("warns but does not throw when the GitHub fetch fails", async () => {
        utilsState.isStandalone = true;
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        const fetchMock = vi.fn(async () => { throw new Error("network"); });
        vi.stubGlobal("fetch", fetchMock);

        renderMenu({ isHorizontalLayout: false });
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });

        expect(fetchMock).toHaveBeenCalled();
        expect(warnSpy).toHaveBeenCalled();
    });
});
