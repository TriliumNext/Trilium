/**
 * Simplified Pipeline V2 - Phase 1 Implementation
 *
 * This pipeline reduces complexity from 8 stages to 3 essential stages:
 * 1. Message Preparation (system prompt + context if needed)
 * 2. LLM Execution (provider call + tool handling loop)
 * 3. Response Formatting (clean output)
 *
 * Key improvements over original pipeline:
 * - 60% reduction in lines of code (from ~1000 to ~400)
 * - Eliminates unnecessary stages (semantic search, model selection, etc.)
 * - Consolidates tool execution into LLM execution stage
 * - Clearer control flow and error handling
 * - Better separation of concerns
 *
 * Design principles:
 * - Keep it simple and maintainable
 * - Use existing tool registry (no changes to tools in Phase 1)
 * - Backward compatible with existing options
 * - Feature flag ready for gradual migration
 */

import type {
    Message,
    ChatCompletionOptions,
    ChatResponse,
    StreamChunk
} from '../ai_interface.js';
import type { ToolCall } from '../tools/tool_interfaces.js';
import aiServiceManager from '../ai_service_manager.js';
import toolRegistry from '../tools/tool_registry.js';
import pipelineConfigService from '../config/pipeline_config.js';
import { createLogger, generateRequestId, LogLevel } from '../utils/structured_logger.js';
import type { StructuredLogger } from '../utils/structured_logger.js';

/**
 * Pipeline input interface
 */
export interface PipelineV2Input {
    messages: Message[];
    options?: ChatCompletionOptions;
    noteId?: string;
    query?: string;
    streamCallback?: (text: string, done: boolean, chunk?: any) => Promise<void> | void;
    requestId?: string;
}

/**
 * Pipeline output interface
 */
export interface PipelineV2Output extends ChatResponse {
    requestId: string;
    processingTime: number;
    stagesExecuted: string[];
}

/**
 * Simplified Pipeline V2 Implementation
 */
export class PipelineV2 {
    private logger: StructuredLogger;

    constructor() {
        const config = pipelineConfigService.getConfig();
        this.logger = createLogger(config.enableDebugLogging);
    }

    /**
     * Execute the simplified pipeline
     */
    async execute(input: PipelineV2Input): Promise<PipelineV2Output> {
        const requestId = input.requestId || generateRequestId();
        const logger = this.logger.withRequestId(requestId);
        const startTime = Date.now();
        const stagesExecuted: string[] = [];

        logger.info('Pipeline V2 started', {
            messageCount: input.messages.length,
            hasQuery: !!input.query,
            streaming: !!input.streamCallback
        });

        try {
            // Stage 1: Message Preparation
            const preparedMessages = await this.prepareMessages(input, logger);
            stagesExecuted.push('message_preparation');

            // Stage 2: LLM Execution (includes tool handling)
            const llmResponse = await this.executeLLM(preparedMessages, input, logger);
            stagesExecuted.push('llm_execution');

            // Stage 3: Response Formatting
            const formattedResponse = await this.formatResponse(llmResponse, input, logger);
            stagesExecuted.push('response_formatting');

            const processingTime = Date.now() - startTime;
            logger.info('Pipeline V2 completed', {
                duration: processingTime,
                responseLength: formattedResponse.text.length,
                stagesExecuted
            });

            return {
                ...formattedResponse,
                requestId,
                processingTime,
                stagesExecuted
            };

        } catch (error) {
            logger.error('Pipeline V2 error', error);
            throw error;
        }
    }

    /**
     * Stage 1: Message Preparation
     * Prepares messages with system prompt and context
     */
    private async prepareMessages(
        input: PipelineV2Input,
        logger: StructuredLogger
    ): Promise<Message[]> {
        const timer = logger.startTimer('Stage 1: Message Preparation');

        logger.debug('Preparing messages', {
            messageCount: input.messages.length,
            hasQuery: !!input.query,
            useAdvancedContext: input.options?.useAdvancedContext
        });

        const messages: Message[] = [...input.messages];

        // Add system prompt if not present
        const systemPrompt = input.options?.systemPrompt || this.getDefaultSystemPrompt();
        if (systemPrompt && !messages.some(m => m.role === 'system')) {
            messages.unshift({
                role: 'system',
                content: systemPrompt
            });
        }

        // Add context if enabled and query is provided
        if (input.query && input.options?.useAdvancedContext) {
            const context = await this.extractContext(input.query, input.noteId, logger);
            if (context) {
                // Append context to system message
                const systemIndex = messages.findIndex(m => m.role === 'system');
                if (systemIndex >= 0) {
                    messages[systemIndex].content += `\n\nRelevant context:\n${context}`;
                } else {
                    messages.unshift({
                        role: 'system',
                        content: `Relevant context:\n${context}`
                    });
                }
                logger.debug('Added context to messages', {
                    contextLength: context.length
                });
            }
        }

        timer();
        logger.debug('Message preparation complete', {
            finalMessageCount: messages.length
        });

        return messages;
    }

    /**
     * Stage 2: LLM Execution
     * Handles LLM calls and tool execution loop
     */
    private async executeLLM(
        messages: Message[],
        input: PipelineV2Input,
        logger: StructuredLogger
    ): Promise<ChatResponse> {
        const timer = logger.startTimer('Stage 2: LLM Execution');
        const config = pipelineConfigService.getConfig();

        // Prepare completion options
        const options: ChatCompletionOptions = {
            ...input.options,
            stream: config.enableStreaming && !!input.streamCallback
        };

        // Add tools if enabled
        // Phase 3 Note: Tool filtering is applied at the provider level (e.g., OllamaService)
        // rather than here in the pipeline. This allows provider-specific optimizations.
        if (config.enableTools && options.enableTools !== false) {
            const tools = toolRegistry.getAllToolDefinitions();
            if (tools.length > 0) {
                options.tools = tools;
                logger.debug('Tools enabled', { toolCount: tools.length });
            }
        }

        // Get AI service
        const service = await aiServiceManager.getService();
        if (!service) {
            throw new Error('No AI service available');
        }

        // Initial LLM call
        let currentMessages = messages;
        let currentResponse = await service.generateChatCompletion(currentMessages, options);
        let accumulatedText = '';

        logger.info('Initial LLM response received', {
            provider: currentResponse.provider,
            model: currentResponse.model,
            hasToolCalls: !!currentResponse.tool_calls?.length
        });

        // Handle streaming if enabled with memory limit protection
        const MAX_RESPONSE_SIZE = 1_000_000; // 1MB safety limit
        if (input.streamCallback && currentResponse.stream) {
            await currentResponse.stream(async (chunk: StreamChunk) => {
                // Protect against excessive memory accumulation
                if (accumulatedText.length + chunk.text.length > MAX_RESPONSE_SIZE) {
                    logger.warn('Response size limit exceeded during streaming', {
                        currentSize: accumulatedText.length,
                        chunkSize: chunk.text.length,
                        limit: MAX_RESPONSE_SIZE
                    });
                    throw new Error(`Response too large: exceeded ${MAX_RESPONSE_SIZE} bytes`);
                }

                accumulatedText += chunk.text;
                await input.streamCallback!(chunk.text, chunk.done || false, chunk);
            });
            currentResponse.text = accumulatedText;
        }

        // Tool execution loop with circuit breaker
        const toolsEnabled = config.enableTools && options.enableTools !== false;
        if (toolsEnabled && currentResponse.tool_calls?.length) {
            logger.info('Starting tool execution loop', {
                initialToolCount: currentResponse.tool_calls.length
            });

            let iterations = 0;
            const maxIterations = config.maxToolIterations;

            // Circuit breaker: Track consecutive failures to prevent infinite error loops
            let consecutiveErrors = 0;
            const MAX_CONSECUTIVE_ERRORS = 2;

            while (iterations < maxIterations && currentResponse.tool_calls?.length) {
                iterations++;
                logger.debug(`Tool iteration ${iterations}/${maxIterations}`, {
                    toolCallCount: currentResponse.tool_calls.length
                });

                // Add assistant message with tool calls
                currentMessages.push({
                    role: 'assistant',
                    content: currentResponse.text || '',
                    tool_calls: currentResponse.tool_calls
                });

                // Execute tools
                const toolResults = await this.executeTools(
                    currentResponse.tool_calls,
                    logger,
                    input.streamCallback
                );

                // Circuit breaker: Check if all tools failed
                const allFailed = toolResults.every(r => r.content.startsWith('Error:'));
                if (allFailed) {
                    consecutiveErrors++;
                    logger.warn('All tools failed in this iteration', {
                        consecutiveErrors,
                        iteration: iterations
                    });

                    if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
                        logger.warn('Circuit breaker triggered: too many consecutive tool failures, breaking loop', {
                            consecutiveErrors,
                            maxAllowed: MAX_CONSECUTIVE_ERRORS
                        });
                        break;
                    }
                } else {
                    // Reset counter on successful tool execution
                    consecutiveErrors = 0;
                }

                // Add tool results to messages
                for (const result of toolResults) {
                    currentMessages.push({
                        role: 'tool',
                        content: result.content,
                        tool_call_id: result.toolCallId
                    });
                }

                // Follow-up LLM call with tool results
                const followUpOptions: ChatCompletionOptions = {
                    ...options,
                    stream: false, // Don't stream follow-up calls
                    enableTools: true
                };

                currentResponse = await service.generateChatCompletion(
                    currentMessages,
                    followUpOptions
                );

                logger.debug('Follow-up LLM response received', {
                    hasMoreToolCalls: !!currentResponse.tool_calls?.length
                });

                // Break if no more tool calls
                if (!currentResponse.tool_calls?.length) {
                    break;
                }
            }

            if (iterations >= maxIterations) {
                logger.warn('Maximum tool iterations reached', { iterations: maxIterations });
            }

            logger.info('Tool execution loop complete', { totalIterations: iterations });
        }

        timer();
        return currentResponse;
    }

    /**
     * Stage 3: Response Formatting
     * Formats the final response
     */
    private async formatResponse(
        response: ChatResponse,
        input: PipelineV2Input,
        logger: StructuredLogger
    ): Promise<ChatResponse> {
        const timer = logger.startTimer('Stage 3: Response Formatting');

        logger.debug('Formatting response', {
            textLength: response.text.length,
            hasUsage: !!response.usage
        });

        // Response is already formatted by the service
        // This stage is a placeholder for future formatting logic

        timer();
        return response;
    }

    /**
     * Execute tool calls with timeout enforcement
     */
    private async executeTools(
        toolCalls: ToolCall[],
        logger: StructuredLogger,
        streamCallback?: (text: string, done: boolean, chunk?: any) => Promise<void> | void
    ): Promise<Array<{ toolCallId: string; content: string }>> {
        const results: Array<{ toolCallId: string; content: string }> = [];
        const config = pipelineConfigService.getConfig();

        // Notify about tool execution start
        if (streamCallback) {
            await streamCallback('', false, {
                text: '',
                done: false,
                toolExecution: {
                    type: 'start',
                    tool: { name: 'tool_execution', arguments: {} }
                }
            });
        }

        for (const toolCall of toolCalls) {
            try {
                const tool = toolRegistry.getTool(toolCall.function.name);
                if (!tool) {
                    throw new Error(`Tool not found: ${toolCall.function.name}`);
                }

                // Parse arguments
                const argsString = typeof toolCall.function.arguments === 'string'
                    ? toolCall.function.arguments
                    : JSON.stringify(toolCall.function.arguments || {});
                const args = JSON.parse(argsString);

                // Execute tool with timeout enforcement
                const result = await Promise.race([
                    tool.execute(args),
                    new Promise<never>((_, reject) =>
                        setTimeout(
                            () => reject(new Error(`Tool execution timeout after ${config.toolTimeout}ms`)),
                            config.toolTimeout
                        )
                    )
                ]);

                const toolResult = {
                    toolCallId: toolCall.id || `tool_${Date.now()}`,
                    content: typeof result === 'string' ? result : JSON.stringify(result)
                };

                results.push(toolResult);

                logger.debug('Tool executed successfully', {
                    tool: toolCall.function.name,
                    toolCallId: toolCall.id
                });

                // Notify about tool completion
                if (streamCallback) {
                    await streamCallback('', false, {
                        text: '',
                        done: false,
                        toolExecution: {
                            type: 'complete',
                            tool: {
                                name: toolCall.function.name,
                                arguments: args
                            },
                            result: result
                        }
                    });
                }

            } catch (error) {
                logger.error('Tool execution failed', {
                    tool: toolCall.function.name,
                    error
                });

                const errorResult = {
                    toolCallId: toolCall.id || `tool_error_${Date.now()}`,
                    content: `Error: ${error instanceof Error ? error.message : String(error)}`
                };

                results.push(errorResult);

                // Notify about tool error
                if (streamCallback) {
                    await streamCallback('', false, {
                        text: '',
                        done: false,
                        toolExecution: {
                            type: 'error',
                            tool: {
                                name: toolCall.function.name,
                                arguments: {}
                            },
                            result: errorResult.content
                        }
                    });
                }
            }
        }

        return results;
    }

    /**
     * Extract context for the query
     * Simplified version that delegates to existing context service
     */
    private async extractContext(
        query: string,
        noteId: string | undefined,
        logger: StructuredLogger
    ): Promise<string | null> {
        try {
            // Use existing context service if available
            const contextService = await import('../context/services/context_service.js');

            // Check if service is properly loaded with expected interface
            if (!contextService?.default?.findRelevantNotes) {
                logger.debug('Context service not available or incomplete');
                return null;
            }

            const results = await contextService.default.findRelevantNotes(query, noteId, {
                maxResults: 5,
                summarize: true
            });

            if (results && results.length > 0) {
                return results.map(r => `${r.title}: ${r.content}`).join('\n\n');
            }

            return null;
        } catch (error: any) {
            // Distinguish between module not found (acceptable) and execution errors (log it)
            if (error?.code === 'MODULE_NOT_FOUND' || error?.code === 'ERR_MODULE_NOT_FOUND') {
                logger.debug('Context service not installed', {
                    path: error.message || 'unknown'
                });
                return null;
            }

            // Log actual execution errors
            logger.error('Context extraction failed during execution', error);
            return null;
        }
    }

    /**
     * Get default system prompt
     */
    private getDefaultSystemPrompt(): string {
        return 'You are a helpful AI assistant for Trilium Notes. You help users manage and understand their notes.';
    }
}

// Export singleton instance
const pipelineV2 = new PipelineV2();
export default pipelineV2;

/**
 * Convenience function to execute pipeline
 */
export async function executePipeline(input: PipelineV2Input): Promise<PipelineV2Output> {
    return pipelineV2.execute(input);
}
