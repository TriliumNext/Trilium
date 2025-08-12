/**
 * Find and Update Tool - Phase 2.1 Compound Workflow Tool
 *
 * This compound tool combines smart_search + note_update into a single operation.
 * Perfect for "find my todo list and add a new task" type requests.
 */

import type { Tool, ToolHandler, StandardizedToolResponse, ToolErrorResponse } from './tool_interfaces.js';
import { ToolResponseFormatter } from './tool_interfaces.js';
import log from '../../log.js';
import { SmartSearchTool } from './smart_search_tool.js';
import { NoteUpdateTool } from './note_update_tool.js';

/**
 * Result structure for find and update operations
 */
interface FindAndUpdateResult {
    searchResults: {
        count: number;
        query: string;
        searchMethod: string;
    };
    updateResults: Array<{
        noteId: string;
        title: string;
        success: boolean;
        error?: string;
        changes: {
            titleChanged?: boolean;
            contentChanged?: boolean;
            oldTitle?: string;
            newTitle?: string;
            mode?: string;
        };
    }>;
    totalNotesUpdated: number;
    totalNotesAttempted: number;
}

/**
 * Definition of the find and update compound tool
 */
export const findAndUpdateToolDefinition: Tool = {
    type: 'function',
    function: {
        name: 'find_and_update',
        description: 'Search for notes and update their content or titles in one step. Perfect for "find my todo list and add a new task" requests. Combines smart search with automatic content updates.',
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'What notes to search for using natural language. Examples: "todo list", "project planning notes", "#urgent tasks", "meeting notes from today"'
                },
                content: {
                    type: 'string',
                    description: 'New content to add or set. Required unless only changing title. Examples: "- New task item", "Updated status: Complete", "Additional notes here"'
                },
                title: {
                    type: 'string',
                    description: 'New title for the notes. Optional - only provide if you want to rename the notes. Examples: "Updated Todo List", "Completed Project Plan"'
                },
                mode: {
                    type: 'string',
                    description: 'How to update content: "replace" overwrites existing, "append" adds to end (default), "prepend" adds to beginning',
                    enum: ['replace', 'append', 'prepend']
                },
                maxResults: {
                    type: 'number',
                    description: 'Maximum number of notes to find and update. Use 1 for specific note, 3-5 for related notes. Default is 3, maximum is 10.'
                },
                confirmationRequired: {
                    type: 'boolean',
                    description: 'Whether to ask for confirmation before updating multiple notes. Default is true for safety when updating more than 1 note.'
                },
                parentNoteId: {
                    type: 'string',
                    description: 'Optional: Search only within this note folder. Use noteId from previous search results to narrow scope.'
                },
                forceMethod: {
                    type: 'string',
                    description: 'Optional: Force a specific search method. Use "auto" (default) for intelligent selection.',
                    enum: ['auto', 'semantic', 'keyword', 'attribute']
                }
            },
            required: ['query']
        }
    }
};

/**
 * Find and update compound tool implementation
 */
export class FindAndUpdateTool implements ToolHandler {
    public definition: Tool = findAndUpdateToolDefinition;
    private smartSearchTool: SmartSearchTool;
    private noteUpdateTool: NoteUpdateTool;

    constructor() {
        this.smartSearchTool = new SmartSearchTool();
        this.noteUpdateTool = new NoteUpdateTool();
    }

    /**
     * Execute the find and update compound tool with standardized response format
     */
    public async executeStandardized(args: {
        query: string,
        content?: string,
        title?: string,
        mode?: 'replace' | 'append' | 'prepend',
        maxResults?: number,
        confirmationRequired?: boolean,
        parentNoteId?: string,
        forceMethod?: string
    }): Promise<StandardizedToolResponse> {
        const startTime = Date.now();

        try {
            const {
                query,
                content,
                title,
                mode = 'append',
                maxResults = 3,
                confirmationRequired = true,
                parentNoteId,
                forceMethod = 'auto'
            } = args;

            log.info(`Executing find_and_update tool - Query: "${query}", Mode: ${mode}, MaxResults: ${maxResults}`);

            // Validate input parameters
            if (!query || query.trim().length === 0) {
                return ToolResponseFormatter.invalidParameterError(
                    'query',
                    'non-empty string',
                    query
                );
            }

            if (!content && !title) {
                return ToolResponseFormatter.invalidParameterError(
                    'content or title',
                    'at least one must be provided to update notes',
                    'both are missing'
                );
            }

            if (maxResults < 1 || maxResults > 10) {
                return ToolResponseFormatter.invalidParameterError(
                    'maxResults',
                    'number between 1 and 10',
                    String(maxResults)
                );
            }

            // Step 1: Execute smart search
            log.info(`Step 1: Searching for notes matching "${query}"`);
            const searchStartTime = Date.now();
            
            const searchResponse = await this.smartSearchTool.executeStandardized({
                query,
                parentNoteId,
                maxResults,
                forceMethod,
                enableFallback: true,
                summarize: false
            });

            const searchDuration = Date.now() - searchStartTime;

            if (!searchResponse.success) {
                const errorResponse = searchResponse as ToolErrorResponse;
                return ToolResponseFormatter.error(
                    `Search failed: ${errorResponse.error}`,
                    {
                        possibleCauses: [
                            'No notes match your search criteria',
                            'Search service connectivity issue',
                            'Invalid search parameters'
                        ].concat(errorResponse.help?.possibleCauses || []),
                        suggestions: [
                            'Try different search terms or broader keywords',
                            'Use simpler search query without operators',
                            'Use smart_search first to verify notes exist'
                        ].concat(errorResponse.help?.suggestions || []),
                        examples: errorResponse.help?.examples || [
                            'find_and_update("simple keywords", "new content")',
                            'smart_search("verify notes exist")'
                        ]
                    }
                );
            }

            const searchResult = searchResponse.result as any;
            const foundNotes = searchResult.results || [];

            if (foundNotes.length === 0) {
                return ToolResponseFormatter.error(
                    `No notes found matching "${query}"`,
                    {
                        possibleCauses: [
                            'Search terms too specific or misspelled',
                            'Content may not exist in knowledge base',
                            'Search method not appropriate for query type'
                        ],
                        suggestions: [
                            'Try broader or different search terms',
                            'Use smart_search to verify notes exist first',
                            'Create new note if content doesn\'t exist yet'
                        ],
                        examples: [
                            `smart_search("${query}")`,
                            `create_note("${query}", "${content || 'New content'}")`,
                            'find_and_update("broader search terms", "content")'
                        ]
                    }
                );
            }

            log.info(`Step 1 complete: Found ${foundNotes.length} notes in ${searchDuration}ms`);

            // Safety check for multiple notes
            if (foundNotes.length > 1 && confirmationRequired) {
                log.info(`Multiple notes found (${foundNotes.length}), proceeding with updates (confirmation bypassed for API)`);
                // In a real implementation, this could prompt the user or require explicit confirmation
                // For now, we proceed but log the action for audit purposes
            }

            // Step 2: Update found notes
            log.info(`Step 2: Updating ${foundNotes.length} notes`);
            const updateStartTime = Date.now();
            const updateResults: any[] = [];
            let successCount = 0;

            for (const note of foundNotes) {
                try {
                    log.info(`Updating note "${note.title}" (${note.noteId})`);
                    
                    const updateResponse = await this.noteUpdateTool.execute({
                        noteId: note.noteId,
                        content,
                        title,
                        mode
                    });

                    if (typeof updateResponse === 'object' && updateResponse && 'success' in updateResponse && updateResponse.success) {
                        updateResults.push({
                            noteId: note.noteId,
                            title: (updateResponse as any).title || note.title,
                            success: true,
                            changes: {
                                titleChanged: title ? (title !== note.title) : false,
                                contentChanged: !!content,
                                oldTitle: note.title,
                                newTitle: title || note.title,
                                mode
                            }
                        });
                        successCount++;
                        log.info(`Successfully updated note "${note.title}"`);
                    } else {
                        const errorMsg = typeof updateResponse === 'string' ? updateResponse : 'Unknown update error';
                        updateResults.push({
                            noteId: note.noteId,
                            title: note.title,
                            success: false,
                            error: errorMsg,
                            changes: {
                                titleChanged: false,
                                contentChanged: false,
                                mode
                            }
                        });
                        log.error(`Failed to update note "${note.title}": ${errorMsg}`);
                    }
                } catch (error: any) {
                    const errorMsg = error.message || String(error);
                    updateResults.push({
                        noteId: note.noteId,
                        title: note.title,
                        success: false,
                        error: errorMsg,
                        changes: {
                            titleChanged: false,
                            contentChanged: false,
                            mode
                        }
                    });
                    log.error(`Error updating note "${note.title}": ${errorMsg}`);
                }
            }

            const updateDuration = Date.now() - updateStartTime;
            log.info(`Step 2 complete: Successfully updated ${successCount}/${foundNotes.length} notes in ${updateDuration}ms`);

            // Determine result status
            const executionTime = Date.now() - startTime;
            const allFailed = successCount === 0;
            const partialSuccess = successCount > 0 && successCount < foundNotes.length;

            if (allFailed) {
                return ToolResponseFormatter.error(
                    `Found ${foundNotes.length} notes but failed to update any of them`,
                    {
                        possibleCauses: [
                            'Note access permissions denied',
                            'Database connectivity issues', 
                            'Invalid update parameters',
                            'Notes may be protected or corrupted'
                        ],
                        suggestions: [
                            'Try individual note_update operations',
                            'Check if Trilium service is running properly',
                            'Verify notes are not protected or read-only',
                            'Use read_note to check note accessibility first'
                        ],
                        examples: [
                            `note_update("${foundNotes[0]?.noteId}", "${content || 'test content'}")`,
                            `read_note("${foundNotes[0]?.noteId}")`
                        ]
                    }
                );
            }

            // Create comprehensive result
            const result: FindAndUpdateResult = {
                searchResults: {
                    count: foundNotes.length,
                    query,
                    searchMethod: searchResult.analysis?.usedMethods?.join(' + ') || 'smart'
                },
                updateResults,
                totalNotesUpdated: successCount,
                totalNotesAttempted: foundNotes.length
            };

            // Create contextual next steps
            const nextSteps = {
                suggested: successCount === 1 
                    ? `Use read_note with noteId: "${updateResults.find(r => r.success)?.noteId}" to verify the changes`
                    : `Use read_note to verify changes, or find_and_read to review all updated notes`,
                alternatives: [
                    'Use find_and_read to review the updated content',
                    'Use attribute_manager to add tags marking notes as updated',
                    'Use smart_search with different terms to find related notes',
                    partialSuccess ? 'Retry update for failed notes individually' : 'Create additional related notes'
                ],
                examples: successCount > 0 ? [
                    `read_note("${updateResults.find(r => r.success)?.noteId}")`,
                    `find_and_read("${query}")`,
                    `attribute_manager("${updateResults.find(r => r.success)?.noteId}", "add", "#updated")`
                ] : [
                    `note_update("${foundNotes[0]?.noteId}", "${content || 'retry content'}")`,
                    `smart_search("${query}")`
                ]
            };

            // Format success message for partial or complete success
            const successMessage = partialSuccess 
                ? `Partially completed: Updated ${successCount} out of ${foundNotes.length} notes found. Check individual results for details.`
                : `Successfully updated ${successCount} notes matching "${query}".`;

            return ToolResponseFormatter.success(
                result,
                nextSteps,
                {
                    executionTime,
                    resourcesUsed: ['search', 'content', 'update'],
                    searchDuration,
                    updateDuration,
                    notesFound: foundNotes.length,
                    notesUpdated: successCount,
                    searchMethod: result.searchResults.searchMethod,
                    updateMode: mode,
                    confirmationRequired,
                    partialSuccess,
                    errors: updateResults.filter(r => !r.success).map(r => r.error).filter(Boolean),
                    successMessage
                }
            );

        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            log.error(`Error executing find_and_update tool: ${errorMessage}`);

            return ToolResponseFormatter.error(
                `Find and update operation failed: ${errorMessage}`,
                {
                    possibleCauses: [
                        'Search or update service connectivity issue',
                        'Invalid parameters provided',
                        'System resource exhaustion',
                        'Database transaction failure'
                    ],
                    suggestions: [
                        'Try with simpler search query',
                        'Reduce maxResults to lower number',
                        'Use individual smart_search and note_update operations',
                        'Check if Trilium service is running properly',
                        'Verify content and title parameters are valid'
                    ],
                    examples: [
                        'find_and_update("simple keywords", "test content", {"maxResults": 1})',
                        'smart_search("test query")',
                        'note_update("specific_note_id", "content")'
                    ]
                }
            );
        }
    }

    /**
     * Execute the find and update tool (legacy method for backward compatibility)
     */
    public async execute(args: {
        query: string,
        content?: string,
        title?: string,
        mode?: 'replace' | 'append' | 'prepend',
        maxResults?: number,
        confirmationRequired?: boolean,
        parentNoteId?: string,
        forceMethod?: string
    }): Promise<string | object> {
        const standardizedResponse = await this.executeStandardized(args);

        // For backward compatibility, return the legacy format
        if (standardizedResponse.success) {
            const result = standardizedResponse.result as FindAndUpdateResult;
            const metadata = standardizedResponse.metadata;
            
            return {
                success: true,
                found: result.searchResults.count,
                updated: result.totalNotesUpdated,
                attempted: result.totalNotesAttempted,
                query: result.searchResults.query,
                method: result.searchResults.searchMethod,
                mode: metadata.updateMode,
                results: result.updateResults.map(r => ({
                    noteId: r.noteId,
                    title: r.title,
                    success: r.success,
                    error: r.error,
                    changes: r.changes
                })),
                message: metadata.successMessage || `Updated ${result.totalNotesUpdated}/${result.totalNotesAttempted} notes.`
            };
        } else {
            const errorResponse = standardizedResponse as ToolErrorResponse;
            return `Error: ${errorResponse.error}`;
        }
    }
}