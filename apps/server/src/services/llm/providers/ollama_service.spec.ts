import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OllamaService } from './ollama_service.js';
import options from '../../options.js';
import * as providers from './providers.js';
import type { ChatCompletionOptions, Message } from '../ai_interface.js';
import { Ollama } from 'ollama';

// Mock dependencies
vi.mock('../../options.js', () => ({
    default: {
        getOption: vi.fn(),
        getOptionBool: vi.fn(),
        getOptionInt: vi.fn(name => {
            if (name === "protectedSessionTimeout") return Number.MAX_SAFE_INTEGER;
            return 0;
        })
    }
}));

vi.mock('../../log.js', () => ({
    default: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn()
    }
}));

vi.mock('./providers.js', () => ({
    getOllamaOptions: vi.fn()
}));

vi.mock('../formatters/ollama_formatter.js', () => {
    class MockFormatter {
        formatMessages = vi.fn().mockReturnValue([
            { role: 'user', content: 'Hello' }
        ]);
        formatResponse = vi.fn().mockReturnValue({
            text: 'Hello! How can I help you today?',
            provider: 'Ollama',
            model: 'llama2',
            usage: {
                promptTokens: 5,
                completionTokens: 10,
                totalTokens: 15
            },
            tool_calls: null
        });
    }
    return { OllamaMessageFormatter: MockFormatter };
});

vi.mock('../tools/tool_registry.js', () => ({
    default: {
        getTools: vi.fn().mockReturnValue([]),
        executeTool: vi.fn()
    }
}));

vi.mock('./stream_handler.js', () => ({
    StreamProcessor: vi.fn(),
    createStreamHandler: vi.fn(),
    performProviderHealthCheck: vi.fn(),
    processProviderStream: vi.fn(),
    extractStreamStats: vi.fn()
}));

vi.mock('ollama', () => {
    const MockOllama = vi.fn();
    return { Ollama: MockOllama };
});

// Mock global fetch
global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: vi.fn().mockResolvedValue({})
});

describe('OllamaService', () => {
    let service: OllamaService;
    let mockOllamaInstance: any;

    beforeEach(() => {
        vi.clearAllMocks();

        // Create the mock instance before creating the service
        mockOllamaInstance = {
            chat: vi.fn().mockImplementation((params) => {
                if (params.stream) {
                    return Promise.resolve({
                        [Symbol.asyncIterator]: async function* () {
                            yield {
                                message: {
                                    role: 'assistant',
                                    content: 'Hello'
                                },
                                done: false
                            };
                            yield {
                                message: {
                                    role: 'assistant',
                                    content: ' world'
                                },
                                done: true
                            };
                        }
                    });
                }
                return Promise.resolve({
                    message: {
                        role: 'assistant',
                        content: 'Hello! How can I help you today?'
                    },
                    created_at: '2024-01-01T00:00:00Z',
                    model: 'llama2',
                    done: true
                });
            }),
            show: vi.fn().mockResolvedValue({
                modelfile: 'FROM llama2',
                parameters: {},
                template: '',
                details: {
                    format: 'gguf',
                    family: 'llama',
                    families: ['llama'],
                    parameter_size: '7B',
                    quantization_level: 'Q4_0'
                }
            }),
            list: vi.fn().mockResolvedValue({
                models: [
                    {
                        name: 'llama2:latest',
                        modified_at: '2024-01-01T00:00:00Z',
                        size: 3800000000
                    }
                ]
            })
        };

        // Mock the Ollama constructor to return our mock instance
        (Ollama as any).mockImplementation(function(this: any) {
            return mockOllamaInstance;
        });

        service = new OllamaService();

        // Replace the formatter with a mock after construction
        (service as any).formatter = {
            formatMessages: vi.fn().mockReturnValue([
                { role: 'user', content: 'Hello' }
            ]),
            formatResponse: vi.fn().mockReturnValue({
                text: 'Hello! How can I help you today?',
                provider: 'Ollama',
                model: 'llama2',
                usage: {
                    promptTokens: 5,
                    completionTokens: 10,
                    totalTokens: 15
                },
                tool_calls: null
            })
        };
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('constructor', () => {
        it('should initialize with provider name and formatter', () => {
            expect(service).toBeDefined();
            expect((service as any).name).toBe('Ollama');
            expect((service as any).formatter).toBeDefined();
        });
    });

    describe('isAvailable', () => {
        it('should return true when AI is enabled and base URL exists', () => {
            vi.mocked(options.getOptionBool).mockReturnValueOnce(true); // AI enabled
            vi.mocked(options.getOption).mockReturnValueOnce('http://localhost:11434'); // Base URL

            const result = service.isAvailable();

            expect(result).toBe(true);
        });

        it('should return false when AI is disabled', () => {
            vi.mocked(options.getOptionBool).mockReturnValueOnce(false); // AI disabled

            const result = service.isAvailable();

            expect(result).toBe(false);
        });

        it('should return false when no base URL', () => {
            vi.mocked(options.getOptionBool).mockReturnValueOnce(true); // AI enabled
            vi.mocked(options.getOption).mockReturnValueOnce(''); // No base URL

            const result = service.isAvailable();

            expect(result).toBe(false);
        });
    });

    describe('generateChatCompletion', () => {
        const messages: Message[] = [
            { role: 'user', content: 'Hello' }
        ];

        beforeEach(() => {
            vi.mocked(options.getOptionBool).mockReturnValue(true); // AI enabled
            vi.mocked(options.getOption)
                .mockReturnValue('http://localhost:11434'); // Base URL for ollamaBaseUrl
        });

        it('should generate non-streaming completion', async () => {
            const mockOptions = {
                baseUrl: 'http://localhost:11434',
                model: 'llama2',
                temperature: 0.7,
                stream: false
            };
            vi.mocked(providers.getOllamaOptions).mockResolvedValueOnce(mockOptions);
            vi.mocked(options.getOption).mockReturnValue('http://localhost:11434');

            const result = await service.generateChatCompletion(messages);

            expect(result).toEqual({
                text: 'Hello! How can I help you today?',
                provider: 'ollama',
                model: 'llama2',
                tool_calls: undefined
            });
        });

        it('should handle streaming completion', async () => {
            const mockOptions = {
                baseUrl: 'http://localhost:11434',
                model: 'llama2',
                temperature: 0.7,
                stream: true,
                onChunk: vi.fn()
            };
            vi.mocked(providers.getOllamaOptions).mockResolvedValueOnce(mockOptions);
            vi.mocked(options.getOption).mockReturnValue('http://localhost:11434');

            const result = await service.generateChatCompletion(messages);

            // Wait for chunks to be processed
            await new Promise(resolve => setTimeout(resolve, 100));

            // For streaming, we expect a different response structure
            expect(result).toBeDefined();
            expect(result).toHaveProperty('text');
            expect(result).toHaveProperty('provider');
        });

        it('should handle tools when enabled', async () => {
            vi.mocked(options.getOption).mockReturnValue('http://localhost:11434');

            const mockTools = [{
                name: 'test_tool',
                description: 'Test tool',
                parameters: {
                    type: 'object',
                    properties: {},
                    required: []
                }
            }];

            const mockOptions = {
                baseUrl: 'http://localhost:11434',
                model: 'llama2',
                stream: false,
                enableTools: true,
                tools: mockTools
            };
            vi.mocked(providers.getOllamaOptions).mockResolvedValueOnce(mockOptions);

            const chatSpy = vi.spyOn(mockOllamaInstance, 'chat');

            await service.generateChatCompletion(messages);

            const calledParams = chatSpy.mock.calls[0][0] as any;
            expect(calledParams.tools).toEqual(mockTools);
        });

        it('should throw error if service not available', async () => {
            vi.mocked(options.getOptionBool).mockReturnValueOnce(false); // AI disabled

            await expect(service.generateChatCompletion(messages)).rejects.toThrow(
                'Ollama service is not available'
            );
        });

        it('should throw error if no base URL configured', async () => {
            vi.mocked(options.getOption)
                .mockReturnValueOnce('') // Empty base URL for ollamaBaseUrl
                .mockReturnValue(''); // Ensure all subsequent calls return empty

            const mockOptions = {
                baseUrl: '',
                model: 'llama2',
                stream: false
            };
            vi.mocked(providers.getOllamaOptions).mockResolvedValueOnce(mockOptions);

            await expect(service.generateChatCompletion(messages)).rejects.toThrow(
                'Ollama service is not available'
            );
        });

        it('should handle API errors', async () => {
            vi.mocked(options.getOption).mockReturnValue('http://localhost:11434');

            const mockOptions = {
                baseUrl: 'http://localhost:11434',
                model: 'llama2',
                stream: false
            };
            vi.mocked(providers.getOllamaOptions).mockResolvedValueOnce(mockOptions);

            // Mock API error
            mockOllamaInstance.chat.mockRejectedValueOnce(
                new Error('Connection refused')
            );

            await expect(service.generateChatCompletion(messages)).rejects.toThrow(
                'Connection refused'
            );
        });

        it('should create client with custom fetch for debugging', async () => {
            vi.mocked(options.getOption).mockReturnValue('http://localhost:11434');

            const mockOptions = {
                baseUrl: 'http://localhost:11434',
                model: 'llama2',
                stream: false
            };
            vi.mocked(providers.getOllamaOptions).mockResolvedValueOnce(mockOptions);

            // Spy on Ollama constructor
            (Ollama as any).mockClear();

            // Create new service to trigger client creation
            const newService = new OllamaService();

            // Replace the formatter with a mock for the new service
            (newService as any).formatter = {
                formatMessages: vi.fn().mockReturnValue([
                    { role: 'user', content: 'Hello' }
                ])
            };

            await newService.generateChatCompletion(messages);

            expect(Ollama).toHaveBeenCalledWith({
                host: 'http://localhost:11434',
                fetch: expect.any(Function)
            });
        });

        it('should handle tool execution feedback', async () => {
            vi.mocked(options.getOption).mockReturnValue('http://localhost:11434');

            const mockOptions = {
                baseUrl: 'http://localhost:11434',
                model: 'llama2',
                stream: false,
                enableTools: true,
                tools: [{ name: 'test_tool', description: 'Test', parameters: {} }]
            };
            vi.mocked(providers.getOllamaOptions).mockResolvedValueOnce(mockOptions);

            // Mock response with tool call (arguments should be a string for Ollama)
            mockOllamaInstance.chat.mockResolvedValueOnce({
                message: {
                    role: 'assistant',
                    content: '',
                    tool_calls: [{
                        id: 'call_123',
                        function: {
                            name: 'test_tool',
                            arguments: '{"key":"value"}'
                        }
                    }]
                },
                done: true
            });

            const result = await service.generateChatCompletion(messages);

            expect(result.tool_calls).toEqual([{
                id: 'call_123',
                type: 'function',
                function: {
                    name: 'test_tool',
                    arguments: '{"key":"value"}'
                }
            }]);
        });

        it('should handle mixed text and tool content', async () => {
            vi.mocked(options.getOption).mockReturnValue('http://localhost:11434');

            const mockOptions = {
                baseUrl: 'http://localhost:11434',
                model: 'llama2',
                stream: false
            };
            vi.mocked(providers.getOllamaOptions).mockResolvedValueOnce(mockOptions);

            // Mock response with both text and tool calls
            mockOllamaInstance.chat.mockResolvedValueOnce({
                message: {
                    role: 'assistant',
                    content: 'Let me help you with that.',
                    tool_calls: [{
                        id: 'call_123',
                        function: {
                            name: 'calculate',
                            arguments: { x: 5, y: 3 }
                        }
                    }]
                },
                done: true
            });

            const result = await service.generateChatCompletion(messages);

            expect(result.text).toBe('Let me help you with that.');
            expect(result.tool_calls).toHaveLength(1);
        });

        it('should format messages using the formatter', async () => {
            vi.mocked(options.getOption).mockReturnValue('http://localhost:11434');

            const mockOptions = {
                baseUrl: 'http://localhost:11434',
                model: 'llama2',
                stream: false
            };
            vi.mocked(providers.getOllamaOptions).mockResolvedValueOnce(mockOptions);

            const formattedMessages = [{ role: 'user', content: 'Hello' }];
            (service as any).formatter.formatMessages.mockReturnValueOnce(formattedMessages);

            const chatSpy = vi.spyOn(mockOllamaInstance, 'chat');

            await service.generateChatCompletion(messages);

            expect((service as any).formatter.formatMessages).toHaveBeenCalled();
            expect(chatSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    messages: formattedMessages
                })
            );
        });

        it('should handle network errors gracefully', async () => {
            vi.mocked(options.getOption).mockReturnValue('http://localhost:11434');

            const mockOptions = {
                baseUrl: 'http://localhost:11434',
                model: 'llama2',
                stream: false
            };
            vi.mocked(providers.getOllamaOptions).mockResolvedValueOnce(mockOptions);

            // Mock network error
            global.fetch = vi.fn().mockRejectedValueOnce(
                new Error('Network error')
            );

            mockOllamaInstance.chat.mockRejectedValueOnce(
                new Error('fetch failed')
            );

            await expect(service.generateChatCompletion(messages)).rejects.toThrow(
                'fetch failed'
            );
        });

        it('should validate model availability', async () => {
            vi.mocked(options.getOption).mockReturnValue('http://localhost:11434');

            const mockOptions = {
                baseUrl: 'http://localhost:11434',
                model: 'nonexistent-model',
                stream: false
            };
            vi.mocked(providers.getOllamaOptions).mockResolvedValueOnce(mockOptions);

            // Mock model not found error
            mockOllamaInstance.chat.mockRejectedValueOnce(
                new Error('model "nonexistent-model" not found')
            );

            await expect(service.generateChatCompletion(messages)).rejects.toThrow(
                'model "nonexistent-model" not found'
            );
        });
    });

    describe('client management', () => {
        it('should reuse existing client', async () => {
            vi.mocked(options.getOptionBool).mockReturnValue(true);
            vi.mocked(options.getOption).mockReturnValue('http://localhost:11434');

            const mockOptions = {
                baseUrl: 'http://localhost:11434',
                model: 'llama2',
                stream: false
            };
            vi.mocked(providers.getOllamaOptions).mockResolvedValue(mockOptions);

            (Ollama as any).mockClear();

            // Make two calls
            await service.generateChatCompletion([{ role: 'user', content: 'Hello' }]);
            await service.generateChatCompletion([{ role: 'user', content: 'Hi' }]);

            // Should only create client once
            expect(Ollama).toHaveBeenCalledTimes(1);
        });
    });
});
