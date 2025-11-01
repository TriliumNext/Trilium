/**
 * Manage Note Tool (Consolidated)
 *
 * This tool consolidates 5 separate note management tools into a single interface:
 * - read_note_tool (read note content)
 * - note_creation_tool (create new notes)
 * - note_update_tool (update existing notes)
 * - attribute_manager_tool (manage attributes)
 * - relationship_tool (manage relationships)
 *
 * Also removes redundant tools:
 * - note_summarization_tool (LLMs can do this natively)
 * - content_extraction_tool (redundant with read)
 */

import type { Tool, ToolHandler } from '../tool_interfaces.js';
import log from '../../../log.js';
import becca from '../../../../becca/becca.js';
import notes from '../../../notes.js';
import attributes from '../../../attributes.js';
import cloningService from '../../../cloning.js';
import type { BNote } from '../../../backend_script_entrypoint.js';

/**
 * Action types for the manage note tool
 */
type NoteAction =
    | 'read'
    | 'create'
    | 'update'
    | 'delete'
    | 'move'
    | 'clone'
    | 'add_attribute'
    | 'remove_attribute'
    | 'add_relation'
    | 'remove_relation'
    | 'list_attributes'
    | 'list_relations';

/**
 * Attribute definition
 */
interface AttributeDefinition {
    name: string;
    value?: string;
    type?: 'label' | 'relation';
}

/**
 * Relation definition
 */
interface RelationDefinition {
    name: string;
    target_note_id: string;
}

/**
 * Definition of the manage note tool
 */
export const manageNoteToolDefinition: Tool = {
    type: 'function',
    function: {
        name: 'manage_note',
        description: 'Unified interface for all note operations: read, create, update, delete, move, clone, and manage attributes/relations. Replaces separate read, create, update, attribute, and relationship tools.',
        parameters: {
            type: 'object',
            properties: {
                action: {
                    type: 'string',
                    description: 'Operation to perform',
                    enum: ['read', 'create', 'update', 'delete', 'move', 'clone', 'add_attribute', 'remove_attribute', 'add_relation', 'remove_relation', 'list_attributes', 'list_relations']
                },
                note_id: {
                    type: 'string',
                    description: 'Note ID for read/update/delete/attribute operations'
                },
                parent_note_id: {
                    type: 'string',
                    description: 'Parent note ID for create operation (defaults to root)'
                },
                title: {
                    type: 'string',
                    description: 'Note title for create/update operations'
                },
                content: {
                    type: 'string',
                    description: 'Note content for create/update operations'
                },
                note_type: {
                    type: 'string',
                    description: 'Note type (default: text). User-creatable: text, code, book, canvas, mermaid, mindMap, relationMap, webView, render. System types: file, image, search, noteMap, launcher, doc, contentWidget, aiChat.',
                    enum: ['text', 'code', 'book', 'canvas', 'mermaid', 'mindMap', 'relationMap', 'webView', 'render', 'file', 'image', 'search', 'noteMap', 'launcher', 'doc', 'contentWidget', 'aiChat'],
                    default: 'text'
                },
                mime: {
                    type: 'string',
                    description: 'MIME type (optional, auto-detected from note_type)'
                },
                update_mode: {
                    type: 'string',
                    description: 'Content update mode (default: replace)',
                    enum: ['replace', 'append', 'prepend'],
                    default: 'replace'
                },
                attribute_name: {
                    type: 'string',
                    description: 'Attribute name for attribute operations'
                },
                attribute_value: {
                    type: 'string',
                    description: 'Attribute value for attribute operations'
                },
                attribute_type: {
                    type: 'string',
                    description: 'Attribute type: label or relation',
                    enum: ['label', 'relation']
                },
                relation_name: {
                    type: 'string',
                    description: 'Relation name for relation operations'
                },
                target_note_id: {
                    type: 'string',
                    description: 'Target note ID for relation operations'
                },
                include_attributes: {
                    type: 'boolean',
                    description: 'Include attributes in read response (default: false)'
                }
            },
            required: ['action']
        }
    }
};

/**
 * Manage note tool implementation
 */
export class ManageNoteTool implements ToolHandler {
    public definition: Tool = manageNoteToolDefinition;

    /**
     * Execute the manage note tool
     */
    public async execute(args: {
        action: NoteAction;
        note_id?: string;
        parent_note_id?: string;
        title?: string;
        content?: string;
        note_type?: string;
        mime?: string;
        update_mode?: 'replace' | 'append' | 'prepend';
        attribute_name?: string;
        attribute_value?: string;
        attribute_type?: 'label' | 'relation';
        relation_name?: string;
        target_note_id?: string;
        include_attributes?: boolean;
    }): Promise<string | object> {
        try {
            const { action } = args;

            log.info(`Executing manage_note tool - Action: ${action}`);

            // Route to appropriate handler based on action
            switch (action) {
                case 'read':
                    return await this.readNote(args);
                case 'create':
                    return await this.createNote(args);
                case 'update':
                    return await this.updateNote(args);
                case 'delete':
                    return await this.deleteNote(args);
                case 'move':
                    return await this.moveNote(args);
                case 'clone':
                    return await this.cloneNote(args);
                case 'add_attribute':
                    return await this.addAttribute(args);
                case 'remove_attribute':
                    return await this.removeAttribute(args);
                case 'add_relation':
                    return await this.addRelation(args);
                case 'remove_relation':
                    return await this.removeRelation(args);
                case 'list_attributes':
                    return await this.listAttributes(args);
                case 'list_relations':
                    return await this.listRelations(args);
                default:
                    return `Error: Unsupported action "${action}"`;
            }
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            log.error(`Error executing manage_note tool: ${errorMessage}`);
            return `Error: ${errorMessage}`;
        }
    }

    /**
     * Read note content
     */
    private async readNote(args: { note_id?: string; include_attributes?: boolean }): Promise<string | object> {
        const { note_id, include_attributes = false } = args;

        if (!note_id) {
            return 'Error: note_id is required for read action';
        }

        const note = becca.notes[note_id];
        if (!note) {
            return `Error: Note with ID ${note_id} not found`;
        }

        log.info(`Reading note: "${note.title}" (${note.type})`);

        const content = await note.getContent();

        const response: any = {
            noteId: note.noteId,
            title: note.title,
            type: note.type,
            mime: note.mime,
            content: content || '',
            dateCreated: note.dateCreated,
            dateModified: note.dateModified
        };

        if (include_attributes) {
            const noteAttributes = note.getOwnedAttributes();
            response.attributes = noteAttributes.map(attr => ({
                name: attr.name,
                value: attr.value,
                type: attr.type
            }));
        }

        return response;
    }

    /**
     * Create a new note
     */
    private async createNote(args: {
        parent_note_id?: string;
        title?: string;
        content?: string;
        note_type?: string;
        mime?: string;
    }): Promise<string | object> {
        const { parent_note_id, title, content, note_type = 'text', mime } = args;

        if (!title) {
            return 'Error: title is required for create action';
        }

        if (!content) {
            return 'Error: content is required for create action';
        }

        // Business logic validations (not schema validations - those are enforced by LLM provider)
        const MAX_CONTENT_SIZE = 10_000_000; // 10MB
        if (content.length > MAX_CONTENT_SIZE) {
            return `Error: Content exceeds maximum size of 10MB (${content.length} bytes). Consider splitting into multiple notes.`;
        }

        const MAX_TITLE_LENGTH = 200;
        if (title.length > MAX_TITLE_LENGTH) {
            return `Error: Title exceeds maximum length of 200 characters. Current length: ${title.length}. Please shorten the title.`;
        }

        // Validate parent note exists (business logic constraint)
        let parent: BNote | null = null;
        if (parent_note_id) {
            parent = becca.notes[parent_note_id];
            if (!parent) {
                return `Error: Parent note ${parent_note_id} not found. Use smart_search to find valid parent notes.`;
            }
        } else {
            parent = becca.getNote('root');
        }

        if (!parent) {
            return 'Error: Failed to get valid parent note';
        }

        // Determine MIME type
        const noteMime = mime || this.getMimeForType(note_type);

        log.info(`Creating note: "${title}" (${note_type}) under parent ${parent.noteId}`);

        const createStartTime = Date.now();
        const result = notes.createNewNote({
            parentNoteId: parent.noteId,
            title: title,
            content: content,
            type: note_type as any,
            mime: noteMime
        });

        const noteId = result.note.noteId;
        const createDuration = Date.now() - createStartTime;

        log.info(`Note created in ${createDuration}ms: ID=${noteId}`);

        return {
            success: true,
            noteId: noteId,
            title: title,
            type: note_type,
            message: `Note "${title}" created successfully`
        };
    }

    /**
     * Update an existing note
     */
    private async updateNote(args: {
        note_id?: string;
        title?: string;
        content?: string;
        update_mode?: 'replace' | 'append' | 'prepend';
    }): Promise<string | object> {
        const { note_id, title, content, update_mode = 'replace' } = args;

        if (!note_id) {
            return 'Error: note_id is required for update action';
        }

        if (!title && !content) {
            return 'Error: At least one of title or content must be provided';
        }

        const note = becca.notes[note_id];
        if (!note) {
            return `Error: Note with ID ${note_id} not found`;
        }

        log.info(`Updating note: "${note.title}" (${note.type}), mode=${update_mode}`);

        let titleUpdate = 'No title update';
        let contentUpdate = 'No content update';

        // Update title
        if (title && title !== note.title) {
            const oldTitle = note.title;
            note.title = title;
            note.save();
            titleUpdate = `Title updated from "${oldTitle}" to "${title}"`;
            log.info(titleUpdate);
        }

        // Update content
        if (content) {
            let newContent = content;

            if (update_mode === 'append' || update_mode === 'prepend') {
                const currentContent = await note.getContent();

                if (update_mode === 'append') {
                    newContent = currentContent + '\n\n' + content;
                } else {
                    newContent = content + '\n\n' + currentContent;
                }
            }

            await note.setContent(newContent);
            contentUpdate = `Content updated (${update_mode} mode)`;
            log.info(`Content updated: ${newContent.length} characters`);
        }

        return {
            success: true,
            noteId: note.noteId,
            title: note.title,
            titleUpdate: titleUpdate,
            contentUpdate: contentUpdate,
            message: `Note "${note.title}" updated successfully`
        };
    }

    /**
     * Delete a note
     */
    private async deleteNote(args: { note_id?: string }): Promise<string | object> {
        const { note_id } = args;

        if (!note_id) {
            return 'Error: note_id is required for delete action';
        }

        const note = becca.notes[note_id];
        if (!note) {
            return `Error: Note with ID ${note_id} not found`;
        }

        const noteTitle = note.title;
        log.info(`Deleting note: "${noteTitle}" (${note_id})`);

        // Mark note as deleted
        note.isDeleted = true;
        note.save();

        return {
            success: true,
            noteId: note_id,
            title: noteTitle,
            message: `Note "${noteTitle}" deleted successfully`
        };
    }

    /**
     * Move a note to a new parent (creates a new branch)
     * In Trilium, notes can have multiple parents, so "moving" means creating a new branch
     */
    private async moveNote(args: { note_id?: string; parent_note_id?: string }): Promise<string | object> {
        const { note_id, parent_note_id } = args;

        if (!note_id) {
            return 'Error: note_id is required for move action';
        }

        if (!parent_note_id) {
            return 'Error: parent_note_id is required for move action';
        }

        const note = becca.notes[note_id];
        if (!note) {
            return `Error: Note with ID ${note_id} not found`;
        }

        const parentNote = becca.notes[parent_note_id];
        if (!parentNote) {
            return `Error: Parent note with ID ${parent_note_id} not found`;
        }

        log.info(`Moving note "${note.title}" to parent "${parentNote.title}"`);

        // Clone note to new parent (this creates a new branch)
        const startTime = Date.now();
        const cloneResult = cloningService.cloneNoteToParentNote(note_id, parent_note_id);
        const duration = Date.now() - startTime;

        log.info(`Note moved in ${duration}ms - new branch ID: ${cloneResult.branchId}`);

        return {
            success: true,
            noteId: note.noteId,
            title: note.title,
            newParentId: parent_note_id,
            newParentTitle: parentNote.title,
            branchId: cloneResult.branchId,
            message: `Note "${note.title}" moved to "${parentNote.title}" (notes can have multiple parents in Trilium)`
        };
    }

    /**
     * Clone a note (deep copy with all children)
     */
    private async cloneNote(args: { note_id?: string; parent_note_id?: string }): Promise<string | object> {
        const { note_id, parent_note_id } = args;

        if (!note_id) {
            return 'Error: note_id is required for clone action';
        }

        if (!parent_note_id) {
            return 'Error: parent_note_id is required for clone action';
        }

        const note = becca.notes[note_id];
        if (!note) {
            return `Error: Note with ID ${note_id} not found`;
        }

        const parentNote = becca.notes[parent_note_id];
        if (!parentNote) {
            return `Error: Parent note with ID ${parent_note_id} not found`;
        }

        log.info(`Cloning note "${note.title}" to parent "${parentNote.title}"`);

        // Clone note to new parent
        const startTime = Date.now();
        const cloneResult = cloningService.cloneNoteToParentNote(note_id, parent_note_id);
        const duration = Date.now() - startTime;

        log.info(`Note cloned in ${duration}ms - new branch ID: ${cloneResult.branchId}`);

        return {
            success: true,
            sourceNoteId: note.noteId,
            sourceTitle: note.title,
            parentNoteId: parent_note_id,
            parentTitle: parentNote.title,
            branchId: cloneResult.branchId,
            message: `Note "${note.title}" cloned to "${parentNote.title}"`
        };
    }

    /**
     * Add an attribute to a note
     */
    private async addAttribute(args: {
        note_id?: string;
        attribute_name?: string;
        attribute_value?: string;
        attribute_type?: 'label' | 'relation';
    }): Promise<string | object> {
        const { note_id, attribute_name, attribute_value, attribute_type = 'label' } = args;

        if (!note_id) {
            return 'Error: note_id is required for add_attribute action';
        }

        if (!attribute_name) {
            return 'Error: attribute_name is required for add_attribute action';
        }

        const note = becca.notes[note_id];
        if (!note) {
            return `Error: Note with ID ${note_id} not found`;
        }

        log.info(`Adding ${attribute_type} attribute: ${attribute_name}=${attribute_value || ''} to note ${note.title}`);

        // Check if attribute already exists
        const existingAttrs = note.getOwnedAttributes()
            .filter(attr => attr.name === attribute_name && attr.value === (attribute_value || ''));

        if (existingAttrs.length > 0) {
            return {
                success: false,
                message: `Attribute ${attribute_name}=${attribute_value || ''} already exists on note "${note.title}"`
            };
        }

        // Create attribute
        const startTime = Date.now();
        if (attribute_type === 'label') {
            await attributes.createLabel(note_id, attribute_name, attribute_value || '');
        } else {
            if (!attribute_value) {
                return 'Error: attribute_value is required for relation type attributes';
            }
            await attributes.createRelation(note_id, attribute_name, attribute_value);
        }
        const duration = Date.now() - startTime;

        log.info(`Attribute added in ${duration}ms`);

        return {
            success: true,
            noteId: note.noteId,
            title: note.title,
            attributeName: attribute_name,
            attributeValue: attribute_value || '',
            attributeType: attribute_type,
            message: `Added ${attribute_type} ${attribute_name}=${attribute_value || ''} to note "${note.title}"`
        };
    }

    /**
     * Remove an attribute from a note
     */
    private async removeAttribute(args: {
        note_id?: string;
        attribute_name?: string;
        attribute_value?: string;
    }): Promise<string | object> {
        const { note_id, attribute_name, attribute_value } = args;

        if (!note_id) {
            return 'Error: note_id is required for remove_attribute action';
        }

        if (!attribute_name) {
            return 'Error: attribute_name is required for remove_attribute action';
        }

        const note = becca.notes[note_id];
        if (!note) {
            return `Error: Note with ID ${note_id} not found`;
        }

        log.info(`Removing attribute: ${attribute_name} from note ${note.title}`);

        // Find attributes to remove
        const attributesToRemove = note.getOwnedAttributes()
            .filter(attr =>
                attr.name === attribute_name &&
                (attribute_value === undefined || attr.value === attribute_value)
            );

        if (attributesToRemove.length === 0) {
            return {
                success: false,
                message: `Attribute ${attribute_name} not found on note "${note.title}"`
            };
        }

        // Remove attributes
        const startTime = Date.now();
        for (const attr of attributesToRemove) {
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
        const duration = Date.now() - startTime;

        log.info(`Removed ${attributesToRemove.length} attribute(s) in ${duration}ms`);

        return {
            success: true,
            noteId: note.noteId,
            title: note.title,
            attributeName: attribute_name,
            attributesRemoved: attributesToRemove.length,
            message: `Removed ${attributesToRemove.length} attribute(s) from note "${note.title}"`
        };
    }

    /**
     * Add a relation to a note
     */
    private async addRelation(args: {
        note_id?: string;
        relation_name?: string;
        target_note_id?: string;
    }): Promise<string | object> {
        const { note_id, relation_name, target_note_id } = args;

        if (!note_id) {
            return 'Error: note_id is required for add_relation action';
        }

        if (!relation_name) {
            return 'Error: relation_name is required for add_relation action';
        }

        if (!target_note_id) {
            return 'Error: target_note_id is required for add_relation action';
        }

        const note = becca.notes[note_id];
        if (!note) {
            return `Error: Note with ID ${note_id} not found`;
        }

        const targetNote = becca.notes[target_note_id];
        if (!targetNote) {
            return `Error: Target note with ID ${target_note_id} not found`;
        }

        log.info(`Adding relation: ${note.title} -[${relation_name}]-> ${targetNote.title}`);

        // Check if relation already exists
        const existingRelations = note.getRelationTargets(relation_name);
        for (const existingNote of existingRelations) {
            if (existingNote.noteId === target_note_id) {
                return {
                    success: false,
                    message: `Relation ${relation_name} already exists from "${note.title}" to "${targetNote.title}"`
                };
            }
        }

        // Create relation
        const startTime = Date.now();
        await attributes.createRelation(note_id, relation_name, target_note_id);
        const duration = Date.now() - startTime;

        log.info(`Relation created in ${duration}ms`);

        return {
            success: true,
            sourceNoteId: note.noteId,
            sourceTitle: note.title,
            targetNoteId: targetNote.noteId,
            targetTitle: targetNote.title,
            relationName: relation_name,
            message: `Created relation ${relation_name} from "${note.title}" to "${targetNote.title}"`
        };
    }

    /**
     * Remove a relation from a note
     */
    private async removeRelation(args: {
        note_id?: string;
        relation_name?: string;
        target_note_id?: string;
    }): Promise<string | object> {
        const { note_id, relation_name, target_note_id } = args;

        if (!note_id) {
            return 'Error: note_id is required for remove_relation action';
        }

        if (!relation_name) {
            return 'Error: relation_name is required for remove_relation action';
        }

        const note = becca.notes[note_id];
        if (!note) {
            return `Error: Note with ID ${note_id} not found`;
        }

        log.info(`Removing relation: ${relation_name} from note ${note.title}`);

        // Find relations to remove
        const relationsToRemove = note.getAttributes()
            .filter(attr =>
                attr.type === 'relation' &&
                attr.name === relation_name &&
                (target_note_id === undefined || attr.value === target_note_id)
            );

        if (relationsToRemove.length === 0) {
            return {
                success: false,
                message: `Relation ${relation_name} not found on note "${note.title}"`
            };
        }

        // Remove relations
        const startTime = Date.now();
        for (const attr of relationsToRemove) {
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
        const duration = Date.now() - startTime;

        log.info(`Removed ${relationsToRemove.length} relation(s) in ${duration}ms`);

        return {
            success: true,
            noteId: note.noteId,
            title: note.title,
            relationName: relation_name,
            relationsRemoved: relationsToRemove.length,
            message: `Removed ${relationsToRemove.length} relation(s) from note "${note.title}"`
        };
    }

    /**
     * List all attributes for a note
     */
    private async listAttributes(args: { note_id?: string }): Promise<string | object> {
        const { note_id } = args;

        if (!note_id) {
            return 'Error: note_id is required for list_attributes action';
        }

        const note = becca.notes[note_id];
        if (!note) {
            return `Error: Note with ID ${note_id} not found`;
        }

        const noteAttributes = note.getOwnedAttributes()
            .filter(attr => attr.type === 'label');

        log.info(`Listing ${noteAttributes.length} attributes for note "${note.title}"`);

        return {
            success: true,
            noteId: note.noteId,
            title: note.title,
            attributeCount: noteAttributes.length,
            attributes: noteAttributes.map(attr => ({
                name: attr.name,
                value: attr.value,
                type: attr.type
            }))
        };
    }

    /**
     * List all relations for a note
     */
    private async listRelations(args: { note_id?: string }): Promise<string | object> {
        const { note_id } = args;

        if (!note_id) {
            return 'Error: note_id is required for list_relations action';
        }

        const note = becca.notes[note_id];
        if (!note) {
            return `Error: Note with ID ${note_id} not found`;
        }

        // Get outgoing relations
        const outgoingRelations = note.getAttributes()
            .filter(attr => attr.type === 'relation')
            .map(attr => {
                const targetNote = becca.notes[attr.value];
                return {
                    relationName: attr.name,
                    targetNoteId: attr.value,
                    targetTitle: targetNote ? targetNote.title : '[Unknown]',
                    direction: 'outgoing'
                };
            });

        // Get incoming relations
        const incomingRelations = note.getTargetRelations()
            .map(attr => {
                const sourceNote = attr.getNote();
                return {
                    relationName: attr.name,
                    sourceNoteId: sourceNote ? sourceNote.noteId : '[Unknown]',
                    sourceTitle: sourceNote ? sourceNote.title : '[Unknown]',
                    direction: 'incoming'
                };
            });

        log.info(`Found ${outgoingRelations.length} outgoing and ${incomingRelations.length} incoming relations`);

        return {
            success: true,
            noteId: note.noteId,
            title: note.title,
            outgoingRelations: outgoingRelations,
            incomingRelations: incomingRelations,
            message: `Found ${outgoingRelations.length} outgoing and ${incomingRelations.length} incoming relations`
        };
    }

    /**
     * Get default MIME type for note type
     */
    private getMimeForType(noteType: string): string {
        const mimeMap: Record<string, string> = {
            'text': 'text/html',
            'code': 'text/plain',
            'file': 'application/octet-stream',
            'image': 'image/png',
            'search': 'application/json',
            'noteMap': '',
            'relationMap': 'application/json',
            'launcher': '',
            'doc': '',
            'contentWidget': '',
            'render': '',
            'canvas': 'application/json',
            'mermaid': 'text/mermaid',
            'book': 'text/html',
            'webView': '',
            'mindMap': 'application/json',
            'aiChat': 'application/json'
        };

        return mimeMap[noteType] || 'text/html';
    }
}
