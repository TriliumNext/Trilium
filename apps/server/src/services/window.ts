import fs from "fs/promises";
import path from "path";
import url from "url";
import port from "./port.js";
import optionService from "./options.js";
import log from "./log.js";
import sqlInit from "./sql_init.js";
import cls from "./cls.js";
import keyboardActionsService from "./keyboard_actions.js";
import electron from "electron";
import type { App, BrowserWindowConstructorOptions, BrowserWindow, WebContents } from "electron";
import { formatDownloadTitle, isDev, isMac, isWindows } from "./utils.js";
import { t } from "i18next";
import { RESOURCE_DIR } from "./resource_dir.js";

// Prevent the window being garbage collected
let mainWindow: BrowserWindow | null;
let setupWindow: BrowserWindow | null;
let allWindows: BrowserWindow[] = []; // // Used to store all windows, sorted by the order of focus.

function trackWindowFocus(win: BrowserWindow) {
    // We need to get the last focused window from allWindows. If the last window is closed, we return the previous window.
    // Therefore, we need to push the window into the allWindows array every time it gets focused.
    win.on("focus", () => {
        allWindows = allWindows.filter(w => !w.isDestroyed() && w !== win);
        allWindows.push(win);
        if (!optionService.getOptionBool("disableTray")) {
            electron.ipcMain.emit("reload-tray");
        }
    });

    win.on("closed", () => {
        allWindows = allWindows.filter(w => !w.isDestroyed());
        if (!optionService.getOptionBool("disableTray")) {
            electron.ipcMain.emit("reload-tray");
        }
    });
}

async function createExtraWindow(extraWindowHash: string) {
    const spellcheckEnabled = optionService.getOptionBool("spellCheckEnabled");

    const { BrowserWindow } = await import("electron");

    const win = new BrowserWindow({
        width: 1000,
        height: 800,
        title: "Trilium Notes",
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            spellcheck: spellcheckEnabled
        },
        ...getWindowExtraOpts(),
        icon: getIcon()
    });

    win.setMenuBarVisibility(false);
    win.loadURL(`http://127.0.0.1:${port}/?extraWindow=1${extraWindowHash}`);

    configureWebContents(win.webContents, spellcheckEnabled);

    trackWindowFocus(win);
}

electron.ipcMain.on("create-extra-window", (event, arg) => {
    createExtraWindow(arg.extraWindowHash);
});

interface ExportAsPdfOpts {
    title: string;
    landscape: boolean;
    pageSize: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6" | "Legal" | "Letter" | "Tabloid" | "Ledger";
}

electron.ipcMain.on("export-as-pdf", async (e, opts: ExportAsPdfOpts) => {
    const browserWindow = electron.BrowserWindow.fromWebContents(e.sender);
    if (!browserWindow) {
        return;
    }

    const filePath = electron.dialog.showSaveDialogSync(browserWindow, {
        defaultPath: formatDownloadTitle(opts.title, "file", "application/pdf"),
        filters: [
            {
                name: t("pdf.export_filter"),
                extensions: ["pdf"]
            }
        ]
    });
    if (!filePath) {
        return;
    }

    let buffer: Buffer;
    try {
        buffer = await browserWindow.webContents.printToPDF({
            landscape: opts.landscape,
            pageSize: opts.pageSize,
            generateDocumentOutline: true,
            generateTaggedPDF: true,
            printBackground: true,
            displayHeaderFooter: true,
            headerTemplate: `<div></div>`,
            footerTemplate: `
                <div class="pageNumber" style="width: 100%; text-align: center; font-size: 10pt;">
                </div>
            `
        });
    } catch (e) {
        electron.dialog.showErrorBox(t("pdf.unable-to-export-title"), t("pdf.unable-to-export-message"));
        return;
    }

    try {
        await fs.writeFile(filePath, buffer);
    } catch (e) {
        electron.dialog.showErrorBox(t("pdf.unable-to-export-title"), t("pdf.unable-to-save-message"));
        return;
    }

    electron.shell.openPath(filePath);
});

async function createMainWindow(app: App) {
    if ("setUserTasks" in app) {
        app.setUserTasks([
            {
                program: process.execPath,
                arguments: "--new-window",
                iconPath: process.execPath,
                iconIndex: 0,
                title: "Open New Window",
                description: "Open new window"
            }
        ]);
    }

    const windowStateKeeper = (await import("electron-window-state")).default; // should not be statically imported

    const mainWindowState = windowStateKeeper({
        // default window width & height, so it's usable on a 1600 * 900 display (including some extra panels etc.)
        defaultWidth: 1200,
        defaultHeight: 800
    });

    const spellcheckEnabled = optionService.getOptionBool("spellCheckEnabled");

    const { BrowserWindow } = await import("electron"); // should not be statically imported

    mainWindow = new BrowserWindow({
        x: mainWindowState.x,
        y: mainWindowState.y,
        width: mainWindowState.width,
        height: mainWindowState.height,
        minWidth: 500,
        minHeight: 400,
        title: "Trilium Notes",
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            spellcheck: spellcheckEnabled,
            webviewTag: true
        },
        icon: getIcon(),
        ...getWindowExtraOpts()
    });

    mainWindowState.manage(mainWindow);

    mainWindow.setMenuBarVisibility(false);
    mainWindow.loadURL(`http://127.0.0.1:${port}`);
    mainWindow.on("closed", () => (mainWindow = null));

    configureWebContents(mainWindow.webContents, spellcheckEnabled);

    app.on("second-instance", (event, commandLine) => {
        const lastFocusedWindow = getLastFocusedWindow();
        if (commandLine.includes("--new-window")) {
            createExtraWindow("");
        } else if (lastFocusedWindow) {
            // Someone tried to run a second instance, we should focus our window.
            // see www.ts "requestSingleInstanceLock" for the rest of this logic with explanation
            if (lastFocusedWindow.isMinimized()) {
                lastFocusedWindow.restore();
            }
            lastFocusedWindow.show();
            lastFocusedWindow.focus();
        }
    });

    trackWindowFocus(mainWindow);
}

function getWindowExtraOpts() {
    const extraOpts: Partial<BrowserWindowConstructorOptions> = {};

    if (!optionService.getOptionBool("nativeTitleBarVisible")) {
        if (isMac) {
            extraOpts.titleBarStyle = "hiddenInset";
            extraOpts.titleBarOverlay = true;
        } else if (isWindows) {
            extraOpts.titleBarStyle = "hidden";
            extraOpts.titleBarOverlay = true;
        } else {
            // Linux or other platforms.
            extraOpts.frame = false;
        }
    }

    // Window effects (Mica)
    if (optionService.getOptionBool("backgroundEffects")) {
        if (isMac) {
            // Vibrancy not yet supported.
        } else if (isWindows) {
            extraOpts.backgroundMaterial = "auto";
        } else {
            // Linux or other platforms.
            extraOpts.transparent = true;
        }
    }

    return extraOpts;
}

async function configureWebContents(webContents: WebContents, spellcheckEnabled: boolean) {
    const remoteMain = (await import("@electron/remote/main/index.js")).default;
    remoteMain.enable(webContents);

    webContents.setWindowOpenHandler((details) => {
        async function openExternal() {
            (await import("electron")).shell.openExternal(details.url);
        }

        openExternal();
        return { action: "deny" };
    });

    // prevent drag & drop to navigate away from trilium
    webContents.on("will-navigate", (ev, targetUrl) => {
        const parsedUrl = url.parse(targetUrl);

        // we still need to allow internal redirects from setup and migration pages
        if (!["localhost", "127.0.0.1"].includes(parsedUrl.hostname || "") || (parsedUrl.path && parsedUrl.path !== "/" && parsedUrl.path !== "/?")) {
            ev.preventDefault();
        }
    });

    if (spellcheckEnabled) {
        const languageCodes = optionService
            .getOption("spellCheckLanguageCode")
            .split(",")
            .map((code) => code.trim());

        webContents.session.setSpellCheckerLanguages(languageCodes);
    }
}

function getIcon() {
    return path.join(RESOURCE_DIR, "../public/assets/icon.png");
}

async function createSetupWindow() {
    const { BrowserWindow } = await import("electron"); // should not be statically imported
    const width = 750;
    const height = 650;
    setupWindow = new BrowserWindow({
        width,
        height,
        resizable: false,
        title: "Trilium Notes Setup",
        icon: getIcon(),
        webPreferences: {
            // necessary for e.g. utils.isElectron()
            nodeIntegration: true
        }
    });

    setupWindow.setMenuBarVisibility(false);
    setupWindow.loadURL(`http://127.0.0.1:${port}`);
    setupWindow.on("closed", () => (setupWindow = null));
}

function closeSetupWindow() {
    if (setupWindow) {
        setupWindow.close();
    }
}

async function registerGlobalShortcuts() {
    const { globalShortcut } = await import("electron");

    await sqlInit.dbReady;

    const allActions = keyboardActionsService.getKeyboardActions();

    for (const action of allActions) {
        if (!("effectiveShortcuts" in action) || !action.effectiveShortcuts) {
            continue;
        }

        for (const shortcut of action.effectiveShortcuts) {
            if (shortcut.startsWith("global:")) {
                const translatedShortcut = shortcut.substr(7);

                const result = globalShortcut.register(
                    translatedShortcut,
                    cls.wrap(() => {
                        if (!mainWindow) {
                            return;
                        }

                        // window may be hidden / not in focus
                        mainWindow.focus();

                        mainWindow.webContents.send("globalShortcut", action.actionName);
                    })
                );

                if (result) {
                    log.info(`Registered global shortcut ${translatedShortcut} for action ${action.actionName}`);
                } else {
                    log.info(`Could not register global shortcut ${translatedShortcut}`);
                }
            }
        }
    }
}

function getMainWindow() {
    return mainWindow;
}

function getLastFocusedWindow() {
    return allWindows.length > 0 ? allWindows[allWindows.length - 1] : null;
}

function getAllWindows() {
    return allWindows;
}

export default {
    createMainWindow,
    createSetupWindow,
    closeSetupWindow,
    registerGlobalShortcuts,
    getMainWindow,
    getLastFocusedWindow,
    getAllWindows
};
