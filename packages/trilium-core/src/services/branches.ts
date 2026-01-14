import treeService from "./tree.js";
import type BBranch from "../becca/entities/bbranch.js";
import { getSql } from "./sql/index.js";

function moveBranchToNote(branchToMove: BBranch, targetParentNoteId: string) {
    if (branchToMove.parentNoteId === targetParentNoteId) {
        return { success: true }; // no-op
    }

    const validationResult = treeService.validateParentChild(targetParentNoteId, branchToMove.noteId, branchToMove.branchId);

    if (!validationResult.success) {
        return [200, validationResult];
    }

    const maxNotePos = getSql().getValue<number | null>("SELECT MAX(notePosition) FROM branches WHERE parentNoteId = ? AND isDeleted = 0", [targetParentNoteId]);
    const newNotePos = !maxNotePos ? 0 : maxNotePos + 10;

    const newBranch = branchToMove.createClone(targetParentNoteId, newNotePos);
    newBranch.save();

    branchToMove.markAsDeleted();

    return {
        success: true,
        branch: newBranch
    };
}

function moveBranchToBranch(branchToMove: BBranch, targetParentBranch: BBranch, branchId: string) {
    // TODO: Unused branch ID argument.
    const res = moveBranchToNote(branchToMove, targetParentBranch.noteId);

    if (!("success" in res) || !res.success) {
        return res;
    }

    // expanding so that the new placement of the branch is immediately visible
    if (!targetParentBranch.isExpanded) {
        targetParentBranch.isExpanded = true;
        targetParentBranch.save();
    }

    return res;
}

export default {
    moveBranchToBranch,
    moveBranchToNote
};
