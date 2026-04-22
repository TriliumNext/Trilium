import type { LlmProvider, ModelInfo } from "./types.js";
import { AnthropicProvider } from "./providers/anthropic.js";
import { GoogleProvider } from "./providers/google.js";
import { OpenAiProvider } from "./providers/openai.js";
import optionService from "../options.js";
import log from "../log.js";

/**
 * Configuration for a single LLM provider instance.
 * This matches the structure stored in the llmProviders option.
 */
export interface LlmProviderSetup {
    id: string;
    name: string;
    provider: string;
    apiKey: string;
}

/** Factory functions for creating provider instances */
const providerFactories: Record<string, (apiKey: string) => LlmProvider> = {
    anthropic: (apiKey) => new AnthropicProvider(apiKey),
    openai: (apiKey) => new OpenAiProvider(apiKey),
    google: (apiKey) => new GoogleProvider(apiKey)
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
        log.error(`Failed to parse llmProviders option: ${e}`);
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

    const provider = factory(config.apiKey);
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
            for (const model of models) {
                allModels.push({ ...model, provider: config.provider });
            }
        } catch (e) {
            log.error(`Failed to get models from provider ${config.provider}: ${e}`);
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
