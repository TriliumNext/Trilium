import { getLog, initializeCore, options, sql_init } from "@triliumnext/core";
import ServerBackupService from "@triliumnext/server/src/backup_provider.js";
import ClsHookedExecutionContext from "@triliumnext/server/src/cls_provider.js";
import { loadCoreSchema } from "@triliumnext/server/src/core_assets.js";
import NodejsCryptoProvider from "@triliumnext/server/src/crypto_provider.js";
import NodejsInAppHelpProvider from "@triliumnext/server/src/in_app_help_provider.js";
import ServerLogService from "@triliumnext/server/src/log_provider.js";
import dataDirs from "@triliumnext/server/src/services/data_dir.js";
import port from "@triliumnext/server/src/services/port.js";
import NodeRequestProvider from "@triliumnext/server/src/services/request.js";
import { RESOURCE_DIR } from "@triliumnext/server/src/services/resource_dir.js";
import tray from "@triliumnext/server/src/services/tray.js";
import windowService from "@triliumnext/server/src/services/window.js";
import WebSocketMessagingProvider from "@triliumnext/server/src/services/ws_messaging_provider.js";
import BetterSqlite3Provider from "@triliumnext/server/src/sql_provider.js";
import NodejsZipProvider from "@triliumnext/server/src/zip_provider.js";
import { app, BrowserWindow,globalShortcut } from "electron";
import electronDebug from "electron-debug";
import electronDl from "electron-dl";
import fs from "fs";
import { t } from "i18next";
import path, { join, resolve } from "path";

import { deferred, LOCALES } from "../../../packages/commons/src";
import { PRODUCT_NAME } from "./app-info";
import DesktopPlatformProvider from "./platform_provider";

async function main() {
    // Ignore EPIPE errors on stdout/stderr — these occur when the parent process
    // pipe breaks (e.g. after system suspend with Snap packaging).
    for (const stream of [process.stdout, process.stderr]) {
        stream?.on("error", (err: NodeJS.ErrnoException) => {
            if (err.code !== "EPIPE") {
                throw err;
            }
        });
    }

    const userDataPath = getUserData();
    app.setPath("userData", userDataPath);

    const serverInitializedPromise = deferred<void>();

    // Prevent Trilium starting twice on first install and on uninstall for the Windows installer.
    if ((require("electron-squirrel-startup")).default) {
        process.exit(0);
    }

    // Adds debug features like hotkeys for triggering dev tools and reload
    electronDebug();
    electronDl({ saveAs: true });

    // needed for excalidraw export https://github.com/zadam/trilium/issues/4271
    app.commandLine.appendSwitch("enable-experimental-web-platform-features");
    app.commandLine.appendSwitch("lang", getElectronLocale());

    // Disable smooth scroll if the option is set
    const smoothScrollEnabled = options.getOptionOrNull("smoothScrollEnabled");
    if (smoothScrollEnabled === "false") {
        app.commandLine.appendSwitch("disable-smooth-scrolling");
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
        await serverInitializedPromise;
        console.log("Starting Electron...");
        await onReady();
    });

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

    const isPrimaryInstance = (await import("electron")).app.requestSingleInstanceLock();
    if (!isPrimaryInstance) {
        console.info(t("desktop.instance_already_running"));
        process.exit(0);
    }

    // this is to disable electron warning spam in the dev console (local development only)
    process.env["ELECTRON_DISABLE_SECURITY_WARNINGS"] = "true";

    const { DOCUMENT_PATH } = (await import("@triliumnext/server/src/services/data_dir.js")).default;
    const config = (await import("@triliumnext/server/src/services/config.js")).default;

    const dbProvider = new BetterSqlite3Provider();
    dbProvider.loadFromFile(DOCUMENT_PATH, config.General.readOnly);

    await initializeCore({
        dbConfig: {
            provider: dbProvider,
            isReadOnly: config.General.readOnly,
            async onTransactionCommit() {
                const ws = (await import("@triliumnext/server/src/services/ws.js")).default;
                ws.sendTransactionEntityChangesToAllClients();
            },
            async onTransactionRollback() {
                const cls = (await import("@triliumnext/server/src/services/cls.js")).default;
                const becca_loader = (await import("@triliumnext/core")).becca_loader;
                const entity_changes = (await import("@triliumnext/server/src/services/entity_changes.js")).default;
                const log = (await import("@triliumnext/server/src/services/log")).default;

                const entityChangeIds = cls.getAndClearEntityChangeIds();

                if (entityChangeIds.length > 0) {
                    log.info("Transaction rollback dirtied the becca, forcing reload.");

                    becca_loader.load();
                }

                // the maxEntityChangeId has been incremented during failed transaction, need to recalculate
                entity_changes.recalculateMaxEntityChangeId();
            }
        },
        crypto: new NodejsCryptoProvider(),
        zip: new NodejsZipProvider(),
        zipExportProviderFactory: (await import("@triliumnext/server/src/services/export/zip/factory.js")).serverZipExportProviderFactory,
        request: new NodeRequestProvider(),
        executionContext: new ClsHookedExecutionContext(),
        messaging: new WebSocketMessagingProvider(),
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
        extraAppInfo: {
            nodeVersion: process.version,
            dataDirectory: path.resolve(dataDirs.TRILIUM_DATA_DIR)
        }
    });

    const startTriliumServer = (await import("@triliumnext/server/src/www.js")).default;
    await startTriliumServer();
    console.log("Server loaded");

    serverInitializedPromise.resolve();
}

/**
 * Returns a unique user data directory for Electron so that single instance locks between legitimately different instances such as different port or data directory can still act independently, but we are focusing the main window otherwise.
 *
 * When running in portable mode, set TRILIUM_ELECTRON_DATA_DIR (e.g. via the trilium-portable script)
 * so that no Electron files are written to the system's roaming profile (e.g. %APPDATA% on Windows).
 */
function getUserData() {
    if (process.env.TRILIUM_ELECTRON_DATA_DIR) {
        return resolve(process.env.TRILIUM_ELECTRON_DATA_DIR);
    }

    return join(app.getPath("appData"), `${app.getName()}-${port}`);
}

async function onReady() {
    //    app.setAppUserModelId('com.github.zadam.trilium');

    // if db is not initialized -> setup process
    // if db is initialized, then we need to wait until the migration process is finished
    if (sql_init.isDbInitialized()) {
        await sql_init.dbReady;

        await windowService.createMainWindow(app);

        if (process.platform === "darwin") {
            app.on("activate", async () => {
                if (BrowserWindow.getAllWindows().length === 0) {
                    await windowService.createMainWindow(app);
                }
            });
        }

        tray.createTray();
    } else {
        getLog().banner(t("sql_init.db_not_initialized_desktop"));
        await windowService.createSetupWindow();
    }

    await windowService.registerGlobalShortcuts();
}

function getElectronLocale() {
    const uiLocale = options.getOptionOrNull("locale");
    const formattingLocale = options.getOptionOrNull("formattingLocale");
    const correspondingLocale = LOCALES.find(l => l.id === uiLocale);

    // For RTL, we have to force the UI locale to align the window buttons properly.
    if (formattingLocale && !correspondingLocale?.rtl) return formattingLocale;

    return uiLocale || "en";
}

main();
