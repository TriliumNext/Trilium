/**
 * Protected Note Tool
 *
 * This tool allows the LLM to handle encrypted/protected notes in Trilium's security system.
 * It can check protection status, manage protected sessions, and handle encrypted content.
 */

import type { Tool, ToolHandler, StandardizedToolResponse } from './tool_interfaces.js';
import { ToolResponseFormatter } from './tool_interfaces.js';
import { ParameterValidationHelpers } from './parameter_validation_helpers.js';
import log from '../../log.js';
import becca from '../../../becca/becca.js';
import protectedSessionService from '../../protected_session.js';
import options from '../../options.js';

/**
 * Definition of the protected note tool
 */
export const protectedNoteToolDefinition: Tool = {
    type: 'function',
    function: {
        name: 'protected_note',
        description: 'Manage Trilium\'s encrypted/protected notes and sessions. Check if notes are protected, verify protected session status, and handle encrypted content. Protected notes are encrypted at rest and require a protected session to access.',
        parameters: {
            type: 'object',
            properties: {
                action: {
                    type: 'string',
                    description: 'The protection action to perform',
                    enum: ['check_protection', 'check_session', 'session_info', 'make_protected', 'remove_protection', 'list_protected_notes'],
                    default: 'check_protection'
                },
                noteId: {
                    type: 'string',
                    description: 'For note-specific operations: The noteId to check or modify protection status. Use noteId from search results.'
                },
                includeContent: {
                    type: 'boolean',
                    description: 'For "check_protection": Whether to include content availability info. Default false to avoid attempting to access encrypted content.',
                    default: false
                },
                recursive: {
                    type: 'boolean',
                    description: 'For "list_protected_notes": Whether to check child notes recursively. Default false for performance.',
                    default: false
                },
                parentNoteId: {
                    type: 'string',
                    description: 'For "list_protected_notes": Start search from this parent note. Use noteId from search results. Leave empty to search all notes.'
                }
            },
            required: ['action']
        }
    }
};

/**
 * Protected note tool implementation
 */
export class ProtectedNoteTool implements ToolHandler {
    public definition: Tool = protectedNoteToolDefinition;

    /**
     * Execute the protected note tool with standardized response format
     */
    public async executeStandardized(args: {
        action: 'check_protection' | 'check_session' | 'session_info' | 'make_protected' | 'remove_protection' | 'list_protected_notes',
        noteId?: string,
        includeContent?: boolean,
        recursive?: boolean,
        parentNoteId?: string
    }): Promise<StandardizedToolResponse> {
        const startTime = Date.now();

        try {
            const { action, noteId, includeContent = false, recursive = false, parentNoteId } = args;

            log.info(`Executing protected_note tool - Action: "${action}"`);

            // Validate action
            const actionValidation = ParameterValidationHelpers.validateAction(
                action, 
                ['check_protection', 'check_session', 'session_info', 'make_protected', 'remove_protection', 'list_protected_notes'],
                {
                    'check_protection': 'Check if a specific note is protected',
                    'check_session': 'Check if protected session is available',
                    'session_info': 'Get detailed protected session information',
                    'make_protected': 'Mark a note as protected (encrypt it)',
                    'remove_protection': 'Remove protection from a note (decrypt it)',
                    'list_protected_notes': 'Find all protected notes'
                }
            );
            if (actionValidation) {
                return actionValidation;
            }

            // Validate noteId for note-specific actions
            if (['check_protection', 'make_protected', 'remove_protection'].includes(action) && !noteId) {
                return ToolResponseFormatter.invalidParameterError(
                    'noteId',
                    'noteId from search results for note-specific operations',
                    'missing'
                );
            }

            if (noteId) {
                const noteValidation = ParameterValidationHelpers.validateNoteId(noteId);
                if (noteValidation) {
                    return noteValidation;
                }
            }

            if (parentNoteId) {
                const parentValidation = ParameterValidationHelpers.validateNoteId(parentNoteId, 'parentNoteId');
                if (parentValidation) {
                    return parentValidation;
                }
            }

            // Execute the requested action
            const result = await this.executeProtectionAction(
                action, 
                noteId, 
                includeContent, 
                recursive, 
                parentNoteId
            );

            if (!result.success) {
                return ToolResponseFormatter.error(result.error || 'Protection operation failed', result.help || {
                    possibleCauses: ['Protection operation failed'],
                    suggestions: ['Check protection parameters', 'Verify note exists and is accessible']
                });
            }

            const executionTime = Date.now() - startTime;

            const nextSteps = {
                suggested: this.getNextStepsSuggestion(action, result.data),
                alternatives: [
                    'Use search_notes to find notes that might be protected',
                    'Use protected_note("check_session") to verify protected session status',
                    'Use read_note carefully with protected notes (may require protected session)',
                    'Use protected_note("session_info") to get session timeout information'
                ],
                examples: [
                    result.data?.noteId ? `read_note("${result.data.noteId}")` : 'protected_note("check_session")',
                    'protected_note("list_protected_notes")',
                    'search_notes("#protected") to find protected notes'
                ]
            };

            // Educational content about Trilium's protection system
            const triliumConcept = "Trilium's protected notes are encrypted at rest with note-level granular encryption. " +
                "A protected session is required to decrypt and access protected content. " +
                "The protected session has a configurable timeout for security.";

            return ToolResponseFormatter.success(
                result.data,
                nextSteps,
                {
                    executionTime,
                    resourcesUsed: ['database', 'encryption', 'protected-session'],
                    action,
                    operationDuration: result.operationTime,
                    triliumConcept,
                    securityNote: "Protected notes require appropriate authentication and session management."
                }
            );

        } catch (error: any) {
            const errorMessage = error.message || String(error);
            log.error(`Error executing protected_note tool: ${errorMessage}`);
            
            return ToolResponseFormatter.error(
                `Protected note operation failed: ${errorMessage}`,
                {
                    possibleCauses: [
                        'Protected session not available',
                        'Note access permission error',
                        'Encryption/decryption error',
                        'Database access error'
                    ],
                    suggestions: [
                        'Check if protected session is active',
                        'Verify note exists and is accessible',
                        'Use protected_note("check_session") to check session status',
                        'Ensure appropriate permissions for encryption operations'
                    ]
                }
            );
        }
    }

    /**
     * Execute the specific protection action
     */
    private async executeProtectionAction(
        action: string,
        noteId?: string,
        includeContent?: boolean,
        recursive?: boolean,
        parentNoteId?: string
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
                case 'check_protection':
                    return await this.executeCheckProtection(noteId!, includeContent!);
                
                case 'check_session':
                    return await this.executeCheckSession();
                
                case 'session_info':
                    return await this.executeSessionInfo();
                
                case 'make_protected':
                    return await this.executeMakeProtected(noteId!);
                
                case 'remove_protection':
                    return await this.executeRemoveProtection(noteId!);
                
                case 'list_protected_notes':
                    return await this.executeListProtectedNotes(recursive!, parentNoteId);
                
                default:
                    return {
                        success: false,
                        error: `Unsupported action: ${action}`,
                        help: {
                            possibleCauses: ['Invalid action parameter'],
                            suggestions: ['Use one of: check_protection, check_session, session_info, make_protected, remove_protection, list_protected_notes']
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
     * Check protection status of a specific note
     */
    private async executeCheckProtection(noteId: string, includeContent: boolean): Promise<any> {
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

        const isSessionAvailable = protectedSessionService.isProtectedSessionAvailable();
        let contentInfo: {
            contentAvailable: boolean;
            isDecrypted: boolean;
            canAccessContent: boolean;
            contentLength: number | null;
            encryptionStatus: string;
        } | null = null;

        if (includeContent) {
            contentInfo = {
                contentAvailable: note.isContentAvailable(),
                isDecrypted: note.isDecrypted,
                canAccessContent: !note.isProtected || isSessionAvailable,
                contentLength: note.isContentAvailable() ? note.getContent().length : null,
                encryptionStatus: note.isProtected ? (isSessionAvailable ? 'decrypted' : 'encrypted') : 'unencrypted'
            };
        }

        // Check parent protection status (inheritance)
        const parents = note.parents;
        const parentProtectionInfo = parents.map(parent => ({
            noteId: parent.noteId,
            title: parent.title,
            isProtected: parent.isProtected,
            affectsChildren: parent.hasLabel('protectChildren')
        }));

        // Check child protection status
        const children = note.children;
        const protectedChildrenCount = children.filter(child => child.isProtected).length;

        return {
            success: true,
            data: {
                noteId: note.noteId,
                title: note.title,
                isProtected: note.isProtected,
                isDecrypted: note.isDecrypted,
                protectedSessionAvailable: isSessionAvailable,
                noteType: note.type,
                parentProtection: {
                    hasProtectedParents: parents.some(p => p.isProtected),
                    parentsWithProtectChildren: parents.filter(p => p.hasLabel('protectChildren')).length,
                    parentDetails: parentProtectionInfo
                },
                childProtection: {
                    totalChildren: children.length,
                    protectedChildren: protectedChildrenCount,
                    unprotectedChildren: children.length - protectedChildrenCount
                },
                contentInfo,
                recommendations: this.getProtectionRecommendations(note, isSessionAvailable)
            },
            operationTime: Date.now() - operationStart
        };
    }

    /**
     * Check protected session status
     */
    private async executeCheckSession(): Promise<any> {
        const operationStart = Date.now();
        
        const isAvailable = protectedSessionService.isProtectedSessionAvailable();

        return {
            success: true,
            data: {
                sessionAvailable: isAvailable,
                sessionStatus: isAvailable ? 'active' : 'inactive',
                canAccessProtectedNotes: isAvailable,
                message: isAvailable ? 
                    'Protected session is active - can access encrypted notes' :
                    'Protected session is not active - encrypted notes are inaccessible',
                recommendation: isAvailable ?
                    'You can now access protected notes and their content' :
                    'Start a protected session to access encrypted notes'
            },
            operationTime: Date.now() - operationStart
        };
    }

    /**
     * Get detailed protected session information
     */
    private async executeSessionInfo(): Promise<any> {
        const operationStart = Date.now();
        
        const isAvailable = protectedSessionService.isProtectedSessionAvailable();
        const timeout = options.getOptionInt("protectedSessionTimeout");

        // Count protected notes that would be accessible
        const allNotes = Object.values(becca.notes);
        const protectedNotes = allNotes.filter(note => note.isProtected);
        const accessibleProtectedNotes = protectedNotes.filter(note => note.isContentAvailable());

        return {
            success: true,
            data: {
                sessionAvailable: isAvailable,
                sessionStatus: isAvailable ? 'active' : 'inactive',
                timeoutMinutes: Math.floor(timeout / 60),
                timeoutSeconds: timeout,
                protectedNotesStats: {
                    totalProtectedNotes: protectedNotes.length,
                    accessibleNotes: accessibleProtectedNotes.length,
                    inaccessibleNotes: protectedNotes.length - accessibleProtectedNotes.length
                },
                sessionFeatures: {
                    canReadProtectedContent: isAvailable,
                    canModifyProtectedNotes: isAvailable,
                    canCreateProtectedNotes: true, // Can always create, but need session to read back
                    automaticTimeout: timeout > 0
                },
                securityInfo: {
                    encryptionLevel: 'Note-level granular encryption',
                    protectionScope: 'Individual notes can be protected',
                    sessionScope: 'Global protected session for all protected notes',
                    timeoutBehavior: 'Session expires after inactivity'
                }
            },
            operationTime: Date.now() - operationStart
        };
    }

    /**
     * Make a note protected (encrypt it)
     */
    private async executeMakeProtected(noteId: string): Promise<any> {
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

        if (note.isProtected) {
            return {
                success: true, // Not an error, just already protected
                data: {
                    noteId: note.noteId,
                    title: note.title,
                    wasAlreadyProtected: true,
                    isProtected: true,
                    message: 'Note was already protected',
                    effect: 'No changes made - note remains encrypted'
                },
                operationTime: Date.now() - operationStart
            };
        }

        if (!protectedSessionService.isProtectedSessionAvailable()) {
            return {
                success: false,
                error: 'Protected session is required to create protected notes',
                help: {
                    possibleCauses: ['No active protected session', 'Protected session expired'],
                    suggestions: [
                        'Start a protected session first',
                        'Check if protected session timeout has expired',
                        'Use protected_note("check_session") to verify session status'
                    ]
                },
                operationTime: Date.now() - operationStart
            };
        }

        try {
            // Mark note as protected
            note.isProtected = true;
            note.save();

            // The encryption will happen automatically when the note is saved
            log.info(`Note "${note.title}" (${noteId}) marked as protected`);

            return {
                success: true,
                data: {
                    noteId: note.noteId,
                    title: note.title,
                    wasAlreadyProtected: false,
                    isProtected: true,
                    message: 'Note has been marked as protected and encrypted',
                    effect: 'Note content is now encrypted at rest',
                    warning: 'Note will require protected session to access in the future',
                    recommendation: 'Verify note is accessible by reading it while protected session is active'
                },
                operationTime: Date.now() - operationStart
            };

        } catch (error: any) {
            return {
                success: false,
                error: `Failed to protect note: ${error.message}`,
                help: {
                    possibleCauses: ['Database write error', 'Encryption error', 'Insufficient permissions'],
                    suggestions: ['Check if note is editable', 'Verify protected session is stable', 'Try again']
                },
                operationTime: Date.now() - operationStart
            };
        }
    }

    /**
     * Remove protection from a note (decrypt it)
     */
    private async executeRemoveProtection(noteId: string): Promise<any> {
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

        if (!note.isProtected) {
            return {
                success: true, // Not an error, just already unprotected
                data: {
                    noteId: note.noteId,
                    title: note.title,
                    wasProtected: false,
                    isProtected: false,
                    message: 'Note was not protected',
                    effect: 'No changes made - note remains unencrypted'
                },
                operationTime: Date.now() - operationStart
            };
        }

        if (!protectedSessionService.isProtectedSessionAvailable()) {
            return {
                success: false,
                error: 'Protected session is required to remove protection from notes',
                help: {
                    possibleCauses: ['No active protected session', 'Protected session expired'],
                    suggestions: [
                        'Start a protected session first',
                        'Check if protected session timeout has expired',
                        'Use protected_note("check_session") to verify session status'
                    ]
                },
                operationTime: Date.now() - operationStart
            };
        }

        try {
            // Remove protection from note
            note.isProtected = false;
            note.save();

            log.info(`Protection removed from note "${note.title}" (${noteId})`);

            return {
                success: true,
                data: {
                    noteId: note.noteId,
                    title: note.title,
                    wasProtected: true,
                    isProtected: false,
                    message: 'Protection has been removed from note',
                    effect: 'Note content is now stored unencrypted',
                    warning: 'Note content is no longer encrypted at rest',
                    recommendation: 'Consider if this note should remain unprotected based on its content sensitivity'
                },
                operationTime: Date.now() - operationStart
            };

        } catch (error: any) {
            return {
                success: false,
                error: `Failed to remove protection: ${error.message}`,
                help: {
                    possibleCauses: ['Database write error', 'Decryption error', 'Insufficient permissions'],
                    suggestions: ['Check if note is editable', 'Verify protected session is stable', 'Try again']
                },
                operationTime: Date.now() - operationStart
            };
        }
    }

    /**
     * List all protected notes
     */
    private async executeListProtectedNotes(recursive: boolean, parentNoteId?: string): Promise<any> {
        const operationStart = Date.now();
        
        let notesToSearch = Object.values(becca.notes);
        let searchScope = 'all notes';

        // Filter by parent if specified
        if (parentNoteId) {
            const parentNote = becca.getNote(parentNoteId);
            if (!parentNote) {
                return {
                    success: false,
                    error: `Parent note not found: "${parentNoteId}"`,
                    help: {
                        possibleCauses: ['Invalid parent noteId'],
                        suggestions: ['Use search_notes to find parent note', 'Omit parentNoteId to search all notes']
                    },
                    operationTime: Date.now() - operationStart
                };
            }

            if (recursive) {
                // Get all descendants
                const descendants = this.getAllDescendants(parentNote);
                notesToSearch = [parentNote, ...descendants];
                searchScope = `"${parentNote.title}" and all descendants`;
            } else {
                // Get only direct children
                notesToSearch = [parentNote, ...parentNote.children];
                searchScope = `"${parentNote.title}" and direct children`;
            }
        }

        const isSessionAvailable = protectedSessionService.isProtectedSessionAvailable();
        const protectedNotes = notesToSearch.filter(note => note.isProtected);

        const protectedNotesInfo = protectedNotes.map(note => ({
            noteId: note.noteId,
            title: note.title,
            type: note.type,
            isDecrypted: note.isDecrypted,
            contentAvailable: note.isContentAvailable(),
            parentTitles: note.parents.map(p => p.title),
            childrenCount: note.children.length,
            protectedChildrenCount: note.children.filter(c => c.isProtected).length,
            hasProtectChildrenLabel: note.hasLabel('protectChildren'),
            contentLength: note.isContentAvailable() ? note.getContent().length : null
        }));

        // Sort by title for consistent results
        protectedNotesInfo.sort((a, b) => a.title.localeCompare(b.title));

        const stats = {
            totalNotesSearched: notesToSearch.length,
            protectedNotesFound: protectedNotes.length,
            accessibleNotes: protectedNotesInfo.filter(n => n.contentAvailable).length,
            inaccessibleNotes: protectedNotesInfo.filter(n => !n.contentAvailable).length,
            protectedSessionAvailable: isSessionAvailable
        };

        return {
            success: true,
            data: {
                searchScope,
                parentNoteId,
                recursive,
                stats,
                protectedNotes: protectedNotesInfo.slice(0, 50), // Limit results for performance
                truncated: protectedNotesInfo.length > 50,
                sessionInfo: {
                    available: isSessionAvailable,
                    effect: isSessionAvailable ? 
                        'Protected notes show decrypted titles and content' :
                        'Protected notes show encrypted titles and no content'
                },
                recommendations: stats.protectedNotesFound > 0 ? [
                    isSessionAvailable ? 
                        'You can access all protected notes in the current session' :
                        'Start a protected session to access encrypted content',
                    'Use read_note with specific noteIds to examine protected notes',
                    'Consider the security implications of your protected note organization'
                ] : [
                    'No protected notes found in the specified scope',
                    'Use protected_note("make_protected", noteId=...) to protect sensitive notes'
                ]
            },
            operationTime: Date.now() - operationStart
        };
    }

    /**
     * Get all descendant notes recursively
     */
    private getAllDescendants(note: any): any[] {
        const descendants: any[] = [];
        const visited = new Set<string>();
        
        const traverse = (currentNote: any) => {
            if (visited.has(currentNote.noteId)) return;
            visited.add(currentNote.noteId);
            
            const children = currentNote.children;
            for (const child of children) {
                descendants.push(child);
                traverse(child);
            }
        };
        
        traverse(note);
        return descendants;
    }

    /**
     * Get protection recommendations for a note
     */
    private getProtectionRecommendations(note: any, isSessionAvailable: boolean): string[] {
        const recommendations: string[] = [];
        
        if (note.isProtected) {
            if (isSessionAvailable) {
                recommendations.push('Note is protected and accessible in current session');
                recommendations.push('Content will be inaccessible when protected session expires');
            } else {
                recommendations.push('Note is protected but inaccessible - start protected session to access');
                recommendations.push('Use protected_note("check_session") to check session status');
            }
        } else {
            if (note.title.toLowerCase().includes('password') || 
                note.title.toLowerCase().includes('private') ||
                note.title.toLowerCase().includes('secret')) {
                recommendations.push('Consider protecting this note due to sensitive title');
            }
            recommendations.push('Note is unprotected - consider encryption for sensitive content');
        }
        
        const protectedParents = note.parents.filter((p: any) => p.hasLabel('protectChildren'));
        if (protectedParents.length > 0) {
            recommendations.push('Parent has protectChildren label - new child notes may be auto-protected');
        }
        
        return recommendations;
    }

    /**
     * Get suggested next steps based on action
     */
    private getNextStepsSuggestion(action: string, data: any): string {
        switch (action) {
            case 'check_protection':
                return data.isProtected ? 
                    (data.protectedSessionAvailable ? 
                        `Use read_note("${data.noteId}") to access the protected note content` :
                        'Start a protected session to access this encrypted note') :
                    `Note is unprotected. Use protected_note("make_protected", noteId="${data.noteId}") to encrypt it`;
            case 'check_session':
                return data.sessionAvailable ? 
                    'Protected session is active. You can now access protected notes.' :
                    'Start a protected session to access encrypted notes.';
            case 'session_info':
                return data.sessionAvailable ? 
                    `Session active with ${data.timeoutMinutes} minute timeout. ${data.protectedNotesStats.totalProtectedNotes} protected notes available.` :
                    'No protected session. Start one to access encrypted content.';
            case 'make_protected':
                return `Use read_note("${data.noteId}") to verify the note is still accessible after protection`;
            case 'remove_protection':
                return `Note is now unprotected. Use read_note("${data.noteId}") to verify accessibility`;
            case 'list_protected_notes':
                return data.stats.protectedNotesFound > 0 ?
                    'Use read_note with specific noteIds to examine protected notes in detail' :
                    'No protected notes found. Use protected_note("make_protected", ...) to encrypt sensitive notes';
            default:
                return 'Use protected_note with different actions to manage note protection';
        }
    }

    /**
     * Execute the protected note tool (legacy method for backward compatibility)
     */
    public async execute(args: {
        action: 'check_protection' | 'check_session' | 'session_info' | 'make_protected' | 'remove_protection' | 'list_protected_notes',
        noteId?: string,
        includeContent?: boolean,
        recursive?: boolean,
        parentNoteId?: string
    }): Promise<string | object> {
        // Delegate to the standardized method
        const standardizedResponse = await this.executeStandardized(args);

        // For backward compatibility, return the legacy format
        if (standardizedResponse.success) {
            const result = standardizedResponse.result as any;
            return {
                success: true,
                action: args.action,
                message: `Protected note ${args.action} completed successfully`,
                data: result
            };
        } else {
            return `Error: ${standardizedResponse.error}`;
        }
    }
}