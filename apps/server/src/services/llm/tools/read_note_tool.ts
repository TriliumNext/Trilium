/**
 * Read Note Tool
 *
 * This tool allows the LLM to read the content of a specific note.
 */

import type { Tool, ToolHandler, StandardizedToolResponse } from './tool_interfaces.js';
import { ToolResponseFormatter } from './tool_interfaces.js';
import { ParameterValidationHelpers } from './parameter_validation_helpers.js';
import log from '../../log.js';
import becca from '../../../becca/becca.js';

// Define type for note response
interface NoteResponse {
    noteId: string;
    title: string;
    type: string;
    content: string | Buffer;
    attributes?: Array<{
        name: string;
        value: string;
        type: string;
    }>;
}

// Error type guard
function isError(error: unknown): error is Error {
    return error instanceof Error || (typeof error === 'object' &&
           error !== null && 'message' in error);
}

/**
 * Definition of the read note tool
 */
export const readNoteToolDefinition: Tool = {
    type: 'function',
    function: {
        name: 'read',
        description: 'Get the full content of a note. Use noteId from search results. Examples: read("abc123") → shows complete note content, read("xyz789", true) → includes tags and properties too.',
        parameters: {
            type: 'object',
            properties: {
                noteId: {
                    type: 'string',
                    description: 'Which note to read. Use the noteId from search_notes results, not the note title. Example: "abc123def456"'
                },
                includeAttributes: {
                    type: 'boolean',
                    description: 'Also show tags, properties, and relations attached to this note. Use true to see complete note info, false for just content. Default is false for faster reading.'
                }
            },
            required: ['noteId']
        }
    }
};

/**
 * Read note tool implementation
 */
export class ReadNoteTool implements ToolHandler {
    public definition: Tool = readNoteToolDefinition;

    /**
     * Execute the read note tool with standardized response format
     */
    public async executeStandardized(args: { noteId: string, includeAttributes?: boolean }): Promise<StandardizedToolResponse> {
        const startTime = Date.now();

        try {
            const { noteId, includeAttributes = false } = args;

            log.info(`Executing read_note tool - NoteID: "${noteId}", IncludeAttributes: ${includeAttributes}`);

            // Validate noteId using parameter validation helpers
            const noteIdValidation = ParameterValidationHelpers.validateNoteId(noteId);
            if (noteIdValidation) {
                return noteIdValidation;
            }

            // Get the note from becca
            const note = becca.notes[noteId];

            if (!note) {
                log.info(`Note with ID ${noteId} not found - returning helpful error`);
                return ToolResponseFormatter.noteNotFoundError(noteId);
            }

            log.info(`Found note: "${note.title}" (Type: ${note.type})`);

            // Get note content
            const contentStartTime = Date.now();
            const content = await note.getContent();
            const contentDuration = Date.now() - contentStartTime;

            log.info(`Retrieved note content in ${contentDuration}ms, content length: ${content?.length || 0} chars`);

            // Prepare enhanced response
            const result: NoteResponse & {
                metadata?: {
                    wordCount?: number;
                    hasAttributes?: boolean;
                    lastModified?: string;
                };
            } = {
                noteId: note.noteId,
                title: note.title,
                type: note.type,
                content: content || ''
            };

            // Add helpful metadata
            const contentStr = typeof content === 'string' ? content : String(content || '');
            result.metadata = {
                wordCount: contentStr.split(/\s+/).filter(word => word.length > 0).length,
                hasAttributes: note.getOwnedAttributes().length > 0,
                lastModified: note.dateModified
            };

            // Include attributes if requested
            if (includeAttributes) {
                const attributes = note.getOwnedAttributes();
                log.info(`Including ${attributes.length} attributes in response`);

                result.attributes = attributes.map(attr => ({
                    name: attr.name,
                    value: attr.value,
                    type: attr.type
                }));

                if (attributes.length > 0) {
                    // Log some example attributes
                    attributes.slice(0, 3).forEach((attr, index) => {
                        log.info(`Attribute ${index + 1}: ${attr.name}=${attr.value} (${attr.type})`);
                    });
                }
            }

            const executionTime = Date.now() - startTime;

            // Create next steps guidance
            const nextSteps = {
                suggested: `Use note_update with noteId: "${noteId}" to edit this note's content`,
                alternatives: [
                    'Use search_notes with related concepts to find similar notes',
                    result.metadata.hasAttributes 
                        ? `Use attribute_manager with noteId: "${noteId}" to modify attributes`
                        : `Use attribute_manager with noteId: "${noteId}" to add labels or relations`,
                    'Use create_note to create a related note'
                ],
                examples: [
                    `note_update("${noteId}", "new content")`,
                    `search_notes("${note.title} related")`,
                    `attribute_manager("${noteId}", "add", "tag_name")`
                ]
            };

            return ToolResponseFormatter.success(
                result,
                nextSteps,
                {
                    executionTime,
                    resourcesUsed: ['database', 'content'],
                    contentDuration,
                    contentLength: contentStr.length,
                    includeAttributes
                }
            );

        } catch (error: unknown) {
            const errorMessage = isError(error) ? error.message : String(error);
            log.error(`Error executing read_note tool: ${errorMessage}`);
            
            return ToolResponseFormatter.error(
                `Failed to read note: ${errorMessage}`,
                {
                    possibleCauses: [
                        'Database connectivity issue',
                        'Note content access denied',
                        'Invalid note format'
                    ],
                    suggestions: [
                        'Verify the noteId is correct and exists',
                        'Try reading a different note to test connectivity',
                        'Check if Trilium service is running properly'
                    ],
                    examples: [
                        'search_notes("note title") to find the correct noteId',
                        'Use a noteId from recent search results'
                    ]
                }
            );
        }
    }

    /**
     * Execute the read note tool (legacy method for backward compatibility)
     */
    public async execute(args: { noteId: string, includeAttributes?: boolean }): Promise<string | object> {
        // Delegate to the standardized method
        const standardizedResponse = await this.executeStandardized(args);

        // For backward compatibility, extract the legacy format
        if (standardizedResponse.success) {
            const result = standardizedResponse.result as NoteResponse & {
                metadata?: {
                    wordCount?: number;
                    hasAttributes?: boolean;
                    lastModified?: string;
                };
            };

            // Format as legacy response
            const legacyResponse: NoteResponse & {
                nextSteps?: {
                    modify?: string;
                    related?: string;
                    organize?: string;
                };
                metadata?: {
                    wordCount?: number;
                    hasAttributes?: boolean;
                    lastModified?: string;
                };
            } = {
                noteId: result.noteId,
                title: result.title,
                type: result.type,
                content: result.content,
                metadata: result.metadata
            };

            if (result.attributes) {
                legacyResponse.attributes = result.attributes;
            }

            // Add legacy nextSteps format
            legacyResponse.nextSteps = {
                modify: standardizedResponse.nextSteps.suggested,
                related: standardizedResponse.nextSteps.alternatives?.[0] || 'Use search_notes with related concepts',
                organize: standardizedResponse.nextSteps.alternatives?.[1] || 'Use attribute_manager to add labels'
            };

            return legacyResponse;
        } else {
            // Return legacy error format
            const error = standardizedResponse.error;
            const help = standardizedResponse.help;

            if (error.includes('Note not found')) {
                return {
                    error: error,
                    troubleshooting: {
                        possibleCauses: help.possibleCauses,
                        solutions: help.suggestions
                    }
                };
            } else {
                return `Error: ${error}`;
            }
        }
    }
}
