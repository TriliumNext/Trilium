/**
 * Create Organized Tool - Phase 2.1 Compound Workflow Tool
 *
 * This compound tool combines note_creation + attribute_manager + relationship_tool
 * into a single operation. Perfect for "create a project note tagged #urgent and link it to main project" requests.
 */

import type { Tool, ToolHandler, StandardizedToolResponse, ToolErrorResponse } from './tool_interfaces.js';
import { ToolResponseFormatter } from './tool_interfaces.js';
import log from '../../log.js';
import { NoteCreationTool } from './note_creation_tool.js';
import { AttributeManagerTool } from './attribute_manager_tool.js';
import { RelationshipTool } from './relationship_tool.js';
import { SmartSearchTool } from './smart_search_tool.js';

/**
 * Result structure for create organized operations
 */
interface CreateOrganizedResult {
    createdNote: {
        noteId: string;
        title: string;
        type: string;
        parentId: string;
        contentLength: number;
    };
    organization: {
        attributesAdded: number;
        attributeResults: Array<{
            name: string;
            value?: string;
            success: boolean;
            error?: string;
        }>;
        relationshipsCreated: number;
        relationshipResults: Array<{
            targetNoteId: string;
            targetTitle: string;
            relationName: string;
            success: boolean;
            error?: string;
        }>;
        parentResolved: boolean;
        parentSearch?: {
            query: string;
            found: number;
            selected?: string;
        };
    };
}

/**
 * Definition of the create organized compound tool
 */
export const createOrganizedToolDefinition: Tool = {
    type: 'function',
    function: {
        name: 'create_organized',
        description: 'Create a note with tags, properties, and relationships all in one step. Perfect for "create project note tagged #urgent and link it to main project" requests. Handles complete note organization automatically.',
        parameters: {
            type: 'object',
            properties: {
                title: {
                    type: 'string',
                    description: 'Title for the new note. Examples: "Website Redesign Project", "Client Meeting Notes", "Q4 Planning Document"'
                },
                content: {
                    type: 'string',
                    description: 'Content for the new note. Can be plain text, markdown, or HTML. Examples: "Project overview and goals...", "Meeting agenda:\\n- Budget review\\n- Timeline"'
                },
                tags: {
                    type: 'array',
                    description: 'Tags to apply to the note. Use # prefix or plain names. Examples: ["#urgent", "#project"], ["important", "review"], ["#meeting", "weekly"]',
                    items: {
                        type: 'string',
                        description: 'Tag name with or without # prefix. Examples: "#urgent", "important", "review"'
                    }
                },
                properties: {
                    type: 'object',
                    description: 'Properties to set on the note. Key-value pairs for metadata. Examples: {"priority": "high", "status": "active", "due-date": "2024-01-15", "owner": "john"}'
                },
                parentNote: {
                    type: 'string',
                    description: 'Where to place the note. Can be noteId or search query. Examples: "abc123def456", "project folder", "main project", "meeting notes folder"'
                },
                relatedNotes: {
                    type: 'array',
                    description: 'Notes to create relationships with. Can be noteIds or search queries. Examples: ["xyz789", "main project"], ["project plan", "team members"]',
                    items: {
                        type: 'string',
                        description: 'Note ID or search query to find related notes. Examples: "abc123def456", "project planning", "main document"'
                    }
                },
                relationTypes: {
                    type: 'array',
                    description: 'Types of relationships to create (matches relatedNotes order). Examples: ["depends-on", "part-of"], ["references", "belongs-to"]. Default is "related-to" for all.',
                    items: {
                        type: 'string',
                        description: 'Relationship type. Examples: "depends-on", "references", "belongs-to", "part-of", "related-to"'
                    }
                },
                type: {
                    type: 'string',
                    description: 'Type of note to create. Default is "text" for regular notes.',
                    enum: ['text', 'code', 'file', 'image', 'search', 'relation-map', 'book', 'mermaid', 'canvas']
                }
            },
            required: ['title', 'content']
        }
    }
};

/**
 * Create organized compound tool implementation
 */
export class CreateOrganizedTool implements ToolHandler {
    public definition: Tool = createOrganizedToolDefinition;
    private noteCreationTool: NoteCreationTool;
    private attributeManagerTool: AttributeManagerTool;
    private relationshipTool: RelationshipTool;
    private smartSearchTool: SmartSearchTool;

    constructor() {
        this.noteCreationTool = new NoteCreationTool();
        this.attributeManagerTool = new AttributeManagerTool();
        this.relationshipTool = new RelationshipTool();
        this.smartSearchTool = new SmartSearchTool();
    }

    /**
     * Resolve parent note from ID or search query
     */
    private async resolveParentNote(parentNote?: string): Promise<{
        success: boolean;
        parentNoteId?: string;
        searchInfo?: any;
        error?: string;
    }> {
        if (!parentNote) {
            return { success: true }; // Use root
        }

        // Check if it's already a note ID
        if (parentNote.match(/^[a-zA-Z0-9_]{12}$/)) {
            return { success: true, parentNoteId: parentNote };
        }

        // Search for parent note
        log.info(`Searching for parent note: "${parentNote}"`);
        const searchResponse = await this.smartSearchTool.executeStandardized({
            query: parentNote,
            maxResults: 5,
            forceMethod: 'auto'
        });

        if (!searchResponse.success) {
            return {
                success: false,
                error: `Parent note search failed: ${searchResponse.error}`
            };
        }

        const searchResult = searchResponse.result as any;
        const candidates = searchResult.results || [];

        if (candidates.length === 0) {
            return {
                success: false,
                error: `No parent note found matching "${parentNote}"`,
                searchInfo: { query: parentNote, found: 0 }
            };
        }

        // Use the best match
        const selected = candidates[0];
        log.info(`Selected parent note: "${selected.title}" (${selected.noteId})`);
        
        return {
            success: true,
            parentNoteId: selected.noteId,
            searchInfo: {
                query: parentNote,
                found: candidates.length,
                selected: selected.title
            }
        };
    }

    /**
     * Resolve related notes from IDs or search queries
     */
    private async resolveRelatedNotes(relatedNotes: string[]): Promise<Array<{
        query: string;
        noteId?: string;
        title?: string;
        success: boolean;
        error?: string;
    }>> {
        const results: Array<{
            query: string;
            noteId?: string;
            title?: string;
            success: boolean;
            error?: string;
        }> = [];

        for (const related of relatedNotes) {
            // Check if it's already a note ID
            if (related.match(/^[a-zA-Z0-9_]{12}$/)) {
                results.push({
                    query: related,
                    noteId: related,
                    title: 'Direct ID',
                    success: true
                });
                continue;
            }

            // Search for related note
            try {
                log.info(`Searching for related note: "${related}"`);
                const searchResponse = await this.smartSearchTool.executeStandardized({
                    query: related,
                    maxResults: 3,
                    forceMethod: 'auto'
                });

                if (!searchResponse.success) {
                    results.push({
                        query: related,
                        success: false,
                        error: `Search failed: ${searchResponse.error}`
                    });
                    continue;
                }

                const searchResult = searchResponse.result as any;
                const candidates = searchResult.results || [];

                if (candidates.length === 0) {
                    results.push({
                        query: related,
                        success: false,
                        error: `No notes found matching "${related}"`
                    });
                    continue;
                }

                // Use the best match
                const selected = candidates[0];
                results.push({
                    query: related,
                    noteId: selected.noteId,
                    title: selected.title,
                    success: true
                });
                log.info(`Resolved "${related}" to "${selected.title}" (${selected.noteId})`);

            } catch (error: any) {
                results.push({
                    query: related,
                    success: false,
                    error: error.message || String(error)
                });
            }
        }

        return results;
    }

    /**
     * Execute the create organized compound tool with standardized response format
     */
    public async executeStandardized(args: {
        title: string,
        content: string,
        tags?: string[],
        properties?: Record<string, string>,
        parentNote?: string,
        relatedNotes?: string[],
        relationTypes?: string[],
        type?: string
    }): Promise<StandardizedToolResponse> {
        const startTime = Date.now();

        try {
            const {
                title,
                content,
                tags = [],
                properties = {},
                parentNote,
                relatedNotes = [],
                relationTypes = [],
                type = 'text'
            } = args;

            log.info(`Executing create_organized tool - Title: "${title}", Tags: ${tags.length}, Properties: ${Object.keys(properties).length}, Relations: ${relatedNotes.length}`);

            // Validate input parameters
            if (!title || title.trim().length === 0) {
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

            // Step 1: Resolve parent note
            log.info('Step 1: Resolving parent note placement');
            const parentStartTime = Date.now();
            
            const parentResult = await this.resolveParentNote(parentNote);
            const parentDuration = Date.now() - parentStartTime;

            if (!parentResult.success) {
                return ToolResponseFormatter.error(
                    parentResult.error || 'Failed to resolve parent note',
                    {
                        possibleCauses: [
                            'Parent note search returned no results',
                            'Parent noteId does not exist',
                            'Search terms too specific'
                        ],
                        suggestions: [
                            'Try broader search terms for parent note',
                            'Use smart_search to find parent note first',
                            'Omit parentNote to create under root',
                            'Use exact noteId if you know it'
                        ],
                        examples: [
                            parentNote ? `smart_search("${parentNote}")` : 'smart_search("parent folder")',
                            'create_organized without parentNote for root placement'
                        ]
                    }
                );
            }

            log.info(`Step 1 complete: Parent resolved in ${parentDuration}ms`);

            // Step 2: Create the note
            log.info('Step 2: Creating the note');
            const createStartTime = Date.now();

            const creationResponse = await this.noteCreationTool.executeStandardized({
                title: title.trim(),
                content,
                type,
                parentNoteId: parentResult.parentNoteId
            });

            const createDuration = Date.now() - createStartTime;

            if (!creationResponse.success) {
                return ToolResponseFormatter.error(
                    `Failed to create note: ${creationResponse.error}`,
                    {
                        possibleCauses: [
                            'Database write error',
                            'Invalid note parameters',
                            'Parent note access denied',
                            'Insufficient permissions'
                        ],
                        suggestions: [
                            'Try creating without parentNote (in root)',
                            'Verify parent note is accessible',
                            'Check if Trilium database is accessible',
                            'Try with simpler title or content'
                        ],
                        examples: [
                            `create_note("${title}", "${content.substring(0, 50)}...")`,
                            'create_organized with simpler parameters'
                        ]
                    }
                );
            }

            const newNote = creationResponse.result as any;
            log.info(`Step 2 complete: Created note "${newNote.title}" (${newNote.noteId}) in ${createDuration}ms`);

            // Step 3: Add tags and properties
            log.info(`Step 3: Adding ${tags.length} tags and ${Object.keys(properties).length} properties`);
            const attributeStartTime = Date.now();

            const attributeResults: any[] = [];
            let attributesAdded = 0;

            // Add tags
            for (const tag of tags) {
                try {
                    const tagName = tag.startsWith('#') ? tag : `#${tag}`;
                    const response = await this.attributeManagerTool.executeStandardized({
                        noteId: newNote.noteId,
                        action: 'add',
                        attributeName: tagName
                    });

                    if (response.success) {
                        attributeResults.push({ name: tagName, success: true });
                        attributesAdded++;
                        log.info(`Added tag: ${tagName}`);
                    } else {
                        attributeResults.push({ name: tagName, success: false, error: response.error });
                        log.error(`Failed to add tag ${tagName}: ${response.error}`);
                    }
                } catch (error: any) {
                    const errorMsg = error.message || String(error);
                    attributeResults.push({ name: tag, success: false, error: errorMsg });
                    log.error(`Error adding tag ${tag}: ${errorMsg}`);
                }
            }

            // Add properties
            for (const [propName, propValue] of Object.entries(properties)) {
                try {
                    const response = await this.attributeManagerTool.executeStandardized({
                        noteId: newNote.noteId,
                        action: 'add',
                        attributeName: propName,
                        attributeValue: propValue
                    });

                    if (response.success) {
                        attributeResults.push({ name: propName, value: propValue, success: true });
                        attributesAdded++;
                        log.info(`Added property: ${propName}=${propValue}`);
                    } else {
                        attributeResults.push({ name: propName, value: propValue, success: false, error: response.error });
                        log.error(`Failed to add property ${propName}: ${response.error}`);
                    }
                } catch (error: any) {
                    const errorMsg = error.message || String(error);
                    attributeResults.push({ name: propName, value: propValue, success: false, error: errorMsg });
                    log.error(`Error adding property ${propName}: ${errorMsg}`);
                }
            }

            const attributeDuration = Date.now() - attributeStartTime;
            log.info(`Step 3 complete: Added ${attributesAdded}/${tags.length + Object.keys(properties).length} attributes in ${attributeDuration}ms`);

            // Step 4: Create relationships
            log.info(`Step 4: Creating ${relatedNotes.length} relationships`);
            const relationStartTime = Date.now();

            const relationshipResults: any[] = [];
            let relationshipsCreated = 0;

            if (relatedNotes.length > 0) {
                // Resolve related notes
                const resolvedNotes = await this.resolveRelatedNotes(relatedNotes);

                // Create relationships
                for (let i = 0; i < resolvedNotes.length; i++) {
                    const resolved = resolvedNotes[i];
                    const relationType = relationTypes[i] || 'related-to';

                    if (!resolved.success || !resolved.noteId) {
                        relationshipResults.push({
                            targetNoteId: '',
                            targetTitle: resolved.query,
                            relationName: relationType,
                            success: false,
                            error: resolved.error || 'Failed to resolve target note'
                        });
                        log.error(`Skipping relationship to "${resolved.query}": ${resolved.error}`);
                        continue;
                    }

                    try {
                        const relationResponse = await this.relationshipTool.execute({
                            action: 'create',
                            sourceNoteId: newNote.noteId,
                            targetNoteId: resolved.noteId,
                            relationName: relationType
                        });

                        if (typeof relationResponse === 'object' && relationResponse && 'success' in relationResponse && relationResponse.success) {
                            relationshipResults.push({
                                targetNoteId: resolved.noteId,
                                targetTitle: resolved.title || 'Unknown',
                                relationName: relationType,
                                success: true
                            });
                            relationshipsCreated++;
                            log.info(`Created relationship: ${newNote.title} --${relationType}-> ${resolved.title}`);
                        } else {
                            const errorMsg = typeof relationResponse === 'string' ? relationResponse : 'Unknown relationship error';
                            relationshipResults.push({
                                targetNoteId: resolved.noteId,
                                targetTitle: resolved.title || 'Unknown',
                                relationName: relationType,
                                success: false,
                                error: errorMsg
                            });
                            log.error(`Failed to create relationship to ${resolved.title}: ${errorMsg}`);
                        }
                    } catch (error: any) {
                        const errorMsg = error.message || String(error);
                        relationshipResults.push({
                            targetNoteId: resolved.noteId,
                            targetTitle: resolved.title || 'Unknown',
                            relationName: relationType,
                            success: false,
                            error: errorMsg
                        });
                        log.error(`Error creating relationship to ${resolved.title}: ${errorMsg}`);
                    }
                }
            }

            const relationDuration = Date.now() - relationStartTime;
            log.info(`Step 4 complete: Created ${relationshipsCreated}/${relatedNotes.length} relationships in ${relationDuration}ms`);

            const executionTime = Date.now() - startTime;

            // Create comprehensive result
            const result: CreateOrganizedResult = {
                createdNote: {
                    noteId: newNote.noteId,
                    title: newNote.title,
                    type: newNote.type,
                    parentId: newNote.parentId,
                    contentLength: content.length
                },
                organization: {
                    attributesAdded,
                    attributeResults,
                    relationshipsCreated,
                    relationshipResults,
                    parentResolved: parentResult.success,
                    parentSearch: parentResult.searchInfo
                }
            };

            // Create contextual next steps
            const nextSteps = {
                suggested: `Use read_note with noteId: "${newNote.noteId}" to review the organized note`,
                alternatives: [
                    'Use find_and_read to see the note in context',
                    'Use attribute_manager to add more tags or modify properties',
                    'Use manage_relationships to create additional connections',
                    'Use note_update to modify content'
                ],
                examples: [
                    `read_note("${newNote.noteId}")`,
                    `find_and_read("${title}")`,
                    `attribute_manager("${newNote.noteId}", "add", "#reviewed")`,
                    `note_update("${newNote.noteId}", "additional content", "append")`
                ]
            };

            // Determine if this was a complete success
            const totalOperations = 1 + (tags.length + Object.keys(properties).length) + relatedNotes.length;
            const successfulOperations = 1 + attributesAdded + relationshipsCreated;
            const isCompleteSuccess = successfulOperations === totalOperations;

            return ToolResponseFormatter.success(
                result,
                nextSteps,
                {
                    executionTime,
                    resourcesUsed: ['creation', 'attributes', 'relationships', 'search'],
                    parentDuration,
                    createDuration,
                    attributeDuration,
                    relationDuration,
                    totalOperations,
                    successfulOperations,
                    isCompleteSuccess,
                    parentResolved: parentResult.success,
                    noteCreated: true,
                    attributesRequested: tags.length + Object.keys(properties).length,
                    attributesAdded,
                    relationshipsRequested: relatedNotes.length,
                    relationshipsCreated
                }
            );

        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            log.error(`Error executing create_organized tool: ${errorMessage}`);

            return ToolResponseFormatter.error(
                `Organized note creation failed: ${errorMessage}`,
                {
                    possibleCauses: [
                        'Creation, attribute, or relationship service failure',
                        'Invalid parameters provided',
                        'Database transaction failure',
                        'Search service connectivity issue'
                    ],
                    suggestions: [
                        'Try creating note first, then organize separately',
                        'Use individual operations: create_note, attribute_manager, manage_relationships',
                        'Check if Trilium service is running properly',
                        'Verify all note IDs and search queries are valid'
                    ],
                    examples: [
                        `create_note("${args.title}", "${args.content}")`,
                        'create_organized with simpler parameters',
                        'smart_search to verify related notes exist'
                    ]
                }
            );
        }
    }

    /**
     * Execute the create organized tool (legacy method for backward compatibility)
     */
    public async execute(args: {
        title: string,
        content: string,
        tags?: string[],
        properties?: Record<string, string>,
        parentNote?: string,
        relatedNotes?: string[],
        relationTypes?: string[],
        type?: string
    }): Promise<string | object> {
        const standardizedResponse = await this.executeStandardized(args);

        // For backward compatibility, return the legacy format
        if (standardizedResponse.success) {
            const result = standardizedResponse.result as CreateOrganizedResult;
            const metadata = standardizedResponse.metadata;
            
            return {
                success: true,
                noteId: result.createdNote.noteId,
                title: result.createdNote.title,
                type: result.createdNote.type,
                parentId: result.createdNote.parentId,
                organization: {
                    attributesAdded: result.organization.attributesAdded,
                    relationshipsCreated: result.organization.relationshipsCreated,
                    parentResolved: result.organization.parentResolved
                },
                isCompleteSuccess: metadata.isCompleteSuccess,
                message: `Created organized note "${result.createdNote.title}" with ${result.organization.attributesAdded} attributes and ${result.organization.relationshipsCreated} relationships.`
            };
        } else {
            return `Error: ${standardizedResponse.error}`;
        }
    }
}