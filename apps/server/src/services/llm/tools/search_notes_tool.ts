/**
 * Search Notes Tool
 *
 * This tool allows the LLM to search for notes using keyword search.
 */

import type { Tool, ToolHandler, StandardizedToolResponse } from './tool_interfaces.js';
import { ToolResponseFormatter } from './tool_interfaces.js';
import log from '../../log.js';
import searchService from '../../search/services/search.js';
import becca from '../../../becca/becca.js';
import { ContextExtractor } from '../context/index.js';
import aiServiceManager from '../ai_service_manager.js';

/**
 * Definition of the search notes tool
 */
export const searchNotesToolDefinition: Tool = {
    type: 'function',
    function: {
        name: 'search_notes',
        description: 'Find notes by searching for keywords or phrases. Returns noteId values for use with read_note, note_update, or attribute_manager tools. Examples: search_notes("meeting notes") → finds meeting-related notes, search_notes("python tutorial") → finds programming tutorials.',
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'What to search for. Use natural language like "project planning documents" or "python tutorial". Examples: "meeting notes", "budget planning", "recipe ideas", "work tasks"'
                },
                parentNoteId: {
                    type: 'string',
                    description: 'Look only inside this note folder. Use noteId from previous search results. Leave empty to search everywhere. Example: "abc123def456"'
                },
                maxResults: {
                    type: 'number',
                    description: 'How many results to return. Choose 5 for quick scan, 10-20 for thorough search. Default is 5, maximum is 20.'
                },
                summarize: {
                    type: 'boolean',
                    description: 'Get AI-generated summaries of each note instead of content snippets. Use true when you need quick overviews. Default is false for faster results.'
                }
            },
            required: ['query']
        }
    }
};

/**
 * Perform keyword search for notes
 */
async function searchNotesWithKeywords(query: string, parentNoteId?: string, maxResults: number = 5): Promise<any[]> {
    try {
        log.info(`Performing keyword search for: "${query}"`);
        
        // Build search query with parent filter if specified
        let searchQuery = query;
        if (parentNoteId) {
            // Add parent filter to the search query
            searchQuery = `${query} note.parents.noteId = ${parentNoteId}`;
        }

        const searchContext = {
            includeArchivedNotes: false,
            fuzzyAttributeSearch: false
        };

        const searchResults = searchService.searchNotes(searchQuery, searchContext);
        const limitedResults = searchResults.slice(0, maxResults);

        // Convert search results to the expected format
        return limitedResults.map(note => {
            // Get the first parent (notes can have multiple parents)
            const parentNotes = note.getParentNotes();
            const firstParent = parentNotes.length > 0 ? parentNotes[0] : null;
            
            return {
                noteId: note.noteId,
                title: note.title,
                dateCreated: note.dateCreated,
                dateModified: note.dateModified,
                parentId: firstParent?.noteId || null,
                similarity: 1.0, // Keyword search doesn't provide similarity scores
                score: 1.0
            };
        });
    } catch (error: any) {
        log.error(`Error in keyword search: ${error.message}`);
        return [];
    }
}

/**
 * Search notes tool implementation
 */
export class SearchNotesTool implements ToolHandler {
    public definition: Tool = searchNotesToolDefinition;
    private contextExtractor: ContextExtractor;

    constructor() {
        this.contextExtractor = new ContextExtractor();
    }

    /**
     * Get rich content preview for a note
     * This provides a better preview than the simple truncation in VectorSearchTool
     */
    private async getRichContentPreview(noteId: string, summarize: boolean): Promise<string> {
        try {
            const note = becca.getNote(noteId);
            if (!note) {
                return 'Note not found';
            }

            // Get the full content with proper formatting
            const formattedContent = await this.contextExtractor.getNoteContent(noteId);
            if (!formattedContent) {
                return 'No content available';
            }

            // If summarization is requested
            if (summarize) {
                // Try to get an LLM service for summarization
                try {
                    const llmService = await aiServiceManager.getService();
                    
                    const messages = [
                            {
                                role: "system" as const,
                                content: "Summarize the following note content concisely while preserving key information. Keep your summary to about 3-4 sentences."
                            },
                            {
                                role: "user" as const,
                                content: `Note title: ${note.title}\n\nContent:\n${formattedContent}`
                            }
                        ];

                        // Request summarization with safeguards to prevent recursion
                        const result = await llmService.generateChatCompletion(messages, {
                            temperature: 0.3,
                            maxTokens: 200,
                            // Type assertion to bypass type checking for special internal parameters
                            ...(({
                                bypassFormatter: true,
                                bypassContextProcessing: true
                            } as Record<string, boolean>))
                        });

                    if (result && result.text) {
                        return result.text;
                    }
                } catch (error) {
                    log.error(`Error summarizing content: ${error}`);
                    // Fall through to smart truncation if summarization fails
                }
            }

            try {
                // Fall back to smart truncation if summarization fails or isn't requested
                const previewLength = Math.min(formattedContent.length, 600);
                let preview = formattedContent.substring(0, previewLength);

                // Only add ellipsis if we've truncated the content
                if (previewLength < formattedContent.length) {
                    // Try to find a natural break point
                    const breakPoints = ['. ', '.\n', '\n\n', '\n', '. '];

                    for (const breakPoint of breakPoints) {
                        const lastBreak = preview.lastIndexOf(breakPoint);
                        if (lastBreak > previewLength * 0.6) { // At least 60% of the way through
                            preview = preview.substring(0, lastBreak + breakPoint.length);
                            break;
                        }
                    }

                    // Add ellipsis if truncated
                    preview += '...';
                }

                return preview;
            } catch (error) {
                log.error(`Error getting rich content preview: ${error}`);
                return 'Error retrieving content preview';
            }
        } catch (error) {
            log.error(`Error getting rich content preview: ${error}`);
            return 'Error retrieving content preview';
        }
    }

    /**
     * Extract keywords from a semantic query for alternative search suggestions
     */
    private extractKeywords(query: string): string {
        return query.split(' ')
            .filter(word => word.length > 3 && !['using', 'with', 'for', 'and', 'the', 'that', 'this'].includes(word.toLowerCase()))
            .slice(0, 3)
            .join(' ');
    }

    /**
     * Suggest broader search terms when specific searches fail
     */
    private suggestBroaderTerms(query: string): string {
        const broaderTermsMap: Record<string, string> = {
            'machine learning': 'AI technology',
            'productivity': 'work methods',
            'development': 'programming',
            'management': 'organization',
            'planning': 'strategy'
        };
        
        for (const [specific, broader] of Object.entries(broaderTermsMap)) {
            if (query.toLowerCase().includes(specific)) {
                return broader;
            }
        }
        
        // Default: take first significant word and make it broader
        const firstWord = query.split(' ').find(word => word.length > 3);
        return firstWord ? `${firstWord} concepts` : 'general topics';
    }

    /**
     * Execute the search notes tool with standardized response format
     */
    public async executeStandardized(args: {
        query: string,
        parentNoteId?: string,
        maxResults?: number,
        summarize?: boolean
    }): Promise<StandardizedToolResponse> {
        const startTime = Date.now();

        try {
            const {
                query,
                parentNoteId,
                maxResults = 5,
                summarize = false
            } = args;

            log.info(`Executing search_notes tool - Query: "${query}", ParentNoteId: ${parentNoteId || 'not specified'}, MaxResults: ${maxResults}, Summarize: ${summarize}`);

            // Validate maxResults parameter
            if (maxResults < 1 || maxResults > 20) {
                return ToolResponseFormatter.invalidParameterError(
                    'maxResults',
                    'number between 1 and 20',
                    String(maxResults)
                );
            }

            // Execute the search using keyword search
            const searchStartTime = Date.now();
            const results = await searchNotesWithKeywords(query, parentNoteId, maxResults);
            const searchDuration = Date.now() - searchStartTime;

            log.info(`Search completed in ${searchDuration}ms, found ${results.length} matching notes`);

            if (results.length > 0) {
                // Log top results
                results.slice(0, 3).forEach((result: any, index: number) => {
                    log.info(`Result ${index + 1}: "${result.title}" (similarity: ${Math.round(result.similarity * 100)}%)`);
                });
            } else {
                log.info(`No matching notes found for query: "${query}"`);
            }

            // Get enhanced previews for each result
            const enhancedResults = await Promise.all(
                results.map(async (result: any) => {
                    const noteId = result.noteId;
                    const preview = await this.getRichContentPreview(noteId, summarize);

                    return {
                        noteId: noteId,
                        title: result?.title as string || '[Unknown title]',
                        preview: preview,
                        score: result?.score as number,
                        dateCreated: result?.dateCreated as string,
                        dateModified: result?.dateModified as string,
                        similarity: Math.round(result.similarity * 100) / 100,
                        parentId: result.parentId
                    };
                })
            );

            const executionTime = Date.now() - startTime;

            // Format the results with enhanced guidance
            if (results.length === 0) {
                const broaderTerm = this.suggestBroaderTerms(query);
                const keywords = this.extractKeywords(query);
                
                return ToolResponseFormatter.error(
                    `No results found for query: "${query}"`,
                    {
                        possibleCauses: [
                            'Search terms too specific or misspelled',
                            'No notes contain the exact phrase',
                            'Content may be in different format than expected'
                        ],
                        suggestions: [
                            `Try broader terms like "${broaderTerm}"`,
                            `Search for individual keywords: "${keywords}"`,
                            'Check spelling of search terms',
                            'Try searching without quotes for phrase matching'
                        ],
                        examples: [
                            `search_notes("${broaderTerm}")`,
                            `search_notes("${keywords}")`,
                            'search_notes("general topic") for broader results'
                        ]
                    }
                );
            } else {
                const nextSteps = {
                    suggested: `Use read_note with noteId to get full content: read_note("${enhancedResults[0].noteId}")`,
                    alternatives: [
                        'Use note_update to modify any of these notes',
                        'Use attribute_manager to add tags or relations',
                        'Use search_notes with different terms to find related notes'
                    ],
                    examples: [
                        `read_note("${enhancedResults[0].noteId}")`,
                        `search_notes("${query} related concepts")`
                    ]
                };

                return ToolResponseFormatter.success(
                    {
                        count: enhancedResults.length,
                        results: enhancedResults,
                        query: query
                    },
                    nextSteps,
                    {
                        executionTime,
                        resourcesUsed: ['search', 'content'],
                        searchDuration,
                        summarized: summarize,
                        maxResultsRequested: maxResults
                    }
                );
            }
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            log.error(`Error executing search_notes tool: ${errorMessage}`);
            
            return ToolResponseFormatter.error(
                `Search execution failed: ${errorMessage}`,
                {
                    possibleCauses: [
                        'Database connectivity issue',
                        'Search service unavailable',
                        'Invalid search parameters'
                    ],
                    suggestions: [
                        'Try again with simplified search terms',
                        'Check if Trilium service is running properly',
                        'Verify search parameters are valid'
                    ]
                }
            );
        }
    }

    /**
     * Execute the search notes tool (legacy method for backward compatibility)
     */
    public async execute(args: {
        query: string,
        parentNoteId?: string,
        maxResults?: number,
        summarize?: boolean
    }): Promise<string | object> {
        // Delegate to the standardized method and extract the result for backward compatibility
        const startTime = Date.now();
        const standardizedResponse = await this.executeStandardized(args);
        const executionTime = Date.now() - startTime;

        // For backward compatibility, return the legacy format
        if (standardizedResponse.success) {
            const result = standardizedResponse.result as any;
            if (result.count === 0) {
                return {
                    count: 0,
                    results: [],
                    query: result.query || args.query,
                    message: `No results found. Try rephrasing your query, using simpler terms, or check your spelling.`
                };
            } else {
                return {
                    count: result.count,
                    results: result.results,
                    query: result.query,
                    message: `Found ${result.count} matches. Use read_note with noteId to get full content.`
                };
            }
        } else {
            return `Error: ${standardizedResponse.error}`;
        }
    }
}
