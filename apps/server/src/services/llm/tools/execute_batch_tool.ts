/**
 * Batch Execution Tool
 *
 * Allows LLMs to execute multiple tools in parallel for faster results,
 * similar to how Claude Code works.
 */

import type { Tool, ToolHandler } from './tool_interfaces.js';
import log from '../../log.js';
import toolRegistry from './tool_registry.js';

/**
 * Definition of the batch execution tool
 */
export const executeBatchToolDefinition: Tool = {
    type: 'function',
    function: {
        name: 'execute_batch',
        description: 'Execute multiple tools in parallel. Example: execute_batch([{tool:"search",params:{query:"AI"}},{tool:"search",params:{query:"ML"}}]) → run both searches simultaneously',
        parameters: {
            type: 'object',
            properties: {
                tools: {
                    type: 'array',
                    description: 'Array of tools to execute in parallel',
                    items: {
                        type: 'object',
                        properties: {
                            tool: {
                                type: 'string',
                                description: 'Tool name (e.g., "search", "read", "attribute_search")'
                            },
                            params: {
                                type: 'object',
                                description: 'Parameters for the tool'
                            },
                            id: {
                                type: 'string',
                                description: 'Optional ID to identify this tool execution'
                            }
                        },
                        required: ['tool', 'params']
                    },
                    minItems: 1,
                    maxItems: 10
                },
                returnFormat: {
                    type: 'string',
                    description: 'Result format: "concise" for noteIds only, "full" for complete results',
                    enum: ['concise', 'full'],
                    default: 'concise'
                }
            },
            required: ['tools']
        }
    }
};

/**
 * Batch execution tool implementation
 */
export class ExecuteBatchTool implements ToolHandler {
    public definition: Tool = executeBatchToolDefinition;

    /**
     * Format results in concise format for easier LLM parsing
     */
    private formatConciseResult(toolName: string, result: any, id?: string): any {
        const baseResult = {
            tool: toolName,
            id: id || undefined,
            status: 'success'
        };

        // Handle different result types
        if (typeof result === 'string') {
            if (result.startsWith('Error:')) {
                return { ...baseResult, status: 'error', error: result };
            }
            return { ...baseResult, result: result.substring(0, 200) };
        }

        if (typeof result === 'object' && result !== null) {
            // Extract key information for search results
            if ('results' in result && Array.isArray(result.results)) {
                const noteIds = result.results.map((r: any) => r.noteId).filter(Boolean);
                return {
                    ...baseResult,
                    found: result.count || result.results.length,
                    noteIds: noteIds.slice(0, 20), // Limit to 20 IDs
                    total: result.totalFound || result.count,
                    next: noteIds.length > 0 ? 'Use read tool with these noteIds' : 'Try different search terms'
                };
            }

            // Handle note content results
            if ('content' in result) {
                return {
                    ...baseResult,
                    title: result.title || 'Unknown',
                    preview: typeof result.content === 'string' 
                        ? result.content.substring(0, 300) + '...'
                        : 'Binary content',
                    length: typeof result.content === 'string' ? result.content.length : 0
                };
            }

            // Default object handling
            return { ...baseResult, summary: this.summarizeObject(result) };
        }

        return { ...baseResult, result };
    }

    /**
     * Summarize complex objects for concise output
     */
    private summarizeObject(obj: any): string {
        const keys = Object.keys(obj);
        if (keys.length === 0) return 'Empty result';
        
        const summary = keys.slice(0, 3).map(key => {
            const value = obj[key];
            if (Array.isArray(value)) {
                return `${key}: ${value.length} items`;
            }
            if (typeof value === 'string') {
                return `${key}: "${value.substring(0, 50)}${value.length > 50 ? '...' : ''}"`;
            }
            return `${key}: ${typeof value}`;
        }).join(', ');

        return keys.length > 3 ? `${summary}, +${keys.length - 3} more` : summary;
    }

    /**
     * Execute multiple tools in parallel
     */
    public async execute(args: {
        tools: Array<{ tool: string, params: any, id?: string }>,
        returnFormat?: 'concise' | 'full'
    }): Promise<string | object> {
        try {
            const { tools, returnFormat = 'concise' } = args;

            log.info(`Executing batch of ${tools.length} tools in parallel`);

            // Validate all tools exist before execution
            const toolHandlers = tools.map(({ tool, id }) => {
                const handler = toolRegistry.getTool(tool);
                if (!handler) {
                    throw new Error(`Tool '${tool}' not found. ID: ${id || 'none'}`);
                }
                return { handler, id };
            });

            // Execute all tools in parallel
            const startTime = Date.now();
            const results = await Promise.allSettled(
                tools.map(async ({ tool, params, id }, index) => {
                    try {
                        log.info(`Batch execution [${index + 1}/${tools.length}]: ${tool} ${id ? `(${id})` : ''}`);
                        const handler = toolHandlers[index].handler;
                        const result = await handler.execute(params);
                        return { tool, params, id, result, status: 'fulfilled' as const };
                    } catch (error) {
                        log.error(`Batch tool ${tool} failed: ${error}`);
                        return { 
                            tool, 
                            params, 
                            id, 
                            error: error instanceof Error ? error.message : String(error),
                            status: 'rejected' as const
                        };
                    }
                })
            );

            const executionTime = Date.now() - startTime;
            log.info(`Batch execution completed in ${executionTime}ms`);

            // Process results
            const processedResults = results.map((result, index) => {
                const toolInfo = tools[index];
                
                if (result.status === 'fulfilled') {
                    if (returnFormat === 'concise') {
                        return this.formatConciseResult(toolInfo.tool, result.value.result, toolInfo.id);
                    } else {
                        return {
                            tool: toolInfo.tool,
                            id: toolInfo.id,
                            status: 'success',
                            result: result.value.result
                        };
                    }
                } else {
                    return {
                        tool: toolInfo.tool,
                        id: toolInfo.id,
                        status: 'error',
                        error: result.reason?.message || String(result.reason)
                    };
                }
            });

            // Create summary
            const successful = processedResults.filter(r => r.status === 'success').length;
            const failed = processedResults.length - successful;

            const batchResult = {
                executed: tools.length,
                successful,
                failed,
                executionTime: `${executionTime}ms`,
                results: processedResults
            };

            // Add suggestions for next actions
            if (returnFormat === 'concise') {
                const noteIds = processedResults
                    .flatMap(r => r.noteIds || [])
                    .filter(Boolean);
                
                const errors = processedResults
                    .filter(r => r.status === 'error')
                    .map(r => r.error);

                if (noteIds.length > 0) {
                    batchResult['next_suggestion'] = `Found ${noteIds.length} notes. Use read tool: execute_batch([${noteIds.slice(0, 5).map(id => `{tool:"read",params:{noteId:"${id}"}}`).join(',')}])`;
                }

                if (errors.length > 0) {
                    batchResult['retry_suggestion'] = 'Some tools failed. Try with broader terms or different search types.';
                }
            }

            return batchResult;

        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            log.error(`Error in batch execution: ${errorMessage}`);
            return {
                status: 'error',
                error: errorMessage,
                suggestion: 'Try executing tools individually to identify the issue'
            };
        }
    }
}