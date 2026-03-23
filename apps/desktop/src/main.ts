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
import { join } from "path";
import { deferred, LOCALES } from "../../../packages/commons/src";

/**
 * Parses a `trilium://` protocol URL and returns the note ID, or null if the
 * URL cannot be parsed.
 *
 * Supported formats:
 *   trilium://note/<noteId>
 *   trilium://<noteId>          (legacy / shorthand)
 */
function parseTriliumUrl(rawUrl: string): string | null {
    let parsed: URL;
    try {
        parsed = new URL(rawUrl);
    } catch {
        return null;
    }

    if (parsed.protocol !== "trilium:") {
        return null;
    }

    // trilium://note/<noteId>  →  hostname = "note", pathname = "/<noteId>"
    if (parsed.hostname === "note") {
        const noteId = parsed.pathname.replace(/^\/+/, "").trim();
        return noteId || null;
    }

    // trilium://<noteId>  →  hostname = "<noteId>"
    const noteId = parsed.hostname.trim();
    return noteId || null;
}

/**
 * Extracts a `trilium://` URL from a process argv / commandLine array, or
 * returns null if none is present.
 */
function extractTriliumUrlFromArgs(args: string[]): string | null {
    for (const arg of args) {
        if (arg.startsWith("trilium://")) {
            return arg;
        }
        // --open-note=<noteId>  convenience flag
        const m = arg.match(/^--open-note=(.+)$/);
        if (m) {
            return `trilium://note/${m[1]}`;
        }
    }
    return null;
}

/**
 * Focuses the main window and navigates to the given note.
 * Safe to call before the window is created; returns false if navigation was
 * not possible (e.g. window not yet ready).
 */
function navigateToNote(noteId: string): boolean {
    const win = windowService.getLastFocusedWindow() ?? windowService.getMainWindow();
    if (!win || win.isDestroyed()) {
        return false;
    }

    if (win.isMinimized()) {
        win.restore();
    }
    win.show();
    win.focus();

    win.webContents.send("openInSameTab", noteId);
    return true;
}

async function main() {
    const userDataPath = getUserData();
    app.setPath("userData", userDataPath);

    const serverInitializedPromise = deferred<void>();

    // Prevent Trilium starting twice on first install and on uninstall for the Windows installer.
    if ((require("electron-squirrel-startup")).default) {
        process.exit(0);
    }

    // Register trilium:// as a custom URI scheme so external apps and the OS
    // can launch Trilium and navigate directly to a note.
    // Must be called before app.requestSingleInstanceLock().
    app.setAsDefaultProtocolClient("trilium");

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

        // Handle protocol URL passed when this is the *first* instance
        // (Windows / Linux deliver the URL as a command-line argument).
        const protocolUrl = extractTriliumUrlFromArgs(process.argv);
        if (protocolUrl) {
            const noteId = parseTriliumUrl(protocolUrl);
            if (noteId) {
                // Wait a short moment for the renderer to finish initialising
                // before sending the navigation request.
                setTimeout(() => navigateToNote(noteId), 1500);
            }
        }
    });

    app.on("will-quit", () => {
        globalShortcut.unregisterAll();
    });

    // On macOS, protocol URLs for a *running* instance are delivered via
    // the "open-url" event instead of "second-instance".
    app.on("open-url", (event, url) => {
        event.preventDefault();
        const noteId = parseTriliumUrl(url);
        if (noteId) {
            if (navigateToNote(noteId)) {
                return;
            }
            // Window not ready yet – retry after the ready event fires.
            app.once("ready", () => setTimeout(() => navigateToNote(noteId), 1500));
        }
    });

    app.on("second-instance", (event, commandLine) => {
        // Check if a trilium:// URL or --open-note flag was supplied.
        const protocolUrl = extractTriliumUrlFromArgs(commandLine);
        if (protocolUrl) {
            const noteId = parseTriliumUrl(protocolUrl);
            if (noteId) {
                navigateToNote(noteId);
                return;
            }
        }

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
 */
function getUserData() {
    const name = `${app.getName()}-${port}`;
    return join(app.getPath("appData"), name);
}

async function onReady() {
    //    app.setAppUserModelId('com.github.zadam.trilium');

    // if db is not initialized -> setup process
    // if db is initialized, then we need to wait until the migration process is finished
    if (sqlInit.isDbInitialized()) {
        await sqlInit.dbReady;

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
