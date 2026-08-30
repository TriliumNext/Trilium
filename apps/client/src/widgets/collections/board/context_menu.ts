import { useState } from "preact/hooks";

import FNote from "../../../entities/fnote";
import NoteColorPicker from "../../../menus/custom-items/NoteColorPicker";
import contextMenu, { ContextMenuEvent } from "../../../menus/context_menu";
import link_context_menu from "../../../menus/link_context_menu";
import branches from "../../../services/branches";
import dialog from "../../../services/dialog";
import { getArchiveMenuItem } from "../../../menus/context_menu_utils";
import { t } from "../../../services/i18n";
import ColorPicker from "../../react/ColorPicker";
import Api from "./api";

export function openColumnContextMenu(api: Api, event: ContextMenuEvent, column: {
    value: string;
    color?: string;
    archived?: boolean;
    /** Puts the title into its inline editor, the menu being the only way there besides F2. */
    onEditTitle: () => void;
    /** Opens the column's own new-item editor, the same one its button opens. */
    onNewItem: () => void;
    /** Puts a new column on one side of this one and opens its title editor. */
    onAddColumn: (direction: "before" | "after") => void;
}) {
    event.preventDefault();
    event.stopPropagation();

    contextMenu.show({
        x: event.pageX,
        y: event.pageY,
        items: [
            {
                title: t("board_view.rename-column"),
                uiIcon: "bx bx-edit-alt",
                handler: column.onEditTitle
            },
            { kind: "separator" },
            {
                title: t("board_view.add-new-item"),
                uiIcon: "bx bx-plus",
                handler: column.onNewItem
            },
            {
                title: t("board_view.add-existing-item"),
                uiIcon: "bx bx-link",
                async handler() {
                    const noteId = await dialog.chooseNote({
                        title: t("board_view.add-existing-item-title"),
                        okLabel: t("board_view.add-existing-item-ok")
                    });
                    if (noteId) {
                        await api.addExistingItem(column.value, noteId);
                    }
                }
            },
            {
                title: t("board_view.add-new-column"),
                uiIcon: "bx bx-columns",
                items: [
                    {
                        title: t("board_view.add-column-before"),
                        handler: () => column.onAddColumn("before")
                    },
                    {
                        title: t("board_view.add-column-after"),
                        handler: () => column.onAddColumn("after")
                    }
                ]
            },
            { kind: "separator" },
            column.archived
                ? {
                    title: t("board_view.unarchive-column"),
                    uiIcon: "bx bx-archive-out",
                    handler: () => api.setColumnArchived(column.value, false)
                }
                : {
                    title: t("board_view.archive-column"),
                    uiIcon: "bx bx-archive",
                    handler: () => api.setColumnArchived(column.value, true)
                },
            {
                title: t("board_view.delete-column"),
                uiIcon: "bx bx-trash",
                async handler() {
                    const confirmed = await dialog.confirm(t("board_view.delete-column-confirmation"));
                    if (!confirmed) {
                        return;
                    }

                    await api.removeColumn(column.value);
                }
            },
            { kind: "separator" },
            {
                kind: "custom",
                componentFn: () => ColumnColorPicker({ api, ...column })
            }
        ],
        selectMenuItemHandler() {}
    });
}

/**
 * The colour a column is tinted with, picked the way a note's is.
 *
 * It holds the pick rather than reading it back from the board, since the menu is rendered once and
 * the board redrawing underneath does not reach it. `note-color-picker` is what the menu styles the
 * row through, so the class is worn here too.
 */
function ColumnColorPicker({ api, value, color }: { api: Api, value: string, color?: string }) {
    const [ currentColor, setCurrentColor ] = useState(color ?? null);

    return ColorPicker({
        className: "note-color-picker",
        currentValue: currentColor,
        onChange: (picked) => {
            setCurrentColor(picked);
            api.setColumnColor(value, picked);
        }
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
                // Archived columns are offered like any other, since moving a card into one is a
                // fair thing to want; the badge is there so it is not a surprise when it goes.
                items: api.columns.map(columnToMoveTo => ({
                    title: columnToMoveTo,
                    uiIcon: api.getColumnIcon(columnToMoveTo),
                    iconColorClass: api.getColumnColorClass(columnToMoveTo),
                    enabled: columnToMoveTo !== column,
                    badges: api.isColumnArchived(columnToMoveTo)
                        ? [ { title: t("board_view.archived-badge") } ]
                        : undefined,
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

