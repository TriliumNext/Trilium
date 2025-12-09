import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { StreamProcessor, createStreamHandler, processProviderStream, extractStreamStats, performProviderHealthCheck } from './stream_handler.js';
import type { StreamProcessingOptions, StreamChunk } from './stream_handler.js';

// Mock the log module
vi.mock('../../log.js', () => ({
    default: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn()
    }
}));

describe('StreamProcessor', () => {
    let mockCallback: Mock<(text: string, done: boolean, chunk?: any) => Promise<void> | void>;
    let mockOptions: StreamProcessingOptions;

    beforeEach(() => {
        mockCallback = vi.fn<(text: string, done: boolean, chunk?: any) => Promise<void> | void>();
        mockOptions = {
            streamCallback: mockCallback,
            providerName: 'TestProvider',
            modelName: 'test-model'
        };
        vi.clearAllMocks();
    });

    describe('processChunk', () => {
        it('should process a chunk with content', async () => {
            const chunk = {
                message: { content: 'Hello' },
                done: false
            };
            const result = await StreamProcessor.processChunk(chunk, '', 1, mockOptions);

            expect(result.completeText).toBe('Hello');
            expect(result.logged).toBe(true);
        });

        it('should handle chunks without content', async () => {
            const chunk = { done: false };
            const result = await StreamProcessor.processChunk(chunk, 'existing', 2, mockOptions);

            expect(result.completeText).toBe('existing');
            expect(result.logged).toBe(false);
        });

        it('should log every 10th chunk', async () => {
            const chunk = { message: { content: 'test' } };
            const result = await StreamProcessor.processChunk(chunk, '', 10, mockOptions);

            expect(result.logged).toBe(true);
        });

        it('should log final chunks with done flag', async () => {
            const chunk = { done: true };
            const result = await StreamProcessor.processChunk(chunk, 'complete', 5, mockOptions);

            expect(result.logged).toBe(true);
        });

        it('should accumulate text correctly', async () => {
            const chunk1 = { message: { content: 'Hello ' } };
            const chunk2 = { message: { content: 'World' } };

            const result1 = await StreamProcessor.processChunk(chunk1, '', 1, mockOptions);
            const result2 = await StreamProcessor.processChunk(chunk2, result1.completeText, 2, mockOptions);

            expect(result2.completeText).toBe('Hello World');
        });
    });

    describe('sendChunkToCallback', () => {
        it('should call callback with content', async () => {
            await StreamProcessor.sendChunkToCallback(mockCallback, 'test content', false, {}, 1);

            expect(mockCallback).toHaveBeenCalledWith('test content', false, {});
        });

        it('should handle async callbacks', async () => {
            const asyncCallback = vi.fn().mockResolvedValue(undefined);
            await StreamProcessor.sendChunkToCallback(asyncCallback, 'async test', true, { done: true }, 5);

            expect(asyncCallback).toHaveBeenCalledWith('async test', true, { done: true });
        });

        it('should handle callback errors gracefully', async () => {
            const errorCallback = vi.fn().mockRejectedValue(new Error('Callback error'));

            // Should not throw
            await expect(StreamProcessor.sendChunkToCallback(errorCallback, 'test', false, {}, 1))
                .resolves.toBeUndefined();
        });

        it('should handle empty content', async () => {
            await StreamProcessor.sendChunkToCallback(mockCallback, '', true, { done: true }, 10);

            expect(mockCallback).toHaveBeenCalledWith('', true, { done: true });
        });

        it('should handle null content by converting to empty string', async () => {
            await StreamProcessor.sendChunkToCallback(mockCallback, null as any, false, {}, 1);

            expect(mockCallback).toHaveBeenCalledWith('', false, {});
        });
    });

    describe('sendFinalCallback', () => {
        it('should send final callback with complete text', async () => {
            await StreamProcessor.sendFinalCallback(mockCallback, 'Complete text');

            expect(mockCallback).toHaveBeenCalledWith('Complete text', true, { done: true, complete: true });
        });

        it('should handle empty complete text', async () => {
            await StreamProcessor.sendFinalCallback(mockCallback, '');

            expect(mockCallback).toHaveBeenCalledWith('', true, { done: true, complete: true });
        });

        it('should handle async final callbacks', async () => {
            const asyncCallback = vi.fn().mockResolvedValue(undefined);
            await StreamProcessor.sendFinalCallback(asyncCallback, 'Final');

            expect(asyncCallback).toHaveBeenCalledWith('Final', true, { done: true, complete: true });
        });

        it('should handle final callback errors gracefully', async () => {
            const errorCallback = vi.fn().mockRejectedValue(new Error('Final callback error'));

            await expect(StreamProcessor.sendFinalCallback(errorCallback, 'test'))
                .resolves.toBeUndefined();
        });
    });

    describe('extractToolCalls', () => {
        it('should extract tool calls from chunk', () => {
            const chunk = {
                message: {
                    tool_calls: [
                        { id: '1', function: { name: 'test_tool', arguments: '{}' } }
                    ]
                }
            };

            const toolCalls = StreamProcessor.extractToolCalls(chunk);
            expect(toolCalls).toHaveLength(1);
            expect(toolCalls[0].function.name).toBe('test_tool');
        });

        it('should return empty array when no tool calls', () => {
            const chunk = { message: { content: 'Just text' } };
            const toolCalls = StreamProcessor.extractToolCalls(chunk);
            expect(toolCalls).toEqual([]);
        });

        it('should handle missing message property', () => {
            const chunk = {};
            const toolCalls = StreamProcessor.extractToolCalls(chunk);
            expect(toolCalls).toEqual([]);
        });

        it('should handle non-array tool_calls', () => {
            const chunk = { message: { tool_calls: 'not-an-array' } };
            const toolCalls = StreamProcessor.extractToolCalls(chunk);
            expect(toolCalls).toEqual([]);
        });
    });

    describe('createFinalResponse', () => {
        it('should create a complete response object', () => {
            const response = StreamProcessor.createFinalResponse(
                'Complete text',
                'test-model',
                'TestProvider',
                [{ id: '1', function: { name: 'tool1' } }],
                { promptTokens: 10, completionTokens: 20 }
            );

            expect(response).toEqual({
                text: 'Complete text',
                model: 'test-model',
                provider: 'TestProvider',
                tool_calls: [{ id: '1', function: { name: 'tool1' } }],
                usage: { promptTokens: 10, completionTokens: 20 }
            });
        });

        it('should handle empty parameters', () => {
            const response = StreamProcessor.createFinalResponse('', '', '', []);

            expect(response).toEqual({
                text: '',
                model: '',
                provider: '',
                tool_calls: [],
                usage: {}
            });
        });
    });
});

describe('createStreamHandler', () => {
    it('should create a working stream handler', async () => {
        const mockProcessFn = vi.fn().mockImplementation(async (callback) => {
            await callback({ text: 'chunk1', done: false });
            await callback({ text: 'chunk2', done: true });
            return 'complete';
        });

        const handler = createStreamHandler(
            { providerName: 'test', modelName: 'model' },
            mockProcessFn
        );

        const chunks: StreamChunk[] = [];
        const result = await handler(async (chunk) => {
            chunks.push(chunk);
        });

        expect(result).toBe('complete');
        expect(chunks).toHaveLength(3); // 2 from processFn + 1 final
        expect(chunks[2]).toEqual({ text: '', done: true });
    });

    it('should handle errors in processor function', async () => {
        const mockProcessFn = vi.fn().mockRejectedValue(new Error('Process error'));

        const handler = createStreamHandler(
            { providerName: 'test', modelName: 'model' },
            mockProcessFn
        );

        await expect(handler(vi.fn())).rejects.toThrow('Process error');
    });

    it('should ensure final chunk even on error after some chunks', async () => {
        const chunks: StreamChunk[] = [];
        const mockProcessFn = vi.fn().mockImplementation(async (callback) => {
            await callback({ text: 'chunk1', done: false });
            throw new Error('Mid-stream error');
        });

        const handler = createStreamHandler(
            { providerName: 'test', modelName: 'model' },
            mockProcessFn
        );

        try {
            await handler(async (chunk) => {
                chunks.push(chunk);
            });
        } catch (e) {
            // Expected error
        }

        // Should have received the chunk before error and final done chunk
        expect(chunks.length).toBeGreaterThanOrEqual(2);
        expect(chunks[chunks.length - 1]).toEqual({ text: '', done: true });
    });
});

describe('processProviderStream', () => {
    let mockStreamIterator: AsyncIterable<any>;
    let mockCallback: Mock<(text: string, done: boolean, chunk?: any) => Promise<void> | void>;

    beforeEach(() => {
        mockCallback = vi.fn();
    });

    it('should process a complete stream', async () => {
        const chunks = [
            { message: { content: 'Hello ' } },
            { message: { content: 'World' } },
            { done: true }
        ];

        mockStreamIterator = {
            async *[Symbol.asyncIterator]() {
                for (const chunk of chunks) {
                    yield chunk;
                }
            }
        };

        const result = await processProviderStream(
            mockStreamIterator,
            { providerName: 'Test', modelName: 'test-model' },
            mockCallback
        );

        expect(result.completeText).toBe('Hello World');
        expect(result.chunkCount).toBe(3);
        expect(mockCallback).toHaveBeenCalledTimes(3);
    });

    it('should handle tool calls in stream', async () => {
        const chunks = [
            { message: { content: 'Using tool...' } },
            {
                message: {
                    tool_calls: [
                        { id: 'call_1', function: { name: 'calculator', arguments: '{"x": 5}' } }
                    ]
                }
            },
            { done: true }
        ];

        mockStreamIterator = {
            async *[Symbol.asyncIterator]() {
                for (const chunk of chunks) {
                    yield chunk;
                }
            }
        };

        const result = await processProviderStream(
            mockStreamIterator,
            { providerName: 'Test', modelName: 'test-model' }
        );

        expect(result.toolCalls).toHaveLength(1);
        expect(result.toolCalls[0].function.name).toBe('calculator');
    });

    it('should handle empty stream', async () => {
        mockStreamIterator = {
            async *[Symbol.asyncIterator]() {
                // Empty stream
            }
        };

        const result = await processProviderStream(
            mockStreamIterator,
            { providerName: 'Test', modelName: 'test-model' },
            mockCallback
        );

        expect(result.completeText).toBe('');
        expect(result.chunkCount).toBe(0);
        // Should still send final callback
        expect(mockCallback).toHaveBeenCalledWith('', true, expect.any(Object));
    });

    it('should handle stream errors', async () => {
        mockStreamIterator = {
            async *[Symbol.asyncIterator]() {
                yield { message: { content: 'Start' } };
                throw new Error('Stream error');
            }
        };

        await expect(processProviderStream(
            mockStreamIterator,
            { providerName: 'Test', modelName: 'test-model' }
        )).rejects.toThrow('Stream error');
    });

    it('should handle invalid stream iterator', async () => {
        const invalidIterator = {} as any;

        await expect(processProviderStream(
            invalidIterator,
            { providerName: 'Test', modelName: 'test-model' }
        )).rejects.toThrow('Invalid stream iterator');
    });

    it('should handle different chunk content formats', async () => {
        const chunks = [
            { content: 'Direct content' },
            { choices: [{ delta: { content: 'OpenAI format' } }] },
            { message: { content: 'Standard format' } }
        ];

        mockStreamIterator = {
            async *[Symbol.asyncIterator]() {
                for (const chunk of chunks) {
                    yield chunk;
                }
            }
        };

        const result = await processProviderStream(
            mockStreamIterator,
            { providerName: 'Test', modelName: 'test-model' },
            mockCallback
        );

        expect(mockCallback).toHaveBeenCalledTimes(4); // 3 chunks + final
    });

    it('should send final callback when last chunk has no done flag', async () => {
        const chunks = [
            { message: { content: 'Hello' } },
            { message: { content: 'World' } }
            // No done flag
        ];

        mockStreamIterator = {
            async *[Symbol.asyncIterator]() {
                for (const chunk of chunks) {
                    yield chunk;
                }
            }
        };

        await processProviderStream(
            mockStreamIterator,
            { providerName: 'Test', modelName: 'test-model' },
            mockCallback
        );

        // Should have explicit final callback
        const lastCall = mockCallback.mock.calls[mockCallback.mock.calls.length - 1];
        expect(lastCall[1]).toBe(true); // done flag
    });
});

describe('extractStreamStats', () => {
    it('should extract Ollama format stats', () => {
        const chunk = {
            prompt_eval_count: 10,
            eval_count: 20
        };

        const stats = extractStreamStats(chunk, 'Ollama');
        expect(stats).toEqual({
            promptTokens: 10,
            completionTokens: 20,
            totalTokens: 30
        });
    });

    it('should extract OpenAI format stats', () => {
        const chunk = {
            usage: {
                prompt_tokens: 15,
                completion_tokens: 25,
                total_tokens: 40
            }
        };

        const stats = extractStreamStats(chunk, 'OpenAI');
        expect(stats).toEqual({
            promptTokens: 15,
            completionTokens: 25,
            totalTokens: 40
        });
    });

    it('should handle missing stats', () => {
        const chunk = { message: { content: 'No stats here' } };

        const stats = extractStreamStats(chunk, 'Test');
        expect(stats).toEqual({
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0
        });
    });

    it('should handle null chunk', () => {
        const stats = extractStreamStats(null, 'Test');
        expect(stats).toEqual({
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0
        });
    });

    it('should handle partial Ollama stats', () => {
        const chunk = {
            prompt_eval_count: 10
            // Missing eval_count
        };

        const stats = extractStreamStats(chunk, 'Ollama');
        expect(stats).toEqual({
            promptTokens: 10,
            completionTokens: 0,
            totalTokens: 10
        });
    });
});

describe('performProviderHealthCheck', () => {
    it('should return true on successful health check', async () => {
        const mockCheckFn = vi.fn().mockResolvedValue({ status: 'ok' });

        const result = await performProviderHealthCheck(mockCheckFn, 'TestProvider');
        expect(result).toBe(true);
        expect(mockCheckFn).toHaveBeenCalled();
    });

    it('should throw error on failed health check', async () => {
        const mockCheckFn = vi.fn().mockRejectedValue(new Error('Connection refused'));

        await expect(performProviderHealthCheck(mockCheckFn, 'TestProvider'))
            .rejects.toThrow('Unable to connect to TestProvider server: Connection refused');
    });

    it('should handle non-Error rejections', async () => {
        const mockCheckFn = vi.fn().mockRejectedValue('String error');

        await expect(performProviderHealthCheck(mockCheckFn, 'TestProvider'))
            .rejects.toThrow('Unable to connect to TestProvider server: String error');
    });
});

describe('Streaming edge cases and concurrency', () => {
    it('should handle rapid chunk delivery', async () => {
        const chunks = Array.from({ length: 100 }, (_, i) => ({
            message: { content: `chunk${i}` }
        }));

        const mockStreamIterator = {
            async *[Symbol.asyncIterator]() {
                for (const chunk of chunks) {
                    yield chunk;
                }
            }
        };

        const receivedChunks: any[] = [];
        const result = await processProviderStream(
            mockStreamIterator,
            { providerName: 'Test', modelName: 'test-model' },
            async (text, done, chunk) => {
                receivedChunks.push({ text, done });
                // Simulate some processing delay
                await new Promise(resolve => setTimeout(resolve, 1));
            }
        );

        expect(result.chunkCount).toBe(100);
        expect(result.completeText).toContain('chunk99');
    });

    it('should handle callback throwing errors', async () => {
        const chunks = [
            { message: { content: 'chunk1' } },
            { message: { content: 'chunk2' } },
            { done: true }
        ];

        const mockStreamIterator = {
            async *[Symbol.asyncIterator]() {
                for (const chunk of chunks) {
                    yield chunk;
                }
            }
        };

        let callCount = 0;
        const errorCallback = vi.fn().mockImplementation(() => {
            callCount++;
            if (callCount === 2) {
                throw new Error('Callback error');
            }
        });

        // Should not throw, errors in callbacks are caught
        const result = await processProviderStream(
            mockStreamIterator,
            { providerName: 'Test', modelName: 'test-model' },
            errorCallback
        );

        expect(result.completeText).toBe('chunk1chunk2');
    });

    it('should handle mixed content and tool calls', async () => {
        const chunks = [
            { message: { content: 'Let me calculate that...' } },
            {
                message: {
                    content: '',
                    tool_calls: [{ id: '1', function: { name: 'calc' } }]
                }
            },
            { message: { content: 'The answer is 42.' } },
            { done: true }
        ];

        const mockStreamIterator = {
            async *[Symbol.asyncIterator]() {
                for (const chunk of chunks) {
                    yield chunk;
                }
            }
        };

        const result = await processProviderStream(
            mockStreamIterator,
            { providerName: 'Test', modelName: 'test-model' }
        );

        expect(result.completeText).toBe('Let me calculate that...The answer is 42.');
        expect(result.toolCalls).toHaveLength(1);
    });
});
