import { Connection } from "jsplumb";
import { RefObject } from "preact";

import appContext from "../../../components/app_context";
import FNote from "../../../entities/fnote";
import contextMenu from "../../../menus/context_menu";
import link_context_menu from "../../../menus/link_context_menu";
import dialog from "../../../services/dialog";
import { t } from "../../../services/i18n";
import server from "../../../services/server";
import RelationMapApi from "./api";
import { promptForRelationName } from "./utils";

export function buildNoteContextMenuHandler(note: FNote | null | undefined, mapApiRef: RefObject<RelationMapApi>) {
    return (e: MouseEvent) => {
        if (!note) return;
        e.preventDefault();

        contextMenu.show({
            x: e.pageX,
            y: e.pageY,
            items: [
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
                    handler: async () => {
                        if (!note) return;
                        const result = await dialog.confirmDeleteNoteBoxWithNote(note.title);
                        if (typeof result !== "object" || !result.confirmed) return;

                        mapApiRef.current?.removeItem(note.noteId, result.isDeleteNoteChecked);
                    }
                },
            ],
            selectMenuItemHandler({ command }) {
                // Pass the events to the link context menu
                link_context_menu.handleLinkContextMenuItem(command, e, note.noteId);
            }
        });
    };
}

export function buildRelationContextMenuHandler(connection: Connection, mapApiRef: RefObject<RelationMapApi>) {
    return (_, event: MouseEvent) => {
        if (connection.getType().includes("link")) {
            // don't create context menu if it's a link since there's nothing to do with link from relation map
            // (don't open browser menu either)
            event.preventDefault();
        } else {
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
                        const currentName = mapApiRef.current?.getRelationName(connection) ?? "";
                        const newName = await promptForRelationName(currentName);

                        if (!newName?.trim() || newName === currentName) {
                            return;
                        }

                        const result = await mapApiRef.current?.renameRelation(connection, newName);
                        if (!result) {
                            await dialog.info(t("relation_map.connection_exists", { name: newName }));
                        }
                    } else if (command === "remove") {
                        if (!(await dialog.confirm(t("relation_map.confirm_remove_relation")))) {
                            return;
                        }

                        mapApiRef.current?.removeRelation(connection);
                    }
                }
            });
        }
    };
}
