/**
 * Clone Note Tool
 *
 * This tool allows the LLM to clone notes to multiple locations, leveraging Trilium's unique
 * multi-parent capability. Cloning creates additional branches for a note without duplicating content.
 */

import type { Tool, ToolHandler, StandardizedToolResponse } from './tool_interfaces.js';
import { ToolResponseFormatter } from './tool_interfaces.js';
import { ParameterValidationHelpers } from './parameter_validation_helpers.js';
import log from '../../log.js';
import becca from '../../../becca/becca.js';
import BBranch from '../../../becca/entities/bbranch.js';
import utils from '../../utils.js';

/**
 * Definition of the clone note tool
 */
export const cloneNoteToolDefinition: Tool = {
    type: 'function',
    function: {
        name: 'clone_note',
        description: 'Clone a note to multiple locations using Trilium\'s multi-parent capability. This creates the note in additional places without duplicating content - the same note appears in multiple folders. Perfect for organizing notes that belong in several categories.',
        parameters: {
            type: 'object',
            properties: {
                sourceNoteId: {
                    type: 'string',
                    description: 'The noteId of the note to clone. Must be an existing note ID from search results. Example: "abc123def456" - the note that will appear in multiple locations'
                },
                targetParents: {
                    type: 'array',
                    description: 'Array of parent noteIds where the note should be cloned. Each creates a new branch/location for the same note. Example: ["parent1", "parent2"] creates the note in both folders',
                    items: {
                        type: 'string',
                        description: 'Parent noteId where to create a clone. Use noteIds from search results, not titles'
                    },
                    minItems: 1,
                    maxItems: 10
                },
                clonePrefix: {
                    type: 'string',
                    description: 'Optional prefix text to show before the note title in cloned locations. Helps differentiate the same note in different contexts. Example: "Copy: " or "Reference: "'
                },
                positions: {
                    type: 'array',
                    description: 'Optional array of positions for each cloned branch. Controls ordering within each parent. If not specified, notes are placed at the end',
                    items: {
                        type: 'number',
                        description: 'Position number for ordering (10, 20, 30, etc.)'
                    }
                }
            },
            required: ['sourceNoteId', 'targetParents']
        }
    }
};

/**
 * Clone note tool implementation
 */
export class CloneNoteTool implements ToolHandler {
    public definition: Tool = cloneNoteToolDefinition;

    /**
     * Execute the clone note tool with standardized response format
     */
    public async executeStandardized(args: {
        sourceNoteId: string,
        targetParents: string[],
        clonePrefix?: string,
        positions?: number[]
    }): Promise<StandardizedToolResponse> {
        const startTime = Date.now();

        try {
            const { sourceNoteId, targetParents, clonePrefix, positions } = args;

            log.info(`Executing clone_note tool - Source: "${sourceNoteId}", Targets: ${targetParents.length}`);

            // Validate source note ID
            const sourceValidation = ParameterValidationHelpers.validateNoteId(sourceNoteId, 'sourceNoteId');
            if (sourceValidation) {
                return sourceValidation;
            }

            // Validate target parents array
            if (!targetParents || !Array.isArray(targetParents) || targetParents.length === 0) {
                return ToolResponseFormatter.invalidParameterError(
                    'targetParents',
                    'array of noteIds from search results',
                    typeof targetParents
                );
            }

            if (targetParents.length > 10) {
                return ToolResponseFormatter.error(
                    `Too many target parents: ${targetParents.length}. Maximum is 10.`,
                    {
                        possibleCauses: [
                            'Attempting to clone to too many locations at once',
                            'Large array provided accidentally'
                        ],
                        suggestions: [
                            'Reduce the number of target parents to 10 or fewer',
                            'Clone to fewer locations in each operation',
                            'Use multiple clone operations if needed'
                        ],
                        examples: [
                            'clone_note(noteId, ["parent1", "parent2", "parent3"])',
                            'Split large operations into smaller batches'
                        ]
                    }
                );
            }

            // Validate each target parent
            for (let i = 0; i < targetParents.length; i++) {
                const parentValidation = ParameterValidationHelpers.validateNoteId(targetParents[i], `targetParents[${i}]`);
                if (parentValidation) {
                    return parentValidation;
                }
            }

            // Validate positions array if provided
            if (positions && (!Array.isArray(positions) || positions.length !== targetParents.length)) {
                return ToolResponseFormatter.error(
                    `Positions array length (${positions?.length || 0}) must match targetParents length (${targetParents.length})`,
                    {
                        possibleCauses: [
                            'Mismatched array lengths',
                            'Incorrect positions array format'
                        ],
                        suggestions: [
                            'Provide one position for each target parent',
                            'Omit positions to use automatic placement',
                            'Ensure positions array has same length as targetParents'
                        ],
                        examples: [
                            'positions: [10, 20, 30] for 3 target parents',
                            'Omit positions parameter for automatic placement'
                        ]
                    }
                );
            }

            // Get the source note
            const sourceNote = becca.getNote(sourceNoteId);
            if (!sourceNote) {
                return ToolResponseFormatter.noteNotFoundError(sourceNoteId);
            }

            // Verify target parents exist and collect validation info
            const validatedParents: Array<{
                noteId: string;
                note: any;
                position: number;
            }> = [];
            for (let i = 0; i < targetParents.length; i++) {
                const parentNoteId = targetParents[i];
                const parentNote = becca.getNote(parentNoteId);
                
                if (!parentNote) {
                    return ToolResponseFormatter.error(
                        `Target parent note not found: "${parentNoteId}"`,
                        {
                            possibleCauses: [
                                'Invalid parent noteId format',
                                'Parent note was deleted or moved',
                                'Using note title instead of noteId'
                            ],
                            suggestions: [
                                'Use search_notes to find the correct parent noteIds',
                                'Verify all parent noteIds exist before cloning',
                                'Check that noteIds are from search results'
                            ],
                            examples: [
                                'search_notes("folder name") to find parent noteIds',
                                'Verify each parent exists before cloning'
                            ]
                        }
                    );
                }

                // Check if note is already a child of this parent
                const existingBranch = becca.getBranch(`${sourceNoteId}-${parentNoteId}`);
                if (existingBranch) {
                    return ToolResponseFormatter.error(
                        `Note "${sourceNote.title}" is already in parent "${parentNote.title}"`,
                        {
                            possibleCauses: [
                                'Note already has a branch in this parent',
                                'Attempting to clone to existing location',
                                'Circular reference or duplicate relationship'
                            ],
                            suggestions: [
                                'Check existing note locations before cloning',
                                'Use read_note to see current parent branches',
                                'Clone to different parents that don\'t already contain the note'
                            ],
                            examples: [
                                'read_note(sourceNoteId) to see existing locations',
                                'Clone to parents that don\'t already contain this note'
                            ]
                        }
                    );
                }

                validatedParents.push({
                    noteId: parentNoteId,
                    note: parentNote,
                    position: positions?.[i] || this.getNewNotePosition(parentNote)
                });
            }

            // Create clone branches
            const clonedBranches: Array<{
                branchId: string | undefined;
                parentNoteId: any;
                parentTitle: any;
                position: any;
                prefix: string;
            }> = [];
            const cloneStartTime = Date.now();
            
            for (const parent of validatedParents) {
                try {
                    // Create new branch
                    const newBranch = new BBranch({
                        branchId: utils.newEntityId(),
                        noteId: sourceNote.noteId,
                        parentNoteId: parent.noteId,
                        prefix: clonePrefix || '',
                        notePosition: parent.position,
                        isExpanded: false
                    });

                    // Save the branch
                    newBranch.save();
                    
                    clonedBranches.push({
                        branchId: newBranch.branchId,
                        parentNoteId: parent.noteId,
                        parentTitle: parent.note.title,
                        position: parent.position,
                        prefix: clonePrefix || ''
                    });

                    log.info(`Created clone branch: ${sourceNote.title} -> ${parent.note.title}`);
                } catch (error: any) {
                    log.error(`Failed to create clone branch in ${parent.note.title}: ${error.message}`);
                    
                    // If we fail partway through, we still return success for completed clones
                    // but mention the failures
                    if (clonedBranches.length === 0) {
                        return ToolResponseFormatter.error(
                            `Failed to create any clone branches: ${error.message}`,
                            {
                                possibleCauses: [
                                    'Database write error',
                                    'Invalid branch parameters',
                                    'Insufficient permissions'
                                ],
                                suggestions: [
                                    'Check if Trilium database is accessible',
                                    'Verify parent notes are writable',
                                    'Try cloning to fewer parents at once'
                                ]
                            }
                        );
                    }
                }
            }

            const cloneDuration = Date.now() - cloneStartTime;
            const executionTime = Date.now() - startTime;

            // Get updated note information
            const updatedSourceNote = becca.getNote(sourceNoteId);
            if (!updatedSourceNote) {
                throw new Error(`Source note ${sourceNoteId} not found after cloning`);
            }
            const totalBranches = updatedSourceNote.getParentBranches().length;

            const result = {
                sourceNoteId: sourceNote.noteId,
                sourceTitle: sourceNote.title,
                successfulClones: clonedBranches.length,
                totalTargets: targetParents.length,
                totalBranchesNow: totalBranches,
                clonedBranches: clonedBranches,
                failedTargets: targetParents.length - clonedBranches.length
            };

            const nextSteps = {
                suggested: `Use read_note("${sourceNoteId}") to see all locations where the note now appears`,
                alternatives: [
                    'Use search_notes to find the note in its new locations',
                    `Use organize_hierarchy to adjust the cloned note positions`,
                    `Use read_note("${sourceNoteId}") to verify the cloning results`,
                    'Navigate to each parent folder to see the cloned note'
                ],
                examples: [
                    `read_note("${sourceNoteId}")`,
                    'search_notes("' + sourceNote.title + '")',
                    ...clonedBranches.map(branch => `search_notes in parent "${branch.parentTitle}"`)
                ]
            };

            // Trilium concept explanation for LLM education
            const triliumConcept = "Trilium's cloning creates multiple branches (parent-child relationships) for the same note content. " +
                "The note content exists once but appears in multiple locations in the note tree. " +
                "Changes to the note content will be visible in all cloned locations.";

            return ToolResponseFormatter.success(
                result,
                nextSteps,
                {
                    executionTime,
                    resourcesUsed: ['database', 'branches', 'note-relationships'],
                    cloneDuration,
                    triliumConcept,
                    branchesCreated: clonedBranches.length,
                    totalBranchesAfter: totalBranches
                }
            );

        } catch (error: any) {
            const errorMessage = error.message || String(error);
            log.error(`Error executing clone_note tool: ${errorMessage}`);
            
            return ToolResponseFormatter.error(
                `Note cloning failed: ${errorMessage}`,
                {
                    possibleCauses: [
                        'Database write error',
                        'Invalid parameters provided',
                        'Circular reference attempt',
                        'Insufficient system resources'
                    ],
                    suggestions: [
                        'Check if Trilium service is running properly',
                        'Verify all noteIds are valid',
                        'Try cloning to fewer parents',
                        'Ensure no circular references exist'
                    ]
                }
            );
        }
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
     * Execute the clone note tool (legacy method for backward compatibility)
     */
    public async execute(args: {
        sourceNoteId: string,
        targetParents: string[],
        clonePrefix?: string,
        positions?: number[]
    }): Promise<string | object> {
        // Delegate to the standardized method
        const standardizedResponse = await this.executeStandardized(args);

        // For backward compatibility, return the legacy format
        if (standardizedResponse.success) {
            const result = standardizedResponse.result as any;
            return {
                success: true,
                sourceNoteId: result.sourceNoteId,
                sourceTitle: result.sourceTitle,
                successfulClones: result.successfulClones,
                totalBranches: result.totalBranchesNow,
                message: `Note "${result.sourceTitle}" cloned to ${result.successfulClones} locations`
            };
        } else {
            return `Error: ${standardizedResponse.error}`;
        }
    }
}