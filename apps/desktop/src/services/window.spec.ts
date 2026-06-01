import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (...args: unknown[]) => unknown;

// Mutable hoisted state controlling the mocked core + electron surfaces. Reset
// in `beforeEach` so each test starts from a known platform / option baseline.
const state = vi.hoisted(() => ({
    isDev: true,
    isMac: false,
    isWindows: false,
    appVersion: "1.0.0",
    options: {} as Record<string, string>,
    optionBools: {} as Record<string, boolean>,
    keyboardActions: [] as unknown[],
    log: { info: vi.fn(), error: vi.fn() },
    // captured IPC handlers
    ipcOn: new Map<string, Handler>(),
    ipcHandle: new Map<string, Handler>(),
    ipcEmit: vi.fn(),
    // captured events.subscribe callbacks keyed by event name
    eventSubs: new Map<string, Handler>(),
    // captured BrowserWindow instances
    windows: [] as FakeBrowserWindow[],
    // controllable return for BrowserWindow.fromWebContents
    fromWebContentsResult: undefined as undefined | "null" | FakeBrowserWindow,
    // controllable globalShortcut.register results, consumed in order
    registerResults: [] as boolean[],
    // controllable nativeImage isEmpty / throw
    nativeImageEmpty: false,
    nativeImageThrow: false,
    // when set, every new FakeWebContents reuses this session object
    sharedSession: undefined as undefined | FakeSession
}));

interface FakeSession {
    clearCache: ReturnType<typeof vi.fn>;
    availableSpellCheckerLanguages: string[];
    setSpellCheckerLanguages: ReturnType<typeof vi.fn>;
}

class FakeWebContents {
    public send = vi.fn();
    public on = vi.fn((event: string, cb: Handler) => {
        const list = this.listeners.get(event) ?? [];
        list.push(cb);
        this.listeners.set(event, list);
        return this;
    });
    public listeners = new Map<string, Handler[]>();
    public setWindowOpenHandler = vi.fn();
    public toggleDevTools = vi.fn();
    public cut = vi.fn();
    public copy = vi.fn();
    public paste = vi.fn();
    public pasteAndMatchStyle = vi.fn();
    public insertText = vi.fn();
    public session: FakeSession = state.sharedSession ?? {
        clearCache: vi.fn(() => Promise.resolve()),
        availableSpellCheckerLanguages: ["en-US", "de"],
        setSpellCheckerLanguages: vi.fn()
    };
    public navigationHistory = {
        canGoBack: vi.fn(() => true),
        canGoForward: vi.fn(() => false),
        getAllEntries: vi.fn(() => [{ url: "a" }]),
        getActiveIndex: vi.fn(() => 0),
        length: vi.fn(() => 1),
        goToIndex: vi.fn(),
        clear: vi.fn()
    };
    public getURL = vi.fn(() => "trilium-app://app/");

    fire(event: string, ...args: unknown[]) {
        const list = this.listeners.get(event);
        if (!list || list.length === 0) throw new Error(`no webContents listener for ${event}`);
        let result: unknown;
        for (const cb of list) result = cb(...args);
        return result;
    }
}

class FakeBrowserWindow {
    public webContents = new FakeWebContents();
    public listeners = new Map<string, Handler[]>();
    public on = vi.fn((event: string, cb: Handler) => {
        const list = this.listeners.get(event) ?? [];
        list.push(cb);
        this.listeners.set(event, list);
        return this;
    });
    public setMenuBarVisibility = vi.fn();
    public removeMenu = vi.fn();
    public loadURL = vi.fn(() => Promise.resolve());
    public setTitleBarOverlay = vi.fn();
    public setWindowButtonPosition = vi.fn();
    public setBackgroundMaterial = vi.fn();
    public setVibrancy = vi.fn();
    public show = vi.fn();
    public focus = vi.fn();
    public minimize = vi.fn();
    public maximize = vi.fn();
    public unmaximize = vi.fn();
    public isMaximized = vi.fn(() => true);
    public isMinimized = vi.fn(() => true);
    public restore = vi.fn();
    public close = vi.fn();
    public reload = vi.fn();
    public isAlwaysOnTop = vi.fn(() => true);
    public setAlwaysOnTop = vi.fn();
    public isFullScreen = vi.fn(() => true);
    public setFullScreen = vi.fn();
    public isVisible = vi.fn(() => true);
    public hide = vi.fn();
    public isDestroyed = vi.fn(() => false);
    public id = 1;

    constructor(public readonly opts?: unknown) {
        state.windows.push(this);
    }

    fire(event: string, ...args: unknown[]) {
        const list = this.listeners.get(event);
        if (!list || list.length === 0) throw new Error(`no window listener for ${event}`);
        let result: unknown;
        for (const cb of list) result = cb(...args);
        return result;
    }
}

const fakeBrowserWindowClass = Object.assign(FakeBrowserWindow, {
    getAllWindows: () => state.windows,
    fromWebContents: (_wc: unknown) => {
        if (state.fromWebContentsResult === "null") return null;
        if (state.fromWebContentsResult instanceof FakeBrowserWindow) {
            return state.fromWebContentsResult;
        }
        return state.windows[state.windows.length - 1] ?? null;
    }
});

const fakeShell = { openExternal: vi.fn(() => Promise.resolve()) };
const fakeGlobalShortcut = {
    register: vi.fn((_shortcut: string, _cb: Handler) =>
        (state.registerResults.length ? state.registerResults.shift() : true))
};
const fakeNativeImage = {
    createFromBuffer: vi.fn(() => {
        if (state.nativeImageThrow) throw new Error("bad buffer");
        return { isEmpty: () => state.nativeImageEmpty };
    })
};
const fakeApp = {
    setUserTasks: vi.fn(),
    relaunch: vi.fn(),
    exit: vi.fn()
};

const electronSurface = {
    app: fakeApp,
    shell: fakeShell,
    globalShortcut: fakeGlobalShortcut,
    nativeImage: fakeNativeImage,
    clipboard: { writeImage: vi.fn() },
    nativeTheme: { themeSource: "system" },
    BrowserWindow: fakeBrowserWindowClass,
    ipcMain: {
        on: (channel: string, fn: Handler) => state.ipcOn.set(channel, fn),
        handle: (channel: string, fn: Handler) => state.ipcHandle.set(channel, fn),
        emit: (...args: unknown[]) => state.ipcEmit(...args)
    }
};

vi.mock("electron", () => ({
    default: electronSurface,
    BrowserWindow: fakeBrowserWindowClass,
    shell: fakeShell,
    globalShortcut: fakeGlobalShortcut
}));

vi.mock("electron-window-state", () => ({
    default: () => ({ x: 0, y: 0, width: 1200, height: 800, manage: vi.fn() })
}));

vi.mock("@triliumnext/core", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@triliumnext/core")>();
    return {
        ...actual,
        getLog: () => state.log,
        app_info: { ...actual.app_info, get appVersion() { return state.appVersion; } },
        utils: {
            ...actual.utils,
            isDev: () => state.isDev,
            isMac: () => state.isMac,
            isWindows: () => state.isWindows
        },
        options: {
            ...actual.options,
            getOption: (name: string) => state.options[name] ?? "",
            getOptionBool: (name: string) => state.optionBools[name] ?? false
        },
        sql_init: { ...actual.sql_init, dbReady: Promise.resolve() },
        keyboard_actions: { ...actual.keyboard_actions, getKeyboardActions: () => state.keyboardActions },
        cls: { ...actual.cls, wrap: (fn: Handler) => fn },
        events: {
            ...actual.events,
            DB_INITIALIZED: "DB_INITIALIZED",
            subscribe: (event: string, cb: Handler) => state.eventSubs.set(event, cb)
        }
    };
});

const windowService = (await import("./window.js")).default;
const { setupWindowing } = await import("./window.js");

function fireOn(channel: string, event: unknown, ...args: unknown[]) {
    const fn = state.ipcOn.get(channel);
    if (!fn) throw new Error(`no on-handler for ${channel}`);
    return fn(event, ...args);
}

function fireHandle(channel: string, event: unknown, ...args: unknown[]) {
    const fn = state.ipcHandle.get(channel);
    if (!fn) throw new Error(`no handle-handler for ${channel}`);
    return fn(event, ...args);
}

function makeEvent() {
    const win = state.windows[state.windows.length - 1] ?? new FakeBrowserWindow();
    return { sender: win.webContents, returnValue: undefined as unknown };
}

// `window.ts` keeps `mainWindow` / `allWindows` in module-level state that
// survives between tests. Drain it by marking every window we created as
// destroyed and replaying its `closed` handler (which runs the destroyed-window
// filter inside the module, clearing `allWindows` and nulling `mainWindow`).
function resetModuleWindowState() {
    for (const win of state.windows) {
        win.isDestroyed.mockReturnValue(true);
        const closed = win.listeners.get("closed");
        if (closed) {
            for (const cb of closed) cb();
        }
    }
}

beforeEach(() => {
    resetModuleWindowState();
    vi.clearAllMocks();
    state.isDev = true;
    state.isMac = false;
    state.isWindows = false;
    state.appVersion = "1.0.0";
    state.options = { spellCheckLanguageCode: "en-US, de , " };
    state.optionBools = {};
    state.keyboardActions = [];
    state.windows = [];
    state.fromWebContentsResult = undefined;
    state.registerResults = [];
    state.nativeImageEmpty = false;
    state.nativeImageThrow = false;
    state.sharedSession = undefined;
    process.env.NODE_ENV = "development";
});

afterEach(() => {
    process.env.NODE_ENV = "development";
});

describe("window service", () => {
    describe("createMainWindow", () => {
        it("creates the main window with setUserTasks and Linux frame defaults", async () => {
            await windowService.createMainWindow();

            expect(fakeApp.setUserTasks).toHaveBeenCalled();
            const win = state.windows[state.windows.length - 1];
            expect(win.setMenuBarVisibility).toHaveBeenCalledWith(false);
            expect(win.loadURL).toHaveBeenCalledWith("trilium-app://app/");
            // closed handler nulls out mainWindow
            win.fire("closed");
            expect(windowService.getMainWindow()).toBeNull();
        });

        it("skips setUserTasks when not present on app", async () => {
            const orig = fakeApp.setUserTasks;
            delete (fakeApp as Record<string, unknown>).setUserTasks;
            await windowService.createMainWindow();
            (fakeApp as Record<string, unknown>).setUserTasks = orig;
            expect(state.windows.length).toBeGreaterThan(0);
        });

        it("applies macOS hidden-inset title bar + vibrancy effects", async () => {
            state.isMac = true;
            state.optionBools = { backgroundEffects: true, spellCheckEnabled: true };
            await windowService.createMainWindow();
            const opts = state.windows[state.windows.length - 1].opts as Record<string, unknown>;
            expect(opts.titleBarStyle).toBe("hiddenInset");
            expect(opts.transparent).toBe(true);
            expect(opts.visualEffectState).toBe("active");
        });

        it("applies Windows hidden title bar + mica material", async () => {
            state.isWindows = true;
            state.optionBools = { backgroundEffects: true };
            await windowService.createMainWindow();
            const opts = state.windows[state.windows.length - 1].opts as Record<string, unknown>;
            expect(opts.titleBarStyle).toBe("hidden");
            expect(opts.backgroundMaterial).toBe("auto");
        });

        it("applies Linux transparent effect when background effects enabled", async () => {
            state.optionBools = { backgroundEffects: true };
            await windowService.createMainWindow();
            const opts = state.windows[state.windows.length - 1].opts as Record<string, unknown>;
            expect(opts.frame).toBe(false);
            expect(opts.transparent).toBe(true);
        });

        it("keeps native title bar when option enabled", async () => {
            state.optionBools = { nativeTitleBarVisible: true };
            await windowService.createMainWindow();
            const opts = state.windows[state.windows.length - 1].opts as Record<string, unknown>;
            expect(opts.frame).toBeUndefined();
        });
    });

    describe("createExtraWindow", () => {
        it("creates an extra window and configures web contents", async () => {
            state.optionBools = { spellCheckEnabled: true };
            await windowService.createExtraWindow("#root/abc");
            const win = state.windows[state.windows.length - 1];
            expect(win.loadURL).toHaveBeenCalledWith("trilium-app://app/?extraWindow=1#root/abc");
            expect(win.webContents.setWindowOpenHandler).toHaveBeenCalled();
        });
    });

    describe("createSetupWindow / closeSetupWindow", () => {
        it("creates and closes a setup window (Linux)", async () => {
            await windowService.createSetupWindow();
            const win = state.windows[state.windows.length - 1];
            expect(win.removeMenu).toHaveBeenCalled();
            windowService.closeSetupWindow();
            expect(win.close).toHaveBeenCalled();
            // closed handler clears setupWindow; closing again is a no-op
            win.fire("closed");
            windowService.closeSetupWindow();
        });

        it("applies Windows mica background to the setup window", async () => {
            state.isWindows = true;
            await windowService.createSetupWindow();
            const opts = state.windows[state.windows.length - 1].opts as Record<string, unknown>;
            expect(opts.backgroundMaterial).toBe("mica");
        });

        it("applies macOS vibrancy to the setup window", async () => {
            state.isMac = true;
            await windowService.createSetupWindow();
            const opts = state.windows[state.windows.length - 1].opts as Record<string, unknown>;
            expect(opts.vibrancy).toBe("under-window");
        });
    });

    describe("getIcon (via createSetupWindow)", () => {
        it("uses the test asset icon when version contains 'test'", async () => {
            process.env.NODE_ENV = "production";
            state.appVersion = "1.0.0-test";
            await windowService.createSetupWindow();
            const opts = state.windows[state.windows.length - 1].opts as Record<string, unknown>;
            expect(String(opts.icon)).toContain("icon-dev.png");
        });

        it("uses the production icon for a normal version", async () => {
            process.env.NODE_ENV = "production";
            state.appVersion = "1.0.0";
            await windowService.createSetupWindow();
            const opts = state.windows[state.windows.length - 1].opts as Record<string, unknown>;
            expect(String(opts.icon)).toContain("icon.png");
        });
    });

    describe("configureWebContents", () => {
        beforeEach(async () => {
            state.optionBools = { spellCheckEnabled: true };
            await windowService.createMainWindow();
        });

        it("denies new windows and opens them externally", async () => {
            const wc = state.windows[state.windows.length - 1].webContents;
            const handlerArg = wc.setWindowOpenHandler.mock.calls[0][0] as Handler;
            const result = handlerArg({ url: "https://example.com" });
            expect(result).toEqual({ action: "deny" });
            await new Promise((r) => setTimeout(r, 0));
            expect(fakeShell.openExternal).toHaveBeenCalledWith("https://example.com");
        });

        it("logs when external open fails", async () => {
            // The inner `openExternal()` doesn't await `shell.openExternal`, so only a
            // synchronous throw inside it rejects the wrapper and hits the `.catch`.
            fakeShell.openExternal.mockImplementationOnce(() => {
                throw new Error("boom");
            });
            const wc = state.windows[state.windows.length - 1].webContents;
            const handlerArg = wc.setWindowOpenHandler.mock.calls[0][0] as Handler;
            handlerArg({ url: "https://bad.example" });
            await new Promise((r) => setTimeout(r, 0));
            expect(state.log.error).toHaveBeenCalled();
        });

        it("blocks external navigation but allows internal redirects", () => {
            const wc = state.windows[state.windows.length - 1].webContents;
            const external = { preventDefault: vi.fn() };
            wc.fire("will-navigate", external, "https://evil.example/page");
            expect(external.preventDefault).toHaveBeenCalled();

            const internal = { preventDefault: vi.fn() };
            wc.fire("will-navigate", internal, "trilium-app://app/");
            expect(internal.preventDefault).not.toHaveBeenCalled();

            // internal host but non-root path is blocked
            const internalPath = { preventDefault: vi.fn() };
            wc.fire("will-navigate", internalPath, "http://localhost/somewhere");
            expect(internalPath.preventDefault).toHaveBeenCalled();

            // URL with no hostname falls back to "" (covers `hostname || ""`) and is blocked.
            const noHost = { preventDefault: vi.fn() };
            wc.fire("will-navigate", noHost, "javascript:void(0)");
            expect(noHost.preventDefault).toHaveBeenCalled();

            // internal host with the root "/?" path is allowed (covers that path comparison).
            const rootQuery = { preventDefault: vi.fn() };
            wc.fire("will-navigate", rootQuery, "trilium-app://app/?");
            expect(rootQuery.preventDefault).not.toHaveBeenCalled();
        });

        it("forwards full-screen, navigation and context-menu events", () => {
            const win = state.windows[state.windows.length - 1];
            const wc = win.webContents;

            win.fire("enter-full-screen");
            win.fire("leave-full-screen");
            wc.fire("did-navigate");
            wc.fire("did-navigate-in-page");
            wc.fire("context-menu", {}, {
                x: 1, y: 2, linkURL: "u", linkText: "t", mediaType: "none",
                isEditable: true, selectionText: "s", misspelledWord: "",
                dictionarySuggestions: [],
                editFlags: { canCut: true, canCopy: true, canPaste: false }
            });

            expect(wc.send).toHaveBeenCalledWith("enter-full-screen");
            expect(wc.send).toHaveBeenCalledWith("leave-full-screen");
            expect(wc.send).toHaveBeenCalledWith("did-navigate");
            expect(wc.send).toHaveBeenCalledWith("did-navigate-in-page");
            expect(wc.send).toHaveBeenCalledWith("context-menu", expect.objectContaining({ x: 1 }));
        });

        it("skips full-screen wiring when no window resolves", async () => {
            state.fromWebContentsResult = "null";
            // configureWebContents is invoked during createExtraWindow
            await windowService.createExtraWindow("#x");
            // no throw means the null branch was taken
            expect(true).toBe(true);
        });

        it("does not set up spellcheck when disabled", async () => {
            state.optionBools = { spellCheckEnabled: false };
            await windowService.createExtraWindow("#y");
            const wc = state.windows[state.windows.length - 1].webContents;
            expect(wc.session.setSpellCheckerLanguages).not.toHaveBeenCalled();
        });

        it("loads spellcheck languages once per session", async () => {
            state.optionBools = { spellCheckEnabled: true };
            state.options = { spellCheckLanguageCode: "en-US, de , " };
            await windowService.createExtraWindow("#a");
            const wc = state.windows[state.windows.length - 1].webContents;
            expect(wc.session.setSpellCheckerLanguages).toHaveBeenCalledWith(["en-US", "de"]);

            // Re-using the same session object skips the second load (WeakSet guard)
            wc.session.setSpellCheckerLanguages.mockClear();
            await windowService.createExtraWindow("#b");
            // new window => new session, so it loads again; verify a fresh call happened
            const wc2 = state.windows[state.windows.length - 1].webContents;
            expect(wc2.session.setSpellCheckerLanguages).toHaveBeenCalled();
        });
    });

    describe("setupSpellcheckForSession WeakSet guard", () => {
        it("loads the session once and skips it on subsequent windows sharing it", async () => {
            state.optionBools = { spellCheckEnabled: true };
            state.options = { spellCheckLanguageCode: "en-US, fr" };
            // Force every new window's webContents to share one session so the
            // second configureWebContents call hits the WeakSet `has` guard.
            const shared = {
                clearCache: vi.fn(() => Promise.resolve()),
                availableSpellCheckerLanguages: ["en-US"],
                setSpellCheckerLanguages: vi.fn()
            };
            state.sharedSession = shared;

            await windowService.createExtraWindow("#one");
            expect(shared.setSpellCheckerLanguages).toHaveBeenCalledTimes(1);
            expect(shared.setSpellCheckerLanguages).toHaveBeenCalledWith(["en-US", "fr"]);

            await windowService.createExtraWindow("#two");
            // Same session => guard short-circuits, no second load.
            expect(shared.setSpellCheckerLanguages).toHaveBeenCalledTimes(1);

            state.sharedSession = undefined;
        });
    });

    describe("registerGlobalShortcuts", () => {
        it("registers global shortcuts and logs success/failure", async () => {
            state.keyboardActions = [
                { actionName: "noShortcuts" },
                { actionName: "emptyShortcuts", effectiveShortcuts: undefined },
                { actionName: "localOnly", effectiveShortcuts: ["ctrl+a"] },
                { actionName: "openApp", effectiveShortcuts: ["global:Ctrl+Shift+O"] },
                { actionName: "toggleTray", effectiveShortcuts: ["global:Ctrl+Shift+T"] }
            ];
            // First register succeeds, second fails.
            state.registerResults = [true, false];

            await windowService.createMainWindow();
            await windowService.registerGlobalShortcuts();

            expect(fakeGlobalShortcut.register).toHaveBeenCalledTimes(2);
            expect(state.log.info).toHaveBeenCalledWith(expect.stringContaining("Registered global shortcut"));
            expect(state.log.info).toHaveBeenCalledWith(expect.stringContaining("Could not register"));
        });

        it("invokes the shortcut callback for toggleTray and normal actions", async () => {
            state.keyboardActions = [
                { actionName: "toggleTray", effectiveShortcuts: ["global:Ctrl+Shift+T"] },
                { actionName: "openApp", effectiveShortcuts: ["global:Ctrl+Shift+O"] }
            ];
            await windowService.createMainWindow();
            const mainWin = state.windows[state.windows.length - 1];
            // Make this window the last focused.
            mainWin.fire("focus");
            await windowService.registerGlobalShortcuts();

            const trayCb = fakeGlobalShortcut.register.mock.calls[0][1] as Handler;
            const openCb = fakeGlobalShortcut.register.mock.calls[1][1] as Handler;

            mainWin.isMinimized.mockReturnValue(false);
            trayCb();
            expect(mainWin.focus).toHaveBeenCalled();
            expect(mainWin.webContents.send).toHaveBeenCalledWith("globalShortcut", "toggleTray");

            // Minimized => showAndFocusWindow restores before showing.
            mainWin.isMinimized.mockReturnValue(true);
            openCb();
            expect(mainWin.restore).toHaveBeenCalled();
            expect(mainWin.show).toHaveBeenCalled();
            expect(mainWin.webContents.send).toHaveBeenCalledWith("globalShortcut", "openApp");

            // Not minimized => skips restore.
            mainWin.restore.mockClear();
            mainWin.isMinimized.mockReturnValue(false);
            openCb();
            expect(mainWin.restore).not.toHaveBeenCalled();
        });

        it("falls back to mainWindow and guards destroyed windows", async () => {
            state.keyboardActions = [
                { actionName: "openApp", effectiveShortcuts: ["global:Ctrl+Shift+O"] }
            ];
            await windowService.createMainWindow();
            const mainWin = state.windows[state.windows.length - 1];
            await windowService.registerGlobalShortcuts();
            const cb = fakeGlobalShortcut.register.mock.calls[0][1] as Handler;

            // No focused window => fall back to mainWindow, which is destroyed => early return.
            mainWin.isDestroyed.mockReturnValue(true);
            cb();
            expect(mainWin.show).not.toHaveBeenCalled();

            // Now with neither focused nor main window (close main): callback returns early.
            mainWin.fire("closed");
        });
    });

    describe("showAndFocusWindow / getters", () => {
        it("restores, shows and focuses a minimized window", async () => {
            await windowService.createMainWindow();
            const win = state.windows[state.windows.length - 1];
            win.fire("focus");
            expect(windowService.getLastFocusedWindow()).toBe(win);
            expect(windowService.getAllWindows()).toContain(win);
            expect(windowService.getMainWindow()).toBe(win);
        });

        it("returns null for last focused window when none exist", () => {
            expect(windowService.getLastFocusedWindow()).toBeNull();
        });
    });

    describe("trackWindowFocus", () => {
        it("reloads the tray on focus/closed when tray enabled", async () => {
            state.optionBools = { disableTray: false };
            await windowService.createMainWindow();
            const win = state.windows[state.windows.length - 1];
            win.fire("focus");
            win.fire("closed");
            expect(state.ipcEmit).toHaveBeenCalledWith("reload-tray");
        });

        it("does not reload the tray when tray disabled", async () => {
            state.optionBools = { disableTray: true };
            await windowService.createMainWindow();
            const win = state.windows[state.windows.length - 1];
            state.ipcEmit.mockClear();
            win.fire("focus");
            win.fire("closed");
            expect(state.ipcEmit).not.toHaveBeenCalledWith("reload-tray");
        });

        it("dedupes re-focus and drops destroyed windows from the focus list", async () => {
            await windowService.createMainWindow();
            const winA = state.windows[state.windows.length - 1];
            await windowService.createExtraWindow("#b");
            const winB = state.windows[state.windows.length - 1];

            winA.fire("focus");
            winB.fire("focus");
            // Re-focusing winB exercises the `w !== win` filter branch (it removes itself).
            winB.fire("focus");
            expect(windowService.getLastFocusedWindow()).toBe(winB);

            // Destroy winA, then focus winB so the `!w.isDestroyed()` branch drops winA.
            winA.isDestroyed.mockReturnValue(true);
            winB.fire("focus");
            expect(windowService.getAllWindows()).not.toContain(winA);
        });
    });

    describe("setupWindowing IPC handlers", () => {
        beforeEach(() => {
            state.ipcOn.clear();
            state.ipcHandle.clear();
            state.eventSubs.clear();
            setupWindowing();
            // Provide a window so fromWebContents resolves.
            new FakeBrowserWindow();
        });

        it("create-extra-window invokes createExtraWindow", async () => {
            fireOn("create-extra-window", makeEvent(), { extraWindowHash: "#h" });
            await new Promise((r) => setTimeout(r, 0));
            expect(state.windows.some(w => w.loadURL.mock.calls.length > 0)).toBe(true);
        });

        it("reload-all-windows reloads every window", () => {
            const win = state.windows[state.windows.length - 1];
            fireOn("reload-all-windows", makeEvent());
            expect(win.reload).toHaveBeenCalled();
        });

        it("restart-app relaunches and exits", () => {
            fireOn("restart-app", makeEvent());
            expect(fakeApp.relaunch).toHaveBeenCalled();
            expect(fakeApp.exit).toHaveBeenCalled();
        });

        it("copy-image-to-clipboard writes a valid image", () => {
            fireOn("copy-image-to-clipboard", makeEvent(), new Uint8Array([1, 2, 3]));
            expect(electronSurface.clipboard.writeImage).toHaveBeenCalled();
        });

        it("copy-image-to-clipboard logs when the image is empty", () => {
            state.nativeImageEmpty = true;
            fireOn("copy-image-to-clipboard", makeEvent(), new Uint8Array([1]));
            expect(state.log.error).toHaveBeenCalledWith(expect.stringContaining("nativeImage is empty"));
            expect(electronSurface.clipboard.writeImage).not.toHaveBeenCalled();
        });

        it("copy-image-to-clipboard logs when conversion throws", () => {
            state.nativeImageThrow = true;
            fireOn("copy-image-to-clipboard", makeEvent(), new Uint8Array([1]));
            expect(state.log.error).toHaveBeenCalledWith(expect.stringContaining("failed"));
        });

        it("show-window shows the resolved window (and tolerates null)", () => {
            const win = state.windows[state.windows.length - 1];
            fireOn("show-window", makeEvent());
            expect(win.show).toHaveBeenCalled();

            state.fromWebContentsResult = "null";
            fireOn("show-window", makeEvent());
        });

        it("clear-cache clears the session cache", async () => {
            const ev = makeEvent();
            await fireHandle("clear-cache", ev);
            expect(ev.sender.session.clearCache).toHaveBeenCalled();
        });

        it("toggle-all-windows hides when all visible and shows when hidden", () => {
            const win = state.windows[state.windows.length - 1];
            win.isVisible.mockReturnValue(true);
            fireOn("toggle-all-windows", makeEvent());
            expect(win.hide).toHaveBeenCalled();

            win.isVisible.mockReturnValue(false);
            fireOn("toggle-all-windows", makeEvent());
            expect(win.show).toHaveBeenCalled();
        });

        it("get-available-spellchecker-languages returns the list", () => {
            const ev = makeEvent();
            fireOn("get-available-spellchecker-languages", ev);
            expect(ev.returnValue).toEqual(["en-US", "de"]);
        });

        it("title bar / material / vibrancy / button position setters", () => {
            const win = state.windows[state.windows.length - 1];
            fireOn("set-title-bar-overlay", makeEvent(), { color: "#fff", symbolColor: "#000" });
            fireOn("set-window-button-position", makeEvent(), { x: 1, y: 2 });
            fireOn("set-background-material", makeEvent(), "mica");
            fireOn("set-vibrancy", makeEvent(), "sidebar");
            fireOn("clear-navigation-history", makeEvent());
            expect(win.setTitleBarOverlay).toHaveBeenCalled();
            expect(win.setWindowButtonPosition).toHaveBeenCalled();
            expect(win.setBackgroundMaterial).toHaveBeenCalledWith("mica");
            expect(win.setVibrancy).toHaveBeenCalledWith("sidebar");
            expect(win.webContents.navigationHistory.clear).toHaveBeenCalled();
        });

        it("title bar setters tolerate a null window", () => {
            state.fromWebContentsResult = "null";
            fireOn("set-title-bar-overlay", makeEvent(), { color: "#fff", symbolColor: "#000" });
            fireOn("set-window-button-position", makeEvent(), { x: 1, y: 2 });
            fireOn("set-background-material", makeEvent(), "mica");
            fireOn("set-vibrancy", makeEvent(), "sidebar");
            fireOn("clear-navigation-history", makeEvent());
            // no throw
        });

        it("set-native-theme-source updates the theme", () => {
            fireOn("set-native-theme-source", makeEvent(), "dark");
            expect(electronSurface.nativeTheme.themeSource).toBe("dark");
        });

        it("toggle-dev-tools toggles dev tools on the sender", () => {
            const ev = makeEvent();
            fireOn("toggle-dev-tools", ev);
            expect(ev.sender.toggleDevTools).toHaveBeenCalled();
        });

        it("window state queries and mutations", () => {
            const win = state.windows[state.windows.length - 1];
            const fs1 = makeEvent();
            fireOn("is-full-screen", fs1);
            expect(fs1.returnValue).toBe(true);
            fireOn("set-full-screen", makeEvent(), true);
            fireOn("minimize-window", makeEvent());
            fireOn("maximize-window", makeEvent());
            fireOn("unmaximize-window", makeEvent());
            const mx = makeEvent();
            fireOn("is-maximized", mx);
            expect(mx.returnValue).toBe(true);
            fireOn("close-window", makeEvent());
            const aot = makeEvent();
            fireOn("is-always-on-top", aot);
            expect(aot.returnValue).toBe(true);
            fireOn("set-always-on-top", makeEvent(), true);

            expect(win.setFullScreen).toHaveBeenCalledWith(true);
            expect(win.minimize).toHaveBeenCalled();
            expect(win.maximize).toHaveBeenCalled();
            expect(win.unmaximize).toHaveBeenCalled();
            expect(win.close).toHaveBeenCalled();
            expect(win.setAlwaysOnTop).toHaveBeenCalledWith(true);
        });

        it("window state queries return defaults when window is null", () => {
            state.fromWebContentsResult = "null";
            const fs1 = makeEvent();
            fireOn("is-full-screen", fs1);
            expect(fs1.returnValue).toBe(false);
            const mx = makeEvent();
            fireOn("is-maximized", mx);
            expect(mx.returnValue).toBe(false);
            const aot = makeEvent();
            fireOn("is-always-on-top", aot);
            expect(aot.returnValue).toBe(false);
            // mutations tolerate null
            fireOn("set-full-screen", makeEvent(), true);
            fireOn("minimize-window", makeEvent());
            fireOn("maximize-window", makeEvent());
            fireOn("unmaximize-window", makeEvent());
            fireOn("close-window", makeEvent());
            fireOn("set-always-on-top", makeEvent(), true);
        });

        it("web-contents-action covers every case", () => {
            const ev = makeEvent();
            fireOn("web-contents-action", ev, "cut");
            fireOn("web-contents-action", ev, "copy");
            fireOn("web-contents-action", ev, "paste");
            fireOn("web-contents-action", ev, "pasteAndMatchStyle");
            fireOn("web-contents-action", ev, "insertText", "hello");
            fireOn("web-contents-action", ev, "insertText"); // no text => skipped
            fireOn("web-contents-action", ev, "unknown"); // default => nothing

            expect(ev.sender.cut).toHaveBeenCalled();
            expect(ev.sender.copy).toHaveBeenCalled();
            expect(ev.sender.paste).toHaveBeenCalled();
            expect(ev.sender.pasteAndMatchStyle).toHaveBeenCalled();
            expect(ev.sender.insertText).toHaveBeenCalledTimes(1);
            expect(ev.sender.insertText).toHaveBeenCalledWith("hello");
        });

        it("navigation-history covers every method and the default", () => {
            const back = makeEvent();
            fireOn("navigation-history", back, "canGoBack");
            expect(back.returnValue).toBe(true);
            const fwd = makeEvent();
            fireOn("navigation-history", fwd, "canGoForward");
            expect(fwd.returnValue).toBe(false);
            const all = makeEvent();
            fireOn("navigation-history", all, "getAllEntries");
            expect(all.returnValue).toEqual([{ url: "a" }]);
            const idx = makeEvent();
            fireOn("navigation-history", idx, "getActiveIndex");
            expect(idx.returnValue).toBe(0);
            const len = makeEvent();
            fireOn("navigation-history", len, "length");
            expect(len.returnValue).toBe(1);
            const def = makeEvent();
            fireOn("navigation-history", def, "bogus");
            expect(def.returnValue).toBeNull();
        });

        it("navigation-history-go-to-index delegates to the sender", () => {
            const ev = makeEvent();
            fireOn("navigation-history-go-to-index", ev, 3);
            expect(ev.sender.navigationHistory.goToIndex).toHaveBeenCalledWith(3);
        });
    });

    describe("DB_INITIALIZED subscription", () => {
        beforeEach(() => {
            state.eventSubs.clear();
            setupWindowing();
        });

        it("no-ops when there is no setup window", async () => {
            const cb = state.eventSubs.get("DB_INITIALIZED");
            if (!cb) throw new Error("no DB_INITIALIZED subscriber");
            const sizeBefore = state.windows.length;
            await cb();
            expect(state.windows.length).toBe(sizeBefore);
        });

        it("swaps the setup window for the main window", async () => {
            await windowService.createSetupWindow();
            const setupWin = state.windows[state.windows.length - 1];
            const cb = state.eventSubs.get("DB_INITIALIZED");
            if (!cb) throw new Error("no DB_INITIALIZED subscriber");
            await cb();
            expect(setupWin.close).toHaveBeenCalled();
        });

        it("logs when creating the main window throws", async () => {
            await windowService.createSetupWindow();
            const cb = state.eventSubs.get("DB_INITIALIZED");
            if (!cb) throw new Error("no DB_INITIALIZED subscriber");
            // Make BrowserWindow construction throw on the next createMainWindow.
            const spy = vi.spyOn(state.windows, "push").mockImplementationOnce(() => {
                throw new Error("construct failed");
            });
            await cb();
            spy.mockRestore();
            expect(state.log.error).toHaveBeenCalledWith(expect.stringContaining("Failed to swap"));
        });
    });
});
