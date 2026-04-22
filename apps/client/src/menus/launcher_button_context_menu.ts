import type { ToggleInParentResponse } from "@triliumnext/commons";

import type FNote from "../entities/fnote.js";
import branchService from "../services/branches.js";
import { t } from "../services/i18n.js";
import server from "../services/server.js";
import toast from "../services/toast.js";
import contextMenu, { type ContextMenuEvent, type MenuItem } from "./context_menu.js";

const VISIBLE_LAUNCHER_PARENTS = ["_lbVisibleLaunchers", "_lbMobileVisibleLaunchers"];

function getVisibleLauncherBranch(launcherNote: FNote) {
    return launcherNote.getParentBranches().find((b) => VISIBLE_LAUNCHER_PARENTS.includes(b.parentNoteId));
}

function getBookmarkBranch(launcherNote: FNote) {
    return launcherNote.getParentBranches().find((b) => b.parentNoteId === "_lbBookmarks");
}

async function removeFromLaunchBar(launcherNote: FNote) {
    const bookmarkBranch = getBookmarkBranch(launcherNote);
    if (bookmarkBranch) {
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

    const launcherBranch = getVisibleLauncherBranch(launcherNote);
    if (!launcherBranch) return;

    const isMobileLauncher = launcherBranch.parentNoteId === "_lbMobileVisibleLaunchers";
    // Branch IDs in the hidden subtree follow the `${parentNoteId}_${noteId}` convention,
    // so the branch linking `_lb(Mobile)?Root` to the "available" launchers root is predictable.
    const targetBranchId = isMobileLauncher
        ? "_lbMobileRoot__lbMobileAvailableLaunchers"
        : "_lbRoot__lbAvailableLaunchers";
    await branchService.moveToParentNote([launcherBranch.branchId], targetBranchId);
}

export function canRemoveFromLaunchBar(launcherNote: FNote | null | undefined) {
    if (!launcherNote) return false;
    return !!(getVisibleLauncherBranch(launcherNote) || getBookmarkBranch(launcherNote));
}

export interface ShowLauncherContextMenuOptions<T extends string> {
    /** Menu items specific to this launcher (e.g. "Open in new tab" for note-based launchers). They appear above the "Remove from launch bar" item. */
    extraItems?: MenuItem<T>[];
    /** Handler for the {@link extraItems}. The "Remove from launch bar" item is handled internally and will not be forwarded. */
    onCommand?: (command: T | undefined) => void;
}

const REMOVE_COMMAND = "__removeFromLaunchBar__";

/**
 * Displays the launch bar icon context menu. When the launcher can be removed (i.e. it is a direct
 * child of the visible launchers root or of `_lbBookmarks`), a "Remove from launch bar" entry is
 * appended. Extra items can be supplied to preserve launcher-specific actions (e.g. "Open in new tab").
 */
export async function showLauncherContextMenu<T extends string>(
    launcherNote: FNote | null | undefined,
    e: ContextMenuEvent,
    options: ShowLauncherContextMenuOptions<T> = {}
) {
    e.preventDefault();

    const items = [...(options.extraItems ?? [])] as MenuItem<string>[];

    if (canRemoveFromLaunchBar(launcherNote)) {
        if (items.length > 0) {
            items.push({ kind: "separator" });
        }
        items.push({
            title: t("launcher_button_context_menu.remove_from_launch_bar"),
            command: REMOVE_COMMAND,
            uiIcon: "bx bx-x-circle"
        });
    }

    if (items.length === 0) return;

    contextMenu.show<string>({
        x: e.pageX ?? 0,
        y: e.pageY ?? 0,
        items,
        selectMenuItemHandler: ({ command }) => {
            if (command === REMOVE_COMMAND) {
                if (launcherNote) {
                    void removeFromLaunchBar(launcherNote);
                }
                return;
            }
            options.onCommand?.(command as T | undefined);
        }
    });
}
