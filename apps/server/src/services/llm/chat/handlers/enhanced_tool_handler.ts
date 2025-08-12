/**
 * Enhanced Handler for LLM tool executions with preview, feedback, and error recovery
 */
import log from "../../../log.js";
import type { Message } from "../../ai_interface.js";
import type { ToolCall } from "../../tools/tool_interfaces.js";
import { toolPreviewManager, type ToolExecutionPlan, type ToolApproval } from "../../tools/tool_preview.js";
import { toolFeedbackManager, type ToolExecutionProgress } from "../../tools/tool_feedback.js";
import { toolErrorRecoveryManager, type ToolError } from "../../tools/tool_error_recovery.js";

/**
 * Tool execution options
 */
export interface ToolExecutionOptions {
    requireConfirmation?: boolean;
    enablePreview?: boolean;
    enableFeedback?: boolean;
    enableErrorRecovery?: boolean;
    timeout?: number;
    /** Maximum parallel executions (default: 3) */
    maxConcurrency?: number;
    /** Enable dependency analysis for parallel execution (default: true) */
    analyzeDependencies?: boolean;
    /** Provider for tool execution */
    provider?: string;
    /** Custom timeout per tool in ms */
    customTimeouts?: Map<string, number>;
    /** Enable caching for read operations */
    enableCache?: boolean;
    onPreview?: (plan: ToolExecutionPlan) => Promise<ToolApproval>;
    onProgress?: (executionId: string, progress: ToolExecutionProgress) => void;
    onStep?: (executionId: string, step: any) => void;
    onError?: (executionId: string, error: ToolError) => void;
    onComplete?: (executionId: string, result: any) => void;
}

/**
 * Enhanced tool handler with preview, feedback, and error recovery
 */
export class EnhancedToolHandler {
    /**
     * Execute tool calls with enhanced features
     */
    static async executeToolCalls(
        response: any,
        chatNoteId?: string,
        options: ToolExecutionOptions = {}
    ): Promise<Message[]> {
        log.info(`========== ENHANCED TOOL EXECUTION FLOW ==========`);
        
        if (!response.tool_calls || response.tool_calls.length === 0) {
            log.info(`No tool calls to execute, returning early`);
            return [];
        }

        log.info(`Executing ${response.tool_calls.length} tool calls with enhanced features`);

        try {
            // Import tool registry
            const toolRegistry = (await import('../../tools/tool_registry.js')).default;

            // Check if tools are available
            const availableTools = toolRegistry.getAllTools();
            log.info(`Available tools in registry: ${availableTools.length}`);

            if (availableTools.length === 0) {
                log.error('No tools available in registry for execution');
                throw new Error('Tool execution failed: No tools available');
            }

            // Create handlers map
            const handlers = new Map<string, any>();
            for (const toolCall of response.tool_calls) {
                const tool = toolRegistry.getTool(toolCall.function.name);
                if (tool) {
                    handlers.set(toolCall.function.name, tool);
                }
            }

            // Phase 1: Tool Preview
            let executionPlan: ToolExecutionPlan | undefined;
            let approval: ToolApproval | undefined;

            if (options.enablePreview !== false) {
                executionPlan = toolPreviewManager.createExecutionPlan(response.tool_calls, handlers);
                log.info(`Created execution plan ${executionPlan.id} with ${executionPlan.tools.length} tools`);
                log.info(`Estimated duration: ${executionPlan.totalEstimatedDuration}ms`);
                log.info(`Requires confirmation: ${executionPlan.requiresConfirmation}`);

                // Check if confirmation is required
                if (options.requireConfirmation && executionPlan.requiresConfirmation) {
                    if (options.onPreview) {
                        // Get approval from client
                        approval = await options.onPreview(executionPlan);
                        toolPreviewManager.recordApproval(approval);

                        if (!approval.approved) {
                            log.info(`Execution plan ${executionPlan.id} was rejected`);
                            return [{
                                role: 'system',
                                content: 'Tool execution was cancelled by user'
                            }];
                        }
                    } else {
                        // Auto-approve if no preview handler provided
                        approval = {
                            planId: executionPlan.id,
                            approved: true,
                            approvedBy: 'system'
                        };
                        toolPreviewManager.recordApproval(approval);
                    }
                }
            }

            // Phase 2: Execute tools with feedback and error recovery
            const toolResults = await Promise.all(response.tool_calls.map(async (toolCall: ToolCall) => {
                // Check if this tool was rejected
                if (approval?.rejectedTools?.includes(toolCall.function.name)) {
                    log.info(`Skipping rejected tool: ${toolCall.function.name}`);
                    return {
                        role: 'tool',
                        content: 'Tool execution was rejected by user',
                        name: toolCall.function.name,
                        tool_call_id: toolCall.id || `tool-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
                    };
                }

                // Start feedback tracking
                let executionId: string | undefined;
                if (options.enableFeedback !== false) {
                    executionId = toolFeedbackManager.startExecution(toolCall, options.timeout);
                }

                try {
                    log.info(`Executing tool: ${toolCall.function.name}, ID: ${toolCall.id || 'unknown'}`);

                    // Get the tool from registry
                    const tool = toolRegistry.getTool(toolCall.function.name);
                    if (!tool) {
                        const error = `Tool not found: ${toolCall.function.name}`;
                        if (executionId) {
                            toolFeedbackManager.failExecution(executionId, error);
                        }
                        throw new Error(error);
                    }

                    // Parse arguments (with modifications if provided)
                    let args = typeof toolCall.function.arguments === 'string'
                        ? JSON.parse(toolCall.function.arguments)
                        : toolCall.function.arguments;

                    // Apply parameter modifications from approval if any
                    if (approval?.modifiedParameters?.[toolCall.function.name]) {
                        args = { ...args, ...approval.modifiedParameters[toolCall.function.name] };
                        log.info(`Applied modified parameters for ${toolCall.function.name}`);
                    }

                    // Add execution step
                    if (executionId) {
                        toolFeedbackManager.addStep(executionId, {
                            timestamp: new Date(),
                            message: `Starting ${toolCall.function.name} execution`,
                            type: 'info',
                            data: { arguments: args }
                        });

                        if (options.onStep) {
                            options.onStep(executionId, {
                                type: 'start',
                                tool: toolCall.function.name,
                                arguments: args
                            });
                        }
                    }

                    // Execute with error recovery if enabled
                    let result: any;
                    let executionTime: number;

                    if (options.enableErrorRecovery !== false) {
                        const executionResult = await toolErrorRecoveryManager.executeWithRecovery(
                            { ...toolCall, function: { ...toolCall.function, arguments: args } },
                            tool,
                            (attempt, delay) => {
                                if (executionId) {
                                    toolFeedbackManager.addStep(executionId, {
                                        timestamp: new Date(),
                                        message: `Retry attempt ${attempt} after ${delay}ms`,
                                        type: 'warning'
                                    });

                                    if (options.onProgress) {
                                        options.onProgress(executionId, {
                                            current: attempt,
                                            total: 3,
                                            percentage: (attempt / 3) * 100,
                                            message: `Retrying...`
                                        });
                                    }
                                }
                            }
                        );

                        if (!executionResult.success) {
                            const error = executionResult.error;
                            if (executionId) {
                                toolFeedbackManager.failExecution(executionId, error?.message || 'Unknown error');
                            }

                            if (options.onError && executionId && error) {
                                options.onError(executionId, error);
                            }

                            // Suggest recovery actions
                            if (error) {
                                const recoveryActions = toolErrorRecoveryManager.suggestRecoveryActions(
                                    toolCall.function.name,
                                    error,
                                    args
                                );
                                log.info(`Recovery suggestions: ${recoveryActions.map(a => a.description).join(', ')}`);
                            }

                            throw new Error(error?.userMessage || error?.message || 'Tool execution failed');
                        }

                        result = executionResult.data;
                        executionTime = executionResult.totalDuration;

                        if (executionResult.recovered) {
                            log.info(`Tool ${toolCall.function.name} recovered after ${executionResult.attempts} attempts`);
                        }
                    } else {
                        // Direct execution without error recovery
                        const startTime = Date.now();
                        result = await tool.execute(args);
                        executionTime = Date.now() - startTime;
                    }

                    // Complete feedback tracking
                    if (executionId) {
                        toolFeedbackManager.completeExecution(executionId, result);

                        if (options.onComplete) {
                            options.onComplete(executionId, result);
                        }
                    }

                    log.info(`Tool execution completed in ${executionTime}ms`);

                    // Log the result preview
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

                    // Fail execution tracking
                    if (executionId) {
                        toolFeedbackManager.failExecution(executionId, error.message);
                    }

                    // Categorize error for better reporting
                    const categorizedError = toolErrorRecoveryManager.categorizeError(error);

                    if (options.onError && executionId) {
                        options.onError(executionId, categorizedError);
                    }

                    // Return error as tool result
                    return {
                        role: 'tool',
                        content: categorizedError.userMessage || `Error: ${error.message}`,
                        name: toolCall.function.name,
                        tool_call_id: toolCall.id || `tool-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
                    };
                }
            }));

            log.info(`Completed execution of ${toolResults.length} tools`);

            // Get execution statistics if feedback is enabled
            if (options.enableFeedback !== false) {
                const stats = toolFeedbackManager.getStatistics();
                log.info(`Execution statistics: ${stats.successfulExecutions} successful, ${stats.failedExecutions} failed`);
            }

            return toolResults;

        } catch (error: any) {
            log.error(`Error in enhanced tool execution handler: ${error.message}`);
            throw error;
        }
    }

    /**
     * Get tool execution history
     */
    static getExecutionHistory(filter?: any) {
        return toolFeedbackManager.getHistory(filter);
    }

    /**
     * Get tool execution statistics
     */
    static getExecutionStatistics() {
        return toolFeedbackManager.getStatistics();
    }

    /**
     * Cancel a running tool execution
     */
    static cancelExecution(executionId: string, reason?: string): boolean {
        return toolFeedbackManager.cancelExecution(executionId, 'user', reason);
    }

    /**
     * Get active tool executions
     */
    static getActiveExecutions() {
        return toolFeedbackManager.getActiveExecutions();
    }

    /**
     * Clean up old execution data
     */
    static cleanup() {
        toolPreviewManager.cleanup();
        toolFeedbackManager.clear();
        toolErrorRecoveryManager.clearHistory();
    }
}