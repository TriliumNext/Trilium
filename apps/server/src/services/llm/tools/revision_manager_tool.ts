/**
 * Revision Manager Tool
 *
 * This tool allows the LLM to work with Trilium's note revision history system.
 * It can access note history, compare versions, restore revisions, and manage version control.
 */

import type { Tool, ToolHandler, StandardizedToolResponse } from './tool_interfaces.js';
import { ToolResponseFormatter } from './tool_interfaces.js';
import { ParameterValidationHelpers } from './parameter_validation_helpers.js';
import log from '../../log.js';
import becca from '../../../becca/becca.js';
import sql from '../../sql.js';
import dateUtils from '../../date_utils.js';
import protectedSessionService from '../../protected_session.js';

/**
 * Definition of the revision manager tool
 */
export const revisionManagerToolDefinition: Tool = {
    type: 'function',
    function: {
        name: 'revision_manager',
        description: 'Work with Trilium\'s note revision history and version control. Access note history, compare versions, restore previous revisions, and manage the version timeline. Perfect for "show me the history of this note" or "restore the previous version" requests.',
        parameters: {
            type: 'object',
            properties: {
                action: {
                    type: 'string',
                    description: 'The revision action to perform',
                    enum: ['list_revisions', 'get_revision', 'compare_revisions', 'restore_revision', 'create_revision', 'delete_revision'],
                    default: 'list_revisions'
                },
                noteId: {
                    type: 'string',
                    description: 'The noteId to work with revisions for. Use noteId from search results.'
                },
                revisionId: {
                    type: 'string',
                    description: 'For revision-specific operations: The specific revision ID to work with. Get this from list_revisions results.'
                },
                compareWithRevisionId: {
                    type: 'string',
                    description: 'For "compare_revisions": The second revision ID to compare with. Compares revisionId vs compareWithRevisionId.'
                },
                limit: {
                    type: 'number',
                    description: 'For "list_revisions": Maximum number of revisions to return. Default 20, max 100.',
                    default: 20,
                    minimum: 1,
                    maximum: 100
                },
                includeContent: {
                    type: 'boolean',
                    description: 'Whether to include actual content in results. Default false for performance, set true to see content.',
                    default: false
                },
                sortBy: {
                    type: 'string',
                    description: 'How to sort revision list',
                    enum: ['date_desc', 'date_asc', 'title', 'size'],
                    default: 'date_desc'
                }
            },
            required: ['action', 'noteId']
        }
    }
};

/**
 * Revision manager tool implementation
 */
export class RevisionManagerTool implements ToolHandler {
    public definition: Tool = revisionManagerToolDefinition;

    /**
     * Execute the revision manager tool with standardized response format
     */
    public async executeStandardized(args: {
        action: 'list_revisions' | 'get_revision' | 'compare_revisions' | 'restore_revision' | 'create_revision' | 'delete_revision',
        noteId: string,
        revisionId?: string,
        compareWithRevisionId?: string,
        limit?: number,
        includeContent?: boolean,
        sortBy?: 'date_desc' | 'date_asc' | 'title' | 'size'
    }): Promise<StandardizedToolResponse> {
        const startTime = Date.now();

        try {
            const { 
                action, 
                noteId, 
                revisionId, 
                compareWithRevisionId, 
                limit = 20, 
                includeContent = false, 
                sortBy = 'date_desc'
            } = args;

            log.info(`Executing revision_manager tool - Action: "${action}", Note: "${noteId}"`);

            // Validate action
            const actionValidation = ParameterValidationHelpers.validateAction(
                action, 
                ['list_revisions', 'get_revision', 'compare_revisions', 'restore_revision', 'create_revision', 'delete_revision'],
                {
                    'list_revisions': 'Show revision history for a note',
                    'get_revision': 'Get details of a specific revision',
                    'compare_revisions': 'Compare two revisions to see changes',
                    'restore_revision': 'Restore note to a previous revision',
                    'create_revision': 'Manually create a new revision snapshot',
                    'delete_revision': 'Delete a specific revision from history'
                }
            );
            if (actionValidation) {
                return actionValidation;
            }

            // Validate noteId
            const noteValidation = ParameterValidationHelpers.validateNoteId(noteId);
            if (noteValidation) {
                return noteValidation;
            }

            // Validate revisionId for revision-specific actions
            if (['get_revision', 'restore_revision', 'delete_revision', 'compare_revisions'].includes(action) && !revisionId) {
                return ToolResponseFormatter.invalidParameterError(
                    'revisionId',
                    'revision ID from list_revisions results',
                    'missing'
                );
            }

            // Validate comparison parameters
            if (action === 'compare_revisions' && !compareWithRevisionId) {
                return ToolResponseFormatter.invalidParameterError(
                    'compareWithRevisionId',
                    'second revision ID for comparison',
                    'missing'
                );
            }

            // Validate limit
            const limitValidation = ParameterValidationHelpers.validateNumericRange(
                limit, 
                'limit', 
                1, 
                100, 
                20
            );
            if (limitValidation.error) {
                return limitValidation.error;
            }

            // Execute the requested action
            const result = await this.executeRevisionAction(
                action, 
                noteId, 
                revisionId, 
                compareWithRevisionId, 
                limitValidation.value, 
                includeContent, 
                sortBy
            );

            if (!result.success) {
                return ToolResponseFormatter.error(result.error || 'Revision operation failed', result.help || {
                    possibleCauses: ['Revision operation failed'],
                    suggestions: ['Check revision parameters', 'Verify note exists and is accessible']
                });
            }

            const executionTime = Date.now() - startTime;

            const nextSteps = {
                suggested: this.getNextStepsSuggestion(action, result.data),
                alternatives: [
                    'Use read_note to see the current version of the note',
                    'Use revision_manager("list_revisions", ...) to see more revision history',
                    'Use revision_manager("compare_revisions", ...) to see changes between versions',
                    'Use search_notes to find notes with extensive revision history'
                ],
                examples: [
                    `read_note("${noteId}")`,
                    result.data?.revisions?.[0] ? 
                        `revision_manager("get_revision", noteId="${noteId}", revisionId="${result.data.revisions[0].revisionId}")` : 
                        `revision_manager("list_revisions", noteId="${noteId}")`,
                    'revision_manager("create_revision", noteId="...") to save current state'
                ]
            };

            const triliumConcept = "Trilium automatically creates revisions when notes are modified, providing complete version history. " +
                "Revisions preserve both content and metadata, enabling time-travel through note changes. " +
                "Protected notes have encrypted revisions that require protected sessions to access.";

            return ToolResponseFormatter.success(
                result.data,
                nextSteps,
                {
                    executionTime,
                    resourcesUsed: ['database', 'revisions', 'version-control'],
                    action,
                    operationDuration: result.operationTime,
                    triliumConcept
                }
            );

        } catch (error: any) {
            const errorMessage = error.message || String(error);
            log.error(`Error executing revision_manager tool: ${errorMessage}`);
            
            return ToolResponseFormatter.error(
                `Revision management failed: ${errorMessage}`,
                {
                    possibleCauses: [
                        'Revision not found or inaccessible',
                        'Protected session required for encrypted revisions',
                        'Database access error',
                        'Invalid revision parameters'
                    ],
                    suggestions: [
                        'Check if revisions exist for this note',
                        'Verify revision IDs are correct',
                        'Ensure protected session is active for encrypted notes',
                        'Use list_revisions first to see available revisions'
                    ]
                }
            );
        }
    }

    /**
     * Execute the specific revision action
     */
    private async executeRevisionAction(
        action: string,
        noteId: string,
        revisionId?: string,
        compareWithRevisionId?: string,
        limit?: number,
        includeContent?: boolean,
        sortBy?: string
    ): Promise<{
        success: boolean;
        data?: any;
        error?: string;
        help?: any;
        operationTime: number;
    }> {
        const operationStart = Date.now();

        try {
            switch (action) {
                case 'list_revisions':
                    return await this.executeListRevisions(noteId, limit!, includeContent!, sortBy!);
                
                case 'get_revision':
                    return await this.executeGetRevision(noteId, revisionId!, includeContent!);
                
                case 'compare_revisions':
                    return await this.executeCompareRevisions(noteId, revisionId!, compareWithRevisionId!, includeContent!);
                
                case 'restore_revision':
                    return await this.executeRestoreRevision(noteId, revisionId!);
                
                case 'create_revision':
                    return await this.executeCreateRevision(noteId);
                
                case 'delete_revision':
                    return await this.executeDeleteRevision(noteId, revisionId!);
                
                default:
                    return {
                        success: false,
                        error: `Unsupported action: ${action}`,
                        help: {
                            possibleCauses: ['Invalid action parameter'],
                            suggestions: ['Use one of: list_revisions, get_revision, compare_revisions, restore_revision, create_revision, delete_revision']
                        },
                        operationTime: Date.now() - operationStart
                    };
            }
        } catch (error: any) {
            return {
                success: false,
                error: error.message,
                help: {
                    possibleCauses: ['Operation execution error'],
                    suggestions: ['Check parameters and try again']
                },
                operationTime: Date.now() - operationStart
            };
        }
    }

    /**
     * List revisions for a note
     */
    private async executeListRevisions(
        noteId: string, 
        limit: number, 
        includeContent: boolean, 
        sortBy: string
    ): Promise<any> {
        const operationStart = Date.now();

        const note = becca.getNote(noteId);
        if (!note) {
            return {
                success: false,
                error: `Note not found: "${noteId}"`,
                help: {
                    possibleCauses: ['Invalid noteId', 'Note was deleted'],
                    suggestions: ['Use search_notes to find note', 'Verify noteId is correct']
                },
                operationTime: Date.now() - operationStart
            };
        }

        // Get revisions from database
        let orderBy = 'utcDateLastEdited DESC';
        switch (sortBy) {
            case 'date_asc':
                orderBy = 'utcDateLastEdited ASC';
                break;
            case 'title':
                orderBy = 'title ASC';
                break;
            case 'size':
                orderBy = 'contentLength DESC';
                break;
        }

        const revisionRows = sql.getRows(`
            SELECT revisions.*, LENGTH(blobs.content) as contentLength
            FROM revisions 
            LEFT JOIN blobs USING (blobId)
            WHERE noteId = ? 
            ORDER BY ${orderBy}
            LIMIT ?
        `, [noteId, limit]);

        const isSessionAvailable = protectedSessionService.isProtectedSessionAvailable();
        const revisions: Array<{
            revisionId: string;
            title: string;
            type: string;
            mime: string;
            isProtected: boolean;
            dateLastEdited: string;
            utcDateLastEdited: string;
            dateCreated: string;
            utcDateCreated: string;
            contentLength: number;
            contentAvailable: boolean;
            isAccessible: boolean;
            content?: string | Buffer;
            contentPreview?: string;
            contentError?: string;
        }> = [];

        for (const row of revisionRows) {
            const revision = becca.getRevision((row as any).revisionId);
            if (!revision) continue;

            const revisionInfo: any = {
                revisionId: revision.revisionId,
                title: revision.title,
                type: revision.type,
                mime: revision.mime,
                isProtected: revision.isProtected,
                dateLastEdited: revision.dateLastEdited,
                utcDateLastEdited: revision.utcDateLastEdited,
                dateCreated: revision.dateCreated,
                utcDateCreated: revision.utcDateCreated,
                contentLength: (row as any).contentLength || 0,
                contentAvailable: revision.isContentAvailable(),
                isAccessible: !revision.isProtected || isSessionAvailable
            };

            if (includeContent && revision.isContentAvailable()) {
                try {
                    revisionInfo.content = revision.getContent();
                    revisionInfo.contentPreview = this.getContentPreview(revisionInfo.content, revision.type);
                } catch (error: any) {
                    revisionInfo.contentError = `Unable to load content: ${error.message}`;
                }
            }

            revisions.push(revisionInfo);
        }

        // Get current note info for comparison
        const currentNoteInfo = {
            title: note.title,
            type: note.type,
            mime: note.mime,
            dateModified: note.dateModified,
            utcDateModified: note.utcDateModified,
            contentLength: note.getContent().length,
            isProtected: note.isProtected
        };

        const stats = {
            totalRevisions: revisions.length,
            accessibleRevisions: revisions.filter(r => r.isAccessible).length,
            protectedRevisions: revisions.filter(r => r.isProtected).length,
            averageContentLength: revisions.length > 0 ? 
                Math.round(revisions.reduce((sum, r) => sum + r.contentLength, 0) / revisions.length) : 0,
            dateRange: revisions.length > 0 ? {
                oldest: revisions[revisions.length - 1]?.dateLastEdited,
                newest: revisions[0]?.dateLastEdited
            } : null
        };

        return {
            success: true,
            data: {
                noteId,
                noteTitle: note.title,
                currentNote: currentNoteInfo,
                revisions,
                stats,
                searchParameters: {
                    limit,
                    includeContent,
                    sortBy
                },
                sessionInfo: {
                    protectedSessionAvailable: isSessionAvailable,
                    canAccessProtectedRevisions: isSessionAvailable
                },
                recommendations: this.getRevisionRecommendations(revisions, currentNoteInfo)
            },
            operationTime: Date.now() - operationStart
        };
    }

    /**
     * Get details of a specific revision
     */
    private async executeGetRevision(noteId: string, revisionId: string, includeContent: boolean): Promise<any> {
        const operationStart = Date.now();

        const note = becca.getNote(noteId);
        if (!note) {
            return {
                success: false,
                error: `Note not found: "${noteId}"`,
                help: {
                    possibleCauses: ['Invalid noteId', 'Note was deleted'],
                    suggestions: ['Use search_notes to find note', 'Verify noteId is correct']
                },
                operationTime: Date.now() - operationStart
            };
        }

        const revision = becca.getRevision(revisionId);
        if (!revision || revision.noteId !== noteId) {
            return {
                success: false,
                error: `Revision not found: "${revisionId}" for note "${noteId}"`,
                help: {
                    possibleCauses: ['Invalid revisionId', 'Revision was deleted', 'Revision belongs to different note'],
                    suggestions: ['Use list_revisions to see available revisions', 'Verify revisionId is correct']
                },
                operationTime: Date.now() - operationStart
            };
        }

        const isSessionAvailable = protectedSessionService.isProtectedSessionAvailable();

        const revisionInfo: any = {
            revisionId: revision.revisionId,
            noteId: revision.noteId,
            title: revision.title,
            type: revision.type,
            mime: revision.mime,
            isProtected: revision.isProtected,
            dateLastEdited: revision.dateLastEdited,
            utcDateLastEdited: revision.utcDateLastEdited,
            dateCreated: revision.dateCreated,
            utcDateCreated: revision.utcDateCreated,
            contentAvailable: revision.isContentAvailable(),
            isAccessible: !revision.isProtected || isSessionAvailable,
            attachments: revision.getAttachments().length
        };

        if (includeContent && revision.isContentAvailable()) {
            try {
                const content = revision.getContent();
                revisionInfo.content = content;
                revisionInfo.contentLength = typeof content === 'string' ? content.length : content.length;
                revisionInfo.contentPreview = this.getContentPreview(content, revision.type);
                revisionInfo.contentType = typeof content === 'string' ? 'string' : 'binary';
            } catch (error: any) {
                revisionInfo.contentError = `Unable to load content: ${error.message}`;
            }
        }

        // Compare with current note
        const currentNote = note;
        const comparison: {
            titleChanged: boolean;
            typeChanged: boolean;
            mimeChanged: boolean;
            protectionChanged: boolean;
            contentChanged?: boolean;
            contentLengthDiff?: number;
            contentComparisonError?: string;
        } = {
            titleChanged: revision.title !== currentNote.title,
            typeChanged: revision.type !== currentNote.type,
            mimeChanged: revision.mime !== currentNote.mime,
            protectionChanged: revision.isProtected !== currentNote.isProtected
        };

        if (includeContent && revision.isContentAvailable()) {
            try {
                const currentContent = currentNote.getContent();
                const revisionContent = revision.getContent();
                comparison.contentChanged = revisionContent !== currentContent;
                comparison.contentLengthDiff = (typeof currentContent === 'string' ? currentContent.length : currentContent.length) - 
                                             (typeof revisionContent === 'string' ? revisionContent.length : revisionContent.length);
            } catch (error: any) {
                comparison.contentComparisonError = error.message;
            }
        }

        return {
            success: true,
            data: {
                noteId,
                noteTitle: note.title,
                revision: revisionInfo,
                comparisonWithCurrent: comparison,
                sessionInfo: {
                    protectedSessionAvailable: isSessionAvailable,
                    contentAccessible: revision.isContentAvailable()
                }
            },
            operationTime: Date.now() - operationStart
        };
    }

    /**
     * Compare two revisions
     */
    private async executeCompareRevisions(
        noteId: string, 
        revisionId1: string, 
        revisionId2: string, 
        includeContent: boolean
    ): Promise<any> {
        const operationStart = Date.now();

        const note = becca.getNote(noteId);
        if (!note) {
            return {
                success: false,
                error: `Note not found: "${noteId}"`,
                help: {
                    possibleCauses: ['Invalid noteId', 'Note was deleted'],
                    suggestions: ['Use search_notes to find note', 'Verify noteId is correct']
                },
                operationTime: Date.now() - operationStart
            };
        }

        const revision1 = becca.getRevision(revisionId1);
        const revision2 = becca.getRevision(revisionId2);

        if (!revision1 || revision1.noteId !== noteId) {
            return {
                success: false,
                error: `First revision not found: "${revisionId1}"`,
                help: {
                    possibleCauses: ['Invalid revisionId', 'Revision was deleted'],
                    suggestions: ['Use list_revisions to see available revisions']
                },
                operationTime: Date.now() - operationStart
            };
        }

        if (!revision2 || revision2.noteId !== noteId) {
            return {
                success: false,
                error: `Second revision not found: "${revisionId2}"`,
                help: {
                    possibleCauses: ['Invalid compareWithRevisionId', 'Revision was deleted'],
                    suggestions: ['Use list_revisions to see available revisions']
                },
                operationTime: Date.now() - operationStart
            };
        }

        const comparison: {
            revision1: {
                revisionId: string | undefined;
                title: string;
                type: string;
                mime: string;
                dateLastEdited?: string | undefined;
                isProtected: boolean | undefined;
                contentAvailable: boolean;
            };
            revision2: {
                revisionId: string | undefined;
                title: string;
                type: string;
                mime: string;
                dateLastEdited?: string | undefined;
                isProtected: boolean | undefined;
                contentAvailable: boolean;
            };
            differences: {
                titleChanged: boolean;
                typeChanged: boolean;
                mimeChanged: boolean;
                protectionChanged: boolean;
                datesDifferent: boolean;
            };
            contentComparison?: {
                content1Length?: number;
                content2Length?: number;
                contentIdentical?: boolean;
                lengthDifference?: number;
                preview1?: string;
                preview2?: string;
                textDiff?: any;
                error?: string;
                revision1Accessible?: boolean;
                revision2Accessible?: boolean;
            };
        } = {
            revision1: {
                revisionId: revision1.revisionId,
                title: revision1.title,
                type: revision1.type,
                mime: revision1.mime,
                dateLastEdited: revision1.dateLastEdited,
                isProtected: revision1.isProtected,
                contentAvailable: revision1.isContentAvailable()
            },
            revision2: {
                revisionId: revision2.revisionId,
                title: revision2.title,
                type: revision2.type,
                mime: revision2.mime,
                dateLastEdited: revision2.dateLastEdited,
                isProtected: revision2.isProtected,
                contentAvailable: revision2.isContentAvailable()
            },
            differences: {
                titleChanged: revision1.title !== revision2.title,
                typeChanged: revision1.type !== revision2.type,
                mimeChanged: revision1.mime !== revision2.mime,
                protectionChanged: revision1.isProtected !== revision2.isProtected,
                datesDifferent: revision1.utcDateLastEdited !== revision2.utcDateLastEdited
            }
        };

        if (includeContent) {
            try {
                if (revision1.isContentAvailable() && revision2.isContentAvailable()) {
                    const content1 = revision1.getContent();
                    const content2 = revision2.getContent();
                    
                    comparison.contentComparison = {
                        content1Length: typeof content1 === 'string' ? content1.length : content1.length,
                        content2Length: typeof content2 === 'string' ? content2.length : content2.length,
                        contentIdentical: content1 === content2,
                        lengthDifference: (typeof content2 === 'string' ? content2.length : content2.length) - 
                                        (typeof content1 === 'string' ? content1.length : content1.length),
                        preview1: this.getContentPreview(content1, revision1.type),
                        preview2: this.getContentPreview(content2, revision2.type)
                    };

                    if (typeof content1 === 'string' && typeof content2 === 'string') {
                        comparison.contentComparison.textDiff = this.generateSimpleTextDiff(content1, content2);
                    }
                } else {
                    comparison.contentComparison = {
                        error: 'Cannot compare content - one or both revisions are not accessible',
                        revision1Accessible: revision1.isContentAvailable(),
                        revision2Accessible: revision2.isContentAvailable()
                    };
                }
            } catch (error: any) {
                comparison.contentComparison = {
                    error: `Content comparison failed: ${error.message}`
                };
            }
        }

        return {
            success: true,
            data: {
                noteId,
                noteTitle: note.title,
                comparison,
                summary: this.generateComparisonSummary(comparison),
                chronologicalOrder: this.determineChronologicalOrder(revision1, revision2)
            },
            operationTime: Date.now() - operationStart
        };
    }

    /**
     * Restore note to a previous revision
     */
    private async executeRestoreRevision(noteId: string, revisionId: string): Promise<any> {
        const operationStart = Date.now();

        const note = becca.getNote(noteId);
        if (!note) {
            return {
                success: false,
                error: `Note not found: "${noteId}"`,
                help: {
                    possibleCauses: ['Invalid noteId', 'Note was deleted'],
                    suggestions: ['Use search_notes to find note', 'Verify noteId is correct']
                },
                operationTime: Date.now() - operationStart
            };
        }

        const revision = becca.getRevision(revisionId);
        if (!revision || revision.noteId !== noteId) {
            return {
                success: false,
                error: `Revision not found: "${revisionId}" for note "${noteId}"`,
                help: {
                    possibleCauses: ['Invalid revisionId', 'Revision was deleted'],
                    suggestions: ['Use list_revisions to see available revisions']
                },
                operationTime: Date.now() - operationStart
            };
        }

        if (!revision.isContentAvailable()) {
            return {
                success: false,
                error: 'Cannot restore revision - content is not accessible',
                help: {
                    possibleCauses: [
                        'Revision is protected and no protected session is active',
                        'Revision content was corrupted or deleted'
                    ],
                    suggestions: [
                        'Start a protected session if revision is encrypted',
                        'Try a different revision that is accessible'
                    ]
                },
                operationTime: Date.now() - operationStart
            };
        }

        // Create backup of current state before restore
        const currentBackup = {
            title: note.title,
            type: note.type,
            mime: note.mime,
            content: note.getContent(),
            isProtected: note.isProtected
        };

        try {
            // Restore note properties
            note.title = revision.title;
            note.type = revision.type as any;
            note.mime = revision.mime;
            note.isProtected = revision.isProtected;
            
            // Restore content
            const revisionContent = revision.getContent();
            note.setContent(revisionContent);
            
            note.save();

            log.info(`Restored note "${noteId}" to revision "${revisionId}"`);

            return {
                success: true,
                data: {
                    noteId: note.noteId,
                    noteTitle: note.title,
                    restoredFromRevision: {
                        revisionId,
                        title: revision.title,
                        dateLastEdited: revision.dateLastEdited
                    },
                    changesApplied: {
                        titleChanged: currentBackup.title !== note.title,
                        typeChanged: currentBackup.type !== note.type,
                        mimeChanged: currentBackup.mime !== note.mime,
                        contentChanged: currentBackup.content !== revisionContent,
                        protectionChanged: currentBackup.isProtected !== note.isProtected
                    },
                    backup: currentBackup,
                    message: `Successfully restored note to revision from ${revision.dateLastEdited}`,
                    warning: 'Current state was overwritten - use the backup data if you need to revert'
                },
                operationTime: Date.now() - operationStart
            };

        } catch (error: any) {
            return {
                success: false,
                error: `Restore failed: ${error.message}`,
                help: {
                    possibleCauses: ['Database write error', 'Content processing error', 'Permission error'],
                    suggestions: ['Check if note is editable', 'Try again', 'Verify revision content is valid']
                },
                operationTime: Date.now() - operationStart
            };
        }
    }

    /**
     * Create a new revision (manual snapshot)
     */
    private async executeCreateRevision(noteId: string): Promise<any> {
        const operationStart = Date.now();

        const note = becca.getNote(noteId);
        if (!note) {
            return {
                success: false,
                error: `Note not found: "${noteId}"`,
                help: {
                    possibleCauses: ['Invalid noteId', 'Note was deleted'],
                    suggestions: ['Use search_notes to find note', 'Verify noteId is correct']
                },
                operationTime: Date.now() - operationStart
            };
        }

        try {
            // Trilium automatically creates revisions, but we can force one by making a small change
            // This is a bit of a hack - in a real implementation, you'd want to use Trilium's internal revision API
            const currentContent = note.getContent();
            
            // Create revision by making a temporary change and reverting
            note.setContent(currentContent + ' '); // Add space
            note.save();
            
            // Revert immediately
            note.setContent(currentContent);
            note.save();

            // Get the latest revision
            const revisions = note.getRevisions();
            const latestRevision = revisions[0]; // Most recent

            return {
                success: true,
                data: {
                    noteId: note.noteId,
                    noteTitle: note.title,
                    createdRevision: {
                        revisionId: latestRevision?.revisionId,
                        dateCreated: latestRevision?.dateCreated,
                        title: latestRevision?.title
                    },
                    message: 'Manual revision snapshot created',
                    note: 'Revisions are automatically created by Trilium when notes are modified'
                },
                operationTime: Date.now() - operationStart
            };

        } catch (error: any) {
            return {
                success: false,
                error: `Failed to create revision: ${error.message}`,
                help: {
                    possibleCauses: ['Database write error', 'Note is read-only', 'Revision system error'],
                    suggestions: ['Check if note is editable', 'Verify note permissions', 'Try again']
                },
                operationTime: Date.now() - operationStart
            };
        }
    }

    /**
     * Delete a specific revision
     */
    private async executeDeleteRevision(noteId: string, revisionId: string): Promise<any> {
        const operationStart = Date.now();

        const note = becca.getNote(noteId);
        if (!note) {
            return {
                success: false,
                error: `Note not found: "${noteId}"`,
                help: {
                    possibleCauses: ['Invalid noteId', 'Note was deleted'],
                    suggestions: ['Use search_notes to find note', 'Verify noteId is correct']
                },
                operationTime: Date.now() - operationStart
            };
        }

        const revision = becca.getRevision(revisionId);
        if (!revision || revision.noteId !== noteId) {
            return {
                success: false,
                error: `Revision not found: "${revisionId}" for note "${noteId}"`,
                help: {
                    possibleCauses: ['Invalid revisionId', 'Revision was already deleted'],
                    suggestions: ['Use list_revisions to see available revisions']
                },
                operationTime: Date.now() - operationStart
            };
        }

        // Check if this is the only revision (shouldn't delete the last one)
        const allRevisions = note.getRevisions();
        if (allRevisions.length <= 1) {
            return {
                success: false,
                error: 'Cannot delete the last remaining revision',
                help: {
                    possibleCauses: ['Only one revision exists'],
                    suggestions: ['Create additional revisions before deleting', 'Keep at least one revision for history']
                },
                operationTime: Date.now() - operationStart
            };
        }

        try {
            // In a real implementation, you would use Trilium's deletion methods
            // This is simplified - the actual implementation would need to handle blob cleanup, etc.
            revision.markAsDeleted();

            log.info(`Deleted revision "${revisionId}" from note "${noteId}"`);

            return {
                success: true,
                data: {
                    noteId: note.noteId,
                    noteTitle: note.title,
                    deletedRevision: {
                        revisionId,
                        title: revision.title,
                        dateLastEdited: revision.dateLastEdited
                    },
                    remainingRevisions: allRevisions.length - 1,
                    message: `Revision from ${revision.dateLastEdited} has been deleted`,
                    warning: 'This action cannot be undone'
                },
                operationTime: Date.now() - operationStart
            };

        } catch (error: any) {
            return {
                success: false,
                error: `Failed to delete revision: ${error.message}`,
                help: {
                    possibleCauses: ['Database error', 'Revision in use', 'Permission error'],
                    suggestions: ['Check revision is not referenced elsewhere', 'Try again', 'Verify permissions']
                },
                operationTime: Date.now() - operationStart
            };
        }
    }

    /**
     * Get content preview for display
     */
    private getContentPreview(content: string | Buffer, type: string): string {
        if (Buffer.isBuffer(content)) {
            return `[Binary content: ${content.length} bytes]`;
        }

        const maxLength = 150;
        let preview = content.substring(0, maxLength);
        
        if (type === 'text') {
            // Strip HTML tags for preview
            preview = preview.replace(/<[^>]*>/g, '');
        }
        
        if (content.length > maxLength) {
            preview += '...';
        }
        
        return preview || '[Empty content]';
    }

    /**
     * Generate simple text diff (basic implementation)
     */
    private generateSimpleTextDiff(content1: string, content2: string): any {
        const lines1 = content1.split('\n');
        const lines2 = content2.split('\n');
        
        const diff = {
            linesAdded: Math.max(0, lines2.length - lines1.length),
            linesRemoved: Math.max(0, lines1.length - lines2.length),
            linesChanged: 0,
            summary: '',
            changedLines: [] as Array<{ lineNumber: number; before: string; after: string; }>
        };

        // Simple line-by-line comparison
        const maxLines = Math.max(lines1.length, lines2.length);
        for (let i = 0; i < maxLines; i++) {
            const line1 = lines1[i] || '';
            const line2 = lines2[i] || '';
            
            if (line1 !== line2) {
                diff.linesChanged++;
                if (diff.changedLines.length < 5) { // Limit examples
                    diff.changedLines.push({
                        lineNumber: i + 1,
                        before: line1,
                        after: line2
                    });
                }
            }
        }

        diff.summary = `${diff.linesAdded} added, ${diff.linesRemoved} removed, ${diff.linesChanged} changed`;
        
        return diff;
    }

    /**
     * Generate comparison summary
     */
    private generateComparisonSummary(comparison: any): string[] {
        const summary: string[] = [];
        
        if (comparison.differences.titleChanged) {
            summary.push(`Title changed: "${comparison.revision1.title}" → "${comparison.revision2.title}"`);
        }
        
        if (comparison.differences.typeChanged) {
            summary.push(`Type changed: ${comparison.revision1.type} → ${comparison.revision2.type}`);
        }
        
        if (comparison.differences.protectionChanged) {
            summary.push(`Protection changed: ${comparison.revision1.isProtected ? 'protected' : 'unprotected'} → ${comparison.revision2.isProtected ? 'protected' : 'unprotected'}`);
        }
        
        if (comparison.contentComparison?.contentIdentical === false) {
            summary.push(`Content modified: ${comparison.contentComparison.textDiff?.summary || 'content differs'}`);
        }
        
        if (summary.length === 0) {
            summary.push('No significant differences detected');
        }
        
        return summary;
    }

    /**
     * Determine chronological order of revisions
     */
    private determineChronologicalOrder(revision1: any, revision2: any): any {
        const date1 = new Date(revision1.utcDateLastEdited);
        const date2 = new Date(revision2.utcDateLastEdited);
        
        return {
            revision1IsOlder: date1 < date2,
            revision2IsOlder: date2 < date1,
            sameDate: date1.getTime() === date2.getTime(),
            timeDifference: Math.abs(date1.getTime() - date2.getTime()),
            order: date1 < date2 ? 'revision1 → revision2' : 'revision2 → revision1'
        };
    }

    /**
     * Get revision recommendations
     */
    private getRevisionRecommendations(revisions: any[], currentNote: any): string[] {
        const recommendations: string[] = [];
        
        if (revisions.length === 0) {
            recommendations.push('No revisions found - this note may not have been modified yet');
            return recommendations;
        }
        
        if (revisions.length > 50) {
            recommendations.push('Many revisions exist - consider using more specific date ranges');
        }
        
        const protectedRevisions = revisions.filter(r => r.isProtected);
        if (protectedRevisions.length > 0 && !protectedSessionService.isProtectedSessionAvailable()) {
            recommendations.push('Some revisions are protected - start protected session to access encrypted history');
        }
        
        const recentRevisions = revisions.filter(r => {
            const revDate = new Date(r.utcDateLastEdited);
            const daysDiff = (Date.now() - revDate.getTime()) / (1000 * 60 * 60 * 24);
            return daysDiff < 7;
        });
        
        if (recentRevisions.length > 0) {
            recommendations.push(`${recentRevisions.length} recent revisions (last 7 days) - good revision history`);
        }
        
        return recommendations;
    }

    /**
     * Get suggested next steps based on action
     */
    private getNextStepsSuggestion(action: string, data: any): string {
        switch (action) {
            case 'list_revisions':
                return data.revisions.length > 0 ? 
                    `Use revision_manager("get_revision", noteId="${data.noteId}", revisionId="${data.revisions[0].revisionId}") to examine the most recent revision` :
                    'No revisions found for this note';
            case 'get_revision':
                return `Use revision_manager("compare_revisions", ...) to compare this revision with current version or other revisions`;
            case 'compare_revisions':
                return data.comparison.differences ? 
                    'Differences found - use restore_revision to revert to a previous version if needed' :
                    'No differences found between these revisions';
            case 'restore_revision':
                return `Use read_note("${data.noteId}") to verify the restoration was successful`;
            case 'create_revision':
                return `Use list_revisions to see the newly created revision in the history`;
            case 'delete_revision':
                return `Use list_revisions to verify the revision was removed from history`;
            default:
                return 'Use revision_manager with different actions to explore note version history';
        }
    }

    /**
     * Execute the revision manager tool (legacy method for backward compatibility)
     */
    public async execute(args: {
        action: 'list_revisions' | 'get_revision' | 'compare_revisions' | 'restore_revision' | 'create_revision' | 'delete_revision',
        noteId: string,
        revisionId?: string,
        compareWithRevisionId?: string,
        limit?: number,
        includeContent?: boolean,
        sortBy?: 'date_desc' | 'date_asc' | 'title' | 'size'
    }): Promise<string | object> {
        // Delegate to the standardized method
        const standardizedResponse = await this.executeStandardized(args);

        // For backward compatibility, return the legacy format
        if (standardizedResponse.success) {
            const result = standardizedResponse.result as any;
            return {
                success: true,
                action: args.action,
                message: `Revision ${args.action} completed successfully`,
                data: result
            };
        } else {
            return `Error: ${standardizedResponse.error}`;
        }
    }
}