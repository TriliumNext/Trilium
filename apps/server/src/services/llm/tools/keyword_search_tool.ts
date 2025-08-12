/**
 * Keyword Search Notes Tool
 *
 * This tool allows the LLM to search for notes using exact keyword matching and attribute-based filters.
 * It complements the semantic search tool by providing more precise, rule-based search capabilities.
 */

import type { Tool, ToolHandler } from './tool_interfaces.js';
import log from '../../log.js';
import searchService from '../../search/services/search.js';
import becca from '../../../becca/becca.js';

/**
 * Definition of the keyword search notes tool
 */
export const keywordSearchToolDefinition: Tool = {
    type: 'function',
    function: {
        name: 'keyword_search_notes',
        description: 'Find notes with exact text matches. Best for finding specific words or phrases. Examples: keyword_search_notes("python code") → finds notes containing exactly "python code", keyword_search_notes("#important") → finds notes tagged with "important".',
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'Exact text to find in notes. Use quotes for phrases: "exact phrase". Find tags: "#tagname". Find by title: note.title="Weekly Report". Use OR for alternatives: "python OR javascript"'
                },
                maxResults: {
                    type: 'number',
                    description: 'How many results to return. Use 5-10 for quick checks, 20-50 for thorough searches. Default is 10, maximum is 50.'
                },
                includeArchived: {
                    type: 'boolean',
                    description: 'Also search old archived notes. Use true to search everything, false (default) to skip archived notes.'
                }
            },
            required: ['query']
        }
    }
};

/**
 * Keyword search notes tool implementation
 */
export class KeywordSearchTool implements ToolHandler {
    public definition: Tool = keywordSearchToolDefinition;

    /**
     * Convert a keyword query to a semantic query suggestion
     */
    private convertToSemanticQuery(keywordQuery: string): string {
        // Remove search operators and attributes to create a semantic query
        return keywordQuery
            .replace(/#\w+/g, '') // Remove label filters
            .replace(/~\w+/g, '') // Remove relation filters
            .replace(/\"[^\"]*\"/g, (match) => match.slice(1, -1)) // Remove quotes but keep content
            .replace(/\s+OR\s+/gi, ' ') // Replace OR with space
            .replace(/\s+AND\s+/gi, ' ') // Replace AND with space
            .replace(/note\.(title|content)\s*\*=\*\s*/gi, '') // Remove note.content operators
            .replace(/\s+/g, ' ') // Normalize spaces
            .trim();
    }

    /**
     * Execute the keyword search notes tool
     */
    public async execute(args: { query: string, maxResults?: number, includeArchived?: boolean }): Promise<string | object> {
        try {
            const { query, maxResults = 10, includeArchived = false } = args;

            log.info(`Executing keyword_search_notes tool - Query: "${query}", MaxResults: ${maxResults}, IncludeArchived: ${includeArchived}`);

            // Execute the search
            log.info(`Performing keyword search for: "${query}"`);
            const searchStartTime = Date.now();

            // Find results with the given query
            const searchContext = {
                includeArchivedNotes: includeArchived,
                fuzzyAttributeSearch: false
            };

            const searchResults = searchService.searchNotes(query, searchContext);
            const limitedResults = searchResults.slice(0, maxResults);

            const searchDuration = Date.now() - searchStartTime;

            log.info(`Keyword search completed in ${searchDuration}ms, found ${searchResults.length} matching notes, returning ${limitedResults.length}`);

            if (limitedResults.length > 0) {
                // Log top results
                limitedResults.slice(0, 3).forEach((result, index) => {
                    log.info(`Result ${index + 1}: "${result.title}"`);
                });
            } else {
                log.info(`No matching notes found for query: "${query}"`);
            }

            // Format the results with enhanced guidance
            if (limitedResults.length === 0) {
                return {
                    count: 0,
                    results: [],
                    query: query,
                    message: `No keyword matches. Try: search_notes with "${this.convertToSemanticQuery(query)}" or check spelling/try simpler terms.`
                };
            }
            
            return {
                count: limitedResults.length,
                totalFound: searchResults.length,
                query: query,
                searchType: 'keyword',
                message: `Found ${limitedResults.length} keyword matches. Use read_note with noteId for full content.`,
                results: limitedResults.map(note => {
                    // Get a preview of the note content with highlighted search terms
                    let contentPreview = '';
                    try {
                        const content = note.getContent();
                        if (typeof content === 'string') {
                            contentPreview = content.length > 200 ? content.substring(0, 200) + '...' : content;
                        } else if (Buffer.isBuffer(content)) {
                            contentPreview = '[Binary content]';
                        } else {
                            contentPreview = String(content).substring(0, 200) + (String(content).length > 200 ? '...' : '');
                        }
                    } catch (e) {
                        contentPreview = '[Content not available]';
                    }

                    // Get note attributes
                    const attributes = note.getOwnedAttributes().map(attr => ({
                        type: attr.type,
                        name: attr.name,
                        value: attr.value
                    }));

                    return {
                        noteId: note.noteId,
                        title: note.title,
                        preview: contentPreview,
                        attributes: attributes.length > 0 ? attributes : undefined,
                        type: note.type,
                        mime: note.mime,
                        isArchived: note.isArchived,
                        dateModified: note.dateModified
                    };
                })
            };
        } catch (error: any) {
            log.error(`Error executing keyword_search_notes tool: ${error.message || String(error)}`);
            return `Error: ${error.message || String(error)}`;
        }
    }
}
