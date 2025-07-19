/**
 * Tool Discovery Helper
 *
 * This tool helps LLMs understand what tools are available and when to use them.
 * It provides smart recommendations based on user queries and current context.
 */

import type { Tool, ToolHandler } from './tool_interfaces.js';
import log from '../../log.js';
import toolRegistry from './tool_registry.js';

/**
 * Definition of the tool discovery helper
 */
export const toolDiscoveryHelperDefinition: Tool = {
    type: 'function',
    function: {
        name: 'discover_tools',
        description: 'Get recommendations for which tools to use for your task. Helps when you\'re unsure which tool is best.',
        parameters: {
            type: 'object',
            properties: {
                taskDescription: {
                    type: 'string',
                    description: 'Describe what you want to accomplish (e.g., "find notes about machine learning", "read a specific note").'
                },
                includeExamples: {
                    type: 'boolean',
                    description: 'Include usage examples for recommended tools (default: true).'
                },
                showAllTools: {
                    type: 'boolean',
                    description: 'Show all available tools instead of just recommendations (default: false).'
                }
            },
            required: ['taskDescription']
        }
    }
};

/**
 * Tool discovery helper implementation
 */
export class ToolDiscoveryHelper implements ToolHandler {
    public definition: Tool = toolDiscoveryHelperDefinition;

    /**
     * Map task types to relevant tools
     */
    private getRelevantTools(taskDescription: string): string[] {
        const task = taskDescription.toLowerCase();
        const relevantTools: string[] = [];

        // Search-related tasks
        if (task.includes('find') || task.includes('search') || task.includes('look for')) {
            if (task.includes('tag') || task.includes('label') || task.includes('attribute') || task.includes('category')) {
                relevantTools.push('attribute_search');
            }
            if (task.includes('concept') || task.includes('about') || task.includes('related to')) {
                relevantTools.push('search_notes');
            }
            if (task.includes('exact') || task.includes('specific') || task.includes('contains')) {
                relevantTools.push('keyword_search_notes');
            }
            // Default to both semantic and keyword search if no specific indicators
            if (!relevantTools.some(tool => tool.includes('search'))) {
                relevantTools.push('search_notes', 'keyword_search_notes');
            }
        }

        // Reading tasks
        if (task.includes('read') || task.includes('view') || task.includes('show') || task.includes('content')) {
            relevantTools.push('read_note');
        }

        // Creation tasks
        if (task.includes('create') || task.includes('new') || task.includes('add') || task.includes('make')) {
            relevantTools.push('note_creation');
        }

        // Modification tasks
        if (task.includes('edit') || task.includes('update') || task.includes('change') || task.includes('modify')) {
            relevantTools.push('note_update');
        }

        // Attribute/metadata tasks
        if (task.includes('attribute') || task.includes('tag') || task.includes('label') || task.includes('metadata')) {
            relevantTools.push('attribute_manager');
        }

        // Relationship tasks
        if (task.includes('relation') || task.includes('connect') || task.includes('link') || task.includes('relationship')) {
            relevantTools.push('relationship');
        }

        // Summary tasks
        if (task.includes('summary') || task.includes('summarize') || task.includes('overview')) {
            relevantTools.push('note_summarization');
        }

        // Calendar tasks
        if (task.includes('calendar') || task.includes('date') || task.includes('schedule') || task.includes('time')) {
            relevantTools.push('calendar_integration');
        }

        // Content extraction tasks
        if (task.includes('extract') || task.includes('parse') || task.includes('analyze content')) {
            relevantTools.push('content_extraction');
        }

        return relevantTools;
    }

    /**
     * Get tool information with descriptions
     */
    private getToolInfo(): Record<string, { description: string; bestFor: string; parameters: string[] }> {
        return {
            'search': {
                description: '🔍 Universal search - automatically uses semantic, keyword, or attribute search',
                bestFor: 'ANY search need - it intelligently routes to the best search method',
                parameters: ['query (required)', 'searchType', 'maxResults', 'filters']
            },
            'search_notes': {
                description: '🧠 Semantic/conceptual search for notes',
                bestFor: 'Finding notes about ideas, concepts, or topics described in various ways',
                parameters: ['query (required)', 'parentNoteId', 'maxResults', 'summarize']
            },
            'keyword_search_notes': {
                description: '🔎 Exact keyword/phrase search for notes',
                bestFor: 'Finding notes with specific words, phrases, or using search operators',
                parameters: ['query (required)', 'maxResults', 'includeArchived']
            },
            'attribute_search': {
                description: '🏷️ Search notes by attributes (labels/relations)',
                bestFor: 'Finding notes by categories, tags, status, or metadata',
                parameters: ['attributeType (required)', 'attributeName (required)', 'attributeValue', 'maxResults']
            },
            'read_note': {
                description: '📖 Read full content of a specific note',
                bestFor: 'Getting complete note content after finding it through search',
                parameters: ['noteId (required)', 'includeAttributes']
            },
            'note_creation': {
                description: '📝 Create new notes',
                bestFor: 'Adding new content, projects, or ideas to your notes',
                parameters: ['title (required)', 'content', 'parentNoteId', 'noteType', 'attributes']
            },
            'note_update': {
                description: '✏️ Update existing note content',
                bestFor: 'Modifying or adding to existing note content',
                parameters: ['noteId (required)', 'title', 'content', 'updateMode']
            },
            'attribute_manager': {
                description: '🎯 Manage note attributes (labels, relations)',
                bestFor: 'Adding, removing, or modifying note metadata and tags',
                parameters: ['noteId (required)', 'action (required)', 'attributeType', 'attributeName', 'attributeValue']
            },
            'relationship': {
                description: '🔗 Manage note relationships',
                bestFor: 'Creating connections between notes',
                parameters: ['sourceNoteId (required)', 'action (required)', 'targetNoteId', 'relationType']
            },
            'note_summarization': {
                description: '📄 Summarize note content',
                bestFor: 'Getting concise overviews of long notes',
                parameters: ['noteId (required)', 'summaryType', 'maxLength']
            },
            'content_extraction': {
                description: '🎯 Extract specific information from notes',
                bestFor: 'Pulling out specific data, facts, or structured information',
                parameters: ['noteId (required)', 'extractionType (required)', 'criteria']
            },
            'calendar_integration': {
                description: '📅 Calendar and date-related operations',
                bestFor: 'Working with dates, schedules, and time-based organization',
                parameters: ['action (required)', 'date', 'noteId', 'eventDetails']
            },
            'search_suggestion': {
                description: '💡 Get search syntax help and suggestions',
                bestFor: 'Learning how to use advanced search features',
                parameters: ['searchType', 'query']
            }
        };
    }

    /**
     * Generate workflow recommendations
     */
    private generateWorkflow(taskDescription: string, relevantTools: string[]): string[] {
        const task = taskDescription.toLowerCase();
        const workflows: string[] = [];

        if (task.includes('find') && relevantTools.includes('search_notes')) {
            workflows.push('1. Use search_notes for conceptual search → 2. Use read_note with returned noteId for full content');
        }

        if (task.includes('find') && relevantTools.includes('attribute_search')) {
            workflows.push('1. Use attribute_search to find tagged notes → 2. Use read_note for detailed content');
        }

        if (task.includes('create') || task.includes('new')) {
            workflows.push('1. Use note_creation to make the note → 2. Use attribute_manager to add tags/metadata');
        }

        if (task.includes('update') || task.includes('edit')) {
            workflows.push('1. Use search tools to find the note → 2. Use read_note to see current content → 3. Use note_update to modify');
        }

        if (task.includes('organize') || task.includes('categorize')) {
            workflows.push('1. Use search tools to find notes → 2. Use attribute_manager to add labels/categories');
        }

        return workflows;
    }

    /**
     * Execute the tool discovery helper
     */
    public async execute(args: { 
        taskDescription: string, 
        includeExamples?: boolean, 
        showAllTools?: boolean 
    }): Promise<string | object> {
        try {
            const { taskDescription, includeExamples = true, showAllTools = false } = args;

            log.info(`Executing discover_tools - Task: "${taskDescription}", ShowAll: ${showAllTools}`);

            const allTools = toolRegistry.getAllTools();
            const toolInfo = this.getToolInfo();
            
            if (showAllTools) {
                // Show all available tools
                const allToolsInfo = allTools.map(tool => {
                    const name = tool.definition.function.name;
                    const info = toolInfo[name];
                    return {
                        name,
                        description: info?.description || tool.definition.function.description,
                        bestFor: info?.bestFor || 'General purpose tool',
                        parameters: info?.parameters || ['See tool definition for parameters']
                    };
                });

                return {
                    taskDescription,
                    mode: 'all_tools',
                    message: '🗂️ All available tools in the system',
                    totalTools: allToolsInfo.length,
                    tools: allToolsInfo,
                    tip: 'Use discover_tools with a specific task description for targeted recommendations'
                };
            }

            // Get relevant tools for the specific task
            const relevantToolNames = this.getRelevantTools(taskDescription);
            const workflows = this.generateWorkflow(taskDescription, relevantToolNames);

            const recommendations = relevantToolNames.map(toolName => {
                const info = toolInfo[toolName];
                const result: any = {
                    tool: toolName,
                    description: info?.description || 'Tool description not available',
                    bestFor: info?.bestFor || 'Not specified',
                    priority: this.getToolPriority(toolName, taskDescription)
                };

                if (includeExamples) {
                    result.exampleUsage = this.getToolExample(toolName, taskDescription);
                }

                return result;
            });

            // Sort by priority
            recommendations.sort((a, b) => a.priority - b.priority);

            return {
                taskDescription,
                mode: 'targeted_recommendations',
                message: `🎯 Found ${recommendations.length} relevant tools for your task`,
                recommendations,
                workflows: workflows.length > 0 ? {
                    message: '🔄 Suggested workflows for your task:',
                    steps: workflows
                } : undefined,
                nextSteps: {
                    immediate: recommendations.length > 0 
                        ? `Start with: ${recommendations[0].tool} (highest priority for your task)`
                        : 'Try rephrasing your task or use showAllTools: true to see all options',
                    alternative: 'Use showAllTools: true to see all available tools if these don\'t fit your needs'
                }
            };
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            log.error(`Error executing discover_tools: ${errorMessage}`);
            return `Error: ${errorMessage}`;
        }
    }

    /**
     * Get priority for a tool based on task description (lower = higher priority)
     */
    private getToolPriority(toolName: string, taskDescription: string): number {
        const task = taskDescription.toLowerCase();
        
        // Exact matches get highest priority
        if (task.includes(toolName.replace('_', ' '))) return 1;
        
        // Task-specific priorities
        if (task.includes('find') || task.includes('search')) {
            if (toolName === 'search_notes') return 2;
            if (toolName === 'keyword_search_notes') return 3;
            if (toolName === 'attribute_search') return 4;
        }
        
        if (task.includes('create') && toolName === 'note_creation') return 1;
        if (task.includes('read') && toolName === 'read_note') return 1;
        if (task.includes('update') && toolName === 'note_update') return 1;
        
        return 5; // Default priority
    }

    /**
     * Get example usage for a tool based on task description
     */
    private getToolExample(toolName: string, taskDescription: string): string {
        const task = taskDescription.toLowerCase();
        
        switch (toolName) {
            case 'search_notes':
                if (task.includes('machine learning')) {
                    return '{ "query": "machine learning algorithms classification" }';
                }
                return '{ "query": "project management methodologies" }';
                
            case 'keyword_search_notes':
                return '{ "query": "important TODO" }';
                
            case 'attribute_search':
                return '{ "attributeType": "label", "attributeName": "important" }';
                
            case 'read_note':
                return '{ "noteId": "abc123def456", "includeAttributes": true }';
                
            case 'note_creation':
                return '{ "title": "New Project Plan", "content": "Project details here..." }';
                
            case 'note_update':
                return '{ "noteId": "abc123def456", "content": "Updated content" }';
                
            default:
                return `Use ${toolName} with appropriate parameters`;
        }
    }
}