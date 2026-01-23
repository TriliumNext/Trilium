import optionService from '../../options.js';
import log from '../../log.js';
import type {
    ProviderType,
    ModelIdentifier,
    ModelConfig,
} from '../interfaces/configuration_interfaces.js';

/**
 * Helper functions for accessing AI configuration without string parsing
 * Use these throughout the codebase instead of parsing strings directly
 */

/**
 * Get the selected AI provider - always fresh from options
 */
export async function getSelectedProvider(): Promise<ProviderType | null> {
    const providerOption = optionService.getOption('aiSelectedProvider');
    return providerOption as ProviderType || null;
}


/**
 * Parse a model identifier (handles "provider:model" format)
 */
export function parseModelIdentifier(modelString: string): ModelIdentifier {
    if (!modelString) {
        return {
            modelId: '',
            fullIdentifier: ''
        };
    }

    const parts = modelString.split(':');

    if (parts.length === 1) {
        // No provider prefix, just model name
        return {
            modelId: modelString,
            fullIdentifier: modelString
        };
    }

    // Check if first part is a known provider
    const potentialProvider = parts[0].toLowerCase();
    const knownProviders: ProviderType[] = ['openai', 'anthropic', 'ollama', 'minimax'];

    if (knownProviders.includes(potentialProvider as ProviderType)) {
        // Provider prefix format
        const provider = potentialProvider as ProviderType;
        const modelId = parts.slice(1).join(':'); // Rejoin in case model has colons

        return {
            provider,
            modelId,
            fullIdentifier: modelString
        };
    }

    // Not a provider prefix, treat whole string as model name
    return {
        modelId: modelString,
        fullIdentifier: modelString
    };
}

/**
 * Create a model configuration from a model string
 */
export function createModelConfig(modelString: string, defaultProvider?: ProviderType): ModelConfig {
    const identifier = parseModelIdentifier(modelString);
    const provider = identifier.provider || defaultProvider || 'openai'; // fallback to openai if no provider specified

    return {
        provider,
        modelId: identifier.modelId,
        displayName: identifier.fullIdentifier
    };
}

/**
 * Get the default model for a specific provider - always fresh from options
 */
export async function getDefaultModelForProvider(provider: ProviderType): Promise<string | undefined> {
    const optionKey = `${provider}DefaultModel` as const;
    return optionService.getOption(optionKey) || undefined;
}

/**
  * Get provider settings for a specific provider - always fresh from options
  */
export async function getProviderSettings(provider: ProviderType) {
    switch (provider) {
        case 'openai':
            return {
                apiKey: optionService.getOption('openaiApiKey'),
                baseUrl: optionService.getOption('openaiBaseUrl'),
                defaultModel: optionService.getOption('openaiDefaultModel')
            };
        case 'anthropic':
            return {
                apiKey: optionService.getOption('anthropicApiKey'),
                baseUrl: optionService.getOption('anthropicBaseUrl'),
                defaultModel: optionService.getOption('anthropicDefaultModel')
            };
        case 'ollama':
            return {
                baseUrl: optionService.getOption('ollamaBaseUrl'),
                defaultModel: optionService.getOption('ollamaDefaultModel')
            };
        case 'minimax':
            return {
                apiKey: optionService.getOption('minimaxApiKey'),
                baseUrl: optionService.getOption('minimaxBaseUrl'),
                defaultModel: optionService.getOption('minimaxDefaultModel')
            };
        default:
            return {};
    }
}

/**
 * Check if AI is enabled - always fresh from options
 */
export async function isAIEnabled(): Promise<boolean> {
    return optionService.getOptionBool('aiEnabled');
}

/**
  * Check if a provider has required configuration
  */
export async function isProviderConfigured(provider: ProviderType): Promise<boolean> {
    const settings = await getProviderSettings(provider);

    switch (provider) {
        case 'openai':
            return Boolean((settings as any)?.apiKey);
        case 'anthropic':
            return Boolean((settings as any)?.apiKey);
        case 'ollama':
            return Boolean((settings as any)?.baseUrl);
        case 'minimax':
            return Boolean((settings as any)?.apiKey);
        default:
            return false;
    }
}

/**
 * Get the currently selected provider if it's available and configured
 */
export async function getAvailableSelectedProvider(): Promise<ProviderType | null> {
    const selectedProvider = await getSelectedProvider();

    if (!selectedProvider) {
        return null; // No provider selected
    }

    if (await isProviderConfigured(selectedProvider)) {
        return selectedProvider;
    }

    return null; // Selected provider is not properly configured
}

/**
 * Validate the current AI configuration - simplified validation
 */
export async function validateConfiguration() {
    const result = {
        isValid: true,
        errors: [] as string[],
        warnings: [] as string[]
    };

    const aiEnabled = await isAIEnabled();
    if (!aiEnabled) {
        result.warnings.push('AI features are disabled');
        return result;
    }

    const selectedProvider = await getSelectedProvider();
    if (!selectedProvider) {
        result.errors.push('No AI provider selected');
        result.isValid = false;
        return result;
    }

    // Validate provider-specific settings
    const settings = await getProviderSettings(selectedProvider);

    if (selectedProvider === 'openai' && !(settings as any)?.apiKey) {
        result.warnings.push('OpenAI API key is not configured');
    }

    if (selectedProvider === 'anthropic' && !(settings as any)?.apiKey) {
        result.warnings.push('Anthropic API key is not configured');
    }

    if (selectedProvider === 'ollama' && !(settings as any)?.baseUrl) {
        result.warnings.push('Ollama base URL is not configured');
    }

    if (selectedProvider === 'minimax' && !(settings as any)?.apiKey) {
        result.warnings.push('MiniMax API key is not configured');
    }

    return result;
}

/**
 * Clear cached configuration (no-op since we removed caching)
 */
export function clearConfigurationCache(): void {
    // No caching anymore, so nothing to clear
}

/**
 * Get a model configuration with validation that no defaults are assumed
 */
export async function getValidModelConfig(provider: ProviderType): Promise<{ model: string; provider: ProviderType } | null> {
    const defaultModel = await getDefaultModelForProvider(provider);

    if (!defaultModel) {
        // No default model configured for this provider
        return null;
    }

    const isConfigured = await isProviderConfigured(provider);
    if (!isConfigured) {
        // Provider is not properly configured
        return null;
    }

    return {
        model: defaultModel,
        provider
    };
}

/**
 * Get the model configuration for the currently selected provider
 */
export async function getSelectedModelConfig(): Promise<{ model: string; provider: ProviderType } | null> {
    const selectedProvider = await getSelectedProvider();

    if (!selectedProvider) {
        return null; // No provider selected
    }

    return await getValidModelConfig(selectedProvider);
}

