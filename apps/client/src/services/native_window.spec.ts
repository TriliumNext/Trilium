import type { ElectronApi } from "@triliumnext/commons";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { syncNativeWindowWithTheme } from "./native_window.js";

type Glob = NonNullable<typeof window.glob>;

const optionsCtrl = vi.hoisted(() => ({ get: vi.fn(() => "false") }));
const themeCtrl = vi.hoisted(() => ({ getThemeStyle: vi.fn(() => "auto") }));

vi.mock("./options.js", () => ({ default: optionsCtrl }));
vi.mock("./theme.js", () => ({ getThemeStyle: themeCtrl.getThemeStyle }));

/** The subset of the Electron window API this module drives, all spied. */
const win = {
    setNativeThemeSource: vi.fn(),
    setBackgroundMaterial: vi.fn(),
    setVibrancy: vi.fn(),
    setTitleBarOverlay: vi.fn(),
    setWindowButtonPosition: vi.fn()
};

/**
 * Stands in for the computed style of `document.body`: happy-dom does not resolve custom
 * properties, and the module only ever reads them by name.
 */
function stubThemeVariables(vars: Record<string, string>) {
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
        getPropertyValue: (name: string) => vars[name] ?? ""
    } as CSSStyleDeclaration);
}

/** The module reads `window.glob.platform`; nothing else of the real globals is needed. */
function setPlatform(platform: Glob["platform"]) {
    window.glob = { platform } as Glob;
}

beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    optionsCtrl.get.mockReturnValue("false");
    themeCtrl.getThemeStyle.mockReturnValue("auto");
    setPlatform("linux");
    window.electronApi = { window: win } as unknown as ElectronApi;
    stubThemeVariables({});
});

describe("syncNativeWindowWithTheme", () => {
    it("is a no-op outside Electron", () => {
        delete window.electronApi;
        syncNativeWindowWithTheme();
        expect(win.setNativeThemeSource).not.toHaveBeenCalled();
    });

    it("forwards the theme's light/dark preference, falling back to the system for 'auto'", () => {
        syncNativeWindowWithTheme();
        expect(win.setNativeThemeSource).toHaveBeenCalledWith("system");

        themeCtrl.getThemeStyle.mockReturnValue("dark");
        syncNativeWindowWithTheme();
        expect(win.setNativeThemeSource).toHaveBeenCalledWith("dark");
    });

    it("applies the background material only where the platform supports it", () => {
        stubThemeVariables({ "--background-material": " mica " });
        setPlatform("win32");
        syncNativeWindowWithTheme();
        expect(win.setBackgroundMaterial).toHaveBeenCalledWith("mica");
        expect(win.setVibrancy).not.toHaveBeenCalled();

        // A material the platform does not know about is ignored rather than passed through.
        vi.clearAllMocks();
        stubThemeVariables({ "--background-material": "under-window" });
        syncNativeWindowWithTheme();
        expect(win.setBackgroundMaterial).not.toHaveBeenCalled();

        vi.clearAllMocks();
        setPlatform("darwin");
        syncNativeWindowWithTheme();
        expect(win.setVibrancy).toHaveBeenCalledWith("under-window");
        expect(win.setBackgroundMaterial).not.toHaveBeenCalled();
    });

    it("sets the title bar overlay colors on Windows and Linux, with an opt-in height", () => {
        const colors = {
            "--native-titlebar-background": "#111",
            "--native-titlebar-foreground": "#eee"
        };

        // No --native-titlebar-height: keep Chromium's own caption height.
        stubThemeVariables(colors);
        syncNativeWindowWithTheme();
        expect(win.setTitleBarOverlay).toHaveBeenCalledWith({ color: "#111", symbolColor: "#eee" });

        vi.clearAllMocks();
        stubThemeVariables({ ...colors, "--native-titlebar-height": "36" });
        syncNativeWindowWithTheme();
        expect(win.setTitleBarOverlay).toHaveBeenCalledWith({ color: "#111", symbolColor: "#eee", height: 36 });

        vi.clearAllMocks();
        setPlatform("win32");
        syncNativeWindowWithTheme();
        expect(win.setTitleBarOverlay).toHaveBeenCalledWith({ color: "#111", symbolColor: "#eee", height: 36 });
    });

    it("skips the overlay when the theme provides no colors for it", () => {
        stubThemeVariables({ "--native-titlebar-background": "#111" });
        syncNativeWindowWithTheme();
        expect(win.setTitleBarOverlay).not.toHaveBeenCalled();
    });

    it("positions the traffic lights on macOS from the theme's offsets", () => {
        setPlatform("darwin");
        stubThemeVariables({
            "--native-titlebar-darwin-x-offset": "12",
            "--native-titlebar-darwin-y-offset": "14"
        });
        syncNativeWindowWithTheme();
        expect(win.setWindowButtonPosition).toHaveBeenCalledWith({ x: 12, y: 14 });
        expect(win.setTitleBarOverlay).not.toHaveBeenCalled();
    });

    it("leaves the title bar alone when the native one is visible, since setting the overlay then throws", () => {
        optionsCtrl.get.mockReturnValue("true");
        stubThemeVariables({
            "--native-titlebar-background": "#111",
            "--native-titlebar-foreground": "#eee"
        });
        syncNativeWindowWithTheme();
        expect(win.setTitleBarOverlay).not.toHaveBeenCalled();
        expect(win.setWindowButtonPosition).not.toHaveBeenCalled();
        // The rest of the sync still runs.
        expect(win.setNativeThemeSource).toHaveBeenCalled();
    });
});
