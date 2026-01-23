/**
 * Move Note Tool
 *
 * This tool moves a note under a different parent note.
 * It operates on branches to preserve Trilium's multi-parent model.
 */

import type { Tool, ToolHandler } from './tool_interfaces.js';
import log from '../../log.js';
import becca from '../../../becca/becca.js';
import branchService from '../../branches.js';
import type BBranch from '../../../becca/entities/bbranch.js';

export const moveNoteToolDefinition: Tool = {
    type: 'function',
    function: {
        name: 'move_note',
        description: 'Move a note under a different parent note. If the note has multiple parents, provide sourceParentNoteId or branchId to choose which branch to move.',
        parameters: {
            type: 'object',
            properties: {
                noteId: {
                    type: 'string',
                    description: 'System ID of the note to move (not the title).'
                },
                targetParentNoteId: {
                    type: 'string',
                    description: 'System ID of the destination parent note.'
                },
                targetParentBranchId: {
                    type: 'string',
                    description: 'Optional branch ID of the destination parent. Prefer this when the parent note has multiple parents.'
                },
                sourceParentNoteId: {
                    type: 'string',
                    description: 'Optional system ID of the current parent note. Required if the note has multiple parents.'
                },
                branchId: {
                    type: 'string',
                    description: 'Optional branch ID to move. Use this if you know the exact branch to move.'
                }
            },
            required: ['noteId', 'targetParentNoteId']
        }
    }
};

export class MoveNoteTool implements ToolHandler {
    public definition: Tool = moveNoteToolDefinition;

    public async execute(args: {
        noteId: string;
        targetParentNoteId: string;
        targetParentBranchId?: string;
        sourceParentNoteId?: string;
        branchId?: string;
    }): Promise<string | object> {
        try {
            const { noteId, targetParentNoteId, targetParentBranchId, sourceParentNoteId, branchId } = args;

            const note = becca.notes[noteId];
            if (!note) {
                return `Error: Note with ID ${noteId} not found.`;
            }

            const targetParent = becca.notes[targetParentNoteId];
            if (!targetParent) {
                return `Error: Target parent note with ID ${targetParentNoteId} not found.`;
            }

            const branchToMove = this.resolveBranch(noteId, sourceParentNoteId, branchId);
            if (!branchToMove) {
                const parentBranchIds = note.getParentBranches().map(parentBranch => parentBranch.parentNoteId);
                return `Error: Unable to resolve the note branch to move. Provide sourceParentNoteId or branchId when the note has multiple parents. Available parents: ${parentBranchIds.join(', ') || 'none'}.`;
            }

            const fromParentNoteId = branchToMove.parentNoteId;
            log.info(`Executing move_note tool - NoteID: ${noteId}, from: ${fromParentNoteId}, to: ${targetParentNoteId}`);

            let result;
            if (targetParentBranchId) {
                const targetParentBranch = becca.getBranch(targetParentBranchId);
                if (!targetParentBranch) {
                    return `Error: Target parent branch with ID ${targetParentBranchId} not found.`;
                }
                if (targetParentBranch.noteId !== targetParentNoteId) {
                    return `Error: Target parent branch ${targetParentBranchId} does not belong to note ${targetParentNoteId}.`;
                }
                result = branchService.moveBranchToBranch(branchToMove, targetParentBranch, branchToMove.branchId || '');
            } else {
                result = branchService.moveBranchToNote(branchToMove, targetParentNoteId);
            }
            const rawResult = Array.isArray(result) ? result[1] : result;

            // Type guard for success result
            const isSuccessResult = (r: unknown): r is { success: boolean; branch?: BBranch; message?: string } =>
                typeof r === 'object' && r !== null && 'success' in r;

            if (!isSuccessResult(rawResult) || !rawResult.success) {
                const message = isSuccessResult(rawResult) && 'message' in rawResult
                    ? String(rawResult.message)
                    : 'Move failed due to validation or unknown error.';
                return `Error: ${message}`;
            }

            const newBranchId = rawResult.branch?.branchId;
            let cleanupRemovedSourceBranch = false;
            if (fromParentNoteId !== targetParentNoteId) {
                const remainingBranch = becca.getBranchFromChildAndParent(noteId, fromParentNoteId);
                if (remainingBranch && remainingBranch.branchId !== newBranchId) {
                    remainingBranch.markAsDeleted();
                    cleanupRemovedSourceBranch = true;
                }
            }

            return {
                success: true,
                noteId: note.noteId,
                title: note.title,
                fromParentNoteId,
                toParentNoteId: targetParentNoteId,
                branchId: newBranchId,
                cleanupRemovedSourceBranch,
                message: `Moved "${note.title}" to new parent ${targetParentNoteId}`
            };
        } catch (error: any) {
            log.error(`Error executing move_note tool: ${error.message || String(error)}`);
            return `Error: ${error.message || String(error)}`;
        }
    }

    private resolveBranch(noteId: string, sourceParentNoteId?: string, branchId?: string): BBranch | null {
        if (branchId) {
            const byId = becca.getBranch(branchId);
            return byId && byId.noteId === noteId ? byId : null;
        }

        if (sourceParentNoteId) {
            return becca.getBranchFromChildAndParent(noteId, sourceParentNoteId);
        }

        const note = becca.notes[noteId];
        if (!note) {
            return null;
        }

        const parentBranches = note.getParentBranches();
        if (parentBranches.length === 1) {
            return parentBranches[0];
        }

        return null;
    }
}
