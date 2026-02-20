import type { ContextMenuCommandData,FilteredCommandNames } from "../components/app_context.js";
import type { SelectMenuItemEventListener } from "../components/events.js";
import dialogService from "../services/dialog.js";
import froca from "../services/froca.js";
import { t } from "../services/i18n.js";
import server from "../services/server.js";
import treeService from "../services/tree.js";
import type NoteTreeWidget from "../widgets/note_tree.js";
import contextMenu, { type MenuCommandItem, type MenuItem } from "./context_menu.js";

type LauncherCommandNames = FilteredCommandNames<ContextMenuCommandData>;

export default class LauncherContextMenu implements SelectMenuItemEventListener<LauncherCommandNames> {
    private treeWidget: NoteTreeWidget;
    private node: Fancytree.FancytreeNode;

    constructor(treeWidget: NoteTreeWidget, node: Fancytree.FancytreeNode) {
        this.treeWidget = treeWidget;
        this.node = node;
    }

    async show(e: PointerEvent | JQuery.TouchStartEvent | JQuery.ContextMenuEvent) {
        contextMenu.show({
            x: e.pageX ?? 0,
            y: e.pageY ?? 0,
            items: await this.getMenuItems(),
            selectMenuItemHandler: (item, e) => this.selectMenuItemHandler(item)
        });
    }

    async getMenuItems(): Promise<MenuItem<LauncherCommandNames>[]> {
        const note = this.node.data.noteId ? await froca.getNote(this.node.data.noteId) : null;
        const parentNoteId = this.node.getParent().data.noteId;

        const isVisibleRoot = note?.noteId === "_lbVisibleLaunchers" || note?.noteId === "_lbMobileVisibleLaunchers";
        const isAvailableRoot = note?.noteId === "_lbAvailableLaunchers" || note?.noteId === "_lbMobileAvailableLaunchers";
        const isVisibleItem = parentNoteId === "_lbVisibleLaunchers" || parentNoteId === "_lbMobileVisibleLaunchers";
        const isAvailableItem = parentNoteId === "_lbAvailableLaunchers" || parentNoteId === "_lbMobileAvailableLaunchers";
        const isItem = isVisibleItem || isAvailableItem;
        const canBeDeleted = !note?.noteId.startsWith("_"); // fixed notes can't be deleted
        const canBeReset = !canBeDeleted && note?.isLaunchBarConfig();

        const items: (MenuItem<LauncherCommandNames> | null)[] = [
            isVisibleRoot || isAvailableRoot ? { title: t("launcher_context_menu.add-note-launcher"), command: "addNoteLauncher", uiIcon: "bx bx-note" } : null,
            isVisibleRoot || isAvailableRoot ? { title: t("launcher_context_menu.add-script-launcher"), command: "addScriptLauncher", uiIcon: "bx bx-code-curly" } : null,
            isVisibleRoot || isAvailableRoot ? { title: t("launcher_context_menu.add-custom-widget"), command: "addWidgetLauncher", uiIcon: "bx bx-customize" } : null,
            isVisibleRoot || isAvailableRoot ? { title: t("launcher_context_menu.add-spacer"), command: "addSpacerLauncher", uiIcon: "bx bx-dots-horizontal" } : null,
            isVisibleRoot || isAvailableRoot ? { kind: "separator" } : null,

            isAvailableItem ? { title: t("launcher_context_menu.move-to-visible-launchers"), command: "moveLauncherToVisible", uiIcon: "bx bx-show", enabled: true } : null,
            isVisibleItem ? { title: t("launcher_context_menu.move-to-available-launchers"), command: "moveLauncherToAvailable", uiIcon: "bx bx-hide", enabled: true } : null,
            isVisibleItem || isAvailableItem ? { kind: "separator" } : null,

            { title: `${t("launcher_context_menu.duplicate-launcher")}`, command: "duplicateSubtree", uiIcon: "bx bx-outline", enabled: isItem },
            { title: `${t("launcher_context_menu.delete")}`, command: "deleteNotes", uiIcon: "bx bx-trash destructive-action-icon", enabled: canBeDeleted },

            { kind: "separator" },

            { title: t("launcher_context_menu.reset"), command: "resetLauncher", uiIcon: "bx bx-reset destructive-action-icon", enabled: canBeReset }
        ];
        return items.filter((row) => row !== null) as MenuItem<LauncherCommandNames>[];
    }

    async selectMenuItemHandler({ command }: MenuCommandItem<LauncherCommandNames>) {
        if (!command) {
            return;
        }

        if (command === "resetLauncher") {
            const confirmed = await dialogService.confirm(t("launcher_context_menu.reset_launcher_confirm", { title: this.node.title }));

            if (confirmed) {
                await server.post(`special-notes/launchers/${this.node.data.noteId}/reset`);
            }

            return;
        }

        this.treeWidget.triggerCommand(command, {
            node: this.node,
            notePath: treeService.getNotePath(this.node),
            selectedOrActiveBranchIds: this.treeWidget.getSelectedOrActiveBranchIds(this.node),
            selectedOrActiveNoteIds: this.treeWidget.getSelectedOrActiveNoteIds(this.node)
        });
    }
}
