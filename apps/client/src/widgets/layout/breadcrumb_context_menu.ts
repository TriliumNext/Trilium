import appContext from "../../components/app_context";
import type Component from "../../components/component";
import contextMenu, { type MenuItem } from "../../menus/context_menu";
import NoteColorPicker from "../../menus/custom-items/NoteColorPicker";
import link_context_menu from "../../menus/link_context_menu";
import { getDuplicateItems, type TreeCommandNames } from "../../menus/tree_context_menu";
import attributes from "../../services/attributes";
import branches from "../../services/branches";
import { copyTextWithToast } from "../../services/clipboard_ext";
import froca from "../../services/froca";
import { t } from "../../services/i18n";
import options from "../../services/options";
import tree from "../../services/tree";

/** The menu of a note of the breadcrumb: the link's items, then those of the tree's menu that apply. */
export async function showNoteContextMenu(e: MouseEvent, notePath: string, parentComponent: Component | null) {
    const { noteId, parentNoteId } = tree.getNoteIdAndParentIdFromUrl(notePath);
    if (!parentNoteId || !noteId) return;

    const branchId = await froca.getBranchId(parentNoteId, noteId);
    if (!branchId) return;
    const branch = froca.getBranch(branchId);
    if (!branch) return;

    const note = await branch?.getNote();
    if (!note) return;

    const notSearch = note.type !== "search";
    const notOptionsOrHelp = !note.noteId.startsWith("_options") && !note.noteId.startsWith("_help");
    const isArchived = note.isArchived;
    const isNotRoot = note.noteId !== "root";
    const isHoisted = note.noteId === appContext.tabManager.getActiveContext()?.hoistedNoteId;
    const parentNote = isNotRoot && branch ? await froca.getNote(branch.parentNoteId) : null;
    const parentNotSearch = !parentNote || parentNote.type !== "search";

    const items = [
        ...link_context_menu.getItems(e),
        {
            title: `${t("tree-context-menu.hoist-note")}`,
            command: "toggleNoteHoisting",
            uiIcon: "bx bxs-chevrons-up",
            enabled: notSearch
        },
        { kind: "separator" },
        {
            title: t("tree-context-menu.move-to"),
            command: "moveNotesTo",
            uiIcon: "bx bx-transfer",
            enabled: isNotRoot && !isHoisted && parentNotSearch
        },
        {
            title: t("tree-context-menu.clone-to"),
            command: "cloneNotesTo",
            uiIcon: "bx bx-duplicate",
            enabled: isNotRoot && !isHoisted
        },
        { kind: "separator" },
        {
            title: t("tree-context-menu.duplicate"),
            command: "duplicateSubtree",
            uiIcon: "bx bx-outline",
            enabled: parentNotSearch && isNotRoot && !isHoisted && notOptionsOrHelp && note.isContentAvailable(),
            items: getDuplicateItems([ note ])
        },

        {
            title: !isArchived ? t("tree-context-menu.archive") : t("tree-context-menu.unarchive"),
            uiIcon: !isArchived ? "bx bx-archive" : "bx bx-archive-out",
            handler: () => {
                if (!isArchived) {
                    attributes.addLabel(note.noteId, "archived");
                } else {
                    attributes.removeOwnedLabelByName(note, "archived");
                }
            }
        },
        {
            title: t("tree-context-menu.delete"),
            command: "deleteNotes",
            uiIcon: "bx bx-trash destructive-action-icon",
            enabled: isNotRoot && !isHoisted && parentNotSearch && notOptionsOrHelp,
            handler: () => branches.deleteNotes([ branchId ])
        },
        { kind: "separator" },
        (notOptionsOrHelp ? {
            kind: "custom",
            componentFn: () => {
                return NoteColorPicker({note});
            }
        } : null),
        { kind: "separator" },
        {
            title: t("tree-context-menu.recent-changes-in-subtree"),
            uiIcon: "bx bx-history",
            enabled: notOptionsOrHelp,
            handler: () => parentComponent?.triggerCommand("showRecentChanges", { ancestorNoteId: noteId })
        },
        {
            title: t("tree-context-menu.search-in-subtree"),
            command: "searchInSubtree",
            uiIcon: "bx bx-search",
            enabled: notSearch
        }
    ];

    contextMenu.show({
        items: items.filter(Boolean) as MenuItem<TreeCommandNames>[],
        x: e.pageX,
        y: e.pageY,
        selectMenuItemHandler: ({ command }) => {
            if (link_context_menu.handleLinkContextMenuItem(command, e, notePath)) {
                return;
            }

            if (!command) return;
            parentComponent?.triggerCommand(command, {
                noteId,
                notePath,
                selectedOrActiveBranchIds: [ branchId ],
                selectedOrActiveNoteIds: [ noteId ]
            });
        },
    });
}

/** The menu of the empty end of the breadcrumb. */
export function showEmptyAreaContextMenu(e: MouseEvent, parentComponent: Component | null, notePath: string | null | undefined) {
    const hideArchivedNotes = (options.get("hideArchivedNotes_main") === "true");

    contextMenu.show({
        items: [
            {
                title: t("breadcrumb.empty_hide_archived_notes"),
                handler: async () => {
                    await options.save("hideArchivedNotes_main", !hideArchivedNotes ? "true" : "false");

                    // Note tree doesn't update by itself.
                    parentComponent?.triggerEvent("frocaReloaded", {});
                },
                checked: hideArchivedNotes
            },
            { kind: "separator" },
            {
                title: t("tree-context-menu.copy-note-path-to-clipboard"),
                command: "copyNotePathToClipboard",
                uiIcon: "bx bx-directions",
                handler: () => copyTextWithToast(`#${notePath}`)
            },
        ],
        x: e.pageX,
        y: e.pageY,
        selectMenuItemHandler: () => {}
    });
}
