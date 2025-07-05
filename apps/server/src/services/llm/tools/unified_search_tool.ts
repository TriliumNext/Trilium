/**
 * Unified Search Tool
 *
 * This tool combines semantic search, keyword search, and attribute search into a single
 * intelligent search interface that automatically routes to the appropriate backend.
 */

import type { Tool, ToolHandler } from './tool_interfaces.js';
import log from '../../log.js';
import { SearchNotesTool } from './search_notes_tool.js';
import { KeywordSearchTool } from './keyword_search_tool.js';
import { AttributeSearchTool } from './attribute_search_tool.js';

/**
 * Definition of the unified search tool
 */
export const unifiedSearchToolDefinition: Tool = {
    type: 'function',
    function: {
        name: 'search',
        description: 'Find notes intelligently. Example: search("machine learning") → finds related notes. Auto-detects search type (semantic/keyword/attribute).',
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'Search query. Can be: conceptual phrases ("machine learning algorithms"), exact terms in quotes ("meeting notes"), labels (#important), relations (~relatedTo), or attribute queries (label:todo)'
                },
                searchType: {
                    type: 'string',
                    description: 'Optional: Force specific search type. Auto-detected if not specified.',
                    enum: ['auto', 'semantic', 'keyword', 'attribute']
                },
                maxResults: {
                    type: 'number',
                    description: 'Maximum results to return (default: 10, max: 50)'
                },
                filters: {
                    type: 'object',
                    description: 'Optional filters for search',
                    properties: {
                        parentNoteId: {
                            type: 'string',
                            description: 'Limit search to children of this note'
                        },
                        includeArchived: {
                            type: 'boolean',
                            description: 'Include archived notes (default: false)'
                        },
                        attributeType: {
                            type: 'string',
                            description: 'For attribute searches: "label" or "relation"'
                        },
                        attributeValue: {
                            type: 'string',
                            description: 'Optional value for attribute searches'
                        }
                    }
                }
            },
            required: ['query']
        }
    }
};

/**
 * Unified search tool implementation
 */
export class UnifiedSearchTool implements ToolHandler {
    public definition: Tool = unifiedSearchToolDefinition;
    private semanticSearchTool: SearchNotesTool;
    private keywordSearchTool: KeywordSearchTool;
    private attributeSearchTool: AttributeSearchTool;

    constructor() {
        this.semanticSearchTool = new SearchNotesTool();
        this.keywordSearchTool = new KeywordSearchTool();
        this.attributeSearchTool = new AttributeSearchTool();
    }

    /**
     * Detect the search type from the query
     */
    private detectSearchType(query: string): 'semantic' | 'keyword' | 'attribute' {
        // Check for attribute patterns
        if (query.startsWith('#') || query.startsWith('~')) {
            return 'attribute';
        }

        // Check for label: or relation: patterns
        if (query.match(/^(label|relation):/i)) {
            return 'attribute';
        }

        // Check for exact phrase searches (quoted strings)
        if (query.includes('"') && query.indexOf('"') !== query.lastIndexOf('"')) {
            return 'keyword';
        }

        // Check for boolean operators
        if (query.match(/\b(AND|OR|NOT)\b/)) {
            return 'keyword';
        }

        // Check for special search operators
        if (query.includes('note.') || query.includes('*=')) {
            return 'keyword';
        }

        // Default to semantic search for natural language queries
        return 'semantic';
    }

    /**
     * Parse attribute search from query
     */
    private parseAttributeSearch(query: string): { type: string, name: string, value?: string } | null {
        // Handle #label or ~relation format
        if (query.startsWith('#')) {
            const parts = query.substring(1).split('=');
            return {
                type: 'label',
                name: parts[0],
                value: parts[1]
            };
        }

        if (query.startsWith('~')) {
            const parts = query.substring(1).split('=');
            return {
                type: 'relation',
                name: parts[0],
                value: parts[1]
            };
        }

        // Handle label:name or relation:name format
        const match = query.match(/^(label|relation):(\w+)(?:=(.+))?$/i);
        if (match) {
            return {
                type: match[1].toLowerCase(),
                name: match[2],
                value: match[3]
            };
        }

        return null;
    }

    /**
     * Execute the unified search tool
     */
    public async execute(args: {
        query: string,
        searchType?: string,
        maxResults?: number,
        filters?: {
            parentNoteId?: string,
            includeArchived?: boolean,
            attributeType?: string,
            attributeValue?: string
        }
    }): Promise<string | object> {
        try {
            const { query, searchType = 'auto', maxResults = 10, filters = {} } = args;

            log.info(`Executing unified search - Query: "${query}", Type: ${searchType}, MaxResults: ${maxResults}`);

            // Detect search type if auto
            let actualSearchType = searchType;
            if (searchType === 'auto') {
                actualSearchType = this.detectSearchType(query);
                log.info(`Auto-detected search type: ${actualSearchType}`);
            }

            // Route to appropriate search tool
            switch (actualSearchType) {
                case 'semantic': {
                    log.info('Routing to semantic search');
                    const result = await this.semanticSearchTool.execute({
                        query,
                        parentNoteId: filters.parentNoteId,
                        maxResults,
                        summarize: false
                    });

                    // Add search type indicator
                    if (typeof result === 'object' && !Array.isArray(result)) {
                        return {
                            ...result,
                            searchMethod: 'semantic',
                            tip: 'For exact matches, try keyword search. For tagged notes, try attribute search.'
                        };
                    }
                    return result;
                }

                case 'keyword': {
                    log.info('Routing to keyword search');
                    const result = await this.keywordSearchTool.execute({
                        query,
                        maxResults,
                        includeArchived: filters.includeArchived || false
                    });

                    // Add search type indicator
                    if (typeof result === 'object' && !Array.isArray(result)) {
                        return {
                            ...result,
                            searchMethod: 'keyword',
                            tip: 'For conceptual matches, try semantic search. For tagged notes, try attribute search.'
                        };
                    }
                    return result;
                }

                case 'attribute': {
                    log.info('Routing to attribute search');
                    
                    // Parse attribute from query if not provided in filters
                    const parsed = this.parseAttributeSearch(query);
                    if (!parsed) {
                        return {
                            error: 'Invalid attribute search format',
                            help: 'Use #labelname, ~relationname, label:name, or relation:name',
                            examples: ['#important', '~relatedTo', 'label:todo', 'relation:partOf=projectX']
                        };
                    }

                    const result = await this.attributeSearchTool.execute({
                        attributeType: filters.attributeType || parsed.type,
                        attributeName: parsed.name,
                        attributeValue: filters.attributeValue || parsed.value,
                        maxResults
                    });

                    // Add search type indicator
                    if (typeof result === 'object' && !Array.isArray(result)) {
                        return {
                            ...result,
                            searchMethod: 'attribute',
                            tip: 'For content matches, try semantic or keyword search.'
                        };
                    }
                    return result;
                }

                default:
                    return {
                        error: `Unknown search type: ${actualSearchType}`,
                        validTypes: ['auto', 'semantic', 'keyword', 'attribute']
                    };
            }
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            log.error(`Error executing unified search: ${errorMessage}`);
            return `Error: ${errorMessage}`;
        }
    }
}