import { getLog, options as optionService } from "@triliumnext/core";

import { AnthropicProvider } from "./providers/anthropic.js";
import { ClaudeAgentProvider } from "./providers/claude_agent.js";
import { DeepSeekProvider } from "./providers/deepseek.js";
import { GoogleProvider } from "./providers/google.js";
import { LocalProvider } from "./providers/local.js";
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
    /**
     * Models the user selected for this provider, with full metadata denormalized
     * so the chat picker renders them without a live fetch. Absent in configs
     * saved before model selection existed.
     */
    selectedModels?: ModelInfo[];
}

/** Provider type identifiers that can be instantiated, for error messages. */
const PROVIDER_TYPES = ["anthropic", "openai", "google", "deepseek", "claude-agent", "ollama", "lmstudio", "openai-compatible"];

/**
 * Instantiate a provider from its type identifier.
 *
 * Deliberately a switch over literal cases rather than a lookup table: the
 * provider type is user-controlled, and looking a factory up by it — with a
 * plain object *or* a Map — makes the invoked function a value derived from
 * untrusted input, which is exactly what CodeQL's
 * `js/unvalidated-dynamic-method-call` flags. Here every branch calls a
 * statically known constructor, so no dynamic dispatch is possible at all.
 */
function createProviderInstance(provider: string, apiKey: string, baseURL?: string): LlmProvider {
    switch (provider) {
        case "anthropic":
            return new AnthropicProvider(apiKey, baseURL);
        case "openai":
            return new OpenAiProvider(apiKey, baseURL);
        case "google":
            return new GoogleProvider(apiKey, baseURL);
        // OpenAI-compatible on the wire, but carded separately from the generic
        // custom endpoint so its models resolve against the committed price table.
        case "deepseek":
            return new DeepSeekProvider(apiKey, baseURL);
        // Claude Pro/Max subscription via the Claude Agent SDK — no API key;
        // authentication is handled by Claude Code itself (`claude /login`).
        case "claude-agent":
            return new ClaudeAgentProvider();
        // Self-hosted endpoints. The three cards differ only in the URL and setup
        // hint the UI prefills; they all speak the OpenAI-compatible API, with
        // Ollama and LM Studio additionally offering a richer native listing.
        case "ollama":
        case "lmstudio":
        case "openai-compatible":
            return new LocalProvider(provider, apiKey, baseURL);
        default:
            throw new Error(`Unknown LLM provider type: ${provider}. Available: ${PROVIDER_TYPES.join(", ")}`);
    }
}

/** Cache of instantiated providers by their config ID */
let cachedProviders: Record<string, LlmProvider> = {};

/**
 * The raw llmProviders JSON the cache was built from. When the option changes
 * (provider added/edited/removed in the settings), the cache self-invalidates
 * so stale instances — and their dynamic model-list caches — are dropped.
 */
let cachedProvidersSource: string | null = null;

/**
 * Get configured providers from the options.
 */
function getConfiguredProviders(): LlmProviderSetup[] {
    try {
        const providersJson = optionService.getOptionOrNull("llmProviders");
        if (providersJson !== cachedProvidersSource) {
            cachedProviders = {};
            cachedProvidersSource = providersJson;
        }
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
    const provider = createProviderInstance(config.provider, config.apiKey, config.baseURL);
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
 * List the models available for a provider described by raw credentials —
 * used by the model-selection screen during the add/edit flow, where the
 * provider config isn't necessarily persisted yet. Instantiates the provider
 * ad-hoc (bypassing the config cache) and queries it live — a listing failure
 * (bad credentials, unreachable endpoint) propagates so the caller can surface
 * it — falling back to the curated list only when the provider doesn't support
 * dynamic listing.
 */
export async function listProviderModels(provider: string, apiKey: string, baseURL?: string): Promise<ModelInfo[]> {
    const instance = createProviderInstance(provider, apiKey, baseURL);
    const models = await (instance.listModels?.() ?? instance.getAvailableModels());
    // Tag the default-selected set here so the recommendation rule lives on the
    // server — in the provider that owns its model id shape — rather than in the
    // client picker.
    const recommended = instance.recommendedModelIds(models);
    return models.map(model => ({ ...model, recommended: recommended.has(model.id) }));
}

/**
 * Find the model a chat is targeting within its provider config's stored
 * selection — the denormalized source of display name and pricing for the
 * response's usage/cost, working even for dynamically discovered models the
 * curated list doesn't know. Returns undefined when the model isn't stored.
 */
export function getSelectedModel(providerId: string | undefined, modelId: string): ModelInfo | undefined {
    if (!providerId) {
        return undefined;
    }
    const config = getConfiguredProviders().find(c => c.id === providerId);
    return config?.selectedModels?.find(m => m.id === modelId);
}

/**
 * Clear the provider cache. Call this when provider configurations change.
 */
export function clearProviderCache(): void {
    cachedProviders = {};
    cachedProvidersSource = null;
}

export type { LlmProvider, LlmProviderConfig, ModelInfo, ModelPricing } from "./types.js";
