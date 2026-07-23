import { getLog } from "@triliumnext/core";

import { AnthropicProvider } from "./providers/anthropic.js";
import { ClaudeAgentProvider } from "./providers/claude_agent.js";
import { GoogleProvider } from "./providers/google.js";
import { OllamaProvider } from "./providers/ollama.js";
import { getLlmProviderSetups } from "./provider_config.js";
import { OpenAiProvider } from "./providers/openai.js";
import type { LlmProvider, ModelInfo } from "./types.js";

/** Factory functions for creating provider instances */
const providerFactories: Record<string, (apiKey: string, baseURL?: string) => LlmProvider> = {
    anthropic: (apiKey, baseURL) => new AnthropicProvider(apiKey, baseURL),
    openai: (apiKey, baseURL) => new OpenAiProvider(apiKey, baseURL),
    google: (apiKey, baseURL) => new GoogleProvider(apiKey, baseURL),
    // Claude Pro/Max subscription via the Claude Agent SDK — no API key;
    // authentication is handled by Claude Code itself (`claude /login`).
    "claude-agent": () => new ClaudeAgentProvider(),
    // Local models via Ollama's OpenAI-compatible API — no API key needed.
    ollama: (_apiKey, baseURL) => new OllamaProvider(baseURL)
};

/** Cache of instantiated providers by their config ID */
let cachedProviders: Record<string, LlmProvider> = {};

/**
 * Get a provider instance by its configuration ID.
 * If no ID is provided, returns the first configured provider.
 */
export function getProvider(providerId?: string): LlmProvider {
    const configs = getLlmProviderSetups();

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
    const configs = getLlmProviderSetups();
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
    return getLlmProviderSetups().length > 0;
}

/**
 * Get all models from all configured providers, tagged with their provider type.
 */
export async function getAllModels(): Promise<ModelInfo[]> {
    const configs = getLlmProviderSetups();
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
            // Providers with a dynamic model list (Ollama) fetch it at runtime
            await provider.loadModels?.();
            const models = provider.getAvailableModels();
            for (const model of models) {
                allModels.push({ ...model, provider: config.provider });
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

export type { LlmProviderSetup } from "./provider_config.js";
export type { LlmProvider, LlmProviderConfig, ModelInfo, ModelPricing } from "./types.js";
