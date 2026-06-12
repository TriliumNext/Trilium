import { app_info, cls, events, getLog, keyboard_actions as keyboardActionsService, options as optionService, sql_init, utils as coreUtils } from "@triliumnext/core";
import { RESOURCE_DIR } from "@triliumnext/server/src/services/resource_dir.js";
import { type BrowserWindow, type BrowserWindowConstructorOptions, default as electron, type Session, type WebContents } from "electron";
import path from "path";

import { markStartupMetric } from "./startup_metrics.js";
import { TRILIUM_APP_BASE_URL } from "./trilium_app_origin.js";
import { setupWebContentsSecurity } from "./web_contents_security.js";

// Preload bundle path. Two layouts:
//   - Dev: this file lives at apps/desktop/src/services/window.ts, and the
//     preload bundle is one level up at apps/desktop/src/preload.compiled.cjs
//     (built in place by scripts/electron-start.mts).
//   - Prod: this file is bundled into apps/desktop/dist/main.cjs, with
//     preload.cjs sitting next to it in dist/ (NOT one level up — getting
//     this wrong leaves the renderer without `window.electronApi`).
//
// Lazy: `coreUtils.isDev()` calls `getPlatform()` which throws until
// `initializeCore()` has run; module load happens before that.
let preloadScriptCache: string | undefined;
function getPreloadScript(): string {
    if (preloadScriptCache === undefined) {
        /* v8 ignore next 5 -- prod preload arm is cache-once (only the first ternary evaluation counts); covered by the production build, not unit tests */
        preloadScriptCache = path.resolve(
            coreUtils.isDev()
                ? path.join(__dirname, "..", "preload.compiled.cjs")
                : path.join(__dirname, "preload.cjs")
        );
    }
    return preloadScriptCache;
}

// Prevent the window being garbage collected
let mainWindow: BrowserWindow | null;
let setupWindow: BrowserWindow | null;
let allWindows: BrowserWindow[] = []; // Used to store all windows, sorted by the order of focus.
const loadedSpellcheckSessions = new WeakSet<Session>();

// Set on "before-quit" (tray quit menu, Cmd+Q, app.quit()) so that an explicit
// quit is never intercepted by the close-to-tray handler below.
let isQuitting = false;

/** Hide-to-tray only applies while a tray icon exists to restore the window from. */
function shouldHideToTray(optionName: "minimizeToTray" | "closeToTray") {
    return !optionService.getOptionBool("disableTray") && optionService.getOptionBool(optionName);
}

/**
 * Hides the window to the tray instead of minimizing/closing it, when the
 * corresponding option is enabled (#3743). Hidden windows are restored from
 * the tray icon or its context menu.
 */
function installHideToTrayHandlers(win: BrowserWindow) {
    // The minimize event is not preventable, so the window is hidden after the
    // fact; restoring from the tray un-minimizes it (see showAndFocusWindow).
    win.on("minimize", () => {
        if (shouldHideToTray("minimizeToTray")) {
            win.hide();
        }
    });

    win.on("close", (event) => {
        if (!isQuitting && shouldHideToTray("closeToTray")) {
            event.preventDefault();
            win.hide();
        }
    });
}

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
            preload: getPreloadScript(),
            spellcheck: spellcheckEnabled,
            webviewTag: true
        },
        ...getWindowExtraOpts(),
        icon: getIcon()
    });

    win.setMenuBarVisibility(false);
    win.loadURL(`${TRILIUM_APP_BASE_URL}?extraWindow=1${extraWindowHash}`);

    configureWebContents(win.webContents, spellcheckEnabled);

    installHideToTrayHandlers(win);
    trackWindowFocus(win);
}

async function createMainWindow() {
    if ("setUserTasks" in electron.app) {
        electron.app.setUserTasks([
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
            preload: getPreloadScript(),
            spellcheck: spellcheckEnabled,
            webviewTag: true
        },
        icon: getIcon(),
        ...getWindowExtraOpts()
    });

    markStartupMetric("main-window-created");
    // First time the renderer has produced a frame of the page — the closest
    // main-process signal to "the window displays something".
    mainWindow.once("ready-to-show", () => markStartupMetric("main-window-first-paint"));
    mainWindow.webContents.once("did-finish-load", () => markStartupMetric("main-window-load-finished"));

    mainWindowState.manage(mainWindow);

    mainWindow.setMenuBarVisibility(false);
    mainWindow.loadURL(TRILIUM_APP_BASE_URL);
    mainWindow.on("closed", () => (mainWindow = null));

    configureWebContents(mainWindow.webContents, spellcheckEnabled);
    installHideToTrayHandlers(mainWindow);
    trackWindowFocus(mainWindow);
}

function getWindowExtraOpts() {
    const extraOpts: Partial<BrowserWindowConstructorOptions> = {};

    if (!optionService.getOptionBool("nativeTitleBarVisible")) {
        if (coreUtils.isMac()) {
            extraOpts.titleBarStyle = "hiddenInset";
            extraOpts.titleBarOverlay = true;
        } else if (coreUtils.isWindows()) {
            extraOpts.titleBarStyle = "hidden";
            extraOpts.titleBarOverlay = true;
        } else {
            // Linux or other platforms.
            extraOpts.frame = false;
        }

        // Window effects (Mica on Windows and Vibrancy on macOS)
        // These only work if native title bar is not enabled.
        if (optionService.getOptionBool("backgroundEffects")) {
            if (coreUtils.isMac()) {
                extraOpts.transparent = true;
                extraOpts.visualEffectState = "active";
            } else if (coreUtils.isWindows()) {
                extraOpts.backgroundMaterial = "auto";
            }
        }
    }

    return extraOpts;
}

async function configureWebContents(webContents: WebContents, spellcheckEnabled: boolean) {
    // Window-open and navigation policy is NOT applied here: it is installed
    // globally for every WebContents (including setup and print windows,
    // which never pass through this function) by web_contents_security.ts.

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

    // Keep the renderer informed about whether DevTools is docked into this window, where
    // Chromium disables the native window material (Mica / vibrancy) and the renderer should
    // suspend its transparent background effects. Re-checked on focus because re-docking an
    // already open DevTools emits no dedicated event.
    const sendDevToolsDockState = () => webContents.send("dev-tools-dock-changed", isDevToolsDocked(webContents));
    webContents.on("devtools-opened", sendDevToolsDockState);
    webContents.on("devtools-focused", sendDevToolsDockState);
    webContents.on("devtools-closed", sendDevToolsDockState);

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

/** Whether DevTools for the given contents is open and docked into the page's own window (as opposed to a separate window). */
function isDevToolsDocked(webContents: WebContents) {
    const devToolsWebContents = webContents.devToolsWebContents;
    if (!webContents.isDevToolsOpened() || !devToolsWebContents) {
        return false;
    }

    // A docked DevTools view is hosted by the same BrowserWindow as the page itself; when
    // detached it lives in its own native window, which is not a BrowserWindow and for which
    // fromWebContents() returns null.
    const devToolsWindow = electron.BrowserWindow.fromWebContents(devToolsWebContents);
    return devToolsWindow !== null && devToolsWindow === electron.BrowserWindow.fromWebContents(webContents);
}

function setupSpellcheckForSession(session: Session) {
    if (!loadedSpellcheckSessions.has(session)) {
        loadedSpellcheckSessions.add(session);

        const languageCodes = optionService
            .getOption("spellCheckLanguageCode")
            .split(",")
            .map((code) => code.trim())
            .filter(Boolean);

        session.setSpellCheckerLanguages(languageCodes);
    }
}

function getIcon() {
    if (process.env.NODE_ENV === "development") {
        return path.join(__dirname, "../../electron-forge/app-icon/png/256x256-dev.png");
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
        ...(coreUtils.isWindows() && { backgroundMaterial: "mica" as const }),
        ...(coreUtils.isMac() && { transparent: true, visualEffectState: "active" as const, vibrancy: "under-window" as const, titleBarStyle: "hiddenInset" as const }),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: getPreloadScript()
        }
    });
    setupWindow.removeMenu();
    setupWindow.loadURL(TRILIUM_APP_BASE_URL);
    setupWindow.on("closed", () => (setupWindow = null));
}

function closeSetupWindow() {
    if (setupWindow) {
        setupWindow.close();
    }
}

async function registerGlobalShortcuts() {
    const { globalShortcut } = await import("electron");

    await sql_init.dbReady;

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
                    getLog().info(`Registered global shortcut ${translatedShortcut} for action ${action.actionName}`);
                } else {
                    getLog().info(`Could not register global shortcut ${translatedShortcut}`);
                }
            }
        }
    }
}

function showAndFocusWindow(window: BrowserWindow) {
    /* v8 ignore next -- defensive guard; every caller passes a non-null window narrowed beforehand */
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

/**
 * Registers the renderer↔main IPC handlers backing `window.electronApi.window.*`
 * and the setup→main window swap that fires when the DB transitions to
 * initialized mid-session.
 *
 * Call once during desktop startup, before `app.ready` fires.
 */
export function setupWindowing() {
    // Window-open, navigation, <webview>-attach and permission policy is applied
    // to every WebContents the app creates. Installed here rather than left to
    // each entry point so a new Electron launcher cannot silently ship without
    // the renderer/main security boundary.
    setupWebContentsSecurity();

    electron.app.on("before-quit", () => {
        isQuitting = true;
    });

    electron.ipcMain.on("create-extra-window", (_event, arg) => {
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
                getLog().error("copy-image-to-clipboard: nativeImage is empty, unsupported format?");
                return;
            }
            electron.clipboard.writeImage(image);
        } catch (e) {
            getLog().error(`copy-image-to-clipboard failed: ${coreUtils.safeExtractMessageAndStackFromError(e)}`);
        }
    });

    electron.ipcMain.handle("read-clipboard-text", () => electron.clipboard.readText());

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

    electron.ipcMain.on("is-dev-tools-docked", (event) => {
        event.returnValue = isDevToolsDocked(event.sender);
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

    // Swap the setup wizard window for the main app window once the DB
    // transitions to initialized mid-session (fresh install / sync-from-server
    // flow). Idempotent: if no setup window exists (e.g., DB was already
    // initialized at startup and main was created in onReady), this is a no-op.
    events.subscribe(events.DB_INITIALIZED, async () => {
        if (!setupWindow) return;
        try {
            await createMainWindow();
            closeSetupWindow();
        } catch (err) {
            getLog().error(`Failed to swap setup window for main window: ${err}`);
        }
    });
}

export default {
    createMainWindow,
    createExtraWindow,
    createSetupWindow,
    closeSetupWindow,
    registerGlobalShortcuts,
    getMainWindow,
    getLastFocusedWindow,
    getAllWindows,
    showAndFocusWindow
};
