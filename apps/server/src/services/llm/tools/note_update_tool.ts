/**
 * Note Update Tool
 *
 * This tool allows the LLM to update existing notes in Trilium.
 */

import type { Tool, ToolHandler } from './tool_interfaces.js';
import log from '../../log.js';
import becca from '../../../becca/becca.js';
import notes from '../../notes.js';
import { normalizeTextNoteContent } from './note_content_utils.js';
import { NOTE_WRITE_RULES } from './note_tool_prompt_rules.js';

/**
 * Definition of the note update tool
 */
export const noteUpdateToolDefinition: Tool = {
    type: 'function',
    function: {
        name: 'update_note',
        description: `Update the content or title of an existing note.

${NOTE_WRITE_RULES}`,
        parameters: {
            type: 'object',
            properties: {
                noteId: {
                    type: 'string',
                    description: 'System ID of the note to update (not the title). This is a unique identifier like "abc123def456" that must be used to identify the specific note.'
                },
                title: {
                    type: 'string',
                    description: 'New title for the note (if you want to change it)'
                },
                content: {
                    type: 'string',
                    description: 'New content for the note (if you want to change it). Must match the note type rules in the tool description.'
                },
                mode: {
                    type: 'string',
                    description: 'How to update content: replace (default), append, or prepend',
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
                    const targetTitle = title || note.title;
                    const normalized = normalizeTextNoteContent(content, targetTitle, note.type, note.mime);
                    let newContent = normalized.content;

                    if (normalized.converted) {
                        log.info(`Converted markdown content to HTML for note "${targetTitle}"`);
                    }

                    // For append or prepend modes, get the current content first
                    if (mode === 'append' || mode === 'prepend') {
                        const currentContent = await note.getContent();
                        const currentContentText = typeof currentContent === 'string'
                            ? currentContent
                            : currentContent.toString();

                        if (mode === 'append') {
                            newContent = currentContentText + '\n\n' + newContent;
                            log.info(`Appending content to existing note content`);
                        } else if (mode === 'prepend') {
                            newContent = newContent + '\n\n' + currentContentText;
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
