/**
 * Find and Read Tool - Phase 2.1 Compound Workflow Tool
 *
 * This compound tool combines smart_search + read_note into a single operation.
 * Perfect for "find my X and show me what it says" type requests.
 */

import type { Tool, ToolHandler, StandardizedToolResponse, ToolErrorResponse } from './tool_interfaces.js';
import { ToolResponseFormatter } from './tool_interfaces.js';
import log from '../../log.js';
import { SmartSearchTool } from './smart_search_tool.js';
import { ReadNoteTool } from './read_note_tool.js';

/**
 * Result structure for find and read operations
 */
interface FindAndReadResult {
    searchResults: {
        count: number;
        query: string;
        searchMethod: string;
    };
    readResults: Array<{
        noteId: string;
        title: string;
        type: string;
        content: string | Buffer;
        wordCount: number;
        dateModified: string;
        attributes?: Array<{
            name: string;
            value: string;
            type: string;
        }>;
        summary?: string;
    }>;
    totalNotesRead: number;
}

/**
 * Definition of the find and read compound tool
 */
export const findAndReadToolDefinition: Tool = {
    type: 'function',
    function: {
        name: 'find_and_read',
        description: 'Search for notes and immediately show their content in one step. Perfect for "find my project notes and show me what they say" requests. Combines smart search with reading content automatically.',
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'What to search for using natural language. Examples: "project planning notes", "#urgent tasks", "meeting notes from last week", "machine learning concepts"'
                },
                parentNoteId: {
                    type: 'string',
                    description: 'Optional: Search only within this note folder. Use noteId from previous search results to narrow scope.'
                },
                maxResults: {
                    type: 'number',
                    description: 'How many notes to find and read. Use 3-5 for quick overview, 10-15 for thorough review. Default is 5, maximum is 20.'
                },
                summarize: {
                    type: 'boolean',
                    description: 'Get AI-generated summaries instead of full content for faster overview. Default is false for complete content.'
                },
                includeAttributes: {
                    type: 'boolean',
                    description: 'Also show tags, properties, and relations for each note. Useful for understanding note organization. Default is false.'
                },
                forceMethod: {
                    type: 'string',
                    description: 'Optional: Force a specific search method. Use "auto" (default) for intelligent selection.',
                    enum: ['auto', 'semantic', 'keyword', 'attribute', 'multi_method']
                }
            },
            required: ['query']
        }
    }
};

/**
 * Find and read compound tool implementation
 */
export class FindAndReadTool implements ToolHandler {
    public definition: Tool = findAndReadToolDefinition;
    private smartSearchTool: SmartSearchTool;
    private readNoteTool: ReadNoteTool;

    constructor() {
        this.smartSearchTool = new SmartSearchTool();
        this.readNoteTool = new ReadNoteTool();
    }

    /**
     * Execute the find and read compound tool with standardized response format
     */
    public async executeStandardized(args: {
        query: string,
        parentNoteId?: string,
        maxResults?: number,
        summarize?: boolean,
        includeAttributes?: boolean,
        forceMethod?: string
    }): Promise<StandardizedToolResponse> {
        const startTime = Date.now();

        try {
            const {
                query,
                parentNoteId,
                maxResults = 5,
                summarize = false,
                includeAttributes = false,
                forceMethod = 'auto'
            } = args;

            log.info(`Executing find_and_read tool - Query: "${query}", MaxResults: ${maxResults}, Summarize: ${summarize}`);

            // Validate input parameters
            if (!query || query.trim().length === 0) {
                return ToolResponseFormatter.invalidParameterError(
                    'query',
                    'non-empty string',
                    query
                );
            }

            if (maxResults < 1 || maxResults > 20) {
                return ToolResponseFormatter.invalidParameterError(
                    'maxResults',
                    'number between 1 and 20',
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
                summarize: false // We'll handle summarization ourselves
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
                            'Use simpler search query without operators',
                            'Check if the notes exist in your knowledge base'
                        ].concat(searchResponse.help?.suggestions || []),
                        examples: searchResponse.help?.examples || [
                            'find_and_read("simple keywords")',
                            'find_and_read("general topic")'
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
                            'Check spelling of search keywords',
                            'Use find_and_read with simpler query'
                        ],
                        examples: [
                            `find_and_read("${query.split(' ')[0]}")`,
                            'find_and_read("general topic")'
                        ]
                    }
                );
            }

            log.info(`Step 1 complete: Found ${foundNotes.length} notes in ${searchDuration}ms`);

            // Step 2: Read content from found notes
            log.info(`Step 2: Reading content from ${foundNotes.length} notes`);
            const readStartTime = Date.now();
            const readResults: any[] = [];
            const readErrors: string[] = [];

            for (const note of foundNotes) {
                try {
                    const readResponse = await this.readNoteTool.executeStandardized({
                        noteId: note.noteId,
                        includeAttributes
                    });

                    if (readResponse.success) {
                        const readResult = readResponse.result as any;
                        readResults.push({
                            noteId: readResult.noteId,
                            title: readResult.title,
                            type: readResult.type,
                            content: readResult.content,
                            wordCount: readResult.metadata?.wordCount || 0,
                            dateModified: readResult.metadata?.lastModified || '',
                            attributes: readResult.attributes,
                            searchScore: note.score,
                            searchMethod: note.searchMethod,
                            relevanceFactors: note.relevanceFactors
                        });
                        
                        log.info(`Successfully read note "${readResult.title}" (${readResult.metadata?.wordCount || 0} words)`);
                    } else {
                        readErrors.push(`Failed to read ${note.title}: ${readResponse.error}`);
                        log.error(`Failed to read note ${note.noteId}: ${readResponse.error}`);
                    }
                } catch (error: any) {
                    const errorMsg = `Error reading note ${note.title}: ${error.message || String(error)}`;
                    readErrors.push(errorMsg);
                    log.error(errorMsg);
                }
            }

            const readDuration = Date.now() - readStartTime;
            log.info(`Step 2 complete: Successfully read ${readResults.length}/${foundNotes.length} notes in ${readDuration}ms`);

            if (readResults.length === 0) {
                return ToolResponseFormatter.error(
                    `Found ${foundNotes.length} notes but couldn't read any of them`,
                    {
                        possibleCauses: [
                            'Note access permissions denied',
                            'Database connectivity issues',
                            'Notes may be corrupted or deleted'
                        ],
                        suggestions: [
                            'Try individual read_note operations on specific notes',
                            'Check if Trilium service is running properly',
                            'Use smart_search to find different notes'
                        ],
                        examples: [
                            `read_note("${foundNotes[0]?.noteId}")`,
                            `smart_search("${query}")`
                        ]
                    }
                );
            }

            // Step 3: Summarize content if requested
            if (summarize && readResults.length > 0) {
                log.info(`Step 3: Generating summaries for ${readResults.length} notes`);
                // Note: Summarization would be implemented here using the AI service
                // For now, we'll create brief content previews
                readResults.forEach(result => {
                    const contentStr = typeof result.content === 'string' ? result.content : String(result.content);
                    result.summary = contentStr.length > 300 
                        ? contentStr.substring(0, 300) + '...'
                        : contentStr;
                });
            }

            const executionTime = Date.now() - startTime;
            const totalWords = readResults.reduce((sum, result) => sum + (result.wordCount || 0), 0);

            // Create comprehensive result
            const result: FindAndReadResult = {
                searchResults: {
                    count: foundNotes.length,
                    query,
                    searchMethod: searchResult.analysis?.usedMethods?.join(' + ') || 'smart'
                },
                readResults,
                totalNotesRead: readResults.length
            };

            // Create contextual next steps
            const nextSteps = {
                suggested: readResults.length === 1 
                    ? `Use note_update with noteId: "${readResults[0].noteId}" to edit this note`
                    : `Use read_note with specific noteId to focus on one note, or note_update to modify any of them`,
                alternatives: [
                    'Use find_and_update to search and modify notes in one step',
                    'Use attribute_manager to add tags to relevant notes',
                    'Use manage_relationships to connect related notes',
                    'Refine search with different keywords for more results'
                ],
                examples: readResults.length > 0 ? [
                    `note_update("${readResults[0].noteId}", "updated content")`,
                    `find_and_update("${query}", "new content", "append")`,
                    `attribute_manager("${readResults[0].noteId}", "add", "#processed")`
                ] : [
                    `smart_search("${query} concepts")`,
                    'find_and_read("broader search terms")'
                ]
            };

            return ToolResponseFormatter.success(
                result,
                nextSteps,
                {
                    executionTime,
                    resourcesUsed: ['search', 'content', 'analysis'],
                    searchDuration,
                    readDuration,
                    notesFound: foundNotes.length,
                    notesRead: readResults.length,
                    totalWords,
                    searchMethod: result.searchResults.searchMethod,
                    errors: readErrors.length > 0 ? readErrors : undefined,
                    summarized: summarize,
                    includeAttributes
                }
            );

        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            log.error(`Error executing find_and_read tool: ${errorMessage}`);

            return ToolResponseFormatter.error(
                `Find and read operation failed: ${errorMessage}`,
                {
                    possibleCauses: [
                        'Search or read service connectivity issue',
                        'Invalid parameters provided',
                        'System resource exhaustion'
                    ],
                    suggestions: [
                        'Try with simpler search query',
                        'Reduce maxResults to lower number',
                        'Use individual smart_search and read_note operations',
                        'Check if Trilium service is running properly'
                    ],
                    examples: [
                        'find_and_read("simple keywords", {"maxResults": 3})',
                        'smart_search("test query")',
                        'read_note("specific_note_id")'
                    ]
                }
            );
        }
    }

    /**
     * Execute the find and read tool (legacy method for backward compatibility)
     */
    public async execute(args: {
        query: string,
        parentNoteId?: string,
        maxResults?: number,
        summarize?: boolean,
        includeAttributes?: boolean,
        forceMethod?: string
    }): Promise<string | object> {
        const standardizedResponse = await this.executeStandardized(args);

        // For backward compatibility, return the legacy format
        if (standardizedResponse.success) {
            const result = standardizedResponse.result as FindAndReadResult;
            return {
                success: true,
                found: result.searchResults.count,
                read: result.totalNotesRead,
                query: result.searchResults.query,
                method: result.searchResults.searchMethod,
                results: result.readResults.map(r => ({
                    noteId: r.noteId,
                    title: r.title,
                    type: r.type,
                    content: r.content,
                    wordCount: r.wordCount,
                    summary: r.summary,
                    attributes: r.attributes
                })),
                message: `Found ${result.searchResults.count} notes, successfully read ${result.totalNotesRead} notes. Total content: ${result.readResults.reduce((sum, r) => sum + (r.wordCount || 0), 0)} words.`
            };
        } else {
            return `Error: ${standardizedResponse.error}`;
        }
    }
}