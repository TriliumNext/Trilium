import type { KeyboardActionNames } from "@triliumnext/commons";
import { becca, becca_service, type BNote, type BRecentNote, cls, date_notes, options as optionService, sql_init, utils as coreUtils } from "@triliumnext/core";
import { getResourceDir } from "@triliumnext/server/src/services/utils.js";
import windowService from "./window.js";
import type { BrowserWindow, Tray } from "electron";
import electron from "electron";
import { default as i18next, t } from "i18next";
import path from "path";

let tray: Tray | null = null;
let listenersRegistered = false;
// `mainWindow.isVisible` doesn't work with `mainWindow.show` and `mainWindow.hide` - it returns `false` when the window
// is minimized
const windowVisibilityMap: Record<number, boolean> = {};; // Dictionary for storing window ID and its visibility status

function getTrayIconPath() {
    let name: string;
    if (coreUtils.isMac()) {
        name = "icon-blackTemplate";
    } else if (coreUtils.isDev()) {
        name = "icon-purple";
    } else {
        name = "icon-color";
    }

    if (process.env.NODE_ENV === "development") {
        return path.join(__dirname, "..", "assets", "images", "tray", `${name}.png`);
    }
    return path.resolve(path.join(getResourceDir(), "assets", "images", "tray", `${name}.png`));

}

function getIconPath(name: string) {
    const suffix = !coreUtils.isMac() && electron.nativeTheme.shouldUseDarkColors ? "-inverted" : "";

    if (process.env.NODE_ENV === "development") {
        return path.join(__dirname, "..", "assets", "images", "tray", `${name}Template${suffix}.png`);
    }
    return path.resolve(path.join(getResourceDir(), "assets", "images", "tray", `${name}Template${suffix}.png`));

}

function registerVisibilityListener(window: BrowserWindow) {
    /* v8 ignore next 3 -- defensive: only ever called with a real window from updateWindowVisibilityMap's forEach */
    if (!window) {
        return;
    }

    // They need to be registered before the tray updater is registered
    window.on("show", () => {
        windowVisibilityMap[window.id] = true;
        updateTrayMenu();
    });
    window.on("hide", () => {
        windowVisibilityMap[window.id] = false;
        updateTrayMenu();
    });

    window.on("minimize", updateTrayMenu);
    window.on("maximize", updateTrayMenu);
}

function getWindowTitle(window: BrowserWindow | null) {
    /* v8 ignore next 3 -- defensive: only called with a window already null-checked via `if (!win) continue` */
    if (!window) {
        return;
    }
    const title = window.getTitle();
    const titleWithoutAppName = title.replace(/\s-\s[^-]+$/, ''); // Remove the name of the app

    // Limit title maximum length to 17
    if (titleWithoutAppName.length > 20) {
        return `${titleWithoutAppName.substring(0, 17)  }...`;
    }

    return titleWithoutAppName;
}

function updateWindowVisibilityMap(allWindows: BrowserWindow[]) {
    const currentWindowIds: number[] = allWindows.map(window => window.id);

    // Deleting closed windows from windowVisibilityMap
    for (const [id, _] of Object.entries(windowVisibilityMap)) {
        const windowId = Number(id);
        if (!currentWindowIds.includes(windowId)) {
            delete windowVisibilityMap[windowId];
        }
    }

    // Iterate through allWindows to make sure the ID of each window exists in windowVisibilityMap
    allWindows.forEach(window => {
        const windowId = window.id;
        if (!(windowId in windowVisibilityMap)) {
            // Newly created window: seed from its actual state rather than assuming
            // visible, so a window created hidden (hide-on-autostart) is tracked as
            // hidden and the tray can bring it into view.
            windowVisibilityMap[windowId] = window.isVisible();
            registerVisibilityListener(window);
        }
    });
}


function updateTrayMenu() {
    /* v8 ignore next 3 -- defensive: every call site runs after `tray` is assigned in createTray */
    if (!tray) {
        return;
    }
    const lastFocusedWindow = windowService.getLastFocusedWindow();
    const allWindows = windowService.getAllWindows();
    updateWindowVisibilityMap(allWindows);

    function ensureVisible(win: BrowserWindow) {
        /* v8 ignore next -- defensive: always called with a truthy window (focused window or null-checked checkbox window) */
        if (win) {
            win.show();
            win.focus();
        }
    }

    function openNewWindow() {
        if (lastFocusedWindow){
            lastFocusedWindow.webContents.send("globalShortcut", "openNewWindow");
        }
    }

    function triggerKeyboardAction(actionName: KeyboardActionNames) {
        if (lastFocusedWindow){
            lastFocusedWindow.webContents.send("globalShortcut", actionName);
            ensureVisible(lastFocusedWindow);
        }
    }

    function openInSameTab(note: BNote | BRecentNote) {
        if (lastFocusedWindow){
            lastFocusedWindow.webContents.send("openInSameTab", note.noteId);
            ensureVisible(lastFocusedWindow);
        }
    }

    function buildBookmarksMenu() {
        const parentNote = becca.getNoteOrThrow("_lbBookmarks");
        const menuItems: Electron.MenuItemConstructorOptions[] = [];

        /* v8 ignore next -- defensive: getNoteOrThrow never returns null and BNote.children is always an array */
        for (const bookmarkNote of parentNote?.children ?? []) {
            if (bookmarkNote.isLabelTruthy("bookmarkFolder")) {
                menuItems.push({
                    label: bookmarkNote.title,
                    type: "submenu",
                    submenu: bookmarkNote.children.map((subitem) => {
                        return {
                            label: subitem.title,
                            type: "normal",
                            click: () => openInSameTab(subitem)
                        };
                    })
                });
            } else {
                menuItems.push({
                    label: bookmarkNote.title,
                    type: "normal",
                    click: () => openInSameTab(bookmarkNote)
                });
            }
        }

        return menuItems;
    }

    function buildRecentNotesMenu() {
        const recentNotes = becca.getRecentNotesFromQuery(`
            SELECT recent_notes.*
            FROM recent_notes
            JOIN notes USING(noteId)
            WHERE notes.isDeleted = 0
            ORDER BY utcDateCreated DESC
            LIMIT 10
        `);
        const menuItems: Electron.MenuItemConstructorOptions[] = [];
        const formatter = new Intl.DateTimeFormat(undefined, {
            dateStyle: "short",
            timeStyle: "short"
        });

        for (const recentNote of recentNotes) {
            const date = new Date(recentNote.utcDateCreated);

            menuItems.push({
                label: becca_service.getNoteTitle(recentNote.noteId),
                type: "normal",
                sublabel: formatter.format(date),
                click: () => openInSameTab(recentNote)
            });
        }

        return menuItems;
    }

    const windowVisibilityMenuItems: Electron.MenuItemConstructorOptions[] = [];

    // Only call getWindowTitle if windowVisibilityMap has more than one window
    const showTitle = Object.keys(windowVisibilityMap).length > 1;

    for (const idStr in windowVisibilityMap) {
        const id = parseInt(idStr, 10); // Get the ID of the window and make sure it is a number
        const isVisible = windowVisibilityMap[id];
        const win = allWindows.find(w => w.id === id);
        /* v8 ignore next 3 -- defensive: windowVisibilityMap was just pruned to ids present in allWindows */
        if (!win) {
            continue;
        }
        windowVisibilityMenuItems.push({
            label: showTitle ? `${t("tray.show-windows")}: ${getWindowTitle(win)}` : t("tray.show-windows"),
            type: "checkbox",
            checked: isVisible,
            click: () => {
                if (isVisible) {
                    win.hide();
                    windowVisibilityMap[id] = false;
                } else {
                    ensureVisible(win);
                    windowVisibilityMap[id] = true;
                }
            }
        });
    }


    const contextMenu = electron.Menu.buildFromTemplate([
        ...windowVisibilityMenuItems,
        { type: "separator" },
        {
            label: t("tray.open_new_window"),
            type: "normal",
            icon: getIconPath("new-window"),
            click: () => openNewWindow()
        },
        {
            label: t("tray.new-note"),
            type: "normal",
            icon: getIconPath("new-note"),
            click: () => triggerKeyboardAction("createNoteIntoInbox")
        },
        {
            label: t("tray.today"),
            type: "normal",
            icon: getIconPath("today"),
            click: cls.wrap(async () => openInSameTab(await date_notes.getTodayNote()))
        },
        {
            label: t("tray.bookmarks"),
            type: "submenu",
            icon: getIconPath("bookmarks"),
            submenu: buildBookmarksMenu()
        },
        {
            label: t("tray.recents"),
            type: "submenu",
            icon: getIconPath("recents"),
            submenu: buildRecentNotesMenu()
        },
        { type: "separator" },
        {
            label: t("tray.close"),
            type: "normal",
            icon: getIconPath("close"),
            // Genuinely quit. `app.quit()` triggers `before-quit`, which clears the
            // close-to-tray interception so the windows close for real instead of
            // hiding back to the tray. Works on macOS too (where closing the last
            // window does not quit by itself).
            click: () => electron.app.quit()
        }
    ]);

    tray?.setContextMenu(contextMenu);
}

function changeVisibility() {
    // Fall back to the main window: a window started hidden (hide-on-autostart)
    // has never been focused, so it isn't in the focus list yet — but it's still
    // the thing the tray click should reveal.
    const targetWindow = windowService.getLastFocusedWindow() ?? windowService.getMainWindow();

    if (!targetWindow) {
        return;
    }

    // If the window is visible, hide it
    if (windowVisibilityMap[targetWindow.id]) {
        targetWindow.hide();
    } else {
        targetWindow.show();
        targetWindow.focus();
    }
}

function createTray() {
    tray = new electron.Tray(getTrayIconPath());
    tray.setToolTip(t("tray.tooltip"));
    // Restore focus
    tray.on("click", changeVisibility);
    updateTrayMenu();
}

function destroyTray() {
    if (!tray) {
        return;
    }

    // Best-effort: on Windows, macOS and most Linux DEs this removes the icon
    // immediately. On GNOME the StatusNotifier host ignores the unregister, so
    // the icon lingers until the app restarts — upstream Electron bug #24976,
    // with no app-level workaround.
    tray.destroy();
    tray = null;
}

/**
 * Reconciles the tray with the current `disableTray` option so the setting takes
 * effect without restarting the app. This is the single entry point for the
 * `reload-tray` IPC the renderer sends after the option changes, as well as for
 * window focus/close, theme and language changes — it creates, destroys or just
 * refreshes the tray as appropriate.
 */
function reloadTray() {
    if (optionService.getOptionBool("disableTray")) {
        destroyTray();
        return;
    }

    if (tray) {
        updateTrayMenu();
    } else {
        createTray();
    }
}

/**
 * Registers the long-lived listeners exactly once. Deferred until a real window
 * exists (rather than run from {@link setupSystemTray}) because `isMac()` needs
 * the core to be initialised, which isn't guaranteed during the early Electron
 * startup when `setupSystemTray` runs.
 */
function registerTrayListeners() {
    if (listenersRegistered) {
        return;
    }
    listenersRegistered = true;

    electron.ipcMain.on("reload-tray", reloadTray);
    if (!coreUtils.isMac()) {
        // macOS uses template icons which work great on dark & light themes.
        electron.nativeTheme.on("updated", updateTrayMenu);
    }
    i18next.on("languageChanged", updateTrayMenu);
}

/**
 * Arms the system tray to appear as soon as a real (post-setup) window exists.
 *
 * Skipping while the DB is uninitialised avoids attaching a tray to the setup
 * wizard, where it would block the app from quitting via "close last window".
 * Both {@link registerTrayListeners} and {@link reloadTray} are idempotent, so
 * subsequent windows (extra windows, the macOS "activate" re-creation path) just
 * refresh the existing tray.
 */
export function setupSystemTray() {
    electron.app.on("browser-window-created", () => {
        if (sql_init.isDbInitialized()) {
            registerTrayListeners();
            reloadTray();
        }
    });
}
