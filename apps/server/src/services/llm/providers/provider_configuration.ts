/**
 * Enhanced Provider Configuration
 * 
 * Provides advanced configuration options for AI service providers,
 * including custom endpoints, model detection, and optimization settings.
 */

import log from '../../log.js';
import options from '../../options.js';
import type { ModelMetadata } from './provider_options.js';

/**
 * Provider configuration with enhanced settings
 */
export interface EnhancedProviderConfig {
    // Basic settings
    provider: 'openai' | 'anthropic' | 'ollama' | 'custom';
    apiKey?: string;
    baseUrl?: string;
    
    // Advanced settings
    customHeaders?: Record<string, string>;
    timeout?: number;
    maxRetries?: number;
    retryDelay?: number;
    proxy?: string;
    
    // Model settings
    defaultModel?: string;
    availableModels?: string[];
    modelAliases?: Record<string, string>;
    
    // Performance settings
    maxConcurrentRequests?: number;
    requestQueueSize?: number;
    rateLimitPerMinute?: number;
    
    // Feature flags
    enableStreaming?: boolean;
    enableTools?: boolean;
    enableVision?: boolean;
    enableCaching?: boolean;
    
    // Custom endpoints
    endpoints?: {
        chat?: string;
        completions?: string;
        embeddings?: string;
        models?: string;
        health?: string;
    };
    
    // Optimization settings
    optimization?: {
        batchSize?: number;
        cacheTimeout?: number;
        compressionEnabled?: boolean;
        connectionPoolSize?: number;
    };
}

/**
 * Model information with detailed capabilities
 */
export interface ModelInfo {
    id: string;
    name: string;
    provider: string;
    contextWindow: number;
    maxOutputTokens: number;
    supportedModalities: string[];
    costPerMillion?: {
        input: number;
        output: number;
    };
    capabilities: {
        chat: boolean;
        completion: boolean;
        embedding: boolean;
        functionCalling: boolean;
        vision: boolean;
        audio: boolean;
        streaming: boolean;
    };
    performance?: {
        averageLatency?: number;
        tokensPerSecond?: number;
    };
}

/**
 * Provider configuration manager
 */
export class ProviderConfigurationManager {
    private configs: Map<string, EnhancedProviderConfig> = new Map();
    private modelRegistry: Map<string, ModelInfo> = new Map();
    private modelCache: Map<string, ModelInfo[]> = new Map();
    private lastModelFetch: Map<string, number> = new Map();
    private readonly MODEL_CACHE_TTL = 3600000; // 1 hour

    constructor() {
        this.initializeDefaultConfigs();
        this.initializeModelRegistry();
    }

    /**
     * Initialize default provider configurations
     */
    private initializeDefaultConfigs(): void {
        // OpenAI configuration
        this.configs.set('openai', {
            provider: 'openai',
            baseUrl: 'https://api.openai.com/v1',
            timeout: 60000,
            maxRetries: 3,
            retryDelay: 1000,
            enableStreaming: true,
            enableTools: true,
            enableVision: true,
            enableCaching: true,
            endpoints: {
                chat: '/chat/completions',
                completions: '/completions',
                embeddings: '/embeddings',
                models: '/models'
            },
            optimization: {
                batchSize: 10,
                cacheTimeout: 300000,
                compressionEnabled: true,
                connectionPoolSize: 10
            }
        });

        // Anthropic configuration
        this.configs.set('anthropic', {
            provider: 'anthropic',
            baseUrl: 'https://api.anthropic.com',
            timeout: 60000,
            maxRetries: 3,
            retryDelay: 1000,
            enableStreaming: true,
            enableTools: true,
            enableVision: true,
            enableCaching: true,
            endpoints: {
                chat: '/v1/messages'
            },
            optimization: {
                batchSize: 5,
                cacheTimeout: 300000,
                compressionEnabled: true,
                connectionPoolSize: 5
            }
        });

        // Ollama configuration
        this.configs.set('ollama', {
            provider: 'ollama',
            baseUrl: 'http://localhost:11434',
            timeout: 120000, // Longer timeout for local models
            maxRetries: 2,
            retryDelay: 500,
            enableStreaming: true,
            enableTools: true,
            enableVision: false,
            enableCaching: true,
            endpoints: {
                chat: '/api/chat',
                models: '/api/tags'
            },
            optimization: {
                batchSize: 1, // Local processing, no batching
                cacheTimeout: 600000,
                compressionEnabled: false,
                connectionPoolSize: 2
            }
        });
    }

    /**
     * Initialize model registry with known models
     */
    private initializeModelRegistry(): void {
        // OpenAI models
        this.registerModel({
            id: 'gpt-4-turbo-preview',
            name: 'GPT-4 Turbo',
            provider: 'openai',
            contextWindow: 128000,
            maxOutputTokens: 4096,
            supportedModalities: ['text', 'image'],
            costPerMillion: {
                input: 10,
                output: 30
            },
            capabilities: {
                chat: true,
                completion: false,
                embedding: false,
                functionCalling: true,
                vision: true,
                audio: false,
                streaming: true
            }
        });

        this.registerModel({
            id: 'gpt-4o',
            name: 'GPT-4 Omni',
            provider: 'openai',
            contextWindow: 128000,
            maxOutputTokens: 4096,
            supportedModalities: ['text', 'image', 'audio'],
            costPerMillion: {
                input: 5,
                output: 15
            },
            capabilities: {
                chat: true,
                completion: false,
                embedding: false,
                functionCalling: true,
                vision: true,
                audio: true,
                streaming: true
            }
        });

        this.registerModel({
            id: 'gpt-3.5-turbo',
            name: 'GPT-3.5 Turbo',
            provider: 'openai',
            contextWindow: 16385,
            maxOutputTokens: 4096,
            supportedModalities: ['text'],
            costPerMillion: {
                input: 0.5,
                output: 1.5
            },
            capabilities: {
                chat: true,
                completion: false,
                embedding: false,
                functionCalling: true,
                vision: false,
                audio: false,
                streaming: true
            }
        });

        // Anthropic models
        this.registerModel({
            id: 'claude-3-opus-20240229',
            name: 'Claude 3 Opus',
            provider: 'anthropic',
            contextWindow: 200000,
            maxOutputTokens: 4096,
            supportedModalities: ['text', 'image'],
            costPerMillion: {
                input: 15,
                output: 75
            },
            capabilities: {
                chat: true,
                completion: false,
                embedding: false,
                functionCalling: true,
                vision: true,
                audio: false,
                streaming: true
            }
        });

        this.registerModel({
            id: 'claude-3-sonnet-20240229',
            name: 'Claude 3 Sonnet',
            provider: 'anthropic',
            contextWindow: 200000,
            maxOutputTokens: 4096,
            supportedModalities: ['text', 'image'],
            costPerMillion: {
                input: 3,
                output: 15
            },
            capabilities: {
                chat: true,
                completion: false,
                embedding: false,
                functionCalling: true,
                vision: true,
                audio: false,
                streaming: true
            }
        });

        this.registerModel({
            id: 'claude-3-haiku-20240307',
            name: 'Claude 3 Haiku',
            provider: 'anthropic',
            contextWindow: 200000,
            maxOutputTokens: 4096,
            supportedModalities: ['text', 'image'],
            costPerMillion: {
                input: 0.25,
                output: 1.25
            },
            capabilities: {
                chat: true,
                completion: false,
                embedding: false,
                functionCalling: true,
                vision: true,
                audio: false,
                streaming: true
            }
        });

        // Common Ollama models (defaults, actual specs depend on local models)
        this.registerModel({
            id: 'llama3',
            name: 'Llama 3',
            provider: 'ollama',
            contextWindow: 8192,
            maxOutputTokens: 2048,
            supportedModalities: ['text'],
            capabilities: {
                chat: true,
                completion: true,
                embedding: false,
                functionCalling: true,
                vision: false,
                audio: false,
                streaming: true
            }
        });

        this.registerModel({
            id: 'mixtral',
            name: 'Mixtral',
            provider: 'ollama',
            contextWindow: 32768,
            maxOutputTokens: 4096,
            supportedModalities: ['text'],
            capabilities: {
                chat: true,
                completion: true,
                embedding: false,
                functionCalling: true,
                vision: false,
                audio: false,
                streaming: true
            }
        });
    }

    /**
     * Register a model in the registry
     */
    public registerModel(model: ModelInfo): void {
        this.modelRegistry.set(model.id, model);
        
        // Also register by provider
        const providerModels = this.modelCache.get(model.provider) || [];
        if (!providerModels.some(m => m.id === model.id)) {
            providerModels.push(model);
            this.modelCache.set(model.provider, providerModels);
        }
    }

    /**
     * Get configuration for a provider
     */
    public getProviderConfig(provider: string): EnhancedProviderConfig | undefined {
        // First check if we have a stored config
        let config = this.configs.get(provider);
        
        if (!config) {
            // Try to build config from options
            config = this.buildConfigFromOptions(provider);
            if (config) {
                this.configs.set(provider, config);
            }
        }
        
        return config;
    }

    /**
     * Build configuration from Trilium options
     */
    private buildConfigFromOptions(provider: string): EnhancedProviderConfig | undefined {
        switch (provider) {
            case 'openai': {
                const apiKey = options.getOption('openaiApiKey');
                const baseUrl = options.getOption('openaiBaseUrl');
                const defaultModel = options.getOption('openaiDefaultModel');
                
                if (!apiKey && !baseUrl) return undefined;
                
                return {
                    ...this.configs.get('openai')!,
                    apiKey,
                    baseUrl: baseUrl || this.configs.get('openai')!.baseUrl,
                    defaultModel
                };
            }
            
            case 'anthropic': {
                const apiKey = options.getOption('anthropicApiKey');
                const baseUrl = options.getOption('anthropicBaseUrl');
                const defaultModel = options.getOption('anthropicDefaultModel');
                
                if (!apiKey) return undefined;
                
                return {
                    ...this.configs.get('anthropic')!,
                    apiKey,
                    baseUrl: baseUrl || this.configs.get('anthropic')!.baseUrl,
                    defaultModel
                };
            }
            
            case 'ollama': {
                const baseUrl = options.getOption('ollamaBaseUrl');
                const defaultModel = options.getOption('ollamaDefaultModel');
                
                if (!baseUrl) return undefined;
                
                return {
                    ...this.configs.get('ollama')!,
                    baseUrl,
                    defaultModel
                };
            }
            
            default:
                return undefined;
        }
    }

    /**
     * Update provider configuration
     */
    public updateProviderConfig(provider: string, config: Partial<EnhancedProviderConfig>): void {
        const existing = this.getProviderConfig(provider) || { provider: provider as any };
        this.configs.set(provider, { ...existing, ...config });
    }

    /**
     * Get available models for a provider
     */
    public async getAvailableModels(provider: string): Promise<ModelInfo[]> {
        // Check cache first
        const cached = this.modelCache.get(provider);
        const lastFetch = this.lastModelFetch.get(provider) || 0;
        
        if (cached && Date.now() - lastFetch < this.MODEL_CACHE_TTL) {
            return cached;
        }
        
        // Try to fetch fresh model list
        try {
            const models = await this.fetchProviderModels(provider);
            this.modelCache.set(provider, models);
            this.lastModelFetch.set(provider, Date.now());
            return models;
        } catch (error) {
            log.info(`Failed to fetch models for ${provider}: ${error}`);
            
            // Return cached if available, otherwise registry models
            return cached || Array.from(this.modelRegistry.values())
                .filter(m => m.provider === provider);
        }
    }

    /**
     * Fetch models from provider API
     */
    private async fetchProviderModels(provider: string): Promise<ModelInfo[]> {
        const config = this.getProviderConfig(provider);
        if (!config) {
            throw new Error(`No configuration for provider: ${provider}`);
        }
        
        switch (provider) {
            case 'openai':
                return this.fetchOpenAIModels(config);
            
            case 'ollama':
                return this.fetchOllamaModels(config);
            
            case 'anthropic':
                // Anthropic doesn't have a models endpoint, use registry
                return Array.from(this.modelRegistry.values())
                    .filter(m => m.provider === 'anthropic');
            
            default:
                return [];
        }
    }

    /**
     * Fetch OpenAI models
     */
    private async fetchOpenAIModels(config: EnhancedProviderConfig): Promise<ModelInfo[]> {
        try {
            const url = `${config.baseUrl}${config.endpoints?.models || '/models'}`;
            const response = await fetch(url, {
                headers: {
                    'Authorization': `Bearer ${config.apiKey}`,
                    ...config.customHeaders
                }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.json();
            
            return data.data.map((model: any) => {
                // Check if we have detailed info in registry
                const registered = this.modelRegistry.get(model.id);
                if (registered) {
                    return registered;
                }
                
                // Create basic model info
                return {
                    id: model.id,
                    name: model.id,
                    provider: 'openai',
                    contextWindow: 4096, // Default
                    maxOutputTokens: 4096,
                    supportedModalities: ['text'],
                    capabilities: {
                        chat: model.id.includes('gpt'),
                        completion: !model.id.includes('gpt'),
                        embedding: model.id.includes('embedding'),
                        functionCalling: model.id.includes('gpt'),
                        vision: model.id.includes('vision'),
                        audio: model.id.includes('whisper'),
                        streaming: true
                    }
                } as ModelInfo;
            });
        } catch (error) {
            log.error(`Failed to fetch OpenAI models: ${error}`);
            throw error;
        }
    }

    /**
     * Fetch Ollama models
     */
    private async fetchOllamaModels(config: EnhancedProviderConfig): Promise<ModelInfo[]> {
        try {
            const url = `${config.baseUrl}${config.endpoints?.models || '/api/tags'}`;
            const response = await fetch(url);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.json();
            
            return data.models.map((model: any) => {
                // Check if we have detailed info in registry
                const registered = this.modelRegistry.get(model.name);
                if (registered) {
                    return registered;
                }
                
                // Create basic model info from Ollama data
                return {
                    id: model.name,
                    name: model.name,
                    provider: 'ollama',
                    contextWindow: model.details?.parameter_size || 4096,
                    maxOutputTokens: 2048,
                    supportedModalities: ['text'],
                    capabilities: {
                        chat: true,
                        completion: true,
                        embedding: model.name.includes('embed'),
                        functionCalling: true,
                        vision: model.name.includes('vision') || model.name.includes('llava'),
                        audio: false,
                        streaming: true
                    },
                    performance: {
                        tokensPerSecond: model.details?.tokens_per_second
                    }
                } as ModelInfo;
            });
        } catch (error) {
            log.error(`Failed to fetch Ollama models: ${error}`);
            throw error;
        }
    }

    /**
     * Get model information
     */
    public getModelInfo(modelId: string): ModelInfo | undefined {
        return this.modelRegistry.get(modelId);
    }

    /**
     * Detect best model for a use case
     */
    public detectBestModel(
        provider: string,
        requirements: {
            minContextWindow?: number;
            needsVision?: boolean;
            needsTools?: boolean;
            maxCostPerMillion?: number;
            preferFast?: boolean;
        }
    ): ModelInfo | undefined {
        const models = Array.from(this.modelRegistry.values())
            .filter(m => m.provider === provider);
        
        // Filter by requirements
        let candidates = models.filter(m => {
            if (requirements.minContextWindow && m.contextWindow < requirements.minContextWindow) {
                return false;
            }
            if (requirements.needsVision && !m.capabilities.vision) {
                return false;
            }
            if (requirements.needsTools && !m.capabilities.functionCalling) {
                return false;
            }
            if (requirements.maxCostPerMillion && m.costPerMillion) {
                const avgCost = (m.costPerMillion.input + m.costPerMillion.output) / 2;
                if (avgCost > requirements.maxCostPerMillion) {
                    return false;
                }
            }
            return true;
        });
        
        if (candidates.length === 0) {
            return undefined;
        }
        
        // Sort by preference
        if (requirements.preferFast) {
            // Prefer smaller, faster models
            candidates.sort((a, b) => {
                const costA = a.costPerMillion ? (a.costPerMillion.input + a.costPerMillion.output) / 2 : 1000;
                const costB = b.costPerMillion ? (b.costPerMillion.input + b.costPerMillion.output) / 2 : 1000;
                return costA - costB;
            });
        } else {
            // Prefer more capable models
            candidates.sort((a, b) => b.contextWindow - a.contextWindow);
        }
        
        return candidates[0];
    }

    /**
     * Validate provider configuration
     */
    public validateConfig(config: EnhancedProviderConfig): {
        valid: boolean;
        errors: string[];
        warnings: string[];
    } {
        const errors: string[] = [];
        const warnings: string[] = [];
        
        // Check required fields
        if (!config.provider) {
            errors.push('Provider type is required');
        }
        
        // Provider-specific validation
        switch (config.provider) {
            case 'openai':
            case 'anthropic':
                if (!config.apiKey && !config.baseUrl?.includes('localhost')) {
                    errors.push('API key is required for cloud providers');
                }
                break;
            
            case 'ollama':
                if (!config.baseUrl) {
                    errors.push('Base URL is required for Ollama');
                }
                break;
        }
        
        // Validate URLs
        if (config.baseUrl) {
            try {
                new URL(config.baseUrl);
            } catch {
                errors.push('Invalid base URL format');
            }
        }
        
        // Validate timeout
        if (config.timeout && config.timeout < 1000) {
            warnings.push('Timeout less than 1 second may cause issues');
        }
        
        // Validate rate limits
        if (config.rateLimitPerMinute && config.rateLimitPerMinute < 1) {
            errors.push('Rate limit must be at least 1 request per minute');
        }
        
        return {
            valid: errors.length === 0,
            errors,
            warnings
        };
    }

    /**
     * Export configuration as JSON
     */
    public exportConfig(provider: string): string {
        const config = this.getProviderConfig(provider);
        if (!config) {
            throw new Error(`No configuration for provider: ${provider}`);
        }
        
        // Remove sensitive data
        const exported = { ...config };
        if (exported.apiKey) {
            exported.apiKey = '***REDACTED***';
        }
        
        return JSON.stringify(exported, null, 2);
    }

    /**
     * Import configuration from JSON
     */
    public importConfig(provider: string, json: string): void {
        try {
            const config = JSON.parse(json) as EnhancedProviderConfig;
            
            // Validate before importing
            const validation = this.validateConfig(config);
            if (!validation.valid) {
                throw new Error(`Invalid configuration: ${validation.errors.join(', ')}`);
            }
            
            // Don't import if API key is redacted
            if (config.apiKey === '***REDACTED***') {
                delete config.apiKey;
            }
            
            this.updateProviderConfig(provider, config);
            log.info(`Imported configuration for ${provider}`);
        } catch (error) {
            log.error(`Failed to import configuration: ${error}`);
            throw error;
        }
    }
}

// Export singleton instance
export const providerConfigManager = new ProviderConfigurationManager();