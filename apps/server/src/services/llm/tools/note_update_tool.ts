/**
 * Note Update Tool
 *
 * This tool allows the LLM to update existing notes in Trilium.
 */

import type { Tool, ToolHandler } from './tool_interfaces.js';
import { ParameterValidationHelpers } from './parameter_validation_helpers.js';
import log from '../../log.js';
import becca from '../../../becca/becca.js';
import notes from '../../notes.js';

/**
 * Definition of the note update tool
 */
export const noteUpdateToolDefinition: Tool = {
    type: 'function',
    function: {
        name: 'update_note',
        description: 'Modify existing note content or title. Use noteId from search results. Examples: update_note(noteId, content="new text") → replaces content, update_note(noteId, content="addition", mode="append") → adds to end.',
        parameters: {
            type: 'object',
            properties: {
                noteId: {
                    type: 'string',
                    description: 'Which note to update. Use noteId from search results, not the note title. Example: "abc123def456"'
                },
                title: {
                    type: 'string',
                    description: 'New name for the note. Only provide if you want to change the title. Example: "Updated Meeting Notes"'
                },
                content: {
                    type: 'string',
                    description: 'New text for the note. Can be HTML, markdown, or plain text depending on note type. Example: "Updated content here..."'
                },
                mode: {
                    type: 'string',
                    description: 'How to add content: "replace" (default) removes old content, "append" adds to end, "prepend" adds to beginning',
                    enum: ['replace', 'append', 'prepend']
                }
            },
            required: ['noteId']
        }
    }
};

/**
 * Note update tool implementation
 */
export class NoteUpdateTool implements ToolHandler {
    public definition: Tool = noteUpdateToolDefinition;

    /**
     * Execute the note update tool
     */
    public async execute(args: { noteId: string, title?: string, content?: string, mode?: 'replace' | 'append' | 'prepend' }): Promise<string | object> {
        try {
            const { noteId, title, content, mode = 'replace' } = args;

            // Validate noteId using parameter validation helpers
            const noteIdValidation = ParameterValidationHelpers.validateNoteId(noteId);
            if (noteIdValidation) {
                // Convert standardized response to legacy string format for backward compatibility
                return `Error: ${noteIdValidation.error}`;
            }

            if (!title && !content) {
                return 'Error: At least one of title or content must be provided to update a note.';
            }

            log.info(`Executing update_note tool - NoteID: "${noteId}", Mode: ${mode}`);

            // Get the note from becca
            const note = becca.notes[noteId];

            if (!note) {
                log.info(`Note with ID ${noteId} not found - returning error`);
                return `Error: Note with ID ${noteId} not found`;
            }

            log.info(`Found note: "${note.title}" (Type: ${note.type})`);

            let titleUpdateResult;
            let contentUpdateResult;

            // Update title if provided
            if (title && title !== note.title) {
                const titleStartTime = Date.now();

                try {
                    // Update the note title by setting it and saving
                    note.title = title;
                    note.save();

                    const titleDuration = Date.now() - titleStartTime;
                    log.info(`Updated note title to "${title}" in ${titleDuration}ms`);
                    titleUpdateResult = `Title updated from "${note.title}" to "${title}"`;
                } catch (error: any) {
                    log.error(`Error updating note title: ${error.message || String(error)}`);
                    titleUpdateResult = `Failed to update title: ${error.message || 'Unknown error'}`;
                }
            }

            // Update content if provided
            if (content) {
                const contentStartTime = Date.now();

                try {
                    let newContent = content;

                    // For append or prepend modes, get the current content first
                    if (mode === 'append' || mode === 'prepend') {
                        const currentContent = await note.getContent();

                        if (mode === 'append') {
                            newContent = currentContent + '\n\n' + content;
                            log.info(`Appending content to existing note content`);
                        } else if (mode === 'prepend') {
                            newContent = content + '\n\n' + currentContent;
                            log.info(`Prepending content to existing note content`);
                        }
                    }

                    await note.setContent(newContent);
                    const contentDuration = Date.now() - contentStartTime;
                    log.info(`Updated note content in ${contentDuration}ms, new content length: ${newContent.length}`);
                    contentUpdateResult = `Content updated successfully (${mode} mode)`;
                } catch (error: any) {
                    log.error(`Error updating note content: ${error.message || String(error)}`);
                    contentUpdateResult = `Failed to update content: ${error.message || 'Unknown error'}`;
                }
            }

            // Return the results
            return {
                success: true,
                noteId: note.noteId,
                title: note.title,
                titleUpdate: titleUpdateResult || 'No title update requested',
                contentUpdate: contentUpdateResult || 'No content update requested',
                message: `Note "${note.title}" updated successfully`
            };
        } catch (error: any) {
            log.error(`Error executing update_note tool: ${error.message || String(error)}`);
            return `Error: ${error.message || String(error)}`;
        }
    }
}
