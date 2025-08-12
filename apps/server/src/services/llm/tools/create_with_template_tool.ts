/**
 * Create with Template Tool - Phase 2.1 Compound Workflow Tool
 *
 * This compound tool combines smart_search (to find templates) + note_creation + attribute copying
 * into a single operation. Perfect for "create a new meeting note using my meeting template" requests.
 */

import type { Tool, ToolHandler, StandardizedToolResponse, ToolErrorResponse } from './tool_interfaces.js';
import { ToolResponseFormatter } from './tool_interfaces.js';
import log from '../../log.js';
import { SmartSearchTool } from './smart_search_tool.js';
import { NoteCreationTool } from './note_creation_tool.js';
import { ReadNoteTool } from './read_note_tool.js';
import { AttributeManagerTool } from './attribute_manager_tool.js';
import becca from '../../../becca/becca.js';

/**
 * Result structure for create with template operations
 */
interface CreateWithTemplateResult {
    templateSearch: {
        query: string;
        templatesFound: number;
        selectedTemplate: {
            noteId: string;
            title: string;
            score: number;
        } | null;
    };
    createdNote: {
        noteId: string;
        title: string;
        type: string;
        parentId: string;
        contentLength: number;
        attributesCopied: number;
    };
    templateContent: {
        originalContent: string;
        processedContent: string;
        placeholdersReplaced: number;
    };
}

/**
 * Definition of the create with template compound tool
 */
export const createWithTemplateToolDefinition: Tool = {
    type: 'function',
    function: {
        name: 'create_with_template',
        description: 'Create a new note using an existing note as a template. Automatically finds templates, copies content and attributes, and replaces placeholders. Perfect for "create new meeting note using meeting template" requests.',
        parameters: {
            type: 'object',
            properties: {
                title: {
                    type: 'string',
                    description: 'Title for the new note. Examples: "Weekly Meeting - Dec 15", "Project Review Meeting", "Client Call Notes"'
                },
                templateQuery: {
                    type: 'string',
                    description: 'Search terms to find the template note. Examples: "meeting template", "project template", "#template meeting", "weekly standup template"'
                },
                parentNoteId: {
                    type: 'string',
                    description: 'Where to create the new note. Use noteId from search results, or leave empty for root folder. Example: "abc123def456"'
                },
                placeholders: {
                    type: 'object',
                    description: 'Values to replace placeholders in template. Use key-value pairs where key is placeholder name and value is replacement. Examples: {"date": "2024-01-15", "project": "Website Redesign", "attendees": "John, Sarah, Mike"}'
                },
                copyAttributes: {
                    type: 'boolean',
                    description: 'Whether to copy tags and properties from template to new note. Default is true for complete template duplication.'
                },
                templateNoteId: {
                    type: 'string',
                    description: 'Optional: Use specific template note directly instead of searching. Use when you know the exact template noteId.'
                },
                customContent: {
                    type: 'string',
                    description: 'Optional: Additional content to append after template content. Useful for adding specific details to the templated note.'
                }
            },
            required: ['title']
        }
    }
};

/**
 * Create with template compound tool implementation
 */
export class CreateWithTemplateTool implements ToolHandler {
    public definition: Tool = createWithTemplateToolDefinition;
    private smartSearchTool: SmartSearchTool;
    private noteCreationTool: NoteCreationTool;
    private readNoteTool: ReadNoteTool;
    private attributeManagerTool: AttributeManagerTool;

    constructor() {
        this.smartSearchTool = new SmartSearchTool();
        this.noteCreationTool = new NoteCreationTool();
        this.readNoteTool = new ReadNoteTool();
        this.attributeManagerTool = new AttributeManagerTool();
    }

    /**
     * Find template note either by direct ID or by search
     */
    private async findTemplate(templateNoteId?: string, templateQuery?: string): Promise<{
        success: boolean;
        template?: any;
        searchResults?: any;
        error?: string;
    }> {
        // If direct template ID provided, use it
        if (templateNoteId) {
            const note = becca.notes[templateNoteId];
            if (note) {
                log.info(`Using direct template note: "${note.title}" (${templateNoteId})`);
                return {
                    success: true,
                    template: {
                        noteId: templateNoteId,
                        title: note.title,
                        score: 1.0
                    }
                };
            } else {
                return {
                    success: false,
                    error: `Template note not found: ${templateNoteId}`
                };
            }
        }

        // Search for template
        if (!templateQuery) {
            return {
                success: false,
                error: 'Either templateNoteId or templateQuery must be provided'
            };
        }

        log.info(`Searching for template with query: "${templateQuery}"`);
        
        const searchResponse = await this.smartSearchTool.executeStandardized({
            query: templateQuery,
            maxResults: 5,
            forceMethod: 'auto',
            enableFallback: true
        });

        if (!searchResponse.success) {
            return {
                success: false,
                error: `Template search failed: ${searchResponse.error}`,
                searchResults: null
            };
        }

        const searchResult = searchResponse.result as any;
        const templates = searchResult.results || [];

        if (templates.length === 0) {
            return {
                success: false,
                error: `No templates found matching "${templateQuery}"`,
                searchResults: searchResult
            };
        }

        // Select best template (highest score)
        const bestTemplate = templates[0];
        log.info(`Selected template: "${bestTemplate.title}" (score: ${bestTemplate.score})`);

        return {
            success: true,
            template: bestTemplate,
            searchResults: searchResult
        };
    }

    /**
     * Process template content by replacing placeholders
     */
    private processTemplateContent(content: string, placeholders: Record<string, string> = {}): {
        processedContent: string;
        placeholdersReplaced: number;
    } {
        let processedContent = content;
        let replacements = 0;

        // Common placeholder patterns
        const patterns = [
            /\{\{([^}]+)\}\}/g,  // {{placeholder}}
            /\{([^}]+)\}/g,      // {placeholder}
            /\[([^\]]+)\]/g,     // [placeholder]
            /\$\{([^}]+)\}/g     // ${placeholder}
        ];

        // Apply user-defined replacements
        Object.entries(placeholders).forEach(([key, value]) => {
            patterns.forEach(pattern => {
                const regex = new RegExp(pattern.source.replace('([^}]+)', `\\b${key}\\b`), 'gi');
                const matches = processedContent.match(regex);
                if (matches) {
                    processedContent = processedContent.replace(regex, value);
                    replacements += matches.length;
                    log.info(`Replaced ${matches.length} instances of placeholder "${key}" with "${value}"`);
                }
            });

            // Also handle direct text replacement
            const directRegex = new RegExp(`\\b${key}\\b`, 'gi');
            const directMatches = processedContent.match(directRegex);
            if (directMatches && !placeholders[key.toLowerCase()]) { // Avoid double replacement
                processedContent = processedContent.replace(directRegex, value);
                replacements += directMatches.length;
            }
        });

        // Add current date/time as default replacements
        const now = new Date();
        const defaultReplacements = {
            'TODAY': now.toISOString().split('T')[0],
            'NOW': now.toISOString(),
            'TIMESTAMP': now.getTime().toString(),
            'YEAR': now.getFullYear().toString(),
            'MONTH': (now.getMonth() + 1).toString().padStart(2, '0'),
            'DAY': now.getDate().toString().padStart(2, '0'),
            'DATE': now.toLocaleDateString(),
            'TIME': now.toLocaleTimeString()
        };

        // Apply default replacements only if not already provided
        Object.entries(defaultReplacements).forEach(([key, value]) => {
            if (!placeholders[key] && !placeholders[key.toLowerCase()]) {
                patterns.forEach(pattern => {
                    const regex = new RegExp(pattern.source.replace('([^}]+)', `\\b${key}\\b`), 'gi');
                    const matches = processedContent.match(regex);
                    if (matches) {
                        processedContent = processedContent.replace(regex, value);
                        replacements += matches.length;
                        log.info(`Applied default replacement: "${key}" -> "${value}"`);
                    }
                });
            }
        });

        return { processedContent, placeholdersReplaced: replacements };
    }

    /**
     * Execute the create with template compound tool with standardized response format
     */
    public async executeStandardized(args: {
        title: string,
        templateQuery?: string,
        parentNoteId?: string,
        placeholders?: Record<string, string>,
        copyAttributes?: boolean,
        templateNoteId?: string,
        customContent?: string
    }): Promise<StandardizedToolResponse> {
        const startTime = Date.now();

        try {
            const {
                title,
                templateQuery,
                parentNoteId,
                placeholders = {},
                copyAttributes = true,
                templateNoteId,
                customContent
            } = args;

            log.info(`Executing create_with_template tool - Title: "${title}", Template: ${templateNoteId || templateQuery}`);

            // Validate input parameters
            if (!title || title.trim().length === 0) {
                return ToolResponseFormatter.invalidParameterError(
                    'title',
                    'non-empty string',
                    title
                );
            }

            if (!templateNoteId && !templateQuery) {
                return ToolResponseFormatter.invalidParameterError(
                    'templateNoteId or templateQuery',
                    'at least one must be provided to find template',
                    'both are missing'
                );
            }

            // Step 1: Find template note
            log.info('Step 1: Finding template note');
            const templateSearchStartTime = Date.now();
            
            const templateResult = await this.findTemplate(templateNoteId, templateQuery);
            const templateSearchDuration = Date.now() - templateSearchStartTime;

            if (!templateResult.success) {
                return ToolResponseFormatter.error(
                    templateResult.error || 'Failed to find template',
                    {
                        possibleCauses: [
                            templateNoteId ? 'Template note ID does not exist' : 'No notes match template search',
                            'Template may have been deleted or moved',
                            'Search terms too specific or misspelled'
                        ],
                        suggestions: [
                            templateNoteId ? 'Verify the template noteId exists' : 'Try broader template search terms',
                            'Use smart_search to find template notes first',
                            'Create a template note first if none exists',
                            templateQuery ? `Try: "template", "#template", or "meeting template"` : 'Use smart_search to find valid template IDs'
                        ],
                        examples: [
                            'smart_search("template")',
                            'smart_search("#template meeting")',
                            'create_note("Meeting Template", "template content")'
                        ]
                    }
                );
            }

            const template = templateResult.template!;
            log.info(`Step 1 complete: Found template "${template.title}" in ${templateSearchDuration}ms`);

            // Step 2: Read template content and attributes
            log.info('Step 2: Reading template content');
            const readStartTime = Date.now();

            const readResponse = await this.readNoteTool.executeStandardized({
                noteId: template.noteId,
                includeAttributes: copyAttributes
            });

            const readDuration = Date.now() - readStartTime;

            if (!readResponse.success) {
                return ToolResponseFormatter.error(
                    `Failed to read template content: ${readResponse.error}`,
                    {
                        possibleCauses: [
                            'Template note content is inaccessible',
                            'Database connectivity issue',
                            'Template note may be corrupted'
                        ],
                        suggestions: [
                            'Try reading the template note directly first',
                            'Use a different template note',
                            'Check if Trilium service is running properly'
                        ],
                        examples: [
                            `read_note("${template.noteId}")`,
                            `smart_search("${templateQuery || 'template'}")`
                        ]
                    }
                );
            }

            const templateData = readResponse.result as any;
            log.info(`Step 2 complete: Read template content (${templateData.metadata?.wordCount || 0} words) in ${readDuration}ms`);

            // Step 3: Process template content
            log.info('Step 3: Processing template content');
            const processStartTime = Date.now();

            const originalContent = typeof templateData.content === 'string' ? templateData.content : String(templateData.content);
            const { processedContent, placeholdersReplaced } = this.processTemplateContent(originalContent, placeholders);
            
            // Add custom content if provided
            const finalContent = customContent 
                ? processedContent + '\n\n' + customContent
                : processedContent;

            const processDuration = Date.now() - processStartTime;
            log.info(`Step 3 complete: Processed content with ${placeholdersReplaced} replacements in ${processDuration}ms`);

            // Step 4: Create new note
            log.info('Step 4: Creating new note');
            const createStartTime = Date.now();

            const creationResponse = await this.noteCreationTool.executeStandardized({
                title: title.trim(),
                content: finalContent,
                type: templateData.type || 'text',
                parentNoteId,
                // Don't include attributes in creation - we'll copy them separately if needed
                attributes: []
            });

            const createDuration = Date.now() - createStartTime;

            if (!creationResponse.success) {
                return ToolResponseFormatter.error(
                    `Failed to create note: ${creationResponse.error}`,
                    {
                        possibleCauses: [
                            'Database write error',
                            'Invalid note parameters',
                            'Insufficient permissions',
                            'Parent note does not exist'
                        ],
                        suggestions: [
                            'Try creating without parentNoteId (in root)',
                            'Verify parentNoteId exists if specified',
                            'Check if Trilium database is accessible',
                            'Try with simpler title or content'
                        ],
                        examples: [
                            `create_note("${title}", "simple content")`,
                            parentNoteId ? `read_note("${parentNoteId}")` : 'create_note without parent'
                        ]
                    }
                );
            }

            const newNote = creationResponse.result as any;
            log.info(`Step 4 complete: Created note "${newNote.title}" (${newNote.noteId}) in ${createDuration}ms`);

            // Step 5: Copy attributes if requested
            let attributesCopied = 0;
            if (copyAttributes && templateData.attributes && templateData.attributes.length > 0) {
                log.info(`Step 5: Copying ${templateData.attributes.length} attributes`);
                const attrStartTime = Date.now();

                for (const attr of templateData.attributes) {
                    try {
                        await this.attributeManagerTool.executeStandardized({
                            noteId: newNote.noteId,
                            action: 'add',
                            attributeName: attr.name,
                            attributeValue: attr.value
                        });
                        attributesCopied++;
                        log.info(`Copied attribute: ${attr.name}=${attr.value}`);
                    } catch (error) {
                        log.error(`Failed to copy attribute ${attr.name}: ${error}`);
                    }
                }

                const attrDuration = Date.now() - attrStartTime;
                log.info(`Step 5 complete: Copied ${attributesCopied}/${templateData.attributes.length} attributes in ${attrDuration}ms`);
            }

            const executionTime = Date.now() - startTime;

            // Create comprehensive result
            const result: CreateWithTemplateResult = {
                templateSearch: {
                    query: templateQuery || `direct: ${templateNoteId}`,
                    templatesFound: templateResult.searchResults?.count || 1,
                    selectedTemplate: template
                },
                createdNote: {
                    noteId: newNote.noteId,
                    title: newNote.title,
                    type: newNote.type,
                    parentId: newNote.parentId,
                    contentLength: finalContent.length,
                    attributesCopied
                },
                templateContent: {
                    originalContent,
                    processedContent: finalContent,
                    placeholdersReplaced
                }
            };

            // Create contextual next steps
            const nextSteps = {
                suggested: `Use read_note with noteId: "${newNote.noteId}" to review the created note`,
                alternatives: [
                    'Use note_update to modify the generated content',
                    'Use attribute_manager to add more tags or properties',
                    'Use create_with_template to create similar notes',
                    'Use manage_relationships to link to related notes'
                ],
                examples: [
                    `read_note("${newNote.noteId}")`,
                    `note_update("${newNote.noteId}", "additional content", "append")`,
                    `attribute_manager("${newNote.noteId}", "add", "#reviewed")`,
                    `create_with_template("${title} Follow-up", "${templateQuery || template.noteId}")`
                ]
            };

            return ToolResponseFormatter.success(
                result,
                nextSteps,
                {
                    executionTime,
                    resourcesUsed: ['search', 'content', 'creation', 'attributes'],
                    templateSearchDuration,
                    readDuration,
                    processDuration,
                    createDuration,
                    templateUsed: template.title,
                    placeholdersProvided: Object.keys(placeholders).length,
                    placeholdersReplaced,
                    attributesCopied,
                    customContentAdded: !!customContent,
                    finalContentLength: finalContent.length
                }
            );

        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            log.error(`Error executing create_with_template tool: ${errorMessage}`);

            return ToolResponseFormatter.error(
                `Template creation failed: ${errorMessage}`,
                {
                    possibleCauses: [
                        'Search or creation service connectivity issue',
                        'Invalid template or parameters provided',
                        'Database transaction failure',
                        'Template content processing error'
                    ],
                    suggestions: [
                        'Try with simpler template and parameters',
                        'Use individual operations: smart_search, read_note, create_note',
                        'Check if Trilium service is running properly',
                        'Verify template exists and is accessible'
                    ],
                    examples: [
                        'smart_search("template")',
                        'create_note("simple title", "content")',
                        'create_with_template("title", {"templateQuery": "simple template"})'
                    ]
                }
            );
        }
    }

    /**
     * Execute the create with template tool (legacy method for backward compatibility)
     */
    public async execute(args: {
        title: string,
        templateQuery?: string,
        parentNoteId?: string,
        placeholders?: Record<string, string>,
        copyAttributes?: boolean,
        templateNoteId?: string,
        customContent?: string
    }): Promise<string | object> {
        const standardizedResponse = await this.executeStandardized(args);

        // For backward compatibility, return the legacy format
        if (standardizedResponse.success) {
            const result = standardizedResponse.result as CreateWithTemplateResult;
            return {
                success: true,
                noteId: result.createdNote.noteId,
                title: result.createdNote.title,
                templateUsed: result.templateSearch.selectedTemplate?.title,
                contentLength: result.createdNote.contentLength,
                attributesCopied: result.createdNote.attributesCopied,
                placeholdersReplaced: result.templateContent.placeholdersReplaced,
                message: `Created note "${result.createdNote.title}" using template "${result.templateSearch.selectedTemplate?.title}" with ${result.templateContent.placeholdersReplaced} placeholder replacements.`
            };
        } else {
            return `Error: ${standardizedResponse.error}`;
        }
    }
}