import NoteColorPicker from "./custom-items/NoteColorPicker.jsx";
import treeService from "../services/tree.js";
import froca from "../services/froca.js";
import clipboard from "../services/clipboard.js";
import noteCreateService from "../services/note_create.js";
import contextMenu, { type MenuCommandItem, type MenuItem } from "./context_menu.js";
import appContext, { type ContextMenuCommandData, type FilteredCommandNames } from "../components/app_context.js";
import noteTypesService from "../services/note_types.js";
import server from "../services/server.js";
import toastService from "../services/toast.js";
import dialogService from "../services/dialog.js";
import { t } from "../services/i18n.js";
import type NoteTreeWidget from "../widgets/note_tree.js";
import type FAttachment from "../entities/fattachment.js";
import type { SelectMenuItemEventListener } from "../components/events.js";
import utils from "../services/utils.js";
import attributes from "../services/attributes.js";
import { executeBulkActions } from "../services/bulk_action.js";

// TODO: Deduplicate once client/server is well split.
interface ConvertToAttachmentResponse {
    attachment?: FAttachment;
}

let lastTargetNode: HTMLElement | null = null;

// This will include all commands that implement ContextMenuCommandData, but it will not work if it additional options are added via the `|` operator,
// so they need to be added manually.
export type TreeCommandNames = FilteredCommandNames<ContextMenuCommandData> | "openBulkActionsDialog" | "searchInSubtree";

export default class TreeContextMenu implements SelectMenuItemEventListener<TreeCommandNames> {
    private treeWidget: NoteTreeWidget;
    private node: Fancytree.FancytreeNode;

    constructor(treeWidget: NoteTreeWidget, node: Fancytree.FancytreeNode) {
        this.treeWidget = treeWidget;
        this.node = node;
    }

    async show(e: PointerEvent | JQuery.TouchStartEvent | JQuery.ContextMenuEvent) {
        await contextMenu.show({
            x: e.pageX ?? 0,
            y: e.pageY ?? 0,
            items: await this.getMenuItems(),
            selectMenuItemHandler: (item, e) => this.selectMenuItemHandler(item),
            onHide: () => {
                lastTargetNode?.classList.remove('fancytree-menu-target');
            }
        });
        // It's placed after show to ensure the old target is cleared before showing the context menu again on repeated right-clicks.
        lastTargetNode?.classList.remove('fancytree-menu-target');
        lastTargetNode = this.node.span;
        lastTargetNode.classList.add('fancytree-menu-target');
    }

    async getMenuItems(): Promise<MenuItem<TreeCommandNames>[]> {
        const note = this.node.data.noteId ? await froca.getNote(this.node.data.noteId) : null;
        const branch = froca.getBranch(this.node.data.branchId);
        const isNotRoot = note?.noteId !== "root";
        const isHoisted = note?.noteId === appContext.tabManager.getActiveContext()?.hoistedNoteId;
        const parentNote = isNotRoot && branch ? await froca.getNote(branch.parentNoteId) : null;

        // some actions don't support multi-note, so they are disabled when notes are selected,
        // the only exception is when the only selected note is the one that was right-clicked, then
        // it's clear what the user meant to do.
        const selNodes = this.treeWidget.getSelectedNodes();
        const selectedNotes = await froca.getNotes(selNodes.map(node => node.data.noteId));
        if (note && !selectedNotes.includes(note)) selectedNotes.push(note);
        const isArchived = selectedNotes.every(note => note.isArchived);
        const canToggleArchived = !selectedNotes.some(note => note.isArchived !== isArchived);

        const noSelectedNotes = selNodes.length === 0 || (selNodes.length === 1 && selNodes[0] === this.node);

        const notSearch = note?.type !== "search";
        const notOptionsOrHelp = !note?.noteId.startsWith("_options") && !note?.noteId.startsWith("_help");
        const parentNotSearch = !parentNote || parentNote.type !== "search";
        const insertNoteAfterEnabled = isNotRoot && !isHoisted && parentNotSearch;

        const items: (MenuItem<TreeCommandNames> | null)[] = [
            { title: t("tree-context-menu.open-in-a-new-tab"), command: "openInTab", shortcut: "Ctrl+Click", uiIcon: "bx bx-link-external", enabled: noSelectedNotes },
            { title: t("tree-context-menu.open-in-a-new-split"), command: "openNoteInSplit", uiIcon: "bx bx-dock-right", enabled: noSelectedNotes },
            { title: t("tree-context-menu.open-in-popup"), command: "openNoteInPopup", uiIcon: "bx bx-edit", enabled: noSelectedNotes },

            isHoisted
                ? null
                : {
                      title: `${t("tree-context-menu.hoist-note")}`,
                      command: "toggleNoteHoisting",
                      keyboardShortcut: "toggleNoteHoisting",
                      uiIcon: "bx bxs-chevrons-up",
                      enabled: noSelectedNotes && notSearch
                  },
            !isHoisted || !isNotRoot
                ? null
                : { title: t("tree-context-menu.unhoist-note"), command: "toggleNoteHoisting", keyboardShortcut: "toggleNoteHoisting", uiIcon: "bx bx-door-open" },

            { kind: "separator" },

            {
                title: t("tree-context-menu.insert-note-after"),
                command: "insertNoteAfter",
                keyboardShortcut: "createNoteAfter",
                uiIcon: "bx bx-plus",
                items: insertNoteAfterEnabled ? await noteTypesService.getNoteTypeItems("insertNoteAfter") : null,
                enabled: insertNoteAfterEnabled && noSelectedNotes && notOptionsOrHelp,
                columns: 2
            },

            {
                title: t("tree-context-menu.insert-child-note"),
                command: "insertChildNote",
                keyboardShortcut: "createNoteInto",
                uiIcon: "bx bx-plus",
                items: notSearch ? await noteTypesService.getNoteTypeItems("insertChildNote") : null,
                enabled: notSearch && noSelectedNotes && notOptionsOrHelp,
                columns: 2
            },

            { kind: "separator" },

            { title: t("tree-context-menu.protect-subtree"), command: "protectSubtree", uiIcon: "bx bx-check-shield", enabled: noSelectedNotes },

            { title: t("tree-context-menu.unprotect-subtree"), command: "unprotectSubtree", uiIcon: "bx bx-shield", enabled: noSelectedNotes },

            { kind: "separator" },

            {
                title: t("tree-context-menu.advanced"),
                uiIcon: "bx bxs-wrench",
                enabled: true,
                items: [
                    { title: t("tree-context-menu.apply-bulk-actions"), command: "openBulkActionsDialog", uiIcon: "bx bx-list-plus", enabled: true },

                    { kind: "separator" },

                    {
                        title: t("tree-context-menu.edit-branch-prefix"),
                        command: "editBranchPrefix",
                        keyboardShortcut: "editBranchPrefix",
                        uiIcon: "bx bx-rename",
                        enabled: isNotRoot && parentNotSearch && notOptionsOrHelp
                    },
                    {
                        title:
                        t("tree-context-menu.convert-to-attachment"),
                        command: "convertNoteToAttachment",
                        uiIcon: "bx bx-paperclip",
                        enabled: isNotRoot && !isHoisted && notOptionsOrHelp && selectedNotes.some(note => note.isEligibleForConversionToAttachment())
                    },

                    { kind: "separator" },

                    { title: t("tree-context-menu.expand-subtree"), command: "expandSubtree", keyboardShortcut: "expandSubtree", uiIcon: "bx bx-expand", enabled: noSelectedNotes },
                    { title: t("tree-context-menu.collapse-subtree"), command: "collapseSubtree", keyboardShortcut: "collapseSubtree", uiIcon: "bx bx-collapse", enabled: noSelectedNotes },
                    {
                        title: t("tree-context-menu.sort-by"),
                        command: "sortChildNotes",
                        keyboardShortcut: "sortChildNotes",
                        uiIcon: "bx bx-sort-down",
                        enabled: noSelectedNotes && notSearch
                    },

                    { kind: "separator" },

                    { title: t("tree-context-menu.copy-note-path-to-clipboard"), command: "copyNotePathToClipboard", uiIcon: "bx bx-directions", enabled: true },
                    { title: t("tree-context-menu.recent-changes-in-subtree"), command: "recentChangesInSubtree", uiIcon: "bx bx-history", enabled: noSelectedNotes && notOptionsOrHelp }
                ]
            },

            { kind: "separator" },

            {
                title: t("tree-context-menu.cut"),
                command: "cutNotesToClipboard",
                keyboardShortcut: "cutNotesToClipboard",
                uiIcon: "bx bx-cut",
                enabled: isNotRoot && !isHoisted && parentNotSearch
            },

            { title: t("tree-context-menu.copy-clone"), command: "copyNotesToClipboard", keyboardShortcut: "copyNotesToClipboard", uiIcon: "bx bx-copy", enabled: isNotRoot && !isHoisted },

            {
                title: t("tree-context-menu.paste-into"),
                command: "pasteNotesFromClipboard",
                keyboardShortcut: "pasteNotesFromClipboard",
                uiIcon: "bx bx-paste",
                enabled: !clipboard.isClipboardEmpty() && notSearch && noSelectedNotes
            },

            {
                title: t("tree-context-menu.paste-after"),
                command: "pasteNotesAfterFromClipboard",
                uiIcon: "bx bx-paste",
                enabled: !clipboard.isClipboardEmpty() && isNotRoot && !isHoisted && parentNotSearch && noSelectedNotes
            },

            {
                title: t("tree-context-menu.move-to"),
                command: "moveNotesTo",
                keyboardShortcut: "moveNotesTo",
                uiIcon: "bx bx-transfer",
                enabled: isNotRoot && !isHoisted && parentNotSearch
            },

            { title: t("tree-context-menu.clone-to"), command: "cloneNotesTo", keyboardShortcut: "cloneNotesTo", uiIcon: "bx bx-duplicate", enabled: isNotRoot && !isHoisted },

            {
                title: t("tree-context-menu.duplicate"),
                command: "duplicateSubtree",
                keyboardShortcut: "duplicateSubtree",
                uiIcon: "bx bx-outline",
                enabled: parentNotSearch && isNotRoot && !isHoisted && notOptionsOrHelp
            },

            {
                title: !isArchived ? t("tree-context-menu.archive") : t("tree-context-menu.unarchive"),
                uiIcon: !isArchived ? "bx bx-archive" : "bx bx-archive-out",
                enabled: canToggleArchived,
                handler: () => {
                    if (!selectedNotes.length) return;

                    if (selectedNotes.length == 1) {
                        const note = selectedNotes[0];
                        if (!isArchived) {
                            attributes.addLabel(note.noteId, "archived");
                        } else {
                            attributes.removeOwnedLabelByName(note, "archived");
                        }
                    } else {
                        const noteIds = selectedNotes.map(note => note.noteId);
                        if (!isArchived) {
                            executeBulkActions(noteIds, [{
                                name: "addLabel", labelName: "archived"
                            }]);
                        } else {
                            executeBulkActions(noteIds, [{
                                name: "deleteLabel", labelName: "archived"
                            }]);
                        }
                    }
                }
            },
            {
                title: t("tree-context-menu.delete"),
                command: "deleteNotes",
                keyboardShortcut: "deleteNotes",
                uiIcon: "bx bx-trash destructive-action-icon",
                enabled: isNotRoot && !isHoisted && parentNotSearch && notOptionsOrHelp
            },

            { kind: "separator"},

            (notOptionsOrHelp && selectedNotes.length === 1) ? {
                kind: "custom",
                componentFn: () => {
                    return NoteColorPicker({note});
                }
            } : null,

            { kind: "separator" },

            { title: t("tree-context-menu.import-into-note"), command: "importIntoNote", uiIcon: "bx bx-import", enabled: notSearch && noSelectedNotes && notOptionsOrHelp },

            { title: t("tree-context-menu.export"), command: "exportNote", uiIcon: "bx bx-export", enabled: notSearch && noSelectedNotes && notOptionsOrHelp },

            { kind: "separator" },

            {
                title: t("tree-context-menu.search-in-subtree"),
                command: "searchInSubtree",
                keyboardShortcut: "searchInSubtree",
                uiIcon: "bx bx-search",
                enabled: notSearch && noSelectedNotes
            }
        ];
        return items.filter((row) => row !== null) as MenuItem<TreeCommandNames>[];
    }

    async selectMenuItemHandler({ command, type, templateNoteId }: MenuCommandItem<TreeCommandNames>) {
        const notePath = treeService.getNotePath(this.node);

        if (utils.isMobile()) {
            this.treeWidget.triggerCommand("setActiveScreen", { screen: "detail" });
        }

        if (command === "openInTab") {
            appContext.tabManager.openTabWithNoteWithHoisting(notePath);
        } else if (command === "insertNoteAfter") {
            const parentNotePath = treeService.getNotePath(this.node.getParent());
            const isProtected = treeService.getParentProtectedStatus(this.node);

            noteCreateService.createNote(parentNotePath, {
                target: "after",
                targetBranchId: this.node.data.branchId,
                type: type,
                isProtected: isProtected,
                templateNoteId: templateNoteId
            });
        } else if (command === "insertChildNote") {
            const parentNotePath = treeService.getNotePath(this.node);

            noteCreateService.createNote(parentNotePath, {
                type: type,
                isProtected: this.node.data.isProtected,
                templateNoteId: templateNoteId
            });
        } else if (command === "openNoteInSplit") {
            const subContexts = appContext.tabManager.getActiveContext()?.getSubContexts();
            const { ntxId } = subContexts?.[subContexts.length - 1] ?? {};

            this.treeWidget.triggerCommand("openNewNoteSplit", { ntxId, notePath });
        } else if (command === "openNoteInPopup") {
            appContext.triggerCommand("openInPopup", { noteIdOrPath: notePath })
        } else if (command === "convertNoteToAttachment") {
            if (!(await dialogService.confirm(t("tree-context-menu.convert-to-attachment-confirm")))) {
                return;
            }

            let converted = 0;

            for (const noteId of this.treeWidget.getSelectedOrActiveNoteIds(this.node)) {
                const note = await froca.getNote(noteId);

                if (note?.isEligibleForConversionToAttachment()) {
                    const { attachment } = await server.post<ConvertToAttachmentResponse>(`notes/${note.noteId}/convert-to-attachment`);

                    if (attachment) {
                        converted++;
                    }
                }
            }

            toastService.showMessage(t("tree-context-menu.converted-to-attachments", { count: converted }));
        } else if (command === "copyNotePathToClipboard") {
            navigator.clipboard.writeText("#" + notePath);
        } else if (command) {
            this.treeWidget.triggerCommand<TreeCommandNames>(command, {
                node: this.node,
                notePath: notePath,
                noteId: this.node.data.noteId,
                selectedOrActiveBranchIds: this.treeWidget.getSelectedOrActiveBranchIds(this.node),
                selectedOrActiveNoteIds: this.treeWidget.getSelectedOrActiveNoteIds(this.node)
            });
        }
    }
}
