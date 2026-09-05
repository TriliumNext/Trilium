import { parseNoteTypeId } from "@triliumnext/commons";

import appContext from "../../components/app_context";
import contextMenu from "../../menus/context_menu";
import branches from "../../services/branches";
import froca from "../../services/froca";
import { t } from "../../services/i18n";
import server from "../../services/server";
import { isDesktop } from "../../services/utils";
import ws from "../../services/ws";

/** What a template entry can be asked to do, beyond being moved or taken off the list. */
export interface TemplateCommands {
    /** Adds the copy a duplicate made to the list, beside the template it was copied from. */
    onDuplicated: (
        sourceNoteId: string, copy: { noteId: string, title: string, icon: string }) => void;
    /** Takes a template off the list once its note has been deleted. */
    onDeleted: (noteId: string) => void;
}

/** The note a template entry stands for, or nothing for an entry that is a note type. */
export function templateNoteId(key: string) {
    const parsed = parseNoteTypeId(key);
    return parsed?.kind === "template" ? parsed.templateNoteId : undefined;
}

/**
 * Opens the menu of what can be done with a template note.
 *
 * The commands act on the note rather than on the list, so they are the same wherever templates are
 * managed. Only the two that change what the list holds report back.
 */
export function openTemplateMenu(
    event: { pageX: number, pageY: number }, noteId: string, commands: TemplateCommands
) {
    contextMenu.show({
        x: event.pageX,
        y: event.pageY,
        items: [
            {
                title: t("tree-context-menu.open-in-popup"),
                uiIcon: "bx bx-edit",
                shortcut: "Space",
                handler: () => quickEdit(noteId)
            },
            // A window of its own is a desktop's to give.
            ...(isDesktop() ? [ {
                title: t("tree-context-menu.open-in-a-new-window"),
                uiIcon: "bx bx-window-open",
                handler: () => appContext.triggerCommand("openInWindow", { notePath: noteId })
            } ] : []),
            {
                title: t("tree-context-menu.duplicate"),
                uiIcon: "bx bx-outline",
                handler: () => duplicate(noteId, commands)
            },
            { kind: "separator" },
            {
                title: t("note_actions.delete_note"),
                uiIcon: "bx bx-trash destructive-action-icon",
                shortcut: "Delete",
                handler: () => remove(noteId, commands)
            }
        ],
        selectMenuItemHandler() {}
    });
}

/** Opens a template in the popup editor, which leaves whatever asked for it standing. */
export function quickEdit(noteId: string) {
    // A template that has yet to be written can still become a note of another type.
    appContext.triggerCommand("openInPopup", { noteIdOrPath: noteId, showNoteTypeSwitcher: true });
}

/**
 * Copies a template and reports the copy.
 *
 * The wait is what makes the copy readable: the server names the note, and it has to be in froca
 * before its title and icon can be read from it.
 */
export async function duplicate(noteId: string, { onDuplicated }: TemplateCommands) {
    const note = await froca.getNote(noteId);
    const parentNoteId = note?.getParentBranches()[0]?.parentNoteId;
    if (!parentNoteId) {
        return;
    }

    const { note: copy } = await server.post<{ note: { noteId: string } }>(
        `notes/${noteId}/duplicate/${parentNoteId}`);

    await ws.waitForMaxKnownEntityChangeId();

    const made = await froca.getNote(copy.noteId);
    if (made) {
        onDuplicated(noteId, { noteId: made.noteId, title: made.title, icon: made.getIcon() });
    }
}

/** Asks whether to delete a template, and reports it once it is gone. */
export async function remove(noteId: string, { onDeleted }: TemplateCommands) {
    const note = await froca.getNote(noteId);
    const branchId = note?.getParentBranches()[0]?.branchId;
    if (!branchId) {
        return;
    }

    const deleted = await branches.deleteNotes([ branchId ], false, false);
    if (deleted) {
        onDeleted(noteId);
    }
}
