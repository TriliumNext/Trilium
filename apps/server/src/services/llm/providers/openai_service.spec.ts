import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAIService } from './openai_service.js';
import options from '../../options.js';
import * as providers from './providers.js';
import type { Message } from '../ai_interface.js';

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
    getOpenAIOptions: vi.fn()
}));

// Mock OpenAI completely
vi.mock('openai', () => {
    return {
        default: vi.fn()
    };
});

describe('OpenAIService', () => {
    let service: OpenAIService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new OpenAIService();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('constructor', () => {
        it('should initialize with provider name', () => {
            expect(service).toBeDefined();
            expect(service.getName()).toBe('OpenAI');
        });
    });

    describe('isAvailable', () => {
        it('should return true when base checks pass', () => {
            vi.mocked(options.getOptionBool).mockReturnValueOnce(true); // AI enabled

            const result = service.isAvailable();

            expect(result).toBe(true);
        });

        it('should return false when AI is disabled', () => {
            vi.mocked(options.getOptionBool).mockReturnValueOnce(false); // AI disabled

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
            vi.mocked(options.getOption).mockReturnValue('You are a helpful assistant'); // System prompt
        });

        it('should generate non-streaming completion', async () => {
            const mockOptions = {
                apiKey: 'test-key',
                baseUrl: 'https://api.openai.com/v1',
                model: 'gpt-3.5-turbo',
                temperature: 0.7,
                max_tokens: 1000,
                stream: false,
                enableTools: false
            };
            vi.mocked(providers.getOpenAIOptions).mockReturnValueOnce(mockOptions);

            // Mock the getClient method to return our mock client
            const mockCompletion = {
                id: 'chatcmpl-123',
                object: 'chat.completion',
                created: 1677652288,
                model: 'gpt-3.5-turbo',
                choices: [{
                    index: 0,
                    message: {
                        role: 'assistant',
                        content: 'Hello! How can I help you today?'
                    },
                    finish_reason: 'stop'
                }],
                usage: {
                    prompt_tokens: 9,
                    completion_tokens: 12,
                    total_tokens: 21
                }
            };

            const mockClient = {
                chat: {
                    completions: {
                        create: vi.fn().mockResolvedValueOnce(mockCompletion)
                    }
                }
            };

            vi.spyOn(service as any, 'getClient').mockReturnValue(mockClient);

            const result = await service.generateChatCompletion(messages);

            expect(result).toEqual({
                text: 'Hello! How can I help you today?',
                model: 'gpt-3.5-turbo',
                provider: 'OpenAI',
                usage: {
                    promptTokens: 9,
                    completionTokens: 12,
                    totalTokens: 21
                },
                tool_calls: undefined
            });
        });

        it('should handle streaming completion', async () => {
            const mockOptions = {
                apiKey: 'test-key',
                baseUrl: 'https://api.openai.com/v1',
                model: 'gpt-3.5-turbo',
                stream: true
            };
            vi.mocked(providers.getOpenAIOptions).mockReturnValueOnce(mockOptions);

            // Mock the streaming response
            const mockStream = {
                [Symbol.asyncIterator]: async function* () {
                    yield {
                        choices: [{
                            delta: { content: 'Hello' },
                            finish_reason: null
                        }]
                    };
                    yield {
                        choices: [{
                            delta: { content: ' world' },
                            finish_reason: 'stop'
                        }]
                    };
                }
            };

            const mockClient = {
                chat: {
                    completions: {
                        create: vi.fn().mockResolvedValueOnce(mockStream)
                    }
                }
            };

            vi.spyOn(service as any, 'getClient').mockReturnValue(mockClient);

            const result = await service.generateChatCompletion(messages);

            expect(result).toHaveProperty('stream');
            expect(result.text).toBe('');
            expect(result.model).toBe('gpt-3.5-turbo');
            expect(result.provider).toBe('OpenAI');
        });

        it('should throw error if service not available', async () => {
            vi.mocked(options.getOptionBool).mockReturnValueOnce(false); // AI disabled

            await expect(service.generateChatCompletion(messages)).rejects.toThrow(
                'OpenAI service is not available'
            );
        });

        it('should handle API errors', async () => {
            const mockOptions = {
                apiKey: 'test-key',
                baseUrl: 'https://api.openai.com/v1',
                model: 'gpt-3.5-turbo',
                stream: false
            };
            vi.mocked(providers.getOpenAIOptions).mockReturnValueOnce(mockOptions);

            const mockClient = {
                chat: {
                    completions: {
                        create: vi.fn().mockRejectedValueOnce(new Error('API Error: Invalid API key'))
                    }
                }
            };

            vi.spyOn(service as any, 'getClient').mockReturnValue(mockClient);

            await expect(service.generateChatCompletion(messages)).rejects.toThrow(
                'API Error: Invalid API key'
            );
        });

        it('should handle tools when enabled', async () => {
            const mockTools = [{
                type: 'function' as const,
                function: {
                    name: 'test_tool',
                    description: 'Test tool',
                    parameters: {}
                }
            }];

            const mockOptions = {
                apiKey: 'test-key',
                baseUrl: 'https://api.openai.com/v1',
                model: 'gpt-3.5-turbo',
                stream: false,
                enableTools: true,
                tools: mockTools,
                tool_choice: 'auto'
            };
            vi.mocked(providers.getOpenAIOptions).mockReturnValueOnce(mockOptions);

            const mockCompletion = {
                id: 'chatcmpl-123',
                object: 'chat.completion',
                created: 1677652288,
                model: 'gpt-3.5-turbo',
                choices: [{
                    index: 0,
                    message: {
                        role: 'assistant',
                        content: 'I need to use a tool.'
                    },
                    finish_reason: 'stop'
                }],
                usage: {
                    prompt_tokens: 9,
                    completion_tokens: 12,
                    total_tokens: 21
                }
            };

            const mockClient = {
                chat: {
                    completions: {
                        create: vi.fn().mockResolvedValueOnce(mockCompletion)
                    }
                }
            };

            vi.spyOn(service as any, 'getClient').mockReturnValue(mockClient);

            await service.generateChatCompletion(messages);

            const createCall = mockClient.chat.completions.create.mock.calls[0][0];
            expect(createCall.tools).toEqual(mockTools);
            expect(createCall.tool_choice).toBe('auto');
        });

        it('should handle tool calls in response', async () => {
            const mockOptions = {
                apiKey: 'test-key',
                baseUrl: 'https://api.openai.com/v1',
                model: 'gpt-3.5-turbo',
                stream: false,
                enableTools: true,
                tools: [{ type: 'function' as const, function: { name: 'test', description: 'test' } }]
            };
            vi.mocked(providers.getOpenAIOptions).mockReturnValueOnce(mockOptions);

            const mockCompletion = {
                id: 'chatcmpl-123',
                object: 'chat.completion',
                created: 1677652288,
                model: 'gpt-3.5-turbo',
                choices: [{
                    index: 0,
                    message: {
                        role: 'assistant',
                        content: null,
                        tool_calls: [{
                            id: 'call_123',
                            type: 'function',
                            function: {
                                name: 'test',
                                arguments: '{"key": "value"}'
                            }
                        }]
                    },
                    finish_reason: 'tool_calls'
                }],
                usage: {
                    prompt_tokens: 9,
                    completion_tokens: 12,
                    total_tokens: 21
                }
            };

            const mockClient = {
                chat: {
                    completions: {
                        create: vi.fn().mockResolvedValueOnce(mockCompletion)
                    }
                }
            };

            vi.spyOn(service as any, 'getClient').mockReturnValue(mockClient);

            const result = await service.generateChatCompletion(messages);

            expect(result).toEqual({
                text: '',
                model: 'gpt-3.5-turbo',
                provider: 'OpenAI',
                usage: {
                    promptTokens: 9,
                    completionTokens: 12,
                    totalTokens: 21
                },
                tool_calls: [{
                    id: 'call_123',
                    type: 'function',
                    function: {
                        name: 'test',
                        arguments: '{"key": "value"}'
                    }
                }]
            });
        });
    });
});
