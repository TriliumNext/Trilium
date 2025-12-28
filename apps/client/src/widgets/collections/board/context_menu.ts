import FNote from "../../../entities/fnote";
import NoteColorPicker from "../../../menus/custom-items/NoteColorPicker";
import contextMenu, { ContextMenuEvent } from "../../../menus/context_menu";
import link_context_menu from "../../../menus/link_context_menu";
import branches from "../../../services/branches";
import dialog from "../../../services/dialog";
import { getArchiveMenuItem } from "../../../menus/context_menu_utils";
import { t } from "../../../services/i18n";
import Api from "./api";

export function openColumnContextMenu(api: Api, event: ContextMenuEvent, column: string) {
    event.preventDefault();
    event.stopPropagation();

    contextMenu.show({
        x: event.pageX,
        y: event.pageY,
        items: [
            {
                title: t("board_view.delete-column"),
                uiIcon: "bx bx-trash",
                async handler() {
                    const confirmed = await dialog.confirm(t("board_view.delete-column-confirmation"));
                    if (!confirmed) {
                        return;
                    }

                    await api.removeColumn(column);
                }
            }
        ],
        selectMenuItemHandler() {}
    });
}

export function openNoteContextMenu(api: Api, event: ContextMenuEvent, note: FNote, branchId: string, column: string) {
    event.preventDefault();
    event.stopPropagation();

    contextMenu.show({
        x: event.pageX,
        y: event.pageY,
        items: [
            ...link_context_menu.getItems(event),
            { kind: "separator" },
            {
                title: t("board_view.insert-above"),
                uiIcon: "bx bx-list-plus",
                handler: () => api.insertRowAtPosition(column, branchId, "before")
            },
            {
                title: t("board_view.insert-below"),
                uiIcon: "bx bx-empty",
                handler: () => api.insertRowAtPosition(column, branchId, "after")
            },
            { kind: "separator" },
            {
                title: t("board_view.move-to"),
                uiIcon: "bx bx-transfer",
                items: api.columns.map(columnToMoveTo => ({
                    title: columnToMoveTo,
                    enabled: columnToMoveTo !== column,
                    handler: () => api.changeColumn(note.noteId, columnToMoveTo)
                })),
            },
            { kind: "separator" },
            getArchiveMenuItem(note),
            {
                title: t("board_view.remove-from-board"),
                uiIcon: "bx bx-task-x",
                handler: () => api.removeFromBoard(note.noteId)
            },
            {
                title: t("board_view.delete-note"),
                uiIcon: "bx bx-trash",
                handler: () => branches.deleteNotes([ branchId ], false, false)
            },
            { kind: "separator" },
            {
                kind: "custom",
                componentFn: () => NoteColorPicker({note})
            }
        ],
        selectMenuItemHandler: ({ command }) =>  link_context_menu.handleLinkContextMenuItem(command, event, note.noteId),
    });
}

