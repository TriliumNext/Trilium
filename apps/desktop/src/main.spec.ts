import { join as pathJoin } from "node:path";

import BetterSqlite3Provider from "@triliumnext/server/src/sql_provider.js";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (...args: unknown[]) => unknown;

interface FakeWindow {
    isMinimized: () => boolean;
    restore: () => void;
    show: () => void;
    focus: () => void;
}

interface SecuritySettings {
    backendScriptingEnabled?: boolean;
    sqlConsoleEnabled?: boolean;
    allowLanAccess?: boolean;
}

// A tiny real deferred so the core/server init promises behave like the real thing.
function makeDeferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    }) as Promise<T> & { resolve: typeof resolve; reject: typeof reject };
    promise.resolve = resolve;
    promise.reject = reject;
    return promise;
}

const h = vi.hoisted(() => ({
    // Captured app.on(...) handlers.
    appOn: new Map<string, Handler>(),
    // Captured ipcMain.on / ipcMain.handle registrations.
    ipcOn: new Map<string, Handler>(),
    ipcHandle: new Map<string, Handler>(),
    // Captured stdout/stderr "error" handlers.
    streamErrorHandlers: [] as Handler[],
    // Captured commandLine.appendSwitch calls.
    appendSwitch: vi.fn(),
    onBeforeSendHeaders: vi.fn(),
    setName: vi.fn(),
    quit: vi.fn(),
    exit: vi.fn(),
    relaunch: vi.fn(),
    setPath: vi.fn(),
    setUserTasks: vi.fn(),
    // Controllable values.
    squirrel: { default: false as boolean },
    isPrimaryInstance: true as boolean,
    allWindows: [] as unknown[],
    smoothScroll: "true" as string | null,
    // When true, reading an option throws (simulates first run before the schema exists).
    dbUninitialized: false as boolean,
    isDbInitialized: true as boolean,
    securitySettings: {} as SecuritySettings,
    lastFocusedWindow: null as FakeWindow | null,
    entityChangeIds: [] as string[],
    locale: null as string | null,
    formattingLocale: null as string | null,
    locales: [] as Array<{ id: string; rtl: boolean }>,
    // Capture the config object passed to initializeCore.
    initConfig: undefined as undefined | Record<string, unknown>,
    // Captured mocked fns we assert on.
    sendTransactionEntityChangesToAllClients: vi.fn(),
    beccaLoad: vi.fn(),
    recalculateMaxEntityChangeId: vi.fn(),
    banner: vi.fn(),
    createMainWindow: vi.fn((..._a: unknown[]) => Promise.resolve()),
    createSetupWindow: vi.fn((..._a: unknown[]) => Promise.resolve()),
    createExtraWindow: vi.fn((..._a: unknown[]) => {}),
    registerGlobalShortcuts: vi.fn((..._a: unknown[]) => Promise.resolve()),
    setupAutoLaunch: vi.fn(),
    applyLaunchOnStartup: vi.fn(),
    wasLaunchedHidden: vi.fn(() => false),
    disableTray: false,
    mainWindow: null as FakeWindow | null,
    unregisterAll: vi.fn(),
    // Controllable server start so tests can simulate a slow/hanging server.
    startServer: (() => Promise.resolve({})) as () => Promise<unknown>
}));

vi.mock("electron", () => {
    const appObj = {
        setPath: (...a: unknown[]) => h.setPath(...a),
        getPath: () => "/appData",
        getName: () => "Trilium",
        setName: (...a: unknown[]) => h.setName(...a),
        setUserTasks: (...a: unknown[]) => h.setUserTasks(...a),
        commandLine: { appendSwitch: (...a: unknown[]) => h.appendSwitch(...a) },
        on: (event: string, cb: Handler) => h.appOn.set(event, cb),
        quit: (...a: unknown[]) => h.quit(...a),
        exit: (...a: unknown[]) => h.exit(...a),
        relaunch: (...a: unknown[]) => h.relaunch(...a),
        requestSingleInstanceLock: () => h.isPrimaryInstance
    };
    const BrowserWindow = {
        getAllWindows: () => h.allWindows
    };
    const globalShortcut = {
        unregisterAll: (...a: unknown[]) => h.unregisterAll(...a)
    };
    const ipcMain = {
        on: (channel: string, fn: Handler) => h.ipcOn.set(channel, fn),
        handle: (channel: string, fn: Handler) => h.ipcHandle.set(channel, fn)
    };
    // onReady() installs the embed-Referer hook, whose default argument reads
    // `electron.session.defaultSession` (see services/embed_referer.ts).
    const session = {
        defaultSession: {
            webRequest: {
                onBeforeSendHeaders: (...a: unknown[]) => h.onBeforeSendHeaders(...a)
            }
        }
    };
    return {
        app: appObj,
        BrowserWindow,
        globalShortcut,
        ipcMain,
        session,
        default: { app: appObj, BrowserWindow, globalShortcut, ipcMain, session }
    };
});

vi.mock("electron-debug", () => ({ default: vi.fn() }));
vi.mock("electron-dl", () => ({ default: vi.fn() }));
vi.mock("electron-squirrel-startup", () => ({ get default() { return h.squirrel.default; } }));

vi.mock("fs", () => ({ default: { readFileSync: vi.fn(() => Buffer.from("zip")) } }));
vi.mock("i18next", () => ({ t: (key: string) => key }));

vi.mock("@triliumnext/core", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@triliumnext/core")>();
    return {
        ...actual,
        getLog: () => ({ info: vi.fn(), error: vi.fn(), banner: (...a: unknown[]) => h.banner(...a) }),
        initializeCore: vi.fn((config: Record<string, unknown>) => {
            h.initConfig = config;
            return Promise.resolve();
        }),
        options: {
            // NB: smoothScrollEnabled / locale / formattingLocale are deliberately NOT served
            // here — they are read before core init straight from the shared provider (see the
            // sql_provider mock), so getOptionOrNull() returns null for them, as in production.
            getOptionOrNull: () => null,
            getOptionBool: (key: string) => (key === "disableTray" ? h.disableTray : false)
        },
        sql_init: { isDbInitialized: () => h.isDbInitialized, dbReady: Promise.resolve() },
        ws: { sendTransactionEntityChangesToAllClients: (...a: unknown[]) => h.sendTransactionEntityChangesToAllClients(...a) },
        cls: { getAndClearEntityChangeIds: () => h.entityChangeIds },
        becca_loader: { load: (...a: unknown[]) => h.beccaLoad(...a) },
        entity_changes: { recalculateMaxEntityChangeId: (...a: unknown[]) => h.recalculateMaxEntityChangeId(...a) }
    };
});

// Control deferred + LOCALES precisely; keep everything else real from commons.
vi.mock("../../../packages/commons/src", async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return {
        ...actual,
        deferred: <T,>() => makeDeferred<T>(),
        get LOCALES() { return h.locales; }
    };
});

vi.mock("@triliumnext/server/src/backup_provider.js", () => ({ default: class {} }));
vi.mock("@triliumnext/server/src/cls_provider.js", () => ({ default: class {} }));
vi.mock("@triliumnext/server/src/core_assets.js", () => ({ loadCoreSchema: vi.fn(() => ({})) }));
vi.mock("@triliumnext/server/src/crypto_provider.js", () => ({ default: class {} }));
vi.mock("@triliumnext/server/src/in_app_help_provider.js", () => ({ default: class {} }));
vi.mock("@triliumnext/server/src/log_provider.js", () => ({ default: class {} }));
// readDbOption() reads the pre-`ready` switch options from this shared provider via
// prepare().pluck().get(name). Back it with the h.* option values, and let h.dbUninitialized
// simulate a first run where the schema (and so the options table) does not exist yet.
vi.mock("@triliumnext/server/src/sql_provider.js", () => ({
    default: class {
        loadFromFile = vi.fn();
        prepare() {
            if (h.dbUninitialized) throw new Error("no such table: options");
            const values: Record<string, string | null> = {
                smoothScrollEnabled: h.smoothScroll,
                locale: h.locale,
                formattingLocale: h.formattingLocale
            };
            return {
                pluck: () => ({
                    get: (name: string) => values[name] ?? undefined
                })
            };
        }
    }
}));
vi.mock("@triliumnext/server/src/zip_provider.js", () => ({ default: class {} }));

vi.mock("@triliumnext/server/src/services/data_dir.js", () => ({
    default: { TRILIUM_DATA_DIR: "/data", DOCUMENT_PATH: "/data/doc.db" }
}));
vi.mock("@triliumnext/server/src/services/port.js", () => ({ default: 37740 }));
vi.mock("@triliumnext/server/src/services/resource_dir.js", () => ({ RESOURCE_DIR: "/res" }));
vi.mock("@triliumnext/server/src/services/config.js", () => ({
    default: { Security: {}, General: { readOnly: false } }
}));
vi.mock("@triliumnext/server/src/services/export/zip/factory.js", () => ({ serverZipExportProviderFactory: vi.fn() }));
vi.mock("@triliumnext/server/src/services/i18n.js", () => ({ initializeTranslations: vi.fn() }));
vi.mock("@triliumnext/server/src/services/image_provider.js", () => ({ serverImageProvider: {} }));
vi.mock("@triliumnext/server/src/www.js", () => ({ default: vi.fn(() => h.startServer()) }));

vi.mock("./services/request", () => ({ default: class {} }));
vi.mock("./services/window", () => ({
    default: {
        getLastFocusedWindow: () => h.lastFocusedWindow,
        getMainWindow: () => h.mainWindow,
        createExtraWindow: (...a: unknown[]) => h.createExtraWindow(...a),
        createMainWindow: (...a: unknown[]) => h.createMainWindow(...a),
        createSetupWindow: (...a: unknown[]) => h.createSetupWindow(...a),
        registerGlobalShortcuts: (...a: unknown[]) => h.registerGlobalShortcuts(...a)
    },
    setupWindowing: vi.fn()
}));
vi.mock("./ipc_messaging_provider", () => ({ default: class { init = vi.fn(); } }));
vi.mock("./platform_provider", () => ({ default: class {} }));
vi.mock("./protocol", () => ({ registerTriliumAppScheme: vi.fn(), setupTriliumAppProtocol: vi.fn() }));
vi.mock("./services/custom_dictionary", () => ({ setupCustomDictionary: vi.fn() }));
vi.mock("./services/printing", () => ({ setupPrintingHandlers: vi.fn() }));
vi.mock("./services/tray", () => ({ setupSystemTray: vi.fn() }));
vi.mock("./services/auto_launch", () => ({
    setupAutoLaunch: (...a: unknown[]) => h.setupAutoLaunch(...a),
    applyLaunchOnStartup: (...a: unknown[]) => h.applyLaunchOnStartup(...a),
    wasLaunchedHidden: () => h.wasLaunchedHidden()
}));
vi.mock("./services/shell", () => ({ setupShellHandlers: vi.fn() }));
vi.mock("./services/onenote", () => ({ setupOneNoteHandlers: vi.fn() }));
vi.mock("./services/security_settings", () => ({
    getSecuritySettings: () => h.securitySettings,
    registerSecurityIpcHandlers: vi.fn()
}));
vi.mock("./services/startup_metrics", () => ({
    markStartupMetric: vi.fn(),
    setupStartupMetricsIpc: vi.fn()
}));

const realPlatform = process.platform;
function setPlatform(platform: NodeJS.Platform) {
    Object.defineProperty(process, "platform", { value: platform, configurable: true });
}

let exitSpy: ReturnType<typeof vi.spyOn>;
let stdoutOnSpy: ReturnType<typeof vi.spyOn>;
let stderrOnSpy: ReturnType<typeof vi.spyOn>;

function resetState() {
    h.appOn.clear();
    h.streamErrorHandlers.length = 0;
    h.appendSwitch.mockClear();
    h.setName.mockClear();
    h.quit.mockClear();
    h.exit.mockClear();
    h.setPath.mockClear();
    h.squirrel.default = false;
    h.isPrimaryInstance = true;
    h.allWindows = [];
    h.smoothScroll = "true";
    h.dbUninitialized = false;
    h.isDbInitialized = true;
    h.securitySettings = {};
    h.lastFocusedWindow = null;
    h.mainWindow = null;
    h.entityChangeIds = [];
    h.locale = null;
    h.formattingLocale = null;
    h.locales = [];
    h.initConfig = undefined;
    h.sendTransactionEntityChangesToAllClients.mockClear();
    h.beccaLoad.mockClear();
    h.recalculateMaxEntityChangeId.mockClear();
    h.banner.mockClear();
    h.createMainWindow.mockClear();
    h.createSetupWindow.mockClear();
    h.createExtraWindow.mockClear();
    h.registerGlobalShortcuts.mockClear();
    h.unregisterAll.mockClear();
    h.startServer = () => Promise.resolve({});
}

beforeEach(() => {
    process.env.TRILIUM_UNIT_TEST = "1";
    vi.resetModules();
    resetState();

    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
        throw new Error("__exit__");
    }) as never);

    // Capture stream "error" handlers registered by main().
    stdoutOnSpy = vi.spyOn(process.stdout, "on").mockImplementation(((event: string, cb: Handler) => {
        if (event === "error") h.streamErrorHandlers.push(cb);
        return process.stdout;
    }) as never);
    stderrOnSpy = vi.spyOn(process.stderr, "on").mockImplementation(((event: string, cb: Handler) => {
        if (event === "error") h.streamErrorHandlers.push(cb);
        return process.stderr;
    }) as never);
});

afterEach(() => {
    exitSpy.mockRestore();
    stdoutOnSpy.mockRestore();
    stderrOnSpy.mockRestore();
    setPlatform(realPlatform);
    delete process.env.TRILIUM_ELECTRON_DATA_DIR;
});

afterAll(() => {
    delete process.env.TRILIUM_UNIT_TEST;
    setPlatform(realPlatform);
});

async function importMain() {
    return await import("./main.js");
}

describe("main() bootstrap", () => {
    it("boots as the primary instance and wires up the full dependency graph", async () => {
        setPlatform("linux");
        h.smoothScroll = "false";
        const { main } = await importMain();
        await main();

        // Streams got an error handler; squirrel false → no exit.
        expect(h.streamErrorHandlers.length).toBe(2);
        expect(exitSpy).not.toHaveBeenCalled();

        // Smooth-scroll disabled + linux switches + lang switch were appended.
        const switches = h.appendSwitch.mock.calls.map((c) => c[0]);
        expect(switches).toContain("disable-smooth-scrolling");
        expect(switches).toContain("gtk-version");
        expect(switches).toContain("enable-features");
        expect(switches).toContain("lang");
        expect(switches).toContain("disable-http-cache"); // TRILIUM_ENV=dev by vitest config
        expect(h.setName).toHaveBeenCalled(); // linux → app.setName(PRODUCT_NAME)

        // The server-init handlers are registered.
        expect(h.appOn.has("window-all-closed")).toBe(true);
        expect(h.appOn.has("ready")).toBe(true);
        expect(h.appOn.has("will-quit")).toBe(true);
        expect(h.appOn.has("second-instance")).toBe(true);

        // Startup instrumentation is wired up and the boot phases are marked.
        const { markStartupMetric, setupStartupMetricsIpc } = await import("./services/startup_metrics.js");
        expect(setupStartupMetricsIpc).toHaveBeenCalled();
        for (const phase of ["main-process-start", "database-opened", "core-initialized", "server-started"]) {
            expect(markStartupMetric).toHaveBeenCalledWith(phase);
        }
    });

    it("appends no disable-http-cache switch when TRILIUM_ENV is not dev, and skips smooth-scroll switch when enabled", async () => {
        const prev = process.env.TRILIUM_ENV;
        delete process.env.TRILIUM_ENV;
        setPlatform("darwin");
        h.smoothScroll = "true";
        try {
            const { main } = await importMain();
            await main();
        } finally {
            if (prev !== undefined) process.env.TRILIUM_ENV = prev;
        }
        const switches = h.appendSwitch.mock.calls.map((c) => c[0]);
        expect(switches).not.toContain("disable-http-cache");
        expect(switches).not.toContain("disable-smooth-scrolling");
        expect(switches).not.toContain("gtk-version"); // non-linux
        expect(h.setName).not.toHaveBeenCalled();
    });

    // Regression for #10559: the switch is applied before core init, when
    // options.getOptionOrNull() still returns null, so the disabled state must be
    // read straight from the shared provider (sql_provider mock) — not core options.
    it("appends the smooth-scroll switch from the shared provider even though core options are unavailable", async () => {
        setPlatform("darwin");
        h.smoothScroll = "false";
        const { main } = await importMain();
        await main();
        const switches = h.appendSwitch.mock.calls.map((c) => c[0]);
        expect(switches).toContain("disable-smooth-scrolling");
    });

    it("skips the smooth-scroll switch when the database has no schema yet (first run)", async () => {
        setPlatform("darwin");
        h.smoothScroll = "false";
        h.dbUninitialized = true;
        const { main } = await importMain();
        await main();
        const switches = h.appendSwitch.mock.calls.map((c) => c[0]);
        expect(switches).not.toContain("disable-smooth-scrolling");
    });

    it("skips the smooth-scroll switch when the option row is absent from the DB", async () => {
        setPlatform("darwin");
        h.smoothScroll = null;
        const { main } = await importMain();
        await main();
        const switches = h.appendSwitch.mock.calls.map((c) => c[0]);
        expect(switches).not.toContain("disable-smooth-scrolling");
    });

    // Regression for #10559 (sibling of the smooth-scroll bug): the --lang switch is set
    // before core init from the same provider, so it must reflect the configured locale
    // instead of always falling back to "en".
    it("sets the --lang switch to the configured locale read from the DB", async () => {
        setPlatform("darwin");
        h.locale = "de";
        h.formattingLocale = null;
        h.locales = [{ id: "de", rtl: false }];
        const { main } = await importMain();
        await main();
        expect(h.appendSwitch).toHaveBeenCalledWith("lang", "de");
    });

    it("exits when it is not the primary instance", async () => {
        h.isPrimaryInstance = false;
        const { main } = await importMain();
        await expect(main()).rejects.toThrow("__exit__");
        expect(exitSpy).toHaveBeenCalledWith(0);
    });
});

describe("stream EPIPE error handler", () => {
    it("swallows EPIPE errors and rethrows everything else", async () => {
        const { main } = await importMain();
        await main();
        const handler = h.streamErrorHandlers[0];
        expect(handler).toBeDefined();
        // EPIPE → swallowed.
        expect(() => handler({ code: "EPIPE" })).not.toThrow();
        // Anything else → rethrown.
        expect(() => handler({ code: "EOTHER" })).toThrow();
    });
});

describe("app event handlers", () => {
    async function bootAndReady() {
        const { main } = await importMain();
        await main();
        return main;
    }

    it("window-all-closed quits except on macOS", async () => {
        await bootAndReady();
        const handler = h.appOn.get("window-all-closed");
        expect(handler).toBeDefined();
        if (!handler) return;

        setPlatform("darwin");
        handler();
        expect(h.quit).not.toHaveBeenCalled();

        setPlatform("linux");
        handler();
        expect(h.quit).toHaveBeenCalledTimes(1);
    });

    it("will-quit unregisters global shortcuts", async () => {
        await bootAndReady();
        const handler = h.appOn.get("will-quit");
        expect(handler).toBeDefined();
        handler?.();
        expect(h.unregisterAll).toHaveBeenCalled();
    });

    describe("second-instance", () => {
        it("creates an extra window when --new-window is passed", async () => {
            await bootAndReady();
            const handler = h.appOn.get("second-instance");
            handler?.({}, ["--new-window"]);
            expect(h.createExtraWindow).toHaveBeenCalledWith("");
        });

        it("restores, shows and focuses a minimized last-focused window", async () => {
            const restore = vi.fn();
            const show = vi.fn();
            const focus = vi.fn();
            h.lastFocusedWindow = { isMinimized: () => true, restore, show, focus };
            await bootAndReady();
            const handler = h.appOn.get("second-instance");
            handler?.({}, []);
            expect(restore).toHaveBeenCalled();
            expect(show).toHaveBeenCalled();
            expect(focus).toHaveBeenCalled();
        });

        it("shows and focuses a non-minimized last-focused window without restoring", async () => {
            const restore = vi.fn();
            const show = vi.fn();
            const focus = vi.fn();
            h.lastFocusedWindow = { isMinimized: () => false, restore, show, focus };
            await bootAndReady();
            const handler = h.appOn.get("second-instance");
            handler?.({}, []);
            expect(restore).not.toHaveBeenCalled();
            expect(show).toHaveBeenCalled();
            expect(focus).toHaveBeenCalled();
        });

        it("does nothing when there is no last-focused window", async () => {
            h.lastFocusedWindow = null;
            await bootAndReady();
            const handler = h.appOn.get("second-instance");
            expect(() => handler?.({}, [])).not.toThrow();
            expect(h.createExtraWindow).not.toHaveBeenCalled();
        });
    });

    describe("ready / onReady", () => {
        it("creates the main window and registers activate on macOS when the DB is initialized", async () => {
            h.isDbInitialized = true;
            setPlatform("darwin");
            await bootAndReady();

            const ready = h.appOn.get("ready");
            expect(ready).toBeDefined();
            await ready?.();

            expect(h.createMainWindow).toHaveBeenCalledTimes(1);
            expect(h.registerGlobalShortcuts).toHaveBeenCalled();
            // The autostart entry is reconciled with the stored option on a DB-ready boot.
            expect(h.setupAutoLaunch).toHaveBeenCalled();
            expect(h.applyLaunchOnStartup).toHaveBeenCalled();

            // The "activate" handler is registered on darwin.
            const activate = h.appOn.get("activate");
            expect(activate).toBeDefined();

            // No windows → create another main window.
            h.allWindows = [];
            await activate?.();
            expect(h.createMainWindow).toHaveBeenCalledTimes(2);

            // Existing windows → do not create another; instead reveal the
            // (possibly close-to-tray-hidden) last focused window.
            const show = vi.fn();
            const focus = vi.fn();
            h.allWindows = [{}];
            h.lastFocusedWindow = { isMinimized: () => false, restore: vi.fn(), show, focus };
            await activate?.();
            expect(h.createMainWindow).toHaveBeenCalledTimes(2);
            expect(show).toHaveBeenCalled();
            expect(focus).toHaveBeenCalled();

            // Hidden-on-autostart window was never focused → fall back to the main window.
            const mainShow = vi.fn();
            const mainFocus = vi.fn();
            h.lastFocusedWindow = null;
            h.mainWindow = { isMinimized: () => false, restore: vi.fn(), show: mainShow, focus: mainFocus };
            await activate?.();
            expect(mainShow).toHaveBeenCalled();
            expect(mainFocus).toHaveBeenCalled();
        });

        it("does not register activate on non-darwin even when DB is initialized", async () => {
            h.isDbInitialized = true;
            setPlatform("linux");
            await bootAndReady();
            const ready = h.appOn.get("ready");
            await ready?.();
            expect(h.createMainWindow).toHaveBeenCalledTimes(1);
            expect(h.appOn.has("activate")).toBe(false);
        });

        it("opens the setup window and banners when the DB is not initialized", async () => {
            h.isDbInitialized = false;
            await bootAndReady();
            const ready = h.appOn.get("ready");
            await ready?.();
            expect(h.banner).toHaveBeenCalled();
            expect(h.createSetupWindow).toHaveBeenCalled();
            expect(h.createMainWindow).not.toHaveBeenCalled();
        });

        it("rejects the express-app promise but still creates the window when the server fails to start", async () => {
            h.isDbInitialized = true;
            h.startServer = () => Promise.reject(new Error("server exploded"));
            const { main } = await importMain();
            const mainPromise = main();

            const ready = h.appOn.get("ready");
            expect(ready).toBeDefined();
            await ready?.();
            expect(h.createMainWindow).toHaveBeenCalledTimes(1);

            // main() itself fails, and the promise handed to the protocol
            // handler rejects so pending renderer requests fail instead of hanging.
            // (lastCall: the protocol mock's call history survives vi.resetModules.)
            await expect(mainPromise).rejects.toThrow("server exploded");
            const { setupTriliumAppProtocol } = await import("./protocol.js");
            const appPromise = vi.mocked(setupTriliumAppProtocol).mock.lastCall?.[0];
            await expect(appPromise).rejects.toThrow("server exploded");
        });

        it("creates the main window while the server is still starting", async () => {
            h.isDbInitialized = true;
            // The server never finishes starting; the window is gated on core
            // initialization only, so it must still be created.
            h.startServer = () => new Promise(() => {});
            const { main } = await importMain();
            void main(); // intentionally not awaited — it only settles once the server starts

            // The ready handler is registered synchronously; awaiting it blocks
            // only on core initialization, which completes despite the hung server.
            const ready = h.appOn.get("ready");
            expect(ready).toBeDefined();
            await ready?.();

            expect(h.createMainWindow).toHaveBeenCalledTimes(1);
        });
    });
});

describe("security settings override", () => {
    it("leaves config untouched when no overrides are provided", async () => {
        h.securitySettings = {};
        const { main } = await importMain();
        await main();
        const config = (await import("@triliumnext/server/src/services/config.js")).default;
        expect(config.Security).toEqual({});
    });

    it("applies backendScriptingEnabled and sqlConsoleEnabled overrides", async () => {
        h.securitySettings = { backendScriptingEnabled: true, sqlConsoleEnabled: true };
        const { main } = await importMain();
        await main();
        const config = (await import("@triliumnext/server/src/services/config.js")).default as {
            Security: { backendScriptingEnabled?: boolean; sqlConsoleEnabled?: boolean };
        };
        expect(config.Security.backendScriptingEnabled).toBe(true);
        expect(config.Security.sqlConsoleEnabled).toBe(true);
    });

    it("applies the allowLanAccess override", async () => {
        h.securitySettings = { allowLanAccess: true };
        const { main } = await importMain();
        await main();
        const config = (await import("@triliumnext/server/src/services/config.js")).default as {
            Security: { allowLanAccess?: boolean };
        };
        expect(config.Security.allowLanAccess).toBe(true);
    });
});

describe("initializeCore dbConfig callbacks + getDemoArchive", () => {
    it("commit relays entity changes; rollback reloads becca only when dirtied", async () => {
        const { main } = await importMain();
        await main();

        const config = h.initConfig;
        expect(config).toBeDefined();
        if (!config) return;

        const dbConfig = config.dbConfig as {
            onTransactionCommit: () => Promise<void>;
            onTransactionRollback: () => Promise<void>;
        };
        const getDemoArchive = config.getDemoArchive as () => Promise<Buffer>;

        await dbConfig.onTransactionCommit();
        expect(h.sendTransactionEntityChangesToAllClients).toHaveBeenCalled();

        // No dirtied entity changes → no becca reload.
        h.entityChangeIds = [];
        await dbConfig.onTransactionRollback();
        expect(h.beccaLoad).not.toHaveBeenCalled();
        expect(h.recalculateMaxEntityChangeId).toHaveBeenCalledTimes(1);

        // Dirtied entity changes → becca reload.
        h.entityChangeIds = ["x"];
        await dbConfig.onTransactionRollback();
        expect(h.beccaLoad).toHaveBeenCalledTimes(1);
        expect(h.recalculateMaxEntityChangeId).toHaveBeenCalledTimes(2);

        // getDemoArchive reads the demo zip.
        const archive = await getDemoArchive();
        expect(archive).toBeInstanceOf(Buffer);
    });
});

describe("getUserData()", () => {
    it("resolves TRILIUM_ELECTRON_DATA_DIR when set", async () => {
        process.env.TRILIUM_ELECTRON_DATA_DIR = "portable/dir";
        const { getUserData } = await importMain();
        const result = getUserData();
        expect(result).toContain("portable");
        expect(result).toContain("dir");
    });

    it("joins appData with name-port when the env var is unset", async () => {
        delete process.env.TRILIUM_ELECTRON_DATA_DIR;
        const { getUserData } = await importMain();
        // Use `path.join` so the assertion matches the platform-native separator
        // — `getUserData` calls `join(app.getPath("appData"), ...)`, so on Windows
        // it produces `\appData\Trilium-37740` and on POSIX `/appData/Trilium-37740`.
        expect(getUserData()).toBe(pathJoin("/appData", "Trilium-37740"));
    });
});

describe("getElectronLocale()", () => {
    // The locale options are read from the shared provider (core options are not wired up
    // before `ready`), so each test drives them through a mocked provider instance.
    it("returns the formatting locale when its corresponding UI locale is not RTL", async () => {
        h.locale = "en";
        h.formattingLocale = "de";
        h.locales = [{ id: "en", rtl: false }];
        const { getElectronLocale } = await importMain();
        expect(getElectronLocale(new BetterSqlite3Provider())).toBe("de");
    });

    it("falls back to the UI locale when the corresponding locale is RTL", async () => {
        h.locale = "ar";
        h.formattingLocale = "de";
        h.locales = [{ id: "ar", rtl: true }];
        const { getElectronLocale } = await importMain();
        expect(getElectronLocale(new BetterSqlite3Provider())).toBe("ar");
    });

    it("returns the UI locale when there is no formatting locale", async () => {
        h.locale = "fr";
        h.formattingLocale = null;
        h.locales = [{ id: "fr", rtl: false }];
        const { getElectronLocale } = await importMain();
        expect(getElectronLocale(new BetterSqlite3Provider())).toBe("fr");
    });

    it("defaults to 'en' when neither locale is set", async () => {
        h.locale = null;
        h.formattingLocale = null;
        h.locales = [];
        const { getElectronLocale } = await importMain();
        expect(getElectronLocale(new BetterSqlite3Provider())).toBe("en");
    });
});
