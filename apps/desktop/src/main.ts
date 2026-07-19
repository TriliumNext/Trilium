import { becca_loader, cls, entity_changes, getLog, initializeCore, options, sql_init, ws } from "@triliumnext/core";
import ServerBackupService from "@triliumnext/server/src/backup_provider.js";
import ClsHookedExecutionContext from "@triliumnext/server/src/cls_provider.js";
import { loadCoreSchema } from "@triliumnext/server/src/core_assets.js";
import NodejsCryptoProvider from "@triliumnext/server/src/crypto_provider.js";
import NodejsInAppHelpProvider from "@triliumnext/server/src/in_app_help_provider.js";
import ServerLogService from "@triliumnext/server/src/log_provider.js";
import config from "@triliumnext/server/src/services/config.js";
import dataDirs from "@triliumnext/server/src/services/data_dir.js";
import port from "@triliumnext/server/src/services/port.js";
import { RESOURCE_DIR } from "@triliumnext/server/src/services/resource_dir.js";
import BetterSqlite3Provider from "@triliumnext/server/src/sql_provider.js";
import NodejsZipProvider from "@triliumnext/server/src/zip_provider.js";
import { app, BrowserWindow,globalShortcut } from "electron";
import electronDebug from "electron-debug";
import electronDl from "electron-dl";
import type { Application } from "express";
import fs from "fs";
import { t } from "i18next";
import path, { join, resolve } from "path";

import { deferred, LOCALES } from "../../../packages/commons/src";
import { PRODUCT_NAME } from "./app-info";
import IpcMessagingProvider from "./ipc_messaging_provider";
import DesktopPlatformProvider from "./platform_provider";
import { registerTriliumAppScheme, setupTriliumAppProtocol } from "./protocol";
import { applyLaunchOnStartup, setupAutoLaunch, wasLaunchedHidden } from "./services/auto_launch";
import { setupCustomDictionary } from "./services/custom_dictionary";
import { setupEmbedReferer } from "./services/embed_referer";
import { setupExportHandlers } from "./services/export";
import { setupImportHandlers } from "./services/import";
import { setupOneNoteHandlers } from "./services/onenote";
import { setupPrintingHandlers } from "./services/printing";
import ElectronRequestProvider from "./services/request";
import { getSecuritySettings, registerSecurityIpcHandlers } from "./services/security_settings";
import { setupShellHandlers } from "./services/shell";
import { markStartupMetric, setupStartupMetricsIpc } from "./services/startup_metrics";
import { setupSystemTray } from "./services/tray";
import windowService, { setupWindowing } from "./services/window";

export async function main() {
    markStartupMetric("main-process-start");

    // Ignore EPIPE errors on stdout/stderr — these occur when the parent process
    // pipe breaks (e.g. after system suspend with Snap packaging).
    for (const stream of [process.stdout, process.stderr]) {
        stream?.on("error", (err: NodeJS.ErrnoException) => {
            if (err.code !== "EPIPE") {
                throw err;
            }
        });
    }

    registerTriliumAppScheme();

    const userDataPath = getUserData();
    app.setPath("userData", userDataPath);

    // Resolved once initializeCore() has finished — the DB is open and options
    // and translations are readable. That is all window creation needs, so it
    // (not full server startup) gates onReady(): the renderer spins up
    // concurrently with the Express app being built.
    const coreInitializedPromise = deferred<void>();

    // Resolved with the Express app once the server has finished building. The
    // trilium-app:// protocol handler awaits this per request, so renderer
    // requests that arrive before the server is up simply wait.
    const expressAppPromise = deferred<Application>();
    setupTriliumAppProtocol(expressAppPromise);

    // Prevent Trilium starting twice on first install and on uninstall for the Windows installer.
    /* v8 ignore next 3 -- squirrel uses a CJS require() that vi.mock cannot intercept, so the truthy/exit path is un-coverable in unit tests */
    if ((require("electron-squirrel-startup")).default) {
        process.exit(0);
    }

    // Adds debug features like hotkeys for triggering dev tools and reload.
    // `showDevTools: false` prevents DevTools from auto-opening on every window
    // in dev mode — the hotkeys (F12, Ctrl/Cmd+R) remain available.
    electronDebug({ showDevTools: false });
    electronDl({ saveAs: true });

    // needed for excalidraw export https://github.com/zadam/trilium/issues/4271
    app.commandLine.appendSwitch("enable-experimental-web-platform-features");

    // In dev mode, disable Chromium's HTTP cache so stale assets cached from a
    // previous production run (which served `max-age: 1y` headers) don't shadow
    // freshly built dev output. Must be set before the app's `ready` event.
    if (process.env.TRILIUM_ENV === "dev") {
        app.commandLine.appendSwitch("disable-http-cache");
    }

    if (process.platform === "linux") {
        app.setName(PRODUCT_NAME);

        // Electron 36 crashes with "Using GTK 2/3 and GTK 4 in the same process is not supported" on some distributions.
        // See https://github.com/electron/electron/issues/46538 for more info.
        app.commandLine.appendSwitch("gtk-version", "3");

        // Enable global shortcuts in Flatpak
        // the app runs in a Wayland session.
        app.commandLine.appendSwitch("enable-features", "GlobalShortcutsPortal");
    }

    // Quit when all windows are closed, except on macOS. There, it's common
    // for applications and their menu bar to stay active until the user quits
    // explicitly with Cmd + Q.
    app.on("window-all-closed", () => {
        if (process.platform !== "darwin") {
            app.quit();
        }
    });

    app.on("ready", async () => {
        markStartupMetric("electron-ready");
        await coreInitializedPromise;
        console.log("Starting Electron...");
        await onReady();
    });

    setupWindowing();
    setupSystemTray();
    setupAutoLaunch();
    setupCustomDictionary();
    setupShellHandlers();
    setupOneNoteHandlers();
    setupPrintingHandlers();
    setupExportHandlers();
    setupImportHandlers();
    registerSecurityIpcHandlers();
    setupStartupMetricsIpc();

    app.on("will-quit", () => {
        globalShortcut.unregisterAll();
    });

    app.on("second-instance", (event, commandLine) => {
        const lastFocusedWindow = windowService.getLastFocusedWindow();
        if (commandLine.includes("--new-window")) {
            windowService.createExtraWindow("");
        } else if (lastFocusedWindow) {
            if (lastFocusedWindow.isMinimized()) {
                lastFocusedWindow.restore();
            }
            lastFocusedWindow.show();
            lastFocusedWindow.focus();
        }
    });

    // await initializeTranslations();

    // Synchronous: `app` and `config`/`dataDirs` are all statically imported, so nothing
    // between the top of main() and the database open below awaits. That keeps the whole
    // prologue — including the pre-`ready` Chromium switches — running before Electron can
    // emit `ready`, while still letting us open the database and read options from it first.
    const isPrimaryInstance = app.requestSingleInstanceLock();
    if (!isPrimaryInstance) {
        console.info(t("desktop.instance_already_running"));
        process.exit(0);
    }

    // this is to disable electron warning spam in the dev console (local development only)
    process.env["ELECTRON_DISABLE_SECURITY_WARNINGS"] = "true";

    // Override scripting config from security.json (lives outside the DB for tamper resistance)
    const securitySettings = getSecuritySettings();
    if (securitySettings.backendScriptingEnabled !== undefined) {
        config.Security.backendScriptingEnabled = securitySettings.backendScriptingEnabled;
    }
    if (securitySettings.sqlConsoleEnabled !== undefined) {
        config.Security.sqlConsoleEnabled = securitySettings.sqlConsoleEnabled;
    }
    // Applied before the server (and host.ts) load below, so getHost() picks up
    // the desktop LAN-access choice on this boot.
    if (securitySettings.allowLanAccess !== undefined) {
        config.Security.allowLanAccess = securitySettings.allowLanAccess;
    }

    const dbProvider = new BetterSqlite3Provider();
    dbProvider.loadFromFile(dataDirs.DOCUMENT_PATH, config.General.readOnly);
    markStartupMetric("database-opened");

    // These Chromium switches must be applied before `ready`; the prologue above is
    // await-free, so `ready` cannot have fired yet. Their option values are read straight
    // from the provider we just opened (and reuse for the whole app below) because the core
    // options service isn't wired up until initializeCore() runs — reading via
    // options.getOptionOrNull() here would always return null (#10559).
    app.commandLine.appendSwitch("lang", getElectronLocale(dbProvider));
    if (readDbOption(dbProvider, "smoothScrollEnabled") === "false") {
        app.commandLine.appendSwitch("disable-smooth-scrolling");
    }

    // The IPC provider just registers an `ipcMain.on` listener; no TCP socket
    // or session parser needed, so we can init it here (before startTriliumServer)
    // instead of going through www.ts. www.ts then only knows about the
    // socket-bound WebSocket provider.
    const ipcMessaging = new IpcMessagingProvider();
    ipcMessaging.init();

    await initializeCore({
        dbConfig: {
            provider: dbProvider,
            isReadOnly: config.General.readOnly,
            async onTransactionCommit() {
                ws.sendTransactionEntityChangesToAllClients();
            },
            async onTransactionRollback() {
                const entityChangeIds = cls.getAndClearEntityChangeIds();

                if (entityChangeIds.length > 0) {
                    getLog().info("Transaction rollback dirtied the becca, forcing reload.");

                    becca_loader.load();
                }

                // the maxEntityChangeId has been incremented during failed transaction, need to recalculate
                entity_changes.recalculateMaxEntityChangeId();
            }
        },
        crypto: new NodejsCryptoProvider(),
        zip: new NodejsZipProvider(),
        zipExportProviderFactory: (await import("@triliumnext/server/src/services/export/zip/factory.js")).serverZipExportProviderFactory,
        request: new ElectronRequestProvider(),
        executionContext: new ClsHookedExecutionContext(),
        messaging: ipcMessaging,
        schema: loadCoreSchema(),
        platform: new DesktopPlatformProvider(),
        translations: (await import("@triliumnext/server/src/services/i18n.js")).initializeTranslations,
        // demo.zip is a server-owned asset; src/assets is copied to dist/assets
        // by the build script, so the same RESOURCE_DIR-relative path works in
        // both source and bundled-production modes.
        getDemoArchive: async () => fs.readFileSync(path.join(RESOURCE_DIR, "db", "demo.zip")),
        inAppHelp: new NodejsInAppHelpProvider(),
        log: new ServerLogService(),
        backup: new ServerBackupService(options),
        image: (await import("@triliumnext/server/src/services/image_provider.js")).serverImageProvider,
        config,
        extraAppInfo: {
            nodeVersion: process.version,
            dataDirectory: path.resolve(dataDirs.TRILIUM_DATA_DIR)
        }
    });
    markStartupMetric("core-initialized");
    coreInitializedPromise.resolve();

    try {
        const startTriliumServer = (await import("@triliumnext/server/src/www.js")).default;
        const expressApp = await startTriliumServer();
        markStartupMetric("server-started");

        expressAppPromise.resolve(expressApp);
    } catch (err) {
        // The window may already be up and loading trilium-app:// — fail its
        // requests with a 500 instead of leaving them awaiting a server that
        // will never come up. The no-op catch marks the deferred itself as
        // handled (each protocol request awaits it separately).
        expressAppPromise.reject(err instanceof Error ? err : new Error(String(err)));
        expressAppPromise.catch(() => {});
        throw err;
    }
}

/**
 * Reads a single option value from an already-open database provider, synchronously.
 *
 * Needed for the handful of settings consulted before `app.ready` (e.g. the
 * `--disable-smooth-scrolling` Chromium switch): at that point initializeCore() has not
 * run and the core options service is not wired up, so options.getOptionOrNull() always
 * returns null — which silently dropped a persisted "false" (#10559). Returns null (the
 * safe default) when the database has no schema yet, e.g. on the very first run.
 */
function readDbOption(provider: BetterSqlite3Provider, name: string): string | null {
    try {
        const value = provider.prepare("SELECT value FROM options WHERE name = ?").pluck().get(name);
        return typeof value === "string" ? value : null;
    } catch {
        return null;
    }
}

/**
 * Returns a unique user data directory for Electron so that single instance locks between legitimately different instances such as different port or data directory can still act independently, but we are focusing the main window otherwise.
 *
 * When running in portable mode, set TRILIUM_ELECTRON_DATA_DIR (e.g. via the trilium-portable script)
 * so that no Electron files are written to the system's roaming profile (e.g. %APPDATA% on Windows).
 */
export function getUserData() {
    if (process.env.TRILIUM_ELECTRON_DATA_DIR) {
        return resolve(process.env.TRILIUM_ELECTRON_DATA_DIR);
    }

    return join(app.getPath("appData"), `${app.getName()}-${port}`);
}

async function onReady() {
    //    app.setAppUserModelId('com.github.zadam.trilium');

    // Supply a valid Referer for embed providers (e.g. YouTube) that reject the
    // custom `trilium-app://` origin. We use the desktop's local server origin —
    // the same value the working browser client sends. Registered on the shared
    // default session before any window is created.
    setupEmbedReferer(`http://localhost:${port}/`);

    // if db is not initialized -> setup process
    // if db is initialized, then we need to wait until the migration process is finished
    if (sql_init.isDbInitialized()) {
        await sql_init.dbReady;

        // Open minimized to the tray only when launched at login with the option
        // on (never on a manual launch, which expects a window) and the tray is
        // available to summon it from.
        const startHidden = wasLaunchedHidden() && !options.getOptionBool("disableTray");
        await windowService.createMainWindow(startHidden);

        // Repair the OS autostart entry so it matches the stored option (it can
        // drift if the user toggled it elsewhere). Options are loaded now that the
        // DB is ready.
        applyLaunchOnStartup();

        if (process.platform === "darwin") {
            app.on("activate", async () => {
                if (BrowserWindow.getAllWindows().length === 0) {
                    await windowService.createMainWindow();
                } else {
                    // Close-to-tray, or hide-on-autostart, may have left a hidden
                    // window that was never focused, so fall back to the main window
                    // to reveal it on a dock-icon click.
                    const win = windowService.getLastFocusedWindow() ?? windowService.getMainWindow();
                    win?.show();
                    win?.focus();
                }
            });
        }
    } else {
        getLog().banner(t("sql_init.db_not_initialized_desktop"));
        await windowService.createSetupWindow();
    }

    await windowService.registerGlobalShortcuts();
}

export function getElectronLocale(provider: BetterSqlite3Provider) {
    const uiLocale = readDbOption(provider, "locale");
    const formattingLocale = readDbOption(provider, "formattingLocale");
    const correspondingLocale = LOCALES.find(l => l.id === uiLocale);

    // For RTL, we have to force the UI locale to align the window buttons properly.
    if (formattingLocale && !correspondingLocale?.rtl) return formattingLocale;

    return uiLocale || "en";
}

/* v8 ignore next 3 -- auto-start guard; unit tests import and invoke main() explicitly */
if (process.env.TRILIUM_UNIT_TEST !== "1") {
    main();
}
