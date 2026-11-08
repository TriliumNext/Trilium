"use strict";

import eventChangesService from "./entity_changes.js";
import treeService from "./tree.js";
import BBranch from "../becca/entities/bbranch.js";
import becca from "../becca/becca.js";
import { getLog } from "./log.js";
import { CloneResponse } from "@triliumnext/commons";
import { getSql } from "./sql/index.js";

function cloneNoteToParentNote(noteId: string, parentNoteId: string, prefix: string | null = null): CloneResponse {
    if (!(noteId in becca.notes) || !(parentNoteId in becca.notes)) {
        return { success: false, message: "Note cannot be cloned because either the cloned note or the intended parent is deleted." };
    }

    const parentNote = becca.getNote(parentNoteId);
    if (!parentNote) {
        return { success: false, message: "Note cannot be cloned because the parent note could not be found." };
    }

    if (parentNote.type === "search") {
        return {
            success: false,
            message: "Can't clone into a search note"
        };
    }

    const validationResult = treeService.validateParentChild(parentNoteId, noteId);

    if (!validationResult.success) {
        return validationResult;
    }

    const branch = new BBranch({
        noteId: noteId,
        parentNoteId: parentNoteId,
        prefix: prefix,
        isExpanded: false
    }).save();

    getLog().info(`Cloned note '${noteId}' to a new parent note '${parentNoteId}' with prefix '${prefix}'`);

    return {
        success: true,
        branchId: branch.branchId,
        notePath: `${parentNote.getBestNotePathString()}/${noteId}`
    };
}

function cloneNoteToBranch(noteId: string, parentBranchId: string, prefix?: string) {
    const parentBranch = becca.getBranch(parentBranchId);

    if (!parentBranch) {
        return { success: false, message: `Parent branch '${parentBranchId}' does not exist.` };
    }

    const ret = cloneNoteToParentNote(noteId, parentBranch.noteId, prefix);

    parentBranch.isExpanded = true; // the new target should be expanded, so it immediately shows up to the user
    parentBranch.save();

    return ret;
}

function ensureNoteIsPresentInParent(noteId: string, parentNoteId: string, prefix?: string) {
    if (!(noteId in becca.notes)) {
        return { branch: null, success: false, message: `Note '${noteId}' is deleted.` };
    } else if (!(parentNoteId in becca.notes)) {
        return { branch: null, success: false, message: `Note '${parentNoteId}' is deleted.` };
    }

    const parentNote = becca.getNote(parentNoteId);

    if (!parentNote) {
        return { branch: null, success: false, message: "Can't find parent note." };
    }
    if (parentNote.type === "search") {
        return { branch: null, success: false, message: "Can't clone into a search note" };
    }

    const validationResult = treeService.validateParentChild(parentNoteId, noteId);

    if (!validationResult.success) {
        return validationResult;
    }

    const branch = new BBranch({
        noteId: noteId,
        parentNoteId: parentNoteId,
        prefix: prefix,
        isExpanded: false
    }).save();

    getLog().info(`Ensured note '${noteId}' is in parent note '${parentNoteId}' with prefix '${branch.prefix}'`);

    return { branch: branch, success: true };
}

function ensureNoteIsAbsentFromParent(noteId: string, parentNoteId: string) {
    const branchId = getSql().getValue<string>(/*sql*/`SELECT branchId FROM branches WHERE noteId = ? AND parentNoteId = ? AND isDeleted = 0`, [noteId, parentNoteId]);
    const branch = becca.getBranch(branchId);

    if (branch) {
        if (!branch.isWeak && branch.getNote().getStrongParentBranches().length <= 1) {
            return {
                success: false,
                message: `Cannot remove branch '${branch.branchId}' between child '${noteId}' and parent '${parentNoteId}' because this would delete the note as well.`
            };
        }

        branch.deleteBranch();

        getLog().info(`Ensured note '${noteId}' is NOT in parent note '${parentNoteId}'`);

        return { success: true };
    }
}

function toggleNoteInParent(present: boolean, noteId: string, parentNoteId: string, prefix?: string) {
    if (present) {
        return ensureNoteIsPresentInParent(noteId, parentNoteId, prefix);
    } else {
        return ensureNoteIsAbsentFromParent(noteId, parentNoteId);
    }
}

function cloneNoteAfter(noteId: string, afterBranchId: string) {
    return cloneNoteNextToBranch(noteId, afterBranchId, "after");
}

/** Clones the note into the parent of `beforeBranchId`, placed right before that branch. */
function cloneNoteBefore(noteId: string, beforeBranchId: string) {
    return cloneNoteNextToBranch(noteId, beforeBranchId, "before");
}

function cloneNoteNextToBranch(noteId: string, siblingBranchId: string, side: "before" | "after") {
    if (["_hidden", "root"].includes(noteId)) {
        return { success: false, message: `Cloning the note '${noteId}' is forbidden.` };
    }

    const siblingBranch = becca.getBranch(siblingBranchId);

    if (!siblingBranch) {
        return { success: false, message: `Branch '${siblingBranchId}' does not exist.` };
    }

    if (siblingBranch.noteId === "_hidden") {
        return { success: false, message: `Cannot clone ${side} the hidden branch.` };
    }

    const { parentNoteId } = siblingBranch;

    if (!(noteId in becca.notes)) {
        return {
            success: false,
            message: `Note to be cloned '${noteId}' is deleted or does not exist.`
        };
    } else if (!(parentNoteId in becca.notes)) {
        return {
            success: false,
            message: `Parent note '${parentNoteId}' is deleted or does not exist.`
        };
    }

    const parentNote = becca.getNote(parentNoteId);

    if (!parentNote || parentNote.type === "search") {
        return {
            success: false,
            message: "Can't clone into a search note"
        };
    }

    const validationResult = treeService.validateParentChild(parentNoteId, noteId);

    if (!validationResult.success) {
        return validationResult;
    }

    // Before: the clone takes the sibling's position and the sibling moves down with the rest.
    // After: the sibling stays and the clone takes the position below it.
    const siblingPosition = siblingBranch.notePosition;
    const notePosition = side === "after" ? siblingPosition + 10 : siblingPosition;
    const movedPositions = side === "after" ? "notePosition > ?" : "notePosition >= ?";

    // we don't change utcDateModified, so other changes are prioritized in case of conflict
    // also we would have to sync all those modified branches otherwise hash checks would fail
    getSql().execute(/*sql*/`
        UPDATE branches SET notePosition = notePosition + 10
        WHERE parentNoteId = ? AND ${movedPositions} AND isDeleted = 0`,
    [parentNoteId, siblingPosition]);

    // Also copies the new positions into becca, which the next clone next to a sibling reads.
    eventChangesService.putNoteReorderingEntityChange(parentNoteId);

    const branch = new BBranch({
        noteId: noteId,
        parentNoteId,
        notePosition,
        isExpanded: false
    }).save();

    getLog().info(`Cloned note '${noteId}' into parent note '${parentNoteId}' ${side} note `
        + `'${siblingBranch.noteId}', branch '${siblingBranchId}'`);

    return { success: true, branchId: branch.branchId };
}

export default {
    cloneNoteToBranch,
    cloneNoteToParentNote,
    ensureNoteIsPresentInParent,
    ensureNoteIsAbsentFromParent,
    toggleNoteInParent,
    cloneNoteAfter,
    cloneNoteBefore
};
