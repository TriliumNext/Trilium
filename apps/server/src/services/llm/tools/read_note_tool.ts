/**
 * Read Note Tool
 *
 * This tool allows the LLM to read the content of a specific note.
 */

import type { Tool, ToolHandler } from './tool_interfaces.js';
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
        description: 'Read note content. Example: read("noteId123") → returns full content. Use noteIds from search results.',
        parameters: {
            type: 'object',
            properties: {
                noteId: {
                    type: 'string',
                    description: 'The noteId of the note to read (e.g., "abc123def456"). Get this from search results, not note titles.'
                },
                includeAttributes: {
                    type: 'boolean',
                    description: 'Include note attributes/metadata in response (default: false).'
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
     * Execute the read note tool
     */
    public async execute(args: { noteId: string, includeAttributes?: boolean }): Promise<string | object> {
        try {
            const { noteId, includeAttributes = false } = args;

            log.info(`Executing read_note tool - NoteID: "${noteId}", IncludeAttributes: ${includeAttributes}`);

            // Get the note from becca
            const note = becca.notes[noteId];

            if (!note) {
                log.info(`Note with ID ${noteId} not found - returning helpful error`);
                return {
                    error: `Note not found: "${noteId}"`,
                    troubleshooting: {
                        possibleCauses: [
                            'Invalid noteId format (should be like "abc123def456")',
                            'Note may have been deleted or moved',
                            'Using note title instead of noteId'
                        ],
                        solutions: [
                            'Use search_notes to find the note by content or title',
                            'Use keyword_search_notes to find notes with specific text',
                            'Use attribute_search if you know the note has specific attributes',
                            'Ensure you\'re using noteId from search results, not the note title'
                        ]
                    }
                };
            }

            log.info(`Found note: "${note.title}" (Type: ${note.type})`);

            // Get note content
            const startTime = Date.now();
            const content = await note.getContent();
            const duration = Date.now() - startTime;

            log.info(`Retrieved note content in ${duration}ms, content length: ${content?.length || 0} chars`);

            // Prepare enhanced response with next steps
            const response: NoteResponse & {
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
                noteId: note.noteId,
                title: note.title,
                type: note.type,
                content: content || ''
            };

            // Add helpful metadata
            const contentStr = typeof content === 'string' ? content : String(content || '');
            response.metadata = {
                wordCount: contentStr.split(/\s+/).filter(word => word.length > 0).length,
                hasAttributes: note.getOwnedAttributes().length > 0,
                lastModified: note.dateModified
            };

            // Include attributes if requested
            if (includeAttributes) {
                const attributes = note.getOwnedAttributes();
                log.info(`Including ${attributes.length} attributes in response`);

                response.attributes = attributes.map(attr => ({
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

            // Add next steps guidance
            response.nextSteps = {
                modify: `Use note_update with noteId: "${noteId}" to edit this note's content`,
                related: `Use search_notes with related concepts to find similar notes`,
                organize: response.metadata.hasAttributes 
                    ? `Use attribute_manager with noteId: "${noteId}" to modify attributes`
                    : `Use attribute_manager with noteId: "${noteId}" to add labels or relations`
            };

            return response;
        } catch (error: unknown) {
            const errorMessage = isError(error) ? error.message : String(error);
            log.error(`Error executing read_note tool: ${errorMessage}`);
            return `Error: ${errorMessage}`;
        }
    }
}
