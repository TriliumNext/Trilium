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

let startupDeepLink: string | null = null;
const pendingDeepLinks: string[] = [];

async function main() {
    startupDeepLink = findDeepLinkArg(process.argv);

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

    app.on("second-instance", (_event: unknown, commandLine: string[]) => {
        const lastFocusedWindow = windowService.getLastFocusedWindow();
        const deepLink = findDeepLinkArg(commandLine);

        if (deepLink) {
            openDeepLink(deepLink);
            return;
        }

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

    app.on("open-url", (event: { preventDefault: () => void }, url: string) => {
        event.preventDefault();
        openDeepLink(url);
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
    if (!app.isPackaged) {
        app.setAsDefaultProtocolClient("trilium", process.execPath, [resolve(process.argv[1])]);
    } else {
        app.setAsDefaultProtocolClient("trilium");
    }

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

    if (startupDeepLink) {
        openDeepLink(startupDeepLink);
        startupDeepLink = null;
    }

    flushPendingDeepLinks();
}

function getElectronLocale() {
    const uiLocale = options.getOptionOrNull("locale");
    const formattingLocale = options.getOptionOrNull("formattingLocale");
    const correspondingLocale = LOCALES.find(l => l.id === uiLocale);

    // For RTL, we have to force the UI locale to align the window buttons properly.
    if (formattingLocale && !correspondingLocale?.rtl) return formattingLocale;

    return uiLocale || "en"
}

function findDeepLinkArg(args: string[]) {
    return args.find((arg) => arg?.startsWith("trilium://")) || null;
}

function parseDeepLinkNoteId(deepLink: string) {
    try {
        const parsed = new URL(deepLink);
        if (parsed.protocol !== "trilium:") {
            return null;
        }

        if (parsed.hostname !== "note") {
            return null;
        }

        const noteId = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
        if (!noteId || !/^[A-Za-z0-9_]{4,}$/.test(noteId)) {
            return null;
        }

        return noteId;
    } catch {
        return null;
    }
}

function openDeepLink(deepLink: string) {
    const noteId = parseDeepLinkNoteId(deepLink);
    if (!noteId) {
        return;
    }

    const targetWindow = windowService.getLastFocusedWindow() || windowService.getMainWindow();
    if (!targetWindow || targetWindow.isDestroyed()) {
        pendingDeepLinks.push(deepLink);
        return;
    }

    if (targetWindow.isMinimized()) {
        targetWindow.restore();
    }
    targetWindow.show();
    targetWindow.focus();
    targetWindow.webContents.send("openInSameTab", noteId);
}

function flushPendingDeepLinks() {
    const pending = [...pendingDeepLinks];
    pendingDeepLinks.length = 0;

    for (const deepLink of pending) {
        openDeepLink(deepLink);
    }
}

main();
