/**
 * Unified Stream Handler
 * 
 * Provides a consistent streaming interface across all providers,
 * handling provider-specific stream formats and normalizing them
 * into a unified format.
 */

import log from '../../log.js';
import type { ChatResponse } from '../ai_interface.js';

/**
 * Unified stream chunk format
 */
export interface UnifiedStreamChunk {
    type: 'content' | 'tool_call' | 'error' | 'done';
    content?: string;
    toolCall?: {
        id: string;
        name: string;
        arguments: string;
    };
    error?: string;
    metadata?: {
        provider: string;
        model?: string;
        finishReason?: string;
        usage?: {
            promptTokens?: number;
            completionTokens?: number;
            totalTokens?: number;
        };
    };
}

/**
 * Stream handler configuration
 */
export interface StreamHandlerConfig {
    provider: 'openai' | 'anthropic' | 'ollama';
    onChunk: (chunk: UnifiedStreamChunk) => void | Promise<void>;
    onError?: (error: Error) => void;
    onComplete?: (response: ChatResponse) => void;
    bufferSize?: number;
    timeout?: number;
}

/**
 * Abstract base class for provider-specific stream handlers
 */
export abstract class BaseStreamHandler {
    protected config: StreamHandlerConfig;
    protected buffer: string = '';
    protected response: Partial<ChatResponse> = {};
    protected finishReason?: string;
    protected isComplete: boolean = false;
    protected timeoutTimer?: NodeJS.Timeout;

    constructor(config: StreamHandlerConfig) {
        this.config = config;
        
        if (config.timeout) {
            this.setTimeoutTimer(config.timeout);
        }
    }

    /**
     * Process a stream chunk from the provider
     */
    public abstract processChunk(chunk: any): Promise<void>;

    /**
     * Complete the stream processing
     */
    public abstract complete(): Promise<ChatResponse>;

    /**
     * Handle stream error
     */
    public handleError(error: Error): void {
        this.clearTimeoutTimer();
        
        if (this.config.onError) {
            this.config.onError(error);
        } else {
            log.error(`[StreamHandler] Stream error: ${error.message}`);
        }

        // Send error chunk
        this.sendChunk({
            type: 'error',
            error: error.message,
            metadata: {
                provider: this.config.provider
            }
        });
    }

    /**
     * Send a unified chunk to the consumer
     */
    protected async sendChunk(chunk: UnifiedStreamChunk): Promise<void> {
        try {
            await this.config.onChunk(chunk);
        } catch (error) {
            log.error(`[StreamHandler] Error in chunk handler: ${error}`);
        }
    }

    /**
     * Set timeout timer
     */
    protected setTimeoutTimer(timeout: number): void {
        this.timeoutTimer = setTimeout(() => {
            this.handleError(new Error(`Stream timeout after ${timeout}ms`));
        }, timeout);
    }

    /**
     * Clear timeout timer
     */
    protected clearTimeoutTimer(): void {
        if (this.timeoutTimer) {
            clearTimeout(this.timeoutTimer);
            this.timeoutTimer = undefined;
        }
    }

    /**
     * Reset timeout timer
     */
    protected resetTimeoutTimer(): void {
        if (this.config.timeout) {
            this.clearTimeoutTimer();
            this.setTimeoutTimer(this.config.timeout);
        }
    }
}

/**
 * OpenAI stream handler
 */
export class OpenAIStreamHandler extends BaseStreamHandler {
    private toolCalls: Map<number, any> = new Map();

    public async processChunk(chunk: any): Promise<void> {
        this.resetTimeoutTimer();

        try {
            // Parse SSE format if needed
            const data = this.parseSSEChunk(chunk);
            
            if (!data || data === '[DONE]') {
                await this.sendComplete();
                return;
            }

            const parsed = typeof data === 'string' ? JSON.parse(data) : data;
            const choice = parsed.choices?.[0];
            
            if (!choice) {
                return;
            }

            // Handle content delta
            if (choice.delta?.content) {
                this.buffer += choice.delta.content;
                
                await this.sendChunk({
                    type: 'content',
                    content: choice.delta.content,
                    metadata: {
                        provider: 'openai',
                        model: parsed.model
                    }
                });
            }

            // Handle tool calls
            if (choice.delta?.tool_calls) {
                for (const toolCall of choice.delta.tool_calls) {
                    await this.processToolCall(toolCall);
                }
            }

            // Check if stream is done
            if (choice.finish_reason) {
                this.finishReason = choice.finish_reason;
                
                if (parsed.usage) {
                    this.response.usage = {
                        promptTokens: parsed.usage.prompt_tokens,
                        completionTokens: parsed.usage.completion_tokens,
                        totalTokens: parsed.usage.total_tokens
                    };
                }
            }
        } catch (error) {
            log.error(`[OpenAIStreamHandler] Error processing chunk: ${error}`);
            this.handleError(error as Error);
        }
    }

    private parseSSEChunk(chunk: any): string | null {
        if (typeof chunk === 'string') {
            const lines = chunk.split('\n');
            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    return line.slice(6);
                }
            }
        }
        return chunk;
    }

    private async processToolCall(toolCall: any): Promise<void> {
        const index = toolCall.index || 0;
        
        if (!this.toolCalls.has(index)) {
            this.toolCalls.set(index, {
                id: toolCall.id || '',
                type: 'function',
                function: {
                    name: '',
                    arguments: ''
                }
            });
        }

        const existing = this.toolCalls.get(index)!;
        
        if (toolCall.id) {
            existing.id = toolCall.id;
        }
        
        if (toolCall.function?.name) {
            existing.function.name = toolCall.function.name;
        }
        
        if (toolCall.function?.arguments) {
            existing.function.arguments += toolCall.function.arguments;
        }

        // Send tool call chunk
        await this.sendChunk({
            type: 'tool_call',
            toolCall: {
                id: existing.id,
                name: existing.function.name,
                arguments: existing.function.arguments
            },
            metadata: {
                provider: 'openai'
            }
        });
    }

    private async sendComplete(): Promise<void> {
        this.isComplete = true;
        this.clearTimeoutTimer();

        await this.sendChunk({
            type: 'done',
            metadata: {
                provider: 'openai',
                finishReason: this.finishReason,
                usage: this.response.usage
            }
        });
    }

    public async complete(): Promise<ChatResponse> {
        if (!this.isComplete) {
            await this.sendComplete();
        }

        const response: ChatResponse = {
            text: this.buffer,
            model: 'openai-model',
            provider: 'openai',
            usage: this.response.usage
        };

        if (this.toolCalls.size > 0) {
            response.tool_calls = Array.from(this.toolCalls.values());
        }

        if (this.config.onComplete) {
            this.config.onComplete(response);
        }

        return response;
    }
}

/**
 * Anthropic stream handler
 */
export class AnthropicStreamHandler extends BaseStreamHandler {
    private messageId?: string;
    private stopReason?: string;

    public async processChunk(chunk: any): Promise<void> {
        this.resetTimeoutTimer();

        try {
            const event = this.parseAnthropicEvent(chunk);
            
            if (!event) {
                return;
            }

            switch (event.type) {
                case 'message_start':
                    this.messageId = event.message?.id;
                    break;

                case 'content_block_start':
                    // Content block started
                    break;

                case 'content_block_delta':
                    if (event.delta?.type === 'text_delta') {
                        const text = event.delta.text || '';
                        this.buffer += text;
                        
                        await this.sendChunk({
                            type: 'content',
                            content: text,
                            metadata: {
                                provider: 'anthropic',
                                model: event.model
                            }
                        });
                    }
                    break;

                case 'content_block_stop':
                    // Content block completed
                    break;

                case 'message_delta':
                    if (event.delta?.stop_reason) {
                        this.stopReason = event.delta.stop_reason;
                    }
                    
                    if (event.usage) {
                        this.response.usage = {
                            promptTokens: event.usage.input_tokens,
                            completionTokens: event.usage.output_tokens,
                            totalTokens: (event.usage.input_tokens || 0) + (event.usage.output_tokens || 0)
                        };
                    }
                    break;

                case 'message_stop':
                    await this.sendComplete();
                    break;

                case 'error':
                    this.handleError(new Error(event.error?.message || 'Unknown error'));
                    break;
            }
        } catch (error) {
            log.error(`[AnthropicStreamHandler] Error processing chunk: ${error}`);
            this.handleError(error as Error);
        }
    }

    private parseAnthropicEvent(chunk: any): any {
        if (typeof chunk === 'string') {
            try {
                // Parse SSE format
                const lines = chunk.split('\n');
                let eventType = '';
                let eventData = '';
                
                for (const line of lines) {
                    if (line.startsWith('event: ')) {
                        eventType = line.slice(7);
                    } else if (line.startsWith('data: ')) {
                        eventData = line.slice(6);
                    }
                }
                
                if (eventType && eventData) {
                    const parsed = JSON.parse(eventData);
                    return { ...parsed, type: eventType };
                }
            } catch (error) {
                log.error(`[AnthropicStreamHandler] Error parsing event: ${error}`);
            }
        }
        
        return chunk;
    }

    private async sendComplete(): Promise<void> {
        this.isComplete = true;
        this.clearTimeoutTimer();

        await this.sendChunk({
            type: 'done',
            metadata: {
                provider: 'anthropic',
                finishReason: this.stopReason,
                usage: this.response.usage
            }
        });
    }

    public async complete(): Promise<ChatResponse> {
        if (!this.isComplete) {
            await this.sendComplete();
        }

        const response: ChatResponse = {
            text: this.buffer,
            model: 'anthropic-model',
            provider: 'anthropic',
            usage: this.response.usage
        };

        if (this.config.onComplete) {
            this.config.onComplete(response);
        }

        return response;
    }
}

/**
 * Ollama stream handler
 */
export class OllamaStreamHandler extends BaseStreamHandler {
    private model?: string;
    private toolCalls: any[] = [];

    public async processChunk(chunk: any): Promise<void> {
        this.resetTimeoutTimer();

        try {
            const data = typeof chunk === 'string' ? JSON.parse(chunk) : chunk;
            
            // Handle content
            if (data.message?.content) {
                const content = data.message.content;
                this.buffer += content;
                
                await this.sendChunk({
                    type: 'content',
                    content: content,
                    metadata: {
                        provider: 'ollama',
                        model: data.model || this.model
                    }
                });
            }

            // Handle tool calls
            if (data.message?.tool_calls) {
                this.toolCalls = data.message.tool_calls;
                
                for (const toolCall of this.toolCalls) {
                    await this.sendChunk({
                        type: 'tool_call',
                        toolCall: {
                            id: toolCall.id || `tool_${Date.now()}`,
                            name: toolCall.function?.name || '',
                            arguments: JSON.stringify(toolCall.function?.arguments || {})
                        },
                        metadata: {
                            provider: 'ollama'
                        }
                    });
                }
            }

            // Store model info
            if (data.model) {
                this.model = data.model;
            }

            // Check if done
            if (data.done) {
                // Calculate token usage if available
                if (data.prompt_eval_count || data.eval_count) {
                    this.response.usage = {
                        promptTokens: data.prompt_eval_count,
                        completionTokens: data.eval_count,
                        totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0)
                    };
                }
                
                await this.sendComplete();
            }
        } catch (error) {
            log.error(`[OllamaStreamHandler] Error processing chunk: ${error}`);
            this.handleError(error as Error);
        }
    }

    private async sendComplete(): Promise<void> {
        this.isComplete = true;
        this.clearTimeoutTimer();

        await this.sendChunk({
            type: 'done',
            metadata: {
                provider: 'ollama',
                model: this.model,
                usage: this.response.usage
            }
        });
    }

    public async complete(): Promise<ChatResponse> {
        if (!this.isComplete) {
            await this.sendComplete();
        }

        const response: ChatResponse = {
            text: this.buffer,
            model: this.model || 'ollama-model',
            provider: 'ollama',
            usage: this.response.usage
        };

        if (this.toolCalls.length > 0) {
            response.tool_calls = this.toolCalls;
        }

        if (this.config.onComplete) {
            this.config.onComplete(response);
        }

        return response;
    }
}

/**
 * Factory function to create appropriate stream handler
 */
export function createStreamHandler(config: StreamHandlerConfig): BaseStreamHandler {
    switch (config.provider) {
        case 'openai':
            return new OpenAIStreamHandler(config);
        
        case 'anthropic':
            return new AnthropicStreamHandler(config);
        
        case 'ollama':
            return new OllamaStreamHandler(config);
        
        default:
            throw new Error(`Unsupported provider: ${config.provider}`);
    }
}

/**
 * Utility to convert async iterable to unified stream
 */
export async function* unifiedStream(
    asyncIterable: AsyncIterable<any>,
    provider: 'openai' | 'anthropic' | 'ollama'
): AsyncGenerator<UnifiedStreamChunk> {
    const chunks: UnifiedStreamChunk[] = [];
    let handler: BaseStreamHandler | null = null;

    try {
        handler = createStreamHandler({
            provider,
            onChunk: (chunk) => { chunks.push(chunk); }
        });

        for await (const chunk of asyncIterable) {
            await handler.processChunk(chunk);
            
            // Yield accumulated chunks
            while (chunks.length > 0) {
                const chunk = chunks.shift()!;
                yield chunk;
            }
        }

        // Complete the stream
        await handler.complete();
        
        // Yield any remaining chunks
        while (chunks.length > 0) {
            const chunk = chunks.shift()!;
            yield chunk;
        }
    } catch (error) {
        log.error(`[unifiedStream] Error: ${error}`);
        yield {
            type: 'error',
            error: (error as Error).message,
            metadata: { provider }
        };
    }
}

/**
 * Stream aggregator for collecting stream chunks into a complete response
 */
export class StreamAggregator {
    private chunks: UnifiedStreamChunk[] = [];
    private content: string = '';
    private toolCalls: any[] = [];
    private metadata: any = {};

    public addChunk(chunk: UnifiedStreamChunk): void {
        this.chunks.push(chunk);

        switch (chunk.type) {
            case 'content':
                if (chunk.content) {
                    this.content += chunk.content;
                }
                break;

            case 'tool_call':
                if (chunk.toolCall) {
                    this.toolCalls.push(chunk.toolCall);
                }
                break;

            case 'done':
                if (chunk.metadata) {
                    this.metadata = { ...this.metadata, ...chunk.metadata };
                }
                break;
        }
    }

    public getResponse(): ChatResponse {
        const response: ChatResponse = {
            text: this.content,
            model: this.metadata.model || 'unknown-model',
            provider: this.metadata.provider || 'unknown',
            usage: this.metadata.usage
        };

        if (this.toolCalls.length > 0) {
            response.tool_calls = this.toolCalls;
        }

        return response;
    }

    public getChunks(): UnifiedStreamChunk[] {
        return [...this.chunks];
    }

    public reset(): void {
        this.chunks = [];
        this.content = '';
        this.toolCalls = [];
        this.metadata = {};
    }
}