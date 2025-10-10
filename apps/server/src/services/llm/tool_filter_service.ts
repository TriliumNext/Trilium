/**
 * Tool Filter Service - Phase 3 Implementation
 *
 * Dynamically filters tools based on provider capabilities, query intent, and context window.
 *
 * Key features:
 * - Ollama: Max 3 tools (local models struggle with >5 tools)
 * - OpenAI/Anthropic: All 4 tools (or query-filtered)
 * - Query-based filtering: Analyze intent to select most relevant tools
 * - Configurable: Can be disabled via options
 *
 * Design philosophy:
 * - Better to give LLM fewer, more relevant tools than overwhelming it
 * - Local models (Ollama) need more aggressive filtering
 * - Cloud models (OpenAI/Anthropic) can handle full tool set
 */

import type { Tool } from './tools/tool_interfaces.js';
import log from '../log.js';

/**
 * Provider type for tool filtering
 */
export type ProviderType = 'openai' | 'anthropic' | 'ollama';

/**
 * Query complexity levels
 */
export type QueryComplexity = 'simple' | 'standard' | 'advanced';

/**
 * Configuration for tool filtering
 */
export interface ToolFilterConfig {
    provider: ProviderType;
    contextWindow: number;
    query?: string;
    complexity?: QueryComplexity;
    maxTools?: number; // Override default max tools for provider
}

/**
 * Intent categories for query analysis
 */
interface QueryIntent {
    hasSearchIntent: boolean;
    hasNoteManagementIntent: boolean;
    hasDateIntent: boolean;
    hasHierarchyIntent: boolean;
}

/**
 * Tool Filter Service
 * Provides intelligent tool selection based on provider and query
 */
export class ToolFilterService {
    // Provider-specific limits
    private static readonly PROVIDER_LIMITS = {
        ollama: 3,      // Local models: max 3 tools
        openai: 4,      // Cloud models: can handle all 4
        anthropic: 4    // Cloud models: can handle all 4
    };

    // Essential tools that should always be included when filtering
    private static readonly ESSENTIAL_TOOLS = [
        'smart_search',
        'manage_note'
    ];

    // Tool names in priority order
    private static readonly TOOL_PRIORITY = [
        'smart_search',         // Always first - core search capability
        'manage_note',          // Always second - core CRUD
        'calendar_integration', // Third - date/time operations
        'navigate_hierarchy'    // Fourth - tree navigation
    ];

    /**
     * Filter tools based on provider and query context
     *
     * @param config Tool filter configuration
     * @param allTools All available tools
     * @returns Filtered tool list optimized for the provider
     */
    filterToolsForProvider(
        config: ToolFilterConfig,
        allTools: Tool[]
    ): Tool[] {
        // Validation
        if (!allTools || allTools.length === 0) {
            log.info('ToolFilterService: No tools provided to filter');
            return [];
        }

        // Get max tools for provider (with override support)
        const maxTools = config.maxTools !== undefined
            ? config.maxTools
            : ToolFilterService.PROVIDER_LIMITS[config.provider];

        log.info(`ToolFilterService: Filtering for provider=${config.provider}, maxTools=${maxTools}, hasQuery=${!!config.query}`);

        // If max tools is 0 or negative, return empty array
        if (maxTools <= 0) {
            log.info('ToolFilterService: Max tools is 0, returning empty tool list');
            return [];
        }

        // If all tools fit within limit, return all
        if (allTools.length <= maxTools) {
            log.info(`ToolFilterService: All ${allTools.length} tools fit within limit (${maxTools}), returning all`);
            return allTools;
        }

        // Ollama needs aggressive filtering
        if (config.provider === 'ollama') {
            return this.selectOllamaTools(config.query, allTools, maxTools);
        }

        // OpenAI/Anthropic: Use query-based filtering if query provided
        if (config.query) {
            return this.selectToolsByQuery(config.query, allTools, maxTools);
        }

        // Default: Return tools in priority order up to limit
        return this.selectToolsByPriority(allTools, maxTools);
    }

    /**
     * Select tools for Ollama based on query intent
     * Ollama gets maximum 3 tools, chosen based on query analysis
     *
     * @param query User query (optional)
     * @param allTools All available tools
     * @param maxTools Maximum number of tools (default: 3)
     * @returns Filtered tools (max 3)
     */
    private selectOllamaTools(
        query: string | undefined,
        allTools: Tool[],
        maxTools: number
    ): Tool[] {
        log.info('ToolFilterService: Selecting tools for Ollama');

        // No query context - return essential tools only
        if (!query) {
            const essentialTools = this.getEssentialTools(allTools);
            const limited = essentialTools.slice(0, maxTools);
            log.info(`ToolFilterService: No query provided, returning ${limited.length} essential tools`);
            return limited;
        }

        // Analyze query intent
        const intent = this.analyzeQueryIntent(query);

        // Build selected tools list starting with essentials
        const selectedNames: string[] = [...ToolFilterService.ESSENTIAL_TOOLS];

        // Add specialized tool based on intent (only if we have room)
        if (selectedNames.length < maxTools) {
            if (intent.hasDateIntent) {
                selectedNames.push('calendar_integration');
                log.info('ToolFilterService: Added calendar_integration (date intent detected)');
            } else if (intent.hasHierarchyIntent) {
                selectedNames.push('navigate_hierarchy');
                log.info('ToolFilterService: Added navigate_hierarchy (hierarchy intent detected)');
            } else {
                // Default to calendar if no specific intent
                selectedNames.push('calendar_integration');
                log.info('ToolFilterService: Added calendar_integration (default third tool)');
            }
        }

        // Filter and limit
        const filtered = allTools.filter(t =>
            selectedNames.includes(t.function.name)
        );

        const limited = filtered.slice(0, maxTools);

        log.info(`ToolFilterService: Selected ${limited.length} tools for Ollama: ${limited.map(t => t.function.name).join(', ')}`);

        return limited;
    }

    /**
     * Select tools based on query intent analysis
     * For OpenAI/Anthropic when query is provided
     *
     * @param query User query
     * @param allTools All available tools
     * @param maxTools Maximum number of tools
     * @returns Filtered tools based on query intent
     */
    private selectToolsByQuery(
        query: string,
        allTools: Tool[],
        maxTools: number
    ): Tool[] {
        log.info('ToolFilterService: Selecting tools by query intent');

        const intent = this.analyzeQueryIntent(query);

        // Build priority list based on intent
        const priorityNames: string[] = [];

        // Essential tools always come first
        priorityNames.push(...ToolFilterService.ESSENTIAL_TOOLS);

        // Add specialized tools based on intent
        if (intent.hasDateIntent && !priorityNames.includes('calendar_integration')) {
            priorityNames.push('calendar_integration');
        }

        if (intent.hasHierarchyIntent && !priorityNames.includes('navigate_hierarchy')) {
            priorityNames.push('navigate_hierarchy');
        }

        // Add remaining tools in priority order
        for (const toolName of ToolFilterService.TOOL_PRIORITY) {
            if (!priorityNames.includes(toolName)) {
                priorityNames.push(toolName);
            }
        }

        // Filter tools to match priority order
        const filtered = priorityNames
            .map(name => allTools.find(t => t.function.name === name))
            .filter((t): t is Tool => t !== undefined);

        // Limit to max tools
        const limited = filtered.slice(0, maxTools);

        log.info(`ToolFilterService: Selected ${limited.length} tools by query: ${limited.map(t => t.function.name).join(', ')}`);

        return limited;
    }

    /**
     * Select tools by priority order
     * Default fallback when no query is provided
     *
     * @param allTools All available tools
     * @param maxTools Maximum number of tools
     * @returns Tools in priority order
     */
    private selectToolsByPriority(
        allTools: Tool[],
        maxTools: number
    ): Tool[] {
        log.info('ToolFilterService: Selecting tools by priority');

        // Sort tools by priority (create copy to avoid mutation)
        const sorted = [...allTools].sort((a, b) => {
            const aPriority = ToolFilterService.TOOL_PRIORITY.indexOf(a.function.name);
            const bPriority = ToolFilterService.TOOL_PRIORITY.indexOf(b.function.name);

            // If tool not in priority list, put it at the end
            const aIndex = aPriority >= 0 ? aPriority : 999;
            const bIndex = bPriority >= 0 ? bPriority : 999;

            return aIndex - bIndex;
        });

        const limited = sorted.slice(0, maxTools);

        log.info(`ToolFilterService: Selected ${limited.length} tools by priority: ${limited.map(t => t.function.name).join(', ')}`);

        return limited;
    }

    /**
     * Get essential tools from the available tools
     *
     * @param allTools All available tools
     * @returns Essential tools only
     */
    private getEssentialTools(allTools: Tool[]): Tool[] {
        return allTools.filter(t =>
            ToolFilterService.ESSENTIAL_TOOLS.includes(t.function.name)
        );
    }

    /**
     * Analyze query intent to determine which tools are most relevant
     *
     * @param query User query
     * @returns Intent analysis results
     */
    private analyzeQueryIntent(query: string): QueryIntent {
        const lowerQuery = query.toLowerCase();

        return {
            hasSearchIntent: this.hasSearchIntent(lowerQuery),
            hasNoteManagementIntent: this.hasNoteManagementIntent(lowerQuery),
            hasDateIntent: this.hasDateIntent(lowerQuery),
            hasHierarchyIntent: this.hasNavigationIntent(lowerQuery)
        };
    }

    /**
     * Check if query has search intent
     */
    private hasSearchIntent(query: string): boolean {
        const searchKeywords = [
            'find', 'search', 'look for', 'where is', 'locate',
            'show me', 'list', 'get all', 'query'
        ];
        return searchKeywords.some(kw => query.includes(kw));
    }

    /**
     * Check if query has note management intent (CRUD operations)
     */
    private hasNoteManagementIntent(query: string): boolean {
        const managementKeywords = [
            'create', 'make', 'add', 'new note',
            'update', 'edit', 'modify', 'change',
            'delete', 'remove', 'rename',
            'read', 'show', 'get', 'view'
        ];
        return managementKeywords.some(kw => query.includes(kw));
    }

    /**
     * Check if query has date/calendar intent
     */
    private hasDateIntent(query: string): boolean {
        const dateKeywords = [
            'today', 'tomorrow', 'yesterday',
            'date', 'calendar', 'when', 'schedule',
            'week', 'month', 'year',
            'daily', 'journal',
            'this week', 'last week', 'next week',
            'this month', 'last month'
        ];
        return dateKeywords.some(kw => query.includes(kw));
    }

    /**
     * Check if query has navigation/hierarchy intent
     */
    private hasNavigationIntent(query: string): boolean {
        const navKeywords = [
            'parent', 'child', 'children',
            'ancestor', 'descendant',
            'sibling', 'related',
            'hierarchy', 'tree', 'structure',
            'navigate', 'browse',
            'under', 'inside', 'within'
        ];
        return navKeywords.some(kw => query.includes(kw));
    }

    /**
     * Get provider-specific context window size
     * Used for logging and diagnostics
     *
     * @param provider Provider type
     * @returns Recommended context window size
     */
    getProviderContextWindow(provider: ProviderType): number {
        switch (provider) {
            case 'ollama':
                return 8192; // Increased from 2048 in Phase 3
            case 'openai':
                return 128000; // GPT-4 and beyond
            case 'anthropic':
                return 200000; // Claude 3
            default:
                return 8192; // Safe default
        }
    }

    /**
     * Calculate estimated token usage for tools
     * Useful for debugging and optimization
     *
     * @param tools Tools to estimate
     * @returns Estimated token count
     */
    estimateToolTokens(tools: Tool[]): number {
        // Rough estimation: ~575 tokens for 4 tools (from research)
        // That's ~144 tokens per tool average
        const TOKENS_PER_TOOL = 144;

        return tools.length * TOKENS_PER_TOOL;
    }

    /**
     * Get filtering statistics for logging
     *
     * @param originalCount Original tool count
     * @param filteredCount Filtered tool count
     * @param config Filter configuration
     * @returns Statistics object
     */
    getFilterStats(
        originalCount: number,
        filteredCount: number,
        config: ToolFilterConfig
    ): {
        provider: ProviderType;
        original: number;
        filtered: number;
        reduction: number;
        reductionPercent: number;
        estimatedTokenSavings: number;
    } {
        const reduction = originalCount - filteredCount;
        const reductionPercent = originalCount > 0
            ? Math.round((reduction / originalCount) * 100)
            : 0;
        const estimatedTokenSavings = reduction * 144; // ~144 tokens per tool

        return {
            provider: config.provider,
            original: originalCount,
            filtered: filteredCount,
            reduction,
            reductionPercent,
            estimatedTokenSavings
        };
    }
}

// Export singleton instance
const toolFilterService = new ToolFilterService();
export default toolFilterService;

/**
 * Convenience function for filtering tools
 */
export function filterTools(
    config: ToolFilterConfig,
    allTools: Tool[]
): Tool[] {
    return toolFilterService.filterToolsForProvider(config, allTools);
}
