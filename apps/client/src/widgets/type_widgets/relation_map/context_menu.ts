import { RefObject } from "preact";

import appContext from "../../../components/app_context";
import FNote from "../../../entities/fnote";
import contextMenu from "../../../menus/context_menu";
import NoteColorPicker from "../../../menus/custom-items/NoteColorPicker";
import link_context_menu from "../../../menus/link_context_menu";
import dialog from "../../../services/dialog";
import { t } from "../../../services/i18n";
import { pasteNotesMenuItem } from "../../../services/note_paste";
import server from "../../../services/server";
import toast from "../../../services/toast";
import RelationMapApi, { type ClientRelation } from "./api";

/**
 * Returns the handler of a box's context menu: the link's own items, and on a map that can be
 * edited, renaming the note, removing it from the map and its color.
 */
export function buildNoteContextMenuHandler(note: FNote | null | undefined, mapApiRef: RefObject<RelationMapApi | null>, isReadOnly: boolean) {
    return (e: MouseEvent) => {
        if (!note) return;
        e.preventDefault();

        contextMenu.show({
            x: e.pageX,
            y: e.pageY,
            items: isReadOnly ? link_context_menu.getItems(e) : [
                ...link_context_menu.getItems(e),
                { kind: "separator" },
                {
                    title: t("relation_map.edit_title"),
                    uiIcon: "bx bx-pencil",
                    handler: async () => {
                        const title = await dialog.prompt({
                            title: t("relation_map.rename_note"),
                            message: t("relation_map.enter_new_title"),
                            defaultValue: note?.title,
                        });

                        if (!title) {
                            return;
                        }

                        await server.put(`notes/${note.noteId}/title`, { title });
                    }
                },
                { kind: "separator" },

                {
                    title: t("relation_map.remove_note"),
                    uiIcon: "bx bx-trash",
                    handler: () => confirmRemoveFromMap(note, mapApiRef)
                },
                { kind: "separator" },
                { kind: "custom", componentFn: () => NoteColorPicker({ note }) }
            ],
            selectMenuItemHandler({ command }) {
                // Pass the events to the link context menu
                link_context_menu.handleLinkContextMenuItem(command, e, note.noteId);
            }
        });
    };
}

/**
 * Asks whether to remove the note from the map, and whether to also delete it from the tree, then
 * does so. Used by the box's context menu and by the note pane.
 */
export async function confirmRemoveFromMap(note: FNote, mapApiRef: RefObject<RelationMapApi | null>) {
    // `confirmDeleteNoteBoxWithNote` receives only the branch, and uses it to tell whether ticking
    // the checkbox deletes the note or only removes it from this parent.
    const result = await dialog.confirmDeleteNoteBoxWithNote(note.title, {
        noteId: note.noteId,
        branchId: mapApiRef.current?.branchIdFor(note.noteId)
    });
    if (typeof result !== "object" || !result.confirmed) return;

    await mapApiRef.current?.removeItem(note.noteId, result.isDeleteNoteChecked);
}

/** Shows the context menu of empty canvas, which pastes notes or adds a new one where it opened. */
export function showCanvasContextMenu(event: MouseEvent, { onPaste, onAddNote }: {
    onPaste(): void;
    onAddNote(): void;
}) {
    event.preventDefault();

    contextMenu.show({
        x: event.pageX,
        y: event.pageY,
        items: [
            pasteNotesMenuItem(onPaste),
            { kind: "separator" },
            { title: t("relation_map_buttons.create_child_note_text"), uiIcon: "bx bx-note", handler: onAddNote }
        ],
        selectMenuItemHandler() {}
    });
}

/**
 * Shows the context menu of a relation, which renames or removes it. `askRelationName` asks for the
 * new name next to the relation. A read-only map has nothing to offer, and leaves the event alone.
 */
export function showRelationContextMenu(event: MouseEvent, relation: ClientRelation, mapApiRef: RefObject<RelationMapApi | null>, askRelationName: (defaultValue: string) => Promise<string | null>, isReadOnly: boolean) {
    if (isReadOnly) return;

    event.preventDefault();
    event.stopPropagation();

    contextMenu.show({
        x: event.pageX,
        y: event.pageY,
        items: [
            { title: t("relation_map.rename_relation"), command: "rename", uiIcon: "bx bx-pencil" },
            { kind: "separator" },
            { title: t("relation_map.remove_relation"), command: "remove", uiIcon: "bx bx-trash" }
        ],
        selectMenuItemHandler: async ({ command }) => {
            if (command === "rename") {
                const currentName = mapApiRef.current?.getRelationName(relation.attributeId) ?? "";
                const newName = await askRelationName(currentName);

                if (!newName?.trim() || newName === currentName) {
                    return;
                }

                const result = await mapApiRef.current?.renameRelation(relation.attributeId, newName);
                if (!result) {
                    toast.showError(t("relation_map.connection_exists", { name: newName }));
                }
            } else if (command === "remove") {
                if (!(await dialog.confirm(t("relation_map.confirm_remove_relation")))) {
                    return;
                }

                mapApiRef.current?.removeRelation(relation.attributeId);
            }
        }
    });
}
