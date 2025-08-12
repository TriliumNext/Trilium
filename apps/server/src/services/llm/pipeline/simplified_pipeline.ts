/**
 * Simplified Chat Pipeline - Phase 2.1 Implementation
 * 
 * This pipeline reduces complexity from 9 stages to 4 essential stages:
 * 1. Message Preparation (formatting, context, system prompt)
 * 2. LLM Execution (provider selection and API call)
 * 3. Tool Handling (parse, execute, format results)
 * 4. Response Processing (format response, add metadata, send to client)
 */

import type { 
    Message, 
    ChatCompletionOptions, 
    ChatResponse, 
    StreamChunk,
    ToolCall 
} from '../ai_interface.js';
import aiServiceManager from '../ai_service_manager.js';
import toolRegistry from '../tools/tool_registry.js';
import configurationService from './configuration_service.js';
import loggingService, { LogLevel } from './logging_service.js';
import type { StreamCallback } from './interfaces.js';

// Simplified pipeline input interface
export interface SimplifiedPipelineInput {
    messages: Message[];
    options?: ChatCompletionOptions;
    noteId?: string;
    query?: string;
    streamCallback?: StreamCallback;
    requestId?: string;
}

// Pipeline configuration
interface PipelineConfig {
    maxToolIterations: number;
    enableMetrics: boolean;
    enableStreaming: boolean;
}

/**
 * Simplified Chat Pipeline Implementation
 */
export class SimplifiedChatPipeline {
    private config: PipelineConfig;
    private metrics: Map<string, number> = new Map();

    constructor() {
        // Load configuration from centralized service
        this.config = {
            maxToolIterations: configurationService.getToolConfig().maxIterations,
            enableMetrics: configurationService.getDebugConfig().enableMetrics,
            enableStreaming: configurationService.getStreamingConfig().enabled
        };
    }

    /**
     * Execute the simplified pipeline
     */
    async execute(input: SimplifiedPipelineInput): Promise<ChatResponse> {
        const requestId = input.requestId || this.generateRequestId();
        const logger = loggingService.withRequestId(requestId);
        
        logger.log(LogLevel.INFO, 'Pipeline started', { 
            messageCount: input.messages.length,
            hasQuery: !!input.query,
            streaming: !!input.streamCallback 
        });

        const startTime = Date.now();

        try {
            // Stage 1: Message Preparation
            const preparedMessages = await this.prepareMessages(input, logger);
            
            // Stage 2: LLM Execution
            const llmResponse = await this.executeLLM(preparedMessages, input, logger);
            
            // Stage 3: Tool Handling (if needed)
            const finalResponse = await this.handleTools(llmResponse, preparedMessages, input, logger);
            
            // Stage 4: Response Processing
            const processedResponse = await this.processResponse(finalResponse, input, logger);
            
            // Record metrics
            if (this.config.enableMetrics) {
                this.recordMetric('pipeline_duration', Date.now() - startTime);
            }
            
            logger.log(LogLevel.INFO, 'Pipeline completed', {
                duration: Date.now() - startTime,
                responseLength: processedResponse.text.length
            });
            
            return processedResponse;
            
        } catch (error) {
            logger.log(LogLevel.ERROR, 'Pipeline error', { error });
            throw error;
        }
    }

    /**
     * Stage 1: Message Preparation
     * Combines formatting, context enrichment, and system prompt injection
     */
    private async prepareMessages(
        input: SimplifiedPipelineInput,
        logger: ReturnType<typeof loggingService.withRequestId>
    ): Promise<Message[]> {
        const startTime = Date.now();
        logger.log(LogLevel.DEBUG, 'Stage 1: Message preparation started');

        const messages: Message[] = [...input.messages];
        
        // Add system prompt if provided
        const systemPrompt = input.options?.systemPrompt || configurationService.getDefaultSystemPrompt();
        if (systemPrompt && !messages.some(m => m.role === 'system')) {
            messages.unshift({
                role: 'system',
                content: systemPrompt
            });
        }
        
        // Add context if query is provided and context is enabled
        if (input.query && input.options?.useAdvancedContext) {
            const context = await this.extractContext(input.query, input.noteId);
            if (context) {
                // Find the last system message or create one
                const lastSystemIndex = messages.findIndex(m => m.role === 'system');
                if (lastSystemIndex >= 0) {
                    messages[lastSystemIndex].content += `\n\nContext:\n${context}`;
                } else {
                    messages.unshift({
                        role: 'system',
                        content: `Context:\n${context}`
                    });
                }
            }
        }
        
        this.recordMetric('message_preparation', Date.now() - startTime);
        logger.log(LogLevel.DEBUG, 'Stage 1: Message preparation completed', {
            messageCount: messages.length,
            duration: Date.now() - startTime
        });
        
        return messages;
    }

    /**
     * Stage 2: LLM Execution
     * Handles provider selection and API call
     */
    private async executeLLM(
        messages: Message[],
        input: SimplifiedPipelineInput,
        logger: ReturnType<typeof loggingService.withRequestId>
    ): Promise<ChatResponse> {
        const startTime = Date.now();
        logger.log(LogLevel.DEBUG, 'Stage 2: LLM execution started');

        // Get completion options with defaults
        const options: ChatCompletionOptions = {
            ...configurationService.getDefaultCompletionOptions(),
            ...input.options,
            stream: this.config.enableStreaming && !!input.streamCallback
        };
        
        // Add tools if enabled
        if (options.enableTools !== false) {
            const tools = toolRegistry.getAllToolDefinitions();
            if (tools.length > 0) {
                options.tools = tools;
                logger.log(LogLevel.DEBUG, 'Tools enabled', { toolCount: tools.length });
            }
        }
        
        // Execute LLM call
        const service = await aiServiceManager.getService();
        if (!service) {
            throw new Error('No AI service available');
        }
        
        const response = await service.generateChatCompletion(messages, options);
        
        this.recordMetric('llm_execution', Date.now() - startTime);
        logger.log(LogLevel.DEBUG, 'Stage 2: LLM execution completed', {
            provider: response.provider,
            model: response.model,
            hasToolCalls: !!(response.tool_calls?.length),
            duration: Date.now() - startTime
        });
        
        return response;
    }

    /**
     * Stage 3: Tool Handling
     * Parses tool calls, executes them, and handles follow-up LLM calls
     */
    private async handleTools(
        response: ChatResponse,
        messages: Message[],
        input: SimplifiedPipelineInput,
        logger: ReturnType<typeof loggingService.withRequestId>
    ): Promise<ChatResponse> {
        // Return immediately if no tools to handle
        if (!response.tool_calls?.length || input.options?.enableTools === false) {
            return response;
        }
        
        const startTime = Date.now();
        logger.log(LogLevel.INFO, 'Stage 3: Tool handling started', {
            toolCount: response.tool_calls.length
        });

        let currentResponse = response;
        let currentMessages = [...messages];
        let iterations = 0;
        
        while (iterations < this.config.maxToolIterations && currentResponse.tool_calls?.length) {
            iterations++;
            logger.log(LogLevel.DEBUG, `Tool iteration ${iterations}/${this.config.maxToolIterations}`);
            
            // Add assistant message with tool calls
            currentMessages.push({
                role: 'assistant',
                content: currentResponse.text || '',
                tool_calls: currentResponse.tool_calls
            });
            
            // Execute tools and collect results
            const toolResults = await this.executeTools(currentResponse.tool_calls, logger);
            
            // Add tool results to messages
            for (const result of toolResults) {
                currentMessages.push({
                    role: 'tool',
                    content: result.content,
                    tool_call_id: result.toolCallId
                });
            }
            
            // Send tool results back to LLM for follow-up
            const followUpOptions: ChatCompletionOptions = {
                ...input.options,
                stream: false, // Don't stream tool follow-ups
                enableTools: true
            };
            
            const service = await aiServiceManager.getService();
            if (!service) {
                throw new Error('No AI service available');
            }
            
            currentResponse = await service.generateChatCompletion(currentMessages, followUpOptions);
            
            // Check if we need another iteration
            if (!currentResponse.tool_calls?.length) {
                break;
            }
        }
        
        if (iterations >= this.config.maxToolIterations) {
            logger.log(LogLevel.WARN, 'Maximum tool iterations reached', {
                iterations: this.config.maxToolIterations
            });
        }
        
        this.recordMetric('tool_handling', Date.now() - startTime);
        logger.log(LogLevel.INFO, 'Stage 3: Tool handling completed', {
            iterations,
            duration: Date.now() - startTime
        });
        
        return currentResponse;
    }

    /**
     * Stage 4: Response Processing
     * Formats the response and handles streaming
     */
    private async processResponse(
        response: ChatResponse,
        input: SimplifiedPipelineInput,
        logger: ReturnType<typeof loggingService.withRequestId>
    ): Promise<ChatResponse> {
        const startTime = Date.now();
        logger.log(LogLevel.DEBUG, 'Stage 4: Response processing started');

        // Handle streaming if enabled
        if (input.streamCallback && response.stream) {
            let accumulatedText = '';
            
            await response.stream(async (chunk: StreamChunk) => {
                accumulatedText += chunk.text;
                await input.streamCallback!(chunk.text, chunk.done || false, chunk);
            });
            
            // Update response text with accumulated content
            response.text = accumulatedText;
        }
        
        // Add metadata to response (cast to any to add extra properties)
        (response as any).metadata = {
            requestId: logger.requestId,
            processingTime: Date.now() - startTime
        };
        
        this.recordMetric('response_processing', Date.now() - startTime);
        logger.log(LogLevel.DEBUG, 'Stage 4: Response processing completed', {
            responseLength: response.text.length,
            duration: Date.now() - startTime
        });
        
        return response;
    }

    /**
     * Execute tool calls and return results
     */
    private async executeTools(
        toolCalls: ToolCall[],
        logger: ReturnType<typeof loggingService.withRequestId>
    ): Promise<Array<{ toolCallId: string; content: string }>> {
        const results: Array<{ toolCallId: string; content: string }> = [];
        
        for (const toolCall of toolCalls) {
            try {
                const tool = toolRegistry.getTool(toolCall.function.name);
                if (!tool) {
                    throw new Error(`Tool not found: ${toolCall.function.name}`);
                }
                
                const argsString = typeof toolCall.function.arguments === 'string' 
                    ? toolCall.function.arguments 
                    : JSON.stringify(toolCall.function.arguments || {});
                const args = JSON.parse(argsString);
                const result = await tool.execute(args);
                
                results.push({
                    toolCallId: toolCall.id || `tool_${Date.now()}`,
                    content: typeof result === 'string' ? result : JSON.stringify(result)
                });
                
                logger.log(LogLevel.DEBUG, 'Tool executed successfully', {
                    tool: toolCall.function.name,
                    toolCallId: toolCall.id || 'no-id'
                });
                
            } catch (error) {
                logger.log(LogLevel.ERROR, 'Tool execution failed', {
                    tool: toolCall.function.name,
                    error
                });
                
                results.push({
                    toolCallId: toolCall.id || `tool_error_${Date.now()}`,
                    content: `Error: ${error instanceof Error ? error.message : String(error)}`
                });
            }
        }
        
        return results;
    }

    /**
     * Extract context for the query (simplified version)
     */
    private async extractContext(query: string, noteId?: string): Promise<string | null> {
        try {
            // This is a simplified context extraction
            // In production, this would call the semantic search service
            const contextService = await import('../context/services/context_service.js');
            const results = await contextService.default.findRelevantNotes(query, noteId, {
                maxResults: 5,
                summarize: true
            });
            
            // Format results as context string
            if (results && results.length > 0) {
                return results.map(r => `${r.title}: ${r.content}`).join('\n\n');
            }
            return null;
        } catch (error) {
            loggingService.log(LogLevel.ERROR, 'Context extraction failed', { error });
            return null;
        }
    }

    /**
     * Generate a unique request ID
     */
    private generateRequestId(): string {
        return `req_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    }

    /**
     * Record a metric
     */
    private recordMetric(name: string, value: number): void {
        if (!this.config.enableMetrics) return;
        
        const current = this.metrics.get(name) || 0;
        const count = this.metrics.get(`${name}_count`) || 0;
        
        // Calculate running average
        const newAverage = (current * count + value) / (count + 1);
        
        this.metrics.set(name, newAverage);
        this.metrics.set(`${name}_count`, count + 1);
    }

    /**
     * Get current metrics
     */
    getMetrics(): Record<string, number> {
        const result: Record<string, number> = {};
        this.metrics.forEach((value, key) => {
            if (!key.endsWith('_count')) {
                result[key] = value;
            }
        });
        return result;
    }

    /**
     * Reset metrics
     */
    resetMetrics(): void {
        this.metrics.clear();
    }
}

// Export singleton instance
export default new SimplifiedChatPipeline();