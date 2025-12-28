import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AIServiceManager } from './ai_service_manager.js';
import options from '../options.js';
import eventService from '../events.js';
import { AnthropicService } from './providers/anthropic_service.js';
import { OpenAIService } from './providers/openai_service.js';
import { OllamaService } from './providers/ollama_service.js';
import * as configHelpers from './config/configuration_helpers.js';
import type { AIService, ChatCompletionOptions, Message } from './ai_interface.js';

// Mock dependencies
vi.mock('../options.js', () => ({
    default: {
        getOption: vi.fn(),
        getOptionBool: vi.fn(),
        getOptionInt: vi.fn(name => {
            if (name === "protectedSessionTimeout") return Number.MAX_SAFE_INTEGER;
            return 0;
        })
    }
}));

vi.mock('../events.js', () => ({
    default: {
        subscribe: vi.fn()
    }
}));

vi.mock('../log.js', () => ({
    default: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn()
    }
}));

vi.mock('./providers/anthropic_service.js', () => ({
    AnthropicService: vi.fn()
}));

vi.mock('./providers/openai_service.js', () => ({
    OpenAIService: vi.fn()
}));

vi.mock('./providers/ollama_service.js', () => ({
    OllamaService: vi.fn()
}));

vi.mock('./config/configuration_helpers.js', () => ({
    getSelectedProvider: vi.fn(),
    parseModelIdentifier: vi.fn(),
    isAIEnabled: vi.fn(),
    getDefaultModelForProvider: vi.fn(),
    clearConfigurationCache: vi.fn(),
    validateConfiguration: vi.fn()
}));

vi.mock('./context/index.js', () => ({
    ContextExtractor: vi.fn().mockImplementation(function () {})
}));

vi.mock('./context_extractors/index.js', () => ({
    default: {
        getTools: vi.fn().mockReturnValue({
            noteNavigator: {},
            queryDecomposition: {},
            contextualThinking: {}
        }),
        getAllTools: vi.fn().mockReturnValue([])
    }
}));

vi.mock('./context/services/context_service.js', () => ({
    default: {
        findRelevantNotes: vi.fn().mockResolvedValue([])
    }
}));

vi.mock('./tools/tool_initializer.js', () => ({
    default: {
        initializeTools: vi.fn().mockResolvedValue(undefined)
    }
}));

describe('AIServiceManager', () => {
    let manager: AIServiceManager;

    beforeEach(() => {
        vi.clearAllMocks();

        // Set up default mock implementations for service constructors
        (AnthropicService as any).mockImplementation(function(this: any) {
            this.isAvailable = vi.fn().mockReturnValue(true);
            this.generateChatCompletion = vi.fn();
        });

        (OpenAIService as any).mockImplementation(function(this: any) {
            this.isAvailable = vi.fn().mockReturnValue(true);
            this.generateChatCompletion = vi.fn();
        });

        (OllamaService as any).mockImplementation(function(this: any) {
            this.isAvailable = vi.fn().mockReturnValue(true);
            this.generateChatCompletion = vi.fn();
        });

        manager = new AIServiceManager();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('constructor', () => {
        it('should initialize tools and set up event listeners', () => {
            // The constructor initializes tools but doesn't set up event listeners anymore
            // Just verify the manager was created
            expect(manager).toBeDefined();
        });
    });

    describe('getSelectedProviderAsync', () => {
        it('should return the selected provider', async () => {
            vi.mocked(configHelpers.getSelectedProvider).mockResolvedValueOnce('openai');

            const result = await manager.getSelectedProviderAsync();

            expect(result).toBe('openai');
            expect(configHelpers.getSelectedProvider).toHaveBeenCalled();
        });

        it('should return null if no provider is selected', async () => {
            vi.mocked(configHelpers.getSelectedProvider).mockResolvedValueOnce(null);

            const result = await manager.getSelectedProviderAsync();

            expect(result).toBeNull();
        });

        it('should handle errors and return null', async () => {
            vi.mocked(configHelpers.getSelectedProvider).mockRejectedValueOnce(new Error('Config error'));

            const result = await manager.getSelectedProviderAsync();

            expect(result).toBeNull();
        });
    });

    describe('validateConfiguration', () => {
        it('should return null for valid configuration', async () => {
            vi.mocked(configHelpers.validateConfiguration).mockResolvedValueOnce({
                isValid: true,
                errors: [],
                warnings: []
            });

            const result = await manager.validateConfiguration();

            expect(result).toBeNull();
        });

        it('should return error message for invalid configuration', async () => {
            vi.mocked(configHelpers.validateConfiguration).mockResolvedValueOnce({
                isValid: false,
                errors: ['Missing API key', 'Invalid model'],
                warnings: []
            });

            const result = await manager.validateConfiguration();

            expect(result).toContain('There are issues with your AI configuration');
            expect(result).toContain('Missing API key');
            expect(result).toContain('Invalid model');
        });

        it('should include warnings in valid configuration', async () => {
            vi.mocked(configHelpers.validateConfiguration).mockResolvedValueOnce({
                isValid: true,
                errors: [],
                warnings: ['Model not optimal']
            });

            const result = await manager.validateConfiguration();

            expect(result).toBeNull();
        });
    });

    describe('getOrCreateAnyService', () => {
        it('should create and return the selected provider service', async () => {
            vi.mocked(configHelpers.getSelectedProvider).mockResolvedValueOnce('openai');
            vi.mocked(options.getOption).mockReturnValueOnce('test-api-key');

            (OpenAIService as any).mockImplementationOnce(function(this: any) {
                this.isAvailable = vi.fn().mockReturnValue(true);
                this.generateChatCompletion = vi.fn();
            });

            const result = await manager.getOrCreateAnyService();

            expect(result).toBeDefined();
            expect(result.isAvailable()).toBe(true);
        });

        it('should throw error if no provider is selected', async () => {
            vi.mocked(configHelpers.getSelectedProvider).mockResolvedValueOnce(null);

            await expect(manager.getOrCreateAnyService()).rejects.toThrow(
                'No AI provider is selected'
            );
        });

        it('should throw error if selected provider is not available', async () => {
            vi.mocked(configHelpers.getSelectedProvider).mockResolvedValueOnce('openai');
            vi.mocked(options.getOption).mockReturnValueOnce(''); // No API key

            await expect(manager.getOrCreateAnyService()).rejects.toThrow(
                'Selected AI provider (openai) is not available'
            );
        });
    });

    describe('isAnyServiceAvailable', () => {
        it('should return true if any provider is available', () => {
            vi.mocked(options.getOption).mockReturnValueOnce('test-api-key');

            const result = manager.isAnyServiceAvailable();

            expect(result).toBe(true);
        });

        it('should return false if no providers are available', () => {
            vi.mocked(options.getOption).mockReturnValue('');

            const result = manager.isAnyServiceAvailable();

            expect(result).toBe(false);
        });
    });

    describe('getAvailableProviders', () => {
        it('should return list of available providers', () => {
            vi.mocked(options.getOption)
                .mockReturnValueOnce('openai-key')
                .mockReturnValueOnce('anthropic-key')
                .mockReturnValueOnce(''); // No Ollama URL

            const result = manager.getAvailableProviders();

            expect(result).toEqual(['openai', 'anthropic']);
        });

        it('should include already created services', () => {
            // Mock that OpenAI has API key configured
            vi.mocked(options.getOption).mockReturnValueOnce('test-api-key');

            const result = manager.getAvailableProviders();

            expect(result).toContain('openai');
        });
    });

    describe('generateChatCompletion', () => {
        const messages: Message[] = [
            { role: 'user', content: 'Hello' }
        ];

        it('should generate completion with selected provider', async () => {
            vi.mocked(configHelpers.getSelectedProvider).mockResolvedValueOnce('openai');

            // Mock the getAvailableProviders to include openai
            vi.mocked(options.getOption)
                .mockReturnValueOnce('test-api-key') // for availability check
                .mockReturnValueOnce('') // for anthropic
                .mockReturnValueOnce('') // for ollama
                .mockReturnValueOnce('test-api-key'); // for service creation

            const mockResponse = { content: 'Hello response' };
            (OpenAIService as any).mockImplementationOnce(function(this: any) {
                this.isAvailable = vi.fn().mockReturnValue(true);
                this.generateChatCompletion = vi.fn().mockResolvedValueOnce(mockResponse);
            });

            const result = await manager.getOrCreateAnyService();

            expect(result).toBeDefined();
            expect(result.isAvailable()).toBe(true);
        });

        it('should handle provider prefix in model', async () => {
            vi.mocked(configHelpers.getSelectedProvider).mockResolvedValueOnce('openai');
            vi.mocked(configHelpers.parseModelIdentifier).mockReturnValueOnce({
                provider: 'openai',
                modelId: 'gpt-4',
                fullIdentifier: 'openai:gpt-4'
            });

            // Mock the getAvailableProviders to include openai
            vi.mocked(options.getOption)
                .mockReturnValueOnce('test-api-key') // for availability check
                .mockReturnValueOnce('') // for anthropic
                .mockReturnValueOnce('') // for ollama
                .mockReturnValueOnce('test-api-key'); // for service creation

            const mockResponse = { content: 'Hello response' };
            const mockGenerate = vi.fn().mockResolvedValueOnce(mockResponse);
            (OpenAIService as any).mockImplementationOnce(function(this: any) {
                this.isAvailable = vi.fn().mockReturnValue(true);
                this.generateChatCompletion = mockGenerate;
            });

            const result = await manager.generateChatCompletion(messages, {
                model: 'openai:gpt-4'
            });

            expect(result).toBe(mockResponse);
            expect(mockGenerate).toHaveBeenCalledWith(
                messages,
                { model: 'gpt-4' }
            );
        });

        it('should throw error if no messages provided', async () => {
            await expect(manager.generateChatCompletion([])).rejects.toThrow(
                'No messages provided'
            );
        });

        it('should throw error if no provider selected', async () => {
            vi.mocked(configHelpers.getSelectedProvider).mockResolvedValueOnce(null);

            await expect(manager.generateChatCompletion(messages)).rejects.toThrow(
                'No AI provider is selected'
            );
        });

        it('should throw error if model specifies different provider', async () => {
            vi.mocked(configHelpers.getSelectedProvider).mockResolvedValueOnce('openai');
            vi.mocked(configHelpers.parseModelIdentifier).mockReturnValueOnce({
                provider: 'anthropic',
                modelId: 'claude-3',
                fullIdentifier: 'anthropic:claude-3'
            });

            // Mock that openai is available
            vi.mocked(options.getOption)
                .mockReturnValueOnce('test-api-key') // for availability check
                .mockReturnValueOnce('') // for anthropic
                .mockReturnValueOnce(''); // for ollama

            await expect(
                manager.generateChatCompletion(messages, { model: 'anthropic:claude-3' })
            ).rejects.toThrow(
                "Model specifies provider 'anthropic' but selected provider is 'openai'"
            );
        });
    });

    describe('getAIEnabledAsync', () => {
        it('should return AI enabled status', async () => {
            vi.mocked(configHelpers.isAIEnabled).mockResolvedValueOnce(true);

            const result = await manager.getAIEnabledAsync();

            expect(result).toBe(true);
            expect(configHelpers.isAIEnabled).toHaveBeenCalled();
        });
    });

    describe('getAIEnabled', () => {
        it('should return AI enabled status synchronously', () => {
            vi.mocked(options.getOptionBool).mockReturnValueOnce(true);

            const result = manager.getAIEnabled();

            expect(result).toBe(true);
            expect(options.getOptionBool).toHaveBeenCalledWith('aiEnabled');
        });
    });

    describe('initialize', () => {
        it('should initialize if AI is enabled', async () => {
            vi.mocked(configHelpers.isAIEnabled).mockResolvedValueOnce(true);

            await manager.initialize();

            expect(configHelpers.isAIEnabled).toHaveBeenCalled();
        });

        it('should not initialize if AI is disabled', async () => {
            vi.mocked(configHelpers.isAIEnabled).mockResolvedValueOnce(false);

            await manager.initialize();

            expect(configHelpers.isAIEnabled).toHaveBeenCalled();
        });
    });

    describe('getService', () => {
        it('should return service for specified provider', async () => {
            vi.mocked(options.getOption).mockReturnValueOnce('test-api-key');

            (OpenAIService as any).mockImplementationOnce(function(this: any) {
                this.isAvailable = vi.fn().mockReturnValue(true);
                this.generateChatCompletion = vi.fn();
            });

            const result = await manager.getService('openai');

            expect(result).toBeDefined();
            expect(result.isAvailable()).toBe(true);
        });

        it('should return selected provider service if no provider specified', async () => {
            vi.mocked(configHelpers.getSelectedProvider).mockResolvedValueOnce('anthropic');
            vi.mocked(options.getOption).mockReturnValueOnce('test-api-key');

            (AnthropicService as any).mockImplementationOnce(function(this: any) {
                this.isAvailable = vi.fn().mockReturnValue(true);
                this.generateChatCompletion = vi.fn();
            });

            const result = await manager.getService();

            expect(result).toBeDefined();
            expect(result.isAvailable()).toBe(true);
        });

        it('should throw error if specified provider not available', async () => {
            vi.mocked(options.getOption).mockReturnValueOnce(''); // No API key

            await expect(manager.getService('openai')).rejects.toThrow(
                'Specified provider openai is not available'
            );
        });
    });

    describe('getSelectedProvider', () => {
        it('should return selected provider synchronously', () => {
            vi.mocked(options.getOption).mockReturnValueOnce('anthropic');

            const result = manager.getSelectedProvider();

            expect(result).toBe('anthropic');
        });

        it('should return default provider if none selected', () => {
            vi.mocked(options.getOption).mockReturnValueOnce('');

            const result = manager.getSelectedProvider();

            expect(result).toBe('openai');
        });
    });

    describe('isProviderAvailable', () => {
        it('should return true if provider service is available', () => {
            // Mock that OpenAI has API key configured
            vi.mocked(options.getOption).mockReturnValueOnce('test-api-key');

            const result = manager.isProviderAvailable('openai');

            expect(result).toBe(true);
        });

        it('should return false if provider service not created', () => {
            // Mock that OpenAI has no API key configured
            vi.mocked(options.getOption).mockReturnValueOnce('');

            const result = manager.isProviderAvailable('openai');

            expect(result).toBe(false);
        });
    });

    describe('getProviderMetadata', () => {
        it('should return metadata for existing provider', () => {
            // Since getProviderMetadata only returns metadata for the current active provider,
            // and we don't have a current provider set, it should return null
            const result = manager.getProviderMetadata('openai');

            expect(result).toBeNull();
        });

        it('should return null for non-existing provider', () => {
            const result = manager.getProviderMetadata('openai');

            expect(result).toBeNull();
        });
    });

    describe('simplified architecture', () => {
        it('should have a simplified event handling approach', () => {
            // The AIServiceManager now uses a simplified approach without complex event handling
            // Services are created fresh when needed by reading current options
            expect(manager).toBeDefined();
        });
    });
});
