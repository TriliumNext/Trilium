/**
 * Navigate Hierarchy Tool (NEW)
 *
 * This tool provides efficient navigation of Trilium's note hierarchy.
 * Addresses the common "find related notes" use case by traversing the note tree.
 *
 * Supports:
 * - Children: Get child notes
 * - Parents: Get parent notes (notes can have multiple parents)
 * - Ancestors: Get all ancestor notes up to root
 * - Siblings: Get sibling notes (notes sharing the same parent)
 */

import type { Tool, ToolHandler } from '../tool_interfaces.js';
import log from '../../../log.js';
import becca from '../../../../becca/becca.js';
import type BNote from '../../../../becca/entities/bnote.js';

/**
 * Navigation direction types
 */
type NavigationDirection = 'children' | 'parents' | 'ancestors' | 'siblings';

/**
 * Hierarchical note information
 */
interface HierarchyNote {
    noteId: string;
    title: string;
    type: string;
    dateCreated: string;
    dateModified: string;
    level?: number;
    parentId?: string;
    attributes?: Array<{
        name: string;
        value: string;
        type: string;
    }>;
}

/**
 * Definition of the navigate hierarchy tool
 */
export const navigateHierarchyToolDefinition: Tool = {
    type: 'function',
    function: {
        name: 'navigate_hierarchy',
        description: 'Navigate the note tree to find related notes. Get children, parents, ancestors, or siblings of a note.',
        parameters: {
            type: 'object',
            properties: {
                note_id: {
                    type: 'string',
                    description: 'Note ID to navigate from'
                },
                direction: {
                    type: 'string',
                    description: 'Navigation direction: children, parents, ancestors, or siblings',
                    enum: ['children', 'parents', 'ancestors', 'siblings']
                },
                depth: {
                    type: 'number',
                    description: 'Traversal depth for children/ancestors (default: 1, max: 10)'
                },
                include_attributes: {
                    type: 'boolean',
                    description: 'Include note attributes in results (default: false)'
                }
            },
            required: ['note_id', 'direction']
        }
    }
};

/**
 * Navigate hierarchy tool implementation
 */
export class NavigateHierarchyTool implements ToolHandler {
    public definition: Tool = navigateHierarchyToolDefinition;

    /**
     * Execute the navigate hierarchy tool
     */
    public async execute(args: {
        note_id: string;
        direction: NavigationDirection;
        depth?: number;
        include_attributes?: boolean;
    }): Promise<string | object> {
        try {
            const {
                note_id,
                direction,
                depth = 1,
                include_attributes = false
            } = args;

            log.info(`Executing navigate_hierarchy tool - NoteID: ${note_id}, Direction: ${direction}, Depth: ${depth}`);

            // Validate depth
            const validDepth = Math.min(Math.max(1, depth), 10);
            if (validDepth !== depth) {
                log.warn(`Depth ${depth} clamped to valid range [1, 10]: ${validDepth}`);
            }

            // Get the source note
            const note = becca.notes[note_id];
            if (!note) {
                return `Error: Note with ID ${note_id} not found`;
            }

            log.info(`Navigating from note: "${note.title}" (${note.type})`);

            // Execute the appropriate navigation
            let results: HierarchyNote[];
            let message: string;

            switch (direction) {
                case 'children':
                    results = await this.getChildren(note, validDepth, include_attributes);
                    message = `Found ${results.length} child note(s) within depth ${validDepth}`;
                    break;
                case 'parents':
                    results = await this.getParents(note, include_attributes);
                    message = `Found ${results.length} parent note(s)`;
                    break;
                case 'ancestors':
                    results = await this.getAncestors(note, validDepth, include_attributes);
                    message = `Found ${results.length} ancestor note(s) within depth ${validDepth}`;
                    break;
                case 'siblings':
                    results = await this.getSiblings(note, include_attributes);
                    message = `Found ${results.length} sibling note(s)`;
                    break;
                default:
                    return `Error: Unsupported direction "${direction}"`;
            }

            log.info(message);

            return {
                success: true,
                noteId: note.noteId,
                title: note.title,
                direction: direction,
                depth: validDepth,
                count: results.length,
                notes: results,
                message: message
            };
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            log.error(`Error executing navigate_hierarchy tool: ${errorMessage}`);
            return `Error: ${errorMessage}`;
        }
    }

    /**
     * Get child notes recursively up to specified depth
     */
    private async getChildren(
        note: BNote,
        depth: number,
        includeAttributes: boolean,
        currentDepth: number = 0
    ): Promise<HierarchyNote[]> {
        if (currentDepth >= depth) {
            return [];
        }

        const results: HierarchyNote[] = [];
        const childNotes = note.getChildNotes();

        for (const child of childNotes) {
            if (child.isDeleted) {
                continue;
            }

            // Add current child
            results.push(this.formatNote(child, includeAttributes, currentDepth + 1, note.noteId));

            // Recursively get children if depth allows
            if (currentDepth + 1 < depth) {
                const grandchildren = await this.getChildren(child, depth, includeAttributes, currentDepth + 1);
                results.push(...grandchildren);
            }
        }

        return results;
    }

    /**
     * Get parent notes
     */
    private async getParents(note: BNote, includeAttributes: boolean): Promise<HierarchyNote[]> {
        const results: HierarchyNote[] = [];
        const parentNotes = note.getParentNotes();

        for (const parent of parentNotes) {
            if (parent.isDeleted) {
                continue;
            }

            results.push(this.formatNote(parent, includeAttributes));
        }

        return results;
    }

    /**
     * Get ancestor notes up to specified depth or root
     */
    private async getAncestors(
        note: BNote,
        depth: number,
        includeAttributes: boolean,
        currentDepth: number = 0,
        visited: Set<string> = new Set()
    ): Promise<HierarchyNote[]> {
        if (currentDepth >= depth) {
            return [];
        }

        // Prevent cycles in the tree
        if (visited.has(note.noteId)) {
            return [];
        }

        visited.add(note.noteId);

        const results: HierarchyNote[] = [];
        const parentNotes = note.getParentNotes();

        for (const parent of parentNotes) {
            if (parent.isDeleted || parent.noteId === 'root') {
                continue;
            }

            // Add current parent
            results.push(this.formatNote(parent, includeAttributes, currentDepth + 1));

            // Recursively get ancestors if depth allows
            if (currentDepth + 1 < depth) {
                const grandparents = await this.getAncestors(parent, depth, includeAttributes, currentDepth + 1, visited);
                results.push(...grandparents);
            }
        }

        return results;
    }

    /**
     * Get sibling notes (notes sharing the same parent)
     */
    private async getSiblings(note: BNote, includeAttributes: boolean): Promise<HierarchyNote[]> {
        const results: HierarchyNote[] = [];
        const parentNotes = note.getParentNotes();

        // Use a Set to track unique siblings (notes can appear multiple times if they share multiple parents)
        const uniqueSiblings = new Set<string>();

        for (const parent of parentNotes) {
            if (parent.isDeleted) {
                continue;
            }

            const childNotes = parent.getChildNotes();

            for (const child of childNotes) {
                // Skip the note itself, deleted notes, and duplicates
                if (child.noteId === note.noteId || child.isDeleted || uniqueSiblings.has(child.noteId)) {
                    continue;
                }

                uniqueSiblings.add(child.noteId);
                results.push(this.formatNote(child, includeAttributes, undefined, parent.noteId));
            }
        }

        return results;
    }

    /**
     * Format a note for output
     */
    private formatNote(
        note: BNote,
        includeAttributes: boolean,
        level?: number,
        parentId?: string
    ): HierarchyNote {
        const formatted: HierarchyNote = {
            noteId: note.noteId,
            title: note.title,
            type: note.type,
            dateCreated: note.dateCreated,
            dateModified: note.dateModified
        };

        if (level !== undefined) {
            formatted.level = level;
        }

        if (parentId !== undefined) {
            formatted.parentId = parentId;
        }

        if (includeAttributes) {
            const noteAttributes = note.getOwnedAttributes();
            formatted.attributes = noteAttributes.map(attr => ({
                name: attr.name,
                value: attr.value,
                type: attr.type
            }));
        }

        return formatted;
    }
}
