/**
 * Read Note Tool
 *
 * This tool allows the LLM to read the content of a specific note.
 */

import becca from '../../../becca/becca.js';
import log from '../../log.js';
import type { Tool, ToolHandler } from './tool_interfaces.js';

// Define type for note response
interface NoteResponse {
    noteId: string;
    title: string;
    type: string;
    content: string | Uint8Array;
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
        name: 'read_note',
        description: 'Read the content of a specific note by its ID',
        parameters: {
            type: 'object',
            properties: {
                noteId: {
                    type: 'string',
                    description: 'The system ID of the note to read (not the title). This is a unique identifier like "abc123def456" that must be used to access a specific note.'
                },
                includeAttributes: {
                    type: 'boolean',
                    description: 'Whether to include note attributes in the response (default: false)'
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
                log.info(`Note with ID ${noteId} not found - returning error`);
                return `Error: Note with ID ${noteId} not found`;
            }

            log.info(`Found note: "${note.title}" (Type: ${note.type})`);

            // Get note content
            const startTime = Date.now();
            const content = await note.getContent();
            const duration = Date.now() - startTime;

            log.info(`Retrieved note content in ${duration}ms, content length: ${content?.length || 0} chars`);

            // Prepare the response
            const response: NoteResponse = {
                noteId: note.noteId,
                title: note.title,
                type: note.type,
                content: content || ''
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

            return response;
        } catch (error: unknown) {
            const errorMessage = isError(error) ? error.message : String(error);
            log.error(`Error executing read_note tool: ${errorMessage}`);
            return `Error: ${errorMessage}`;
        }
    }
}
