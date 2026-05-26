import { execFile } from "child_process";
import { type App, type BrowserWindow, type BrowserWindowConstructorOptions, default as electron, type Session, type WebContents } from "electron";
import path from "path";
import url from "url";

import app_info from "./app_info.js";
import cls from "./cls.js";
import customDictionary from "./custom_dictionary.js";
import dataDirs from "./data_dir.js";
import keyboardActionsService from "./keyboard_actions.js";
import log from "./log.js";
import optionService from "./options.js";
import { initPrintingHandlers } from "./printing.js";
import { RESOURCE_DIR } from "./resource_dir.js";
import {
    validateDownloadUrl,
    validateOpenCustomPath,
    validateOpenExternalUrl,
    validateOpenFileUrl,
    validateOpenPath
} from "./shell_validators.js";
import sqlInit from "./sql_init.js";
import utils, { isDev, isMac, isWindows } from "./utils.js";

const PRELOAD_SCRIPT = path.resolve(
    isDev
        ? path.join(__dirname, "..", "..", "..", "desktop", "src", "preload.compiled.cjs")
        : path.join(__dirname, "preload.cjs")
);

// In dev mode, disable Chromium's HTTP cache so stale assets cached from a
// previous production run (which served `max-age: 1y` headers) don't shadow
// freshly built dev output. Must be set before the app's `ready` event.
if (isDev) {
    electron.app.commandLine.appendSwitch("disable-http-cache");
}

// Prevent the window being garbage collected
let mainWindow: BrowserWindow | null;
let setupWindow: BrowserWindow | null;
let allWindows: BrowserWindow[] = []; // Used to store all windows, sorted by the order of focus.
const loadedSpellcheckSessions = new WeakSet<Session>();

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
            nodeIntegration: false,
            contextIsolation: true,
            preload: PRELOAD_SCRIPT,
            spellcheck: spellcheckEnabled,
            webviewTag: true
        },
        ...getWindowExtraOpts(),
        icon: getIcon()
    });

    win.setMenuBarVisibility(false);
    win.loadURL(`trilium-app://app/?extraWindow=1${extraWindowHash}`);

    configureWebContents(win.webContents, spellcheckEnabled);

    trackWindowFocus(win);
}

async function createWorkspaceWindow(workspaceName: string, dbId: string) {
    const spellcheckEnabled = optionService.getOptionBool("spellCheckEnabled");

    const { BrowserWindow } = await import("electron");

    const win = new BrowserWindow({
        width: 1000,
        height: 800,
        title: `Trilium Notes - ${workspaceName}`,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: PRELOAD_SCRIPT,
            spellcheck: spellcheckEnabled,
            webviewTag: true
        },
        ...getWindowExtraOpts(),
        icon: getIcon()
    });

    win.setMenuBarVisibility(false);
    win.loadURL(`trilium-app://app/?dbId=${encodeURIComponent(dbId)}`);

    configureWebContents(win.webContents, spellcheckEnabled);

    trackWindowFocus(win);
}

electron.ipcMain.on("create-extra-window", (event, arg) => {
    createExtraWindow(arg.extraWindowHash);
});

electron.ipcMain.on("reload-all-windows", () => {
    for (const win of electron.BrowserWindow.getAllWindows()) {
        win.reload();
    }
});

electron.ipcMain.on("restart-app", () => {
    electron.app.relaunch();
    electron.app.exit();
});

electron.ipcMain.on("copy-image-to-clipboard", (_event, buffer: Uint8Array) => {
    try {
        const image = electron.nativeImage.createFromBuffer(Buffer.from(buffer));
        if (image.isEmpty()) {
            console.error("copy-image-to-clipboard: nativeImage is empty, unsupported format?");
            return;
        }
        electron.clipboard.writeImage(image);
    } catch (e) {
        console.error("copy-image-to-clipboard failed:", e);
    }
});

electron.ipcMain.on("show-window", (event) => {
    electron.BrowserWindow.fromWebContents(event.sender)?.show();
});

electron.ipcMain.handle("clear-cache", async (event) => {
    await event.sender.session.clearCache();
});

electron.ipcMain.on("toggle-all-windows", () => {
    const windows = electron.BrowserWindow.getAllWindows();
    const isVisible = windows.every((w) => w.isVisible());
    const action = isVisible ? "hide" : "show";
    for (const win of windows) {
        win[action]();
    }
});

electron.ipcMain.on("add-word-to-dictionary", (event, word: string) => {
    event.sender.session.addWordToSpellCheckerDictionary(word);
    customDictionary.addWord(word);
});

electron.ipcMain.on("get-available-spellchecker-languages", (event) => {
    event.returnValue = event.sender.session.availableSpellCheckerLanguages;
});

// Window management IPC handlers (replacing @electron/remote for renderer access)
electron.ipcMain.on("set-title-bar-overlay", (event, options: { color: string; symbolColor: string }) => {
    electron.BrowserWindow.fromWebContents(event.sender)?.setTitleBarOverlay(options);
});

electron.ipcMain.on("set-window-button-position", (event, position: { x: number; y: number }) => {
    electron.BrowserWindow.fromWebContents(event.sender)?.setWindowButtonPosition(position);
});

electron.ipcMain.on("set-background-material", (event, material: string) => {
    const win = electron.BrowserWindow.fromWebContents(event.sender);
    win?.setBackgroundMaterial(material as Parameters<typeof win.setBackgroundMaterial>[0]);
});

electron.ipcMain.on("set-vibrancy", (event, vibrancy: string) => {
    const win = electron.BrowserWindow.fromWebContents(event.sender);
    win?.setVibrancy(vibrancy as Parameters<typeof win.setVibrancy>[0]);
});

electron.ipcMain.on("clear-navigation-history", (event) => {
    electron.BrowserWindow.fromWebContents(event.sender)?.webContents.navigationHistory.clear();
});

electron.ipcMain.on("set-native-theme-source", (_event, source: "system" | "light" | "dark") => {
    electron.nativeTheme.themeSource = source;
});

electron.ipcMain.on("toggle-dev-tools", (event) => {
    event.sender.toggleDevTools();
});

electron.ipcMain.on("is-full-screen", (event) => {
    event.returnValue = electron.BrowserWindow.fromWebContents(event.sender)?.isFullScreen() ?? false;
});

electron.ipcMain.on("set-full-screen", (event, enabled: boolean) => {
    electron.BrowserWindow.fromWebContents(event.sender)?.setFullScreen(enabled);
});

electron.ipcMain.on("minimize-window", (event) => {
    electron.BrowserWindow.fromWebContents(event.sender)?.minimize();
});

electron.ipcMain.on("maximize-window", (event) => {
    electron.BrowserWindow.fromWebContents(event.sender)?.maximize();
});

electron.ipcMain.on("unmaximize-window", (event) => {
    electron.BrowserWindow.fromWebContents(event.sender)?.unmaximize();
});

electron.ipcMain.on("is-maximized", (event) => {
    event.returnValue = electron.BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false;
});

electron.ipcMain.on("close-window", (event) => {
    electron.BrowserWindow.fromWebContents(event.sender)?.close();
});

electron.ipcMain.on("is-always-on-top", (event) => {
    event.returnValue = electron.BrowserWindow.fromWebContents(event.sender)?.isAlwaysOnTop() ?? false;
});

electron.ipcMain.on("set-always-on-top", (event, enabled: boolean) => {
    electron.BrowserWindow.fromWebContents(event.sender)?.setAlwaysOnTop(enabled);
});

electron.ipcMain.on("web-contents-action", (event, action: string, text?: string) => {
    const wc = event.sender;
    switch (action) {
        case "cut": wc.cut(); break;
        case "copy": wc.copy(); break;
        case "paste": wc.paste(); break;
        case "pasteAndMatchStyle": wc.pasteAndMatchStyle(); break;
        case "insertText": if (text) wc.insertText(text); break;
    }
});

electron.ipcMain.on("open-external", (_event, url: string) => {
    try {
        const validated = validateOpenExternalUrl(url);
        electron.shell.openExternal(validated.toString());
    } catch (e) {
        log.error(`open-external failed: ${utils.safeExtractMessageAndStackFromError(e)}`);
    }
});

electron.ipcMain.handle("open-path", (_event, filePath: string) => {
    try {
        const resolved = validateOpenPath(filePath, dataDirs.TRILIUM_DATA_DIR, dataDirs.TMP_DIR);
        return electron.shell.openPath(resolved);
    } catch (e) {
        log.error(`open-path failed: ${utils.safeExtractMessageAndStackFromError(e)}`);
        return utils.safeExtractMessageAndStackFromError(e);
    }
});

electron.ipcMain.handle("open-file-url", (_event, fileUrl: string) => {
    try {
        const filePath = validateOpenFileUrl(fileUrl);
        return electron.shell.openPath(filePath);
    } catch (e) {
        log.error(`open-file-url failed: ${utils.safeExtractMessageAndStackFromError(e)}`);
        return utils.safeExtractMessageAndStackFromError(e);
    }
});

electron.ipcMain.on("download-url", (event, downloadUrl: string) => {
    try {
        const validated = validateDownloadUrl(downloadUrl, event.sender.getURL());
        event.sender.downloadURL(validated.toString());
    } catch (e) {
        log.error(`download-url failed: ${utils.safeExtractMessageAndStackFromError(e)}`);
    }
});

electron.ipcMain.on("open-custom", (_event, filePath: string) => {
    // Defense in depth: validate the path is one the server itself wrote into
    // Trilium's tmp dir via /api/.../save-to-tmp-dir, and that it exists.
    // Without this, a compromised renderer (e.g. via XSS) could ask us to
    // launch arbitrary local files.
    const resolved = validateOpenCustomPath(filePath, dataDirs.TMP_DIR);

    const platform = process.platform;

    if (platform === "linux") {
        const terminals = ["x-terminal-emulator", "gnome-terminal", "konsole", "xterm", "xfce4-terminal", "mate-terminal", "rxvt", "terminator", "terminology"];

        // The terminal's `-e` argument is reparsed by the terminal's own shell,
        // so the path must be POSIX single-quoted before interpolation.
        const sqQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
        const innerCommand = `mimeopen -d ${sqQuote(resolved)}`;

        const tryTerminal = (index: number) => {
            if (index >= terminals.length) {
                log.error("open-custom: no terminal emulator found");
                electron.shell.openPath(resolved);
                return;
            }
            const terminal = terminals[index];
            execFile(terminal, ["-e", innerCommand], (err) => {
                if (err) {
                    log.info(`open-custom: ${terminal} failed: ${err.message}`);
                    tryTerminal(index + 1);
                }
            });
        };
        tryTerminal(0);
    } else if (platform === "win32") {
        const winPath = resolved.replace(/\//g, "\\");
        // OpenAs_RunDLL doesn't strip surrounding quotes from its arg, so we
        // must NOT let Node quote the path on our behalf. windowsVerbatimArguments
        // is safe here: CreateProcess passes the command line to rundll32 without
        // any shell interpretation (so `&` is inert), and the path is validated
        // above to live inside dataDirs.TMP_DIR with a sanitize-filename'd basename
        // (so it cannot contain quotes or other rundll32-confusing characters).
        execFile("rundll32.exe", ["shell32.dll,OpenAs_RunDLL", winPath], { windowsVerbatimArguments: true }, (err) => {
            if (err) {
                log.error(`open-custom: rundll32 failed: ${err.message}`);
                electron.shell.openPath(resolved);
            }
        });
    } else {
        electron.shell.openPath(resolved);
    }
});

electron.ipcMain.on("navigation-history", (event, method: string) => {
    const wc = event.sender;
    switch (method) {
        case "canGoBack": event.returnValue = wc.navigationHistory.canGoBack(); break;
        case "canGoForward": event.returnValue = wc.navigationHistory.canGoForward(); break;
        case "getAllEntries": event.returnValue = wc.navigationHistory.getAllEntries(); break;
        case "getActiveIndex": event.returnValue = wc.navigationHistory.getActiveIndex(); break;
        case "length": event.returnValue = wc.navigationHistory.length(); break;
        default: event.returnValue = null;
    }
});

electron.ipcMain.on("navigation-history-go-to-index", (event, index: number) => {
    event.sender.navigationHistory.goToIndex(index);
});

initPrintingHandlers(PRELOAD_SCRIPT);

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
            nodeIntegration: false,
            contextIsolation: true,
            preload: PRELOAD_SCRIPT,
            spellcheck: spellcheckEnabled,
            webviewTag: true
        },
        icon: getIcon(),
        ...getWindowExtraOpts()
    });

    mainWindowState.manage(mainWindow);

    mainWindow.setMenuBarVisibility(false);
    mainWindow.loadURL("trilium-app://app/");
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

        // Window effects (Mica on Windows and Vibrancy on macOS)
        // These only work if native title bar is not enabled.
        if (optionService.getOptionBool("backgroundEffects")) {
            if (isMac) {
                extraOpts.transparent = true;
                extraOpts.visualEffectState = "active";
            } else if (isWindows) {
                extraOpts.backgroundMaterial = "auto";
            } else {
                // Linux or other platforms.
                extraOpts.transparent = true;
            }
        }
    }

    return extraOpts;
}

async function configureWebContents(webContents: WebContents, spellcheckEnabled: boolean) {
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
        const isInternal = parsedUrl.protocol === "trilium-app:"
            || ["localhost", "127.0.0.1"].includes(parsedUrl.hostname || "");
        if (!isInternal || (parsedUrl.path && parsedUrl.path !== "/" && parsedUrl.path !== "/?")) {
            ev.preventDefault();
        }
    });

    if (spellcheckEnabled) {
        setupSpellcheckForSession(webContents.session);
    }

    // Forward full-screen events to the renderer via IPC.
    const win = electron.BrowserWindow.fromWebContents(webContents);
    if (win) {
        win.on("enter-full-screen", () => webContents.send("enter-full-screen"));
        win.on("leave-full-screen", () => webContents.send("leave-full-screen"));
    }

    // Forward navigation events to the renderer for back/forward button state.
    webContents.on("did-navigate", () => webContents.send("did-navigate"));
    webContents.on("did-navigate-in-page", () => webContents.send("did-navigate-in-page"));

    // Forward context-menu event to the renderer with only the fields we need.
    webContents.on("context-menu", (_event, params) => {
        webContents.send("context-menu", {
            x: params.x,
            y: params.y,
            linkURL: params.linkURL,
            linkText: params.linkText,
            mediaType: params.mediaType,
            isEditable: params.isEditable,
            selectionText: params.selectionText,
            misspelledWord: params.misspelledWord,
            dictionarySuggestions: params.dictionarySuggestions,
            editFlags: {
                canCut: params.editFlags.canCut,
                canCopy: params.editFlags.canCopy,
                canPaste: params.editFlags.canPaste
            }
        });
    });
}

function setupSpellcheckForSession(session: Session) {
    if (!loadedSpellcheckSessions.has(session)) {
        loadedSpellcheckSessions.add(session);

        const languageCodes = optionService
            .getOption("spellCheckLanguageCode")
            .split(",")
            .map((code) => code.trim());

        session.setSpellCheckerLanguages(languageCodes);
        customDictionary.loadForSession(session)
            .catch(err => log.error(`Failed to load custom dictionary for spellcheck: ${err}`));
    }
}

function getIcon() {
    if (process.env.NODE_ENV === "development") {
        return path.join(__dirname, "../../../desktop/electron-forge/app-icon/png/256x256-dev.png");
    }
    if (app_info.appVersion.includes("test")) {
        return path.join(RESOURCE_DIR, "../public/assets/icon-dev.png");
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
        useContentSize: true,
        resizable: false,
        autoHideMenuBar: true,
        title: "Trilium Notes Setup",
        icon: getIcon(),
        // Background effects (Mica on Windows, vibrancy on macOS)
        ...(isWindows && { backgroundMaterial: "mica" as const }),
        ...(isMac && { transparent: true, visualEffectState: "active" as const, vibrancy: "under-window" as const, titleBarStyle: "hiddenInset" as const }),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: PRELOAD_SCRIPT
        }
    });
    setupWindow.removeMenu();
    setupWindow.loadURL("trilium-app://app/");
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
    createWorkspaceWindow,
    createSetupWindow,
    closeSetupWindow,
    registerGlobalShortcuts,
    getMainWindow,
    getLastFocusedWindow,
    getAllWindows
};
