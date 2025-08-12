/**
 * Bulk Update Tool - Phase 2.1 Compound Workflow Tool
 *
 * This compound tool combines smart_search + multiple note_update operations.
 * Perfect for "find all notes tagged #review and mark them as #completed" type requests.
 * Differs from find_and_update by applying the same update to many matching notes.
 */

import type { Tool, ToolHandler, StandardizedToolResponse, ToolErrorResponse } from './tool_interfaces.js';
import { ToolResponseFormatter } from './tool_interfaces.js';
import log from '../../log.js';
import { SmartSearchTool } from './smart_search_tool.js';
import { NoteUpdateTool } from './note_update_tool.js';
import { AttributeManagerTool } from './attribute_manager_tool.js';

/**
 * Result structure for bulk update operations
 */
interface BulkUpdateResult {
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
            attributesChanged?: boolean;
            oldTitle?: string;
            newTitle?: string;
            mode?: string;
            attributeAction?: string;
        };
    }>;
    totalNotesUpdated: number;
    totalNotesAttempted: number;
    operationType: 'content' | 'attributes' | 'both';
}

/**
 * Definition of the bulk update compound tool
 */
export const bulkUpdateToolDefinition: Tool = {
    type: 'function',
    function: {
        name: 'bulk_update',
        description: 'Search for multiple notes and apply the same update to all of them. Perfect for "find all notes tagged #review and mark them as #completed" or "update all project notes with new status". Combines smart search with bulk content/attribute updates.',
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'What notes to search for using natural language. Examples: "notes tagged #review", "all project notes", "#urgent incomplete tasks", "meeting notes from last week"'
                },
                content: {
                    type: 'string',
                    description: 'New content to add or set for all matching notes. Optional if only updating attributes. Examples: "Status: Updated", "Archived on {date}", "- Added new information"'
                },
                title: {
                    type: 'string',
                    description: 'New title template for all notes. Use {originalTitle} placeholder to preserve original titles. Examples: "[COMPLETED] {originalTitle}", "Archived - {originalTitle}"'
                },
                mode: {
                    type: 'string',
                    description: 'How to update content: "replace" overwrites existing, "append" adds to end (default), "prepend" adds to beginning',
                    enum: ['replace', 'append', 'prepend']
                },
                attributeAction: {
                    type: 'string',
                    description: 'Bulk attribute operation: "add" adds attribute to all notes, "remove" removes attribute from all, "update" changes existing attribute values',
                    enum: ['add', 'remove', 'update']
                },
                attributeKey: {
                    type: 'string',
                    description: 'Attribute key for bulk operations. Examples: "status", "priority", "archived", "category". Required if using attributeAction.'
                },
                attributeValue: {
                    type: 'string',
                    description: 'Attribute value for add/update operations. Examples: "completed", "high", "true", "archived". Required for add/update attributeAction.'
                },
                maxResults: {
                    type: 'number',
                    description: 'Maximum number of notes to find and update. Use with caution - bulk operations can affect many notes. Default is 10, maximum is 50.'
                },
                dryRun: {
                    type: 'boolean',
                    description: 'If true, shows what would be updated without making changes. Recommended for large bulk operations. Default is false.'
                },
                confirmationRequired: {
                    type: 'boolean',
                    description: 'Whether to ask for confirmation before updating many notes. Default is true for safety when updating more than 3 notes.'
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
 * Bulk update compound tool implementation
 */
export class BulkUpdateTool implements ToolHandler {
    public definition: Tool = bulkUpdateToolDefinition;
    private smartSearchTool: SmartSearchTool;
    private noteUpdateTool: NoteUpdateTool;
    private attributeManagerTool: AttributeManagerTool;

    constructor() {
        this.smartSearchTool = new SmartSearchTool();
        this.noteUpdateTool = new NoteUpdateTool();
        this.attributeManagerTool = new AttributeManagerTool();
    }

    /**
     * Execute the bulk update compound tool with standardized response format
     */
    public async executeStandardized(args: {
        query: string,
        content?: string,
        title?: string,
        mode?: 'replace' | 'append' | 'prepend',
        attributeAction?: 'add' | 'remove' | 'update',
        attributeKey?: string,
        attributeValue?: string,
        maxResults?: number,
        dryRun?: boolean,
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
                attributeAction,
                attributeKey,
                attributeValue,
                maxResults = 10,
                dryRun = false,
                confirmationRequired = true,
                parentNoteId,
                forceMethod = 'auto'
            } = args;

            log.info(`Executing bulk_update tool - Query: "${query}", Mode: ${mode}, MaxResults: ${maxResults}, DryRun: ${dryRun}`);

            // Validate input parameters
            if (!query || query.trim().length === 0) {
                return ToolResponseFormatter.invalidParameterError(
                    'query',
                    'non-empty string',
                    query
                );
            }

            if (!content && !title && !attributeAction) {
                return ToolResponseFormatter.invalidParameterError(
                    'content, title, or attributeAction',
                    'at least one must be provided to update notes',
                    'all are missing'
                );
            }

            if (attributeAction && !attributeKey) {
                return ToolResponseFormatter.invalidParameterError(
                    'attributeKey',
                    'required when using attributeAction',
                    'missing'
                );
            }

            if (attributeAction && ['add', 'update'].includes(attributeAction) && !attributeValue) {
                return ToolResponseFormatter.invalidParameterError(
                    'attributeValue',
                    'required for add/update attributeAction',
                    'missing'
                );
            }

            if (maxResults < 1 || maxResults > 50) {
                return ToolResponseFormatter.invalidParameterError(
                    'maxResults',
                    'number between 1 and 50',
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
                return ToolResponseFormatter.error(
                    `Search failed: ${searchResponse.error}`,
                    {
                        possibleCauses: [
                            'No notes match your search criteria',
                            'Search service connectivity issue',
                            'Invalid search parameters'
                        ].concat(searchResponse.help?.possibleCauses || []),
                        suggestions: [
                            'Try different search terms or broader keywords',
                            'Use smart_search first to verify notes exist',
                            'Consider using attribute search if looking for tagged notes'
                        ].concat(searchResponse.help?.suggestions || []),
                        examples: [
                            'bulk_update("simpler keywords", content: "test")',
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
                            'Consider creating notes if they don\'t exist'
                        ],
                        examples: [
                            `smart_search("${query}")`,
                            `bulk_update("broader search terms", content: "test")`
                        ]
                    }
                );
            }

            log.info(`Step 1 complete: Found ${foundNotes.length} notes in ${searchDuration}ms`);

            // Safety check for multiple notes
            if (foundNotes.length > 3 && confirmationRequired && !dryRun) {
                log.error(`Bulk update would affect ${foundNotes.length} notes. Consider using dryRun first.`);
                // In a real implementation, this could prompt the user or require explicit confirmation
            }

            // Dry run - show what would be updated
            if (dryRun) {
                log.info(`Dry run mode: Showing what would be updated for ${foundNotes.length} notes`);
                
                const previewResults = foundNotes.map((note: any) => {
                    const newTitle = title ? title.replace('{originalTitle}', note.title) : note.title;
                    return {
                        noteId: note.noteId,
                        title: note.title,
                        success: true,
                        changes: {
                            titleChanged: title ? (newTitle !== note.title) : false,
                            contentChanged: !!content,
                            attributesChanged: !!attributeAction,
                            oldTitle: note.title,
                            newTitle,
                            mode,
                            attributeAction
                        }
                    };
                });

                const result: BulkUpdateResult = {
                    searchResults: {
                        count: foundNotes.length,
                        query,
                        searchMethod: searchResult.analysis?.usedMethods?.join(' + ') || 'smart'
                    },
                    updateResults: previewResults,
                    totalNotesUpdated: 0, // No actual updates in dry run
                    totalNotesAttempted: foundNotes.length,
                    operationType: content && attributeAction ? 'both' : (attributeAction ? 'attributes' : 'content')
                };

                return ToolResponseFormatter.success(
                    result,
                    {
                        suggested: `Run the same command with dryRun: false to execute the bulk update`,
                        alternatives: [
                            'Review the preview and adjust parameters if needed',
                            'Use find_and_update for smaller targeted updates',
                            'Use individual note_update operations for precise control'
                        ],
                        examples: [
                            `bulk_update("${query}", ${JSON.stringify({...args, dryRun: false})})`,
                            `find_and_update("${query}", "${content || 'content'}")`
                        ]
                    },
                    {
                        executionTime: Date.now() - startTime,
                        resourcesUsed: ['search'],
                        searchDuration,
                        notesFound: foundNotes.length,
                        isDryRun: true,
                        previewMessage: `Dry run complete: Would update ${foundNotes.length} notes`
                    }
                );
            }

            // Step 2: Execute bulk updates
            log.info(`Step 2: Bulk updating ${foundNotes.length} notes`);
            const updateStartTime = Date.now();
            const updateResults: any[] = [];
            let successCount = 0;

            for (const note of foundNotes) {
                try {
                    log.info(`Updating note "${note.title}" (${note.noteId})`);
                    
                    // Process title with placeholder replacement
                    const processedTitle = title ? title.replace('{originalTitle}', note.title) : undefined;
                    
                    // Update content and/or title first
                    let contentUpdateSuccess = true;
                    let contentError: string | null = null;
                    
                    if (content || processedTitle) {
                        const updateResponse = await this.noteUpdateTool.execute({
                            noteId: note.noteId,
                            content,
                            title: processedTitle,
                            mode
                        });

                        if (typeof updateResponse === 'string' || (typeof updateResponse === 'object' && !(updateResponse as any).success)) {
                            contentUpdateSuccess = false;
                            contentError = typeof updateResponse === 'string' ? updateResponse : 'Content update failed';
                        }
                    }

                    // Update attributes if specified
                    let attributeUpdateSuccess = true;
                    let attributeError: string | null = null;
                    
                    if (attributeAction && attributeKey) {
                        try {
                            const attributeResponse = await this.attributeManagerTool.executeStandardized({
                                noteId: note.noteId,
                                action: attributeAction,
                                attributeName: attributeKey,
                                attributeValue: attributeAction !== 'remove' ? attributeValue : undefined
                            });

                            if (!attributeResponse.success) {
                                attributeUpdateSuccess = false;
                                attributeError = attributeResponse.error || 'Attribute update failed';
                            }
                        } catch (error: any) {
                            attributeUpdateSuccess = false;
                            attributeError = error.message || 'Attribute operation failed';
                        }
                    }

                    // Determine overall success
                    const overallSuccess = contentUpdateSuccess && attributeUpdateSuccess;
                    const combinedError = [contentError, attributeError].filter(Boolean).join('; ');

                    if (overallSuccess) {
                        updateResults.push({
                            noteId: note.noteId,
                            title: processedTitle || note.title,
                            success: true,
                            changes: {
                                titleChanged: processedTitle ? (processedTitle !== note.title) : false,
                                contentChanged: !!content,
                                attributesChanged: !!attributeAction,
                                oldTitle: note.title,
                                newTitle: processedTitle || note.title,
                                mode,
                                attributeAction
                            }
                        });
                        successCount++;
                        log.info(`Successfully updated note "${note.title}"`);
                    } else {
                        updateResults.push({
                            noteId: note.noteId,
                            title: note.title,
                            success: false,
                            error: combinedError || 'Unknown update error',
                            changes: {
                                titleChanged: false,
                                contentChanged: false,
                                attributesChanged: false,
                                mode,
                                attributeAction
                            }
                        });
                        log.error(`Failed to update note "${note.title}": ${combinedError}`);
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
                            attributesChanged: false,
                            mode,
                            attributeAction
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
                            'Notes may be protected or corrupted',
                            'Attribute operations failed'
                        ],
                        suggestions: [
                            'Try individual note_update operations',
                            'Check if Trilium service is running properly',
                            'Verify attribute keys and values are valid',
                            'Use dryRun first to test parameters',
                            'Reduce maxResults to smaller number'
                        ],
                        examples: [
                            `bulk_update("${query}", {"dryRun": true})`,
                            `note_update("${foundNotes[0]?.noteId}", "${content || 'test content'}")`
                        ]
                    }
                );
            }

            // Create comprehensive result
            const result: BulkUpdateResult = {
                searchResults: {
                    count: foundNotes.length,
                    query,
                    searchMethod: searchResult.analysis?.usedMethods?.join(' + ') || 'smart'
                },
                updateResults,
                totalNotesUpdated: successCount,
                totalNotesAttempted: foundNotes.length,
                operationType: content && attributeAction ? 'both' : (attributeAction ? 'attributes' : 'content')
            };

            // Create contextual next steps
            const nextSteps = {
                suggested: successCount > 0 
                    ? `Use smart_search("${query}") to verify the bulk updates were applied correctly`
                    : `Use dryRun: true to preview what would be updated before retrying`,
                alternatives: [
                    'Use find_and_read to review all updated notes',
                    'Use smart_search to find other related notes for similar updates',
                    partialSuccess ? 'Retry bulk update for failed notes individually' : 'Use individual note_update for precise control',
                    'Use attribute_manager to perform additional attribute operations'
                ],
                examples: successCount > 0 ? [
                    `smart_search("${query}")`,
                    `find_and_read("${query}")`,
                    attributeAction ? `smart_search("#${attributeKey}:${attributeValue}")` : `attribute_manager("note_id", "list")`
                ] : [
                    `bulk_update("${query}", {"dryRun": true})`,
                    `note_update("${foundNotes[0]?.noteId}", "${content || 'retry content'}")`
                ]
            };

            // Format success message
            const successMessage = partialSuccess 
                ? `Partially completed: Bulk updated ${successCount} out of ${foundNotes.length} notes found. Check individual results for details.`
                : `Successfully bulk updated ${successCount} notes matching "${query}".`;

            return ToolResponseFormatter.success(
                result,
                nextSteps,
                {
                    executionTime,
                    resourcesUsed: ['search', 'content', 'update', 'attributes'].filter(r => 
                        r === 'search' || 
                        (r === 'content' && (content || title)) ||
                        (r === 'update' && (content || title)) ||
                        (r === 'attributes' && attributeAction)
                    ),
                    searchDuration,
                    updateDuration,
                    notesFound: foundNotes.length,
                    notesUpdated: successCount,
                    searchMethod: result.searchResults.searchMethod,
                    operationType: result.operationType,
                    updateMode: mode,
                    attributeAction,
                    confirmationRequired,
                    partialSuccess,
                    errors: updateResults.filter(r => !r.success).map(r => r.error).filter(Boolean),
                    successMessage
                }
            );

        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            log.error(`Error executing bulk_update tool: ${errorMessage}`);

            return ToolResponseFormatter.error(
                `Bulk update operation failed: ${errorMessage}`,
                {
                    possibleCauses: [
                        'Search or update service connectivity issue',
                        'Invalid parameters provided',
                        'System resource exhaustion',
                        'Database transaction failure',
                        'Attribute management service unavailable'
                    ],
                    suggestions: [
                        'Try with dryRun: true first to test parameters',
                        'Reduce maxResults to lower number',
                        'Use individual smart_search and note_update operations',
                        'Check if Trilium service is running properly',
                        'Verify all parameters are valid'
                    ],
                    examples: [
                        'bulk_update("simple keywords", {"dryRun": true})',
                        'smart_search("test query")',
                        'note_update("specific_note_id", "content")'
                    ]
                }
            );
        }
    }

    /**
     * Execute the bulk update tool (legacy method for backward compatibility)
     */
    public async execute(args: {
        query: string,
        content?: string,
        title?: string,
        mode?: 'replace' | 'append' | 'prepend',
        attributeAction?: 'add' | 'remove' | 'update',
        attributeKey?: string,
        attributeValue?: string,
        maxResults?: number,
        dryRun?: boolean,
        confirmationRequired?: boolean,
        parentNoteId?: string,
        forceMethod?: string
    }): Promise<string | object> {
        const standardizedResponse = await this.executeStandardized(args);

        // For backward compatibility, return the legacy format
        if (standardizedResponse.success) {
            const result = standardizedResponse.result as BulkUpdateResult;
            const metadata = standardizedResponse.metadata;
            
            return {
                success: true,
                found: result.searchResults.count,
                updated: result.totalNotesUpdated,
                attempted: result.totalNotesAttempted,
                query: result.searchResults.query,
                method: result.searchResults.searchMethod,
                operationType: result.operationType,
                mode: metadata.updateMode,
                attributeAction: metadata.attributeAction,
                dryRun: args.dryRun || false,
                results: result.updateResults.map(r => ({
                    noteId: r.noteId,
                    title: r.title,
                    success: r.success,
                    error: r.error,
                    changes: r.changes
                })),
                message: metadata.successMessage || `Bulk updated ${result.totalNotesUpdated}/${result.totalNotesAttempted} notes.`
            };
        } else {
            const errorResponse = standardizedResponse as ToolErrorResponse;
            return `Error: ${errorResponse.error}`;
        }
    }
}