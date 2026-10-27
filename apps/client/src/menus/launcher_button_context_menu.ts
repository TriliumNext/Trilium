import type { ToggleInParentResponse } from "@triliumnext/commons";

import appContext from "../components/app_context.js";
import type FNote from "../entities/fnote.js";
import { setBooleanWithInheritance } from "../services/attributes.js";
import branchService from "../services/branches.js";
import { t } from "../services/i18n.js";
import options from "../services/options.js";
import server from "../services/server.js";
import toast from "../services/toast.js";
import { isMobile, reloadFrontendApp } from "../services/utils.js";
import contextMenu, { type ContextMenuEvent, type MenuItem } from "./context_menu.js";

const VISIBLE_LAUNCHER_PARENTS = ["_lbVisibleLaunchers", "_lbMobileVisibleLaunchers"];

function getVisibleLauncherBranch(launcherNote: FNote) {
    return launcherNote.getParentBranches().find((b) => VISIBLE_LAUNCHER_PARENTS.includes(b.parentNoteId));
}

function getBookmarkBranch(launcherNote: FNote) {
    return launcherNote.getParentBranches().find((b) => b.parentNoteId === "_lbBookmarks");
}

/**
 * Returns the branch that shows the note in the launch bar section `parentNoteId`. Without a
 * section, a bookmark comes before a launcher.
 */
function getLaunchBarBranch(launcherNote: FNote, parentNoteId: string | undefined) {
    if (parentNoteId) {
        return launcherNote.getParentBranches().find((b) => b.parentNoteId === parentNoteId);
    }

    return getBookmarkBranch(launcherNote) ?? getVisibleLauncherBranch(launcherNote);
}

async function removeFromLaunchBar(launcherNote: FNote, parentNoteId: string | undefined) {
    const launcherBranch = getLaunchBarBranch(launcherNote, parentNoteId);
    if (!launcherBranch) return;

    if (launcherBranch.parentNoteId === "_lbBookmarks") {
        // Individual bookmarks are represented via a branch under `_lbBookmarks`; removing them
        // from the launch bar is the same as unbookmarking the note.
        const resp = await server.put<ToggleInParentResponse>(
            `notes/${launcherNote.noteId}/toggle-in-parent/_lbBookmarks/false`
        );
        if (!resp.success && resp.message) {
            toast.showError(resp.message);
        }
        return;
    }

    // A note dropped onto the launch bar is a clone, so removing it deletes the clone. When the
    // clone is the note's last placement, the server refuses and the clone moves like a launcher.
    if (launcherNote.type !== "launcher") {
        const resp = await server.put<ToggleInParentResponse>(
            `notes/${launcherNote.noteId}/toggle-in-parent/${launcherBranch.parentNoteId}/false`
        );
        if (resp.success) return;
    }

    const isMobileLauncher = launcherBranch.parentNoteId === "_lbMobileVisibleLaunchers";
    // Branch IDs in the hidden subtree follow the `${parentNoteId}_${noteId}` convention,
    // so the branch linking `_lb(Mobile)?Root` to the "available" launchers root is predictable.
    const targetBranchId = isMobileLauncher
        ? "_lbMobileRoot__lbMobileAvailableLaunchers"
        : "_lbRoot__lbAvailableLaunchers";
    await branchService.moveToParentNote([launcherBranch.branchId], targetBranchId);
}

export function canRemoveFromLaunchBar(
    launcherNote: FNote | null | undefined,
    parentNoteId?: string
) {
    if (!launcherNote) return false;
    return !!getLaunchBarBranch(launcherNote, parentNoteId);
}

export interface ShowLauncherContextMenuOptions<T extends string> {
    /** Menu items specific to this launcher (e.g. "Open in new tab" for note-based launchers). They appear above the "Remove from launch bar" item. */
    extraItems?: MenuItem<T>[];
    /** Handler for the {@link extraItems}. The "Remove from launch bar" item is handled internally and will not be forwarded. */
    onCommand?: (command: T | undefined) => void;
    /** The launch bar section that shows the button. "Remove from launch bar" removes it there. */
    parentNoteId?: string;
}

const REMOVE_COMMAND = "__removeFromLaunchBar__";

/**
 * Displays the launch bar icon context menu. When the launcher can be removed (i.e. it is a direct
 * child of the visible launchers root or of `_lbBookmarks`), a "Remove from launch bar" entry is
 * appended, after a "Show as a folder" toggle for a bookmark or a dropped note. Extra items can be
 * supplied to preserve launcher-specific actions (e.g. "Open in new tab").
 */
export async function showLauncherContextMenu<T extends string>(
    launcherNote: FNote | null | undefined,
    e: ContextMenuEvent,
    options: ShowLauncherContextMenuOptions<T> = {}
) {
    e.preventDefault();

    // Widget-specific items (e.g. "Open in new tab" for note launchers, history entries, "Remove from launch bar").
    const widgetItems = [...(options.extraItems ?? [])] as MenuItem<string>[];

    if (launcherNote && canRemoveFromLaunchBar(launcherNote, options.parentNoteId)) {
        // Bookmarks and dropped notes are regular notes, which `#bookmarkFolder` shows as folders.
        if (launcherNote.type !== "launcher") {
            pushGroup(widgetItems, buildShowAsFolderItem(launcherNote));
        }
        pushGroup(widgetItems, {
            title: t("launcher_button_context_menu.remove_from_launch_bar"),
            command: REMOVE_COMMAND,
            uiIcon: "bx bx-x-circle destructive-action-icon"
        });
    }

    // Every launch-bar context menu starts with the shared launch-bar management segment.
    const items = buildLaunchBarManagementItems();
    if (widgetItems.length > 0) {
        items.push({ kind: "separator" }, ...widgetItems);
    }

    contextMenu.show<string>({
        x: e.pageX ?? 0,
        y: e.pageY ?? 0,
        items,
        selectMenuItemHandler: ({ command }) => {
            if (command === REMOVE_COMMAND) {
                if (launcherNote) {
                    void removeFromLaunchBar(launcherNote, options.parentNoteId);
                }
                return;
            }
            options.onCommand?.(command as T | undefined);
        }
    });
}

/** Appends `item` to `items` as a group of its own. */
function pushGroup(items: MenuItem<string>[], item: MenuItem<string>) {
    if (items.length > 0) {
        items.push({ kind: "separator" });
    }
    items.push(item);
}

function buildShowAsFolderItem(note: FNote): MenuItem<string> {
    const isFolder = note.isLabelTruthy("bookmarkFolder");
    return {
        title: t("launcher_button_context_menu.show_as_folder"),
        uiIcon: "bx bx-folder",
        checked: isFolder,
        handler: () => setBooleanWithInheritance(note, "bookmarkFolder", !isFolder)
    };
}

/**
 * Shows a context menu containing only the shared launch-bar management segment. Used by launch-bar chrome
 * that is not itself a launcher (e.g. the left-pane toggle), which has no launcher-specific items to add.
 */
export function showLaunchBarManagementContextMenu(e: ContextMenuEvent) {
    e.preventDefault();

    contextMenu.show<string>({
        x: e.pageX ?? 0,
        y: e.pageY ?? 0,
        items: buildLaunchBarManagementItems(),
        // The items are self-contained via their own handlers, so nothing needs to be routed here.
        selectMenuItemHandler: () => {}
    });
}

/**
 * Builds the shared segment shown at the top of every launch-bar context menu: the "Configure launch bar"
 * entry and (on desktop) the "Launch bar orientation" submenu. Each item is self-contained via its own
 * {@link MenuCommandItem.handler}, so it works regardless of the widget-specific `onCommand` router.
 */
function buildLaunchBarManagementItems(): MenuItem<string>[] {
    const items: MenuItem<string>[] = [{
        title: t("launcher_button_context_menu.configure_launch_bar"),
        uiIcon: "bx " + (isMobile() ? "bx-mobile" : "bx-sidebar"),
        handler: () => appContext.triggerCommand("showLaunchBarSubtree")
    }];

    // The layout orientation only applies to the desktop layout; the mobile layout is always horizontal.
    if (!isMobile()) {
        const orientation = options.get("layoutOrientation");
        items.push({
            title: t("launcher_button_context_menu.launch_bar_orientation"),
            uiIcon: "bx bx-layout",
            items: [
                buildOrientationItem("vertical", orientation),
                buildOrientationItem("horizontal", orientation)
            ]
        });
    }

    return items;
}

function buildOrientationItem(target: "vertical" | "horizontal", currentOrientation: string): MenuItem<string> {
    const isCurrent = currentOrientation === target;
    const label = target === "vertical" ? t("theme.layout-vertical-title") : t("theme.layout-horizontal-title");
    return {
        // The unchecked item triggers a reload when picked, so hint that after its label.
        title: isCurrent ? label : `${label} ${t("launcher_button_context_menu.will_reload_frontend")}`,
        // `bx-empty` reserves the icon slot so unchecked items stay aligned with the checked one.
        uiIcon: "bx bx-empty",
        checked: isCurrent,
        handler: () => setLayoutOrientation(target)
    };
}

async function setLayoutOrientation(orientation: "vertical" | "horizontal") {
    if (options.get("layoutOrientation") === orientation) {
        return;
    }

    await options.save("layoutOrientation", orientation);
    // The layout tree and body classes are computed once at boot, so a reload is required to apply the change.
    reloadFrontendApp(`layout orientation change: ${orientation}`);
}
