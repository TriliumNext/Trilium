import { type CommandNames } from "../../../components/app_context";
import contextMenu, { type ContextMenuEvent, type MenuItem } from "../../../menus/context_menu";
import link_context_menu from "../../../menus/link_context_menu";
import branches from "../../../services/branches";
import { t } from "../../../services/i18n";

export default function openWidgetContextMenu(notePath: string, branchId: string, e: ContextMenuEvent, { onRefresh }: {
    /** When provided (i.e. the widget is a render note or web view), adds a "Refresh" item that re-renders it. */
    onRefresh?: () => void;
}) {
    const items: MenuItem<CommandNames>[] = [
        ...link_context_menu.getItems(e),
        { kind: "separator" }
    ];

    if (onRefresh) {
        items.push({ title: t("dashboard_view.refresh-widget"), uiIcon: "bx bx-refresh", handler: () => onRefresh() });
        items.push({ kind: "separator" });
    }

    items.push({ title: t("dashboard_view.remove-widget"), uiIcon: "bx bx-trash", handler: () => branches.deleteNotes([ branchId ], false, false) });

    contextMenu.show({
        x: e.pageX,
        y: e.pageY,
        items,
        selectMenuItemHandler: ({ command }) => link_context_menu.handleLinkContextMenuItem(command, e, notePath)
    });
}
