import branchService from "../services/branches.js";
import clipboard from "../services/clipboard.js";
import froca from "../services/froca.js";
import hoistedNoteService from "../services/hoisted_note.js";
import noteCreateService from "../services/note_create.js";
import protectedSessionService from "../services/protected_session.js";
import protectedSessionHolder from "../services/protected_session_holder.js";
import treeService from "../services/tree.js";
import appContext, { type CommandListenerData, type EventData } from "./app_context.js";
import Component from "./component.js";

/**
 * This class contains command executors which logically belong to the NoteTree widget, but for better user experience,
 * the keyboard shortcuts must be active on the whole screen and not just on the widget itself, so the executors
 * must be at the root of the component tree.
 *
 * Many of these commands are invoked from the tree's context menu (desktop) and the mobile drill-down navigator's
 * context menu (mobile). Because the mobile navigator doesn't contain the `NoteTreeWidget`, command handlers
 * that ought to run regardless of which UI triggered them live here instead of on the widget.
 */
export default class MainTreeExecutors extends Component {
    /**
     * On mobile it will be `undefined`.
     */
    get tree() {
        return appContext.noteTreeWidget;
    }

    async cloneNotesToCommand({ selectedOrActiveNoteIds }: EventData<"cloneNotesTo">) {
        if (!selectedOrActiveNoteIds && this.tree) {
            selectedOrActiveNoteIds = this.tree.getSelectedOrActiveNodes().map((node) => node.data.noteId);
        }

        if (!selectedOrActiveNoteIds) {
            return;
        }

        this.triggerCommand("cloneNoteIdsTo", { noteIds: selectedOrActiveNoteIds });
    }

    async moveNotesToCommand({ selectedOrActiveBranchIds }: EventData<"moveNotesTo">) {
        if (!selectedOrActiveBranchIds && this.tree) {
            selectedOrActiveBranchIds = this.tree.getSelectedOrActiveNodes().map((node) => node.data.branchId);
        }

        if (!selectedOrActiveBranchIds) {
            return;
        }

        this.triggerCommand("moveBranchIdsTo", { branchIds: selectedOrActiveBranchIds });
    }

    async createNoteIntoCommand() {
        const activeNoteContext = appContext.tabManager.getActiveContext();

        if (!activeNoteContext || !activeNoteContext.notePath || !activeNoteContext.note) {
            return;
        }

        await noteCreateService.createNote(activeNoteContext.notePath, {
            isProtected: activeNoteContext.note.isProtected,
            saveSelection: false
        });
    }

    async createNoteAfterCommand() {
        if (!this.tree) {
            return;
        }

        const node = this.tree.getActiveNode();

        if (!node) {
            return;
        }

        const parentNotePath = treeService.getNotePath(node.getParent());
        const isProtected = treeService.getParentProtectedStatus(node);

        if (node.data.noteId === "root" || node.data.noteId === hoistedNoteService.getHoistedNoteId()) {
            return;
        }

        await noteCreateService.createNote(parentNotePath, {
            target: "after",
            targetBranchId: node.data.branchId,
            isProtected,
            saveSelection: false
        });
    }

    async deleteNotesCommand({ selectedOrActiveBranchIds }: CommandListenerData<"deleteNotes">) {
        const branchIds = selectedOrActiveBranchIds.filter((branchId) => !branchId.startsWith("virt-")); // search results can't be deleted

        if (!branchIds.length) {
            return;
        }

        await branchService.deleteNotes(branchIds);

        this.tree?.clearSelectedNodes();
    }

    async editBranchPrefixCommand({ node, selectedOrActiveBranchIds }: CommandListenerData<"editBranchPrefix">) {
        const branchIds = selectedOrActiveBranchIds.filter((branchId) => !branchId.startsWith("virt-"));

        if (!branchIds.length) {
            return;
        }

        appContext.triggerEvent("editBranchPrefix", {
            selectedOrActiveBranchIds: branchIds,
            node
        });
    }

    copyNotesToClipboardCommand({ selectedOrActiveBranchIds }: CommandListenerData<"copyNotesToClipboard">) {
        clipboard.copy(selectedOrActiveBranchIds);
    }

    cutNotesToClipboardCommand({ selectedOrActiveBranchIds }: CommandListenerData<"cutNotesToClipboard">) {
        clipboard.cut(selectedOrActiveBranchIds);
    }

    pasteNotesFromClipboardCommand({ node, branchId }: CommandListenerData<"pasteNotesFromClipboard">) {
        const targetBranchId = branchId ?? node?.data.branchId;
        if (!targetBranchId) return;
        clipboard.pasteInto(targetBranchId);
    }

    pasteNotesAfterFromClipboardCommand({ node, branchId }: CommandListenerData<"pasteNotesAfterFromClipboard">) {
        const targetBranchId = branchId ?? node?.data.branchId;
        if (!targetBranchId) return;
        clipboard.pasteAfter(targetBranchId);
    }

    async exportNoteCommand({ node, notePath }: CommandListenerData<"exportNote">) {
        const path = notePath ?? (node ? treeService.getNotePath(node) : undefined);
        if (!path) return;

        this.triggerCommand("showExportDialog", { notePath: path, defaultType: "subtree" });
    }

    async importIntoNoteCommand({ node, noteId }: CommandListenerData<"importIntoNote">) {
        const targetNoteId = noteId ?? node?.data.noteId;
        if (!targetNoteId) return;
        this.triggerCommand("showImportDialog", { noteId: targetNoteId });
    }

    protectSubtreeCommand({ node, noteId }: CommandListenerData<"protectSubtree">) {
        const targetNoteId = noteId ?? node?.data.noteId;
        if (!targetNoteId) return;
        protectedSessionService.protectNote(targetNoteId, true, true);
    }

    unprotectSubtreeCommand({ node, noteId }: CommandListenerData<"unprotectSubtree">) {
        const targetNoteId = noteId ?? node?.data.noteId;
        if (!targetNoteId) return;
        protectedSessionService.protectNote(targetNoteId, false, true);
    }

    async duplicateSubtreeCommand({ selectedOrActiveBranchIds }: CommandListenerData<"duplicateSubtree">) {
        for (const branchId of selectedOrActiveBranchIds) {
            const branch = froca.getBranch(branchId);
            if (!branch) continue;
            const note = await froca.getNote(branch.noteId);
            if (!note) continue;
            if (note.isProtected && !protectedSessionHolder.isProtectedSessionAvailable()) continue;
            noteCreateService.duplicateSubtree(branch.noteId, branch.parentNoteId);
        }
    }

    async recentChangesInSubtreeCommand({ node, noteId }: CommandListenerData<"recentChangesInSubtree">) {
        const ancestorNoteId = noteId ?? node?.data.noteId;
        if (!ancestorNoteId) return;
        this.triggerCommand("showRecentChanges", { ancestorNoteId });
    }

    async toggleArchivedNotesCommand(){
        await this.tree?.toggleArchivedNotes();
    }
}
