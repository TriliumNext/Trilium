import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AnthropicService } from './anthropic_service.js';
import options from '../../options.js';
import * as providers from './providers.js';
import type { ChatCompletionOptions, Message } from '../ai_interface.js';
import Anthropic from '@anthropic-ai/sdk';
import { PROVIDER_CONSTANTS } from '../constants/provider_constants.js';

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
    getAnthropicOptions: vi.fn()
}));

vi.mock('@anthropic-ai/sdk', () => {
    const MockAnthropic = vi.fn();
    return { default: MockAnthropic };
});

describe('AnthropicService', () => {
    let service: AnthropicService;
    let mockAnthropicInstance: any;

    beforeEach(() => {
        vi.clearAllMocks();

        // Get the mocked Anthropic instance before creating the service
        mockAnthropicInstance = {
            messages: {
                create: vi.fn().mockImplementation((params) => {
                    if (params.stream) {
                        return Promise.resolve({
                            [Symbol.asyncIterator]: async function* () {
                                yield {
                                    type: 'content_block_delta',
                                    delta: { text: 'Hello' }
                                };
                                yield {
                                    type: 'content_block_delta',
                                    delta: { text: ' world' }
                                };
                                yield {
                                    type: 'message_delta',
                                    delta: { stop_reason: 'end_turn' }
                                };
                            }
                        });
                    }
                    return Promise.resolve({
                        id: 'msg_123',
                        type: 'message',
                        role: 'assistant',
                        content: [{
                            type: 'text',
                            text: 'Hello! How can I help you today?'
                        }],
                        model: 'claude-3-opus-20240229',
                        stop_reason: 'end_turn',
                        stop_sequence: null,
                        usage: {
                            input_tokens: 10,
                            output_tokens: 25
                        }
                    });
                })
            }
        };

        (Anthropic as any).mockImplementation(function(this: any) {
            return mockAnthropicInstance;
        });

        service = new AnthropicService();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('constructor', () => {
        it('should initialize with provider name', () => {
            expect(service).toBeDefined();
            // The provider name is stored in the parent class
            expect((service as any).name).toBe('Anthropic');
        });
    });

    describe('isAvailable', () => {
        it('should return true when AI is enabled and API key exists', () => {
            vi.mocked(options.getOptionBool).mockReturnValueOnce(true); // AI enabled
            vi.mocked(options.getOption).mockReturnValueOnce('test-api-key'); // API key

            const result = service.isAvailable();

            expect(result).toBe(true);
        });

        it('should return false when AI is disabled', () => {
            vi.mocked(options.getOptionBool).mockReturnValueOnce(false); // AI disabled

            const result = service.isAvailable();

            expect(result).toBe(false);
        });

        it('should return false when no API key', () => {
            vi.mocked(options.getOptionBool).mockReturnValueOnce(true); // AI enabled
            vi.mocked(options.getOption).mockReturnValueOnce(''); // No API key

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
                .mockReturnValueOnce('test-api-key') // API key
                .mockReturnValueOnce('You are a helpful assistant'); // System prompt
        });

        it('should generate non-streaming completion', async () => {
            const mockOptions = {
                apiKey: 'test-key',
                baseUrl: 'https://api.anthropic.com',
                model: 'claude-3-opus-20240229',
                temperature: 0.7,
                max_tokens: 1000,
                stream: false
            };
            vi.mocked(providers.getAnthropicOptions).mockReturnValueOnce(mockOptions);

            const result = await service.generateChatCompletion(messages);

            expect(result).toEqual({
                text: 'Hello! How can I help you today?',
                provider: 'Anthropic',
                model: 'claude-3-opus-20240229',
                usage: {
                    promptTokens: 10,
                    completionTokens: 25,
                    totalTokens: 35
                },
                tool_calls: null
            });
        });

        it('should format messages properly for Anthropic API', async () => {
            const mockOptions = {
                apiKey: 'test-key',
                baseUrl: 'https://api.anthropic.com',
                model: 'claude-3-opus-20240229',
                stream: false
            };
            vi.mocked(providers.getAnthropicOptions).mockReturnValueOnce(mockOptions);

            const createSpy = vi.spyOn(mockAnthropicInstance.messages, 'create');

            await service.generateChatCompletion(messages);

            const calledParams = createSpy.mock.calls[0][0] as any;
            expect(calledParams.messages).toEqual([
                { role: 'user', content: 'Hello' }
            ]);
            expect(calledParams.system).toBe('You are a helpful assistant');
        });

        it('should handle streaming completion', async () => {
            const mockOptions = {
                apiKey: 'test-key',
                baseUrl: 'https://api.anthropic.com',
                model: 'claude-3-opus-20240229',
                stream: true,
                onChunk: vi.fn()
            };
            vi.mocked(providers.getAnthropicOptions).mockReturnValueOnce(mockOptions);

            const result = await service.generateChatCompletion(messages);

            // Wait for chunks to be processed
            await new Promise(resolve => setTimeout(resolve, 100));

            // Check that the result exists (streaming logic is complex, so we just verify basic structure)
            expect(result).toBeDefined();
            expect(result).toHaveProperty('text');
            expect(result).toHaveProperty('provider');
        });

        it('should handle tool calls', async () => {
            const mockTools = [{
                name: 'test_tool',
                description: 'Test tool',
                input_schema: {
                    type: 'object',
                    properties: {}
                }
            }];

            const mockOptions = {
                apiKey: 'test-key',
                baseUrl: 'https://api.anthropic.com',
                model: 'claude-3-opus-20240229',
                stream: false,
                enableTools: true,
                tools: mockTools,
                tool_choice: { type: 'any' }
            };
            vi.mocked(providers.getAnthropicOptions).mockReturnValueOnce(mockOptions);

            // Mock response with tool use
            mockAnthropicInstance.messages.create.mockResolvedValueOnce({
                id: 'msg_123',
                type: 'message',
                role: 'assistant',
                content: [{
                    type: 'tool_use',
                    id: 'tool_123',
                    name: 'test_tool',
                    input: { key: 'value' }
                }],
                model: 'claude-3-opus-20240229',
                stop_reason: 'tool_use',
                stop_sequence: null,
                usage: {
                    input_tokens: 10,
                    output_tokens: 25
                }
            });

            const result = await service.generateChatCompletion(messages);

            expect(result).toEqual({
                text: '',
                provider: 'Anthropic',
                model: 'claude-3-opus-20240229',
                usage: {
                    promptTokens: 10,
                    completionTokens: 25,
                    totalTokens: 35
                },
                tool_calls: [{
                    id: 'tool_123',
                    type: 'function',
                    function: {
                        name: 'test_tool',
                        arguments: '{"key":"value"}'
                    }
                }]
            });
        });

        it('should throw error if service not available', async () => {
            vi.mocked(options.getOptionBool).mockReturnValueOnce(false); // AI disabled

            await expect(service.generateChatCompletion(messages)).rejects.toThrow(
                'Anthropic service is not available'
            );
        });

        it('should handle API errors', async () => {
            const mockOptions = {
                apiKey: 'test-key',
                baseUrl: 'https://api.anthropic.com',
                model: 'claude-3-opus-20240229',
                stream: false
            };
            vi.mocked(providers.getAnthropicOptions).mockReturnValueOnce(mockOptions);

            // Mock API error
            mockAnthropicInstance.messages.create.mockRejectedValueOnce(
                new Error('API Error: Invalid API key')
            );

            await expect(service.generateChatCompletion(messages)).rejects.toThrow(
                'API Error: Invalid API key'
            );
        });

        it('should use custom API version and beta version', async () => {
            const mockOptions = {
                apiKey: 'test-key',
                baseUrl: 'https://api.anthropic.com',
                model: 'claude-3-opus-20240229',
                apiVersion: '2024-01-01',
                betaVersion: 'beta-feature-1',
                stream: false
            };
            vi.mocked(providers.getAnthropicOptions).mockReturnValueOnce(mockOptions);

            // Spy on Anthropic constructor
            (Anthropic as any).mockClear();

            // Create new service to trigger client creation
            const newService = new AnthropicService();
            await newService.generateChatCompletion(messages);

            expect(Anthropic).toHaveBeenCalledWith({
                apiKey: 'test-key',
                baseURL: 'https://api.anthropic.com',
                defaultHeaders: {
                    'anthropic-version': '2024-01-01',
                    'anthropic-beta': 'beta-feature-1'
                }
            });
        });

        it('should use default API version when not specified', async () => {
            const mockOptions = {
                apiKey: 'test-key',
                baseUrl: 'https://api.anthropic.com',
                model: 'claude-3-opus-20240229',
                stream: false
            };
            vi.mocked(providers.getAnthropicOptions).mockReturnValueOnce(mockOptions);

            // Spy on Anthropic constructor
            (Anthropic as any).mockClear();

            // Create new service to trigger client creation
            const newService = new AnthropicService();
            await newService.generateChatCompletion(messages);

            expect(Anthropic).toHaveBeenCalledWith({
                apiKey: 'test-key',
                baseURL: 'https://api.anthropic.com',
                defaultHeaders: {
                    'anthropic-version': PROVIDER_CONSTANTS.ANTHROPIC.API_VERSION,
                    'anthropic-beta': PROVIDER_CONSTANTS.ANTHROPIC.BETA_VERSION
                }
            });
        });

        it('should handle mixed content types in response', async () => {
            const mockOptions = {
                apiKey: 'test-key',
                baseUrl: 'https://api.anthropic.com',
                model: 'claude-3-opus-20240229',
                stream: false
            };
            vi.mocked(providers.getAnthropicOptions).mockReturnValueOnce(mockOptions);

            // Mock response with mixed content
            mockAnthropicInstance.messages.create.mockResolvedValueOnce({
                id: 'msg_123',
                type: 'message',
                role: 'assistant',
                content: [
                    { type: 'text', text: 'Here is the result: ' },
                    { type: 'tool_use', id: 'tool_123', name: 'calculate', input: { x: 5, y: 3 } },
                    { type: 'text', text: ' The calculation is complete.' }
                ],
                model: 'claude-3-opus-20240229',
                stop_reason: 'end_turn',
                stop_sequence: null,
                usage: {
                    input_tokens: 10,
                    output_tokens: 25
                }
            });

            const result = await service.generateChatCompletion(messages);

            expect(result.text).toBe('Here is the result:  The calculation is complete.');
            expect(result.tool_calls).toHaveLength(1);
            expect(result.tool_calls![0].function.name).toBe('calculate');
        });

        it('should handle tool results in messages', async () => {
            const messagesWithToolResult: Message[] = [
                { role: 'user', content: 'Calculate 5 + 3' },
                {
                    role: 'assistant',
                    content: '',
                    tool_calls: [{
                        id: 'call_123',
                        type: 'function',
                        function: { name: 'calculate', arguments: '{"x": 5, "y": 3}' }
                    }]
                },
                {
                    role: 'tool',
                    content: '8',
                    tool_call_id: 'call_123'
                }
            ];

            const mockOptions = {
                apiKey: 'test-key',
                baseUrl: 'https://api.anthropic.com',
                model: 'claude-3-opus-20240229',
                stream: false
            };
            vi.mocked(providers.getAnthropicOptions).mockReturnValueOnce(mockOptions);

            const createSpy = vi.spyOn(mockAnthropicInstance.messages, 'create');

            await service.generateChatCompletion(messagesWithToolResult);

            const formattedMessages = (createSpy.mock.calls[0][0] as any).messages;
            expect(formattedMessages).toHaveLength(3);
            expect(formattedMessages[2]).toEqual({
                role: 'user',
                content: [{
                    type: 'tool_result',
                    tool_use_id: 'call_123',
                    content: '8'
                }]
            });
        });
    });
});
