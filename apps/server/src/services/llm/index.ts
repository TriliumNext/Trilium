import { getLog, options as optionService } from "@triliumnext/core";

import { AnthropicProvider } from "./providers/anthropic.js";
import { GoogleProvider } from "./providers/google.js";
import { OpenAiProvider } from "./providers/openai.js";
import type { LlmProvider, ModelInfo } from "./types.js";

/**
 * Configuration for a single LLM provider instance.
 * This matches the structure stored in the llmProviders option.
 */
export interface LlmProviderSetup {
    id: string;
    name: string;
    provider: string;
    apiKey: string;
    /** Optional override for the SDK's default API endpoint (e.g. for self-hosted Ollama, vLLM, or proxies). */
    baseURL?: string;
    /** Optional model ID to use instead of the provider default. */
    model?: string;
}

/** Factory functions for creating provider instances */
const providerFactories: Record<string, (apiKey: string, baseURL?: string) => LlmProvider> = {
    anthropic: (apiKey, baseURL) => new AnthropicProvider(apiKey, baseURL),
    openai: (apiKey, baseURL) => new OpenAiProvider(apiKey, baseURL),
    google: (apiKey, baseURL) => new GoogleProvider(apiKey, baseURL)
};

/** Cache of instantiated providers by their config ID */
let cachedProviders: Record<string, LlmProvider> = {};

/**
 * Get configured providers from the options.
 */
function getConfiguredProviders(): LlmProviderSetup[] {
    try {
        const providersJson = optionService.getOptionOrNull("llmProviders");
        if (!providersJson) {
            return [];
        }
        return JSON.parse(providersJson) as LlmProviderSetup[];
    } catch (e) {
        getLog().error(`Failed to parse llmProviders option: ${e}`);
        return [];
    }
}

/**
 * Get a provider instance by its configuration ID.
 * If no ID is provided, returns the first configured provider.
 */
export function getProvider(providerId?: string): LlmProvider {
    const configs = getConfiguredProviders();

    if (configs.length === 0) {
        throw new Error("No LLM providers configured. Please add a provider in Options → AI / LLM.");
    }

    // Find the requested provider or use the first one
    const config = providerId
        ? configs.find(c => c.id === providerId)
        : configs[0];

    if (!config) {
        throw new Error(`LLM provider not found: ${providerId}`);
    }

    // Check cache
    if (cachedProviders[config.id]) {
        return cachedProviders[config.id];
    }

    // Create new provider instance
    const factory = providerFactories[config.provider];
    if (!factory) {
        throw new Error(`Unknown LLM provider type: ${config.provider}. Available: ${Object.keys(providerFactories).join(", ")}`);
    }

    const provider = factory(config.apiKey, config.baseURL);
    cachedProviders[config.id] = provider;
    return provider;
}

/**
 * Get the first configured provider of a specific type (e.g., "anthropic").
 */
export function getProviderByType(providerType: string): LlmProvider {
    const configs = getConfiguredProviders();
    const config = configs.find(c => c.provider === providerType);

    if (!config) {
        throw new Error(`No ${providerType} provider configured. Please add one in Options → AI / LLM.`);
    }

    return getProvider(config.id);
}

/**
 * Get the setup config for the first configured provider of a specific type.
 */
export function getProviderSetupByType(providerType: string): LlmProviderSetup | undefined {
    const configs = getConfiguredProviders();
    return configs.find(c => c.provider === providerType);
}

/**
 * Check if any providers are configured.
 */
export function hasConfiguredProviders(): boolean {
    return getConfiguredProviders().length > 0;
}

/**
 * Get all models from all configured providers, tagged with their provider type.
 */
export function getAllModels(): ModelInfo[] {
    const configs = getConfiguredProviders();
    const seenProviderTypes = new Set<string>();
    const allModels: ModelInfo[] = [];

    for (const config of configs) {
        // Only include models once per provider type (not per config instance)
        if (seenProviderTypes.has(config.provider)) {
            continue;
        }
        seenProviderTypes.add(config.provider);

        try {
            const provider = getProvider(config.id);
            const models = provider.getAvailableModels();
            const mergedModels = models.map(m => ({ ...m, provider: config.provider }));

            if (config.model) {
                const existingIndex = mergedModels.findIndex(m => m.id === config.model);
                if (existingIndex >= 0) {
                    mergedModels[existingIndex] = { ...mergedModels[existingIndex], isDefault: true };
                } else {
                    mergedModels.unshift({
                        id: config.model,
                        name: config.model,
                        provider: config.provider,
                        pricing: { input: 0, output: 0 },
                        isDefault: true
                    });
                }
            }

            for (const model of mergedModels) {
                allModels.push(model);
            }
        } catch (e) {
            getLog().error(`Failed to get models from provider ${config.provider}: ${e}`);
        }
    }

    return allModels;
}

/**
 * Clear the provider cache. Call this when provider configurations change.
 */
export function clearProviderCache(): void {
    cachedProviders = {};
}

export type { LlmProvider, LlmProviderConfig, ModelInfo, ModelPricing } from "./types.js";
