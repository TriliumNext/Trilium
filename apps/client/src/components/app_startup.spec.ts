import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    loadTabs: vi.fn(async () => {}),
    executeStartupBundles: vi.fn(),
    updateDisplayedShortcuts: vi.fn(),
    setupWindowShortcuts: vi.fn(async () => {})
}));

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

describe("startAppAroundLayout", () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
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
    });
});
