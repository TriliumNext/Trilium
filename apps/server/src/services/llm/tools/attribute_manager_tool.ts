/**
 * Attribute Manager Tool
 *
 * This tool allows the LLM to add, remove, or modify note attributes in Trilium.
 */

import type { Tool, ToolHandler, StandardizedToolResponse } from './tool_interfaces.js';
import { ToolResponseFormatter } from './tool_interfaces.js';
import log from '../../log.js';
import becca from '../../../becca/becca.js';
import attributes from '../../attributes.js';

// Define a custom error type guard
function isError(error: unknown): error is Error {
    return error instanceof Error || (typeof error === 'object' &&
           error !== null && 'message' in error);
}

/**
 * Definition of the attribute manager tool
 */
export const attributeManagerToolDefinition: Tool = {
    type: 'function',
    function: {
        name: 'manage_attributes',
        description: 'Manage tags, properties, and relations on notes. Add tags like #important, set properties like priority=high, or create relations. Examples: manage_attributes(noteId, "add", "#urgent") → adds urgent tag, manage_attributes(noteId, "list") → shows all tags and properties.',
        parameters: {
            type: 'object',
            properties: {
                noteId: {
                    type: 'string',
                    description: 'Which note to work with. Use noteId from search results. Example: "abc123def456"'
                },
                action: {
                    type: 'string',
                    description: 'What to do: "add" creates new attribute, "remove" deletes attribute, "update" changes value, "list" shows all current attributes',
                    enum: ['add', 'remove', 'update', 'list']
                },
                attributeName: {
                    type: 'string',
                    description: 'Name of tag or property. Use "#tagname" for tags (like #important, #todo), plain names for properties (like priority, status, due-date). For relations use "~relationname".'
                },
                attributeValue: {
                    type: 'string',
                    description: 'Value for properties and relations. Tags don\'t need values. Examples: "high" for priority property, "2024-01-15" for due-date, target noteId for relations.'
                }
            },
            required: ['noteId', 'action']
        }
    }
};

/**
 * Attribute manager tool implementation
 */
export class AttributeManagerTool implements ToolHandler {
    public definition: Tool = attributeManagerToolDefinition;

    /**
     * Execute the attribute manager tool with standardized response format
     */
    public async executeStandardized(args: { noteId: string, action: string, attributeName?: string, attributeValue?: string }): Promise<StandardizedToolResponse> {
        const startTime = Date.now();

        try {
            const { noteId, action, attributeName, attributeValue } = args;

            log.info(`Executing manage_attributes tool - NoteID: "${noteId}", Action: ${action}, AttributeName: ${attributeName || 'not specified'}`);

            // Validate required parameters
            if (!noteId || typeof noteId !== 'string') {
                return ToolResponseFormatter.invalidParameterError(
                    'noteId',
                    'valid note ID like "abc123def456"',
                    noteId
                );
            }

            if (!action || typeof action !== 'string') {
                return ToolResponseFormatter.invalidParameterError(
                    'action',
                    'one of: add, remove, update, list',
                    action
                );
            }

            const validActions = ['add', 'remove', 'update', 'list'];
            if (!validActions.includes(action)) {
                return ToolResponseFormatter.invalidParameterError(
                    'action',
                    'one of: add, remove, update, list',
                    action
                );
            }

            // Get the note from becca
            const note = becca.notes[noteId];

            if (!note) {
                log.info(`Note with ID ${noteId} not found - returning error`);
                return ToolResponseFormatter.noteNotFoundError(noteId);
            }

            log.info(`Found note: "${note.title}" (Type: ${note.type})`);

            // List all existing attributes
            if (action === 'list') {
                const noteAttributes = note.getOwnedAttributes();
                log.info(`Listing ${noteAttributes.length} attributes for note "${note.title}"`);

                const formattedAttributes = noteAttributes.map(attr => ({
                    name: attr.name,
                    value: attr.value,
                    type: attr.type
                }));

                const executionTime = Date.now() - startTime;

                const result = {
                    noteId: note.noteId,
                    title: note.title,
                    attributeCount: noteAttributes.length,
                    attributes: formattedAttributes
                };

                const nextSteps = {
                    suggested: noteAttributes.length > 0 
                        ? `Use manage_attributes with action "update" to modify existing attributes`
                        : `Use manage_attributes with action "add" to add new attributes`,
                    alternatives: [
                        'Use create_note to create related notes with attributes',
                        'Use search_notes to find notes with similar attributes',
                        'Use read_note to view the full note content'
                    ],
                    examples: [
                        `manage_attributes("${noteId}", "add", "#tag_name")`,
                        `manage_attributes("${noteId}", "update", "priority", "high")`,
                        `search_notes("#${noteAttributes[0]?.name || 'tag'}")`
                    ]
                };

                return ToolResponseFormatter.success(
                    result,
                    nextSteps,
                    {
                        executionTime,
                        resourcesUsed: ['database'],
                        action: 'list'
                    }
                );
            }

            // For other actions, attribute name is required
            if (!attributeName) {
                return ToolResponseFormatter.invalidParameterError(
                    'attributeName',
                    'attribute name (required for add, remove, and update actions)',
                    attributeName
                );
            }

            // Perform the requested action
            if (action === 'add') {
                return await this.handleAddAttribute(note, attributeName, startTime, attributeValue);
            } else if (action === 'remove') {
                return await this.handleRemoveAttribute(note, attributeName, startTime, attributeValue);
            } else if (action === 'update') {
                return await this.handleUpdateAttribute(note, attributeName, startTime, attributeValue);
            }

            return ToolResponseFormatter.error(
                `Unsupported action: "${action}"`,
                {
                    possibleCauses: [
                        'Invalid action parameter provided'
                    ],
                    suggestions: [
                        'Use one of the supported actions: add, remove, update, list'
                    ],
                    examples: [
                        'manage_attributes(noteId, "add", "#tag")',
                        'manage_attributes(noteId, "list")'
                    ]
                }
            );

        } catch (error: unknown) {
            const errorMessage = isError(error) ? error.message : String(error);
            log.error(`Error executing manage_attributes tool: ${errorMessage}`);
            
            return ToolResponseFormatter.error(
                `Attribute management failed: ${errorMessage}`,
                {
                    possibleCauses: [
                        'Database connectivity issue',
                        'Invalid attribute parameters',
                        'Permission denied'
                    ],
                    suggestions: [
                        'Check if Trilium service is running properly',
                        'Verify attribute names are valid',
                        'Try with simpler attribute values'
                    ]
                }
            );
        }
    }

    private async handleAddAttribute(note: any, attributeName: string, startTime: number, attributeValue?: string): Promise<StandardizedToolResponse> {
        try {
            const actionStartTime = Date.now();

            // For label-type attributes (starting with #), no value is needed
            const isLabel = attributeName.startsWith('#');
            const value = isLabel ? '' : (attributeValue || '');

            // Check if attribute already exists
            const existingAttrs = note.getOwnedAttributes()
                .filter((attr: any) => attr.name === attributeName && attr.value === value);

            if (existingAttrs.length > 0) {
                log.info(`Attribute ${attributeName}=${value} already exists on note "${note.title}"`);
                return ToolResponseFormatter.error(
                    `Attribute already exists: ${attributeName}=${value || ''}`,
                    {
                        possibleCauses: [
                            'Attribute with same name and value already exists',
                            'Duplicate attribute addition attempted'
                        ],
                        suggestions: [
                            'Use "update" action to change the attribute value',
                            'Use "list" action to view existing attributes',
                            'Choose a different attribute name or value'
                        ],
                        examples: [
                            `manage_attributes("${note.noteId}", "update", "${attributeName}", "new_value")`,
                            `manage_attributes("${note.noteId}", "list")`
                        ]
                    }
                );
            }

            // Create the attribute
            await attributes.createLabel(note.noteId, attributeName, value);
            const actionDuration = Date.now() - actionStartTime;
            const executionTime = Date.now() - startTime;

            log.info(`Added attribute ${attributeName}=${value || ''} in ${actionDuration}ms`);

            const result = {
                noteId: note.noteId,
                title: note.title,
                action: 'add' as const,
                attributeName: attributeName,
                attributeValue: value
            };

            const nextSteps = {
                suggested: `Use manage_attributes("${note.noteId}", "list") to view all attributes`,
                alternatives: [
                    `Use read_note("${note.noteId}") to view the full note with attributes`,
                    'Use manage_attributes to add more attributes',
                    'Use search_notes to find notes with similar attributes'
                ],
                examples: [
                    `manage_attributes("${note.noteId}", "list")`,
                    `search_notes("#${attributeName}")`
                ]
            };

            return ToolResponseFormatter.success(
                result,
                nextSteps,
                {
                    executionTime,
                    resourcesUsed: ['database', 'attributes'],
                    action: 'add',
                    actionDuration
                }
            );

        } catch (error: unknown) {
            const errorMessage = isError(error) ? error.message : String(error);
            log.error(`Error adding attribute: ${errorMessage}`);
            
            return ToolResponseFormatter.error(
                `Failed to add attribute: ${errorMessage}`,
                {
                    possibleCauses: [
                        'Invalid attribute name format',
                        'Database write error',
                        'Attribute name contains invalid characters'
                    ],
                    suggestions: [
                        'Verify attribute name follows Trilium conventions',
                        'Try with a simpler attribute name',
                        'Check if database is accessible'
                    ],
                    examples: [
                        'Use names like "#tag" for labels',
                        'Use names like "priority" for valued attributes'
                    ]
                }
            );
        }
    }

    private async handleRemoveAttribute(note: any, attributeName: string, startTime: number, attributeValue?: string): Promise<StandardizedToolResponse> {
        try {
            const actionStartTime = Date.now();

            // Find the attribute to remove
            const attributesToRemove = note.getOwnedAttributes()
                .filter((attr: any) => attr.name === attributeName &&
                    (attributeValue === undefined || attr.value === attributeValue));

            if (attributesToRemove.length === 0) {
                log.info(`Attribute ${attributeName} not found on note "${note.title}"`);
                return ToolResponseFormatter.error(
                    `Attribute not found: ${attributeName}`,
                    {
                        possibleCauses: [
                            'Attribute does not exist on this note',
                            'Attribute name spelled incorrectly',
                            'Attribute value mismatch (if specified)'
                        ],
                        suggestions: [
                            `Use manage_attributes("${note.noteId}", "list") to view existing attributes`,
                            'Check attribute name spelling',
                            'Remove attributeValue parameter to delete all attributes with this name'
                        ],
                        examples: [
                            `manage_attributes("${note.noteId}", "list")`,
                            `manage_attributes("${note.noteId}", "remove", "${attributeName}")`
                        ]
                    }
                );
            }

            // Remove all matching attributes
            for (const attr of attributesToRemove) {
                // Delete attribute by recreating it with isDeleted flag
                const attrToDelete = {
                    attributeId: attr.attributeId,
                    noteId: attr.noteId,
                    type: attr.type,
                    name: attr.name,
                    value: attr.value,
                    isDeleted: true,
                    position: attr.position,
                    utcDateModified: new Date().toISOString()
                };
                await attributes.createAttribute(attrToDelete);
            }

            const actionDuration = Date.now() - actionStartTime;
            const executionTime = Date.now() - startTime;
            log.info(`Removed ${attributesToRemove.length} attribute(s) in ${actionDuration}ms`);

            const result = {
                noteId: note.noteId,
                title: note.title,
                action: 'remove' as const,
                attributeName: attributeName,
                attributesRemoved: attributesToRemove.length
            };

            const nextSteps = {
                suggested: `Use manage_attributes("${note.noteId}", "list") to verify attribute removal`,
                alternatives: [
                    'Use manage_attributes to add new attributes',
                    `Use read_note("${note.noteId}") to view the updated note`,
                    'Use search_notes to find notes with remaining attributes'
                ],
                examples: [
                    `manage_attributes("${note.noteId}", "list")`,
                    `manage_attributes("${note.noteId}", "add", "#new_tag")`
                ]
            };

            return ToolResponseFormatter.success(
                result,
                nextSteps,
                {
                    executionTime,
                    resourcesUsed: ['database', 'attributes'],
                    action: 'remove',
                    actionDuration,
                    attributesRemoved: attributesToRemove.length
                }
            );

        } catch (error: unknown) {
            const errorMessage = isError(error) ? error.message : String(error);
            log.error(`Error removing attribute: ${errorMessage}`);
            
            return ToolResponseFormatter.error(
                `Failed to remove attribute: ${errorMessage}`,
                {
                    possibleCauses: [
                        'Database write error',
                        'Attribute deletion failed',
                        'Invalid attribute reference'
                    ],
                    suggestions: [
                        'Check if database is accessible',
                        'Try listing attributes first to verify they exist',
                        'Ensure Trilium service is running properly'
                    ]
                }
            );
        }
    }

    private async handleUpdateAttribute(note: any, attributeName: string, startTime: number, attributeValue?: string): Promise<StandardizedToolResponse> {
        try {
            const actionStartTime = Date.now();

            if (attributeValue === undefined) {
                return ToolResponseFormatter.invalidParameterError(
                    'attributeValue',
                    'value for the attribute (required for update action)',
                    attributeValue
                );
            }

            // Find the attribute to update
            const attributesToUpdate = note.getOwnedAttributes()
                .filter((attr: any) => attr.name === attributeName);

            if (attributesToUpdate.length === 0) {
                log.info(`Attribute ${attributeName} not found on note "${note.title}"`);
                return ToolResponseFormatter.error(
                    `Attribute not found: ${attributeName}`,
                    {
                        possibleCauses: [
                            'Attribute does not exist on this note',
                            'Attribute name spelled incorrectly'
                        ],
                        suggestions: [
                            `Use manage_attributes("${note.noteId}", "list") to view existing attributes`,
                            `Use manage_attributes("${note.noteId}", "add", "${attributeName}", "${attributeValue}") to create new attribute`,
                            'Check attribute name spelling'
                        ],
                        examples: [
                            `manage_attributes("${note.noteId}", "list")`,
                            `manage_attributes("${note.noteId}", "add", "${attributeName}", "${attributeValue}")`
                        ]
                    }
                );
            }

            // Update all matching attributes
            for (const attr of attributesToUpdate) {
                // Update by recreating with the same ID but new value
                const attrToUpdate = {
                    attributeId: attr.attributeId,
                    noteId: attr.noteId,
                    type: attr.type,
                    name: attr.name,
                    value: attributeValue,
                    isDeleted: false,
                    position: attr.position,
                    utcDateModified: new Date().toISOString()
                };
                await attributes.createAttribute(attrToUpdate);
            }

            const actionDuration = Date.now() - actionStartTime;
            const executionTime = Date.now() - startTime;
            log.info(`Updated ${attributesToUpdate.length} attribute(s) in ${actionDuration}ms`);

            const result = {
                noteId: note.noteId,
                title: note.title,
                action: 'update' as const,
                attributeName: attributeName,
                attributeValue: attributeValue,
                attributesUpdated: attributesToUpdate.length
            };

            const nextSteps = {
                suggested: `Use manage_attributes("${note.noteId}", "list") to verify attribute update`,
                alternatives: [
                    `Use read_note("${note.noteId}") to view the updated note`,
                    'Use manage_attributes to update other attributes',
                    'Use search_notes to find notes with similar attributes'
                ],
                examples: [
                    `manage_attributes("${note.noteId}", "list")`,
                    `search_notes("${attributeName}:${attributeValue}")`
                ]
            };

            return ToolResponseFormatter.success(
                result,
                nextSteps,
                {
                    executionTime,
                    resourcesUsed: ['database', 'attributes'],
                    action: 'update',
                    actionDuration,
                    attributesUpdated: attributesToUpdate.length
                }
            );

        } catch (error: unknown) {
            const errorMessage = isError(error) ? error.message : String(error);
            log.error(`Error updating attribute: ${errorMessage}`);
            
            return ToolResponseFormatter.error(
                `Failed to update attribute: ${errorMessage}`,
                {
                    possibleCauses: [
                        'Database write error',
                        'Invalid attribute value',
                        'Attribute update conflict'
                    ],
                    suggestions: [
                        'Check if database is accessible',
                        'Try with a simpler attribute value',
                        'Verify attribute exists before updating'
                    ]
                }
            );
        }
    }

    /**
     * Execute the attribute manager tool (legacy method for backward compatibility)
     */
    public async execute(args: { noteId: string, action: string, attributeName?: string, attributeValue?: string }): Promise<string | object> {
        // Delegate to the standardized method
        const standardizedResponse = await this.executeStandardized(args);

        // For backward compatibility, return the legacy format
        if (standardizedResponse.success) {
            const result = standardizedResponse.result as any;
            
            if (args.action === 'list') {
                return {
                    success: true,
                    noteId: result.noteId,
                    title: result.title,
                    attributeCount: result.attributeCount,
                    attributes: result.attributes
                };
            } else if (args.action === 'add') {
                return {
                    success: true,
                    noteId: result.noteId,
                    title: result.title,
                    action: result.action,
                    attributeName: result.attributeName,
                    attributeValue: result.attributeValue,
                    message: `Added attribute ${result.attributeName}=${result.attributeValue || ''} to note "${result.title}"`
                };
            } else if (args.action === 'remove') {
                return {
                    success: true,
                    noteId: result.noteId,
                    title: result.title,
                    action: result.action,
                    attributeName: result.attributeName,
                    attributesRemoved: result.attributesRemoved,
                    message: `Removed ${result.attributesRemoved} attribute(s) from note "${result.title}"`
                };
            } else if (args.action === 'update') {
                return {
                    success: true,
                    noteId: result.noteId,
                    title: result.title,
                    action: result.action,
                    attributeName: result.attributeName,
                    attributeValue: result.attributeValue,
                    attributesUpdated: result.attributesUpdated,
                    message: `Updated ${result.attributesUpdated} attribute(s) on note "${result.title}"`
                };
            } else {
                return {
                    success: true,
                    ...result
                };
            }
        } else {
            // Return legacy error format
            const error = standardizedResponse.error;
            
            if (error.includes('not found')) {
                return {
                    success: false,
                    message: error
                };
            } else {
                return `Error: ${error}`;
            }
        }
    }
}
