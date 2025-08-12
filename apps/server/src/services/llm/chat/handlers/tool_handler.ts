/**
 * Handler for LLM tool executions
 */
import log from "../../../log.js";
import type { Message } from "../../ai_interface.js";
import { toolPreviewManager } from "../../tools/tool_preview.js";
import { toolFeedbackManager } from "../../tools/tool_feedback.js";
import { toolErrorRecoveryManager } from "../../tools/tool_error_recovery.js";
import { toolTimeoutEnforcer } from "../../tools/tool_timeout_enforcer.js";
import { parameterCoercer } from "../../tools/parameter_coercer.js";
import { toolExecutionMonitor } from "../../monitoring/tool_execution_monitor.js";

/**
 * Handles the execution of LLM tools
 */
export class ToolHandler {
    /**
     * Execute tool calls from the LLM response
     * @param response The LLM response containing tool calls
     * @param chatNoteId Optional chat note ID for tracking
     * @param options Execution options
     */
    static async executeToolCalls(
        response: any, 
        chatNoteId?: string,
        options?: {
            requireConfirmation?: boolean;
            onProgress?: (executionId: string, progress: any) => void;
            onError?: (executionId: string, error: any) => void;
        }
    ): Promise<Message[]> {
        log.info(`========== TOOL EXECUTION FLOW ==========`);
        if (!response.tool_calls || response.tool_calls.length === 0) {
            log.info(`No tool calls to execute, returning early`);
            return [];
        }

        log.info(`Executing ${response.tool_calls.length} tool calls`);

        try {
            // Import tool registry directly to avoid circular dependencies
            const toolRegistry = (await import('../../tools/tool_registry.js')).default;

            // Check if tools are available
            const availableTools = toolRegistry.getAllTools();
            log.info(`Available tools in registry: ${availableTools.length}`);

            if (availableTools.length === 0) {
                log.error('No tools available in registry for execution');

                // Try to initialize tools
                try {
                    // Ensure tools are initialized
                    const initResult = await this.ensureToolsInitialized();
                    if (!initResult) {
                        throw new Error('Failed to initialize tools');
                    }
                } catch (error: unknown) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    log.error(`Failed to initialize tools: ${errorMessage}`);
                    throw new Error('Tool execution failed: No tools available');
                }
            }

            // Execute each tool call and collect results
            const toolResults = await Promise.all(response.tool_calls.map(async (toolCall: any) => {
                try {
                    log.info(`Executing tool: ${toolCall.function.name}, ID: ${toolCall.id || 'unknown'}`);

                    // Get the tool from registry
                    const tool = toolRegistry.getTool(toolCall.function.name);
                    if (!tool) {
                        throw new Error(`Tool not found: ${toolCall.function.name}`);
                    }

                    // Parse arguments
                    let args;
                    if (typeof toolCall.function.arguments === 'string') {
                        try {
                            args = JSON.parse(toolCall.function.arguments);
                        } catch (e: unknown) {
                            log.error(`Failed to parse tool arguments: ${e instanceof Error ? e.message : String(e)}`);

                            // Try cleanup and retry
                            try {
                                const cleaned = toolCall.function.arguments
                                    .replace(/^['"]|['"]$/g, '') // Remove surrounding quotes
                                    .replace(/\\"/g, '"')        // Replace escaped quotes
                                    .replace(/([{,])\s*'([^']+)'\s*:/g, '$1"$2":') // Replace single quotes around property names
                                    .replace(/([{,])\s*(\w+)\s*:/g, '$1"$2":');    // Add quotes around unquoted property names

                                args = JSON.parse(cleaned);
                            } catch (cleanErr) {
                                // If all parsing fails, use as-is
                                args = { text: toolCall.function.arguments };
                            }
                        }
                    } else {
                        args = toolCall.function.arguments;
                    }

                    // Log what we're about to execute
                    log.info(`Executing tool with arguments: ${JSON.stringify(args)}`);

                    // Execute the tool and get result
                    const startTime = Date.now();
                    const result = await tool.execute(args);
                    const executionTime = Date.now() - startTime;

                    log.info(`Tool execution completed in ${executionTime}ms`);

                    // Log the result
                    const resultPreview = typeof result === 'string'
                        ? result.substring(0, 100) + (result.length > 100 ? '...' : '')
                        : JSON.stringify(result).substring(0, 100) + '...';
                    log.info(`Tool result: ${resultPreview}`);

                    // Format result as a proper message
                    return {
                        role: 'tool',
                        content: typeof result === 'string' ? result : JSON.stringify(result),
                        name: toolCall.function.name,
                        tool_call_id: toolCall.id || `tool-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
                    };
                } catch (error: any) {
                    log.error(`Error executing tool ${toolCall.function.name}: ${error.message}`);

                    // Return error as tool result
                    return {
                        role: 'tool',
                        content: `Error: ${error.message}`,
                        name: toolCall.function.name,
                        tool_call_id: toolCall.id || `tool-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
                    };
                }
            }));

            log.info(`Completed execution of ${toolResults.length} tools`);
            return toolResults;
        } catch (error: any) {
            log.error(`Error in tool execution handler: ${error.message}`);
            throw error;
        }
    }

    /**
     * Ensure LLM tools are initialized
     */
    static async ensureToolsInitialized(): Promise<boolean> {
        try {
            log.info("Checking LLM tool initialization...");

            // Import tool registry
            const toolRegistry = (await import('../../tools/tool_registry.js')).default;

            // Check if tools are already initialized
            const registeredTools = toolRegistry.getAllTools();

            if (registeredTools.length === 0) {
                log.info("No tools found in registry.");
                log.info("Note: Tools should be initialized in the AIServiceManager constructor.");

                // Create AI service manager instance to trigger tool initialization
                const aiServiceManager = (await import('../../ai_service_manager.js')).default;
                aiServiceManager.getInstance();

                // Check again after AIServiceManager instantiation
                const tools = toolRegistry.getAllTools();
                log.info(`After AIServiceManager instantiation: ${tools.length} tools available`);
            } else {
                log.info(`LLM tools already initialized: ${registeredTools.length} tools available`);
            }

            // Get all available tools for logging
            const availableTools = toolRegistry.getAllTools().map(t => t.definition.function.name);
            log.info(`Available tools: ${availableTools.join(', ')}`);

            log.info("LLM tools initialized successfully: " + availableTools.length + " tools available");
            return true;
        } catch (error) {
            log.error(`Failed to initialize LLM tools: ${error}`);
            return false;
        }
    }
}
