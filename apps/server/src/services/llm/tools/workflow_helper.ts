/**
 * Workflow Helper Tool
 *
 * This tool helps LLMs understand and execute multi-step workflows by providing
 * smart guidance on tool chaining and next steps.
 */

import type { Tool, ToolHandler } from './tool_interfaces.js';
import log from '../../log.js';

/**
 * Definition of the workflow helper tool
 */
export const workflowHelperDefinition: Tool = {
    type: 'function',
    function: {
        name: 'workflow_helper',
        description: `WORKFLOW GUIDANCE for multi-step tasks. Get smart suggestions for tool chaining and next steps.
        
        BEST FOR: Planning complex workflows, understanding tool sequences, getting unstuck
        USE WHEN: You need to do multiple operations, aren't sure what to do next, or want workflow optimization
        HELPS WITH: Tool sequencing, parameter passing, workflow planning
        
        TIP: Use this when you have partial results and need guidance on next steps
        
        NEXT STEPS: Follow the recommended workflow steps provided`,
        parameters: {
            type: 'object',
            properties: {
                currentStep: {
                    type: 'string',
                    description: `📍 DESCRIBE YOUR CURRENT STEP: What have you just done or what results do you have?
                    
                    ✅ GOOD EXAMPLES:
                    - "I just found 5 notes about machine learning using search_notes"
                    - "I have a noteId abc123def456 and want to modify it"
                    - "I searched but got no results"
                    - "I created a new note and want to organize it"
                    
                    💡 Be specific about your current state and what you've accomplished`
                },
                goal: {
                    type: 'string',
                    description: `🎯 FINAL GOAL: What are you ultimately trying to accomplish?
                    
                    ✅ EXAMPLES:
                    - "Find and read all notes about a specific project"
                    - "Create a comprehensive summary of all my research notes"
                    - "Organize all my TODO notes by priority"
                    - "Find related notes and create connections between them"`
                },
                availableData: {
                    type: 'string',
                    description: `📊 AVAILABLE DATA: What noteIds, search results, or other data do you currently have?
                    
                    ✅ EXAMPLES:
                    - "noteIds: abc123, def456, ghi789"
                    - "Search results with 3 notes about project management"
                    - "Empty search results for machine learning"
                    - "Just created noteId xyz999"`
                },
                includeExamples: {
                    type: 'boolean',
                    description: '📚 INCLUDE EXAMPLES: Get specific command examples for next steps (default: true)'
                }
            },
            required: ['currentStep', 'goal']
        }
    }
};

/**
 * Workflow helper implementation
 */
export class WorkflowHelper implements ToolHandler {
    public definition: Tool = workflowHelperDefinition;

    /**
     * Common workflow patterns
     */
    private getWorkflowPatterns(): Record<string, {
        name: string;
        description: string;
        steps: string[];
        examples: string[];
    }> {
        return {
            'search_read_analyze': {
                name: '🔍➡️📖➡️🧠 Search → Read → Analyze',
                description: 'Find notes, read their content, then analyze or summarize',
                steps: [
                    'Use search tools to find relevant notes',
                    'Use read_note to get full content of interesting results',
                    'Use note_summarization or content_extraction for analysis'
                ],
                examples: [
                    'Research project: Find all research notes → Read them → Summarize findings',
                    'Learning topic: Search for learning materials → Read content → Extract key concepts'
                ]
            },
            'search_create_organize': {
                name: '🔍➡️📝➡️🏷️ Search → Create → Organize',
                description: 'Find related content, create new notes, then organize with attributes',
                steps: [
                    'Search for related existing content',
                    'Create new note with note_creation',
                    'Add attributes/relations with attribute_manager'
                ],
                examples: [
                    'New project: Find similar projects → Create project note → Tag with #project',
                    'Meeting notes: Search for project context → Create meeting note → Link to project'
                ]
            },
            'find_read_update': {
                name: '🔍➡️📖➡️✏️ Find → Read → Update',
                description: 'Find existing notes, review content, then make updates',
                steps: [
                    'Use search tools to locate the note',
                    'Use read_note to see current content',
                    'Use note_update to make changes'
                ],
                examples: [
                    'Update project status: Find project note → Read current status → Update with progress',
                    'Improve documentation: Find doc note → Read content → Add new information'
                ]
            },
            'organize_existing': {
                name: '🔍➡️🏷️➡️🔗 Find → Tag → Connect',
                description: 'Find notes that need organization, add attributes, create relationships',
                steps: [
                    'Search for notes to organize',
                    'Use attribute_manager to add labels/categories',
                    'Use relationship tool to create connections'
                ],
                examples: [
                    'Organize research: Find research notes → Tag by topic → Link related studies',
                    'Clean up TODOs: Find TODO notes → Tag by priority → Link to projects'
                ]
            }
        };
    }

    /**
     * Analyze current step and recommend next actions
     */
    private analyzeCurrentStep(currentStep: string, goal: string, availableData?: string): {
        analysis: string;
        recommendations: Array<{
            action: string;
            tool: string;
            parameters: Record<string, any>;
            reasoning: string;
            priority: number;
        }>;
        warnings?: string[];
    } {
        const step = currentStep.toLowerCase();
        const goalLower = goal.toLowerCase();
        const recommendations: any[] = [];
        const warnings: string[] = [];

        // Analyze search results
        if (step.includes('found') && step.includes('notes')) {
            if (step.includes('no results') || step.includes('empty') || step.includes('0 notes')) {
                recommendations.push({
                    action: 'Try alternative search approaches',
                    tool: 'search_notes',
                    parameters: { query: 'broader or alternative search terms' },
                    reasoning: 'Empty results suggest need for different search strategy',
                    priority: 1
                });
                recommendations.push({
                    action: 'Try keyword search instead',
                    tool: 'keyword_search_notes',
                    parameters: { query: 'specific keywords from your search' },
                    reasoning: 'Keyword search might find what semantic search missed',
                    priority: 2
                });
                warnings.push('Consider if the content might not exist yet - you may need to create it');
            } else {
                // Has search results
                recommendations.push({
                    action: 'Read the most relevant notes',
                    tool: 'read_note',
                    parameters: { noteId: 'from search results', includeAttributes: true },
                    reasoning: 'Get full content to understand what you found',
                    priority: 1
                });
                
                if (goalLower.includes('summary') || goalLower.includes('analyze')) {
                    recommendations.push({
                        action: 'Summarize the content',
                        tool: 'note_summarization',
                        parameters: { noteId: 'from search results' },
                        reasoning: 'Goal involves analysis or summarization',
                        priority: 2
                    });
                }
            }
        }

        // Analyze note reading
        if (step.includes('read') || step.includes('noteId')) {
            if (goalLower.includes('update') || goalLower.includes('edit') || goalLower.includes('modify')) {
                recommendations.push({
                    action: 'Update the note content',
                    tool: 'note_update',
                    parameters: { noteId: 'the one you just read', content: 'new content' },
                    reasoning: 'Goal involves modifying existing content',
                    priority: 1
                });
            }
            
            if (goalLower.includes('organize') || goalLower.includes('tag') || goalLower.includes('categorize')) {
                recommendations.push({
                    action: 'Add organizing attributes',
                    tool: 'attribute_manager',
                    parameters: { noteId: 'the one you read', action: 'add', attributeType: 'label' },
                    reasoning: 'Goal involves organization and categorization',
                    priority: 1
                });
            }
            
            if (goalLower.includes('related') || goalLower.includes('connect') || goalLower.includes('link')) {
                recommendations.push({
                    action: 'Search for related content',
                    tool: 'search_notes',
                    parameters: { query: 'concepts from the note you read' },
                    reasoning: 'Goal involves finding and connecting related content',
                    priority: 2
                });
            }
        }

        // Analyze creation
        if (step.includes('created') || step.includes('new note')) {
            recommendations.push({
                action: 'Add organizing attributes',
                tool: 'attribute_manager',
                parameters: { noteId: 'the newly created note', action: 'add' },
                reasoning: 'New notes should be organized with appropriate tags',
                priority: 1
            });
            
            if (goalLower.includes('project') || goalLower.includes('research')) {
                recommendations.push({
                    action: 'Find and link related notes',
                    tool: 'search_notes',
                    parameters: { query: 'related to your new note topic' },
                    reasoning: 'Connect new content to existing related materials',
                    priority: 2
                });
            }
        }

        return {
            analysis: this.generateAnalysis(currentStep, goal, recommendations.length),
            recommendations: recommendations.sort((a, b) => a.priority - b.priority),
            warnings: warnings.length > 0 ? warnings : undefined
        };
    }

    /**
     * Generate workflow analysis
     */
    private generateAnalysis(currentStep: string, goal: string, recommendationCount: number): string {
        const patterns = this.getWorkflowPatterns();
        
        let analysis = `📊 CURRENT STATE: ${currentStep}\n`;
        analysis += `🎯 TARGET GOAL: ${goal}\n\n`;
        
        if (recommendationCount > 0) {
            analysis += `✅ I've identified ${recommendationCount} recommended next steps based on your current progress and goal.\n\n`;
        } else {
            analysis += `🤔 Your situation is unique. I'll provide general guidance based on common patterns.\n\n`;
        }
        
        // Suggest relevant workflow patterns
        const goalLower = goal.toLowerCase();
        if (goalLower.includes('read') && goalLower.includes('find')) {
            analysis += `📖 PATTERN MATCH: This looks like a "${patterns.search_read_analyze.name}" workflow\n`;
        } else if (goalLower.includes('create') && goalLower.includes('organize')) {
            analysis += `📝 PATTERN MATCH: This looks like a "${patterns.search_create_organize.name}" workflow\n`;
        } else if (goalLower.includes('update') && goalLower.includes('find')) {
            analysis += `✏️ PATTERN MATCH: This looks like a "${patterns.find_read_update.name}" workflow\n`;
        }
        
        return analysis;
    }

    /**
     * Execute the workflow helper tool
     */
    public async execute(args: { 
        currentStep: string, 
        goal: string, 
        availableData?: string,
        includeExamples?: boolean 
    }): Promise<string | object> {
        try {
            const { currentStep, goal, availableData, includeExamples = true } = args;

            log.info(`Executing workflow_helper - Current: "${currentStep}", Goal: "${goal}"`);

            const analysis = this.analyzeCurrentStep(currentStep, goal, availableData);
            const patterns = this.getWorkflowPatterns();

            // Extract noteIds from available data if provided
            const noteIds = availableData ? this.extractNoteIds(availableData) : [];

            const response: any = {
                currentStep,
                goal,
                analysis: analysis.analysis,
                immediateNext: analysis.recommendations.length > 0 ? {
                    primaryAction: analysis.recommendations[0],
                    alternatives: analysis.recommendations.slice(1, 3)
                } : undefined,
                extractedData: {
                    noteIds: noteIds.length > 0 ? noteIds : undefined,
                    hasData: !!availableData
                }
            };

            if (analysis.warnings) {
                response.warnings = {
                    message: '⚠️ Important considerations:',
                    items: analysis.warnings
                };
            }

            if (includeExamples && analysis.recommendations.length > 0) {
                response.examples = {
                    message: '📚 Specific tool usage examples:',
                    commands: analysis.recommendations.slice(0, 2).map(rec => ({
                        tool: rec.tool,
                        example: this.generateExample(rec.tool, rec.parameters, noteIds),
                        description: rec.reasoning
                    }))
                };
            }

            // Add relevant workflow patterns
            response.workflowPatterns = {
                message: '🔄 Common workflow patterns you might find useful:',
                patterns: Object.values(patterns).slice(0, 2).map(pattern => ({
                    name: pattern.name,
                    description: pattern.description,
                    steps: pattern.steps
                }))
            };

            response.tips = [
                '💡 Use the noteId values from search results, not note titles',
                '🔄 Check tool results carefully before proceeding to next step',
                '📊 Use workflow_helper again if you get stuck or need guidance'
            ];

            return response;
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            log.error(`Error executing workflow_helper: ${errorMessage}`);
            return `Error: ${errorMessage}`;
        }
    }

    /**
     * Extract noteIds from data string
     */
    private extractNoteIds(data: string): string[] {
        // Look for patterns like noteId: "abc123" or "abc123def456"
        const idPattern = /(?:noteId[:\s]*["']?|["'])([a-zA-Z0-9]{8,})['"]/g;
        const matches: string[] = [];
        let match;
        
        while ((match = idPattern.exec(data)) !== null) {
            if (match[1] && !matches.includes(match[1])) {
                matches.push(match[1]);
            }
        }
        
        return matches;
    }

    /**
     * Generate specific examples for tool usage
     */
    private generateExample(tool: string, parameters: Record<string, any>, noteIds: string[]): string {
        const sampleNoteId = noteIds[0] || 'abc123def456';
        
        switch (tool) {
            case 'read_note':
                return `{ "noteId": "${sampleNoteId}", "includeAttributes": true }`;
            case 'note_update':
                return `{ "noteId": "${sampleNoteId}", "content": "Updated content here" }`;
            case 'attribute_manager':
                return `{ "noteId": "${sampleNoteId}", "action": "add", "attributeType": "label", "attributeName": "important" }`;
            case 'search_notes':
                return `{ "query": "broader search terms related to your topic" }`;
            case 'keyword_search_notes':
                return `{ "query": "specific keywords OR alternative terms" }`;
            case 'note_creation':
                return `{ "title": "New Note Title", "content": "Note content here" }`;
            default:
                return `Use ${tool} with appropriate parameters`;
        }
    }
}