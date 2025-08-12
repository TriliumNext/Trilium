/**
 * Tool Context Manager - Phase 4 Core Tool Optimization
 *
 * Manages context-aware tool loading to reduce token usage from 15,000 to 5,000 tokens
 * while preserving all functionality through smart consolidation and dynamic loading.
 */

import type { Tool, ToolHandler } from './tool_interfaces.js';
import log from '../../log.js';

/**
 * Tool contexts for different usage scenarios
 */
export type ToolContext = 'core' | 'advanced' | 'admin' | 'full';

/**
 * Tool metadata for context management
 */
export interface ToolMetadata {
    name: string;
    priority: number;
    tokenEstimate: number;
    contexts: ToolContext[];
    dependencies?: string[];
    replacedBy?: string[];  // Tools this replaces in consolidation
    consolidates?: string[]; // Tools this consolidates functionality from
}

/**
 * Tool context definitions with token budgets
 */
export const TOOL_CONTEXTS: Record<ToolContext, {
    description: string;
    tokenBudget: number;
    useCase: string;
}> = {
    core: {
        description: '8 essential tools for 90% of LLM interactions',
        tokenBudget: 5000,
        useCase: 'General usage, Ollama compatibility, fast responses'
    },
    advanced: {
        description: 'Core + specialized workflow tools',
        tokenBudget: 8000,
        useCase: 'Power users, complex workflows, batch operations'
    },
    admin: {
        description: 'Advanced + administrative and system tools',
        tokenBudget: 12000,
        useCase: 'System administration, advanced note management'
    },
    full: {
        description: 'All available tools (legacy compatibility)',
        tokenBudget: 15000,
        useCase: 'Backward compatibility, development, testing'
    }
};

/**
 * Core tool metadata registry
 */
export const CORE_TOOL_REGISTRY: Record<string, ToolMetadata> = {
    // Core Tools (8 essential tools)
    smart_search: {
        name: 'smart_search',
        priority: 1,
        tokenEstimate: 800,
        contexts: ['core', 'advanced', 'admin', 'full'],
        consolidates: ['search_notes_tool', 'keyword_search_tool', 'attribute_search_tool', 'unified_search_tool']
    },
    read_note: {
        name: 'read_note',
        priority: 2,
        tokenEstimate: 300,
        contexts: ['core', 'advanced', 'admin', 'full']
    },
    find_and_read: {
        name: 'find_and_read',
        priority: 3,
        tokenEstimate: 400,
        contexts: ['core', 'advanced', 'admin', 'full'],
        dependencies: ['smart_search', 'read_note']
    },
    find_and_update: {
        name: 'find_and_update',
        priority: 4,
        tokenEstimate: 450,
        contexts: ['core', 'advanced', 'admin', 'full'],
        dependencies: ['smart_search', 'note_update']
    },
    note_creation: {
        name: 'note_creation',
        priority: 5,
        tokenEstimate: 350,
        contexts: ['core', 'advanced', 'admin', 'full']
    },
    note_update: {
        name: 'note_update',
        priority: 6,
        tokenEstimate: 350,
        contexts: ['core', 'advanced', 'admin', 'full']
    },
    attribute_manager: {
        name: 'attribute_manager',
        priority: 7,
        tokenEstimate: 400,
        contexts: ['core', 'advanced', 'admin', 'full']
    },
    clone_note: {
        name: 'clone_note',
        priority: 8,
        tokenEstimate: 300,
        contexts: ['core', 'advanced', 'admin', 'full']
    },

    // Advanced Tools (loaded in advanced/admin/full contexts)
    create_with_template: {
        name: 'create_with_template',
        priority: 9,
        tokenEstimate: 500,
        contexts: ['advanced', 'admin', 'full'],
        dependencies: ['note_creation', 'template_manager']
    },
    organize_hierarchy: {
        name: 'organize_hierarchy',
        priority: 10,
        tokenEstimate: 450,
        contexts: ['advanced', 'admin', 'full']
    },
    template_manager: {
        name: 'template_manager',
        priority: 11,
        tokenEstimate: 400,
        contexts: ['advanced', 'admin', 'full']
    },
    bulk_update: {
        name: 'bulk_update',
        priority: 12,
        tokenEstimate: 500,
        contexts: ['advanced', 'admin', 'full'],
        dependencies: ['smart_search', 'note_update']
    },
    note_summarization: {
        name: 'note_summarization',
        priority: 13,
        tokenEstimate: 350,
        contexts: ['advanced', 'admin', 'full']
    },

    // Admin Tools (loaded in admin/full contexts)
    protected_note: {
        name: 'protected_note',
        priority: 14,
        tokenEstimate: 400,
        contexts: ['admin', 'full']
    },
    revision_manager: {
        name: 'revision_manager',
        priority: 15,
        tokenEstimate: 400,
        contexts: ['admin', 'full']
    },
    note_type_converter: {
        name: 'note_type_converter',
        priority: 16,
        tokenEstimate: 350,
        contexts: ['admin', 'full']
    },

    // Utility Tools (all contexts but lower priority)
    relationship_tool: {
        name: 'relationship_tool',
        priority: 17,
        tokenEstimate: 300,
        contexts: ['core', 'advanced', 'admin', 'full']
    },

    // Deprecated/Consolidated Tools (only in full context for backward compatibility)
    search_notes_tool: {
        name: 'search_notes_tool',
        priority: 100,
        tokenEstimate: 500,
        contexts: ['full'],
        replacedBy: ['smart_search']
    },
    keyword_search_tool: {
        name: 'keyword_search_tool',
        priority: 101,
        tokenEstimate: 400,
        contexts: ['full'],
        replacedBy: ['smart_search']
    },
    attribute_search_tool: {
        name: 'attribute_search_tool',
        priority: 102,
        tokenEstimate: 350,
        contexts: ['full'],
        replacedBy: ['smart_search']
    }
};

/**
 * Tool Context Manager class
 */
export class ToolContextManager {
    private currentContext: ToolContext = 'core';
    private loadedTools: Map<string, ToolHandler> = new Map();
    private toolInstances: Map<string, ToolHandler> = new Map();

    /**
     * Set the current tool context
     */
    public setContext(context: ToolContext): void {
        if (context !== this.currentContext) {
            log.info(`Switching tool context from ${this.currentContext} to ${context}`);
            this.currentContext = context;
        }
    }

    /**
     * Get the current tool context
     */
    public getCurrentContext(): ToolContext {
        return this.currentContext;
    }

    /**
     * Get tools for a specific context
     */
    public getToolsForContext(context: ToolContext): ToolMetadata[] {
        const tools = Object.values(CORE_TOOL_REGISTRY)
            .filter(tool => tool.contexts.includes(context))
            .sort((a, b) => a.priority - b.priority);

        // Apply token budget constraint
        const budget = TOOL_CONTEXTS[context].tokenBudget;
        let currentTokens = 0;
        const selectedTools: ToolMetadata[] = [];

        for (const tool of tools) {
            if (currentTokens + tool.tokenEstimate <= budget) {
                selectedTools.push(tool);
                currentTokens += tool.tokenEstimate;
            } else if (tool.priority <= 8) {
                // Always include core tools even if over budget
                selectedTools.push(tool);
                currentTokens += tool.tokenEstimate;
                log.info(`Core tool ${tool.name} exceeds token budget but included anyway`);
            }
        }

        return selectedTools;
    }

    /**
     * Get estimated token usage for a context
     */
    public getContextTokenUsage(context: ToolContext): {
        estimated: number;
        budget: number;
        utilization: number;
        tools: string[];
    } {
        const tools = this.getToolsForContext(context);
        const estimated = tools.reduce((sum, tool) => sum + tool.tokenEstimate, 0);
        const budget = TOOL_CONTEXTS[context].tokenBudget;
        
        return {
            estimated,
            budget,
            utilization: estimated / budget,
            tools: tools.map(t => t.name)
        };
    }

    /**
     * Register a tool instance
     */
    public registerToolInstance(name: string, instance: ToolHandler): void {
        this.toolInstances.set(name, instance);
    }

    /**
     * Get available tool instances for current context
     */
    public getAvailableTools(): ToolHandler[] {
        const contextTools = this.getToolsForContext(this.currentContext);
        const availableTools: ToolHandler[] = [];

        for (const toolMeta of contextTools) {
            const instance = this.toolInstances.get(toolMeta.name);
            if (instance) {
                availableTools.push(instance);
            } else {
                log.info(`Tool instance not found for ${toolMeta.name} in context ${this.currentContext}`);
            }
        }

        return availableTools;
    }

    /**
     * Check if a tool is available in the current context
     */
    public isToolAvailable(toolName: string): boolean {
        const contextTools = this.getToolsForContext(this.currentContext);
        return contextTools.some(tool => tool.name === toolName);
    }

    /**
     * Suggest alternative tools if requested tool is not available
     */
    public suggestAlternatives(requestedTool: string): {
        available: boolean;
        alternatives?: string[];
        suggestedContext?: ToolContext;
        message: string;
    } {
        const metadata = CORE_TOOL_REGISTRY[requestedTool];
        
        if (!metadata) {
            return {
                available: false,
                message: `Tool '${requestedTool}' is not recognized. Check spelling or use tool_discovery_helper for available tools.`
            };
        }

        if (this.isToolAvailable(requestedTool)) {
            return {
                available: true,
                message: `Tool '${requestedTool}' is available in current context.`
            };
        }

        // Find alternatives in current context
        const alternatives: string[] = [];
        
        // Check if it's replaced by another tool
        if (metadata.replacedBy) {
            const replacements = metadata.replacedBy.filter(alt => this.isToolAvailable(alt));
            alternatives.push(...replacements);
        }

        // Find the lowest context where this tool is available
        let suggestedContext: ToolContext | undefined;
        const contexts: ToolContext[] = ['core', 'advanced', 'admin', 'full'];
        for (const context of contexts) {
            if (metadata.contexts.includes(context)) {
                suggestedContext = context;
                break;
            }
        }

        let message = `Tool '${requestedTool}' is not available in '${this.currentContext}' context.`;
        
        if (alternatives.length > 0) {
            message += ` Try these alternatives: ${alternatives.join(', ')}.`;
        }
        
        if (suggestedContext && suggestedContext !== this.currentContext) {
            message += ` Or switch to '${suggestedContext}' context to access this tool.`;
        }

        return {
            available: false,
            alternatives: alternatives.length > 0 ? alternatives : undefined,
            suggestedContext,
            message
        };
    }

    /**
     * Get context switching recommendations
     */
    public getContextRecommendations(usage: {
        toolsUsed: string[];
        failures: string[];
        userType?: 'basic' | 'power' | 'admin';
    }): {
        currentContext: ToolContext;
        recommendedContext?: ToolContext;
        reason: string;
        benefits: string[];
        tokenImpact: string;
    } {
        const { toolsUsed, failures, userType = 'basic' } = usage;
        
        // Analyze usage patterns
        const needsAdvanced = toolsUsed.some(tool => 
            ['create_with_template', 'organize_hierarchy', 'bulk_update'].includes(tool)
        );
        
        const needsAdmin = toolsUsed.some(tool => 
            ['protected_note', 'revision_manager', 'note_type_converter'].includes(tool)
        );

        const hasFailures = failures.some(tool => 
            !this.isToolAvailable(tool)
        );

        let recommendedContext: ToolContext | undefined;
        let reason = '';
        const benefits: string[] = [];

        // Determine recommendation
        if (this.currentContext === 'core') {
            if (needsAdmin) {
                recommendedContext = 'admin';
                reason = 'Administrative tools needed for current workflow';
                benefits.push('Access to protected note management', 'Revision history tools', 'Note type conversion');
            } else if (needsAdvanced || hasFailures) {
                recommendedContext = 'advanced';
                reason = 'Advanced workflow tools would improve efficiency';
                benefits.push('Template-based creation', 'Bulk operations', 'Hierarchy management');
            }
        } else if (this.currentContext === 'advanced') {
            if (needsAdmin) {
                recommendedContext = 'admin';
                reason = 'Administrative functions required';
                benefits.push('Full system administration capabilities');
            } else if (userType === 'basic' && !needsAdvanced) {
                recommendedContext = 'core';
                reason = 'Core tools sufficient for current needs';
                benefits.push('Faster responses', 'Better Ollama compatibility', 'Reduced complexity');
            }
        } else if (this.currentContext === 'admin') {
            if (userType === 'basic' && !needsAdmin && !needsAdvanced) {
                recommendedContext = 'core';
                reason = 'Core tools sufficient, reduce overhead';
                benefits.push('Optimal performance', 'Cleaner tool selection');
            } else if (!needsAdmin && needsAdvanced) {
                recommendedContext = 'advanced';
                reason = 'Admin tools not needed, reduce token usage';
                benefits.push('Better balance of features and performance');
            }
        }

        // Calculate token impact
        const currentUsage = this.getContextTokenUsage(this.currentContext);
        const recommendedUsage = recommendedContext 
            ? this.getContextTokenUsage(recommendedContext)
            : currentUsage;
        
        const tokenImpact = recommendedContext
            ? `${currentUsage.estimated} → ${recommendedUsage.estimated} tokens (${
                recommendedUsage.estimated > currentUsage.estimated ? '+' : ''
              }${recommendedUsage.estimated - currentUsage.estimated})`
            : `Current: ${currentUsage.estimated} tokens`;

        return {
            currentContext: this.currentContext,
            recommendedContext,
            reason: reason || `Current '${this.currentContext}' context is appropriate for your usage pattern`,
            benefits,
            tokenImpact
        };
    }

    /**
     * Get context statistics
     */
    public getContextStats(): {
        current: ToolContext;
        contexts: Record<ToolContext, {
            toolCount: number;
            tokenUsage: number;
            utilization: number;
        }>;
    } {
        const contexts: Record<ToolContext, {
            toolCount: number;
            tokenUsage: number;
            utilization: number;
        }> = {} as Record<ToolContext, {
            toolCount: number;
            tokenUsage: number;
            utilization: number;
        }>;
        
        for (const context of Object.keys(TOOL_CONTEXTS) as ToolContext[]) {
            const usage = this.getContextTokenUsage(context);
            contexts[context] = {
                toolCount: usage.tools.length,
                tokenUsage: usage.estimated,
                utilization: Math.round(usage.utilization * 100)
            };
        }

        return {
            current: this.currentContext,
            contexts
        };
    }
}

// Export singleton instance
export const toolContextManager = new ToolContextManager();