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
import {
    TRILIUM_PROTOCOL,
    extractNoteIdFromArgs,
    extractNoteIdFromUrl,
} from "./protocol_handler";

// Note ID captured before a renderer exists. Sent over IPC once a window
// reports `did-finish-load`. Cleared after delivery so it isn't re-sent.
let pendingNoteId: string | null = null;

/**
 * Registers `trilium://` as a default protocol client. Must run before
 * `app.ready` per Electron's docs.
 */
function registerProtocolHandler() {
    if (process.defaultApp) {
        // Running via `electron .` in development — re-pass the script path
        // so child invocations know how to relaunch.
        if (process.argv.length >= 2) {
            app.setAsDefaultProtocolClient(TRILIUM_PROTOCOL, process.execPath, [
                resolve(process.argv[1]),
            ]);
        }
    } else {
        app.setAsDefaultProtocolClient(TRILIUM_PROTOCOL);
    }
}

/** Restores, shows, focuses, and routes a note ID to the given window. */
function focusAndOpenNote(window: BrowserWindow, noteId: string) {
    if (window.isMinimized()) {
        window.restore();
    }
    window.show();
    window.focus();
    window.webContents.send("open-note-by-id", noteId);
}

async function main() {
    const userDataPath = getUserData();
    app.setPath("userData", userDataPath);

    const serverInitializedPromise = deferred<void>();

    // Prevent Trilium starting twice on first install and on uninstall for the Windows installer.
    if ((require("electron-squirrel-startup")).default) {
        process.exit(0);
    }

    registerProtocolHandler();

    // On Windows/Linux the OS appends `trilium://<noteId>` to argv when
    // launching the app cold. macOS uses the `open-url` event below instead.
    pendingNoteId = extractNoteIdFromArgs(process.argv);

    // macOS delivers protocol URLs via this event, which can fire BEFORE
    // `ready`. Capture into `pendingNoteId` either way; `onReady` flushes it.
    app.on("open-url", (event, url) => {
        event.preventDefault();
        const noteId = extractNoteIdFromUrl(url);
        if (!noteId) {
            return;
        }

        const mainWindow = windowService.getMainWindow();
        if (mainWindow && !mainWindow.webContents.isLoading()) {
            focusAndOpenNote(mainWindow, noteId);
        } else {
            pendingNoteId = noteId;
        }
    });

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

    app.on("second-instance", async (_event, commandLine) => {
        const noteId = extractNoteIdFromArgs(commandLine);

        // `--new-window` + a protocol URL = open the note in the new window.
        // Without a note ID we just create an empty extra window (existing
        // behaviour). The note is delivered after the new window loads.
        if (commandLine.includes("--new-window")) {
            await windowService.createExtraWindow("");
            if (noteId) {
                const allWindows = windowService.getAllWindows();
                const extraWindow = allWindows[allWindows.length - 1];
                if (extraWindow) {
                    extraWindow.webContents.once("did-finish-load", () => {
                        focusAndOpenNote(extraWindow, noteId);
                    });
                }
            }
            return;
        }

        const lastFocusedWindow = windowService.getLastFocusedWindow();
        if (!lastFocusedWindow) {
            return;
        }

        if (noteId) {
            focusAndOpenNote(lastFocusedWindow, noteId);
        } else {
            if (lastFocusedWindow.isMinimized()) {
                lastFocusedWindow.restore();
            }
            lastFocusedWindow.show();
            lastFocusedWindow.focus();
        }
    });

    await initializeTranslations();

    const isPrimaryInstance = (await import("electron")).app.requestSingleInstanceLock();
    if (!isPrimaryInstance) {
        console.info(t("desktop.instance_already_running"));
        process.exit(0);
    }

    // this is to disable electron warning spam in the dev console (local development only)
    process.env["ELECTRON_DISABLE_SECURITY_WARNINGS"] = "true";

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
    if (sqlInit.isDbInitialized()) {
        await sqlInit.dbReady;

        await windowService.createMainWindow(app);

        // Flush a note ID captured before the renderer existed (cold launch on
        // any platform, plus `open-url` fired pre-ready on macOS). Resolve the
        // window via the service since `createMainWindow` returns void.
        if (pendingNoteId) {
            const noteId = pendingNoteId;
            pendingNoteId = null;
            const mainWindow = windowService.getMainWindow();
            if (mainWindow) {
                mainWindow.webContents.once("did-finish-load", () => {
                    focusAndOpenNote(mainWindow, noteId);
                });
            }
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

    // For RTL, we have to force the UI locale to align the window buttons properly.
    if (formattingLocale && !correspondingLocale?.rtl) return formattingLocale;

    return uiLocale || "en"
}

main();
