import type { LeafletMouseEvent } from "leaflet";

import appContext, { type CommandNames } from "../components/app_context.js";
import { t } from "../services/i18n.js";
import type { ViewScope } from "../services/link.js";
import utils, { isMobile } from "../services/utils.js";
import { getClosestNtxId } from "../widgets/widget_utils.js";
import contextMenu, { type ContextMenuEvent, type MenuItem } from "./context_menu.js";

function openContextMenu(notePath: string, e: ContextMenuEvent, viewScope: ViewScope = {}, hoistedNoteId: string | null = null) {
    contextMenu.show({
        x: e.pageX,
        y: e.pageY,
        items: getItems(e),
        selectMenuItemHandler: ({ command }) => handleLinkContextMenuItem(command, e, notePath, viewScope, hoistedNoteId)
    });
}

function getItems(e: ContextMenuEvent | LeafletMouseEvent): MenuItem<CommandNames>[] {
    const ntxId = getNtxId(e);
    const isMobileSplitOpen = isMobile() && appContext.tabManager.getNoteContextById(ntxId).getMainContext().getSubContexts().length > 1;

    return [
        { title: t("link_context_menu.open_note_in_new_tab"), command: "openNoteInNewTab", uiIcon: "bx bx-link-external" },
        { title: !isMobileSplitOpen ? t("link_context_menu.open_note_in_new_split") : t("link_context_menu.open_note_in_other_split"), command: "openNoteInNewSplit", uiIcon: "bx bx-dock-right" },
        { title: t("link_context_menu.open_note_in_new_window"), command: "openNoteInNewWindow", uiIcon: "bx bx-window-open" },
        { title: t("link_context_menu.open_note_in_popup"), command: "openNoteInPopup", uiIcon: "bx bx-edit" }
    ];
}

function handleLinkContextMenuItem(command: string | undefined, e: ContextMenuEvent | LeafletMouseEvent, notePath: string, viewScope = {}, hoistedNoteId: string | null = null) {
    if (!hoistedNoteId) {
        hoistedNoteId = appContext.tabManager.getActiveContext()?.hoistedNoteId ?? null;
    }

    if (command === "openNoteInNewTab") {
        appContext.tabManager.openContextWithNote(notePath, { hoistedNoteId, viewScope });
        return true;
    } else if (command === "openNoteInNewSplit") {
        const ntxId = getNtxId(e);
        if (!ntxId) return false;
        appContext.triggerCommand("openNewNoteSplit", { ntxId, notePath, hoistedNoteId, viewScope });
        return true;
    } else if (command === "openNoteInNewWindow") {
        appContext.triggerCommand("openInWindow", { notePath, hoistedNoteId, viewScope });
        return true;
    } else if (command === "openNoteInPopup") {
        appContext.triggerCommand("openInPopup", { noteIdOrPath: notePath });
        return true;
    }

    return false;
}

function getNtxId(e: ContextMenuEvent | LeafletMouseEvent) {
    if (utils.isDesktop()) {
        const subContexts = appContext.tabManager.getActiveContext()?.getSubContexts();
        if (!subContexts) return null;
        return subContexts[subContexts.length - 1].ntxId;
    } else if (e.target instanceof HTMLElement) {
        return getClosestNtxId(e.target);
    }
    return null;

}

export default {
    getItems,
    handleLinkContextMenuItem,
    openContextMenu
};
