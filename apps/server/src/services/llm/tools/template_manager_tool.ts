/**
 * Template Manager Tool
 *
 * This tool allows the LLM to work with Trilium's template system. It can find, apply, create, and manage 
 * note templates, leveraging Trilium's template inheritance and attribute system.
 */

import type { Tool, ToolHandler, StandardizedToolResponse } from './tool_interfaces.js';
import { ToolResponseFormatter } from './tool_interfaces.js';
import { ParameterValidationHelpers } from './parameter_validation_helpers.js';
import log from '../../log.js';
import becca from '../../../becca/becca.js';
import notes from '../../notes.js';
import attributes from '../../attributes.js';
import type BNote from '../../../becca/entities/bnote.js';
import BAttribute from '../../../becca/entities/battribute.js';

/**
 * Helper function to safely convert content to string
 */
function getContentAsString(content: string | Buffer): string {
    if (Buffer.isBuffer(content)) {
        return content.toString('utf8');
    }
    return content;
}

/**
 * Definition of the template manager tool
 */
export const templateManagerToolDefinition: Tool = {
    type: 'function',
    function: {
        name: 'template_manager',
        description: 'Manage Trilium\'s template system. Find templates, apply templates to notes, create new templates, and manage template inheritance. Templates in Trilium automatically copy content and attributes to new notes.',
        parameters: {
            type: 'object',
            properties: {
                action: {
                    type: 'string',
                    description: 'The template action to perform',
                    enum: ['find_templates', 'apply_template', 'create_template', 'list_template_attributes', 'inherit_from_template', 'remove_template'],
                    default: 'find_templates'
                },
                templateQuery: {
                    type: 'string',
                    description: 'For "find_templates": Search terms to find template notes. Examples: "meeting template", "#template project", "daily standup template"'
                },
                templateNoteId: {
                    type: 'string',
                    description: 'For template operations: The noteId of the template note to use. Must be from search results or template findings.'
                },
                targetNoteId: {
                    type: 'string',
                    description: 'For "apply_template", "inherit_from_template": The noteId of the note to apply template to. Use noteId from search results.'
                },
                templateTitle: {
                    type: 'string',
                    description: 'For "create_template": Title for new template note. Examples: "Meeting Template", "Project Planning Template", "Daily Task Template"'
                },
                templateContent: {
                    type: 'string',
                    description: 'For "create_template": Content for the new template. Can include placeholders like {{date}}, {{project}}, {{attendees}} for replacement when applied.'
                },
                templateAttributes: {
                    type: 'array',
                    description: 'For "create_template": Attributes to include in template. These will be copied to notes that use this template.',
                    items: {
                        type: 'object',
                        properties: {
                            name: {
                                type: 'string',
                                description: 'Attribute name. Use "#tagName" for tags, "propertyName" for properties, "~relationName" for relations'
                            },
                            value: {
                                type: 'string',
                                description: 'Attribute value. Optional for tags, required for properties and relations'
                            },
                            inheritable: {
                                type: 'boolean',
                                description: 'Whether attribute should be inherited by child notes. Default false.'
                            }
                        },
                        required: ['name']
                    }
                },
                replaceContent: {
                    type: 'boolean',
                    description: 'For "apply_template": Whether to replace existing content (true) or append template content (false). Default true.',
                    default: true
                },
                placeholders: {
                    type: 'object',
                    description: 'For "apply_template": Key-value pairs to replace placeholders in template. Examples: {"date": "2024-01-15", "project": "Website", "status": "In Progress"}'
                },
                parentNoteId: {
                    type: 'string',
                    description: 'For "create_template": Where to create the template note. Templates are often stored in a Templates folder.'
                }
            },
            required: ['action']
        }
    }
};

/**
 * Template manager tool implementation
 */
export class TemplateManagerTool implements ToolHandler {
    public definition: Tool = templateManagerToolDefinition;

    /**
     * Execute the template manager tool with standardized response format
     */
    public async executeStandardized(args: {
        action: 'find_templates' | 'apply_template' | 'create_template' | 'list_template_attributes' | 'inherit_from_template' | 'remove_template',
        templateQuery?: string,
        templateNoteId?: string,
        targetNoteId?: string,
        templateTitle?: string,
        templateContent?: string,
        templateAttributes?: Array<{ name: string, value?: string, inheritable?: boolean }>,
        replaceContent?: boolean,
        placeholders?: Record<string, string>,
        parentNoteId?: string
    }): Promise<StandardizedToolResponse> {
        const startTime = Date.now();

        try {
            const { action, templateQuery, templateNoteId, targetNoteId, templateTitle, templateContent, templateAttributes, replaceContent = true, placeholders, parentNoteId } = args;

            log.info(`Executing template_manager tool - Action: "${action}"`);

            // Validate action
            const actionValidation = ParameterValidationHelpers.validateAction(
                action, 
                ['find_templates', 'apply_template', 'create_template', 'list_template_attributes', 'inherit_from_template', 'remove_template'],
                {
                    'find_templates': 'Search for existing template notes',
                    'apply_template': 'Apply a template to an existing note',
                    'create_template': 'Create a new template note',
                    'list_template_attributes': 'Show what attributes a template provides',
                    'inherit_from_template': 'Set up template inheritance relationship',
                    'remove_template': 'Remove template relationship from a note'
                }
            );
            if (actionValidation) {
                return actionValidation;
            }

            // Execute the requested action
            const result = await this.executeTemplateAction(
                action, 
                templateQuery, 
                templateNoteId, 
                targetNoteId, 
                templateTitle, 
                templateContent, 
                templateAttributes, 
                replaceContent, 
                placeholders, 
                parentNoteId
            );

            if (!result.success) {
                return ToolResponseFormatter.error(result.error || 'Template operation failed', result.help || {
                    possibleCauses: ['Template operation failed'],
                    suggestions: ['Check template parameters', 'Verify note exists and is accessible']
                });
            }

            const executionTime = Date.now() - startTime;

            const nextSteps = {
                suggested: this.getNextStepsSuggestion(action, result.data),
                alternatives: [
                    'Use search_notes to find more templates',
                    'Use read_note to examine template content and structure',
                    'Use attribute_manager to modify template attributes',
                    'Use template_manager with different actions to manage templates'
                ],
                examples: [
                    result.data?.createdTemplateId ? `read_note("${result.data.createdTemplateId}")` : 'search_notes("#template")',
                    result.data?.targetNoteId ? `read_note("${result.data.targetNoteId}")` : 'template_manager("find_templates", "meeting")',
                    'attribute_manager(noteId, "add", "#template")'
                ]
            };

            return ToolResponseFormatter.success(
                result.data,
                nextSteps,
                {
                    executionTime,
                    resourcesUsed: ['database', 'templates', 'attributes'],
                    action,
                    operationDuration: result.operationTime,
                    triliumConcept: "Templates in Trilium automatically copy content and attributes to new notes, enabling consistent note structures and workflows."
                }
            );

        } catch (error: any) {
            const errorMessage = error.message || String(error);
            log.error(`Error executing template_manager tool: ${errorMessage}`);
            
            return ToolResponseFormatter.error(
                `Template management failed: ${errorMessage}`,
                {
                    possibleCauses: [
                        'Database access error',
                        'Invalid template parameters',
                        'Template not found or inaccessible',
                        'Insufficient permissions'
                    ],
                    suggestions: [
                        'Check if Trilium service is running properly',
                        'Verify template and target noteIds are valid',
                        'Ensure templates exist and are accessible',
                        'Try with simpler template operations first'
                    ]
                }
            );
        }
    }

    /**
     * Execute the specific template action
     */
    private async executeTemplateAction(
        action: string,
        templateQuery?: string,
        templateNoteId?: string,
        targetNoteId?: string,
        templateTitle?: string,
        templateContent?: string,
        templateAttributes?: Array<{ name: string, value?: string, inheritable?: boolean }>,
        replaceContent?: boolean,
        placeholders?: Record<string, string>,
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
                case 'find_templates':
                    return await this.executeFindTemplates(templateQuery);
                
                case 'apply_template':
                    return await this.executeApplyTemplate(templateNoteId!, targetNoteId!, replaceContent!, placeholders);
                
                case 'create_template':
                    return await this.executeCreateTemplate(templateTitle!, templateContent!, templateAttributes, parentNoteId);
                
                case 'list_template_attributes':
                    return await this.executeListTemplateAttributes(templateNoteId!);
                
                case 'inherit_from_template':
                    return await this.executeInheritFromTemplate(templateNoteId!, targetNoteId!);
                
                case 'remove_template':
                    return await this.executeRemoveTemplate(targetNoteId!);
                
                default:
                    return {
                        success: false,
                        error: `Unsupported action: ${action}`,
                        help: {
                            possibleCauses: ['Invalid action parameter'],
                            suggestions: ['Use one of: find_templates, apply_template, create_template, list_template_attributes, inherit_from_template, remove_template']
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
     * Find template notes
     */
    private async executeFindTemplates(templateQuery?: string): Promise<any> {
        const operationStart = Date.now();

        if (!templateQuery) {
            return {
                success: false,
                error: 'Template query is required for finding templates',
                help: {
                    possibleCauses: ['Missing templateQuery parameter'],
                    suggestions: ['Provide search terms like "meeting template", "#template", "project template"']
                },
                operationTime: Date.now() - operationStart
            };
        }

        // Search for templates
        const allNotes = Object.values(becca.notes);
        const templateNotes: Array<{
            noteId: string;
            title: string;
            type: string;
            score: number;
            hasTemplateLabel: boolean;
            hasTemplateRelation: boolean;
            attributeCount: number;
            contentLength: number;
            parents: Array<{ noteId: string; title: string }>;
        }> = [];

        // First, find notes that are explicitly marked as templates
        for (const note of allNotes) {
            const isTemplate = note.hasLabel('template') || 
                              note.hasRelation('template') ||
                              note.title.toLowerCase().includes('template') ||
                              (templateQuery && note.title.toLowerCase().includes(templateQuery.toLowerCase()));
            
            if (isTemplate) {
                // Calculate relevance score
                let score = 0;
                
                if (note.hasLabel('template')) score += 50;
                if (note.hasRelation('template')) score += 50;
                if (note.title.toLowerCase().includes('template')) score += 30;
                
                if (templateQuery) {
                    const queryWords = templateQuery.toLowerCase().split(' ');
                    const titleWords = note.title.toLowerCase().split(' ');
                    const content = note.getContent();
                    const contentWords = (typeof content === 'string' ? content.toLowerCase() : content.toString()).split(' ');
                    
                    for (const queryWord of queryWords) {
                        if (titleWords.some(word => word.includes(queryWord))) score += 20;
                        if (contentWords.some(word => word.includes(queryWord))) score += 10;
                        
                        // Check attributes
                        for (const attr of note.getAttributes()) {
                            if (attr.name.toLowerCase().includes(queryWord) || 
                                (attr.value && attr.value.toLowerCase().includes(queryWord))) {
                                score += 5;
                            }
                        }
                    }
                }

                if (score > 0) {
                    templateNotes.push({
                        noteId: note.noteId,
                        title: note.title,
                        type: note.type,
                        score,
                        hasTemplateLabel: note.hasLabel('template'),
                        hasTemplateRelation: note.hasRelation('template'),
                        attributeCount: note.getAttributes().length,
                        contentLength: getContentAsString(note.getContent()).length,
                        parents: note.parents.map(p => ({ noteId: p.noteId, title: p.title }))
                    });
                }
            }
        }

        // Sort by score (highest first)
        templateNotes.sort((a, b) => b.score - a.score);

        return {
            success: true,
            data: {
                query: templateQuery,
                templatesFound: templateNotes.length,
                templates: templateNotes.slice(0, 10), // Limit to top 10 results
                searchCriteria: {
                    explicitTemplateLabel: 'Notes with #template label',
                    templateRelation: 'Notes with ~template relation',
                    titleContainsTemplate: 'Notes with "template" in title',
                    queryMatch: templateQuery ? `Notes matching "${templateQuery}"` : null
                }
            },
            operationTime: Date.now() - operationStart
        };
    }

    /**
     * Apply template to a note
     */
    private async executeApplyTemplate(
        templateNoteId: string,
        targetNoteId: string,
        replaceContent: boolean,
        placeholders?: Record<string, string>
    ): Promise<any> {
        const operationStart = Date.now();

        // Validate template and target notes
        const templateNote = becca.getNote(templateNoteId);
        if (!templateNote) {
            return {
                success: false,
                error: `Template note not found: "${templateNoteId}"`,
                help: {
                    possibleCauses: ['Invalid template noteId', 'Template note was deleted'],
                    suggestions: ['Use find_templates to locate template notes', 'Verify template noteId is correct']
                },
                operationTime: Date.now() - operationStart
            };
        }

        const targetNote = becca.getNote(targetNoteId);
        if (!targetNote) {
            return {
                success: false,
                error: `Target note not found: "${targetNoteId}"`,
                help: {
                    possibleCauses: ['Invalid target noteId', 'Target note was deleted'],
                    suggestions: ['Use search_notes to find target note', 'Verify target noteId is correct']
                },
                operationTime: Date.now() - operationStart
            };
        }

        let appliedAttributes = 0;
        let contentProcessed = false;
        let placeholdersReplaced = 0;

        try {
            // Copy content
            let templateContent = getContentAsString(templateNote.getContent());
            
            // Replace placeholders if provided
            if (placeholders) {
                for (const [placeholder, value] of Object.entries(placeholders)) {
                    const regex = new RegExp(`{{\\s*${placeholder}\\s*}}`, 'gi');
                    const beforeCount = (templateContent.match(regex) || []).length;
                    templateContent = templateContent.replace(regex, value);
                    const afterCount = (templateContent.match(regex) || []).length;
                    placeholdersReplaced += beforeCount - afterCount;
                }
            }

            // Apply content
            if (replaceContent) {
                targetNote.setContent(templateContent);
            } else {
                const existingContent = getContentAsString(targetNote.getContent());
                targetNote.setContent(existingContent + '\n\n' + templateContent);
            }
            contentProcessed = true;

            // Copy attributes from template
            const templateAttributes = templateNote.getAttributes();
            for (const attr of templateAttributes) {
                try {
                    // Skip certain system attributes
                    if (['template', 'child:template'].includes(attr.name)) continue;

                    // Check if attribute already exists
                    const existingAttr = targetNote.getAttribute(attr.type, attr.name);
                    if (existingAttr) continue; // Don't overwrite existing attributes

                    // Create new attribute
                    new BAttribute({
                        noteId: targetNote.noteId,
                        type: attr.type,
                        name: attr.name,
                        value: attr.value,
                        position: attr.position,
                        isInheritable: attr.isInheritable
                    }).save();

                    appliedAttributes++;
                } catch (error: any) {
                    log.error(`Failed to copy attribute ${attr.name}: ${error.message}`);
                }
            }

            // Add template relation to target note (for tracking)
            try {
                const existingRelation = targetNote.getRelation('template');
                if (!existingRelation) {
                    new BAttribute({
                        noteId: targetNote.noteId,
                        type: 'relation',
                        name: 'template',
                        value: templateNoteId
                    }).save();
                }
            } catch (error: any) {
                log.error(`Failed to add template relation: ${error.message}`);
            }

            return {
                success: true,
                data: {
                    templateNoteId,
                    templateTitle: templateNote.title,
                    targetNoteId,
                    targetTitle: targetNote.title,
                    contentReplaced: replaceContent,
                    contentProcessed,
                    attributesApplied: appliedAttributes,
                    totalTemplateAttributes: templateAttributes.length,
                    placeholdersReplaced,
                    availablePlaceholders: this.extractPlaceholders(getContentAsString(templateNote.getContent()))
                },
                operationTime: Date.now() - operationStart
            };

        } catch (error: any) {
            return {
                success: false,
                error: `Failed to apply template: ${error.message}`,
                help: {
                    possibleCauses: ['Content processing error', 'Attribute copying error', 'Database write error'],
                    suggestions: ['Check template content format', 'Verify target note is writable', 'Try applying template without placeholders first']
                },
                operationTime: Date.now() - operationStart
            };
        }
    }

    /**
     * Create a new template note
     */
    private async executeCreateTemplate(
        templateTitle: string,
        templateContent: string,
        templateAttributes?: Array<{ name: string, value?: string, inheritable?: boolean }>,
        parentNoteId?: string
    ): Promise<any> {
        const operationStart = Date.now();

        if (!templateTitle || !templateContent) {
            return {
                success: false,
                error: 'Template title and content are required',
                help: {
                    possibleCauses: ['Missing required parameters'],
                    suggestions: ['Provide both templateTitle and templateContent', 'Include example template structure']
                },
                operationTime: Date.now() - operationStart
            };
        }

        try {
            // Determine parent (Templates folder or root)
            let parent: any = null;
            if (parentNoteId) {
                parent = becca.getNote(parentNoteId);
                if (!parent) {
                    return {
                        success: false,
                        error: `Parent note not found: "${parentNoteId}"`,
                        help: {
                            possibleCauses: ['Invalid parent noteId'],
                            suggestions: ['Use search_notes to find Templates folder', 'Omit parentNoteId to create in root']
                        },
                        operationTime: Date.now() - operationStart
                    };
                }
            } else {
                // Look for Templates folder
                const allNotes = Object.values(becca.notes);
                parent = allNotes.find(note => 
                    note.title.toLowerCase() === 'templates' || 
                    note.title.toLowerCase().includes('template')
                ) || becca.getNote('root');
            }

            // Create the template note
            const result = notes.createNewNote({
                parentNoteId: parent.noteId,
                title: templateTitle,
                content: templateContent,
                type: 'text',
                mime: 'text/html'
            });

            const templateNote = result.note;
            let attributesAdded = 0;

            // Mark as template
            new BAttribute({
                noteId: templateNote.noteId,
                type: 'label',
                name: 'template',
                value: ''
            }).save();
            attributesAdded++;

            // Add custom attributes if provided
            if (templateAttributes && templateAttributes.length > 0) {
                for (const attr of templateAttributes) {
                    try {
                        new BAttribute({
                            noteId: templateNote.noteId,
                            type: attr.name.startsWith('#') ? 'label' : 
                                  attr.name.startsWith('~') ? 'relation' : 'label',
                            name: attr.name.replace(/^[#~]/, ''),
                            value: attr.value || '',
                            isInheritable: attr.inheritable || false
                        }).save();
                        attributesAdded++;
                    } catch (error: any) {
                        log.error(`Failed to add template attribute ${attr.name}: ${error.message}`);
                    }
                }
            }

            const placeholders = this.extractPlaceholders(templateContent);

            return {
                success: true,
                data: {
                    createdTemplateId: templateNote.noteId,
                    templateTitle: templateNote.title,
                    parentId: parent.noteId,
                    parentTitle: parent.title,
                    contentLength: templateContent.length,
                    attributesAdded,
                    placeholdersFound: placeholders.length,
                    placeholders,
                    usage: `Use template_manager("apply_template", templateNoteId="${templateNote.noteId}", targetNoteId="...")`,
                },
                operationTime: Date.now() - operationStart
            };

        } catch (error: any) {
            return {
                success: false,
                error: `Failed to create template: ${error.message}`,
                help: {
                    possibleCauses: ['Template creation error', 'Database write error', 'Invalid parameters'],
                    suggestions: ['Check template content format', 'Verify parent note exists', 'Try with simpler template first']
                },
                operationTime: Date.now() - operationStart
            };
        }
    }

    /**
     * List attributes that a template provides
     */
    private async executeListTemplateAttributes(templateNoteId: string): Promise<any> {
        const operationStart = Date.now();

        const templateNote = becca.getNote(templateNoteId);
        if (!templateNote) {
            return {
                success: false,
                error: `Template note not found: "${templateNoteId}"`,
                help: {
                    possibleCauses: ['Invalid template noteId'],
                    suggestions: ['Use find_templates to locate template notes']
                },
                operationTime: Date.now() - operationStart
            };
        }

        const attributes = templateNote.getAttributes();
        const placeholders = this.extractPlaceholders(getContentAsString(templateNote.getContent()));

        return {
            success: true,
            data: {
                templateNoteId,
                templateTitle: templateNote.title,
                totalAttributes: attributes.length,
                attributes: attributes.map(attr => ({
                    name: attr.name,
                    type: attr.type,
                    value: attr.value,
                    inheritable: attr.isInheritable,
                    description: this.getAttributeDescription(attr.name, attr.type)
                })),
                placeholdersFound: placeholders.length,
                placeholders: placeholders.map(p => ({
                    name: p,
                    example: this.getPlaceholderExample(p),
                    usage: `"placeholders": {"${p}": "your_value_here"}`
                })),
                usage: {
                    applyTemplate: `template_manager("apply_template", templateNoteId="${templateNoteId}", targetNoteId="target_note_id")`,
                    withPlaceholders: placeholders.length > 0 ? 
                        `template_manager("apply_template", templateNoteId="${templateNoteId}", targetNoteId="target_note_id", placeholders={"${placeholders[0]}": "example_value"})` : 
                        null
                }
            },
            operationTime: Date.now() - operationStart
        };
    }

    /**
     * Set up template inheritance relationship
     */
    private async executeInheritFromTemplate(templateNoteId: string, targetNoteId: string): Promise<any> {
        const operationStart = Date.now();

        const templateNote = becca.getNote(templateNoteId);
        const targetNote = becca.getNote(targetNoteId);

        if (!templateNote) {
            return {
                success: false,
                error: `Template note not found: "${templateNoteId}"`,
                help: {
                    possibleCauses: ['Invalid template noteId'],
                    suggestions: ['Use find_templates to locate template notes']
                },
                operationTime: Date.now() - operationStart
            };
        }

        if (!targetNote) {
            return {
                success: false,
                error: `Target note not found: "${targetNoteId}"`,
                help: {
                    possibleCauses: ['Invalid target noteId'],
                    suggestions: ['Use search_notes to find target note']
                },
                operationTime: Date.now() - operationStart
            };
        }

        try {
            // Add template relation
            new BAttribute({
                noteId: targetNote.noteId,
                type: 'relation',
                name: 'template',
                value: templateNoteId
            }).save();

            return {
                success: true,
                data: {
                    templateNoteId,
                    templateTitle: templateNote.title,
                    targetNoteId,
                    targetTitle: targetNote.title,
                    relationshipEstablished: true,
                    effect: 'Target note will now inherit from template when created/modified'
                },
                operationTime: Date.now() - operationStart
            };

        } catch (error: any) {
            return {
                success: false,
                error: `Failed to establish template inheritance: ${error.message}`,
                help: {
                    possibleCauses: ['Database write error', 'Attribute creation error'],
                    suggestions: ['Check if template relationship already exists', 'Verify note permissions']
                },
                operationTime: Date.now() - operationStart
            };
        }
    }

    /**
     * Remove template relationship from a note
     */
    private async executeRemoveTemplate(targetNoteId: string): Promise<any> {
        const operationStart = Date.now();

        const targetNote = becca.getNote(targetNoteId);
        if (!targetNote) {
            return {
                success: false,
                error: `Target note not found: "${targetNoteId}"`,
                help: {
                    possibleCauses: ['Invalid target noteId'],
                    suggestions: ['Use search_notes to find target note']
                },
                operationTime: Date.now() - operationStart
            };
        }

        try {
            const templateRelations = targetNote.getRelations('template');
            let removedRelations = 0;

            for (const relation of templateRelations) {
                relation.markAsDeleted();
                removedRelations++;
            }

            return {
                success: true,
                data: {
                    targetNoteId,
                    targetTitle: targetNote.title,
                    removedRelations,
                    effect: removedRelations > 0 ? 'Template inheritance removed' : 'No template relationships found'
                },
                operationTime: Date.now() - operationStart
            };

        } catch (error: any) {
            return {
                success: false,
                error: `Failed to remove template relationship: ${error.message}`,
                help: {
                    possibleCauses: ['Database write error', 'Attribute deletion error'],
                    suggestions: ['Verify note permissions', 'Check if template relationships exist']
                },
                operationTime: Date.now() - operationStart
            };
        }
    }

    /**
     * Extract placeholders from template content
     */
    private extractPlaceholders(content: string): string[] {
        const placeholderRegex = /{{\s*([^}]+)\s*}}/g;
        const placeholders: string[] = [];
        let match;
        
        while ((match = placeholderRegex.exec(content)) !== null) {
            const placeholder = match[1].trim();
            if (!placeholders.includes(placeholder)) {
                placeholders.push(placeholder);
            }
        }
        
        return placeholders;
    }

    /**
     * Get description for attribute based on name and type
     */
    private getAttributeDescription(name: string, type: string): string {
        if (type === 'label') {
            if (name === 'template') return 'Marks this note as a template';
            if (name.startsWith('child:')) return 'Inherited by child notes';
            return 'Custom label/tag attribute';
        } else if (type === 'relation') {
            if (name === 'template') return 'Links to template note';
            return 'Custom relation to another note';
        }
        return 'Custom attribute';
    }

    /**
     * Get example value for placeholder
     */
    private getPlaceholderExample(placeholder: string): string {
        const examples: Record<string, string> = {
            'date': '2024-01-15',
            'time': '14:30',
            'name': 'John Doe',
            'project': 'Website Redesign',
            'status': 'In Progress',
            'priority': 'High',
            'attendees': 'Alice, Bob, Charlie',
            'location': 'Conference Room A',
            'agenda': 'Project status, Next steps',
            'notes': 'Meeting notes here',
            'action_items': 'Tasks to complete',
            'due_date': '2024-01-30'
        };
        
        return examples[placeholder.toLowerCase()] || `example_${placeholder}`;
    }

    /**
     * Get suggested next steps based on action
     */
    private getNextStepsSuggestion(action: string, data: any): string {
        switch (action) {
            case 'find_templates':
                return data.templatesFound > 0 ? 
                    `Use template_manager("list_template_attributes", templateNoteId="${data.templates[0]?.noteId}") to examine the best template` :
                    'Create a new template with template_manager("create_template", ...)';
            case 'apply_template':
                return `Use read_note("${data.targetNoteId}") to see the note with applied template`;
            case 'create_template':
                return `Use template_manager("apply_template", templateNoteId="${data.createdTemplateId}", targetNoteId="...") to use the new template`;
            case 'list_template_attributes':
                return `Use template_manager("apply_template", templateNoteId="${data.templateNoteId}", targetNoteId="...") to apply this template`;
            case 'inherit_from_template':
                return `Template inheritance established. New child notes will inherit from template.`;
            case 'remove_template':
                return `Template relationship removed. Note is no longer linked to template.`;
            default:
                return 'Use template_manager with different actions to manage templates';
        }
    }

    /**
     * Execute the template manager tool (legacy method for backward compatibility)
     */
    public async execute(args: {
        action: 'find_templates' | 'apply_template' | 'create_template' | 'list_template_attributes' | 'inherit_from_template' | 'remove_template',
        templateQuery?: string,
        templateNoteId?: string,
        targetNoteId?: string,
        templateTitle?: string,
        templateContent?: string,
        templateAttributes?: Array<{ name: string, value?: string, inheritable?: boolean }>,
        replaceContent?: boolean,
        placeholders?: Record<string, string>,
        parentNoteId?: string
    }): Promise<string | object> {
        // Delegate to the standardized method
        const standardizedResponse = await this.executeStandardized(args);

        // For backward compatibility, return the legacy format
        if (standardizedResponse.success) {
            const result = standardizedResponse.result as any;
            return {
                success: true,
                action: result.action || args.action,
                message: `Template ${args.action} completed successfully`,
                data: result
            };
        } else {
            return `Error: ${standardizedResponse.error}`;
        }
    }
}