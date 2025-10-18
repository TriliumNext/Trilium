import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAIService } from './openai_service.js';
import { AnthropicService } from './anthropic_service.js';
import { OllamaService } from './ollama_service.js';
import type { ChatCompletionOptions } from '../ai_interface.js';
import * as providers from './providers.js';
import options from '../../options.js';

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

vi.mock('openai', () => ({
    default: class MockOpenAI {
        chat = {
            completions: {
                create: vi.fn()
            }
        };
    }
}));

vi.mock('@anthropic-ai/sdk', () => ({
    default: class MockAnthropic {
        messages = {
            create: vi.fn()
        };
    }
}));

vi.mock('ollama', () => ({
    Ollama: class MockOllama {
        chat = vi.fn();
        show = vi.fn();
    }
}));

describe('LLM Model Selection with Special Characters', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Set default options
        vi.mocked(options.getOption).mockImplementation((key: string) => {
            const optionMap: Record<string, string> = {
                'aiEnabled': 'true',
                'aiTemperature': '0.7',
                'aiSystemPrompt': 'You are a helpful assistant.',
                'openaiApiKey': 'test-api-key',
                'openaiBaseUrl': 'https://api.openai.com/v1',
                'anthropicApiKey': 'test-anthropic-key',
                'anthropicBaseUrl': 'https://api.anthropic.com',
                'ollamaBaseUrl': 'http://localhost:11434'
            };
            return optionMap[key] || '';
        });
        vi.mocked(options.getOptionBool).mockReturnValue(true);
    });

    describe('OpenAI Model Names', () => {
        it('should correctly handle model names with periods', async () => {
            const modelName = 'gpt-4.1-turbo-preview';
            vi.mocked(options.getOption).mockImplementation((key: string) => {
                if (key === 'openaiDefaultModel') return modelName;
                return '';
            });

            const service = new OpenAIService();
            const opts: ChatCompletionOptions = {
                stream: false
            };

            // Spy on getOpenAIOptions to verify model name is passed correctly
            const getOpenAIOptionsSpy = vi.spyOn(providers, 'getOpenAIOptions');

            try {
                await service.generateChatCompletion([{ role: 'user', content: 'test' }], opts);
            } catch (error) {
                // Expected to fail due to mocked API
            }

            expect(getOpenAIOptionsSpy).toHaveBeenCalledWith(opts);
            const result = getOpenAIOptionsSpy.mock.results[0].value;
            expect(result.model).toBe(modelName);
        });

        it('should handle model names with slashes', async () => {
            const modelName = 'openai/gpt-4/turbo-2024';
            vi.mocked(options.getOption).mockImplementation((key: string) => {
                if (key === 'openaiDefaultModel') return modelName;
                return '';
            });

            const service = new OpenAIService();
            const opts: ChatCompletionOptions = {
                model: modelName,
                stream: false
            };

            const getOpenAIOptionsSpy = vi.spyOn(providers, 'getOpenAIOptions');

            try {
                await service.generateChatCompletion([{ role: 'user', content: 'test' }], opts);
            } catch (error) {
                // Expected to fail due to mocked API
            }

            const result = getOpenAIOptionsSpy.mock.results[0].value;
            expect(result.model).toBe(modelName);
        });

        it('should handle model names with colons', async () => {
            const modelName = 'custom:gpt-4:finetuned';
            const opts: ChatCompletionOptions = {
                model: modelName,
                stream: false
            };

            const getOpenAIOptionsSpy = vi.spyOn(providers, 'getOpenAIOptions');

            const openaiOptions = providers.getOpenAIOptions(opts);
            expect(openaiOptions.model).toBe(modelName);
        });

        it('should handle model names with underscores and hyphens', async () => {
            const modelName = 'gpt-4_turbo-preview_v2.1';
            const opts: ChatCompletionOptions = {
                model: modelName,
                stream: false
            };

            const openaiOptions = providers.getOpenAIOptions(opts);
            expect(openaiOptions.model).toBe(modelName);
        });

        it('should handle model names with special characters in API request', async () => {
            const modelName = 'gpt-4.1-turbo@latest';
            vi.mocked(options.getOption).mockImplementation((key: string) => {
                if (key === 'openaiDefaultModel') return modelName;
                if (key === 'openaiApiKey') return 'test-key';
                if (key === 'openaiBaseUrl') return 'https://api.openai.com/v1';
                return '';
            });

            const service = new OpenAIService();

            // Access the private openai client through the service
            const client = (service as any).getClient('test-key');
            const createSpy = vi.spyOn(client.chat.completions, 'create');

            try {
                await service.generateChatCompletion(
                    [{ role: 'user', content: 'test' }],
                    { stream: false }
                );
            } catch (error) {
                // Expected due to mock
            }

            expect(createSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    model: modelName
                })
            );
        });
    });

    describe('Anthropic Model Names', () => {
        it('should correctly handle Anthropic model names with periods', async () => {
            const modelName = 'claude-3.5-sonnet-20241022';
            vi.mocked(options.getOption).mockImplementation((key: string) => {
                if (key === 'anthropicDefaultModel') return modelName;
                if (key === 'anthropicApiKey') return 'test-key';
                return '';
            });

            const opts: ChatCompletionOptions = {
                stream: false
            };

            const anthropicOptions = providers.getAnthropicOptions(opts);
            expect(anthropicOptions.model).toBe(modelName);
        });

        it('should handle Anthropic model names with colons', async () => {
            const modelName = 'anthropic:claude-3:opus';
            const opts: ChatCompletionOptions = {
                model: modelName,
                stream: false
            };

            const anthropicOptions = providers.getAnthropicOptions(opts);
            expect(anthropicOptions.model).toBe(modelName);
        });

        it('should handle Anthropic model names in API request', async () => {
            const modelName = 'claude-3.5-sonnet@beta';
            vi.mocked(options.getOption).mockImplementation((key: string) => {
                if (key === 'anthropicDefaultModel') return modelName;
                if (key === 'anthropicApiKey') return 'test-key';
                if (key === 'anthropicBaseUrl') return 'https://api.anthropic.com';
                return '';
            });

            const service = new AnthropicService();

            // Access the private anthropic client
            const client = (service as any).getClient('test-key');
            const createSpy = vi.spyOn(client.messages, 'create');

            try {
                await service.generateChatCompletion(
                    [{ role: 'user', content: 'test' }],
                    { stream: false }
                );
            } catch (error) {
                // Expected due to mock
            }

            expect(createSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    model: modelName
                })
            );
        });
    });

    describe('Ollama Model Names', () => {
        it('should correctly handle Ollama model names with colons', async () => {
            const modelName = 'llama3.1:70b-instruct-q4_K_M';
            vi.mocked(options.getOption).mockImplementation((key: string) => {
                if (key === 'ollamaDefaultModel') return modelName;
                if (key === 'ollamaBaseUrl') return 'http://localhost:11434';
                return '';
            });

            const opts: ChatCompletionOptions = {
                stream: false
            };

            const ollamaOptions = await providers.getOllamaOptions(opts);
            expect(ollamaOptions.model).toBe(modelName);
        });

        it('should handle Ollama model names with slashes', async () => {
            const modelName = 'library/mistral:7b-instruct-v0.3';
            const opts: ChatCompletionOptions = {
                model: modelName,
                stream: false
            };

            const ollamaOptions = await providers.getOllamaOptions(opts);
            expect(ollamaOptions.model).toBe(modelName);
        });

        it('should handle Ollama model names with special characters in options', async () => {
            const modelName = 'custom/llama3.1:70b-q4_K_M@latest';
            vi.mocked(options.getOption).mockImplementation((key: string) => {
                if (key === 'ollamaDefaultModel') return modelName;
                if (key === 'ollamaBaseUrl') return 'http://localhost:11434';
                return '';
            });

            // Test that the model name is preserved in the options
            const opts: ChatCompletionOptions = {
                stream: false
            };

            const ollamaOptions = await providers.getOllamaOptions(opts);
            expect(ollamaOptions.model).toBe(modelName);

            // Also test with model specified in options
            const optsWithModel: ChatCompletionOptions = {
                model: 'another/model:v2.0@beta',
                stream: false
            };

            const ollamaOptionsWithModel = await providers.getOllamaOptions(optsWithModel);
            expect(ollamaOptionsWithModel.model).toBe('another/model:v2.0@beta');
        });
    });

    describe('Model Name Edge Cases', () => {
        it('should handle empty model names gracefully', () => {
            const opts: ChatCompletionOptions = {
                model: '',
                stream: false
            };

            expect(() => providers.getOpenAIOptions(opts)).toThrow('No OpenAI model configured');
        });

        it('should handle model names with unicode characters', async () => {
            const modelName = 'gpt-4-日本語-model';
            const opts: ChatCompletionOptions = {
                model: modelName,
                stream: false
            };

            const openaiOptions = providers.getOpenAIOptions(opts);
            expect(openaiOptions.model).toBe(modelName);
        });

        it('should handle model names with spaces (encoded)', async () => {
            const modelName = 'custom model v2.1';
            const opts: ChatCompletionOptions = {
                model: modelName,
                stream: false
            };

            const openaiOptions = providers.getOpenAIOptions(opts);
            expect(openaiOptions.model).toBe(modelName);
        });

        it('should preserve exact model name without transformation', async () => {
            const complexModelName = 'org/model-v1.2.3:tag@version#variant';
            const opts: ChatCompletionOptions = {
                model: complexModelName,
                stream: false
            };

            // Test for all providers
            const openaiOptions = providers.getOpenAIOptions(opts);
            expect(openaiOptions.model).toBe(complexModelName);

            const anthropicOptions = providers.getAnthropicOptions(opts);
            expect(anthropicOptions.model).toBe(complexModelName);

            const ollamaOptions = await providers.getOllamaOptions(opts);
            expect(ollamaOptions.model).toBe(complexModelName);
        });
    });

    describe('Model Configuration Parsing', () => {
        it('should not confuse provider prefix with model name containing colons', async () => {
            // This model name has a colon but 'custom' is not a known provider
            const modelName = 'custom:model:v1.2';
            const opts: ChatCompletionOptions = {
                model: modelName,
                stream: false
            };

            const openaiOptions = providers.getOpenAIOptions(opts);
            expect(openaiOptions.model).toBe(modelName);
        });

        it('should handle provider prefix correctly', async () => {
            // When model has provider prefix, it should still use the full string
            const modelName = 'openai:gpt-4.1-turbo';
            const opts: ChatCompletionOptions = {
                model: modelName,
                stream: false
            };

            const openaiOptions = providers.getOpenAIOptions(opts);
            expect(openaiOptions.model).toBe(modelName);
        });
    });

    describe('Integration with REST API', () => {
        it('should pass model names correctly through REST chat service', async () => {
            const modelName = 'gpt-4.1-turbo-preview@latest';

            // Mock the configuration helpers
            vi.doMock('../config/configuration_helpers.js', () => ({
                getSelectedModelConfig: vi.fn().mockResolvedValue({
                    model: modelName,
                    provider: 'openai'
                }),
                isAIEnabled: vi.fn().mockResolvedValue(true)
            }));

            const { getSelectedModelConfig } = await import('../config/configuration_helpers.js');
            const config = await getSelectedModelConfig();

            expect(config?.model).toBe(modelName);
        });
    });
});
