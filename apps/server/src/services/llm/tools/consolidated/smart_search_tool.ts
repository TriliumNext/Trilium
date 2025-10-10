/**
 * Smart Search Tool (Consolidated)
 *
 * This tool consolidates 4 separate search tools into a single, intelligent search interface:
 * - search_notes_tool (semantic search)
 * - keyword_search_tool (keyword/attribute search)
 * - attribute_search_tool (attribute-specific search)
 * - search_suggestion_tool (removed - not needed)
 *
 * The tool automatically detects the best search method based on the query.
 */

import type { Tool, ToolHandler } from '../tool_interfaces.js';
import log from '../../../log.js';
import aiServiceManager from '../../ai_service_manager.js';
import becca from '../../../../becca/becca.js';
import searchService from '../../../search/services/search.js';
import attributes from '../../../attributes.js';
import attributeFormatter from '../../../attribute_formatter.js';
import { ContextExtractor } from '../../context/index.js';
import type BNote from '../../../../becca/entities/bnote.js';

/**
 * Search method types
 */
type SearchMethod = 'auto' | 'semantic' | 'keyword' | 'attribute' | 'error';

/**
 * Search result interface
 */
interface SearchResult {
    noteId: string;
    title: string;
    preview: string;
    type: string;
    similarity?: number;
    attributes?: Array<{
        name: string;
        value: string;
        type: string;
    }>;
    dateCreated?: string;
    dateModified?: string;
}

/**
 * Search response interface
 */
interface SearchResponse {
    count: number;
    search_method: string;
    query: string;
    results: SearchResult[];
    message: string;
}

/**
 * Definition of the smart search tool
 */
export const smartSearchToolDefinition: Tool = {
    type: 'function',
    function: {
        name: 'smart_search',
        description: 'Unified search for notes using semantic understanding, keywords, or attributes. Automatically selects the best search method or allows manual override.',
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'Search query. Can be natural language, keywords, or attribute syntax (#label, ~relation)'
                },
                search_method: {
                    type: 'string',
                    description: 'Search method: auto (default), semantic, keyword, or attribute',
                    enum: ['auto', 'semantic', 'keyword', 'attribute']
                },
                max_results: {
                    type: 'number',
                    description: 'Maximum results to return (default: 10)'
                },
                parent_note_id: {
                    type: 'string',
                    description: 'Optional parent note ID to limit search scope'
                },
                include_archived: {
                    type: 'boolean',
                    description: 'Include archived notes (default: false)'
                }
            },
            required: ['query']
        }
    }
};

/**
 * Smart search tool implementation
 */
export class SmartSearchTool implements ToolHandler {
    public definition: Tool = smartSearchToolDefinition;
    private contextExtractor: ContextExtractor;

    constructor() {
        this.contextExtractor = new ContextExtractor();
    }

    /**
     * Execute the smart search tool
     */
    public async execute(args: {
        query: string;
        search_method?: SearchMethod;
        max_results?: number;
        parent_note_id?: string;
        include_archived?: boolean;
    }): Promise<string | object> {
        try {
            const {
                query,
                search_method = 'auto',
                max_results = 10,
                parent_note_id,
                include_archived = false
            } = args;

            log.info(`Executing smart_search tool - Query: "${query}", Method: ${search_method}, MaxResults: ${max_results}`);

            // Detect the best search method if auto
            const detectedMethod = search_method === 'auto'
                ? this.detectSearchMethod(query)
                : search_method;

            log.info(`Using search method: ${detectedMethod}`);

            // Execute the appropriate search
            let results: SearchResult[];
            let searchType: string;

            switch (detectedMethod) {
                case 'semantic':
                    results = await this.semanticSearch(query, parent_note_id, max_results);
                    searchType = 'semantic';
                    break;
                case 'attribute':
                    results = await this.attributeSearch(query, max_results);
                    searchType = 'attribute';
                    break;
                case 'keyword':
                default:
                    results = await this.keywordSearch(query, max_results, include_archived);
                    searchType = 'keyword';
                    break;
            }

            log.info(`Search completed: found ${results.length} results using ${searchType} search`);

            // Format and return results
            return {
                count: results.length,
                search_method: searchType,
                query: query,
                results: results,
                message: results.length === 0
                    ? 'No notes found. Try different keywords or a broader search.'
                    : `Found ${results.length} notes using ${searchType} search.`
            };
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            log.error(`Error executing smart_search tool: ${errorMessage}`);
            return `Error: ${errorMessage}`;
        }
    }

    /**
     * Detect the most appropriate search method based on the query
     */
    private detectSearchMethod(query: string): SearchMethod {
        // Check for attribute syntax patterns
        if (this.hasAttributeSyntax(query)) {
            return 'attribute';
        }

        // Check for Trilium search operators
        if (this.hasTriliumOperators(query)) {
            return 'keyword';
        }

        // Check if query is very short (better for keyword)
        if (query.trim().split(/\s+/).length <= 2) {
            return 'keyword';
        }

        // Default to semantic for natural language queries
        return 'semantic';
    }

    /**
     * Check if query contains attribute syntax
     */
    private hasAttributeSyntax(query: string): boolean {
        // Look for #label or ~relation syntax
        return /[#~]\w+/.test(query) || query.toLowerCase().includes('label:') || query.toLowerCase().includes('relation:');
    }

    /**
     * Check if query contains Trilium search operators
     */
    private hasTriliumOperators(query: string): boolean {
        const operators = ['note.', 'orderBy:', 'limit:', '>=', '<=', '!=', '*=*'];
        return operators.some(op => query.includes(op));
    }

    /**
     * Perform semantic search using vector similarity
     */
    private async semanticSearch(
        query: string,
        parentNoteId?: string,
        maxResults: number = 10
    ): Promise<SearchResult[]> {
        try {
            // Get vector search tool
            const vectorSearchTool = await this.getVectorSearchTool();
            if (!vectorSearchTool) {
                log.warn('Vector search not available, falling back to keyword search');
                return await this.keywordSearch(query, maxResults, false);
            }

            // Execute semantic search
            const searchStartTime = Date.now();
            const response = await vectorSearchTool.searchNotes(query, parentNoteId, maxResults);
            const matches: Array<any> = response?.matches ?? [];
            const searchDuration = Date.now() - searchStartTime;

            log.info(`Semantic search completed in ${searchDuration}ms, found ${matches.length} matches`);

            // Format results with rich content previews
            const results: SearchResult[] = await Promise.all(
                matches.map(async (match: any) => {
                    const preview = await this.getRichContentPreview(match.noteId);
                    return {
                        noteId: match.noteId,
                        title: match.title || '[Unknown title]',
                        preview: preview,
                        type: match.type || 'text',
                        similarity: Math.round(match.similarity * 100) / 100,
                        dateCreated: match.dateCreated,
                        dateModified: match.dateModified
                    };
                })
            );

            return results;
        } catch (error: any) {
            log.error(`Semantic search error: ${error.message}, falling back to keyword search`);
            try {
                return await this.keywordSearch(query, maxResults, false);
            } catch (fallbackError: any) {
                // Both semantic and keyword search failed - return informative error
                log.error(`Fallback keyword search also failed: ${fallbackError.message}`);
                throw new Error(`Search failed: ${error.message}. Fallback to keyword search also failed: ${fallbackError.message}`);
            }
        }
    }

    /**
     * Perform keyword-based search using Trilium's search service
     */
    private async keywordSearch(
        query: string,
        maxResults: number = 10,
        includeArchived: boolean = false
    ): Promise<SearchResult[]> {
        try {
            const searchStartTime = Date.now();

            // Execute keyword search
            const searchContext = {
                includeArchivedNotes: includeArchived,
                fuzzyAttributeSearch: false
            };

            const searchResults = searchService.searchNotes(query, searchContext);
            const limitedResults = searchResults.slice(0, maxResults);
            const searchDuration = Date.now() - searchStartTime;

            log.info(`Keyword search completed in ${searchDuration}ms, found ${searchResults.length} results`);

            // Format results
            const results: SearchResult[] = limitedResults.map(note => {
                // Get content preview
                let contentPreview = '';
                try {
                    const content = note.getContent();
                    if (typeof content === 'string') {
                        contentPreview = content.length > 200
                            ? content.substring(0, 200) + '...'
                            : content;
                    } else if (Buffer.isBuffer(content)) {
                        contentPreview = '[Binary content]';
                    } else {
                        const strContent = String(content);
                        contentPreview = strContent.substring(0, 200) + (strContent.length > 200 ? '...' : '');
                    }
                } catch (e) {
                    contentPreview = '[Content not available]';
                }

                // Get attributes
                const noteAttributes = note.getOwnedAttributes().map(attr => ({
                    type: attr.type,
                    name: attr.name,
                    value: attr.value
                }));

                return {
                    noteId: note.noteId,
                    title: note.title,
                    preview: contentPreview,
                    type: note.type,
                    attributes: noteAttributes.length > 0 ? noteAttributes : undefined
                };
            });

            return results;
        } catch (error: any) {
            log.error(`Keyword search error: ${error.message}`);
            throw error;
        }
    }

    /**
     * Perform attribute-specific search
     */
    private async attributeSearch(
        query: string,
        maxResults: number = 10
    ): Promise<SearchResult[]> {
        try {
            // Parse the query to extract attribute type, name, and value
            const attrInfo = this.parseAttributeQuery(query);
            if (!attrInfo) {
                // If parsing fails, fall back to keyword search
                return await this.keywordSearch(query, maxResults, false);
            }

            const { attributeType, attributeName, attributeValue } = attrInfo;

            log.info(`Attribute search: type=${attributeType}, name=${attributeName}, value=${attributeValue || 'any'}`);

            const searchStartTime = Date.now();
            let results: BNote[] = [];

            if (attributeType === 'label') {
                results = attributes.getNotesWithLabel(attributeName, attributeValue);
            } else if (attributeType === 'relation') {
                const searchQuery = attributeFormatter.formatAttrForSearch({
                    type: "relation",
                    name: attributeName,
                    value: attributeValue
                }, attributeValue !== undefined);

                results = searchService.searchNotes(searchQuery, {
                    includeArchivedNotes: true,
                    ignoreHoistedNote: true
                });
            }

            const limitedResults = results.slice(0, maxResults);
            const searchDuration = Date.now() - searchStartTime;

            log.info(`Attribute search completed in ${searchDuration}ms, found ${results.length} results`);

            // Format results
            const formattedResults: SearchResult[] = limitedResults.map((note: BNote) => {
                // Get relevant attributes
                const relevantAttributes = note.getOwnedAttributes()
                    .filter(attr => attr.type === attributeType && attr.name === attributeName)
                    .map(attr => ({
                        type: attr.type,
                        name: attr.name,
                        value: attr.value
                    }));

                // Get content preview
                let contentPreview = '';
                try {
                    const content = note.getContent();
                    if (typeof content === 'string') {
                        contentPreview = content.length > 200
                            ? content.substring(0, 200) + '...'
                            : content;
                    } else if (Buffer.isBuffer(content)) {
                        contentPreview = '[Binary content]';
                    } else {
                        const strContent = String(content);
                        contentPreview = strContent.substring(0, 200) + (strContent.length > 200 ? '...' : '');
                    }
                } catch (_) {
                    contentPreview = '[Content not available]';
                }

                return {
                    noteId: note.noteId,
                    title: note.title,
                    preview: contentPreview,
                    type: note.type,
                    attributes: relevantAttributes,
                    dateCreated: note.dateCreated,
                    dateModified: note.dateModified
                };
            });

            return formattedResults;
        } catch (error: any) {
            log.error(`Attribute search error: ${error.message}`);
            throw error;
        }
    }

    /**
     * Parse attribute query to extract type, name, and value
     */
    private parseAttributeQuery(query: string): {
        attributeType: 'label' | 'relation';
        attributeName: string;
        attributeValue?: string;
    } | null {
        // Try to parse #label or ~relation syntax
        const labelMatch = query.match(/#(\w+)(?:=(\S+))?/);
        if (labelMatch) {
            return {
                attributeType: 'label',
                attributeName: labelMatch[1],
                attributeValue: labelMatch[2]
            };
        }

        const relationMatch = query.match(/~(\w+)(?:=(\S+))?/);
        if (relationMatch) {
            return {
                attributeType: 'relation',
                attributeName: relationMatch[1],
                attributeValue: relationMatch[2]
            };
        }

        // Try label: or relation: syntax
        const labelColonMatch = query.match(/label:\s*(\w+)(?:\s*=\s*(\S+))?/i);
        if (labelColonMatch) {
            return {
                attributeType: 'label',
                attributeName: labelColonMatch[1],
                attributeValue: labelColonMatch[2]
            };
        }

        const relationColonMatch = query.match(/relation:\s*(\w+)(?:\s*=\s*(\S+))?/i);
        if (relationColonMatch) {
            return {
                attributeType: 'relation',
                attributeName: relationColonMatch[1],
                attributeValue: relationColonMatch[2]
            };
        }

        return null;
    }

    /**
     * Get rich content preview for a note
     */
    private async getRichContentPreview(noteId: string): Promise<string> {
        try {
            const note = becca.getNote(noteId);
            if (!note) {
                return 'Note not found';
            }

            // Get formatted content
            const formattedContent = await this.contextExtractor.getNoteContent(noteId);
            if (!formattedContent) {
                return 'No content available';
            }

            // Smart truncation
            const previewLength = Math.min(formattedContent.length, 600);
            let preview = formattedContent.substring(0, previewLength);

            if (previewLength < formattedContent.length) {
                // Find natural break point
                const breakPoints = ['. ', '.\n', '\n\n', '\n'];
                for (const breakPoint of breakPoints) {
                    const lastBreak = preview.lastIndexOf(breakPoint);
                    if (lastBreak > previewLength * 0.6) {
                        preview = preview.substring(0, lastBreak + breakPoint.length);
                        break;
                    }
                }
                preview += '...';
            }

            return preview;
        } catch (error) {
            log.error(`Error getting rich content preview: ${error}`);
            return 'Error retrieving content preview';
        }
    }

    /**
     * Get or create vector search tool
     */
    private async getVectorSearchTool(): Promise<any> {
        try {
            let vectorSearchTool = aiServiceManager.getVectorSearchTool();

            if (vectorSearchTool) {
                return vectorSearchTool;
            }

            // Try to initialize
            const agentTools = aiServiceManager.getAgentTools();
            if (agentTools && typeof agentTools.initialize === 'function') {
                try {
                    await agentTools.initialize(true);
                } catch (initError: any) {
                    log.error(`Failed to initialize agent tools: ${initError.message}`);
                    return null;
                }
            } else {
                return null;
            }

            vectorSearchTool = aiServiceManager.getVectorSearchTool();
            return vectorSearchTool;
        } catch (error: any) {
            log.error(`Error getting vector search tool: ${error.message}`);
            return null;
        }
    }
}
