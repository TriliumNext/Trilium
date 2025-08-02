/**
 * Search Notes Tool
 *
 * This tool allows the LLM to search for notes using keyword search.
 */

import type { Tool, ToolHandler } from './tool_interfaces.js';
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
        description: 'Search for notes using keywords and phrases. Use descriptive terms and phrases for best results. Returns noteId values to use with other tools.',
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'Search query for finding notes. Use descriptive phrases like "machine learning classification" for better results.'
                },
                parentNoteId: {
                    type: 'string',
                    description: 'Optional noteId to limit search to children of this note. Must be a noteId from search results, not a title.'
                },
                maxResults: {
                    type: 'number',
                    description: 'Maximum number of results to return (default: 5, max: 20).'
                },
                summarize: {
                    type: 'boolean',
                    description: 'Get AI-generated summaries instead of truncated previews (default: false).'
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

            // Format the results with enhanced guidance
            if (results.length === 0) {
                return {
                    count: 0,
                    results: [],
                    query: query,
                    message: `No results found. Try rephrasing your query, using simpler terms, or check your spelling.`
                };
            } else {
                return {
                    count: enhancedResults.length,
                    results: enhancedResults,
                    query: query,
                    message: `Found ${enhancedResults.length} matches. Use read_note with noteId to get full content.`
                };
            }
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            log.error(`Error executing search_notes tool: ${errorMessage}`);
            return `Error: ${errorMessage}`;
        }
    }
}
