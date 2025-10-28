import appContext, { type EventData } from "./app_context.js";
import noteCreateService, { CreateNoteWithUrlOpts } from "../services/note_create.js";
import treeService from "../services/tree.js";
import hoistedNoteService from "../services/hoisted_note.js";
import Component from "./component.js";

/**
 * This class contains command executors which logically belong to the NoteTree widget, but for better user experience,
 * the keyboard shortcuts must be active on the whole screen and not just on the widget itself, so the executors
 * must be at the root of the component tree.
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

        await noteCreateService.createNote(
            {
                target: "into",
                parentNoteUrl: activeNoteContext.notePath,
                isProtected: activeNoteContext.note.isProtected,
                saveSelection: false,
                promptForType: false,
            } as CreateNoteWithUrlOpts
        );
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

        await noteCreateService.createNote(
            {
                target: "after",
                parentNoteUrl: parentNotePath,
                targetBranchId: node.data.branchId,
                isProtected: isProtected,
                saveSelection: false
            } as CreateNoteWithUrlOpts
        );
    }
}
