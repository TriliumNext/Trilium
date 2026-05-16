import appContext, { type ContextMenuCommandData, type FilteredCommandNames } from "../components/app_context.js";
import type Component from "../components/component.js";
import type { SelectMenuItemEventListener } from "../components/events.js";
import type FAttachment from "../entities/fattachment.js";
import type FBranch from "../entities/fbranch.js";
import type FNote from "../entities/fnote.js";
import attributes from "../services/attributes.js";
import { executeBulkActions } from "../services/bulk_action.js";
import clipboard from "../services/clipboard.js";
import dialogService from "../services/dialog.js";
import froca from "../services/froca.js";
import { t } from "../services/i18n.js";
import noteCreateService from "../services/note_create.js";
import noteTypesService from "../services/note_types.js";
import server from "../services/server.js";
import toastService from "../services/toast.js";
import treeService from "../services/tree.js";
import utils from "../services/utils.js";
import type NoteTreeWidget from "../widgets/note_tree.js";
import contextMenu, { type MenuCommandItem, type MenuItem } from "./context_menu.js";
import NoteColorPicker from "./custom-items/NoteColorPicker.jsx";

// TODO: Deduplicate once client/server is well split.
interface ConvertToAttachmentResponse {
    attachment?: FAttachment;
}

let lastTargetNode: HTMLElement | null = null;

// This will include all commands that implement ContextMenuCommandData, but it will not work if it additional options are added via the `|` operator,
// so they need to be added manually.
export type TreeCommandNames = FilteredCommandNames<ContextMenuCommandData> | "openBulkActionsDialog" | "searchInSubtree";

/**
 * Tree-agnostic context passed to the shared context-menu builder/handler.
 * Fancytree's `TreeContextMenu` adapter and the mobile drill-down navigator both
 * construct one of these from their native representations.
 */
export interface TreeContextMenuContext {
    /** The note the menu is for. */
    note: FNote;
    /** The branch used to reach `note` in the current view (parent-to-child relation). */
    branch: FBranch;
    /** The note path to the target note in the current view. */
    notePath: string;
    /**
     * Component responsible for dispatching tree commands (e.g. moveNotesTo,
     * deleteNotes). Fancytree passes the tree widget itself; mobile passes its
     * own parent component.
     */
    component: Component;
    /** Branches to operate on in bulk-capable commands (defaults to [branch.branchId]). */
    selectedOrActiveBranchIds?: string[];
    /** Notes to operate on in bulk-capable commands (defaults to [note.noteId]). */
    selectedOrActiveNoteIds?: string[];
    /** Notes to use for archived / conversion-eligibility checks (defaults to [note]). */
    selectedNotes?: FNote[];
    /** Whether the note is currently spotlighted (Fancytree only). */
    isSpotlighted?: boolean;
    /**
     * Which surface is showing the menu. Used to suppress items that don't make
     * sense on a given surface (e.g. `expandSubtree` / `collapseSubtree` have no
     * meaning in the mobile drill-down navigator). Defaults to `"desktop"`.
     */
    target?: "desktop" | "mobile";
    /**
     * Invoked right before any command's handler runs. Fancytree uses this to
     * switch to the detail screen on mobile so dialogs/navigations are visible.
     */
    onBeforeCommand?: () => void;
    /**
     * Fancytree node for the target, when available. A handful of tree
     * commands (cut/paste/export/expand/collapse/sort) read `node.data` or call
     * tree-service helpers that expect a Fancytree node, so we forward it
     * through the command payload for Fancytree callers. Omitted by mobile.
     */
    node?: Fancytree.FancytreeNode;
}

/**
 * Normalize a caller-supplied context into its defaulted form.
 */
function resolveContext(ctx: TreeContextMenuContext) {
    return {
        ...ctx,
        selectedOrActiveBranchIds: ctx.selectedOrActiveBranchIds ?? [ctx.branch.branchId],
        selectedOrActiveNoteIds: ctx.selectedOrActiveNoteIds ?? [ctx.note.noteId],
        selectedNotes: ctx.selectedNotes ?? [ctx.note],
        isSpotlighted: ctx.isSpotlighted ?? false,
        target: ctx.target ?? "desktop"
    };
}

/**
 * Build the list of context menu items for `ctx`. Callers render via
 * `contextMenu.show({ items })` and dispatch selections with
 * `handleTreeContextMenuSelect`.
 */
export async function buildTreeContextMenuItems(ctx: TreeContextMenuContext): Promise<MenuItem<TreeCommandNames>[]> {
    const resolved = resolveContext(ctx);
    const { note, branch, selectedNotes, isSpotlighted, target } = resolved;
    const isMobileTarget = target === "mobile";

    const isNotRoot = note.noteId !== "root";
    const isHoisted = note.noteId === appContext.tabManager.getActiveContext()?.hoistedNoteId;
    const parentNote = isNotRoot ? await froca.getNote(branch.parentNoteId) : null;

    const isArchived = selectedNotes.every((n) => n.isArchived);
    const canToggleArchived = !selectedNotes.some((n) => n.isArchived !== isArchived);

    // Multi-select-aware actions are disabled when multiple distinct notes are selected,
    // the exception being when the only selection is the target itself.
    const noSelectedNotes = resolved.selectedOrActiveNoteIds.length <= 1
        || (resolved.selectedOrActiveNoteIds.length === 1 && resolved.selectedOrActiveNoteIds[0] === note.noteId);

    const notSearch = note.type !== "search";
    const hasSubtreeHidden = note.isLabelTruthy("subtreeHidden") ?? false;
    const notOptionsOrHelp = !note.noteId.startsWith("_options") && !note.noteId.startsWith("_help");
    const parentNotSearch = !parentNote || parentNote.type !== "search";
    const insertNoteAfterEnabled = isNotRoot && !isHoisted && parentNotSearch;

    const items: (MenuItem<TreeCommandNames> | null)[] = [
        { title: t("tree-context-menu.open-in-a-new-tab"), command: "openInTab", shortcut: "Ctrl+Click", uiIcon: "bx bx-link-external", enabled: noSelectedNotes },
        { title: t("tree-context-menu.open-in-a-new-split"), command: "openNoteInSplit", uiIcon: "bx bx-dock-right", enabled: noSelectedNotes },
        { title: t("tree-context-menu.open-in-a-new-window"), command: "openNoteInWindow", uiIcon: "bx bx-window-open", enabled: noSelectedNotes },
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
            enabled: notSearch && noSelectedNotes && notOptionsOrHelp && !hasSubtreeHidden && !isSpotlighted,
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
                    title: t("tree-context-menu.convert-to-attachment"),
                    command: "convertNoteToAttachment",
                    uiIcon: "bx bx-paperclip",
                    enabled: isNotRoot && !isHoisted && notOptionsOrHelp && selectedNotes.some((n) => n.isEligibleForConversionToAttachment())
                },

                { kind: "separator" },

                !hasSubtreeHidden && !isMobileTarget && { title: t("tree-context-menu.expand-subtree"), command: "expandSubtree", keyboardShortcut: "expandSubtree", uiIcon: "bx bx-expand", enabled: noSelectedNotes },
                !hasSubtreeHidden && !isMobileTarget && { title: t("tree-context-menu.collapse-subtree"), command: "collapseSubtree", keyboardShortcut: "collapseSubtree", uiIcon: "bx bx-collapse", enabled: noSelectedNotes },
                {
                    title: hasSubtreeHidden ? t("tree-context-menu.show-subtree") : t("tree-context-menu.hide-subtree"),
                    uiIcon: "bx bx-show",
                    enabled: isNotRoot,
                    handler: async () => {
                        attributes.setBooleanWithInheritance(note, "subtreeHidden", !hasSubtreeHidden);
                    }
                },
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
            ].filter(Boolean) as MenuItem<TreeCommandNames>[]
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
                    const n = selectedNotes[0];
                    if (!isArchived) {
                        attributes.addLabel(n.noteId, "archived");
                    } else {
                        attributes.removeOwnedLabelByName(n, "archived");
                    }
                } else {
                    const noteIds = selectedNotes.map((n) => n.noteId);
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

        { kind: "separator" },

        (notOptionsOrHelp && selectedNotes.length === 1) ? {
            kind: "custom",
            componentFn: () => NoteColorPicker({ note })
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

/**
 * Dispatch a selection from a tree context menu. Most commands are forwarded via
 * `ctx.component.triggerCommand`; a handful are handled locally because they
 * need app-level services or tree-agnostic state.
 */
export async function handleTreeContextMenuSelect(
    item: MenuCommandItem<TreeCommandNames>,
    ctx: TreeContextMenuContext
) {
    const { command, type, mime, templateNoteId } = item;
    const resolved = resolveContext(ctx);
    const { note, branch, notePath, component, selectedOrActiveBranchIds, selectedOrActiveNoteIds } = resolved;

    resolved.onBeforeCommand?.();

    if (command === "openInTab") {
        appContext.tabManager.openTabWithNoteWithHoisting(notePath);
    } else if (command === "insertNoteAfter") {
        const parentNotePath = parentNotePathOf(notePath);
        const parentNote = await froca.getNote(branch.parentNoteId);
        noteCreateService.createNote(parentNotePath, {
            target: "after",
            targetBranchId: branch.branchId,
            type,
            mime,
            isProtected: parentNote?.isProtected ?? false,
            templateNoteId
        });
    } else if (command === "insertChildNote") {
        noteCreateService.createNote(notePath, {
            type,
            mime,
            isProtected: note.isProtected,
            templateNoteId
        });
    } else if (command === "openNoteInSplit") {
        const subContexts = appContext.tabManager.getActiveContext()?.getSubContexts();
        const { ntxId } = subContexts?.[subContexts.length - 1] ?? {};

        component.triggerCommand("openNewNoteSplit", { ntxId, notePath });
    } else if (command === "openNoteInWindow") {
        appContext.triggerCommand("openInWindow", {
            notePath,
            hoistedNoteId: appContext.tabManager.getActiveContext()?.hoistedNoteId
        });
    } else if (command === "openNoteInPopup") {
        appContext.triggerCommand("openInPopup", { noteIdOrPath: notePath });
    } else if (command === "convertNoteToAttachment") {
        if (!(await dialogService.confirm(t("tree-context-menu.convert-to-attachment-confirm")))) {
            return;
        }

        let converted = 0;

        for (const noteId of selectedOrActiveNoteIds) {
            const candidate = await froca.getNote(noteId);

            if (candidate?.isEligibleForConversionToAttachment()) {
                const { attachment } = await server.post<ConvertToAttachmentResponse>(`notes/${candidate.noteId}/convert-to-attachment`);

                if (attachment) {
                    converted++;
                }
            }
        }

        toastService.showMessage(t("tree-context-menu.converted-to-attachments", { count: converted }));
    } else if (command === "copyNotePathToClipboard") {
        navigator.clipboard.writeText(`#${notePath}`);
    } else if (command) {
        component.triggerCommand<TreeCommandNames>(command, {
            node: resolved.node,
            notePath,
            noteId: note.noteId,
            branchId: branch.branchId,
            selectedOrActiveBranchIds,
            selectedOrActiveNoteIds
        });
    }
}

function parentNotePathOf(notePath: string): string {
    const idx = notePath.lastIndexOf("/");
    return idx >= 0 ? notePath.slice(0, idx) : "";
}

export default class TreeContextMenu implements SelectMenuItemEventListener<TreeCommandNames> {
    private treeWidget: NoteTreeWidget;
    private node: Fancytree.FancytreeNode;

    constructor(treeWidget: NoteTreeWidget, node: Fancytree.FancytreeNode) {
        this.treeWidget = treeWidget;
        this.node = node;
    }

    async show(e: PointerEvent | JQuery.TouchStartEvent | JQuery.ContextMenuEvent) {
        const ctx = await this.#buildContext();
        if (!ctx) return;

        await contextMenu.show({
            x: e.pageX ?? 0,
            y: e.pageY ?? 0,
            items: await buildTreeContextMenuItems(ctx),
            selectMenuItemHandler: (item) => handleTreeContextMenuSelect(item, ctx),
            onHide: () => {
                lastTargetNode?.classList.remove("fancytree-menu-target");
            }
        });
        // It's placed after show to ensure the old target is cleared before showing the context menu again on repeated right-clicks.
        lastTargetNode?.classList.remove("fancytree-menu-target");
        lastTargetNode = this.node.span;
        lastTargetNode.classList.add("fancytree-menu-target");
    }

    // Kept so callers using `selectMenuItemHandler` on this instance still work
    // (e.g. via `SelectMenuItemEventListener`).
    async selectMenuItemHandler(item: MenuCommandItem<TreeCommandNames>) {
        const ctx = await this.#buildContext();
        if (!ctx) return;
        await handleTreeContextMenuSelect(item, ctx);
    }

    async #buildContext(): Promise<TreeContextMenuContext | null> {
        const note = this.node.data.noteId ? await froca.getNote(this.node.data.noteId) : null;
        const branch = froca.getBranch(this.node.data.branchId);
        if (!note || !branch) return null;

        const selNodes = this.treeWidget.getSelectedNodes();
        const selectedNotes = await froca.getNotes(selNodes.map((n) => n.data.noteId));
        if (!selectedNotes.includes(note)) selectedNotes.push(note);

        return {
            note,
            branch,
            notePath: treeService.getNotePath(this.node),
            component: this.treeWidget,
            selectedOrActiveBranchIds: this.treeWidget.getSelectedOrActiveBranchIds(this.node),
            selectedOrActiveNoteIds: this.treeWidget.getSelectedOrActiveNoteIds(this.node),
            selectedNotes,
            isSpotlighted: this.node.extraClasses.includes("spotlighted-node"),
            node: this.node,
            onBeforeCommand: () => {
                if (utils.isMobile()) {
                    this.treeWidget.triggerCommand("setActiveScreen", { screen: "detail" });
                }
            }
        };
    }
}
