import appContext from "../components/app_context.js";
import treeService from "./tree.js";
import dialogService from "./dialog.js";
import froca from "./froca.js";
import type NoteContext from "../components/note_context.js";
import { t } from "./i18n.js";

function getHoistedNoteId() {
    const activeNoteContext = appContext.tabManager.getActiveContext();

    return activeNoteContext ? activeNoteContext.hoistedNoteId : "root";
}

async function unhoist() {
    const activeNoteContext = appContext.tabManager.getActiveContext();

    if (activeNoteContext) {
        await activeNoteContext.unhoist();
    }
}

function isTopLevelNode(node: Fancytree.FancytreeNode) {
    return isHoistedNode(node.getParent());
}

function isHoistedNode(node: Fancytree.FancytreeNode) {
    // even though check for 'root' should not be necessary, we keep it just in case
    return node.data.noteId === "root" || node.data.noteId === getHoistedNoteId();
}

async function isHoistedInHiddenSubtree() {
    const hoistedNoteId = getHoistedNoteId();

    if (hoistedNoteId === "root") {
        return false;
    }

    const hoistedNote = await froca.getNote(hoistedNoteId);
    return hoistedNote?.isHiddenCompletely();
}

async function checkNoteAccess(notePath: string, noteContext: NoteContext) {
    const resolvedNotePath = await treeService.resolveNotePath(notePath, noteContext.hoistedNoteId);

    if (!resolvedNotePath) {
        console.log(`Cannot activate '${notePath}'`);
        return false;
    }

    const hoistedNoteId = noteContext.hoistedNoteId;

    if (!resolvedNotePath.includes(hoistedNoteId) && (!resolvedNotePath.includes("_hidden") || resolvedNotePath.includes("_lbBookmarks"))) {
        const noteId = treeService.getNoteIdFromLink(resolvedNotePath);
        if (!noteId) {
            return false;
        }
        const requestedNote = await froca.getNote(noteId);
        const hoistedNote = await froca.getNote(hoistedNoteId);

        if (
            (!hoistedNote?.hasAncestor("_hidden") || resolvedNotePath.includes("_lbBookmarks")) &&
            !(await dialogService.confirm(t("hoisted_note.confirm_unhoisting", { requestedNote: requestedNote?.title, hoistedNote: hoistedNote?.title })))
        ) {
            return false;
        }

        // unhoist so we can activate the note
        await unhoist();
    }

    return true;
}

export default {
    getHoistedNoteId,
    unhoist,
    isTopLevelNode,
    isHoistedNode,
    checkNoteAccess,
    isHoistedInHiddenSubtree
};
