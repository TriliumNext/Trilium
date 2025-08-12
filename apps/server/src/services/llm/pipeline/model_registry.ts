/**
 * Model Registry - Phase 2.2 Implementation
 * 
 * Centralized model capability management:
 * - Model metadata and capabilities
 * - Model selection logic
 * - Cost tracking
 * - Performance characteristics
 */

import log from '../../log.js';

// Model capability interfaces
export interface ModelCapabilities {
    supportsTools: boolean;
    supportsStreaming: boolean;
    supportsVision: boolean;
    supportsJson: boolean;
    maxTokens: number;
    contextWindow: number;
    trainingCutoff?: string;
}

export interface ModelCost {
    inputTokens: number;  // Cost per 1K tokens
    outputTokens: number; // Cost per 1K tokens
    currency: 'USD';
}

export interface ModelPerformance {
    averageLatency: number;      // ms per token
    throughput: number;           // tokens per second
    reliabilityScore: number;     // 0-1 score
}

export interface ModelInfo {
    id: string;
    provider: 'openai' | 'anthropic' | 'ollama';
    displayName: string;
    family: string;
    version?: string;
    capabilities: ModelCapabilities;
    cost?: ModelCost;
    performance?: ModelPerformance;
    recommended: {
        forCoding: boolean;
        forChat: boolean;
        forAnalysis: boolean;
        forCreative: boolean;
    };
}

/**
 * Model Registry Implementation
 */
export class ModelRegistry {
    private models: Map<string, ModelInfo> = new Map();
    private initialized = false;

    constructor() {
        this.registerBuiltInModels();
    }

    /**
     * Register built-in models with their capabilities
     */
    private registerBuiltInModels(): void {
        // OpenAI Models
        this.registerModel({
            id: 'gpt-4-turbo-preview',
            provider: 'openai',
            displayName: 'GPT-4 Turbo',
            family: 'gpt-4',
            version: 'turbo-preview',
            capabilities: {
                supportsTools: true,
                supportsStreaming: true,
                supportsVision: true,
                supportsJson: true,
                maxTokens: 4096,
                contextWindow: 128000,
                trainingCutoff: '2023-12'
            },
            cost: {
                inputTokens: 0.01,
                outputTokens: 0.03,
                currency: 'USD'
            },
            performance: {
                averageLatency: 50,
                throughput: 20,
                reliabilityScore: 0.95
            },
            recommended: {
                forCoding: true,
                forChat: true,
                forAnalysis: true,
                forCreative: true
            }
        });

        this.registerModel({
            id: 'gpt-4',
            provider: 'openai',
            displayName: 'GPT-4',
            family: 'gpt-4',
            capabilities: {
                supportsTools: true,
                supportsStreaming: true,
                supportsVision: false,
                supportsJson: true,
                maxTokens: 8192,
                contextWindow: 8192,
                trainingCutoff: '2023-03'
            },
            cost: {
                inputTokens: 0.03,
                outputTokens: 0.06,
                currency: 'USD'
            },
            performance: {
                averageLatency: 70,
                throughput: 15,
                reliabilityScore: 0.98
            },
            recommended: {
                forCoding: true,
                forChat: true,
                forAnalysis: true,
                forCreative: true
            }
        });

        this.registerModel({
            id: 'gpt-3.5-turbo',
            provider: 'openai',
            displayName: 'GPT-3.5 Turbo',
            family: 'gpt-3.5',
            version: 'turbo',
            capabilities: {
                supportsTools: true,
                supportsStreaming: true,
                supportsVision: false,
                supportsJson: true,
                maxTokens: 4096,
                contextWindow: 16385,
                trainingCutoff: '2021-09'
            },
            cost: {
                inputTokens: 0.0005,
                outputTokens: 0.0015,
                currency: 'USD'
            },
            performance: {
                averageLatency: 30,
                throughput: 35,
                reliabilityScore: 0.92
            },
            recommended: {
                forCoding: false,
                forChat: true,
                forAnalysis: false,
                forCreative: false
            }
        });

        // Anthropic Models
        this.registerModel({
            id: 'claude-3-opus-20240229',
            provider: 'anthropic',
            displayName: 'Claude 3 Opus',
            family: 'claude-3',
            version: 'opus',
            capabilities: {
                supportsTools: true,
                supportsStreaming: true,
                supportsVision: true,
                supportsJson: false,
                maxTokens: 4096,
                contextWindow: 200000,
                trainingCutoff: '2023-08'
            },
            cost: {
                inputTokens: 0.015,
                outputTokens: 0.075,
                currency: 'USD'
            },
            performance: {
                averageLatency: 60,
                throughput: 18,
                reliabilityScore: 0.96
            },
            recommended: {
                forCoding: true,
                forChat: true,
                forAnalysis: true,
                forCreative: true
            }
        });

        this.registerModel({
            id: 'claude-3-sonnet-20240229',
            provider: 'anthropic',
            displayName: 'Claude 3 Sonnet',
            family: 'claude-3',
            version: 'sonnet',
            capabilities: {
                supportsTools: true,
                supportsStreaming: true,
                supportsVision: true,
                supportsJson: false,
                maxTokens: 4096,
                contextWindow: 200000,
                trainingCutoff: '2023-08'
            },
            cost: {
                inputTokens: 0.003,
                outputTokens: 0.015,
                currency: 'USD'
            },
            performance: {
                averageLatency: 40,
                throughput: 25,
                reliabilityScore: 0.94
            },
            recommended: {
                forCoding: true,
                forChat: true,
                forAnalysis: true,
                forCreative: false
            }
        });

        this.registerModel({
            id: 'claude-3-haiku-20240307',
            provider: 'anthropic',
            displayName: 'Claude 3 Haiku',
            family: 'claude-3',
            version: 'haiku',
            capabilities: {
                supportsTools: true,
                supportsStreaming: true,
                supportsVision: true,
                supportsJson: false,
                maxTokens: 4096,
                contextWindow: 200000,
                trainingCutoff: '2023-08'
            },
            cost: {
                inputTokens: 0.00025,
                outputTokens: 0.00125,
                currency: 'USD'
            },
            performance: {
                averageLatency: 20,
                throughput: 50,
                reliabilityScore: 0.90
            },
            recommended: {
                forCoding: false,
                forChat: true,
                forAnalysis: false,
                forCreative: false
            }
        });

        // Ollama Models (local, no cost)
        this.registerModel({
            id: 'llama2',
            provider: 'ollama',
            displayName: 'Llama 2',
            family: 'llama',
            version: '2',
            capabilities: {
                supportsTools: false,
                supportsStreaming: true,
                supportsVision: false,
                supportsJson: false,
                maxTokens: 2048,
                contextWindow: 4096
            },
            performance: {
                averageLatency: 100,
                throughput: 10,
                reliabilityScore: 0.85
            },
            recommended: {
                forCoding: false,
                forChat: true,
                forAnalysis: false,
                forCreative: false
            }
        });

        this.registerModel({
            id: 'codellama',
            provider: 'ollama',
            displayName: 'Code Llama',
            family: 'llama',
            version: 'code',
            capabilities: {
                supportsTools: false,
                supportsStreaming: true,
                supportsVision: false,
                supportsJson: false,
                maxTokens: 2048,
                contextWindow: 4096
            },
            performance: {
                averageLatency: 100,
                throughput: 10,
                reliabilityScore: 0.88
            },
            recommended: {
                forCoding: true,
                forChat: false,
                forAnalysis: false,
                forCreative: false
            }
        });

        this.registerModel({
            id: 'mistral',
            provider: 'ollama',
            displayName: 'Mistral',
            family: 'mistral',
            capabilities: {
                supportsTools: false,
                supportsStreaming: true,
                supportsVision: false,
                supportsJson: false,
                maxTokens: 2048,
                contextWindow: 8192
            },
            performance: {
                averageLatency: 80,
                throughput: 12,
                reliabilityScore: 0.87
            },
            recommended: {
                forCoding: false,
                forChat: true,
                forAnalysis: false,
                forCreative: false
            }
        });

        this.initialized = true;
    }

    /**
     * Register a model
     */
    registerModel(model: ModelInfo): void {
        const key = `${model.provider}:${model.id}`;
        this.models.set(key, model);
        log.info(`Registered model: ${key}`);
    }

    /**
     * Get model by ID and provider
     */
    getModel(modelId: string, provider: 'openai' | 'anthropic' | 'ollama'): ModelInfo | null {
        const key = `${provider}:${modelId}`;
        return this.models.get(key) || null;
    }

    /**
     * Get all models for a provider
     */
    getModelsForProvider(provider: 'openai' | 'anthropic' | 'ollama'): ModelInfo[] {
        const models: ModelInfo[] = [];
        this.models.forEach(model => {
            if (model.provider === provider) {
                models.push(model);
            }
        });
        return models;
    }

    /**
     * Get all registered models
     */
    getAllModels(): ModelInfo[] {
        return Array.from(this.models.values());
    }

    /**
     * Select best model for a use case
     */
    selectModelForUseCase(
        useCase: 'coding' | 'chat' | 'analysis' | 'creative',
        constraints?: {
            maxCost?: number;
            requiresTools?: boolean;
            requiresStreaming?: boolean;
            minContextWindow?: number;
            provider?: 'openai' | 'anthropic' | 'ollama';
        }
    ): ModelInfo | null {
        let candidates = this.getAllModels();

        // Filter by provider if specified
        if (constraints?.provider) {
            candidates = candidates.filter(m => m.provider === constraints.provider);
        }

        // Filter by requirements
        if (constraints?.requiresTools) {
            candidates = candidates.filter(m => m.capabilities.supportsTools);
        }
        if (constraints?.requiresStreaming) {
            candidates = candidates.filter(m => m.capabilities.supportsStreaming);
        }
        if (constraints?.minContextWindow !== undefined) {
            const minWindow = constraints.minContextWindow;
            candidates = candidates.filter(m => m.capabilities.contextWindow >= minWindow);
        }

        // Filter by cost
        if (constraints?.maxCost !== undefined) {
            candidates = candidates.filter(m => {
                if (!m.cost) return true; // Local models have no cost
                return m.cost.inputTokens <= constraints.maxCost!;
            });
        }

        // Filter by use case recommendation
        const recommendationKey = `for${useCase.charAt(0).toUpperCase()}${useCase.slice(1)}` as keyof ModelInfo['recommended'];
        candidates = candidates.filter(m => m.recommended[recommendationKey]);

        // Sort by performance and cost
        candidates.sort((a, b) => {
            // Prefer higher reliability
            const reliabilityDiff = (b.performance?.reliabilityScore || 0) - (a.performance?.reliabilityScore || 0);
            if (Math.abs(reliabilityDiff) > 0.05) return reliabilityDiff > 0 ? 1 : -1;

            // Then prefer lower cost
            const aCost = a.cost?.inputTokens || 0;
            const bCost = b.cost?.inputTokens || 0;
            return aCost - bCost;
        });

        return candidates[0] || null;
    }

    /**
     * Estimate cost for a request
     */
    estimateCost(
        modelId: string,
        provider: 'openai' | 'anthropic' | 'ollama',
        inputTokens: number,
        outputTokens: number
    ): number | null {
        const model = this.getModel(modelId, provider);
        if (!model || !model.cost) return null;

        const inputCost = (inputTokens / 1000) * model.cost.inputTokens;
        const outputCost = (outputTokens / 1000) * model.cost.outputTokens;
        
        return inputCost + outputCost;
    }

    /**
     * Check if a model supports a capability
     */
    supportsCapability(
        modelId: string,
        provider: 'openai' | 'anthropic' | 'ollama',
        capability: keyof ModelCapabilities
    ): boolean {
        const model = this.getModel(modelId, provider);
        if (!model) return false;
        
        return model.capabilities[capability] as boolean;
    }

    /**
     * Get model context window
     */
    getContextWindow(modelId: string, provider: 'openai' | 'anthropic' | 'ollama'): number {
        const model = this.getModel(modelId, provider);
        return model?.capabilities.contextWindow || 4096;
    }

    /**
     * Get model max tokens
     */
    getMaxTokens(modelId: string, provider: 'openai' | 'anthropic' | 'ollama'): number {
        const model = this.getModel(modelId, provider);
        return model?.capabilities.maxTokens || 2048;
    }

    /**
     * Check if registry is initialized
     */
    isInitialized(): boolean {
        return this.initialized;
    }

    /**
     * Add custom model (for Ollama or custom endpoints)
     */
    addCustomModel(
        modelId: string,
        provider: 'ollama',
        displayName?: string,
        capabilities?: Partial<ModelCapabilities>
    ): void {
        const defaultCapabilities: ModelCapabilities = {
            supportsTools: false,
            supportsStreaming: true,
            supportsVision: false,
            supportsJson: false,
            maxTokens: 2048,
            contextWindow: 4096
        };

        this.registerModel({
            id: modelId,
            provider,
            displayName: displayName || modelId,
            family: 'custom',
            capabilities: { ...defaultCapabilities, ...capabilities },
            recommended: {
                forCoding: false,
                forChat: true,
                forAnalysis: false,
                forCreative: false
            }
        });
    }
}

// Export singleton instance
const modelRegistry = new ModelRegistry();
export default modelRegistry;