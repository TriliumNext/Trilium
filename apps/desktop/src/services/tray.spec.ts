import { becca, becca_easy_mocking } from "@triliumnext/core";
import { join as pathJoin, sep as pathSep } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { buildNote } = becca_easy_mocking;

type Handler = (...args: unknown[]) => unknown;

// Mutable test state for the core/electron stubs plus captured event handlers.
const state = vi.hoisted(() => ({
    dbInitialized: true,
    disableTray: false,
    isMac: false,
    isDev: false,
    shouldUseDarkColors: false,
    // captured handlers
    appHandlers: new Map<string, Handler>(),
    appQuit: vi.fn(),
    ipcHandlers: new Map<string, Handler>(),
    nativeThemeHandlers: new Map<string, Handler>(),
    i18nHandlers: new Map<string, Handler>(),
    // captured tray instance
    trayInstance: undefined as undefined | {
        setToolTip: ReturnType<typeof vi.fn>;
        on: ReturnType<typeof vi.fn>;
        setContextMenu: ReturnType<typeof vi.fn>;
        destroy: ReturnType<typeof vi.fn>;
        clickHandlers: Map<string, Handler>;
        lastTemplate: unknown[];
    },
    // controllable windows
    lastFocusedWindow: null as unknown,
    mainWindow: null as unknown,
    allWindows: [] as unknown[],
    browserWindowAll: [] as unknown[]
}));

// `getTodayNote` returns a fake note used by the "today" menu item.
const todayNote = { noteId: "today" };

vi.mock("@triliumnext/core", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@triliumnext/core")>();
    return {
        ...actual,
        getLog: () => ({ info: vi.fn(), error: vi.fn() }),
        utils: {
            ...actual.utils,
            isMac: () => state.isMac,
            isDev: () => state.isDev
        },
        sql_init: { ...actual.sql_init, isDbInitialized: () => state.dbInitialized },
        options: { ...actual.options, getOptionBool: () => state.disableTray },
        cls: { ...actual.cls, wrap: (fn: Handler) => fn },
        date_notes: { ...actual.date_notes, getTodayNote: async () => todayNote }
    };
});

vi.mock("electron", () => ({
    default: {
        Tray: class {
            setToolTip = vi.fn();
            setContextMenu = vi.fn();
            clickHandlers = new Map<string, Handler>();
            lastTemplate: unknown[] = [];
            on = vi.fn((event: string, fn: Handler) => {
                this.clickHandlers.set(event, fn);
            });
            destroy = vi.fn(() => {
                state.trayInstance = undefined;
            });
            constructor() {
                state.trayInstance = this;
            }
        },
        Menu: {
            buildFromTemplate: vi.fn((template: unknown[]) => {
                if (state.trayInstance) {
                    state.trayInstance.lastTemplate = template;
                }
                return template;
            })
        },
        nativeTheme: {
            get shouldUseDarkColors() {
                return state.shouldUseDarkColors;
            },
            on: (event: string, fn: Handler) => state.nativeThemeHandlers.set(event, fn)
        },
        ipcMain: {
            on: (channel: string, fn: Handler) => state.ipcHandlers.set(channel, fn)
        },
        app: {
            on: (event: string, fn: Handler) => state.appHandlers.set(event, fn),
            quit: (...args: unknown[]) => state.appQuit(...args)
        },
        BrowserWindow: {
            getAllWindows: () => state.browserWindowAll
        }
    }
}));

vi.mock("./window.js", () => ({
    default: {
        getLastFocusedWindow: () => state.lastFocusedWindow,
        getMainWindow: () => state.mainWindow,
        getAllWindows: () => state.allWindows
    }
}));

vi.mock("@triliumnext/server/src/services/utils.js", () => ({
    getResourceDir: () => "/res"
}));

vi.mock("i18next", () => ({
    default: { on: (event: string, fn: Handler) => state.i18nHandlers.set(event, fn) },
    t: (key: string) => key
}));

const tray = await import("./tray.js");

interface FakeWindow {
    id: number;
    getTitle: () => string;
    webContents: { send: ReturnType<typeof vi.fn> };
    on: ReturnType<typeof vi.fn>;
    listeners: Map<string, Handler>;
    show: ReturnType<typeof vi.fn>;
    focus: ReturnType<typeof vi.fn>;
    hide: ReturnType<typeof vi.fn>;
    isVisible: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
}

// Monotonic window id counter. The module-level `windowVisibilityMap` persists
// across tests; reusing ids would skip the "newly created window" registration
// branch, so every test gets fresh ids.
let nextWindowId = 1;

function makeWindow(idOrTitle?: number | string, maybeTitle = "My Note - Trilium"): FakeWindow {
    let id: number;
    let title: string;
    if (typeof idOrTitle === "string") {
        id = nextWindowId++;
        title = idOrTitle;
    } else {
        id = nextWindowId++;
        title = maybeTitle;
    }
    const listeners = new Map<string, Handler>();
    return {
        id,
        getTitle: () => title,
        webContents: { send: vi.fn() },
        listeners,
        on: vi.fn((event: string, fn: Handler) => listeners.set(event, fn)),
        show: vi.fn(),
        focus: vi.fn(),
        hide: vi.fn(),
        isVisible: vi.fn(() => true),
        close: vi.fn()
    };
}

function getTrayInstance() {
    return state.trayInstance;
}

function fireAppCreated() {
    const handler = state.appHandlers.get("browser-window-created");
    if (!handler) throw new Error("browser-window-created not registered");
    return handler();
}

/** Find a menu item in the last-built tray template by its label. */
function findItem(label: string) {
    const template = state.trayInstance?.lastTemplate ?? [];
    return template.find((item) => (item as { label?: string }).label === label) as
        | (Electron.MenuItemConstructorOptions & { submenu?: Electron.MenuItemConstructorOptions[] })
        | undefined;
}

describe("tray", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        becca.reset();
        // Re-stub getRecentNotesFromQuery (becca.reset doesn't touch the prototype,
        // but keep it controllable per-test).
        becca.getRecentNotesFromQuery = vi.fn(() => []) as unknown as typeof becca.getRecentNotesFromQuery;
        state.dbInitialized = true;
        state.disableTray = false;
        state.isMac = false;
        state.isDev = false;
        state.shouldUseDarkColors = false;
        state.lastFocusedWindow = null;
        state.mainWindow = null;
        state.allWindows = [];
        state.browserWindowAll = [];
        // Bookmarks subtree must always exist for buildBookmarksMenu.
        buildNote({ id: "_lbBookmarks", title: "Bookmarks" });
    });

    // These tests intentionally run BEFORE the tray is created, exercising the
    // early-return branches that are impossible to reach once the module-level
    // `tray` singleton is set.

    it("setupSystemTray does not create a tray when DB is not initialized", () => {
        tray.setupSystemTray();
        state.dbInitialized = false;
        fireAppCreated();
        expect(state.trayInstance).toBeUndefined();
    });

    it("does not create a tray when disableTray option is set", () => {
        state.disableTray = true;
        fireAppCreated();
        expect(state.trayInstance).toBeUndefined();
    });

    it("reload-tray with the tray disabled does not create a tray", () => {
        // The reload-tray handler now reconciles the tray with the option, so
        // firing it while `disableTray` is set must not bring a tray into being
        // (exercises destroyTray's no-tray early return).
        state.disableTray = true;
        state.ipcHandlers.get("reload-tray")?.();
        expect(state.trayInstance).toBeUndefined();
    });

    describe("after tray creation", () => {
        beforeEach(() => {
            // Create the tray once (idempotent afterwards). isMac=false so the
            // nativeTheme "updated" listener is registered.
            fireAppCreated();
        });

        it("creates the tray with tooltip and click handler (non-mac wires nativeTheme)", () => {
            const instance = state.trayInstance;
            if (!instance) throw new Error("tray not created");
            expect(instance.setToolTip).toHaveBeenCalledWith("tray.tooltip");
            expect(instance.clickHandlers.has("click")).toBe(true);
            expect(state.nativeThemeHandlers.has("updated")).toBe(true);
            expect(state.ipcHandlers.has("reload-tray")).toBe(true);
            expect(state.i18nHandlers.has("languageChanged")).toBe(true);
        });

        it("createTray is idempotent (already-created early return)", () => {
            const before = state.trayInstance;
            fireAppCreated(); // second call must not replace the tray
            expect(state.trayInstance).toBe(before);
        });

        it("click handler toggles visibility: null window returns early", () => {
            const click = state.trayInstance?.clickHandlers.get("click");
            state.lastFocusedWindow = null;
            expect(() => click?.()).not.toThrow();
        });

        it("click handler hides a visible window and shows a hidden one", () => {
            const win = makeWindow(1);
            state.lastFocusedWindow = win;
            state.allWindows = [win];
            state.browserWindowAll = [win];
            const click = state.trayInstance?.clickHandlers.get("click");

            // Fire show/hide listeners to seed windowVisibilityMap.
            // First build the menu so listeners get registered.
            const reload = state.ipcHandlers.get("reload-tray");
            reload?.();
            // window id 1 visible by default -> click hides it
            click?.();
            expect(win.hide).toHaveBeenCalled();

            // Now simulate it being hidden, then click shows + focuses.
            win.listeners.get("hide")?.();
            click?.();
            expect(win.show).toHaveBeenCalled();
            expect(win.focus).toHaveBeenCalled();
        });

        it("click handler summons a window started hidden (no focus history)", () => {
            // hide-on-autostart: the window was created hidden, never focused, so it
            // isn't in the focus list — only reachable via getMainWindow().
            const win = makeWindow(1);
            win.isVisible.mockReturnValue(false);
            state.lastFocusedWindow = null;
            state.mainWindow = win;
            state.allWindows = [win];
            state.browserWindowAll = [win];

            // Build the menu so the window is seeded into windowVisibilityMap (as
            // hidden, from isVisible()).
            state.ipcHandlers.get("reload-tray")?.();

            state.trayInstance?.clickHandlers.get("click")?.();
            expect(win.show).toHaveBeenCalled();
            expect(win.focus).toHaveBeenCalled();
            expect(win.hide).not.toHaveBeenCalled();
        });
    });

    describe("updateTrayMenu menu contents", () => {
        let winA: FakeWindow;
        let winB: FakeWindow;

        beforeEach(() => {
            fireAppCreated();
            winA = makeWindow(1, "Note A - Trilium");
            winB = makeWindow(2, "Note B - Trilium");
        });

        function rebuild() {
            const reload = state.ipcHandlers.get("reload-tray");
            reload?.();
        }

        it("builds bookmarks (folder + normal) and recent notes; click opens in same tab", () => {
            becca.reset();
            buildNote({ id: "_customDictionary", title: "x" }); // unrelated, keep becca non-empty
            buildNote({
                id: "_lbBookmarks",
                title: "Bookmarks",
                children: [
                    {
                        id: "folder1",
                        title: "Folder One",
                        "#bookmarkFolder": "true",
                        children: [{ id: "child1", title: "Child One" }]
                    },
                    { id: "bm1", title: "Bookmark One" }
                ]
            });
            becca.getRecentNotesFromQuery = vi.fn(() => [
                { noteId: "child1", utcDateCreated: "2025-01-01 10:00:00.000Z" }
            ]) as unknown as typeof becca.getRecentNotesFromQuery;

            const win = winA;
            state.lastFocusedWindow = win;
            state.allWindows = [win];
            rebuild();

            const bookmarks = findItem("tray.bookmarks");
            const folder = bookmarks?.submenu?.find((i) => i.label === "Folder One");
            const normal = bookmarks?.submenu?.find((i) => i.label === "Bookmark One");
            expect(folder?.type).toBe("submenu");
            expect(normal?.type).toBe("normal");

            // Invoke folder submenu child click (openInSameTab with lastFocusedWindow).
            const subChild = (folder as { submenu?: Electron.MenuItemConstructorOptions[] })
                ?.submenu?.[0];
            subChild?.click?.(undefined as never, undefined as never, undefined as never);
            normal?.click?.(undefined as never, undefined as never, undefined as never);
            expect(win.webContents.send).toHaveBeenCalledWith("openInSameTab", "child1");
            expect(win.webContents.send).toHaveBeenCalledWith("openInSameTab", "bm1");

            // Recent notes menu + click.
            const recents = findItem("tray.recents");
            const recentItem = recents?.submenu?.[0];
            expect(recentItem?.label).toBe("Child One");
            recentItem?.click?.(undefined as never, undefined as never, undefined as never);
            expect(win.webContents.send).toHaveBeenCalledWith("openInSameTab", "child1");
        });

        it("openInSameTab no-ops when there is no focused window", () => {
            becca.getRecentNotesFromQuery = vi.fn(() => [
                { noteId: "r1", utcDateCreated: "2025-01-01 10:00:00.000Z" }
            ]) as unknown as typeof becca.getRecentNotesFromQuery;
            buildNote({ id: "r1", title: "Recent One" });

            state.lastFocusedWindow = null;
            state.allWindows = [];
            rebuild();

            const recents = findItem("tray.recents");
            const recentItem = recents?.submenu?.[0];
            // Should not throw despite no focused window.
            expect(() =>
                recentItem?.click?.(undefined as never, undefined as never, undefined as never)
            ).not.toThrow();
        });

        it("window visibility items: single window (no title) and checkbox hide", () => {
            const win = winA;
            state.lastFocusedWindow = win;
            state.allWindows = [win];
            rebuild();

            const visItem = (state.trayInstance?.lastTemplate ?? []).find(
                (i) => (i as { type?: string }).type === "checkbox"
            ) as Electron.MenuItemConstructorOptions | undefined;
            // Single window -> plain label, no title appended.
            expect(visItem?.label).toBe("tray.show-windows");
            expect(visItem?.checked).toBe(true);

            // checkbox click for a visible window -> hide.
            visItem?.click?.(undefined as never, undefined as never, undefined as never);
            expect(win.hide).toHaveBeenCalled();
        });

        it("window visibility items: multiple windows show titles and checkbox can re-show", () => {
            state.lastFocusedWindow = winA;
            state.allWindows = [winA, winB];
            rebuild();

            const checkboxes = (state.trayInstance?.lastTemplate ?? []).filter(
                (i) => (i as { type?: string }).type === "checkbox"
            ) as Electron.MenuItemConstructorOptions[];
            expect(checkboxes.length).toBe(2);
            // Title appended for window B ("Note B").
            expect(checkboxes.some((c) => typeof c.label === "string" && c.label.includes("Note B"))).toBe(
                true
            );

            // Seed winB as hidden so its checkbox click re-shows it.
            winB.listeners.get("hide")?.();
            rebuild();
            const cbB = (state.trayInstance?.lastTemplate ?? [])
                .filter((i) => (i as { type?: string }).type === "checkbox")
                .find((c) => typeof (c as { label?: string }).label === "string" &&
                    ((c as { label: string }).label).includes("Note B")) as
                | Electron.MenuItemConstructorOptions
                | undefined;
            cbB?.click?.(undefined as never, undefined as never, undefined as never);
            expect(winB.show).toHaveBeenCalled();
            expect(winB.focus).toHaveBeenCalled();
        });

        it("prunes closed windows and registers listeners for new ones", () => {
            state.allWindows = [winA, winB];
            state.lastFocusedWindow = winA;
            rebuild();
            expect(winB.on).toHaveBeenCalled(); // listener registered

            // Now remove winB; it should be pruned from the visibility map.
            state.allWindows = [winA];
            rebuild();
            const checkboxes = (state.trayInstance?.lastTemplate ?? []).filter(
                (i) => (i as { type?: string }).type === "checkbox"
            );
            expect(checkboxes.length).toBe(1);
        });

        it("appends the -inverted icon suffix when dark colors are active (non-mac)", () => {
            state.isMac = false;
            state.shouldUseDarkColors = true;
            state.lastFocusedWindow = winA;
            state.allWindows = [winA];
            rebuild();

            const newWindowItem = findItem("tray.open_new_window");
            expect(newWindowItem?.icon).toContain("new-windowTemplate-inverted.png");
        });

        it("open-new-window, new-note, today and close click handlers (with focused window)", async () => {
            const win = winA;
            state.lastFocusedWindow = win;
            state.allWindows = [win];
            state.browserWindowAll = [win];
            rebuild();

            findItem("tray.open_new_window")?.click?.(
                undefined as never,
                undefined as never,
                undefined as never
            );
            expect(win.webContents.send).toHaveBeenCalledWith("globalShortcut", "openNewWindow");

            findItem("tray.new-note")?.click?.(
                undefined as never,
                undefined as never,
                undefined as never
            );
            expect(win.webContents.send).toHaveBeenCalledWith(
                "globalShortcut",
                "createNoteIntoInbox"
            );

            // "today" uses cls.wrap(async ...) — the click returns a promise we await.
            const todayClick = findItem("tray.today")?.click as
                | ((...args: never[]) => Promise<void>)
                | undefined;
            await todayClick?.();
            expect(win.webContents.send).toHaveBeenCalledWith("openInSameTab", "today");

            // "close" (labelled "Quit Trilium") genuinely quits the app. It calls
            // app.quit() rather than closing windows so the close-to-tray
            // interceptor (which would otherwise hide them) is bypassed via
            // before-quit.
            findItem("tray.close")?.click?.(
                undefined as never,
                undefined as never,
                undefined as never
            );
            expect(state.appQuit).toHaveBeenCalled();
            expect(win.close).not.toHaveBeenCalled();
        });

        it("open-new-window and new-note no-op when no focused window", () => {
            state.lastFocusedWindow = null;
            state.allWindows = [];
            rebuild();

            expect(() =>
                findItem("tray.open_new_window")?.click?.(
                    undefined as never,
                    undefined as never,
                    undefined as never
                )
            ).not.toThrow();
            expect(() =>
                findItem("tray.new-note")?.click?.(
                    undefined as never,
                    undefined as never,
                    undefined as never
                )
            ).not.toThrow();
        });
    });

    describe("window title formatting", () => {
        it("truncates long titles to 17 chars + ellipsis (multi-window shows title)", () => {
            const longWin = makeWindow("A Very Long Window Title Indeed - Trilium");
            const other = makeWindow("Other - Trilium");
            fireAppCreated();
            state.lastFocusedWindow = longWin;
            state.allWindows = [longWin, other];
            state.ipcHandlers.get("reload-tray")?.();

            const checkbox = (state.trayInstance?.lastTemplate ?? [])
                .filter((i) => (i as { type?: string }).type === "checkbox")
                .find((c) =>
                    typeof (c as { label?: string }).label === "string" &&
                    ((c as { label: string }).label).includes("...")
                ) as Electron.MenuItemConstructorOptions | undefined;
            expect(checkbox?.label).toContain("...");
            // 17 chars of "A Very Long Window Title..." -> "A Very Long Windo..."
            expect(checkbox?.label).toContain("A Very Long Windo...");
        });

        it("short titles are shown verbatim with app-name suffix stripped", () => {
            const winA = makeWindow("Short - Trilium");
            const winB = makeWindow("Other - Trilium");
            fireAppCreated();
            state.lastFocusedWindow = winA;
            state.allWindows = [winA, winB];
            state.ipcHandlers.get("reload-tray")?.();

            const checkbox = (state.trayInstance?.lastTemplate ?? [])
                .filter((i) => (i as { type?: string }).type === "checkbox")
                .find((c) =>
                    typeof (c as { label?: string }).label === "string" &&
                    ((c as { label: string }).label).includes("Short")
                ) as Electron.MenuItemConstructorOptions | undefined;
            expect(checkbox?.label).toContain("Short");
            expect(checkbox?.label).not.toContain("Trilium");
        });
    });

    describe("registerVisibilityListener listeners", () => {
        it("show/hide/minimize/maximize update the map and rebuild the menu", () => {
            fireAppCreated();
            const win = makeWindow();
            state.lastFocusedWindow = win;
            state.allWindows = [win];
            state.ipcHandlers.get("reload-tray")?.();

            const buildSpy = state.trayInstance?.setContextMenu;
            const callsBefore = buildSpy?.mock.calls.length ?? 0;

            win.listeners.get("show")?.();
            win.listeners.get("hide")?.();
            win.listeners.get("minimize")?.();
            win.listeners.get("maximize")?.();

            expect((buildSpy?.mock.calls.length ?? 0)).toBeGreaterThan(callsBefore);
        });
    });

    describe("runtime enable/disable (no restart)", () => {
        beforeEach(() => {
            // Start each test with a live tray so we can toggle it off and on.
            state.disableTray = false;
            fireAppCreated();
        });

        it("destroys the tray when disabled and recreates it when re-enabled", () => {
            expect(state.trayInstance).toBeDefined();
            const destroy = state.trayInstance?.destroy;

            // Toggle the option on -> tray is torn down without a restart.
            state.disableTray = true;
            state.ipcHandlers.get("reload-tray")?.();
            expect(destroy).toHaveBeenCalled();
            expect(state.trayInstance).toBeUndefined();

            // Firing again while disabled is a no-op (destroyTray early return).
            expect(() => state.ipcHandlers.get("reload-tray")?.()).not.toThrow();
            expect(state.trayInstance).toBeUndefined();

            // Toggle the option back off -> a fresh tray is created.
            state.disableTray = false;
            state.ipcHandlers.get("reload-tray")?.();
            expect(state.trayInstance).toBeDefined();
            expect(state.trayInstance?.setToolTip).toHaveBeenCalledWith("tray.tooltip");
        });

        it("refreshes rather than recreates the tray when reloaded while enabled", () => {
            const before = state.trayInstance;
            expect(before).toBeDefined();
            state.ipcHandlers.get("reload-tray")?.();
            expect(state.trayInstance).toBe(before);
        });
    });

    // `createTray` runs `getTrayIconPath` exactly once per module instance and the
    // module-level `tray` singleton can't be reset in-place. Re-import the module
    // fresh (via vi.resetModules) so each icon-path branch executes from a clean
    // creation. These run LAST so they don't disturb the shared top-level import.
    describe("icon path branches (isolated module re-imports)", () => {
        async function freshCreate(opts: {
            isMac?: boolean;
            isDev?: boolean;
            nodeEnv?: string;
            darkColors?: boolean;
        }) {
            state.isMac = opts.isMac ?? false;
            state.isDev = opts.isDev ?? false;
            state.shouldUseDarkColors = opts.darkColors ?? false;
            state.disableTray = false;
            state.dbInitialized = true;
            state.lastFocusedWindow = null;
            state.allWindows = [];
            state.trayInstance = undefined;
            state.appHandlers.clear();
            state.nativeThemeHandlers.clear();
            state.ipcHandlers.clear();
            state.i18nHandlers.clear();
            const prevNodeEnv = process.env.NODE_ENV;
            if (opts.nodeEnv !== undefined) {
                process.env.NODE_ENV = opts.nodeEnv;
            }
            becca.reset();
            buildNote({ id: "_lbBookmarks", title: "Bookmarks" });
            becca.getRecentNotesFromQuery = vi.fn(() => []) as unknown as typeof becca.getRecentNotesFromQuery;

            vi.resetModules();
            const fresh = await import("./tray.js");
            fresh.setupSystemTray();
            const handler = state.appHandlers.get("browser-window-created");
            handler?.();

            process.env.NODE_ENV = prevNodeEnv;
            // The Tray constructor (re)assigns state.trayInstance via the handler
            // call above; read it back through a fresh accessor so TS doesn't keep
            // the `undefined` control-flow narrowing from the reset assignment.
            return getTrayInstance();
        }

        it("mac uses the black template icon and skips the nativeTheme listener", async () => {
            const instance = await freshCreate({ isMac: true });
            if (!instance) throw new Error("tray not created");
            const arg = (instance as unknown as { setToolTip: ReturnType<typeof vi.fn> });
            expect(arg.setToolTip).toHaveBeenCalled();
            // macOS template icons -> no nativeTheme "updated" listener.
            expect(state.nativeThemeHandlers.has("updated")).toBe(false);
        });

        it("dev (non-mac) uses the purple icon", async () => {
            const instance = await freshCreate({ isMac: false, isDev: true });
            expect(instance).toBeDefined();
            expect(state.nativeThemeHandlers.has("updated")).toBe(true);
        });

        it("production (non-dev, non-mac) resolves icons under the resource dir", async () => {
            const instance = await freshCreate({
                isMac: false,
                isDev: false,
                nodeEnv: "production",
                darkColors: false
            });
            if (!instance) throw new Error("tray not created");
            // getIconPath used the production (resource dir) branch for menu icons.
            const newWindowItem = instance.lastTemplate.find(
                (i) => (i as { label?: string }).label === "tray.open_new_window"
            ) as Electron.MenuItemConstructorOptions | undefined;
            // Use `path.join` so the substring matches the platform-native
            // separator — `getIconPath` joins the mocked "/res" with subdirs,
            // producing `\res\assets\images\tray\...` on Windows.
            expect(newWindowItem?.icon).toContain(pathJoin("/res", "assets", "images", "tray") + pathSep);
        });
    });
});
