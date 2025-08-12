/**
 * Note Creation Tool
 *
 * This tool allows the LLM to create new notes in Trilium.
 */

import type { Tool, ToolHandler, StandardizedToolResponse } from './tool_interfaces.js';
import { ToolResponseFormatter } from './tool_interfaces.js';
import log from '../../log.js';
import becca from '../../../becca/becca.js';
import notes from '../../notes.js';
import attributes from '../../attributes.js';
import type { BNote } from '../../backend_script_entrypoint.js';

/**
 * Definition of the note creation tool
 */
export const noteCreationToolDefinition: Tool = {
    type: 'function',
    function: {
        name: 'create_note',
        description: 'Create a new note with title and content. Returns noteId for further operations. Examples: create_note("Meeting Notes", "Discussion points...") → creates note in root, create_note("Task", "Fix bug", parentNoteId) → creates note inside specific folder.',
        parameters: {
            type: 'object',
            properties: {
                title: {
                    type: 'string',
                    description: 'Name for the new note. Examples: "Meeting Notes", "Project Plan", "Shopping List", "Code Ideas"'
                },
                content: {
                    type: 'string',
                    description: 'What goes inside the note. Can be plain text, markdown, or HTML. Examples: "Meeting agenda:\\n- Topic 1\\n- Topic 2", "This is my note content"'
                },
                parentNoteId: {
                    type: 'string',
                    description: 'Where to create the note. Use noteId from search results, or leave empty for root folder. Example: "abc123def456" places note inside that folder'
                },
                type: {
                    type: 'string',
                    description: 'What kind of note to create. Use "text" for regular notes, "code" for programming content. Default is "text".',
                    enum: ['text', 'code', 'file', 'image', 'search', 'relation-map', 'book', 'mermaid', 'canvas']
                },
                mime: {
                    type: 'string',
                    description: 'Technical format specification. Usually not needed - Trilium will choose automatically. Only specify if you need a specific format like "text/plain" for code or "application/json" for data.'
                },
                attributes: {
                    type: 'array',
                    description: 'Tags and properties to add to the note. Examples: [{"name":"#important"}] adds tag, [{"name":"priority", "value":"high"}] adds property, [{"name":"~template", "value":"noteId123"}] links to template',
                    items: {
                        type: 'object',
                        properties: {
                            name: {
                                type: 'string',
                                description: 'Attribute name. Use "#tagName" for tags, "propertyName" for properties, "~relationName" for relations'
                            },
                            value: {
                                type: 'string',
                                description: 'Attribute value. Optional for tags (use "#tag"), required for properties ("high", "urgent") and relations (use target noteId)'
                            }
                        },
                        required: ['name']
                    }
                }
            },
            required: ['title', 'content']
        }
    }
};

/**
 * Note creation tool implementation
 */
export class NoteCreationTool implements ToolHandler {
    public definition: Tool = noteCreationToolDefinition;

    /**
     * Execute the note creation tool with standardized response format
     */
    public async executeStandardized(args: {
        parentNoteId?: string,
        title: string,
        content: string,
        type?: string,
        mime?: string,
        attributes?: Array<{ name: string, value?: string }>
    }): Promise<StandardizedToolResponse> {
        const startTime = Date.now();

        try {
            const { parentNoteId, title, content, type = 'text', mime } = args;

            log.info(`Executing create_note tool - Title: "${title}", Type: ${type}, ParentNoteId: ${parentNoteId || 'root'}`);

            // Validate required parameters
            if (!title || typeof title !== 'string' || title.trim().length === 0) {
                return ToolResponseFormatter.invalidParameterError(
                    'title',
                    'non-empty string',
                    title
                );
            }

            if (!content || typeof content !== 'string') {
                return ToolResponseFormatter.invalidParameterError(
                    'content',
                    'string',
                    typeof content
                );
            }

            // Validate parent note exists if specified
            let parent: BNote | null = null;
            if (parentNoteId) {
                parent = becca.notes[parentNoteId];
                if (!parent) {
                    return ToolResponseFormatter.error(
                        `Parent note not found: "${parentNoteId}"`,
                        {
                            possibleCauses: [
                                'Invalid parent noteId format',
                                'Parent note was deleted or moved',
                                'Using note title instead of noteId'
                            ],
                            suggestions: [
                                'Use search_notes to find the correct parent note',
                                'Omit parentNoteId to create under root',
                                'Verify the parentNoteId from search results'
                            ],
                            examples: [
                                'search_notes("parent note title") to find parent',
                                'create_note without parentNoteId for root placement'
                            ]
                        }
                    );
                }
            } else {
                // Use root note if no parent specified
                parent = becca.getNote('root');
            }

            // Make sure we have a valid parent at this point
            if (!parent) {
                return ToolResponseFormatter.error(
                    'Failed to get a valid parent note',
                    {
                        possibleCauses: [
                            'Root note is not accessible',
                            'Database connectivity issue'
                        ],
                        suggestions: [
                            'Check if Trilium service is running properly',
                            'Try specifying a valid parentNoteId'
                        ]
                    }
                );
            }

            // Determine the appropriate mime type
            let noteMime = mime;
            if (!noteMime) {
                // Set default mime types based on note type
                switch (type) {
                    case 'text':
                        noteMime = 'text/html';
                        break;
                    case 'code':
                        noteMime = 'text/plain';
                        break;
                    case 'file':
                        noteMime = 'application/octet-stream';
                        break;
                    case 'image':
                        noteMime = 'image/png';
                        break;
                    default:
                        noteMime = 'text/html';
                }
            }

            // Create the note
            const createStartTime = Date.now();
            const result = notes.createNewNote({
                parentNoteId: parent.noteId,
                title: title.trim(),
                content: content,
                type: type as any,
                mime: noteMime
            });
            const noteId = result.note.noteId;
            const createDuration = Date.now() - createStartTime;

            if (!noteId) {
                return ToolResponseFormatter.error(
                    'Failed to create note',
                    {
                        possibleCauses: [
                            'Database write error',
                            'Invalid note parameters',
                            'Insufficient permissions'
                        ],
                        suggestions: [
                            'Check if Trilium database is accessible',
                            'Try with simpler title and content',
                            'Verify note type is supported'
                        ]
                    }
                );
            }

            log.info(`Note created successfully in ${createDuration}ms, ID: ${noteId}`);

            let attributeCount = 0;
            // Add attributes if specified
            if (args.attributes && args.attributes.length > 0) {
                log.info(`Adding ${args.attributes.length} attributes to the note`);

                for (const attr of args.attributes) {
                    if (!attr.name) continue;

                    const attrStartTime = Date.now();
                    try {
                        // Use createLabel for label attributes
                        if (attr.name.startsWith('#') || attr.name.startsWith('~')) {
                            await attributes.createLabel(noteId, attr.name.substring(1), attr.value || '');
                        } else {
                            // Use createRelation for relation attributes if value looks like a note ID
                            if (attr.value && attr.value.match(/^[a-zA-Z0-9_]{12}$/)) {
                                await attributes.createRelation(noteId, attr.name, attr.value);
                            } else {
                                // Default to label for other attributes
                                await attributes.createLabel(noteId, attr.name, attr.value || '');
                            }
                        }
                        attributeCount++;
                        const attrDuration = Date.now() - attrStartTime;
                        log.info(`Added attribute ${attr.name}=${attr.value || ''} in ${attrDuration}ms`);
                    } catch (error) {
                        log.error(`Failed to add attribute ${attr.name}: ${error}`);
                    }
                }
            }

            // Get the created note for response
            const newNote = becca.notes[noteId];
            const executionTime = Date.now() - startTime;

            const noteResult = {
                noteId: noteId,
                title: newNote.title,
                type: newNote.type,
                parentId: parent.noteId,
                attributesAdded: attributeCount
            };

            const nextSteps = {
                suggested: `Use read_note with noteId: "${noteId}" to view the created note`,
                alternatives: [
                    `Use note_update with noteId: "${noteId}" to modify content`,
                    `Use attribute_manager with noteId: "${noteId}" to add more attributes`,
                    'Use create_note to create related notes',
                    'Use search_notes to find the created note later'
                ],
                examples: [
                    `read_note("${noteId}")`,
                    `note_update("${noteId}", "updated content")`,
                    `attribute_manager("${noteId}", "add", "tag_name")`
                ]
            };

            return ToolResponseFormatter.success(
                noteResult,
                nextSteps,
                {
                    executionTime,
                    resourcesUsed: ['database', 'content', 'attributes'],
                    createDuration,
                    attributesProcessed: args.attributes?.length || 0,
                    attributesAdded: attributeCount
                }
            );

        } catch (error: any) {
            const errorMessage = error.message || String(error);
            log.error(`Error executing create_note tool: ${errorMessage}`);
            
            return ToolResponseFormatter.error(
                `Note creation failed: ${errorMessage}`,
                {
                    possibleCauses: [
                        'Database write error',
                        'Invalid parameters provided',
                        'Insufficient system resources'
                    ],
                    suggestions: [
                        'Check if Trilium service is running properly',
                        'Verify all parameters are valid',
                        'Try with simpler content first'
                    ]
                }
            );
        }
    }

    /**
     * Execute the note creation tool (legacy method for backward compatibility)
     */
    public async execute(args: {
        parentNoteId?: string,
        title: string,
        content: string,
        type?: string,
        mime?: string,
        attributes?: Array<{ name: string, value?: string }>
    }): Promise<string | object> {
        // Delegate to the standardized method
        const standardizedResponse = await this.executeStandardized(args);

        // For backward compatibility, return the legacy format
        if (standardizedResponse.success) {
            const result = standardizedResponse.result as any;
            return {
                success: true,
                noteId: result.noteId,
                title: result.title,
                type: result.type,
                message: `Note "${result.title}" created successfully`
            };
        } else {
            return `Error: ${standardizedResponse.error}`;
        }
    }
}
