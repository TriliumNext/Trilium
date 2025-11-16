import FNote from "../../../entities/fnote";
import contextMenu, { ContextMenuEvent } from "../../../menus/context_menu";
import link_context_menu from "../../../menus/link_context_menu";
import branches from "../../../services/branches";
import froca from "../../../services/froca";
import { t } from "../../../services/i18n";

export function openCalendarContextMenu(e: ContextMenuEvent, noteId: string, parentNote: FNote) {
    e.preventDefault();
    e.stopPropagation();

    contextMenu.show({
        x: e.pageX,
        y: e.pageY,
        items: [
            ...link_context_menu.getItems(),
            { kind: "separator" },
            {
                title: t("calendar_view.delete_note"),
                uiIcon: "bx bx-trash",
                handler: async () => {
                    const noteToDelete = await froca.getNote(noteId);
                    if (!noteToDelete) return;

                    let branchIdToDelete: string | null = null;
                    for (const parentBranch of noteToDelete.getParentBranches()) {
                        const parentNote = await parentBranch.getNote();
                        if (parentNote?.hasAncestor(parentNote.noteId)) {
                            branchIdToDelete = parentBranch.branchId;
                        }
                    }

                    if (branchIdToDelete) {
                        await branches.deleteNotes([ branchIdToDelete ], false, false);
                    }
                }
            }
        ],
        selectMenuItemHandler: ({ command }) =>  link_context_menu.handleLinkContextMenuItem(command, noteId),
    })
}
