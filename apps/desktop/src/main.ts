import { initializeTranslations } from "@triliumnext/server/src/services/i18n.js";
import { t } from "i18next";

import { app, globalShortcut, BrowserWindow } from "electron";
import sqlInit from "@triliumnext/server/src/services/sql_init.js";
import windowService from "@triliumnext/server/src/services/window.js";
import tray from "@triliumnext/server/src/services/tray.js";
import options from "@triliumnext/server/src/services/options.js";
import electronDebug from "electron-debug";
import electronDl from "electron-dl";
import { PRODUCT_NAME } from "./app-info";
import port from "@triliumnext/server/src/services/port.js";
import { join, resolve } from "path";
import { deferred, LOCALES } from "../../../packages/commons/src";

const TRILIUM_PROTOCOL = "trilium";
let pendingNoteId: string | null = null;

function extractNoteIdFromArgs(args: string[]): string | null {
    const protocolArg = args.find(arg => arg.startsWith(`${TRILIUM_PROTOCOL}://`));
    if (!protocolArg) return null;
    try {
        const url = new URL(protocolArg);
        return url.hostname || url.pathname.replace(/^\/+/, "") || null;
    } catch {
        return null;
    }
}

async function main() {
    const userDataPath = getUserData();
    app.setPath("userData", userDataPath);

    const serverInitializedPromise = deferred<void>();

    if ((require("electron-squirrel-startup")).default) {
        process.exit(0);
    }

    // Register protocol handler before app is ready
    if (process.defaultApp) {
        if (process.argv.length >= 2) {
            app.setAsDefaultProtocolClient(TRILIUM_PROTOCOL, process.execPath, [resolve(process.argv[1])]);
        }
    } else {
        app.setAsDefaultProtocolClient(TRILIUM_PROTOCOL);
    }

    // Capture note ID from launch args
    pendingNoteId = extractNoteIdFromArgs(process.argv);

    electronDebug();
    electronDl({ saveAs: true });

    app.commandLine.appendSwitch("enable-experimental-web-platform-features");
    app.commandLine.appendSwitch("lang", getElectronLocale());

    const smoothScrollEnabled = options.getOptionOrNull("smoothScrollEnabled");
    if (smoothScrollEnabled === "false") {
        app.commandLine.appendSwitch("disable-smooth-scrolling");
    }

    if (process.platform === "linux") {
        app.setName(PRODUCT_NAME);
        app.commandLine.appendSwitch("gtk-version", "3");
        app.commandLine.appendSwitch("enable-features", "GlobalShortcutsPortal");
    }

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
        const noteId = extractNoteIdFromArgs(commandLine);
        const lastFocusedWindow = windowService.getLastFocusedWindow();

        if (commandLine.includes("--new-window")) {
            windowService.createExtraWindow("");
        } else if (lastFocusedWindow) {
            if (lastFocusedWindow.isMinimized()) lastFocusedWindow.restore();
            lastFocusedWindow.show();
            lastFocusedWindow.focus();
        }

        if (noteId && lastFocusedWindow) {
            lastFocusedWindow.webContents.send("open-note-by-id", noteId);
        }
    });

    await initializeTranslations();

    const isPrimaryInstance = app.requestSingleInstanceLock();
    if (!isPrimaryInstance) {
        console.info(t("desktop.instance_already_running"));
        process.exit(0);
    }

    process.env["ELECTRON_DISABLE_SECURITY_WARNINGS"] = "true";

    const startTriliumServer = (await import("@triliumnext/server/src/www.js")).default;
    await startTriliumServer();
    console.log("Server loaded");
    serverInitializedPromise.resolve();
}

function getUserData() {
    if (process.env.TRILIUM_ELECTRON_DATA_DIR) {
        return resolve(process.env.TRILIUM_ELECTRON_DATA_DIR);
    }
    return join(app.getPath("appData"), `${app.getName()}-${port}`);
}

async function onReady() {
    if (sqlInit.isDbInitialized()) {
        await sqlInit.dbReady;

        const mainWindow = await windowService.createMainWindow(app);

        if (pendingNoteId) {
            const noteId = pendingNoteId;
            pendingNoteId = null;
            // Wait for renderer to be ready before sending IPC (no hardcoded timeout)
            mainWindow.webContents.once("did-finish-load", () => {
                mainWindow.webContents.send("open-note-by-id", noteId);
            });
        }

        if (process.platform === "darwin") {
            app.on("activate", async () => {
                if (BrowserWindow.getAllWindows().length === 0) {
                    await windowService.createMainWindow(app);
                }
            });
        }

        tray.createTray();
    } else {
        await windowService.createSetupWindow();
    }

    await windowService.registerGlobalShortcuts();
}

function getElectronLocale() {
    const uiLocale = options.getOptionOrNull("locale");
    const formattingLocale = options.getOptionOrNull("formattingLocale");
    const correspondingLocale = LOCALES.find(l => l.id === uiLocale);

    if (formattingLocale && !correspondingLocale?.rtl) return formattingLocale;

    return uiLocale || "en";
}

main();
