import branchService from "../../services/branches.js";
import eraseService from "../../services/erase.js";
import eventService from "../../services/events.js";
import type { Request } from "express";

import becca from "../../becca/becca.js";
import entityChangesService from "../../services/entity_changes.js";
import { getLog } from "../../services/log.js";
import TaskContext from "../../services/task_context.js";
import treeService from "../../services/tree.js";
import { isEmptyOrWhitespace, randomString } from "../../services/utils/index.js";
import { getSql } from "../../services/sql/index.js";
import { ValidationError } from "../../errors.js";

/**
 * Code in this file deals with moving and cloning branches. The relationship between note and parent note is unique
 * for not deleted branches. There may be multiple deleted note-parent note relationships.
 */

function moveBranchToParent(req: Request) {
    const { branchId, parentBranchId } = req.params;

    const branchToMove = becca.getBranch(branchId);
    const targetParentBranch = becca.getBranch(parentBranchId);

    if (!branchToMove || !targetParentBranch) {
        throw new ValidationError(`One or both branches '${branchId}', '${parentBranchId}' have not been found`);
    }

    return branchService.moveBranchToBranch(branchToMove, targetParentBranch, branchId);
}

function moveBranchBeforeNote(req: Request) {
    const { branchId, beforeBranchId } = req.params;

    const branchToMove = becca.getBranchOrThrow(branchId);
    const beforeBranch = becca.getBranchOrThrow(beforeBranchId);

    const validationResult = treeService.validateParentChild(beforeBranch.parentNoteId, branchToMove.noteId, branchId);

    if (!validationResult.success) {
        return [200, validationResult];
    }

    const originalBeforeNotePosition = beforeBranch.notePosition;

    // we don't change utcDateModified, so other changes are prioritized in case of conflict
    // also we would have to sync all those modified branches otherwise hash checks would fail

    getSql().execute("UPDATE branches SET notePosition = notePosition + 10 WHERE parentNoteId = ? AND notePosition >= ? AND isDeleted = 0", [beforeBranch.parentNoteId, originalBeforeNotePosition]);

    // also need to update becca positions
    const parentNote = becca.getNoteOrThrow(beforeBranch.parentNoteId);

    for (const childBranch of parentNote.getChildBranches()) {
        if (childBranch.notePosition >= originalBeforeNotePosition) {
            childBranch.notePosition += 10;
        }
    }

    if (branchToMove.parentNoteId === beforeBranch.parentNoteId) {
        branchToMove.notePosition = originalBeforeNotePosition;
        branchToMove.save();
    } else {
        const newBranch = branchToMove.createClone(beforeBranch.parentNoteId, originalBeforeNotePosition);
        newBranch.save();

        branchToMove.markAsDeleted();
    }

    treeService.sortNotesIfNeeded(parentNote.noteId);

    // if sorting is not needed, then still the ordering might have changed above manually
    entityChangesService.putNoteReorderingEntityChange(parentNote.noteId);

    getLog().info(`Moved note ${branchToMove.noteId}, branch ${branchId} before note ${beforeBranch.noteId}, branch ${beforeBranchId}`);

    return { success: true };
}

function moveBranchAfterNote(req: Request) {
    const { branchId, afterBranchId } = req.params;

    const branchToMove = becca.getBranchOrThrow(branchId);
    const afterNote = becca.getBranchOrThrow(afterBranchId);

    const validationResult = treeService.validateParentChild(afterNote.parentNoteId, branchToMove.noteId, branchId);

    if (!validationResult.success) {
        return [200, validationResult];
    }

    const originalAfterNotePosition = afterNote.notePosition;

    // we don't change utcDateModified, so other changes are prioritized in case of conflict
    // also we would have to sync all those modified branches otherwise hash checks would fail
    getSql().execute("UPDATE branches SET notePosition = notePosition + 10 WHERE parentNoteId = ? AND notePosition > ? AND isDeleted = 0", [afterNote.parentNoteId, originalAfterNotePosition]);

    // also need to update becca positions
    const parentNote = becca.getNoteOrThrow(afterNote.parentNoteId);

    for (const childBranch of parentNote.getChildBranches()) {
        if (childBranch.notePosition > originalAfterNotePosition) {
            childBranch.notePosition += 10;
        }
    }

    const movedNotePosition = originalAfterNotePosition + 10;

    if (branchToMove.parentNoteId === afterNote.parentNoteId) {
        branchToMove.notePosition = movedNotePosition;
        branchToMove.save();
    } else {
        const newBranch = branchToMove.createClone(afterNote.parentNoteId, movedNotePosition);
        newBranch.save();

        branchToMove.markAsDeleted();
    }

    treeService.sortNotesIfNeeded(parentNote.noteId);

    // if sorting is not needed, then still the ordering might have changed above manually
    entityChangesService.putNoteReorderingEntityChange(parentNote.noteId);

    getLog().info(`Moved note ${branchToMove.noteId}, branch ${branchId} after note ${afterNote.noteId}, branch ${afterBranchId}`);

    return { success: true };
}

function setExpanded(req: Request) {
    const { branchId } = req.params;
    const expanded = parseInt(req.params.expanded);

    if (branchId !== "none_root") {
        getSql().execute("UPDATE branches SET isExpanded = ? WHERE branchId = ?", [expanded, branchId]);
        // we don't sync expanded label
        // also this does not trigger updates to the frontend, this would trigger too many reloads

        const branch = becca.branches[branchId];

        if (branch) {
            branch.isExpanded = !!expanded;
        }

        eventService.emit(eventService.ENTITY_CHANGED, {
            entityName: "branches",
            entity: branch
        });
    }
}

function setExpandedForSubtree(req: Request) {
    const { branchId } = req.params;
    const expanded = parseInt(req.params.expanded);
    const sql = getSql();

    let branchIds = sql.getColumn<string>(
        `
        WITH RECURSIVE
        tree(branchId, noteId) AS (
            SELECT branchId, noteId FROM branches WHERE branchId = ?
            UNION
            SELECT branches.branchId, branches.noteId FROM branches
                JOIN tree ON branches.parentNoteId = tree.noteId
            WHERE branches.isDeleted = 0
                AND branches.isExpanded = 1
        )
        SELECT branchId FROM tree`,
        [branchId]
    );

    // root is always expanded
    branchIds = branchIds.filter((branchId) => branchId !== "none_root");

    sql.executeMany(/*sql*/`UPDATE branches SET isExpanded = ${expanded} WHERE branchId IN (???)`, branchIds);

    for (const branchId of branchIds) {
        const branch = becca.branches[branchId];

        if (branch) {
            branch.isExpanded = !!expanded;
        }
    }

    return {
        branchIds
    };
}

/**
 * @swagger
 * /api/branches/{branchId}:
 *   delete:
 *     summary: Delete branch (note clone)
 *     operationId: branches-delete
 *     parameters:
 *       - name: branchId
 *         in: path
 *         required: true
 *         schema:
 *           $ref: "#/components/schemas/BranchId"
 *       - name: taskId
 *         in: query
 *         required: true
 *         schema:
 *           type: string
 *         description: Task group identifier
 *       - name: eraseNotes
 *         in: query
 *         schema:
 *           type: boolean
 *         required: false
 *         description: Whether to erase the note immediately
 *       - name: last
 *         in: query
 *         schema:
 *           type: boolean
 *         required: true
 *         description: Whether this is the last request of this task group
 *     responses:
 *       '200':
 *         description: Branch successfully deleted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 noteDeleted:
 *                   type: boolean
 *                   description: Whether the last note clone was deleted
 *     security:
 *       - session: []
 *     tags: ["data"]
 */
function deleteBranch(req: Request) {
    const last = req.query.last === "true";
    const eraseNotes = req.query.eraseNotes === "true";
    const branch = becca.getBranchOrThrow(req.params.branchId);

    const taskContext = TaskContext.getInstance(req.query.taskId as string, "deleteNotes", null);

    const deleteId = randomString(10);
    let noteDeleted;

    if (eraseNotes) {
        // erase automatically means deleting all clones + note itself
        branch.getNote().deleteNote(deleteId, taskContext);
        eraseService.eraseNotesWithDeleteId(deleteId);
        noteDeleted = true;
    } else {
        noteDeleted = branch.deleteBranch(deleteId, taskContext);
    }

    if (last) {
        taskContext.taskSucceeded(null);
    }

    return {
        noteDeleted
    };
}

function setPrefix(req: Request) {
    const branchId = req.params.branchId;
    //TriliumNextTODO: req.body arrives as string, so req.body.prefix will be undefined – did the code below ever even work?
    const prefix = isEmptyOrWhitespace(req.body.prefix) ? null : req.body.prefix;

    const branch = becca.getBranchOrThrow(branchId);
    branch.prefix = prefix;
    branch.save();
}

function setPrefixBatch(req: Request) {
    const { branchIds, prefix } = req.body;

    if (!Array.isArray(branchIds)) {
        throw new ValidationError("branchIds must be an array");
    }

    // Validate that prefix is a string or null/undefined to prevent prototype pollution
    if (prefix !== null && prefix !== undefined && typeof prefix !== 'string') {
        throw new ValidationError("prefix must be a string or null");
    }

    const normalizedPrefix = isEmptyOrWhitespace(prefix) ? null : prefix;
    let updatedCount = 0;

    for (const branchId of branchIds) {
        const branch = becca.getBranch(branchId);
        if (branch) {
            branch.prefix = normalizedPrefix;
            branch.save();
            updatedCount++;
        } else {
            getLog().info(`Branch ${branchId} not found, skipping prefix update`);
        }
    }

    return {
        success: true,
        count: updatedCount
    };
}

export default {
    moveBranchToParent,
    moveBranchBeforeNote,
    moveBranchAfterNote,
    setExpanded,
    setExpandedForSubtree,
    deleteBranch,
    setPrefix,
    setPrefixBatch
};
