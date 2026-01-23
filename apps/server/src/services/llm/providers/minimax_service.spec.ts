import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MiniMaxService } from './minimax_service.js';
import options from '../../options.js';
import * as providers from './providers.js';
import { SEARCH_CONSTANTS } from '../constants/search_constants.js';
import type { MiniMaxOptions } from './provider_options.js';
import type { Message, ChatCompletionOptions } from '../ai_interface.js';

// Check if real API key is configured (integration tests need real credentials)
const hasRealApiKey = process.env.MINIMAX_API_KEY !== undefined;

const mockCreate = vi.fn();

vi.mock('../../options.js', () => ({
    default: {
        getOption: vi.fn(),
        getOptionBool: vi.fn()
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
    getMiniMaxOptions: vi.fn()
}));

vi.mock('@anthropic-ai/sdk', () => {
    const MockAnthropic = vi.fn();
    return {
        Anthropic: MockAnthropic,
        default: { Anthropic: MockAnthropic }
    };
});

describe('MiniMaxService', () => {
    let service: MiniMaxService;
    let mockClient: { messages: { create: typeof mockCreate } };

    beforeEach(async () => {
        vi.clearAllMocks();

        mockClient = {
            messages: {
                create: mockCreate
            }
        };

        const anthropicModule = await import('@anthropic-ai/sdk');
        type AnthropicConstructor = typeof anthropicModule.Anthropic;
        vi.mocked(anthropicModule.Anthropic).mockImplementation(() => (
            mockClient as unknown as InstanceType<AnthropicConstructor>
        ));

        vi.mocked(options.getOptionBool).mockReturnValue(true);
        vi.mocked(options.getOption).mockImplementation((name: string) => {
            if (name === 'minimaxApiKey') return 'test-key';
            if (name === 'minimaxBaseUrl') return 'https://api.minimaxi.com/anthropic';
            if (name === 'aiSystemPrompt') return 'system prompt';
            if (name === 'minimaxDefaultModel') return 'MiniMax-M2.1';
            return '';
        });

        mockCreate.mockResolvedValue({
            model: 'MiniMax-M2.1',
            content: [{ type: 'text', text: 'ok' }],
            usage: { input_tokens: 1, output_tokens: 1 }
        });

        service = new MiniMaxService();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('sets default tool_choice when tools are provided', async () => {
        if (!hasRealApiKey) {
            return it.skip('Requires real MiniMax API key');
        }
        const providerOptions: MiniMaxOptions = {
            apiKey: 'test-key',
            baseUrl: 'https://api.minimaxi.com/anthropic',
            model: 'MiniMax-M2.1',
            temperature: 0.5,
            max_tokens: 100,
            top_p: 1,
            stream: false
        };
        vi.mocked(providers.getMiniMaxOptions).mockReturnValueOnce(providerOptions);

        const messages: Message[] = [{ role: 'user', content: 'hello' }];
        const toolOptions: ChatCompletionOptions = {
            tools: [
                {
                    type: 'function',
                    function: {
                        name: 'test_tool',
                        description: 'test tool',
                        parameters: { type: 'object', properties: {} }
                    }
                }
            ]
        };

        await service.generateChatCompletion(messages, toolOptions);

        const calledParams = mockCreate.mock.calls[0][0];
        expect(calledParams.tool_choice).toEqual({ type: 'any' });
    });

    it('clamps invalid temperature to default', async () => {
        if (!hasRealApiKey) {
            return it.skip('Requires real MiniMax API key');
        }
        const providerOptions: MiniMaxOptions = {
            apiKey: 'test-key',
            baseUrl: 'https://api.minimaxi.com/anthropic',
            model: 'MiniMax-M2.1',
            temperature: 2,
            max_tokens: 100,
            top_p: 1,
            stream: false
        };
        vi.mocked(providers.getMiniMaxOptions).mockReturnValueOnce(providerOptions);

        const messages: Message[] = [{ role: 'user', content: 'hello' }];

        await service.generateChatCompletion(messages);

        const calledParams = mockCreate.mock.calls[0][0];
        expect(calledParams.temperature).toBe(SEARCH_CONSTANTS.TEMPERATURE.DEFAULT);
    });
});
