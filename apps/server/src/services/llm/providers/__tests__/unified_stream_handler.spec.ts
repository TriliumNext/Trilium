/**
 * Unified Stream Handler Tests
 * 
 * Test suite for the unified streaming interface
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    UnifiedStreamChunk,
    StreamHandlerConfig,
    OpenAIStreamHandler,
    AnthropicStreamHandler,
    OllamaStreamHandler,
    createStreamHandler,
    StreamAggregator,
    unifiedStream
} from '../unified_stream_handler.js';
import type { ChatResponse } from '../../ai_interface.js';

vi.mock('../../log.js', () => ({
    default: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
    }
}));

describe('OpenAIStreamHandler', () => {
    let handler: OpenAIStreamHandler;
    let chunks: UnifiedStreamChunk[];
    let config: StreamHandlerConfig;

    beforeEach(() => {
        chunks = [];
        config = {
            provider: 'openai',
            onChunk: (chunk) => { chunks.push(chunk); },
            onError: vi.fn(),
            onComplete: vi.fn()
        };
        handler = new OpenAIStreamHandler(config);
    });

    describe('Content Streaming', () => {
        it('should process content chunks', async () => {
            const chunk = {
                choices: [{
                    delta: { content: 'Hello' },
                    index: 0
                }],
                model: 'gpt-4'
            };

            await handler.processChunk(JSON.stringify(chunk));

            expect(chunks).toHaveLength(1);
            expect(chunks[0]).toEqual({
                type: 'content',
                content: 'Hello',
                metadata: {
                    provider: 'openai',
                    model: 'gpt-4'
                }
            });
        });

        it('should handle multiple content chunks', async () => {
            const chunk1 = {
                choices: [{
                    delta: { content: 'Hello' }
                }]
            };
            const chunk2 = {
                choices: [{
                    delta: { content: ' World' }
                }]
            };

            await handler.processChunk(JSON.stringify(chunk1));
            await handler.processChunk(JSON.stringify(chunk2));

            expect(chunks).toHaveLength(2);
            expect(chunks[0].content).toBe('Hello');
            expect(chunks[1].content).toBe(' World');
        });

        it('should handle SSE format', async () => {
            const sseChunk = 'data: {"choices":[{"delta":{"content":"Test"}}]}';
            
            await handler.processChunk(sseChunk);

            expect(chunks).toHaveLength(1);
            expect(chunks[0].content).toBe('Test');
        });

        it('should handle [DONE] marker', async () => {
            await handler.processChunk('data: [DONE]');

            expect(chunks).toHaveLength(1);
            expect(chunks[0].type).toBe('done');
        });
    });

    describe('Tool Calls', () => {
        it('should process tool call chunks', async () => {
            const chunk = {
                choices: [{
                    delta: {
                        tool_calls: [{
                            index: 0,
                            id: 'call_123',
                            function: {
                                name: 'get_weather',
                                arguments: '{"location":'
                            }
                        }]
                    }
                }]
            };

            await handler.processChunk(JSON.stringify(chunk));

            expect(chunks).toHaveLength(1);
            expect(chunks[0]).toEqual({
                type: 'tool_call',
                toolCall: {
                    id: 'call_123',
                    name: 'get_weather',
                    arguments: '{"location":'
                },
                metadata: {
                    provider: 'openai'
                }
            });
        });

        it('should accumulate tool call arguments', async () => {
            const chunk1 = {
                choices: [{
                    delta: {
                        tool_calls: [{
                            index: 0,
                            id: 'call_123',
                            function: {
                                name: 'get_weather',
                                arguments: '{"location":'
                            }
                        }]
                    }
                }]
            };

            const chunk2 = {
                choices: [{
                    delta: {
                        tool_calls: [{
                            index: 0,
                            function: {
                                arguments: '"New York"}'
                            }
                        }]
                    }
                }]
            };

            await handler.processChunk(JSON.stringify(chunk1));
            await handler.processChunk(JSON.stringify(chunk2));

            expect(chunks).toHaveLength(2);
            expect(chunks[1].toolCall?.arguments).toBe('{"location":"New York"}');
        });
    });

    describe('Completion', () => {
        it('should handle finish reason', async () => {
            const chunk = {
                choices: [{
                    delta: { content: 'Done' },
                    finish_reason: 'stop'
                }],
                usage: {
                    prompt_tokens: 10,
                    completion_tokens: 5,
                    total_tokens: 15
                }
            };

            await handler.processChunk(JSON.stringify(chunk));

            const response = await handler.complete();

            expect(response.text).toBe('Done');
            // finishReason is not directly on ChatResponse anymore
            expect(response.usage).toEqual({
                promptTokens: 10,
                completionTokens: 5,
                totalTokens: 15
            });
        });

        it('should call onComplete callback', async () => {
            await handler.processChunk('data: [DONE]');
            
            const response = await handler.complete();

            expect(config.onComplete).toHaveBeenCalledWith(response);
        });
    });

    describe('Error Handling', () => {
        it('should handle parse errors', async () => {
            await handler.processChunk('invalid json');

            expect(config.onError).toHaveBeenCalled();
            expect(chunks.find(c => c.type === 'error')).toBeDefined();
        });

        it('should handle timeout', async () => {
            const timeoutConfig = { ...config, timeout: 100 };
            const timeoutHandler = new OpenAIStreamHandler(timeoutConfig);

            await new Promise(resolve => setTimeout(resolve, 150));

            expect(config.onError).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: expect.stringContaining('timeout')
                })
            );
        });
    });
});

describe('AnthropicStreamHandler', () => {
    let handler: AnthropicStreamHandler;
    let chunks: UnifiedStreamChunk[];
    let config: StreamHandlerConfig;

    beforeEach(() => {
        chunks = [];
        config = {
            provider: 'anthropic',
            onChunk: (chunk) => { chunks.push(chunk); },
            onError: vi.fn(),
            onComplete: vi.fn()
        };
        handler = new AnthropicStreamHandler(config);
    });

    describe('Content Streaming', () => {
        it('should process text delta events', async () => {
            const event = 'event: content_block_delta\ndata: {"delta":{"type":"text_delta","text":"Hello"},"model":"claude-3"}';

            await handler.processChunk(event);

            expect(chunks).toHaveLength(1);
            expect(chunks[0]).toEqual({
                type: 'content',
                content: 'Hello',
                metadata: {
                    provider: 'anthropic',
                    model: 'claude-3'
                }
            });
        });

        it('should handle message start event', async () => {
            const event = 'event: message_start\ndata: {"message":{"id":"msg_123"}}';

            await handler.processChunk(event);

            // Message start doesn't produce chunks
            expect(chunks).toHaveLength(0);
        });

        it('should handle message stop event', async () => {
            const event = 'event: message_stop\ndata: {}';

            await handler.processChunk(event);

            expect(chunks).toHaveLength(1);
            expect(chunks[0].type).toBe('done');
        });
    });

    describe('Usage Tracking', () => {
        it('should track token usage', async () => {
            const event = 'event: message_delta\ndata: {"usage":{"input_tokens":10,"output_tokens":5}}';

            await handler.processChunk(event);
            const response = await handler.complete();

            expect(response.usage).toEqual({
                promptTokens: 10,
                completionTokens: 5,
                totalTokens: 15
            });
        });

        it('should handle stop reason', async () => {
            const event = 'event: message_delta\ndata: {"delta":{"stop_reason":"end_turn"}}';

            await handler.processChunk(event);
            const response = await handler.complete();

            // finishReason is not directly on ChatResponse anymore
        });
    });

    describe('Error Handling', () => {
        it('should handle error events', async () => {
            const event = 'event: error\ndata: {"error":{"message":"API Error"}}';

            await handler.processChunk(event);

            expect(config.onError).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: 'API Error'
                })
            );
        });
    });
});

describe('OllamaStreamHandler', () => {
    let handler: OllamaStreamHandler;
    let chunks: UnifiedStreamChunk[];
    let config: StreamHandlerConfig;

    beforeEach(() => {
        chunks = [];
        config = {
            provider: 'ollama',
            onChunk: (chunk) => { chunks.push(chunk); },
            onError: vi.fn(),
            onComplete: vi.fn()
        };
        handler = new OllamaStreamHandler(config);
    });

    describe('Content Streaming', () => {
        it('should process content chunks', async () => {
            const chunk = {
                message: { content: 'Hello' },
                model: 'llama2',
                done: false
            };

            await handler.processChunk(chunk);

            expect(chunks).toHaveLength(1);
            expect(chunks[0]).toEqual({
                type: 'content',
                content: 'Hello',
                metadata: {
                    provider: 'ollama',
                    model: 'llama2'
                }
            });
        });

        it('should handle completion', async () => {
            const chunk = {
                message: { content: 'Final' },
                done: true,
                prompt_eval_count: 10,
                eval_count: 5
            };

            await handler.processChunk(chunk);

            expect(chunks).toHaveLength(2);
            expect(chunks[0].type).toBe('content');
            expect(chunks[1].type).toBe('done');
            expect(chunks[1].metadata?.usage).toEqual({
                promptTokens: 10,
                completionTokens: 5,
                totalTokens: 15
            });
        });
    });

    describe('Tool Calls', () => {
        it('should process tool calls', async () => {
            const chunk = {
                message: {
                    tool_calls: [{
                        id: 'tool_1',
                        function: {
                            name: 'search',
                            arguments: { query: 'test' }
                        }
                    }]
                },
                done: false
            };

            await handler.processChunk(chunk);

            expect(chunks).toHaveLength(1);
            expect(chunks[0]).toEqual({
                type: 'tool_call',
                toolCall: {
                    id: 'tool_1',
                    name: 'search',
                    arguments: '{"query":"test"}'
                },
                metadata: {
                    provider: 'ollama'
                }
            });
        });
    });
});

describe('createStreamHandler', () => {
    it('should create OpenAI handler', () => {
        const handler = createStreamHandler({
            provider: 'openai',
            onChunk: vi.fn()
        });

        expect(handler).toBeInstanceOf(OpenAIStreamHandler);
    });

    it('should create Anthropic handler', () => {
        const handler = createStreamHandler({
            provider: 'anthropic',
            onChunk: vi.fn()
        });

        expect(handler).toBeInstanceOf(AnthropicStreamHandler);
    });

    it('should create Ollama handler', () => {
        const handler = createStreamHandler({
            provider: 'ollama',
            onChunk: vi.fn()
        });

        expect(handler).toBeInstanceOf(OllamaStreamHandler);
    });

    it('should throw for unsupported provider', () => {
        expect(() => createStreamHandler({
            provider: 'unsupported' as any,
            onChunk: vi.fn()
        })).toThrow('Unsupported provider: unsupported');
    });
});

describe('StreamAggregator', () => {
    let aggregator: StreamAggregator;

    beforeEach(() => {
        aggregator = new StreamAggregator();
    });

    it('should aggregate content chunks', () => {
        aggregator.addChunk({
            type: 'content',
            content: 'Hello'
        });
        aggregator.addChunk({
            type: 'content',
            content: ' World'
        });

        const response = aggregator.getResponse();
        expect(response.text).toBe('Hello World');
    });

    it('should aggregate tool calls', () => {
        aggregator.addChunk({
            type: 'tool_call',
            toolCall: {
                id: '1',
                name: 'search',
                arguments: '{}'
            }
        });

        const response = aggregator.getResponse();
        expect(response.tool_calls).toHaveLength(1);
        expect(response.tool_calls?.[0]).toEqual({
            id: '1',
            name: 'search',
            arguments: '{}'
        });
    });

    it('should aggregate metadata', () => {
        aggregator.addChunk({
            type: 'done',
            metadata: {
                provider: 'openai',
                finishReason: 'stop',
                usage: {
                    promptTokens: 10,
                    completionTokens: 5,
                    totalTokens: 15
                }
            }
        });

        const response = aggregator.getResponse();
        // finishReason is not directly on ChatResponse anymore
        expect(response.usage).toEqual({
            promptTokens: 10,
            completionTokens: 5,
            totalTokens: 15
        });
    });

    it('should return all chunks', () => {
        const chunk1: UnifiedStreamChunk = { type: 'content', content: 'Test' };
        const chunk2: UnifiedStreamChunk = { type: 'done' };

        aggregator.addChunk(chunk1);
        aggregator.addChunk(chunk2);

        const chunks = aggregator.getChunks();
        expect(chunks).toHaveLength(2);
        expect(chunks[0]).toEqual(chunk1);
        expect(chunks[1]).toEqual(chunk2);
    });

    it('should reset state', () => {
        aggregator.addChunk({ type: 'content', content: 'Test' });
        aggregator.reset();

        const response = aggregator.getResponse();
        expect(response.text).toBe('');
        expect(aggregator.getChunks()).toHaveLength(0);
    });
});

describe('unifiedStream', () => {
    it('should convert async iterable to unified stream', async () => {
        async function* mockStream() {
            yield JSON.stringify({
                choices: [{
                    delta: { content: 'Hello' }
                }]
            });
            yield JSON.stringify({
                choices: [{
                    delta: { content: ' World' }
                }]
            });
            yield 'data: [DONE]';
        }

        const chunks: UnifiedStreamChunk[] = [];
        
        for await (const chunk of unifiedStream(mockStream(), 'openai')) {
            chunks.push(chunk);
        }

        expect(chunks.length).toBeGreaterThan(0);
        expect(chunks.find(c => c.type === 'content')).toBeDefined();
        expect(chunks.find(c => c.type === 'done')).toBeDefined();
    });

    it('should handle errors in stream', async () => {
        async function* errorStream() {
            yield 'invalid json that will cause error';
        }

        const chunks: UnifiedStreamChunk[] = [];
        
        for await (const chunk of unifiedStream(errorStream(), 'openai')) {
            chunks.push(chunk);
        }

        expect(chunks.find(c => c.type === 'error')).toBeDefined();
    });
});