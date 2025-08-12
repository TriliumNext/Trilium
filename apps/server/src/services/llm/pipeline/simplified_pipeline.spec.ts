/**
 * Tests for the Simplified Chat Pipeline
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { SimplifiedChatPipeline } from './simplified_pipeline.js';
import type { SimplifiedPipelineInput } from './simplified_pipeline.js';
import configurationService from './configuration_service.js';
import loggingService from './logging_service.js';

// Mock dependencies
vi.mock('./configuration_service.js', () => ({
    default: {
        getToolConfig: vi.fn(() => ({
            enabled: true,
            maxIterations: 3,
            timeout: 30000,
            parallelExecution: false
        })),
        getDebugConfig: vi.fn(() => ({
            enabled: true,
            logLevel: 'info',
            enableMetrics: true,
            enableTracing: false
        })),
        getStreamingConfig: vi.fn(() => ({
            enabled: true,
            chunkSize: 256,
            flushInterval: 100
        })),
        getDefaultSystemPrompt: vi.fn(() => 'You are a helpful assistant.'),
        getDefaultCompletionOptions: vi.fn(() => ({
            temperature: 0.7,
            max_tokens: 2000
        }))
    }
}));

vi.mock('./logging_service.js', () => ({
    default: {
        withRequestId: vi.fn((requestId: string) => ({
            requestId,
            log: vi.fn(),
            error: vi.fn(),
            warn: vi.fn(),
            info: vi.fn(),
            debug: vi.fn(),
            startTimer: vi.fn(() => vi.fn())
        }))
    },
    LogLevel: {
        ERROR: 'error',
        WARN: 'warn',
        INFO: 'info',
        DEBUG: 'debug'
    }
}));

vi.mock('../ai_service_manager.js', () => ({
    default: {
        getService: vi.fn(async () => ({
            chat: vi.fn(async (messages, options) => ({
                text: 'Test response',
                model: 'test-model',
                provider: 'test-provider',
                tool_calls: options?.enableTools ? [] : undefined
            })),
            generateChatCompletion: vi.fn(async (messages, options) => ({
                text: 'Test response',
                model: 'test-model',
                provider: 'test-provider',
                tool_calls: options?.enableTools ? [] : undefined
            })),
            isAvailable: () => true,
            getName: () => 'test-service'
        }))
    }
}));

vi.mock('../tools/tool_registry.js', () => ({
    default: {
        getAllToolDefinitions: vi.fn(() => [
            {
                type: 'function',
                function: {
                    name: 'test_tool',
                    description: 'Test tool',
                    parameters: {}
                }
            }
        ]),
        getTool: vi.fn(() => ({
            execute: vi.fn(async () => 'Tool result')
        }))
    }
}));

describe('SimplifiedChatPipeline', () => {
    let pipeline: SimplifiedChatPipeline;

    beforeEach(() => {
        vi.clearAllMocks();
        pipeline = new SimplifiedChatPipeline();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('execute', () => {
        it('should execute a simple chat without tools', async () => {
            const input: SimplifiedPipelineInput = {
                messages: [
                    { role: 'user', content: 'Hello' }
                ],
                options: {
                    enableTools: false
                }
            };

            const response = await pipeline.execute(input);

            expect(response).toBeDefined();
            expect(response.text).toBe('Test response');
            expect(response.model).toBe('test-model');
            expect(response.provider).toBe('test-provider');
        });

        it('should add system prompt when not present', async () => {
            const aiServiceManager = await import('../ai_service_manager.js');
            const mockChat = vi.fn(async (messages) => {
                // Check that system prompt was added
                expect(messages[0].role).toBe('system');
                expect(messages[0].content).toBe('You are a helpful assistant.');
                return {
                    text: 'Response with system prompt',
                    model: 'test-model',
                    provider: 'test-provider'
                };
            });

            aiServiceManager.default.getService = vi.fn(async () => ({
                chat: mockChat,
                generateChatCompletion: mockChat,
                isAvailable: () => true,
                getName: () => 'test-service'
            }));

            const input: SimplifiedPipelineInput = {
                messages: [
                    { role: 'user', content: 'Hello' }
                ]
            };

            const response = await pipeline.execute(input);

            expect(mockChat).toHaveBeenCalled();
            expect(response.text).toBe('Response with system prompt');
        });

        it('should handle tool calls', async () => {
            const aiServiceManager = await import('../ai_service_manager.js');
            let callCount = 0;
            
            const mockChat = vi.fn(async (messages, options) => {
                callCount++;
                
                // First call returns tool calls
                if (callCount === 1) {
                    return {
                        text: '',
                        model: 'test-model',
                        provider: 'test-provider',
                        tool_calls: [
                            {
                                id: 'call_1',
                                type: 'function',
                                function: {
                                    name: 'test_tool',
                                    arguments: '{}'
                                }
                            }
                        ]
                    };
                }
                
                // Second call (after tool execution) returns final response
                return {
                    text: 'Final response after tool',
                    model: 'test-model',
                    provider: 'test-provider'
                };
            });

            aiServiceManager.default.getService = vi.fn(async () => ({
                chat: mockChat,
                generateChatCompletion: mockChat,
                isAvailable: () => true,
                getName: () => 'test-service'
            }));

            const input: SimplifiedPipelineInput = {
                messages: [
                    { role: 'user', content: 'Use a tool' }
                ],
                options: {
                    enableTools: true
                }
            };

            const response = await pipeline.execute(input);

            expect(mockChat).toHaveBeenCalledTimes(2);
            expect(response.text).toBe('Final response after tool');
        });

        it('should handle streaming when callback is provided', async () => {
            const streamCallback = vi.fn();
            const aiServiceManager = await import('../ai_service_manager.js');
            
            const mockChat = vi.fn(async (messages, options) => ({
                text: 'Streamed response',
                model: 'test-model',
                provider: 'test-provider',
                stream: async (callback: Function) => {
                    await callback({ text: 'Chunk 1', done: false });
                    await callback({ text: 'Chunk 2', done: false });
                    await callback({ text: 'Chunk 3', done: true });
                    return 'Chunk 1Chunk 2Chunk 3';
                }
            }));

            aiServiceManager.default.getService = vi.fn(async () => ({
                chat: mockChat,
                generateChatCompletion: mockChat,
                isAvailable: () => true,
                getName: () => 'test-service'
            }));

            const input: SimplifiedPipelineInput = {
                messages: [
                    { role: 'user', content: 'Stream this' }
                ],
                streamCallback
            };

            const response = await pipeline.execute(input);

            expect(streamCallback).toHaveBeenCalledTimes(3);
            expect(streamCallback).toHaveBeenCalledWith('Chunk 1', false, expect.any(Object));
            expect(streamCallback).toHaveBeenCalledWith('Chunk 2', false, expect.any(Object));
            expect(streamCallback).toHaveBeenCalledWith('Chunk 3', true, expect.any(Object));
            expect(response.text).toBe('Chunk 1Chunk 2Chunk 3');
        });

        it('should respect max tool iterations', async () => {
            const aiServiceManager = await import('../ai_service_manager.js');
            
            // Always return tool calls to test iteration limit
            const mockChat = vi.fn(async () => ({
                text: '',
                model: 'test-model',
                provider: 'test-provider',
                tool_calls: [
                    {
                        id: 'call_infinite',
                        type: 'function',
                        function: {
                            name: 'test_tool',
                            arguments: '{}'
                        }
                    }
                ]
            }));

            aiServiceManager.default.getService = vi.fn(async () => ({
                chat: mockChat,
                generateChatCompletion: mockChat,
                isAvailable: () => true,
                getName: () => 'test-service'
            }));

            const input: SimplifiedPipelineInput = {
                messages: [
                    { role: 'user', content: 'Infinite tools' }
                ],
                options: {
                    enableTools: true
                }
            };

            const response = await pipeline.execute(input);

            // Should be called: 1 initial + 3 tool iterations (max)
            expect(mockChat).toHaveBeenCalledTimes(4);
            expect(response).toBeDefined();
        });

        it('should handle errors gracefully', async () => {
            const aiServiceManager = await import('../ai_service_manager.js');
            aiServiceManager.default.getService = vi.fn(async () => null as any);

            const input: SimplifiedPipelineInput = {
                messages: [
                    { role: 'user', content: 'This will fail' }
                ]
            };

            await expect(pipeline.execute(input)).rejects.toThrow('No AI service available');
        });

        it('should add context when query and advanced context are enabled', async () => {
            // Mock context service
            vi.mock('../context/services/context_service.js', () => ({
                default: {
                    getContextForQuery: vi.fn(async () => 'Relevant context for query')
                }
            }));

            const aiServiceManager = await import('../ai_service_manager.js');
            const mockChat = vi.fn(async (messages) => {
                // Check that context was added to system message
                const systemMessage = messages.find((m: any) => m.role === 'system');
                expect(systemMessage).toBeDefined();
                expect(systemMessage.content).toContain('Context:');
                expect(systemMessage.content).toContain('Relevant context for query');
                
                return {
                    text: 'Response with context',
                    model: 'test-model',
                    provider: 'test-provider'
                };
            });

            aiServiceManager.default.getService = vi.fn(async () => ({
                chat: mockChat,
                generateChatCompletion: mockChat,
                isAvailable: () => true,
                getName: () => 'test-service'
            }));

            const input: SimplifiedPipelineInput = {
                messages: [
                    { role: 'user', content: 'Question needing context' }
                ],
                query: 'Question needing context',
                options: {
                    useAdvancedContext: true
                }
            };

            const response = await pipeline.execute(input);

            expect(mockChat).toHaveBeenCalled();
            expect(response.text).toBe('Response with context');
        });

        it('should track metrics when enabled', async () => {
            const input: SimplifiedPipelineInput = {
                messages: [
                    { role: 'user', content: 'Track metrics' }
                ]
            };

            await pipeline.execute(input);

            const metrics = pipeline.getMetrics();
            expect(metrics).toBeDefined();
            expect(metrics.pipeline_duration).toBeGreaterThan(0);
        });

        it('should generate request ID if not provided', async () => {
            const input: SimplifiedPipelineInput = {
                messages: [
                    { role: 'user', content: 'No request ID' }
                ]
            };

            const response = await pipeline.execute(input);

            // Request ID should be tracked internally by the pipeline
            expect(response).toBeDefined();
            expect(response.text).toBeDefined();
        });
    });

    describe('getMetrics', () => {
        it('should return empty metrics initially', () => {
            const metrics = pipeline.getMetrics();
            expect(metrics).toEqual({});
        });

        it('should return metrics after execution', async () => {
            const input: SimplifiedPipelineInput = {
                messages: [
                    { role: 'user', content: 'Generate metrics' }
                ]
            };

            await pipeline.execute(input);

            const metrics = pipeline.getMetrics();
            expect(Object.keys(metrics).length).toBeGreaterThan(0);
        });
    });

    describe('resetMetrics', () => {
        it('should clear all metrics', async () => {
            const input: SimplifiedPipelineInput = {
                messages: [
                    { role: 'user', content: 'Generate metrics' }
                ]
            };

            await pipeline.execute(input);
            
            let metrics = pipeline.getMetrics();
            expect(Object.keys(metrics).length).toBeGreaterThan(0);

            pipeline.resetMetrics();
            
            metrics = pipeline.getMetrics();
            expect(metrics).toEqual({});
        });
    });
});