import { type App, type BrowserWindow, type BrowserWindowConstructorOptions, default as electron, ipcMain, type IpcMainEvent, type WebContents } from "electron";
import fs from "fs/promises";
import { t } from "i18next";
import path from "path";
import url from "url";

import cls from "./cls.js";
import keyboardActionsService from "./keyboard_actions.js";
import log from "./log.js";
import optionService from "./options.js";
import port from "./port.js";
import { RESOURCE_DIR } from "./resource_dir.js";
import sqlInit from "./sql_init.js";
import { formatDownloadTitle, isMac, isWindows } from "./utils.js";

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

interface PrintOpts {
    notePath: string;
    printToPdf: boolean;
}

interface ExportAsPdfOpts {
    notePath: string;
    title: string;
    landscape: boolean;
    pageSize: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6" | "Legal" | "Letter" | "Tabloid" | "Ledger";
}

electron.ipcMain.on("print-note", async (e, { notePath }: PrintOpts) => {
    const { browserWindow, printReport } = await getBrowserWindowForPrinting(e, notePath, "printing");
    browserWindow.webContents.print({}, (success, failureReason) => {
        if (!success && failureReason !== "Print job canceled") {
            electron.dialog.showErrorBox(t("pdf.unable-to-print"), failureReason);
        }
        e.sender.send("print-done", printReport);
        browserWindow.destroy();
    });
});

electron.ipcMain.on("export-as-pdf", async (e, { title, notePath, landscape, pageSize }: ExportAsPdfOpts) => {
    const { browserWindow, printReport } = await getBrowserWindowForPrinting(e, notePath, "exporting_pdf");

    async function print() {
        const filePath = electron.dialog.showSaveDialogSync(browserWindow, {
            defaultPath: formatDownloadTitle(title, "file", "application/pdf"),
            filters: [
                {
                    name: t("pdf.export_filter"),
                    extensions: ["pdf"]
                }
            ]
        });
        if (!filePath) return;

        let buffer: Buffer;
        try {
            buffer = await browserWindow.webContents.printToPDF({
                landscape,
                pageSize,
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
        } catch (_e) {
            electron.dialog.showErrorBox(t("pdf.unable-to-export-title"), t("pdf.unable-to-export-message"));
            return;
        }

        try {
            await fs.writeFile(filePath, buffer);
        } catch (_e) {
            electron.dialog.showErrorBox(t("pdf.unable-to-export-title"), t("pdf.unable-to-save-message"));
            return;
        }

        electron.shell.openPath(filePath);
    }

    try {
        await print();
    } finally {
        e.sender.send("print-done", printReport);
        browserWindow.destroy();
    }
});

async function getBrowserWindowForPrinting(e: IpcMainEvent, notePath: string, action: "printing" | "exporting_pdf") {
    const browserWindow = new electron.BrowserWindow({
        show: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            offscreen: true,
            session: e.sender.session
        },
    });

    const progressCallback = (_e, progress: number) => e.sender.send("print-progress", { progress, action });
    ipcMain.on("print-progress", progressCallback);

    await browserWindow.loadURL(`http://127.0.0.1:${port}/?print#${notePath}`);
    const printReport = await browserWindow.webContents.executeJavaScript(`
        new Promise(resolve => {
            if (window._noteReady) return resolve(window._noteReady);
            window.addEventListener("note-ready", (data) => resolve(data.detail));
        });
    `);
    ipcMain.off("print-progress", progressCallback);
    return { browserWindow, printReport };
}

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
    const remoteMain = (await import("@electron/remote/main/index.js"));
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
    if (process.env.NODE_ENV === "development") {
        return path.join(__dirname, "../../../desktop/electron-forge/app-icon/png/256x256-dev.png");
    }
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
                        const targetWindow = getLastFocusedWindow() || mainWindow;
                        if (!targetWindow || targetWindow.isDestroyed()) {
                            return;
                        }

                        if (action.actionName === "toggleTray") {
                            targetWindow.focus();
                        } else {
                            showAndFocusWindow(targetWindow);
                        }

                        targetWindow.webContents.send("globalShortcut", action.actionName);
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

function showAndFocusWindow(window: BrowserWindow) {
    if (!window) return;

    if (window.isMinimized()) {
        window.restore();
    }

    window.show();
    window.focus();
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
    createExtraWindow,
    createSetupWindow,
    closeSetupWindow,
    registerGlobalShortcuts,
    getMainWindow,
    getLastFocusedWindow,
    getAllWindows
};
