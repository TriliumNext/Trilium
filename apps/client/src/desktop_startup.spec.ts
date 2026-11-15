import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    startAppAroundLayout: vi.fn(async (_root: HTMLElement) => true),
    setupGlobalTooltip: vi.fn(),
    setupBrowserContextMenu: vi.fn(),
    setupElectronContextMenu: vi.fn(),
    syncNativeWindowWithTheme: vi.fn(),
    setBackgroundEffectsSuspended: vi.fn(),
    onEffectiveThemeStyleChange: vi.fn(),
    isElectron: vi.fn(() => false)
}));

vi.mock("./components/app_startup.js", () => ({ startAppAroundLayout: mocks.startAppAroundLayout }));
vi.mock("./services/note_tooltip.js", () => ({ default: { setupGlobalTooltip: mocks.setupGlobalTooltip } }));
vi.mock("./menus/browser_context_menu.js", () => ({ setupContextMenu: mocks.setupBrowserContextMenu }));
vi.mock("./menus/electron_context_menu.js", () => ({ default: { setupContextMenu: mocks.setupElectronContextMenu } }));
vi.mock("./services/native_window.js", () => ({ syncNativeWindowWithTheme: mocks.syncNativeWindowWithTheme }));
vi.mock("./services/theme.js", () => ({
    onEffectiveThemeStyleChange: mocks.onEffectiveThemeStyleChange,
    setBackgroundEffectsSuspended: mocks.setBackgroundEffectsSuspended
}));
vi.mock("./services/utils.js", async (importOriginal) => {
    const original = await importOriginal<typeof import("./services/utils.js")>();
    return { ...original, default: { ...original.default, isElectron: () => mocks.isElectron() } };
});

import appContext from "./components/app_context.js";
import { startDesktop } from "./desktop_startup.js";

describe("startDesktop", () => {
    afterEach(() => {
        vi.clearAllMocks();
        vi.unstubAllGlobals();
        mocks.isElectron.mockReturnValue(false);
        delete window.electronApi;
    });

    it("starts the app around the layout, then sets up the tooltips and the browser's context menu", async () => {
        const root = document.createElement("div");
        await startDesktop(root);

        expect(mocks.startAppAroundLayout).toHaveBeenCalledWith(root);
        expect(mocks.setupGlobalTooltip).toHaveBeenCalled();
        expect(mocks.setupBrowserContextMenu).toHaveBeenCalled();
        expect(mocks.setupElectronContextMenu).not.toHaveBeenCalled();
    });

    it("reports no full render when the app fails to start", async () => {
        mocks.isElectron.mockReturnValue(true);
        vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 0; });
        const reportStartupMetric = vi.fn();
        window.electronApi = { window: {
            onGlobalShortcut: vi.fn(), onOpenInSameTab: vi.fn(), isDevToolsDocked: vi.fn(() => false),
            onDevToolsDockChanged: vi.fn(), reportStartupMetric
        }, navigation: { clearNavigationHistory: vi.fn() } } as unknown as typeof window.electronApi;
        mocks.startAppAroundLayout.mockResolvedValueOnce(false);

        await startDesktop(document.createElement("div"));
        expect(reportStartupMetric).not.toHaveBeenCalled();
    });

    it("connects the Electron window, and reports the full render after a painted frame", async () => {
        mocks.isElectron.mockReturnValue(true);
        vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 0; });
        const handlers: { shortcut?: (action: string) => void, sameTab?: (noteId: string) => void, dock?: (docked: boolean) => void } = {};
        const win = {
            onGlobalShortcut: vi.fn((callback: (action: string) => void) => { handlers.shortcut = callback; }),
            onOpenInSameTab: vi.fn((callback: (noteId: string) => void) => { handlers.sameTab = callback; }),
            isDevToolsDocked: vi.fn(() => true),
            onDevToolsDockChanged: vi.fn((callback: (docked: boolean) => void) => { handlers.dock = callback; }),
            reportStartupMetric: vi.fn()
        };
        const clearNavigationHistory = vi.fn();
        window.electronApi = { window: win, navigation: { clearNavigationHistory } } as unknown as typeof window.electronApi;

        await startDesktop(document.createElement("div"));
        await vi.waitFor(() => expect(mocks.setupElectronContextMenu).toHaveBeenCalled());

        expect(mocks.setupBrowserContextMenu).not.toHaveBeenCalled();
        expect(clearNavigationHistory).toHaveBeenCalled();
        expect(win.reportStartupMetric).toHaveBeenCalledWith("client-full-render");
        // The native window follows the theme, now and on each change of its effective style.
        expect(mocks.syncNativeWindowWithTheme).toHaveBeenCalledTimes(1);
        mocks.onEffectiveThemeStyleChange.mock.calls[0]?.[0]();
        expect(mocks.syncNativeWindowWithTheme).toHaveBeenCalledTimes(2);
        // The background effects are suspended while DevTools is docked into the window.
        expect(mocks.setBackgroundEffectsSuspended).toHaveBeenCalledWith(true);
        handlers.dock?.(false);
        expect(mocks.setBackgroundEffectsSuspended).toHaveBeenLastCalledWith(false);

        const triggerCommand = vi.spyOn(appContext, "triggerCommand").mockResolvedValue(undefined);
        handlers.shortcut?.("jumpToNote");
        expect(triggerCommand).toHaveBeenCalledWith("jumpToNote");
        triggerCommand.mockRestore();
        const openInSameTab = vi.fn();
        const originalTabManager = appContext.tabManager;
        appContext.tabManager = { openInSameTab } as unknown as typeof appContext.tabManager;
        handlers.sameTab?.("abc123");
        expect(openInSameTab).toHaveBeenCalledWith("abc123");
        appContext.tabManager = originalTabManager;
    });

    it("leaves the window alone in a desktop build without the Electron API", async () => {
        mocks.isElectron.mockReturnValue(true);
        const rejections = vi.fn();
        process.on("unhandledRejection", rejections);
        await startDesktop(document.createElement("div"));
        await vi.dynamicImportSettled();
        await new Promise((resolve) => setTimeout(resolve));
        process.off("unhandledRejection", rejections);

        expect(rejections).not.toHaveBeenCalled();
        expect(mocks.setupBrowserContextMenu).not.toHaveBeenCalled();
        expect(mocks.setupElectronContextMenu).not.toHaveBeenCalled();
    });
});
