/**
 * Search Notes Tool
 *
 * This tool allows the LLM to search for notes using semantic search.
 */

import type { Tool, ToolHandler } from './tool_interfaces.js';
import log from '../../log.js';
import aiServiceManager from '../ai_service_manager.js';
import becca from '../../../becca/becca.js';
import { ContextExtractor } from '../context/index.js';
import searchService from '../../search/services/search.js';

/**
 * Definition of the search notes tool
 */
export const searchNotesToolDefinition: Tool = {
    type: 'function',
    function: {
        name: 'search_notes',
        description: 'Search for notes in the database using semantic search. Returns notes most semantically related to the query. Use specific, descriptive queries for best results.',
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'The search query to find semantically related notes. Be specific and descriptive for best results.'
                },
                parentNoteId: {
                    type: 'string',
                    description: 'Optional system ID of the parent note to restrict search to a specific branch (not the title). This is a unique identifier like "abc123def456". Do not use note titles here.'
                },
                maxResults: {
                    type: 'number',
                    description: 'Maximum number of results to return (default: 5)'
                },
                summarize: {
                    type: 'boolean',
                    description: 'Whether to provide summarized content previews instead of truncated ones (default: false)'
                }
            },
            required: ['query']
        }
    }
};

/**
 * Get or create the vector search tool dependency
 * @returns The vector search tool or null if it couldn't be created
 */
async function getOrCreateVectorSearchTool(): Promise<any> {
    try {
        // Try to get the existing vector search tool
        let vectorSearchTool = aiServiceManager.getVectorSearchTool();

        if (vectorSearchTool) {
            log.info(`Found existing vectorSearchTool`);
            return vectorSearchTool;
        }

        // No existing tool, try to initialize it
        log.info(`VectorSearchTool not found, attempting initialization`);

        // Get agent tools manager and initialize it
        const agentTools = aiServiceManager.getAgentTools();
        if (agentTools && typeof agentTools.initialize === 'function') {
            try {
                // Force initialization to ensure it runs even if previously marked as initialized
                await agentTools.initialize(true);
            } catch (initError: any) {
                log.error(`Failed to initialize agent tools: ${initError.message}`);
                return null;
            }
        } else {
            log.error('Agent tools manager not available');
            return null;
        }

        // Try getting the vector search tool again after initialization
        vectorSearchTool = aiServiceManager.getVectorSearchTool();

        if (vectorSearchTool) {
            log.info('Successfully created vectorSearchTool');
            return vectorSearchTool;
        } else {
            log.error('Failed to create vectorSearchTool after initialization');
            return null;
        }
    } catch (error: any) {
        log.error(`Error getting or creating vectorSearchTool: ${error.message}`);
        return null;
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

    private async executeKeywordFallback(args: {
        query: string;
        parentNoteId?: string;
        maxResults: number;
        summarize: boolean;
    }): Promise<string | object> {
        const { query, parentNoteId, maxResults, summarize } = args;
        log.info(`Vector search unavailable, using keyword fallback for query: "${query}"`);

        const searchContext = {
            includeArchivedNotes: false,
            includeHiddenNotes: false,
            ancestorNoteId: parentNoteId,
            fuzzyAttributeSearch: false
        };

        const searchResults = searchService.searchNotes(query, searchContext);
        const limitedResults = searchResults.slice(0, maxResults);

        const enhancedResults = await Promise.all(
            limitedResults.map(async note => {
                const preview = await this.getRichContentPreview(note.noteId, summarize);
                return {
                    noteId: note.noteId,
                    title: note.title,
                    preview,
                    dateCreated: note.dateCreated,
                    dateModified: note.dateModified,
                    type: note.type,
                    mime: note.mime,
                    matchType: 'keyword'
                };
            })
        );

        if (enhancedResults.length === 0) {
            return {
                count: 0,
                results: [],
                query,
                message: 'No notes found matching your query. Try broader terms or different keywords. Note: Use the noteId (not the title) when performing operations on specific notes with other tools.'
            };
        }

        return {
            count: enhancedResults.length,
            totalFound: searchResults.length,
            results: enhancedResults,
            message: 'Vector search unavailable. Results are from keyword search; use noteId for follow-up operations.'
        };
    }

    /**
     * Execute the search notes tool
     */
    public async execute(args: {
        query: string,
        parentNoteId?: string,
        maxResults?: number,
        summarize?: boolean
    }): Promise<string | object> {
        try {
            const {
                query,
                parentNoteId,
                maxResults = 5,
                summarize = false
            } = args;

            log.info(`Executing search_notes tool - Query: "${query}", ParentNoteId: ${parentNoteId || 'not specified'}, MaxResults: ${maxResults}, Summarize: ${summarize}`);

            // Get the vector search tool from the AI service manager
            const vectorSearchTool = await getOrCreateVectorSearchTool();

            if (!vectorSearchTool) {
                return await this.executeKeywordFallback({ query, parentNoteId, maxResults, summarize });
            }

            log.info(`Retrieved vector search tool from AI service manager`);

            // Check if searchNotes method exists
            if (!vectorSearchTool.searchNotes || typeof vectorSearchTool.searchNotes !== 'function') {
                log.error(`Vector search tool is missing searchNotes method`);
                return await this.executeKeywordFallback({ query, parentNoteId, maxResults, summarize });
            }

            // Execute the search
            log.info(`Performing semantic search for: "${query}"`);
            const searchStartTime = Date.now();
            let response;
            try {
                response = await vectorSearchTool.searchNotes(query, parentNoteId, maxResults);
            } catch (error: any) {
                log.error(`Semantic search failed, falling back to keyword search: ${error.message || String(error)}`);
                return await this.executeKeywordFallback({ query, parentNoteId, maxResults, summarize });
            }
            const results: Array<Record<string, unknown>> = response?.matches ?? [];
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

            // Format the results
            if (results.length === 0) {
                return {
                    count: 0,
                    results: [],
                    query: query,
                    message: 'No notes found matching your query. Try using more general terms or try the keyword_search_notes tool with a different query. Note: Use the noteId (not the title) when performing operations on specific notes with other tools.'
                };
            } else {
                return {
                    count: enhancedResults.length,
                    results: enhancedResults,
                    message: "Note: Use the noteId (not the title) when performing operations on specific notes with other tools."
                };
            }
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            log.error(`Error executing search_notes tool: ${errorMessage}`);
            return `Error: ${errorMessage}`;
        }
    }
}
