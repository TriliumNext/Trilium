import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    loadTabs: vi.fn(async () => {}),
    executeStartupBundles: vi.fn(),
    updateDisplayedShortcuts: vi.fn(),
    setupWindowShortcuts: vi.fn(async () => {}),
    isElectron: vi.fn(() => false),
    setupGlobs: vi.fn(),
    setupClipboardImageEmbed: vi.fn(),
    setupLinkHandlers: vi.fn(),
    showPersistent: vi.fn(),
    preloadCommonNoteTypes: vi.fn()
}));

vi.mock("../services/glob.js", () => ({ default: { setupGlobs: mocks.setupGlobs } }));
vi.mock("../services/clipboard_image_embed.js", () => ({ setupClipboardImageEmbed: mocks.setupClipboardImageEmbed }));
vi.mock("../services/link.js", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../services/link.js")>()),
    setupLinkHandlers: mocks.setupLinkHandlers
}));
vi.mock("../services/i18n.js", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../services/i18n.js")>()),
    t: (key: string, values?: Record<string, string>) => (values ? `${key} ${JSON.stringify(values)}` : key)
}));
vi.mock("../services/toast.js", () => ({ default: { showPersistent: mocks.showPersistent } }));
vi.mock("../widgets/note_types.js", () => ({ preloadCommonNoteTypes: mocks.preloadCommonNoteTypes }));

vi.mock("../services/utils.js", async (importOriginal) => {
    const original = await importOriginal<typeof import("../services/utils.js")>();
    return { ...original, default: { ...original.default, isElectron: () => mocks.isElectron() } };
});
vi.mock("./zoom.js", async () => {
    const { default: Component } = await import("./component.js");
    return { default: new Component() };
});
vi.mock("./tab_manager.js", async (importOriginal) => {
    const { default: TabManager } = await importOriginal<typeof import("./tab_manager.js")>();
    return {
        default: class extends TabManager {
            loadTabs = mocks.loadTabs;
        }
    };
});
vi.mock("../services/bundle.js", () => ({
    default: { executeStartupBundles: mocks.executeStartupBundles }
}));
vi.mock("../services/keyboard_actions.js", async (importOriginal) => ({
    default: {
        ...(await importOriginal<typeof import("../services/keyboard_actions.js")>()).default,
        updateDisplayedShortcuts: mocks.updateDisplayedShortcuts,
        setupWindowShortcuts: mocks.setupWindowShortcuts
    }
}));

import server from "../services/server.js";
import appContext from "./app_context.js";
import { startAppAroundLayout } from "./app_startup.js";
import Entrypoints from "./entrypoints.js";
import MainTreeExecutors from "./main_tree_executors.js";
import RootCommandExecutor from "./root_command_executor.js";
import TabManager from "./tab_manager.js";
import zoomComponent from "./zoom.js";

describe("startAppAroundLayout", () => {
    afterEach(() => {
        if (appContext.children.includes(zoomComponent)) {
            appContext.removeChild(zoomComponent);
        }
        vi.useRealTimers();
        vi.restoreAllMocks();
        vi.clearAllMocks();
    });

    it("sets up the globals and the handlers of links and pasted images, and preloads the common note types once started", async () => {
        vi.spyOn(server, "get").mockResolvedValue([]);
        const started = startAppAroundLayout(document.createElement("div"));
        // Before the tabs are restored, so a link clicked meanwhile opens.
        expect(mocks.setupGlobs).toHaveBeenCalled();
        expect(mocks.setupClipboardImageEmbed).toHaveBeenCalled();
        expect(mocks.setupLinkHandlers).toHaveBeenCalled();
        expect(mocks.preloadCommonNoteTypes).not.toHaveBeenCalled();

        expect(await started).toBe(true);
        expect(mocks.preloadCommonNoteTypes).toHaveBeenCalled();
        expect(mocks.showPersistent).not.toHaveBeenCalled();
    });

    it("shows a critical error, and preloads nothing, when the app fails to start", async () => {
        vi.spyOn(server, "get").mockResolvedValue([]);
        vi.spyOn(console, "error").mockImplementation(() => {});
        mocks.loadTabs.mockRejectedValueOnce(new Error("no tree"));
        expect(await startAppAroundLayout(document.createElement("div"))).toBe(false);

        expect(mocks.showPersistent).toHaveBeenCalledWith(expect.objectContaining({
            id: "critical-error",
            message: expect.stringContaining("no tree")
        }));
        expect(mocks.preloadCommonNoteTypes).not.toHaveBeenCalled();

        mocks.loadTabs.mockRejectedValueOnce("offline");
        await startAppAroundLayout(document.createElement("div"));
        expect(mocks.showPersistent).toHaveBeenLastCalledWith(expect.objectContaining({
            message: expect.stringContaining("offline")
        }));
    });

    it("builds the components that execute commands around a rendered layout, then restores the tabs", async () => {
        vi.useFakeTimers();
        // What `StartupChecks` and `ShortcutComponent` ask for as they are built.
        const get = server.get.bind(server);
        vi.spyOn(server, "get").mockImplementation((async (url: string) => {
            if (url === "system-checks") return { isCpuArchMismatch: false };
            if (url === "keyboard-shortcuts-for-notes") return [];
            return get(url);
        }) as typeof server.get);
        const root = document.createElement("div");
        const rendered = vi.fn();
        appContext.registerHandler("initialRenderComplete", rendered);

        await startAppAroundLayout(root);

        expect(appContext.tabManager).toBeInstanceOf(TabManager);
        for (const type of [ TabManager, RootCommandExecutor, Entrypoints, MainTreeExecutors ]) {
            expect(appContext.components.some((component) => component instanceof type)).toBe(true);
        }
        expect(mocks.setupWindowShortcuts).toHaveBeenCalled();
        expect(mocks.updateDisplayedShortcuts.mock.calls[0]?.[0]?.[0]).toBe(root);
        expect(rendered).toHaveBeenCalledTimes(1);
        expect(mocks.loadTabs).toHaveBeenCalledTimes(1);

        expect(mocks.executeStartupBundles).not.toHaveBeenCalled();
        vi.advanceTimersByTime(2000);
        expect(mocks.executeStartupBundles).toHaveBeenCalledTimes(1);
        appContext.removeHandler("initialRenderComplete", rendered);
        expect(appContext.children).not.toContain(zoomComponent);
    });

    it("adds the zoom of the window in the desktop app", async () => {
        vi.spyOn(server, "get").mockResolvedValue([]);
        mocks.isElectron.mockReturnValue(true);
        await startAppAroundLayout(document.createElement("div"));
        mocks.isElectron.mockReturnValue(false);

        expect(appContext.children).toContain(zoomComponent);
    });
});
