/**
 * Mock Providers for Testing
 * 
 * Provides mock implementations of AI service providers for testing purposes
 */

import type { AIService, ChatCompletionOptions, ChatResponse, Message } from '../../ai_interface.js';
import type { UnifiedStreamChunk } from '../unified_stream_handler.js';

/**
 * Mock provider configuration
 */
export interface MockProviderConfig {
    name: string;
    available: boolean;
    responseDelay?: number;
    errorRate?: number;
    streamingSupported?: boolean;
    toolsSupported?: boolean;
    defaultResponse?: string;
    throwError?: Error;
}

/**
 * Base mock provider implementation
 */
export class MockProvider implements AIService {
    protected config: MockProviderConfig;
    private callCount: number = 0;
    private streamCallCount: number = 0;

    constructor(config: Partial<MockProviderConfig> = {}) {
        this.config = {
            name: config.name || 'mock',
            available: config.available !== false,
            responseDelay: config.responseDelay || 0,
            errorRate: config.errorRate || 0,
            streamingSupported: config.streamingSupported !== false,
            toolsSupported: config.toolsSupported !== false,
            defaultResponse: config.defaultResponse || 'Mock response',
            throwError: config.throwError
        };
    }

    isAvailable(): boolean {
        return this.config.available;
    }

    getName(): string {
        return this.config.name;
    }

    async generateChatCompletion(
        messages: Message[],
        options: ChatCompletionOptions = {}
    ): Promise<ChatResponse> {
        this.callCount++;

        // Simulate delay
        if (this.config.responseDelay) {
            await new Promise(resolve => setTimeout(resolve, this.config.responseDelay));
        }

        // Simulate errors
        if (this.config.throwError) {
            throw this.config.throwError;
        }

        if (this.config.errorRate && Math.random() < this.config.errorRate) {
            throw new Error(`Mock provider error (${this.config.name})`);
        }

        // Handle streaming
        if (options.stream && options.streamCallback) {
            return this.generateStreamingResponse(messages, options);
        }

        // Generate response based on options
        const response: ChatResponse = {
            text: this.generateContent(messages, options),
            model: `${this.config.name}-model`,
            provider: this.config.name,
            usage: {
                promptTokens: this.calculateTokens(messages),
                completionTokens: 10,
                totalTokens: this.calculateTokens(messages) + 10
            }
        };

        // Add tool calls if requested
        if (options.tools && this.config.toolsSupported) {
            response.tool_calls = this.generateToolCalls(options.tools);
        }

        return response;
    }

    protected async generateStreamingResponse(
        messages: Message[],
        options: ChatCompletionOptions
    ): Promise<ChatResponse> {
        this.streamCallCount++;
        
        const content = this.generateContent(messages, options);
        const chunks = this.splitIntoChunks(content, 5);
        
        let fullContent = '';
        
        for (const chunk of chunks) {
            fullContent += chunk;
            
            // Call stream callback
            if (options.streamCallback) {
                await options.streamCallback(chunk, false);
                
                // Simulate delay between chunks
                if (this.config.responseDelay) {
                    await new Promise(resolve => 
                        setTimeout(resolve, this.config.responseDelay! / chunks.length)
                    );
                }
            }
        }
        
        // Send final callback
        if (options.streamCallback) {
            await options.streamCallback('', true);
        }
        
        return {
            text: fullContent,
            model: `${this.config.name}-model`,
            provider: this.config.name,
            usage: {
                promptTokens: this.calculateTokens(messages),
                completionTokens: Math.floor(fullContent.length / 4),
                totalTokens: this.calculateTokens(messages) + Math.floor(fullContent.length / 4)
            }
        };
    }

    protected generateContent(messages: Message[], options: ChatCompletionOptions): string {
        // Return JSON if requested
        if (options.expectsJsonResponse) {
            return JSON.stringify({
                type: 'mock_response',
                provider: this.config.name,
                messageCount: messages.length
            });
        }

        // Use custom response if provided
        if (this.config.defaultResponse) {
            return this.config.defaultResponse;
        }

        // Generate response based on last message
        const lastMessage = messages[messages.length - 1];
        return `Mock ${this.config.name} response to: ${lastMessage.content}`;
    }

    protected generateToolCalls(tools: any[]): any[] {
        return tools.slice(0, 1).map((tool, index) => ({
            id: `call_mock_${index}`,
            type: 'function',
            function: {
                name: tool.function?.name || 'mock_tool',
                arguments: JSON.stringify({ mock: true })
            }
        }));
    }

    protected calculateTokens(messages: Message[]): number {
        return messages.reduce((sum, msg) => {
            const content = typeof msg.content === 'string' ? msg.content : '';
            return sum + Math.floor(content.length / 4);
        }, 0);
    }

    protected splitIntoChunks(text: string, chunkCount: number): string[] {
        const chunkSize = Math.ceil(text.length / chunkCount);
        const chunks: string[] = [];
        
        for (let i = 0; i < text.length; i += chunkSize) {
            chunks.push(text.slice(i, i + chunkSize));
        }
        
        return chunks;
    }

    // Test helper methods
    getCallCount(): number {
        return this.callCount;
    }

    getStreamCallCount(): number {
        return this.streamCallCount;
    }

    resetCallCounts(): void {
        this.callCount = 0;
        this.streamCallCount = 0;
    }

    setAvailable(available: boolean): void {
        this.config.available = available;
    }

    setErrorRate(rate: number): void {
        this.config.errorRate = rate;
    }

    setResponseDelay(delay: number): void {
        this.config.responseDelay = delay;
    }

    dispose(): void {
        // Cleanup mock resources
        this.resetCallCounts();
    }
}

/**
 * Mock OpenAI provider
 */
export class MockOpenAIProvider extends MockProvider {
    constructor(config: Partial<MockProviderConfig> = {}) {
        super({
            name: 'openai',
            ...config
        });
    }

    supportsStreaming(): boolean {
        return this.config.streamingSupported!;
    }

    supportsTools(): boolean {
        return this.config.toolsSupported!;
    }

    async *streamCompletion(
        messages: Message[],
        options: ChatCompletionOptions = {}
    ): AsyncGenerator<any> {
        const content = this.generateContent(messages, options);
        const chunks = this.splitIntoChunks(content, 5);
        
        for (const chunk of chunks) {
            yield {
                choices: [{
                    delta: { content: chunk },
                    index: 0
                }],
                model: 'gpt-4-mock'
            };
            
            if (this.config.responseDelay) {
                await new Promise(resolve => 
                    setTimeout(resolve, this.config.responseDelay! / chunks.length)
                );
            }
        }
        
        yield {
            choices: [{
                delta: {},
                finish_reason: 'stop',
                index: 0
            }],
            usage: {
                prompt_tokens: this.calculateTokens(messages),
                completion_tokens: Math.floor(content.length / 4),
                total_tokens: this.calculateTokens(messages) + Math.floor(content.length / 4)
            }
        };
    }
}

/**
 * Mock Anthropic provider
 */
export class MockAnthropicProvider extends MockProvider {
    constructor(config: Partial<MockProviderConfig> = {}) {
        super({
            name: 'anthropic',
            ...config
        });
    }

    async *streamCompletion(
        messages: Message[],
        options: ChatCompletionOptions = {}
    ): AsyncGenerator<any> {
        const content = this.generateContent(messages, options);
        const chunks = this.splitIntoChunks(content, 5);
        
        // Message start
        yield {
            type: 'message_start',
            message: { id: 'msg_mock_123' }
        };
        
        // Content blocks
        for (const chunk of chunks) {
            yield {
                type: 'content_block_delta',
                delta: {
                    type: 'text_delta',
                    text: chunk
                }
            };
            
            if (this.config.responseDelay) {
                await new Promise(resolve => 
                    setTimeout(resolve, this.config.responseDelay! / chunks.length)
                );
            }
        }
        
        // Message end
        yield {
            type: 'message_delta',
            delta: { stop_reason: 'end_turn' },
            usage: {
                input_tokens: this.calculateTokens(messages),
                output_tokens: Math.floor(content.length / 4)
            }
        };
        
        yield {
            type: 'message_stop'
        };
    }
}

/**
 * Mock Ollama provider
 */
export class MockOllamaProvider extends MockProvider {
    constructor(config: Partial<MockProviderConfig> = {}) {
        super({
            name: 'ollama',
            ...config
        });
    }

    async *streamCompletion(
        messages: Message[],
        options: ChatCompletionOptions = {}
    ): AsyncGenerator<any> {
        const content = this.generateContent(messages, options);
        const chunks = this.splitIntoChunks(content, 5);
        
        for (let i = 0; i < chunks.length; i++) {
            yield {
                message: { content: chunks[i] },
                model: 'llama2-mock',
                done: false
            };
            
            if (this.config.responseDelay) {
                await new Promise(resolve => 
                    setTimeout(resolve, this.config.responseDelay! / chunks.length)
                );
            }
        }
        
        // Final chunk with usage
        yield {
            message: { content: '' },
            model: 'llama2-mock',
            done: true,
            prompt_eval_count: this.calculateTokens(messages),
            eval_count: Math.floor(content.length / 4)
        };
    }
}

/**
 * Factory for creating mock providers
 */
export class MockProviderFactory {
    private providers: Map<string, MockProvider> = new Map();

    createProvider(type: 'openai' | 'anthropic' | 'ollama', config?: Partial<MockProviderConfig>): MockProvider {
        let provider: MockProvider;
        
        switch (type) {
            case 'openai':
                provider = new MockOpenAIProvider(config);
                break;
            case 'anthropic':
                provider = new MockAnthropicProvider(config);
                break;
            case 'ollama':
                provider = new MockOllamaProvider(config);
                break;
            default:
                provider = new MockProvider({ name: type, ...config });
        }
        
        this.providers.set(type, provider);
        return provider;
    }

    getProvider(type: string): MockProvider | undefined {
        return this.providers.get(type);
    }

    getAllProviders(): MockProvider[] {
        return Array.from(this.providers.values());
    }

    resetAll(): void {
        for (const provider of this.providers.values()) {
            provider.resetCallCounts();
        }
    }

    disposeAll(): void {
        for (const provider of this.providers.values()) {
            provider.dispose();
        }
        this.providers.clear();
    }
}

/**
 * Create a mock provider with predefined behaviors
 */
export function createMockProvider(behavior: 'success' | 'error' | 'slow' | 'flaky'): MockProvider {
    const configs: Record<string, Partial<MockProviderConfig>> = {
        success: {
            available: true,
            responseDelay: 10
        },
        error: {
            available: true,
            throwError: new Error('Mock provider error')
        },
        slow: {
            available: true,
            responseDelay: 1000
        },
        flaky: {
            available: true,
            errorRate: 0.5,
            responseDelay: 100
        }
    };
    
    return new MockProvider(configs[behavior] || configs.success);
}

/**
 * Create a mock streaming response for testing
 */
export async function* createMockStream(
    chunks: string[],
    delay: number = 10
): AsyncGenerator<UnifiedStreamChunk> {
    for (const chunk of chunks) {
        yield {
            type: 'content',
            content: chunk,
            metadata: {
                provider: 'mock'
            }
        };
        
        await new Promise(resolve => setTimeout(resolve, delay));
    }
    
    yield {
        type: 'done',
        metadata: {
            provider: 'mock',
            finishReason: 'stop'
        }
    };
}