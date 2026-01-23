/**
 * List Notes Tool
 *
 * This tool lists child notes under a parent note, useful for
 * "what notes do I have" style questions.
 */

import type { Tool, ToolHandler } from './tool_interfaces.js';
import log from '../../log.js';
import becca from '../../../becca/becca.js';
import BNote from '../../../becca/entities/bnote.js';

const DEFAULT_MAX_RESULTS = 50;

export const listNotesToolDefinition: Tool = {
    type: 'function',
    function: {
        name: 'list_notes',
        description: 'List child notes under a parent note. Use this to show what notes exist at the top level or within a specific branch.',
        parameters: {
            type: 'object',
            properties: {
                parentNoteId: {
                    type: 'string',
                    description: 'System ID of the parent note to list children from. Defaults to the root note.'
                },
                maxResults: {
                    type: 'number',
                    description: `Maximum number of child notes to return (default: ${DEFAULT_MAX_RESULTS})`
                },
                includeArchived: {
                    type: 'boolean',
                    description: 'Whether to include archived notes (default: false)'
                },
                includeHidden: {
                    type: 'boolean',
                    description: 'Whether to include hidden notes (default: false)'
                }
            },
            required: []
        }
    }
};

export class ListNotesTool implements ToolHandler {
    public definition: Tool = listNotesToolDefinition;

    public async execute(args: {
        parentNoteId?: string;
        maxResults?: number;
        includeArchived?: boolean;
        includeHidden?: boolean;
    }): Promise<string | object> {
        try {
            const {
                parentNoteId,
                maxResults = DEFAULT_MAX_RESULTS,
                includeArchived = false,
                includeHidden = false
            } = args;

            const parent: BNote | null = parentNoteId
                ? (becca.notes[parentNoteId] ?? null)
                : becca.getNote('root');

            if (!parent) {
                return `Error: Parent note with ID ${parentNoteId} not found. Please specify a valid parent note ID.`;
            }

            const children = parent.getChildNotes();
            const filtered = children.filter((note) => {
                if (!includeArchived && note.isArchived) {
                    return false;
                }
                if (!includeHidden && note.isHiddenCompletely()) {
                    return false;
                }
                return true;
            });

            const limited = filtered.slice(0, Math.max(0, maxResults));
            const results = limited.map((note) => ({
                noteId: note.noteId,
                title: note.getTitleOrProtected(),
                type: note.type,
                mime: note.mime,
                isArchived: note.isArchived,
                isHidden: note.isHiddenCompletely(),
                childCount: note.getChildNotes().length,
                path: note.getBestNotePathString()
            }));

            log.info(`Listed ${results.length}/${filtered.length} notes under ${parent.noteId}`);

            return {
                parentNoteId: parent.noteId,
                parentTitle: parent.getTitleOrProtected(),
                count: results.length,
                totalFound: filtered.length,
                results
            };
        } catch (error: any) {
            log.error(`Error executing list_notes tool: ${error.message || String(error)}`);
            return `Error: ${error.message || String(error)}`;
        }
    }
}
