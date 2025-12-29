import electron from "electron";
import type { BrowserWindow, Tray } from "electron";
import { default as i18next, t } from "i18next";
import path from "path";

import becca from "../becca/becca.js";
import becca_service from "../becca/becca_service.js";
import type BNote from "../becca/entities/bnote.js";
import type BRecentNote from "../becca/entities/brecent_note.js";
import cls from "./cls.js";
import date_notes from "./date_notes.js";
import type { KeyboardActionNames } from "@triliumnext/commons";
import optionService from "./options.js";
import { getResourceDir, isDev, isMac } from "./utils.js";
import windowService from "./window.js";

let tray: Tray;
// `mainWindow.isVisible` doesn't work with `mainWindow.show` and `mainWindow.hide` - it returns `false` when the window
// is minimized
const windowVisibilityMap: Record<number, boolean> = {};; // Dictionary for storing window ID and its visibility status

function getTrayIconPath() {
    let name: string;
    if (isMac) {
        name = "icon-blackTemplate";
    } else if (isDev) {
        name = "icon-purple";
    } else {
        name = "icon-color";
    }

    if (process.env.NODE_ENV === "development") {
        return path.join(__dirname, "../../../desktop/src/assets/images/tray", `${name}.png`);
    } else {
        return path.resolve(path.join(getResourceDir(), "assets", "images", "tray", `${name}.png`));
    }
}

function getIconPath(name: string) {
    const suffix = !isMac && electron.nativeTheme.shouldUseDarkColors ? "-inverted" : "";

    if (process.env.NODE_ENV === "development") {
        return path.join(__dirname, "../../../desktop/src/assets/images/tray", `${name}Template${suffix}.png`);
    } else {
        return path.resolve(path.join(getResourceDir(), "assets", "images", "tray", `${name}Template${suffix}.png`));
    }
}

function registerVisibilityListener(window: BrowserWindow) {
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
    if (!window) {
        return;
    }
    const title = window.getTitle();
    const titleWithoutAppName = title.replace(/\s-\s[^-]+$/, ''); // Remove the name of the app

    // Limit title maximum length to 17
    if (titleWithoutAppName.length > 20) {
        return titleWithoutAppName.substring(0, 17) + '...';
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
            // If it does not exist, it is the newly created window
            windowVisibilityMap[windowId] = true;
            registerVisibilityListener(window);
        }
    });
}


function updateTrayMenu() {
    if (!tray) {
        return;
    }
    const lastFocusedWindow = windowService.getLastFocusedWindow();
    const allWindows = windowService.getAllWindows();
    updateWindowVisibilityMap(allWindows);

    function ensureVisible(win: BrowserWindow) {
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

    function buildClosedWindowsMenu() {
        const savedOpenNoteContexts = optionService.getOptionJson("openNoteContexts") || "[]";
        const openedWindowIds = windowService.getAllWindowIds();
        const closedWindows = savedOpenNoteContexts
            .filter(win => !openedWindowIds.includes(win.windowId))
            .sort((a, b) => {
                // If closedAt is null, it indicates an abnormal closure and should be placed at the end
                if (a.closedAt === null && b.closedAt === null) return 0;
                if (a.closedAt === null) return 1;
                if (b.closedAt === null) return -1;
                // Otherwise, sort by time in descending order
                return b.closedAt - a.closedAt;
            });
        const menuItems: Electron.MenuItemConstructorOptions[] = [];
        for (const win of closedWindows) {
            const activeCtx = win.contexts.find(c => c.active === true);
            const activateNotePath = (activeCtx ?? win.contexts[0])?.notePath;
            const activateNoteId = activateNotePath?.split("/").pop() ?? null;

            // Get the title of the closed window
            const rawTitle = activateNoteId ? becca_service.getNoteTitle(activateNoteId) : "";
            let winTitle = rawTitle.length > 20 ? `${rawTitle.slice(0, 17)}...` : rawTitle;
            const mainTabCount = win.contexts.filter(ctx => ctx.mainNtxId === null).length;
            if (mainTabCount > 1) {
                const tabSuffix = t("tray.tabs-total", { number: mainTabCount });
                winTitle += ` (${tabSuffix})`;
            }

            menuItems.push({
                label: winTitle,
                type: "normal",
                click: () => win.windowId !== "main" ? windowService.createExtraWindow(win.windowId, "") : windowService.createMainWindow()
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
        {
            label: t("tray.recently-closed-windows"),
            type: "submenu",
            icon: getIconPath("closed-windows"),
            submenu: buildClosedWindowsMenu()
        },
        { type: "separator" },
        {
            label: t("tray.close"),
            type: "normal",
            icon: getIconPath("close"),
            click: () => {
                const windows = electron.BrowserWindow.getAllWindows();
                windows.forEach(window => {
                    window.close();
                });
            }
        }
    ]);

    tray?.setContextMenu(contextMenu);
}

function changeVisibility() {
    const lastFocusedWindow = windowService.getLastFocusedWindow();

    if (!lastFocusedWindow) {
        return;
    }

    // If the window is visible, hide it
    if (windowVisibilityMap[lastFocusedWindow.id]) {
        lastFocusedWindow.hide();
    } else {
        lastFocusedWindow.show();
        lastFocusedWindow.focus();
    }
}

function createTray() {
    if (optionService.getOptionBool("disableTray")) {
        return;
    }

    tray = new electron.Tray(getTrayIconPath());
    tray.setToolTip(t("tray.tooltip"));
    // Restore focus
    tray.on("click", changeVisibility);
    updateTrayMenu();

    if (!isMac) {
        // macOS uses template icons which work great on dark & light themes.
        electron.nativeTheme.on("updated", updateTrayMenu);
    }
    electron.ipcMain.on("reload-tray", updateTrayMenu);
    i18next.on("languageChanged", updateTrayMenu);
}

export default {
    createTray
};
