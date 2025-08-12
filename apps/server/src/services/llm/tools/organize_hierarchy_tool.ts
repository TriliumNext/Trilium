/**
 * Organize Hierarchy Tool
 *
 * This tool allows the LLM to manage note placement and branches in Trilium's hierarchical structure.
 * It can move notes, manage note positions, set branch prefixes, and organize the note tree.
 */

import type { Tool, ToolHandler, StandardizedToolResponse } from './tool_interfaces.js';
import { ToolResponseFormatter } from './tool_interfaces.js';
import { ParameterValidationHelpers } from './parameter_validation_helpers.js';
import log from '../../log.js';
import becca from '../../../becca/becca.js';
import BBranch from '../../../becca/entities/bbranch.js';
import utils from '../../utils.js';

/**
 * Definition of the organize hierarchy tool
 */
export const organizeHierarchyToolDefinition: Tool = {
    type: 'function',
    function: {
        name: 'organize_hierarchy',
        description: 'Move notes and organize the note tree structure. Can move notes to new parents, set positions for ordering, add prefixes, and manage the hierarchical organization. Perfect for restructuring and organizing your note tree.',
        parameters: {
            type: 'object',
            properties: {
                action: {
                    type: 'string',
                    description: 'The organizational action to perform',
                    enum: ['move', 'reorder', 'set_prefix', 'organize_batch'],
                    default: 'move'
                },
                noteIds: {
                    type: 'array',
                    description: 'Array of noteIds to organize. Use noteIds from search results, not note titles. Example: ["note1", "note2"] for batch operations',
                    items: {
                        type: 'string',
                        description: 'NoteId from search results'
                    },
                    minItems: 1,
                    maxItems: 20
                },
                targetParentId: {
                    type: 'string',
                    description: 'Where to move the notes. Required for "move" action. Use noteId from search results. Example: "parent123" - the folder where notes should be moved'
                },
                positions: {
                    type: 'array',
                    description: 'Optional array of positions for ordering notes. Controls the order within the parent. Numbers like 10, 20, 30 work well. Example: [10, 20, 30] sets first note at position 10',
                    items: {
                        type: 'number',
                        description: 'Position number for ordering (10, 20, 30, etc.)'
                    }
                },
                prefixes: {
                    type: 'array',
                    description: 'Optional array of prefixes to set on branches. Prefixes appear before the note title. Example: ["1. ", "2. ", "3. "] for numbering, ["Priority: ", "Task: "] for categorization',
                    items: {
                        type: 'string',
                        description: 'Prefix text to appear before note title'
                    }
                },
                keepOriginal: {
                    type: 'boolean',
                    description: 'For "move" action: whether to keep the original branch (creating clone) or move completely. Default false = move completely',
                    default: false
                },
                sortBy: {
                    type: 'string',
                    description: 'For "reorder" action: how to sort notes. Options: "title", "dateCreated", "dateModified", "position"',
                    enum: ['title', 'dateCreated', 'dateModified', 'position']
                },
                sortDirection: {
                    type: 'string',
                    description: 'Sort direction for reordering',
                    enum: ['asc', 'desc'],
                    default: 'asc'
                }
            },
            required: ['action', 'noteIds']
        }
    }
};

/**
 * Organize hierarchy tool implementation
 */
export class OrganizeHierarchyTool implements ToolHandler {
    public definition: Tool = organizeHierarchyToolDefinition;

    /**
     * Execute the organize hierarchy tool with standardized response format
     */
    public async executeStandardized(args: {
        action: 'move' | 'reorder' | 'set_prefix' | 'organize_batch',
        noteIds: string[],
        targetParentId?: string,
        positions?: number[],
        prefixes?: string[],
        keepOriginal?: boolean,
        sortBy?: 'title' | 'dateCreated' | 'dateModified' | 'position',
        sortDirection?: 'asc' | 'desc'
    }): Promise<StandardizedToolResponse> {
        const startTime = Date.now();

        try {
            const { 
                action, 
                noteIds, 
                targetParentId, 
                positions, 
                prefixes, 
                keepOriginal = false,
                sortBy = 'position',
                sortDirection = 'asc'
            } = args;

            log.info(`Executing organize_hierarchy tool - Action: "${action}", Notes: ${noteIds.length}`);

            // Validate action
            const actionValidation = ParameterValidationHelpers.validateAction(
                action, 
                ['move', 'reorder', 'set_prefix', 'organize_batch'],
                {
                    'move': 'Move notes to a different parent folder',
                    'reorder': 'Change the order of notes within their parent',
                    'set_prefix': 'Set prefixes on note branches (e.g., "1. ", "Task: ")',
                    'organize_batch': 'Perform multiple organization operations at once'
                }
            );
            if (actionValidation) {
                return actionValidation;
            }

            // Validate noteIds array
            if (!noteIds || !Array.isArray(noteIds) || noteIds.length === 0) {
                return ToolResponseFormatter.invalidParameterError(
                    'noteIds',
                    'array of noteIds from search results',
                    typeof noteIds
                );
            }

            if (noteIds.length > 20) {
                return ToolResponseFormatter.error(
                    `Too many notes to organize: ${noteIds.length}. Maximum is 20.`,
                    {
                        possibleCauses: [
                            'Attempting to organize too many notes at once',
                            'Large array provided accidentally'
                        ],
                        suggestions: [
                            'Organize notes in smaller batches (20 or fewer)',
                            'Use multiple operations for large reorganizations',
                            'Focus on organizing related notes together'
                        ],
                        examples: [
                            'organize_hierarchy("move", ["note1", "note2"], targetParentId)',
                            'Break large operations into smaller chunks'
                        ]
                    }
                );
            }

            // Validate each noteId
            for (let i = 0; i < noteIds.length; i++) {
                const noteValidation = ParameterValidationHelpers.validateNoteId(noteIds[i], `noteIds[${i}]`);
                if (noteValidation) {
                    return noteValidation;
                }
            }

            // Validate target parent for move action
            if (action === 'move' && !targetParentId) {
                return ToolResponseFormatter.invalidParameterError(
                    'targetParentId',
                    'noteId of the parent folder for move action',
                    'missing'
                );
            }

            if (targetParentId) {
                const parentValidation = ParameterValidationHelpers.validateNoteId(targetParentId, 'targetParentId');
                if (parentValidation) {
                    return parentValidation;
                }

                // Verify target parent exists
                const targetParent = becca.getNote(targetParentId);
                if (!targetParent) {
                    return ToolResponseFormatter.noteNotFoundError(targetParentId);
                }
            }

            // Validate array lengths match if provided
            if (positions && positions.length !== noteIds.length) {
                return ToolResponseFormatter.error(
                    `Positions array length (${positions.length}) must match noteIds length (${noteIds.length})`,
                    {
                        possibleCauses: [
                            'Mismatched array lengths',
                            'Incorrect positions array format'
                        ],
                        suggestions: [
                            'Provide one position for each note',
                            'Omit positions to use automatic positioning',
                            'Ensure positions array has same length as noteIds'
                        ],
                        examples: [
                            'positions: [10, 20, 30] for 3 notes',
                            'Omit positions for automatic placement'
                        ]
                    }
                );
            }

            if (prefixes && prefixes.length !== noteIds.length) {
                return ToolResponseFormatter.error(
                    `Prefixes array length (${prefixes.length}) must match noteIds length (${noteIds.length})`,
                    {
                        possibleCauses: [
                            'Mismatched array lengths',
                            'Incorrect prefixes array format'
                        ],
                        suggestions: [
                            'Provide one prefix for each note',
                            'Omit prefixes to leave unchanged',
                            'Ensure prefixes array has same length as noteIds'
                        ],
                        examples: [
                            'prefixes: ["1. ", "2. ", "3. "] for 3 notes',
                            'Use empty strings "" for notes without prefixes'
                        ]
                    }
                );
            }

            // Execute the requested action
            const result = await this.executeAction(
                action, 
                noteIds, 
                targetParentId, 
                positions, 
                prefixes, 
                keepOriginal, 
                sortBy, 
                sortDirection
            );

            if (!result.success) {
                return ToolResponseFormatter.error(result.error || 'Organization operation failed', result.help || {
                    possibleCauses: ['Organization operation failed'],
                    suggestions: ['Check organization parameters', 'Verify notes exist and are accessible']
                });
            }

            const executionTime = Date.now() - startTime;

            const nextSteps = {
                suggested: this.getNextStepsSuggestion(action, noteIds, targetParentId),
                alternatives: [
                    'Use search_notes to verify the organization changes',
                    'Use read_note to check individual note placements',
                    'Use organize_hierarchy again to fine-tune positions or prefixes',
                    'Navigate the note tree to see the reorganized structure'
                ],
                examples: [
                    ...noteIds.slice(0, 3).map(noteId => `read_note("${noteId}")`),
                    targetParentId ? `search_notes in parent "${targetParentId}"` : 'search_notes to find notes',
                    'organize_hierarchy("reorder", noteIds, null, [10, 20, 30])'
                ]
            };

            return ToolResponseFormatter.success(
                result.data,
                nextSteps,
                {
                    executionTime,
                    resourcesUsed: ['database', 'branches', 'note-hierarchy'],
                    action,
                    notesProcessed: noteIds.length,
                    operationDuration: result.operationTime
                }
            );

        } catch (error: any) {
            const errorMessage = error.message || String(error);
            log.error(`Error executing organize_hierarchy tool: ${errorMessage}`);
            
            return ToolResponseFormatter.error(
                `Hierarchy organization failed: ${errorMessage}`,
                {
                    possibleCauses: [
                        'Database write error',
                        'Invalid parameters provided',
                        'Circular reference attempt',
                        'Insufficient permissions'
                    ],
                    suggestions: [
                        'Check if Trilium service is running properly',
                        'Verify all noteIds are valid and accessible',
                        'Ensure target parent is not a child of notes being moved',
                        'Try organizing fewer notes at once'
                    ]
                }
            );
        }
    }

    /**
     * Execute the specific organization action
     */
    private async executeAction(
        action: string,
        noteIds: string[],
        targetParentId?: string,
        positions?: number[],
        prefixes?: string[],
        keepOriginal?: boolean,
        sortBy?: string,
        sortDirection?: string
    ): Promise<{
        success: boolean;
        data?: any;
        error?: string;
        help?: any;
        operationTime: number;
    }> {
        const operationStart = Date.now();

        try {
            switch (action) {
                case 'move':
                    return await this.executeMoveAction(noteIds, targetParentId!, positions, prefixes, keepOriginal);
                
                case 'reorder':
                    return await this.executeReorderAction(noteIds, sortBy!, sortDirection!, positions);
                
                case 'set_prefix':
                    return await this.executeSetPrefixAction(noteIds, prefixes!);
                
                case 'organize_batch':
                    return await this.executeOrganizeBatchAction(noteIds, targetParentId, positions, prefixes, keepOriginal);
                
                default:
                    return {
                        success: false,
                        error: `Unsupported action: ${action}`,
                        help: {
                            possibleCauses: ['Invalid action parameter'],
                            suggestions: ['Use one of: move, reorder, set_prefix, organize_batch']
                        },
                        operationTime: Date.now() - operationStart
                    };
            }
        } catch (error: any) {
            return {
                success: false,
                error: error.message,
                help: {
                    possibleCauses: ['Operation execution error'],
                    suggestions: ['Check parameters and try again']
                },
                operationTime: Date.now() - operationStart
            };
        }
    }

    /**
     * Execute move action
     */
    private async executeMoveAction(
        noteIds: string[],
        targetParentId: string,
        positions?: number[],
        prefixes?: string[],
        keepOriginal?: boolean
    ): Promise<any> {
        const operationStart = Date.now();
        const movedNotes: Array<{
            noteId: string;
            title: string;
            action: string;
            originalBranches?: number;
            newBranchId?: string | undefined;
            branchesRemoved?: number;
            updatedBranchId?: string | undefined;
        }> = [];
        const errors: string[] = [];

        const targetParent = becca.getNote(targetParentId);
        
        if (!targetParent) {
            throw new Error(`Target parent note not found: ${targetParentId}`);
        }
        
        for (let i = 0; i < noteIds.length; i++) {
            const noteId = noteIds[i];
            const note = becca.getNote(noteId);
            
            if (!note) {
                errors.push(`Note not found: ${noteId}`);
                continue;
            }

            try {
                // Check for circular reference
                if (this.wouldCreateCircularReference(noteId, targetParentId)) {
                    errors.push(`Circular reference: cannot move ${note.title} to ${targetParent.title}`);
                    continue;
                }

                // Get current branches
                const currentBranches = note.getParentBranches();
                
                if (keepOriginal) {
                    // Create new branch (clone)
                    const newBranch = new BBranch({
                        branchId: utils.newEntityId(),
                        noteId: noteId,
                        parentNoteId: targetParentId,
                        prefix: prefixes?.[i] || '',
                        notePosition: positions?.[i] || this.getNewNotePosition(targetParent),
                        isExpanded: false
                    });
                    newBranch.save();
                    
                    movedNotes.push({
                        noteId,
                        title: note.title,
                        action: 'cloned',
                        originalBranches: currentBranches.length,
                        newBranchId: newBranch.branchId
                    });
                } else {
                    // Move completely - update first branch, delete others if multiple exist
                    if (currentBranches.length > 0) {
                        const firstBranch = currentBranches[0];
                        firstBranch.parentNoteId = targetParentId;
                        firstBranch.prefix = prefixes?.[i] || firstBranch.prefix;
                        firstBranch.notePosition = positions?.[i] || this.getNewNotePosition(targetParent);
                        firstBranch.save();
                        
                        // Delete additional branches if moving completely
                        for (let j = 1; j < currentBranches.length; j++) {
                            currentBranches[j].markAsDeleted();
                        }
                        
                        movedNotes.push({
                            noteId,
                            title: note.title,
                            action: 'moved',
                            branchesRemoved: currentBranches.length - 1,
                            updatedBranchId: firstBranch.branchId
                        });
                    }
                }
            } catch (error: any) {
                errors.push(`Failed to move ${note.title}: ${error.message}`);
            }
        }

        return {
            success: errors.length < noteIds.length, // Success if at least one note was moved
            data: {
                action: 'move',
                targetParentId,
                targetParentTitle: targetParent.title,
                successfulMoves: movedNotes.length,
                totalRequested: noteIds.length,
                keepOriginal,
                movedNotes,
                errors
            },
            operationTime: Date.now() - operationStart
        };
    }

    /**
     * Execute reorder action
     */
    private async executeReorderAction(
        noteIds: string[],
        sortBy: string,
        sortDirection: string,
        positions?: number[]
    ): Promise<any> {
        const operationStart = Date.now();
        const reorderedNotes: Array<{
            noteId: string;
            title: string;
            oldPosition?: number;
            newPosition: number;
            branchesUpdated?: number;
        }> = [];
        const errors: string[] = [];

        // Get all notes and their data for sorting
        const notesData: Array<{ note: any; branches: any[] }> = [];
        for (const noteId of noteIds) {
            const note = becca.getNote(noteId);
            if (!note) {
                errors.push(`Note not found: ${noteId}`);
                continue;
            }
            notesData.push({ note, branches: note.getParentBranches() });
        }

        // Sort notes based on criteria
        notesData.sort((a, b) => {
            let comparison = 0;
            
            switch (sortBy) {
                case 'title':
                    comparison = a.note.title.localeCompare(b.note.title);
                    break;
                case 'dateCreated':
                    comparison = new Date(a.note.utcDateCreated).getTime() - new Date(b.note.utcDateCreated).getTime();
                    break;
                case 'dateModified':
                    comparison = new Date(a.note.utcDateModified).getTime() - new Date(b.note.utcDateModified).getTime();
                    break;
                case 'position':
                    const posA = a.branches[0]?.notePosition || 0;
                    const posB = b.branches[0]?.notePosition || 0;
                    comparison = posA - posB;
                    break;
            }
            
            return sortDirection === 'desc' ? -comparison : comparison;
        });

        // Update positions
        let basePosition = 10;
        for (let i = 0; i < notesData.length; i++) {
            const { note, branches } = notesData[i];
            const newPosition = positions?.[i] || basePosition;
            
            try {
                for (const branch of branches) {
                    branch.notePosition = newPosition;
                    branch.save();
                }
                
                reorderedNotes.push({
                    noteId: note.noteId,
                    title: note.title,
                    newPosition,
                    branchesUpdated: branches.length
                });
                
                basePosition += 10;
            } catch (error: any) {
                errors.push(`Failed to reorder ${note.title}: ${error.message}`);
            }
        }

        return {
            success: reorderedNotes.length > 0,
            data: {
                action: 'reorder',
                sortBy,
                sortDirection,
                successfulReorders: reorderedNotes.length,
                totalRequested: noteIds.length,
                reorderedNotes,
                errors
            },
            operationTime: Date.now() - operationStart
        };
    }

    /**
     * Execute set prefix action
     */
    private async executeSetPrefixAction(noteIds: string[], prefixes: string[]): Promise<any> {
        const operationStart = Date.now();
        const updatedNotes: Array<{
            noteId: string;
            title: string;
            oldPrefix: string;
            newPrefix: string;
            branchesUpdated: number;
        }> = [];
        const errors: string[] = [];

        for (let i = 0; i < noteIds.length; i++) {
            const noteId = noteIds[i];
            const prefix = prefixes[i] || '';
            const note = becca.getNote(noteId);
            
            if (!note) {
                errors.push(`Note not found: ${noteId}`);
                continue;
            }

            try {
                const branches = note.getParentBranches();
                let updatedBranchCount = 0;
                const oldPrefix = branches.length > 0 ? branches[0].prefix : '';
                
                for (const branch of branches) {
                    branch.prefix = prefix;
                    branch.save();
                    updatedBranchCount++;
                }
                
                updatedNotes.push({
                    noteId,
                    title: note.title,
                    oldPrefix: oldPrefix || '',
                    newPrefix: prefix,
                    branchesUpdated: updatedBranchCount
                });
            } catch (error: any) {
                errors.push(`Failed to set prefix for ${note.title}: ${error.message}`);
            }
        }

        return {
            success: updatedNotes.length > 0,
            data: {
                action: 'set_prefix',
                successfulUpdates: updatedNotes.length,
                totalRequested: noteIds.length,
                updatedNotes,
                errors
            },
            operationTime: Date.now() - operationStart
        };
    }

    /**
     * Execute organize batch action (combination of operations)
     */
    private async executeOrganizeBatchAction(
        noteIds: string[],
        targetParentId?: string,
        positions?: number[],
        prefixes?: string[],
        keepOriginal?: boolean
    ): Promise<any> {
        const operationStart = Date.now();
        const operations: Array<{
            action: string;
            success: boolean;
            data?: any;
            error?: string;
        }> = [];

        // Perform move if target parent specified
        if (targetParentId) {
            const moveResult = await this.executeMoveAction(noteIds, targetParentId, positions, prefixes, keepOriginal);
            operations.push({ operation: 'move', ...moveResult });
        }

        // Set prefixes if provided and no move was done (move already handles prefixes)
        if (prefixes && !targetParentId) {
            const prefixResult = await this.executeSetPrefixAction(noteIds, prefixes);
            operations.push({ operation: 'set_prefix', ...prefixResult });
        }

        // Reorder if positions provided and no move was done (move already handles positions)
        if (positions && !targetParentId) {
            const reorderResult = await this.executeReorderAction(noteIds, 'position', 'asc', positions);
            operations.push({ operation: 'reorder', ...reorderResult });
        }

        return {
            success: operations.some(op => op.success),
            data: {
                action: 'organize_batch',
                operations,
                totalOperations: operations.length,
                successfulOperations: operations.filter(op => op.success).length
            },
            operationTime: Date.now() - operationStart
        };
    }

    /**
     * Check if moving a note would create a circular reference
     */
    private wouldCreateCircularReference(noteId: string, targetParentId: string): boolean {
        if (noteId === targetParentId) {
            return true; // Can't be parent of itself
        }

        const note = becca.getNote(noteId);
        const targetParent = becca.getNote(targetParentId);
        
        if (!note || !targetParent) {
            return false;
        }

        // Check if target parent is a descendant of the note being moved
        const isDescendant = (ancestorId: string, candidateId: string): boolean => {
            if (ancestorId === candidateId) return true;
            
            const candidate = becca.getNote(candidateId);
            if (!candidate) return false;
            
            for (const parent of candidate.parents) {
                if (isDescendant(ancestorId, parent.noteId)) {
                    return true;
                }
            }
            return false;
        };

        return isDescendant(noteId, targetParentId);
    }

    /**
     * Get appropriate position for new note in parent
     */
    private getNewNotePosition(parentNote: any): number {
        if (parentNote.isLabelTruthy && parentNote.isLabelTruthy("newNotesOnTop")) {
            const minNotePos = parentNote
                .getChildBranches()
                .filter((branch: any) => branch?.noteId !== "_hidden")
                .reduce((min: number, branch: any) => Math.min(min, branch?.notePosition || 0), 0);
            
            return minNotePos - 10;
        } else {
            const maxNotePos = parentNote
                .getChildBranches()
                .filter((branch: any) => branch?.noteId !== "_hidden")
                .reduce((max: number, branch: any) => Math.max(max, branch?.notePosition || 0), 0);
            
            return maxNotePos + 10;
        }
    }

    /**
     * Get suggested next steps based on action
     */
    private getNextStepsSuggestion(action: string, noteIds: string[], targetParentId?: string): string {
        switch (action) {
            case 'move':
                return targetParentId ? 
                    `Search for notes in the target parent "${targetParentId}" to verify the move` :
                    `Use read_note on the moved notes to see their new locations`;
            case 'reorder':
                return `Check the parent folders to see the new ordering of the notes`;
            case 'set_prefix':
                return `Use read_note to see the notes with their new prefixes`;
            case 'organize_batch':
                return `Verify the complete organization by searching and reading the affected notes`;
            default:
                return `Use search_notes to find and verify the organized notes`;
        }
    }

    /**
     * Execute the organize hierarchy tool (legacy method for backward compatibility)
     */
    public async execute(args: {
        action: 'move' | 'reorder' | 'set_prefix' | 'organize_batch',
        noteIds: string[],
        targetParentId?: string,
        positions?: number[],
        prefixes?: string[],
        keepOriginal?: boolean,
        sortBy?: 'title' | 'dateCreated' | 'dateModified' | 'position',
        sortDirection?: 'asc' | 'desc'
    }): Promise<string | object> {
        // Delegate to the standardized method
        const standardizedResponse = await this.executeStandardized(args);

        // For backward compatibility, return the legacy format
        if (standardizedResponse.success) {
            const result = standardizedResponse.result as any;
            return {
                success: true,
                action: result.action,
                notesProcessed: result.successfulMoves || result.successfulReorders || result.successfulUpdates || 0,
                message: `Organization action "${result.action}" completed successfully`
            };
        } else {
            return `Error: ${standardizedResponse.error}`;
        }
    }
}