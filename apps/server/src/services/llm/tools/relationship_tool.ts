/**
 * Relationship Tool
 *
 * This tool allows the LLM to create, identify, or modify relationships between notes.
 */

import type { Tool, ToolHandler } from './tool_interfaces.js';
import log from '../../log.js';
import becca from '../../../becca/becca.js';
import attributes from '../../attributes.js';
import aiServiceManager from '../ai_service_manager.js';
import { SEARCH_CONSTANTS } from '../constants/search_constants.js';
import searchService from '../../search/services/search.js';
// Define types locally for relationship tool
interface Backlink {
    noteId: string;
    title: string;
    relationName: string;
    sourceNoteId: string;
    sourceTitle: string;
}

interface RelatedNote {
    noteId: string;
    title: string;
    similarity: number;
    relationName: string;
    targetNoteId: string;
    targetTitle: string;
}

interface Suggestion {
    targetNoteId: string;
    targetTitle: string;
    similarity: number;
    suggestedRelation: string;
}

/**
 * Definition of the relationship tool
 */
export const relationshipToolDefinition: Tool = {
    type: 'function',
    function: {
        name: 'manage_relationships',
        description: 'Connect notes with relationships or find related notes. Examples: manage_relationships("create", sourceId, targetId, "depends-on") → links two notes, manage_relationships("find_related", noteId) → finds connected notes.',
        parameters: {
            type: 'object',
            properties: {
                action: {
                    type: 'string',
                    description: 'What to do: "create" links notes, "list" shows connections, "find_related" finds connected notes, "suggest" recommends connections',
                    enum: ['create', 'list', 'find_related', 'suggest']
                },
                sourceNoteId: {
                    type: 'string',
                    description: 'Starting note for the relationship. Use noteId from search results. Example: "abc123def456"'
                },
                targetNoteId: {
                    type: 'string',
                    description: 'Note to connect to. Use noteId from search results. Example: "xyz789ghi012"'
                },
                relationName: {
                    type: 'string',
                    description: 'Type of connection. Examples: "depends-on", "references", "belongs-to", "related-to", "parent-of", "part-of"'
                },
                limit: {
                    type: 'number',
                    description: 'How many relationships to show. Use 5-10 for overview, 20+ for comprehensive view.'
                }
            },
            required: ['action', 'sourceNoteId']
        }
    }
};

/**
 * Relationship tool implementation
 */
export class RelationshipTool implements ToolHandler {
    public definition: Tool = relationshipToolDefinition;

    /**
     * Execute the relationship tool
     */
    public async execute(args: {
        action: 'create' | 'list' | 'find_related' | 'suggest',
        sourceNoteId: string,
        targetNoteId?: string,
        relationName?: string,
        limit?: number
    }): Promise<string | object> {
        try {
            const { action, sourceNoteId, targetNoteId, relationName, limit = 10 } = args;

            log.info(`Executing manage_relationships tool - Action: ${action}, SourceNoteId: ${sourceNoteId}`);

            // Get the source note from becca
            const sourceNote = becca.notes[sourceNoteId];

            if (!sourceNote) {
                log.info(`Source note with ID ${sourceNoteId} not found - returning error`);
                return `Error: Source note with ID ${sourceNoteId} not found`;
            }

            log.info(`Found source note: "${sourceNote.title}" (Type: ${sourceNote.type})`);

            // Handle different actions
            if (action === 'create') {
                return await this.createRelationship(sourceNote, targetNoteId, relationName);
            } else if (action === 'list') {
                return await this.listRelationships(sourceNote, limit);
            } else if (action === 'find_related') {
                return await this.findRelatedNotes(sourceNote, limit);
            } else if (action === 'suggest') {
                return await this.suggestRelationships(sourceNote, limit);
            } else {
                return `Error: Unsupported action "${action}". Supported actions are: create, list, find_related, suggest`;
            }
        } catch (error: any) {
            log.error(`Error executing manage_relationships tool: ${error.message || String(error)}`);
            return `Error: ${error.message || String(error)}`;
        }
    }

    /**
     * Create a relationship between notes
     */
    private async createRelationship(sourceNote: any, targetNoteId?: string, relationName?: string): Promise<object> {
        if (!targetNoteId) {
            return {
                success: false,
                message: 'Target note ID is required for create action'
            };
        }

        if (!relationName) {
            return {
                success: false,
                message: 'Relation name is required for create action'
            };
        }

        // Get the target note from becca
        const targetNote = becca.notes[targetNoteId];

        if (!targetNote) {
            log.info(`Target note with ID ${targetNoteId} not found - returning error`);
            return {
                success: false,
                message: `Target note with ID ${targetNoteId} not found`
            };
        }

        log.info(`Found target note: "${targetNote.title}" (Type: ${targetNote.type})`);

        try {
            // Check if relationship already exists
            const existingRelations = sourceNote.getRelationTargets(relationName);

            for (const existingNote of existingRelations) {
                if (existingNote.noteId === targetNoteId) {
                    log.info(`Relationship ${relationName} already exists from "${sourceNote.title}" to "${targetNote.title}"`);
                    return {
                        success: false,
                        sourceNoteId: sourceNote.noteId,
                        sourceTitle: sourceNote.title,
                        targetNoteId: targetNote.noteId,
                        targetTitle: targetNote.title,
                        relationName: relationName,
                        message: `Relationship ${relationName} already exists from "${sourceNote.title}" to "${targetNote.title}"`
                    };
                }
            }

            // Create the relationship attribute
            const startTime = Date.now();
            await attributes.createRelation(sourceNote.noteId, relationName, targetNote.noteId);
            const duration = Date.now() - startTime;

            log.info(`Created relationship ${relationName} from "${sourceNote.title}" to "${targetNote.title}" in ${duration}ms`);

            return {
                success: true,
                sourceNoteId: sourceNote.noteId,
                sourceTitle: sourceNote.title,
                targetNoteId: targetNote.noteId,
                targetTitle: targetNote.title,
                relationName: relationName,
                message: `Created relationship ${relationName} from "${sourceNote.title}" to "${targetNote.title}"`
            };
        } catch (error: any) {
            log.error(`Error creating relationship: ${error.message || String(error)}`);
            throw error;
        }
    }

    /**
     * List relationships for a note
     */
    private async listRelationships(sourceNote: any, limit: number): Promise<object> {
        try {
            // Get outgoing relationships (where this note is the source)
            const outgoingAttributes = sourceNote.getAttributes()
                .filter((attr: any) => attr.type === 'relation')
                .slice(0, limit);

            const outgoingRelations: RelatedNote[] = [];

            for (const attr of outgoingAttributes) {
                const targetNote = becca.notes[attr.value];

                if (targetNote) {
                    outgoingRelations.push({
                        noteId: targetNote.noteId,
                        title: targetNote.title,
                        similarity: 1.0,
                        relationName: attr.name,
                        targetNoteId: targetNote.noteId,
                        targetTitle: targetNote.title
                    });
                }
            }

            // Get incoming relationships (where this note is the target)
            // Since becca.findNotesWithRelation doesn't exist, use attributes to find notes with relation
            const incomingRelations: Backlink[] = [];

            // Find all attributes of type relation that point to this note
            const relationAttributes = sourceNote.getTargetRelations();

            for (const attr of relationAttributes) {
                if (attr.type === 'relation') {
                    const sourceOfRelation = attr.getNote();

                    if (sourceOfRelation && !sourceOfRelation.isDeleted) {
                        incomingRelations.push({
                            noteId: sourceOfRelation.noteId,
                            title: sourceOfRelation.title,
                            relationName: attr.name,
                            sourceNoteId: sourceOfRelation.noteId,
                            sourceTitle: sourceOfRelation.title
                        });

                        if (incomingRelations.length >= limit) {
                            break;
                        }
                    }
                }
            }

            log.info(`Found ${outgoingRelations.length} outgoing and ${incomingRelations.length} incoming relationships`);

            return {
                success: true,
                noteId: sourceNote.noteId,
                title: sourceNote.title,
                outgoingRelations: outgoingRelations,
                incomingRelations: incomingRelations.slice(0, limit),
                message: `Found ${outgoingRelations.length} outgoing and ${incomingRelations.length} incoming relationships for "${sourceNote.title}"`
            };
        } catch (error: any) {
            log.error(`Error listing relationships: ${error.message || String(error)}`);
            throw error;
        }
    }

    /**
     * Find related notes using TriliumNext's search service
     */
    private async findRelatedNotes(sourceNote: any, limit: number): Promise<object> {
        try {
            log.info(`Using TriliumNext search to find notes related to "${sourceNote.title}"`);

            // Get note content for search
            const content = sourceNote.getContent();
            const title = sourceNote.title;

            // Create search queries from the note title and content
            const searchQueries = [title];

            // Extract key terms from content if available
            if (content && typeof content === 'string') {
                // Extract meaningful words from content (filter out common words)
                const contentWords = content
                    .toLowerCase()
                    .split(/\s+/)
                    .filter(word => word.length > 3)
                    .filter(word => !/^(the|and|but|for|are|from|they|been|have|this|that|with|will|when|where|what|how)$/.test(word))
                    .slice(0, 10); // Take first 10 meaningful words

                if (contentWords.length > 0) {
                    searchQueries.push(contentWords.join(' '));
                }
            }

            // Execute searches and combine results
            const searchStartTime = Date.now();
            const allResults = new Map<string, any>();
            let searchDuration = 0;

            for (const query of searchQueries) {
                try {
                    const results = searchService.searchNotes(query, {
                        includeArchivedNotes: false,
                        fastSearch: false // Use full search for better results
                    });

                    // Add results to our map (avoiding duplicates)
                    for (const note of results.slice(0, limit * 2)) { // Get more to account for duplicates
                        if (note.noteId !== sourceNote.noteId && !note.isDeleted) {
                            allResults.set(note.noteId, {
                                noteId: note.noteId,
                                title: note.title,
                                similarity: 0.8 // Base similarity for search results
                            });
                        }
                    }
                } catch (error) {
                    log.error(`Search query failed: ${query} - ${error}`);
                }
            }

            searchDuration = Date.now() - searchStartTime;

            // Also add notes that are directly related via attributes
            const directlyRelatedNotes = this.getDirectlyRelatedNotes(sourceNote);
            for (const note of directlyRelatedNotes) {
                if (!allResults.has(note.noteId)) {
                    allResults.set(note.noteId, {
                        noteId: note.noteId,
                        title: note.title,
                        similarity: 1.0 // Higher similarity for directly related notes
                    });
                }
            }

            const relatedNotes = Array.from(allResults.values())
                .sort((a, b) => b.similarity - a.similarity) // Sort by similarity
                .slice(0, limit);

            log.info(`Found ${relatedNotes.length} related notes in ${searchDuration}ms`);

            return {
                success: true,
                noteId: sourceNote.noteId,
                title: sourceNote.title,
                relatedNotes: relatedNotes,
                message: `Found ${relatedNotes.length} notes related to "${sourceNote.title}" using search and relationship analysis`
            };
        } catch (error: any) {
            log.error(`Error finding related notes: ${error.message || String(error)}`);
            throw error;
        }
    }

    /**
     * Get notes that are directly related through attributes/relations
     */
    private getDirectlyRelatedNotes(sourceNote: any): any[] {
        const relatedNotes: any[] = [];

        try {
            // Get outgoing relations
            const outgoingAttributes = sourceNote.getAttributes().filter((attr: any) => attr.type === 'relation');
            for (const attr of outgoingAttributes) {
                const targetNote = becca.notes[attr.value];
                if (targetNote && !targetNote.isDeleted) {
                    relatedNotes.push(targetNote);
                }
            }

            // Get incoming relations
            const incomingRelations = sourceNote.getTargetRelations();
            for (const attr of incomingRelations) {
                if (attr.type === 'relation') {
                    const sourceOfRelation = attr.getNote();
                    if (sourceOfRelation && !sourceOfRelation.isDeleted) {
                        relatedNotes.push(sourceOfRelation);
                    }
                }
            }

            // Get parent and child notes
            const parentNotes = sourceNote.getParentNotes();
            for (const parent of parentNotes) {
                if (!parent.isDeleted) {
                    relatedNotes.push(parent);
                }
            }

            const childNotes = sourceNote.getChildNotes();
            for (const child of childNotes) {
                if (!child.isDeleted) {
                    relatedNotes.push(child);
                }
            }

        } catch (error) {
            log.error(`Error getting directly related notes: ${error}`);
        }

        return relatedNotes;
    }

    /**
     * Suggest possible relationships based on content analysis
     */
    private async suggestRelationships(sourceNote: any, limit: number): Promise<object> {
        try {
            // First, find related notes using vector search
            const relatedResult = await this.findRelatedNotes(sourceNote, limit) as any;

            if (!relatedResult.success || !relatedResult.relatedNotes || relatedResult.relatedNotes.length === 0) {
                return {
                    success: false,
                    message: 'Could not find any related notes to suggest relationships'
                };
            }

            // Get the AI service for relationship suggestion
            const aiService = await aiServiceManager.getService();

            log.info(`Using ${aiService.getName()} to suggest relationships for ${relatedResult.relatedNotes.length} related notes`);

            // Get the source note content
            const sourceContent = await sourceNote.getContent();

            // Prepare suggestions
            const suggestions: Suggestion[] = [];

            for (const relatedNote of relatedResult.relatedNotes) {
                try {
                    // Get the target note content
                    const targetNote = becca.notes[relatedNote.noteId];
                    const targetContent = await targetNote.getContent();

                    // Prepare a prompt for the AI service
                    const prompt = `Analyze the relationship between these two notes and suggest a descriptive relation name (like "references", "implements", "depends on", etc.)

SOURCE NOTE: "${sourceNote.title}"
${typeof sourceContent === 'string' ? sourceContent.substring(0, 300) : ''}

TARGET NOTE: "${targetNote.title}"
${typeof targetContent === 'string' ? targetContent.substring(0, 300) : ''}

Suggest the most appropriate relationship type that would connect the source note to the target note. Reply with ONLY the relationship name, nothing else.`;

                    // Get the suggestion
                    const completion = await aiService.generateChatCompletion([
                        {
                            role: 'system',
                            content: 'You analyze the relationship between notes and suggest a concise, descriptive relation name.'
                        },
                        { role: 'user', content: prompt }
                    ], {
                        temperature: SEARCH_CONSTANTS.TEMPERATURE.RELATIONSHIP_TOOL,
                        maxTokens: SEARCH_CONSTANTS.LIMITS.RELATIONSHIP_TOOL_MAX_TOKENS
                    });

                    // Extract just the relation name (remove any formatting or explanation)
                    const relationName = completion.text
                        .replace(/^["']|["']$/g, '') // Remove quotes
                        .replace(/^relationship:|\./gi, '') // Remove prefixes/suffixes
                        .trim();

                    suggestions.push({
                        targetNoteId: relatedNote.noteId,
                        targetTitle: relatedNote.title,
                        similarity: relatedNote.similarity,
                        suggestedRelation: relationName
                    });

                    log.info(`Suggested relationship "${relationName}" from "${sourceNote.title}" to "${targetNote.title}"`);
                } catch (error: any) {
                    log.error(`Error generating suggestion: ${error.message || String(error)}`);
                    // Continue with other suggestions
                }
            }

            return {
                success: true,
                noteId: sourceNote.noteId,
                title: sourceNote.title,
                suggestions: suggestions,
                message: `Generated ${suggestions.length} relationship suggestions for "${sourceNote.title}"`
            };
        } catch (error: any) {
            log.error(`Error suggesting relationships: ${error.message || String(error)}`);
            throw error;
        }
    }
}
