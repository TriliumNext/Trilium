/**
 * Attribute Search Tool
 *
 * This tool allows the LLM to search for notes based specifically on attributes.
 * It's specialized for finding notes with specific labels or relations.
 */

import type { Tool, ToolHandler } from './tool_interfaces.js';
import log from '../../log.js';
import attributes from '../../attributes.js';
import searchService from '../../search/services/search.js';
import attributeFormatter from '../../attribute_formatter.js';
import type BNote from '../../../becca/entities/bnote.js';

/**
 * Definition of the attribute search tool
 */
export const attributeSearchToolDefinition: Tool = {
    type: 'function',
    function: {
        name: 'attribute_search',
        description: 'Search notes by attributes (labels/relations). Finds notes with specific tags, categories, or relationships.',
        parameters: {
            type: 'object',
            properties: {
                attributeType: {
                    type: 'string',
                    description: 'Type of attribute: "label" for tags/categories or "relation" for connections. Case-insensitive.',
                    enum: ['label', 'relation']
                },
                attributeName: {
                    type: 'string',
                    description: 'Name of the attribute (e.g., "important", "todo", "relatedTo").'
                },
                attributeValue: {
                    type: 'string',
                    description: 'Optional value to match. Leave empty to find all notes with this attribute name.'
                },
                maxResults: {
                    type: 'number',
                    description: 'Maximum number of results (default: 20).'
                }
            },
            required: ['attributeType', 'attributeName']
        }
    }
};

/**
 * Attribute search tool implementation
 */
export class AttributeSearchTool implements ToolHandler {
    public definition: Tool = attributeSearchToolDefinition;

    /**
     * Execute the attribute search tool
     */
    public async execute(args: { attributeType: string, attributeName: string, attributeValue?: string, maxResults?: number }): Promise<string | object> {
        try {
            let { attributeType, attributeName, attributeValue, maxResults = 20 } = args;

            // Normalize attributeType to lowercase for case-insensitive handling
            attributeType = attributeType?.toLowerCase();

            log.info(`Executing attribute_search tool - Type: "${attributeType}", Name: "${attributeName}", Value: "${attributeValue || 'any'}", MaxResults: ${maxResults}`);

            // Enhanced validation with helpful guidance
            if (attributeType !== 'label' && attributeType !== 'relation') {
                const suggestions: string[] = [];
                
                // Check for common variations and provide helpful guidance
                if (attributeType?.includes('tag') || attributeType?.includes('category')) {
                    suggestions.push('Use "label" for tags and categories');
                }
                
                if (attributeType?.includes('link') || attributeType?.includes('connection')) {
                    suggestions.push('Use "relation" for links and connections');
                }
                
                const errorMessage = `Invalid attributeType: "${attributeType}". Use "label" for tags/categories or "relation" for connections. Examples: 
- Find tagged notes: {"attributeType": "label", "attributeName": "important"}
- Find related notes: {"attributeType": "relation", "attributeName": "relatedTo"}`;
                
                return errorMessage;
            }

            // Execute the search
            log.info(`Searching for notes with ${attributeType}: ${attributeName}${attributeValue ? ' = ' + attributeValue : ''}`);
            const searchStartTime = Date.now();

            let results: BNote[] = [];

            if (attributeType === 'label') {
                // For labels, we can use the existing getNotesWithLabel function
                results = attributes.getNotesWithLabel(attributeName, attributeValue);
            } else {
                // For relations, we need to build a search query
                const query = attributeFormatter.formatAttrForSearch({
                    type: "relation",
                    name: attributeName,
                    value: attributeValue
                }, attributeValue !== undefined);

                results = searchService.searchNotes(query, {
                    includeArchivedNotes: true,
                    ignoreHoistedNote: true
                });
            }

            // Limit results
            const limitedResults = results.slice(0, maxResults);

            const searchDuration = Date.now() - searchStartTime;

            log.info(`Attribute search completed in ${searchDuration}ms, found ${results.length} matching notes, returning ${limitedResults.length}`);

            if (limitedResults.length > 0) {
                // Log top results
                limitedResults.slice(0, 3).forEach((note: BNote, index: number) => {
                    log.info(`Result ${index + 1}: "${note.title}"`);
                });
            } else {
                log.info(`No notes found with ${attributeType} "${attributeName}"${attributeValue ? ' = ' + attributeValue : ''}`);
            }

            // Format the results
            return {
                count: limitedResults.length,
                totalFound: results.length,
                attributeType,
                attributeName,
                attributeValue,
                results: limitedResults.map((note: BNote) => {
                    // Get relevant attributes of this type
                    const relevantAttributes = note.getOwnedAttributes()
                        .filter(attr => attr.type === attributeType && attr.name === attributeName)
                        .map(attr => ({
                            type: attr.type,
                            name: attr.name,
                            value: attr.value
                        }));

                    // Get a preview of the note content
                    let contentPreview = '';
                    try {
                        const content = note.getContent();
                        if (typeof content === 'string') {
                            contentPreview = content.length > 150 ? content.substring(0, 150) + '...' : content;
                        } else if (Buffer.isBuffer(content)) {
                            contentPreview = '[Binary content]';
                        } else {
                            contentPreview = String(content).substring(0, 150) + (String(content).length > 150 ? '...' : '');
                        }
                    } catch (_) {
                        contentPreview = '[Content not available]';
                    }

                    return {
                        noteId: note.noteId,
                        title: note.title,
                        preview: contentPreview,
                        relevantAttributes: relevantAttributes,
                        type: note.type,
                        dateCreated: note.dateCreated,
                        dateModified: note.dateModified
                    };
                })
            };
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            log.error(`Error executing attribute_search tool: ${errorMessage}`);
            return `Error: ${errorMessage}`;
        }
    }
}
