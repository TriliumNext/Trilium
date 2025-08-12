/**
 * Note Type Converter Tool
 *
 * This tool allows the LLM to convert notes between different types in Trilium.
 * It handles content transformation, MIME type updates, and type-specific adjustments.
 */

import type { Tool, ToolHandler, StandardizedToolResponse } from './tool_interfaces.js';
import { ToolResponseFormatter } from './tool_interfaces.js';
import { ParameterValidationHelpers } from './parameter_validation_helpers.js';
import log from '../../log.js';
import becca from '../../../becca/becca.js';
import noteTypesService from '../../note_types.js';
import htmlSanitizer from '../../html_sanitizer.js';

/**
 * Helper function to safely convert content to string
 */
function getContentAsString(content: string | Buffer): string {
    if (Buffer.isBuffer(content)) {
        return content.toString('utf8');
    }
    return content;
}

// Define supported note types with descriptions
type NoteTypeInfo = {
    description: string;
    defaultMime: string;
    canConvertFrom: string[];
    contentProcessing: string;
};

const NOTE_TYPE_INFO: Record<string, NoteTypeInfo> = {
    'text': {
        description: 'Rich text notes with HTML content, perfect for general writing and documentation',
        defaultMime: 'text/html',
        canConvertFrom: ['code', 'mermaid', 'book', 'doc'],
        contentProcessing: 'html'
    },
    'code': {
        description: 'Plain text code notes with syntax highlighting, ideal for programming content',
        defaultMime: 'text/plain',
        canConvertFrom: ['text', 'mermaid'],
        contentProcessing: 'plain'
    },
    'mermaid': {
        description: 'Diagram notes using Mermaid syntax for flowcharts, sequences, and graphs',
        defaultMime: 'text/vnd.mermaid',
        canConvertFrom: ['code', 'text'],
        contentProcessing: 'mermaid'
    },
    'book': {
        description: 'Hierarchical container notes for organizing child notes into chapters/sections',
        defaultMime: '',
        canConvertFrom: ['text', 'doc'],
        contentProcessing: 'minimal'
    },
    'doc': {
        description: 'Documentation-focused notes with special formatting and structure',
        defaultMime: '',
        canConvertFrom: ['text', 'book'],
        contentProcessing: 'doc'
    },
    'file': {
        description: 'Binary file attachments stored as note content',
        defaultMime: 'application/octet-stream',
        canConvertFrom: [],
        contentProcessing: 'binary'
    },
    'image': {
        description: 'Image files with display and editing capabilities',
        defaultMime: '',
        canConvertFrom: [],
        contentProcessing: 'binary'
    },
    'canvas': {
        description: 'Drawing and diagramming canvas with Excalidraw integration',
        defaultMime: 'application/json',
        canConvertFrom: [],
        contentProcessing: 'json'
    },
    'relationMap': {
        description: 'Visual relationship maps showing connections between notes',
        defaultMime: 'application/json',
        canConvertFrom: [],
        contentProcessing: 'json'
    },
    'search': {
        description: 'Saved search queries that dynamically show matching notes',
        defaultMime: '',
        canConvertFrom: [],
        contentProcessing: 'search'
    }
};

/**
 * Definition of the note type converter tool
 */
export const noteTypeConverterToolDefinition: Tool = {
    type: 'function',
    function: {
        name: 'note_type_converter',
        description: 'Convert notes between different types in Trilium. Changes the note type, MIME type, and processes content appropriately. Perfect for "convert my text note to a code note" or "make this code into a diagram" requests.',
        parameters: {
            type: 'object',
            properties: {
                action: {
                    type: 'string',
                    description: 'The conversion action to perform',
                    enum: ['convert', 'check_compatibility', 'list_types', 'preview_conversion'],
                    default: 'convert'
                },
                noteId: {
                    type: 'string',
                    description: 'For conversion operations: The noteId of the note to convert. Use noteId from search results.'
                },
                targetType: {
                    type: 'string',
                    description: 'For "convert": The target note type to convert to',
                    enum: ['text', 'code', 'mermaid', 'book', 'doc', 'file', 'image', 'canvas', 'relationMap', 'search', 'webView', 'launcher', 'contentWidget', 'mindMap', 'aiChat']
                },
                customMime: {
                    type: 'string',
                    description: 'Optional custom MIME type. If not provided, uses default for target type. Examples: "text/markdown", "application/javascript", "text/css"'
                },
                preserveContent: {
                    type: 'boolean',
                    description: 'Whether to preserve original content as-is (true) or process it for the new type (false). Default true for safe conversions.',
                    default: true
                },
                contentTransform: {
                    type: 'string',
                    description: 'How to transform content for new type',
                    enum: ['keep_as_is', 'strip_html', 'html_to_plain', 'plain_to_html', 'wrap_code_block'],
                    default: 'keep_as_is'
                },
                backupOriginal: {
                    type: 'boolean',
                    description: 'Whether to create a backup of the original note before conversion. Recommended for important notes.',
                    default: false
                }
            },
            required: ['action']
        }
    }
};

/**
 * Note type converter tool implementation
 */
export class NoteTypeConverterTool implements ToolHandler {
    public definition: Tool = noteTypeConverterToolDefinition;

    /**
     * Execute the note type converter tool with standardized response format
     */
    public async executeStandardized(args: {
        action: 'convert' | 'check_compatibility' | 'list_types' | 'preview_conversion',
        noteId?: string,
        targetType?: string,
        customMime?: string,
        preserveContent?: boolean,
        contentTransform?: 'keep_as_is' | 'strip_html' | 'html_to_plain' | 'plain_to_html' | 'wrap_code_block',
        backupOriginal?: boolean
    }): Promise<StandardizedToolResponse> {
        const startTime = Date.now();

        try {
            const { 
                action, 
                noteId, 
                targetType, 
                customMime, 
                preserveContent = true, 
                contentTransform = 'keep_as_is',
                backupOriginal = false
            } = args;

            log.info(`Executing note_type_converter tool - Action: "${action}"`);

            // Validate action
            const actionValidation = ParameterValidationHelpers.validateAction(
                action, 
                ['convert', 'check_compatibility', 'list_types', 'preview_conversion'],
                {
                    'convert': 'Convert a note to a different type',
                    'check_compatibility': 'Check if conversion between types is possible',
                    'list_types': 'List all available note types and their descriptions',
                    'preview_conversion': 'Preview what would happen during conversion'
                }
            );
            if (actionValidation) {
                return actionValidation;
            }

            // Validate noteId for note-specific actions
            if (['convert', 'check_compatibility', 'preview_conversion'].includes(action) && !noteId) {
                return ToolResponseFormatter.invalidParameterError(
                    'noteId',
                    'noteId from search results for note operations',
                    'missing'
                );
            }

            if (noteId) {
                const noteValidation = ParameterValidationHelpers.validateNoteId(noteId);
                if (noteValidation) {
                    return noteValidation;
                }
            }

            // Validate target type for conversion actions
            if (['convert', 'check_compatibility', 'preview_conversion'].includes(action) && !targetType) {
                return ToolResponseFormatter.invalidParameterError(
                    'targetType',
                    'valid note type like "text", "code", "mermaid"',
                    'missing'
                );
            }

            if (targetType && !NOTE_TYPE_INFO[targetType as keyof typeof NOTE_TYPE_INFO]) {
                return ToolResponseFormatter.error(
                    `Invalid target type: "${targetType}"`,
                    {
                        possibleCauses: [
                            'Unsupported note type',
                            'Typo in note type name',
                            'Using display name instead of type code'
                        ],
                        suggestions: [
                            'Use note_type_converter("list_types") to see all available types',
                            'Use one of: text, code, mermaid, book, doc, file, image, canvas, relationMap, search',
                            'Check spelling of the target type'
                        ],
                        examples: [
                            'targetType: "text" for rich text notes',
                            'targetType: "code" for code notes',
                            'targetType: "mermaid" for diagrams'
                        ]
                    }
                );
            }

            // Execute the requested action
            const result = await this.executeConversionAction(
                action, 
                noteId, 
                targetType, 
                customMime, 
                preserveContent, 
                contentTransform, 
                backupOriginal
            );

            if (!result.success) {
                return ToolResponseFormatter.error(result.error || 'Note conversion failed', result.help || {
                    possibleCauses: ['Note conversion failed'],
                    suggestions: ['Check conversion parameters', 'Verify note exists and is accessible']
                });
            }

            const executionTime = Date.now() - startTime;

            const nextSteps = {
                suggested: this.getNextStepsSuggestion(action, result.data),
                alternatives: [
                    'Use read_note to examine the converted note',
                    'Use note_type_converter("list_types") to explore other conversion options',
                    'Use note_type_converter("preview_conversion", ...) before converting important notes',
                    'Use search_notes to find similar notes that might need conversion'
                ],
                examples: [
                    result.data?.noteId ? `read_note("${result.data.noteId}")` : 'note_type_converter("list_types")',
                    result.data?.backupNoteId ? `read_note("${result.data.backupNoteId}")` : 'note_type_converter("check_compatibility", ...)',
                    'search_notes("code") to find code notes to convert'
                ]
            };

            const triliumConcept = "Trilium's note types determine how content is rendered, edited, and stored. " +
                "Each type has specific MIME types and rendering engines. " +
                "Converting between types changes the user experience but preserves the core content.";

            return ToolResponseFormatter.success(
                result.data,
                nextSteps,
                {
                    executionTime,
                    resourcesUsed: ['database', 'note-types', 'content-processing'],
                    action,
                    operationDuration: result.operationTime,
                    triliumConcept
                }
            );

        } catch (error: any) {
            const errorMessage = error.message || String(error);
            log.error(`Error executing note_type_converter tool: ${errorMessage}`);
            
            return ToolResponseFormatter.error(
                `Note type conversion failed: ${errorMessage}`,
                {
                    possibleCauses: [
                        'Content processing error',
                        'Invalid note type combination',
                        'Database write error',
                        'Content format incompatibility'
                    ],
                    suggestions: [
                        'Check if source and target types are compatible',
                        'Try with preserveContent=true for safer conversion',
                        'Use preview_conversion to check before converting',
                        'Ensure note exists and is accessible'
                    ]
                }
            );
        }
    }

    /**
     * Execute the specific conversion action
     */
    private async executeConversionAction(
        action: string,
        noteId?: string,
        targetType?: string,
        customMime?: string,
        preserveContent?: boolean,
        contentTransform?: string,
        backupOriginal?: boolean
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
                case 'convert':
                    return await this.executeConvert(noteId!, targetType!, customMime, preserveContent!, contentTransform!, backupOriginal!);
                
                case 'check_compatibility':
                    return await this.executeCheckCompatibility(noteId!, targetType!);
                
                case 'list_types':
                    return await this.executeListTypes();
                
                case 'preview_conversion':
                    return await this.executePreviewConversion(noteId!, targetType!, customMime, contentTransform!);
                
                default:
                    return {
                        success: false,
                        error: `Unsupported action: ${action}`,
                        help: {
                            possibleCauses: ['Invalid action parameter'],
                            suggestions: ['Use one of: convert, check_compatibility, list_types, preview_conversion']
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
     * Convert note to target type
     */
    private async executeConvert(
        noteId: string,
        targetType: string,
        customMime?: string,
        preserveContent: boolean = true,
        contentTransform: string = 'keep_as_is',
        backupOriginal: boolean = false
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

        const originalType = note.type;
        const originalMime = note.mime;
        const originalContent = getContentAsString(note.getContent());

        if (originalType === targetType) {
            return {
                success: true,
                data: {
                    noteId: note.noteId,
                    title: note.title,
                    originalType,
                    targetType,
                    converted: false,
                    message: 'Note is already the target type',
                    effect: 'No changes made'
                },
                operationTime: Date.now() - operationStart
            };
        }

        // Check compatibility
        const compatibility = this.checkTypeCompatibility(originalType, targetType, originalContent);
        if (!compatibility.canConvert && !preserveContent) {
            return {
                success: false,
                error: `Cannot convert from "${originalType}" to "${targetType}": ${compatibility.reason}`,
                help: {
                    possibleCauses: [compatibility.reason],
                    suggestions: [
                        'Use preserveContent=true to force conversion',
                        'Try a different target type',
                        'Convert to an intermediate type first'
                    ]
                },
                operationTime: Date.now() - operationStart
            };
        }

        let backupNoteId: string | null = null;

        try {
            // Create backup if requested
            if (backupOriginal) {
                const backupResult = this.createBackup(note);
                if (backupResult.success) {
                    backupNoteId = backupResult.noteId ?? null;
                    log.info(`Created backup note: ${backupNoteId}`);
                } else {
                    log.info(`Failed to create backup: ${backupResult.error}`);
                }
            }

            // Process content for new type
            const processedContent = this.processContentForType(
                originalContent, 
                originalType, 
                targetType, 
                contentTransform
            );

            // Determine MIME type
            const newMime = customMime || noteTypesService.getDefaultMimeForNoteType(targetType);

            // Update note
            note.type = targetType as any;
            note.mime = newMime;
            
            if (!preserveContent || processedContent !== originalContent) {
                note.setContent(processedContent);
            }
            
            note.save();

            log.info(`Converted note "${note.title}" from ${originalType} to ${targetType}`);

            return {
                success: true,
                data: {
                    noteId: note.noteId,
                    title: note.title,
                    originalType,
                    targetType,
                    originalMime,
                    newMime,
                    converted: true,
                    contentChanged: !preserveContent || processedContent !== originalContent,
                    contentLength: {
                        original: originalContent.length,
                        new: processedContent.length
                    },
                    backupCreated: !!backupNoteId,
                    backupNoteId,
                    transformation: contentTransform,
                    compatibility: compatibility,
                    message: `Successfully converted note from "${originalType}" to "${targetType}"`,
                    warnings: this.getConversionWarnings(originalType, targetType, contentTransform)
                },
                operationTime: Date.now() - operationStart
            };

        } catch (error: any) {
            return {
                success: false,
                error: `Conversion failed: ${error.message}`,
                help: {
                    possibleCauses: ['Content processing error', 'Invalid type combination', 'Database write error'],
                    suggestions: ['Try with preserveContent=true', 'Check if note is editable', 'Try a different target type']
                },
                operationTime: Date.now() - operationStart
            };
        }
    }

    /**
     * Check compatibility between source and target types
     */
    private async executeCheckCompatibility(noteId: string, targetType: string): Promise<any> {
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

        const sourceType = note.type;
        const content = getContentAsString(note.getContent());
        const compatibility = this.checkTypeCompatibility(sourceType, targetType, content);

        return {
            success: true,
            data: {
                noteId: note.noteId,
                title: note.title,
                sourceType,
                targetType,
                canConvert: compatibility.canConvert,
                reason: compatibility.reason,
                confidence: compatibility.confidence,
                recommendations: compatibility.recommendations,
                sourceTypeInfo: NOTE_TYPE_INFO[sourceType as keyof typeof NOTE_TYPE_INFO],
                targetTypeInfo: NOTE_TYPE_INFO[targetType as keyof typeof NOTE_TYPE_INFO],
                contentAnalysis: {
                    length: content.length,
                    hasHtml: content.includes('<') && content.includes('>'),
                    hasCodeBlocks: content.includes('```'),
                    hasMarkdown: this.hasMarkdownSyntax(content),
                    isBinary: this.isBinaryContent(content),
                    isJson: this.isJsonContent(content)
                },
                suggestedTransforms: this.getSuggestedTransforms(sourceType, targetType, content)
            },
            operationTime: Date.now() - operationStart
        };
    }

    /**
     * List all available note types
     */
    private async executeListTypes(): Promise<any> {
        const operationStart = Date.now();

        const allTypes = noteTypesService.getNoteTypeNames();
        const typeDetails = allTypes.map(type => ({
            type,
            ...NOTE_TYPE_INFO[type as keyof typeof NOTE_TYPE_INFO] || {
                description: 'Note type (detailed info not available)',
                defaultMime: noteTypesService.getDefaultMimeForNoteType(type),
                canConvertFrom: [],
                contentProcessing: 'unknown'
            }
        }));

        // Group by common usage patterns
        const grouped = {
            common: typeDetails.filter(t => ['text', 'code', 'mermaid', 'book', 'doc'].includes(t.type)),
            visual: typeDetails.filter(t => ['image', 'canvas', 'relationMap', 'mindMap'].includes(t.type)),
            specialized: typeDetails.filter(t => ['search', 'file', 'webView', 'launcher', 'contentWidget', 'aiChat'].includes(t.type))
        };

        return {
            success: true,
            data: {
                totalTypes: allTypes.length,
                types: typeDetails,
                grouped,
                conversionMatrix: this.buildConversionMatrix(typeDetails),
                usage: {
                    mostCommon: ['text', 'code', 'mermaid'],
                    bestForWriting: ['text', 'book', 'doc'],
                    bestForCode: ['code', 'mermaid'],
                    bestForVisuals: ['image', 'canvas', 'relationMap'],
                    bestForData: ['search', 'file', 'aiChat']
                }
            },
            operationTime: Date.now() - operationStart
        };
    }

    /**
     * Preview what would happen during conversion
     */
    private async executePreviewConversion(
        noteId: string, 
        targetType: string, 
        customMime?: string, 
        contentTransform: string = 'keep_as_is'
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

        const originalContent = getContentAsString(note.getContent());
        const processedContent = this.processContentForType(
            originalContent, 
            note.type, 
            targetType, 
            contentTransform
        );

        const newMime = customMime || noteTypesService.getDefaultMimeForNoteType(targetType);
        const compatibility = this.checkTypeCompatibility(note.type, targetType, originalContent);

        return {
            success: true,
            data: {
                noteId: note.noteId,
                title: note.title,
                originalType: note.type,
                originalMime: note.mime,
                targetType,
                targetMime: newMime,
                contentPreview: {
                    originalLength: originalContent.length,
                    processedLength: processedContent.length,
                    originalPreview: this.getContentPreview(originalContent, note.type),
                    processedPreview: this.getContentPreview(processedContent, targetType),
                    changesDetected: originalContent !== processedContent,
                    transformation: contentTransform
                },
                compatibility,
                estimatedChanges: {
                    typeWillChange: note.type !== targetType,
                    mimeWillChange: note.mime !== newMime,
                    contentWillChange: originalContent !== processedContent,
                    renderingWillChange: true
                },
                warnings: this.getConversionWarnings(note.type, targetType, contentTransform),
                recommendations: [
                    compatibility.canConvert ? 
                        'Conversion appears safe to proceed' : 
                        'Conversion may have issues - review compatibility warnings',
                    processedContent !== originalContent ? 
                        'Content will be modified - consider backup' : 
                        'Content will be preserved unchanged',
                    'Test the converted note to ensure it displays correctly'
                ]
            },
            operationTime: Date.now() - operationStart
        };
    }

    /**
     * Check if conversion between two types is compatible
     */
    private checkTypeCompatibility(sourceType: string, targetType: string, content: string): any {
        const sourceInfo = NOTE_TYPE_INFO[sourceType as keyof typeof NOTE_TYPE_INFO];
        const targetInfo = NOTE_TYPE_INFO[targetType as keyof typeof NOTE_TYPE_INFO];

        if (!sourceInfo || !targetInfo) {
            return {
                canConvert: false,
                reason: 'Unknown source or target type',
                confidence: 0,
                recommendations: ['Use list_types to see available types']
            };
        }

        // Check explicit compatibility
        if (targetInfo.canConvertFrom.includes(sourceType)) {
            return {
                canConvert: true,
                reason: 'Types are explicitly compatible',
                confidence: 90,
                recommendations: ['Conversion should work well']
            };
        }

        // Check content-based compatibility
        if (sourceType === 'text' && targetType === 'code') {
            return {
                canConvert: true,
                reason: 'Text can be converted to code (HTML will be preserved)',
                confidence: 80,
                recommendations: ['Consider using contentTransform="html_to_plain" to strip HTML']
            };
        }

        if (sourceType === 'code' && targetType === 'text') {
            return {
                canConvert: true,
                reason: 'Code can be converted to text',
                confidence: 85,
                recommendations: ['Plain text will be displayed as HTML']
            };
        }

        // Check for problematic conversions
        if (['image', 'file', 'canvas'].includes(sourceType) && !['image', 'file', 'canvas'].includes(targetType)) {
            return {
                canConvert: false,
                reason: 'Cannot convert binary/visual content to text-based types',
                confidence: 0,
                recommendations: ['Keep binary content in appropriate types']
            };
        }

        // Default case
        return {
            canConvert: true,
            reason: 'Types not explicitly compatible but conversion may work',
            confidence: 50,
            recommendations: ['Test carefully', 'Use preview_conversion first', 'Consider creating backup']
        };
    }

    /**
     * Process content for target type
     */
    private processContentForType(
        content: string, 
        sourceType: string, 
        targetType: string, 
        transform: string
    ): string {
        switch (transform) {
            case 'keep_as_is':
                return content;
            
            case 'strip_html':
                // Use the basic sanitize function which strips most HTML
                return htmlSanitizer.sanitize(content);
            
            case 'html_to_plain':
                return content.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
            
            case 'plain_to_html':
                return content.replace(/\n/g, '<br>').replace(/  /g, '&nbsp;&nbsp;');
            
            case 'wrap_code_block':
                if (targetType === 'mermaid') {
                    return content; // Mermaid doesn't need code block wrapping
                }
                return '```\n' + content + '\n```';
            
            default:
                // Auto-transform based on types
                if (sourceType === 'text' && targetType === 'code') {
                    return this.processContentForType(content, sourceType, targetType, 'html_to_plain');
                }
                if (sourceType === 'code' && targetType === 'text') {
                    return this.processContentForType(content, sourceType, targetType, 'plain_to_html');
                }
                return content;
        }
    }

    /**
     * Create backup of original note
     */
    private createBackup(originalNote: any): { success: boolean; noteId?: string; error?: string } {
        try {
            const backupTitle = `${originalNote.title} (Backup - ${new Date().toISOString().split('T')[0]})`;
            
            // Find or create Backups folder
            const allNotes = Object.values(becca.notes);
            let backupsFolder = allNotes.find((note: any) => note.title.toLowerCase() === 'backups');
            
            if (!backupsFolder) {
                const rootNote = becca.getNote('root');
                backupsFolder = rootNote ?? undefined; // Use root if no backups folder
            }
            
            if (!backupsFolder) {
                throw new Error('Cannot create backup: no parent folder available');
            }

            const notes = require('../../notes.js');
            const result = notes.createNewNote({
                parentNoteId: backupsFolder.noteId,
                title: backupTitle,
                content: getContentAsString(originalNote.getContent()),
                type: originalNote.type,
                mime: originalNote.mime
            });

            return { success: true, noteId: result.note.noteId };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Get content preview for display
     */
    private getContentPreview(content: string, type: string): string {
        const maxLength = 200;
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
     * Check if content has markdown syntax
     */
    private hasMarkdownSyntax(content: string): boolean {
        const markdownPatterns = [
            /^#{1,6}\s/m,     // Headers
            /\*\*.*\*\*/,     // Bold
            /\*.*\*/,         // Italic
            /```.*```/s,      // Code blocks
            /^\* /m,          // Bullet lists
            /^\d+\. /m        // Numbered lists
        ];
        
        return markdownPatterns.some(pattern => pattern.test(content));
    }

    /**
     * Check if content is binary
     */
    private isBinaryContent(content: string): boolean {
        // Simple heuristic: if content has null bytes or very high ratio of non-printable chars
        return content.includes('\0') || 
               (content.replace(/[\x20-\x7E\n\r\t]/g, '').length / content.length) > 0.3;
    }

    /**
     * Check if content is JSON
     */
    private isJsonContent(content: string): boolean {
        try {
            JSON.parse(content);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Get suggested content transforms for type conversion
     */
    private getSuggestedTransforms(sourceType: string, targetType: string, content: string): string[] {
        const suggestions: string[] = [];
        
        if (sourceType === 'text' && targetType === 'code') {
            suggestions.push('html_to_plain - Remove HTML formatting');
            if (content.includes('<')) {
                suggestions.push('strip_html - Clean HTML tags');
            }
        }
        
        if (sourceType === 'code' && targetType === 'text') {
            suggestions.push('plain_to_html - Convert line breaks to HTML');
        }
        
        if (targetType === 'mermaid' && sourceType === 'code') {
            suggestions.push('keep_as_is - Preserve code as Mermaid syntax');
        }
        
        suggestions.push('keep_as_is - No content transformation');
        
        return suggestions;
    }

    /**
     * Build conversion matrix showing which types can convert to which
     */
    private buildConversionMatrix(typeDetails: any[]): any {
        const matrix: any = {};
        
        for (const source of typeDetails) {
            matrix[source.type] = {};
            for (const target of typeDetails) {
                const compatibility = this.checkTypeCompatibility(source.type, target.type, '');
                matrix[source.type][target.type] = {
                    possible: compatibility.canConvert,
                    confidence: compatibility.confidence,
                    recommended: compatibility.confidence >= 80
                };
            }
        }
        
        return matrix;
    }

    /**
     * Get warnings for specific conversions
     */
    private getConversionWarnings(sourceType: string, targetType: string, transform: string): string[] {
        const warnings: string[] = [];
        
        if (sourceType === 'text' && targetType === 'code' && transform === 'keep_as_is') {
            warnings.push('HTML formatting will be preserved as raw HTML in code view');
        }
        
        if (sourceType === 'code' && targetType === 'text' && transform === 'keep_as_is') {
            warnings.push('Plain text will be displayed without code syntax highlighting');
        }
        
        if (['image', 'file', 'canvas'].includes(sourceType) && !['image', 'file', 'canvas'].includes(targetType)) {
            warnings.push('Binary content may not display correctly in text-based note types');
        }
        
        if (targetType === 'mermaid' && sourceType !== 'code') {
            warnings.push('Content may not be valid Mermaid syntax and diagrams may not render');
        }
        
        return warnings;
    }

    /**
     * Get suggested next steps based on action
     */
    private getNextStepsSuggestion(action: string, data: any): string {
        switch (action) {
            case 'convert':
                return data.converted ? 
                    `Use read_note("${data.noteId}") to verify the conversion was successful` :
                    'Note was already the target type - no conversion needed';
            case 'check_compatibility':
                return data.canConvert ? 
                    `Conversion is possible with ${data.confidence}% confidence. Use convert action to proceed.` :
                    `Conversion not recommended: ${data.reason}`;
            case 'list_types':
                return `Found ${data.totalTypes} note types. Use check_compatibility to test specific conversions.`;
            case 'preview_conversion':
                return data.compatibility.canConvert ?
                    'Preview looks good. Use convert action to apply the changes.' :
                    'Preview shows potential issues. Review compatibility warnings before converting.';
            default:
                return 'Use note_type_converter with different actions to explore type conversion options';
        }
    }

    /**
     * Execute the note type converter tool (legacy method for backward compatibility)
     */
    public async execute(args: {
        action: 'convert' | 'check_compatibility' | 'list_types' | 'preview_conversion',
        noteId?: string,
        targetType?: string,
        customMime?: string,
        preserveContent?: boolean,
        contentTransform?: 'keep_as_is' | 'strip_html' | 'html_to_plain' | 'plain_to_html' | 'wrap_code_block',
        backupOriginal?: boolean
    }): Promise<string | object> {
        // Delegate to the standardized method
        const standardizedResponse = await this.executeStandardized(args);

        // For backward compatibility, return the legacy format
        if (standardizedResponse.success) {
            const result = standardizedResponse.result as any;
            return {
                success: true,
                action: args.action,
                message: `Note type conversion ${args.action} completed successfully`,
                data: result
            };
        } else {
            return `Error: ${standardizedResponse.error}`;
        }
    }
}