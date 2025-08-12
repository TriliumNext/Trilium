/**
 * Smart Tool Wrapper
 *
 * This module provides a wrapper that automatically applies smart parameter processing
 * to any tool, making them more forgiving and intelligent when working with LLM inputs.
 * 
 * Features:
 * - Automatic parameter correction and type coercion
 * - Note reference resolution (title -> noteId)
 * - Fuzzy matching for enum values and parameter names
 * - Context-aware parameter guessing
 * - Helpful error messages with suggestions
 * - Performance optimization with caching
 */

import type { ToolHandler, StandardizedToolResponse, Tool } from './tool_interfaces.js';
import { ToolResponseFormatter } from './tool_interfaces.js';
import { smartParameterProcessor, type ProcessingContext, type SmartProcessingResult } from './smart_parameter_processor.js';
import log from '../../log.js';

/**
 * Smart tool wrapper that enhances any tool with intelligent parameter processing
 */
export class SmartToolWrapper implements ToolHandler {
    private originalTool: ToolHandler;
    private processingContext: ProcessingContext;

    constructor(originalTool: ToolHandler, context?: Partial<ProcessingContext>) {
        this.originalTool = originalTool;
        this.processingContext = {
            toolName: originalTool.definition.function.name,
            ...context
        };
    }

    /**
     * Tool definition (pass-through from original tool)
     */
    get definition(): Tool {
        return this.originalTool.definition;
    }

    /**
     * Execute with smart parameter processing
     */
    async executeStandardized(args: Record<string, unknown>): Promise<StandardizedToolResponse> {
        const startTime = Date.now();
        const toolName = this.definition.function.name;

        try {
            log.info(`Smart wrapper executing tool: ${toolName}`);

            // Apply smart parameter processing
            const processingResult = await smartParameterProcessor.processParameters(
                args,
                this.definition,
                this.processingContext
            );

            // Handle processing failures
            if (!processingResult.success) {
                log.error(`Smart parameter processing failed for ${toolName}: ${processingResult.error?.error}`);
                return processingResult.error!;
            }

            // Log any corrections made
            if (processingResult.corrections.length > 0) {
                log.info(`Smart processing made ${processingResult.corrections.length} corrections for ${toolName}:`);
                processingResult.corrections.forEach((correction, index) => {
                    log.info(`  ${index + 1}. ${correction.parameter}: ${correction.originalValue} → ${correction.correctedValue} (${correction.correctionType}, confidence: ${Math.round(correction.confidence * 100)}%)`);
                });
            }

            // Execute the original tool with processed parameters
            let result: StandardizedToolResponse;
            
            if (this.originalTool.executeStandardized) {
                result = await this.originalTool.executeStandardized(processingResult.processedParams);
            } else {
                // Fall back to legacy execute method
                const legacyResult = await this.originalTool.execute(processingResult.processedParams);
                const executionTime = Date.now() - startTime;
                result = ToolResponseFormatter.wrapLegacyResponse(
                    legacyResult,
                    executionTime,
                    ['smart_processing', 'legacy_tool']
                );
            }

            // Enhance the result with processing information
            if (result.success) {
                const enhancedResult = this.enhanceSuccessResponse(result, processingResult);
                return enhancedResult;
            } else {
                const enhancedError = this.enhanceErrorResponse(result, processingResult);
                return enhancedError;
            }

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            log.error(`Smart wrapper execution failed for ${toolName}: ${errorMessage}`);

            return ToolResponseFormatter.error(
                `Tool execution failed: ${errorMessage}`,
                {
                    possibleCauses: [
                        'Tool implementation error',
                        'Parameter processing issue',
                        'System resource limitation'
                    ],
                    suggestions: [
                        'Try again with simpler parameters',
                        'Check if the tool service is available',
                        'Contact administrator if error persists'
                    ]
                }
            );
        }
    }

    /**
     * Legacy execute method for backward compatibility
     */
    async execute(args: Record<string, unknown>): Promise<string | object> {
        const result = await this.executeStandardized(args);
        
        if (result.success) {
            return result.result;
        } else {
            return `Error: ${result.error}`;
        }
    }

    /**
     * Enhance successful response with smart processing information
     */
    private enhanceSuccessResponse(
        originalResponse: StandardizedToolResponse,
        processingResult: SmartProcessingResult
    ): StandardizedToolResponse {
        if (!originalResponse.success) {
            return originalResponse;
        }

        // Add processing information to metadata
        const enhancedMetadata = {
            ...originalResponse.metadata,
            smartProcessing: {
                corrections: processingResult.corrections,
                suggestions: processingResult.suggestions,
                processingEnabled: true
            }
        };

        // Enhance next steps with parameter suggestions if any
        let enhancedNextSteps = { ...originalResponse.nextSteps };
        if (processingResult.suggestions.length > 0) {
            enhancedNextSteps.alternatives = [
                ...(originalResponse.nextSteps.alternatives || []),
                ...processingResult.suggestions
            ];
        }

        // Add correction information to the result if corrections were made
        let enhancedResult = originalResponse.result;
        if (processingResult.corrections.length > 0) {
            // Add a note about corrections in a non-intrusive way
            const correctionSummary = processingResult.corrections
                .map(c => `${c.parameter}: ${c.reasoning}`)
                .join('; ');
            
            // If result is an object, add correction info
            if (typeof enhancedResult === 'object' && enhancedResult !== null) {
                enhancedResult = {
                    ...enhancedResult,
                    _smartProcessing: {
                        correctionsApplied: processingResult.corrections.length,
                        correctionSummary
                    }
                };
            }
        }

        return {
            ...originalResponse,
            result: enhancedResult,
            nextSteps: enhancedNextSteps,
            metadata: enhancedMetadata
        };
    }

    /**
     * Enhance error response with smart processing suggestions
     */
    private enhanceErrorResponse(
        originalResponse: StandardizedToolResponse,
        processingResult: SmartProcessingResult
    ): StandardizedToolResponse {
        if (originalResponse.success) {
            return originalResponse;
        }

        // Add processing suggestions to the error help
        const enhancedHelp = {
            ...originalResponse.help,
            suggestions: [
                ...originalResponse.help.suggestions,
                ...processingResult.suggestions
            ]
        };

        // If corrections were attempted but the tool still failed, mention them
        if (processingResult.corrections.length > 0) {
            const correctionInfo = processingResult.corrections
                .map(c => `${c.parameter} was auto-corrected`)
                .join(', ');

            enhancedHelp.suggestions.unshift(
                `Note: ${correctionInfo}, but the tool still failed - check the corrected values`
            );
        }

        return {
            ...originalResponse,
            help: enhancedHelp
        };
    }

    /**
     * Update processing context (useful for maintaining session state)
     */
    updateContext(newContext: Partial<ProcessingContext>): void {
        this.processingContext = {
            ...this.processingContext,
            ...newContext
        };
    }

    /**
     * Get current processing context
     */
    getContext(): ProcessingContext {
        return { ...this.processingContext };
    }
}

/**
 * Factory function to create smart-wrapped tools
 */
export function createSmartTool(
    originalTool: ToolHandler,
    context?: Partial<ProcessingContext>
): SmartToolWrapper {
    return new SmartToolWrapper(originalTool, context);
}

/**
 * Utility function to wrap multiple tools with smart processing
 */
export function wrapToolsWithSmartProcessing(
    tools: ToolHandler[],
    globalContext?: Partial<ProcessingContext>
): SmartToolWrapper[] {
    return tools.map(tool => createSmartTool(tool, {
        ...globalContext,
        toolName: tool.definition.function.name
    }));
}

/**
 * Smart tool registry that automatically wraps tools
 */
export class SmartToolRegistry {
    private tools: Map<string, SmartToolWrapper> = new Map();
    private globalContext: ProcessingContext = { toolName: 'unknown' };

    /**
     * Register a tool with smart processing
     */
    register(tool: ToolHandler, context?: Partial<ProcessingContext>): void {
        const toolName = tool.definition.function.name;
        const smartTool = createSmartTool(tool, {
            ...this.globalContext,
            ...context,
            toolName
        });
        
        this.tools.set(toolName, smartTool);
        log.info(`Registered smart tool: ${toolName}`);
    }

    /**
     * Register multiple tools
     */
    registerMany(tools: ToolHandler[], context?: Partial<ProcessingContext>): void {
        tools.forEach(tool => this.register(tool, context));
    }

    /**
     * Get a smart tool by name
     */
    get(toolName: string): SmartToolWrapper | undefined {
        return this.tools.get(toolName);
    }

    /**
     * Get all registered smart tools
     */
    getAll(): SmartToolWrapper[] {
        return Array.from(this.tools.values());
    }

    /**
     * Update global context for all tools
     */
    updateGlobalContext(newContext: Partial<ProcessingContext>): void {
        this.globalContext = {
            ...this.globalContext,
            ...newContext
        };

        // Update context for all registered tools
        this.tools.forEach(tool => tool.updateContext(newContext));
    }

    /**
     * Get list of registered tool names
     */
    getToolNames(): string[] {
        return Array.from(this.tools.keys());
    }

    /**
     * Clear all registered tools
     */
    clear(): void {
        this.tools.clear();
    }

    /**
     * Get registry statistics
     */
    getStats(): {
        totalTools: number;
        toolNames: string[];
    } {
        return {
            totalTools: this.tools.size,
            toolNames: this.getToolNames()
        };
    }
}

/**
 * Global smart tool registry instance
 */
export const smartToolRegistry = new SmartToolRegistry();