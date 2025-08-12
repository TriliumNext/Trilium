/**
 * Provider Factory Tests
 * 
 * Comprehensive test suite for the provider factory pattern implementation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { 
    ProviderFactory, 
    ProviderType,
    type ProviderCapabilities,
    type ProviderHealthStatus,
    getProviderFactory 
} from '../provider_factory.js';
import { OpenAIService } from '../openai_service.js';
import { AnthropicService } from '../anthropic_service.js';
import { OllamaService } from '../ollama_service.js';
import type { AIService, ChatResponse } from '../../ai_interface.js';

// Mock the services
vi.mock('../openai_service.js');
vi.mock('../anthropic_service.js');
vi.mock('../ollama_service.js');
vi.mock('../../log.js', () => ({
    default: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
    }
}));

describe('ProviderFactory', () => {
    let factory: ProviderFactory;

    beforeEach(() => {
        // Clear any existing singleton
        const existingFactory = ProviderFactory.getInstance();
        if (existingFactory) {
            existingFactory.dispose();
        }

        // Create new factory instance for testing
        factory = new ProviderFactory({
            enableHealthChecks: false, // Disable for tests
            enableMetrics: false,
            cacheTimeout: 1000 // Short timeout for tests
        });
    });

    afterEach(() => {
        // Cleanup
        factory.dispose();
        vi.clearAllMocks();
    });

    describe('Provider Creation', () => {
        it('should create OpenAI provider', async () => {
            // Mock OpenAI service
            const mockService = {
                isAvailable: vi.fn().mockReturnValue(true),
                generateChatCompletion: vi.fn().mockResolvedValue({
                    content: 'test response',
                    role: 'assistant'
                })
            };
            
            (OpenAIService as any).mockImplementation(() => mockService);

            const service = await factory.createProvider(ProviderType.OPENAI);
            
            expect(service).toBeDefined();
            expect(mockService.isAvailable).toHaveBeenCalled();
        });

        it('should create Anthropic provider', async () => {
            // Mock Anthropic service
            const mockService = {
                isAvailable: vi.fn().mockReturnValue(true),
                generateChatCompletion: vi.fn().mockResolvedValue({
                    content: 'test response',
                    role: 'assistant'
                })
            };
            
            (AnthropicService as any).mockImplementation(() => mockService);

            const service = await factory.createProvider(ProviderType.ANTHROPIC);
            
            expect(service).toBeDefined();
            expect(mockService.isAvailable).toHaveBeenCalled();
        });

        it('should create Ollama provider', async () => {
            // Mock Ollama service
            const mockService = {
                isAvailable: vi.fn().mockReturnValue(true),
                generateChatCompletion: vi.fn().mockResolvedValue({
                    content: 'test response',
                    role: 'assistant'
                })
            };
            
            (OllamaService as any).mockImplementation(() => mockService);

            const service = await factory.createProvider(ProviderType.OLLAMA);
            
            expect(service).toBeDefined();
            expect(mockService.isAvailable).toHaveBeenCalled();
        });

        it('should throw error for unavailable provider', async () => {
            // Mock service as unavailable
            const mockService = {
                isAvailable: vi.fn().mockReturnValue(false)
            };
            
            (OpenAIService as any).mockImplementation(() => mockService);

            await expect(factory.createProvider(ProviderType.OPENAI))
                .rejects.toThrow('OpenAI service is not available');
        });

        it('should throw error for custom provider (not implemented)', async () => {
            await expect(factory.createProvider(ProviderType.CUSTOM))
                .rejects.toThrow('Custom providers not yet implemented');
        });
    });

    describe('Provider Caching', () => {
        it('should cache created providers', async () => {
            const mockService = {
                isAvailable: vi.fn().mockReturnValue(true),
                generateChatCompletion: vi.fn()
            };
            
            (OpenAIService as any).mockImplementation(() => mockService);

            const service1 = await factory.createProvider(ProviderType.OPENAI);
            const service2 = await factory.createProvider(ProviderType.OPENAI);
            
            // Should return same instance
            expect(service1).toBe(service2);
            
            // Constructor should only be called once
            expect(OpenAIService).toHaveBeenCalledTimes(1);
        });

        it('should respect cache timeout', async () => {
            const mockService = {
                isAvailable: vi.fn().mockReturnValue(true),
                generateChatCompletion: vi.fn()
            };
            
            (OpenAIService as any).mockImplementation(() => mockService);

            const service1 = await factory.createProvider(ProviderType.OPENAI);
            
            // Wait for cache to expire
            await new Promise(resolve => setTimeout(resolve, 1100));
            
            const service2 = await factory.createProvider(ProviderType.OPENAI);
            
            // Should create new instance after timeout
            expect(service1).not.toBe(service2);
            expect(OpenAIService).toHaveBeenCalledTimes(2);
        });

        it('should cache providers with different configurations separately', async () => {
            const mockService1 = {
                isAvailable: vi.fn().mockReturnValue(true)
            };
            const mockService2 = {
                isAvailable: vi.fn().mockReturnValue(true)
            };
            
            let callCount = 0;
            (OpenAIService as any).mockImplementation(() => {
                callCount++;
                return callCount === 1 ? mockService1 : mockService2;
            });

            const service1 = await factory.createProvider(ProviderType.OPENAI, { baseUrl: 'url1' });
            const service2 = await factory.createProvider(ProviderType.OPENAI, { baseUrl: 'url2' });
            
            expect(service1).not.toBe(service2);
            expect(OpenAIService).toHaveBeenCalledTimes(2);
        });
    });

    describe('Capabilities Detection', () => {
        it('should return default capabilities for providers', () => {
            const openAICaps = factory.getCapabilities(ProviderType.OPENAI);
            
            expect(openAICaps).toBeDefined();
            expect(openAICaps?.streaming).toBe(true);
            expect(openAICaps?.functionCalling).toBe(true);
            expect(openAICaps?.vision).toBe(true);
            expect(openAICaps?.contextWindow).toBe(128000);
        });

        it('should allow registering custom capabilities', () => {
            const customCaps: ProviderCapabilities = {
                streaming: false,
                functionCalling: false,
                vision: false,
                contextWindow: 2048,
                maxOutputTokens: 512,
                supportsSystemPrompt: false,
                supportsTools: false,
                supportedModalities: ['text'],
                customEndpoints: true,
                batchProcessing: false
            };

            factory.registerCapabilities(ProviderType.CUSTOM, customCaps);
            
            const retrieved = factory.getCapabilities(ProviderType.CUSTOM);
            expect(retrieved).toEqual(customCaps);
        });
    });

    describe('Health Checks', () => {
        it('should perform health check on provider', async () => {
            const mockService = {
                isAvailable: vi.fn().mockReturnValue(true),
                generateChatCompletion: vi.fn().mockResolvedValue({
                    content: 'Hi',
                    role: 'assistant'
                })
            };
            
            (OpenAIService as any).mockImplementation(() => mockService);

            const health = await factory.checkProviderHealth(ProviderType.OPENAI);
            
            expect(health.provider).toBe(ProviderType.OPENAI);
            expect(health.healthy).toBe(true);
            expect(health.lastChecked).toBeInstanceOf(Date);
            expect(health.latency).toBeDefined();
        });

        it('should report unhealthy provider on error', async () => {
            const mockService = {
                isAvailable: vi.fn().mockReturnValue(true),
                generateChatCompletion: vi.fn().mockRejectedValue(new Error('API Error'))
            };
            
            (OpenAIService as any).mockImplementation(() => mockService);

            const health = await factory.checkProviderHealth(ProviderType.OPENAI);
            
            expect(health.provider).toBe(ProviderType.OPENAI);
            expect(health.healthy).toBe(false);
            expect(health.error).toBe('API Error');
        });

        it('should store health status', async () => {
            const mockService = {
                isAvailable: vi.fn().mockReturnValue(true),
                generateChatCompletion: vi.fn().mockResolvedValue({
                    content: 'Hi',
                    role: 'assistant'
                })
            };
            
            (OpenAIService as any).mockImplementation(() => mockService);

            await factory.checkProviderHealth(ProviderType.OPENAI);
            
            const status = factory.getHealthStatus(ProviderType.OPENAI);
            expect(status).toBeDefined();
            expect(status?.healthy).toBe(true);
        });
    });

    describe('Fallback Mechanism', () => {
        it('should fallback to alternative provider on failure', async () => {
            // Create factory with fallback enabled
            const fallbackFactory = new ProviderFactory({
                enableHealthChecks: false,
                enableFallback: true,
                fallbackProviders: [ProviderType.OLLAMA],
                enableCaching: false
            });

            // Mock OpenAI to fail
            (OpenAIService as any).mockImplementation(() => {
                throw new Error('OpenAI unavailable');
            });

            // Mock Ollama to succeed
            const mockOllamaService = {
                isAvailable: vi.fn().mockReturnValue(true),
                generateChatCompletion: vi.fn()
            };
            (OllamaService as any).mockImplementation(() => mockOllamaService);

            // Should fallback to Ollama
            const service = await fallbackFactory.createProvider(ProviderType.OPENAI);
            
            expect(service).toBeDefined();
            expect(OllamaService).toHaveBeenCalled();

            fallbackFactory.dispose();
        });
    });

    describe('Statistics', () => {
        it('should track usage statistics', async () => {
            const mockService = {
                isAvailable: vi.fn().mockReturnValue(true),
                generateChatCompletion: vi.fn()
            };
            
            (OpenAIService as any).mockImplementation(() => mockService);

            // Create providers
            await factory.createProvider(ProviderType.OPENAI);
            await factory.createProvider(ProviderType.OPENAI); // Uses cache

            const stats = factory.getStatistics();
            
            expect(stats.cachedProviders).toBe(1);
            expect(stats.totalUsage).toBe(2); // Created once, used twice
            expect(stats.providerUsage['openai']).toBe(2);
        });
    });

    describe('Cache Management', () => {
        it('should clear all cached providers', async () => {
            const mockService = {
                isAvailable: vi.fn().mockReturnValue(true),
                dispose: vi.fn()
            };
            
            (OpenAIService as any).mockImplementation(() => mockService);
            (AnthropicService as any).mockImplementation(() => mockService);

            // Create multiple providers
            await factory.createProvider(ProviderType.OPENAI);
            await factory.createProvider(ProviderType.ANTHROPIC);

            const statsBefore = factory.getStatistics();
            expect(statsBefore.cachedProviders).toBe(2);

            factory.clearCache();

            const statsAfter = factory.getStatistics();
            expect(statsAfter.cachedProviders).toBe(0);
            expect(mockService.dispose).toHaveBeenCalledTimes(2);
        });

        it('should cleanup expired cache entries', async () => {
            const mockService = {
                isAvailable: vi.fn().mockReturnValue(true),
                dispose: vi.fn()
            };
            
            (OpenAIService as any).mockImplementation(() => mockService);

            await factory.createProvider(ProviderType.OPENAI);
            
            // Wait for cache to expire
            await new Promise(resolve => setTimeout(resolve, 1100));
            
            factory.cleanupExpiredCache();
            
            const stats = factory.getStatistics();
            expect(stats.cachedProviders).toBe(0);
            expect(mockService.dispose).toHaveBeenCalled();
        });
    });

    describe('Singleton Pattern', () => {
        it('should return same instance via getInstance', () => {
            const instance1 = ProviderFactory.getInstance();
            const instance2 = ProviderFactory.getInstance();
            
            expect(instance1).toBe(instance2);
            
            instance1.dispose();
        });

        it('should create new instance after disposal', () => {
            const instance1 = ProviderFactory.getInstance();
            instance1.dispose();
            
            const instance2 = ProviderFactory.getInstance();
            
            expect(instance1).not.toBe(instance2);
            
            instance2.dispose();
        });
    });

    describe('Error Handling', () => {
        it('should handle provider creation errors gracefully', async () => {
            (OpenAIService as any).mockImplementation(() => {
                throw new Error('Constructor error');
            });

            await expect(factory.createProvider(ProviderType.OPENAI))
                .rejects.toThrow('Constructor error');
        });

        it('should throw error when factory is disposed', async () => {
            factory.dispose();
            
            await expect(factory.createProvider(ProviderType.OPENAI))
                .rejects.toThrow('ProviderFactory has been disposed');
        });
    });
});

describe('getProviderFactory Helper', () => {
    it('should return factory instance', () => {
        const factory = getProviderFactory();
        
        expect(factory).toBeInstanceOf(ProviderFactory);
        
        factory.dispose();
    });

    it('should pass options to factory', () => {
        const factory = getProviderFactory({
            enableHealthChecks: false,
            enableMetrics: false
        });
        
        expect(factory).toBeInstanceOf(ProviderFactory);
        
        factory.dispose();
    });
});