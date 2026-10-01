import { Connection } from "jsplumb";
import { RefObject } from "preact";

import appContext from "../../../components/app_context";
import FNote from "../../../entities/fnote";
import contextMenu from "../../../menus/context_menu";
import link_context_menu from "../../../menus/link_context_menu";
import dialog from "../../../services/dialog";
import toast from "../../../services/toast";
import { t } from "../../../services/i18n";
import server from "../../../services/server";
import RelationMapApi from "./api";
import type { AskRelationName } from "./RelationNamePopover";

export interface RelationMenuActions {
    isCollapsed(attributeId: string): boolean;
    /** Reifies the relation when it is not a note yet, then centers the map on it. */
    goTo(attributeId: string): Promise<void> | void;
    toggleCollapse(attributeId: string): Promise<void> | void;
}

export function buildNoteContextMenuHandler(note: FNote | null | undefined, mapApiRef: RefObject<RelationMapApi | null>) {
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

                        // The branch is all the dialog is told: from it, it works out for itself
                        // whether ticking the box would delete the note or merely unfile it here,
                        // and says so (see confirmDeleteNoteBoxWithNote).
                        const result = await dialog.confirmDeleteNoteBoxWithNote(note.title, {
                            noteId: note.noteId,
                            branchId: mapApiRef.current?.branchIdFor(note.noteId)
                        });
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

export function buildRelationContextMenuHandler(
    connection: Connection,
    mapApiRef: RefObject<RelationMapApi | null>,
    actions: RelationMenuActions,
    askRelationName: AskRelationName
) {
    return (_, event: MouseEvent) => {
        if (connection.getType().includes("link")) {
            // don't create context menu if it's a link since there's nothing to do with link from relation map
            // (don't open browser menu either)
            event.preventDefault();
        } else {
            event.preventDefault();
            event.stopPropagation();
            showRelationMenu(event, connection.id, mapApiRef, actions, askRelationName, connection);
        }
    };
}

export function showRelationMenu(
    event: MouseEvent,
    attributeId: string,
    mapApiRef: RefObject<RelationMapApi | null>,
    actions: RelationMenuActions,
    askRelationName: AskRelationName,
    connection?: Connection
) {
    const reification = mapApiRef.current?.reificationFor(attributeId);
    const collapsed = actions.isCollapsed(attributeId);

    contextMenu.show({
        x: event.pageX,
        y: event.pageY,
        items: [
            { title: t("relation_map.go_to_relation"), command: "go", uiIcon: "bx bx-git-commit" },
            collapsed
                ? { title: t("relation_map.expand_relation"), command: "collapse", uiIcon: "bx bx-expand" }
                : { title: t("relation_map.collapse_relation"), command: "collapse", uiIcon: "bx bx-collapse" },
            ...(connection ? [
                { title: t("relation_map.rename_relation"), command: "rename", uiIcon: "bx bx-pencil" }
            ] : []),
            ...(reification ? [
                { title: t("relation_map.open_reification"), command: "open-note", uiIcon: "bx bx-link-external" }
            ] : []),
            ...(connection ? [
                { kind: "separator" as const },
                { title: t("relation_map.remove_relation"), command: "remove", uiIcon: "bx bx-trash" }
            ] : [])
        ],
        selectMenuItemHandler: async ({ command }) => {
            if (command === "go") {
                await actions.goTo(attributeId);
            } else if (command === "collapse") {
                actions.toggleCollapse(attributeId);
            } else if (command === "open-note" && reification) {
                appContext.tabManager.openContextWithNote(reification.noteId, { placement: "afterCurrent" });
            } else if (command === "rename" && connection) {
                const currentName = mapApiRef.current?.getRelationName(connection) ?? "";
                const newName = await askRelationName(connection, currentName);

                if (!newName?.trim() || newName === currentName) {
                    return;
                }

                const result = await mapApiRef.current?.renameRelation(connection, newName);
                if (!result) {
                    toast.showError(t("relation_map.connection_exists", { name: newName }));
                }
            } else if (command === "remove" && connection) {
                if (!(await dialog.confirm(t("relation_map.confirm_remove_relation")))) {
                    return;
                }

                mapApiRef.current?.removeRelation(connection);
            }
        }
    });
}
