import NoteColorPicker from "../../../menus/custom-items/NoteColorPicker";
import FNote from "../../../entities/fnote";
import contextMenu, { ContextMenuEvent } from "../../../menus/context_menu";
import link_context_menu from "../../../menus/link_context_menu";
import branches from "../../../services/branches";
import { getArchiveMenuItem } from "../../../menus/context_menu_utils";
import { t } from "../../../services/i18n";

export function openCalendarContextMenu(e: ContextMenuEvent, note: FNote, parentNote: FNote) {
    e.preventDefault();
    e.stopPropagation();

    contextMenu.show({
        x: e.pageX,
        y: e.pageY,
        items: [
            ...link_context_menu.getItems(e),
            { kind: "separator" },
            getArchiveMenuItem(note),
            {
                title: t("calendar_view.delete_note"),
                uiIcon: "bx bx-trash",
                handler: async () => {
                    let branchIdToDelete: string | null = null;
                    for (const parentBranch of note.getParentBranches()) {
                        const parentNote = await parentBranch.getNote();
                        if (parentNote?.hasAncestor(parentNote.noteId)) {
                            branchIdToDelete = parentBranch.branchId;
                        }
                    }

                    if (branchIdToDelete) {
                        await branches.deleteNotes([ branchIdToDelete ], false, false);
                    }
                }
            },
            { kind: "separator" },
            {
                kind: "custom",
                componentFn: () => NoteColorPicker({note: note})
            }
        ],
        selectMenuItemHandler: ({ command }) =>  link_context_menu.handleLinkContextMenuItem(command, e, note.noteId),
    })
}
