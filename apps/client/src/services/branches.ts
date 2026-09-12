import appContext from "../components/app_context.js";
import type FBranch from "../entities/fbranch.js";
import type { ResolveOptions } from "../widgets/dialogs/delete_notes.js";
import froca from "./froca.js";
import hoistedNoteService from "./hoisted_note.js";
import { t } from "./i18n.js";
import server from "./server.js";
import toastService, { type ToastOptionsWithRequiredId } from "./toast.js";
import utils from "./utils.js";
import ws from "./ws.js";

// TODO: Deduplicate type with server
interface Response {
    success: boolean;
    message: string;
}

async function moveBeforeBranch(branchIdsToMove: string[], beforeBranchId: string) {
    branchIdsToMove = filterRootNote(branchIdsToMove);
    branchIdsToMove = filterSearchBranches(branchIdsToMove);

    const beforeBranch = froca.getBranch(beforeBranchId);
    if (!beforeBranch) {
        return;
    }

    if (beforeBranch.noteId === "root" || utils.isLaunchBarConfig(beforeBranch.noteId)) {
        toastService.showError(t("branches.cannot-move-notes-here"));
        return;
    }

    for (const branchIdToMove of branchIdsToMove) {
        const resp = await server.put<Response>(`branches/${branchIdToMove}/move-before/${beforeBranchId}`);

        if (!resp.success) {
            toastService.showError(resp.message);
            return;
        }
    }
}

async function moveAfterBranch(branchIdsToMove: string[], afterBranchId: string) {
    branchIdsToMove = filterRootNote(branchIdsToMove);
    branchIdsToMove = filterSearchBranches(branchIdsToMove);

    const afterNote = await froca.getBranch(afterBranchId)?.getNote();
    if (!afterNote) {
        return;
    }

    const forbiddenNoteIds = ["root", hoistedNoteService.getHoistedNoteId(), "_lbRoot", "_lbAvailableLaunchers", "_lbVisibleLaunchers"];

    if (forbiddenNoteIds.includes(afterNote.noteId)) {
        toastService.showError(t("branches.cannot-move-notes-here"));
        return;
    }

    branchIdsToMove.reverse(); // need to reverse to keep the note order

    for (const branchIdToMove of branchIdsToMove) {
        const resp = await server.put<Response>(`branches/${branchIdToMove}/move-after/${afterBranchId}`);

        if (!resp.success) {
            toastService.showError(resp.message);
            return;
        }
    }
}

async function moveToParentNote(branchIdsToMove: string[], newParentBranchId: string, componentId?: string) {
    const newParentBranch = froca.getBranch(newParentBranchId);
    if (!newParentBranch) {
        return;
    }

    if (newParentBranch.noteId === "_lbRoot") {
        toastService.showError(t("branches.cannot-move-notes-here"));
        return;
    }

    branchIdsToMove = filterRootNote(branchIdsToMove);

    for (const branchIdToMove of branchIdsToMove) {
        const branchToMove = froca.getBranch(branchIdToMove);

        if (!branchToMove || branchToMove.noteId === hoistedNoteService.getHoistedNoteId() || (await branchToMove.getParentNote())?.type === "search") {
            continue;
        }

        const resp = await server.put<Response>(`branches/${branchIdToMove}/move-to/${newParentBranchId}`, undefined, componentId);

        if (!resp.success) {
            toastService.showError(resp.message);
            return;
        }
    }
}

/**
 * Shows the delete confirmation screen
 *
 * @param branchIdsToDelete the list of branch IDs to delete.
 * @param forceDeleteAllClones whether to check by default the "Delete also all clones" checkbox.
 * @param moveToParent whether to automatically go to the parent note path after a succesful delete. Usually makes sense if deleting the active note(s).
 * @returns promise that returns false if the operation was cancelled or there was nothing to delete, true if the operation succeeded.
 */
async function deleteNotes(branchIdsToDelete: string[], forceDeleteAllClones = false, moveToParent = true, componentId?: string) {
    branchIdsToDelete = filterRootNote(branchIdsToDelete);

    if (branchIdsToDelete.length === 0) {
        return false;
    }

    const { proceed, deleteAllClones, eraseNotes } = await new Promise<ResolveOptions>((res) =>
        appContext.triggerCommand("showDeleteNotesDialog", { branchIdsToDelete, callback: res, forceDeleteAllClones })
    );

    if (!proceed) {
        return false;
    }

    if (moveToParent) {
        try {
            await activateNeighbouringNotePath(branchIdsToDelete, deleteAllClones);
        } catch (e) {
            console.error(e);
        }
    }

    const taskId = utils.randomString(10);

    let counter = 0;

    for (const branchIdToDelete of branchIdsToDelete) {
        counter++;

        const last = counter === branchIdsToDelete.length;
        const query = `?taskId=${taskId}&eraseNotes=${eraseNotes ? "true" : "false"}&last=${last ? "true" : "false"}`;

        const branch = froca.getBranch(branchIdToDelete);

        if (deleteAllClones && branch) {
            await server.remove(`notes/${branch.noteId}${query}`, componentId);
        } else {
            await server.remove(`branches/${branchIdToDelete}${query}`, componentId);
        }
    }

    if (eraseNotes) {
        utils.reloadFrontendApp("erasing notes requires reload");
    }

    return true;
}

/**
 * Moves the active tab off a note that the deletion is about to remove from its path. The
 * destination is the nearest sibling that survives the deletion (the next one, else the previous
 * one), so the tree keeps its scroll position and the user stays where they were working; the
 * parent is the fallback when no sibling survives.
 */
async function activateNeighbouringNotePath(branchIdsToDelete: string[], deleteAllClones = false) {
    const activeContext = appContext.tabManager.getActiveContext();
    const activeNotePath = activeContext?.notePathArray ?? [];

    // Find the deleted branch that appears earliest in the active note's path
    let earliestIndex = activeNotePath.length;
    for (const branchId of branchIdsToDelete) {
        const branch = froca.getBranch(branchId);
        if (branch) {
            const index = activeNotePath.indexOf(branch.noteId);
            if (index !== -1 && index < earliestIndex) {
                earliestIndex = index;
            }
        }
    }

    if (earliestIndex >= activeNotePath.length) {
        return;
    }

    const parentPath = activeNotePath.slice(0, earliestIndex);
    if (parentPath.length === 0) {
        return;
    }

    const siblingNoteId = findSurvivingSibling(
        parentPath[parentPath.length - 1],
        activeNotePath[earliestIndex],
        branchIdsToDelete,
        deleteAllClones
    );
    const targetPath = siblingNoteId ? [ ...parentPath, siblingNoteId ] : parentPath;
    await activeContext?.setNote(targetPath.join("/"));
}

/**
 * Finds the child of `parentNoteId` closest to `noteId` that is still there once the given branches
 * are deleted: the next sibling, else the previous one. Archived siblings are skipped, since the
 * tree can be set to hide them.
 */
function findSurvivingSibling(
    parentNoteId: string,
    noteId: string,
    branchIdsToDelete: string[],
    deleteAllClones: boolean
) {
    const parentNote = froca.getNoteFromCache(parentNoteId);
    if (!parentNote) {
        return null;
    }

    const siblingBranches = parentNote.getChildBranches();
    const index = siblingBranches.findIndex((branch) => branch.noteId === noteId);
    if (index === -1) {
        return null;
    }

    // Deleting all clones removes every branch of the deleted notes, not only the selected ones.
    const deletedNoteIds = new Set(
        branchIdsToDelete.map((branchId) => froca.getBranch(branchId)?.noteId)
    );
    const survives = (branch: FBranch) =>
        !branchIdsToDelete.includes(branch.branchId)
        && !(deleteAllClones && deletedNoteIds.has(branch.noteId))
        && !froca.getNoteFromCache(branch.noteId)?.isArchived;

    const candidates = [
        ...siblingBranches.slice(index + 1),
        ...siblingBranches.slice(0, index).reverse()
    ];
    return candidates.find(survives)?.noteId ?? null;
}

async function moveNodeUpInHierarchy(node: Fancytree.FancytreeNode) {
    if (hoistedNoteService.isHoistedNode(node) || hoistedNoteService.isTopLevelNode(node) || node.getParent().data.noteType === "search") {
        return;
    }

    const targetBranchId = node.getParent().data.branchId;
    const branchIdToMove = node.data.branchId;

    const resp = await server.put<Response>(`branches/${branchIdToMove}/move-after/${targetBranchId}`);

    if (!resp.success) {
        toastService.showError(resp.message);
        return;
    }
}

function filterSearchBranches(branchIds: string[]) {
    return branchIds.filter((branchId) => !branchId.startsWith("virt-"));
}

function filterRootNote(branchIds: string[]) {
    const hoistedNoteId = hoistedNoteService.getHoistedNoteId();

    return branchIds.filter((branchId) => {
        const branch = froca.getBranch(branchId);
        if (!branch) {
            return false;
        }

        return branch.noteId !== "root" && branch.noteId !== hoistedNoteId;
    });
}

function makeToast(id: string, message: string): ToastOptionsWithRequiredId {
    return {
        id,
        message,
        icon: "trash"
    };
}

ws.subscribeToMessages(async (message) => {
    if (!("taskType" in message) || message.taskType !== "deleteNotes") {
        return;
    }

    if (message.type === "taskError") {
        toastService.closePersistent(message.taskId);
        toastService.showError(message.message);
    } else if (message.type === "taskProgressCount") {
        toastService.showPersistent(makeToast(message.taskId, t("branches.delete-notes-in-progress", { count: message.progressCount })));
    } else if (message.type === "taskSucceeded") {
        const toast = makeToast(message.taskId, t("branches.delete-finished-successfully"));
        toast.timeout = 5000;

        toastService.showPersistent(toast);
    }
});

ws.subscribeToMessages(async (message) => {
    if (!("taskType" in message) || message.taskType !== "undeleteNotes") {
        return;
    }

    if (message.type === "taskError") {
        toastService.closePersistent(message.taskId);
        toastService.showError(message.message);
    } else if (message.type === "taskProgressCount") {
        toastService.showPersistent(makeToast(message.taskId, t("branches.undeleting-notes-in-progress", { count: message.progressCount })));
    } else if (message.type === "taskSucceeded") {
        const toast = makeToast(message.taskId, t("branches.undeleting-notes-finished-successfully"));
        toast.timeout = 5000;

        toastService.showPersistent(toast);
    }
});

async function cloneNoteToBranch(childNoteId: string, parentBranchId: string, prefix?: string) {
    const resp = await server.put<Response>(`notes/${childNoteId}/clone-to-branch/${parentBranchId}`, {
        prefix
    });

    if (!resp.success) {
        toastService.showError(resp.message);
    }
}

async function cloneNoteToParentNote(childNoteId: string, parentNoteId: string, prefix?: string) {
    const resp = await server.put<Response>(`notes/${childNoteId}/clone-to-note/${parentNoteId}`, {
        prefix
    });

    if (!resp.success) {
        toastService.showError(resp.message);
    }
}

// beware that the first arg is noteId and the second is branchId!
async function cloneNoteAfter(noteId: string, afterBranchId: string) {
    const resp = await server.put<Response>(`notes/${noteId}/clone-after/${afterBranchId}`);

    if (!resp.success) {
        toastService.showError(resp.message);
    }
}

export default {
    moveBeforeBranch,
    moveAfterBranch,
    moveToParentNote,
    deleteNotes,
    moveNodeUpInHierarchy,
    cloneNoteAfter,
    cloneNoteToBranch,
    cloneNoteToParentNote
};
