import options from '../../options.js';
import log from '../../log.js';
import type {
    AIConfig,
    ProviderPrecedenceConfig,
    ModelIdentifier,
    ModelConfig,
    ProviderType,
    ConfigValidationResult,
    ProviderSettings,
    OpenAISettings,
    AnthropicSettings,
    OllamaSettings,
    MiniMaxSettings
} from '../interfaces/configuration_interfaces.js';

/**
 * Configuration manager that handles conversion from string-based options
 * to proper typed configuration objects.
 *
 * This is the ONLY place where string parsing should happen for LLM configurations.
 */
export class ConfigurationManager {
    private static instance: ConfigurationManager | null = null;

    private constructor() {}

    public static getInstance(): ConfigurationManager {
        if (!ConfigurationManager.instance) {
            ConfigurationManager.instance = new ConfigurationManager();
        }
        return ConfigurationManager.instance;
    }

    /**
     * Get the complete AI configuration - always fresh, no caching
     */
    public async getAIConfig(): Promise<AIConfig> {
        try {
            const config: AIConfig = {
                enabled: await this.getAIEnabled(),
                selectedProvider: await this.getSelectedProvider(),
                defaultModels: await this.getDefaultModels(),
                providerSettings: await this.getProviderSettings()
            };

            return config;
        } catch (error) {
            log.error(`Error loading AI configuration: ${error}`);
            return this.getDefaultConfig();
        }
    }

    /**
     * Get the selected AI provider
     */
    public async getSelectedProvider(): Promise<ProviderType | null> {
        try {
            const selectedProvider = options.getOption('aiSelectedProvider');
            return selectedProvider as ProviderType || null;
        } catch (error) {
            log.error(`Error getting selected provider: ${error}`);
            return null;
        }
    }


    /**
     * Parse model identifier with optional provider prefix
     * Handles formats like "gpt-4", "openai:gpt-4", "ollama:llama2:7b"
     */
    public parseModelIdentifier(modelString: string): ModelIdentifier {
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
     * Create model configuration from string
     */
    public createModelConfig(modelString: string, defaultProvider?: ProviderType): ModelConfig {
        const identifier = this.parseModelIdentifier(modelString);
        const provider = identifier.provider || defaultProvider || 'openai';

        return {
            provider,
            modelId: identifier.modelId,
            displayName: identifier.fullIdentifier
        };
    }

    /**
      * Get default models for each provider - ONLY from user configuration
      */
    public async getDefaultModels(): Promise<Record<ProviderType, string | undefined>> {
        try {
            const openaiModel = options.getOption('openaiDefaultModel');
            const anthropicModel = options.getOption('anthropicDefaultModel');
            const ollamaModel = options.getOption('ollamaDefaultModel');
            const minimaxModel = options.getOption('minimaxDefaultModel');

            return {
                openai: openaiModel || undefined,
                anthropic: anthropicModel || undefined,
                ollama: ollamaModel || undefined,
                minimax: minimaxModel || undefined
            };
        } catch (error) {
            log.error(`Error loading default models: ${error}`);
            // Return undefined for all providers if we can't load config
            return {
                openai: undefined,
                anthropic: undefined,
                ollama: undefined,
                minimax: undefined
            };
        }
    }

    /**
      * Get provider-specific settings
      */
    public async getProviderSettings(): Promise<ProviderSettings> {
        try {
            const openaiApiKey = options.getOption('openaiApiKey');
            const openaiBaseUrl = options.getOption('openaiBaseUrl');
            const openaiDefaultModel = options.getOption('openaiDefaultModel');
            const anthropicApiKey = options.getOption('anthropicApiKey');
            const anthropicBaseUrl = options.getOption('anthropicBaseUrl');
            const anthropicDefaultModel = options.getOption('anthropicDefaultModel');
            const ollamaBaseUrl = options.getOption('ollamaBaseUrl');
            const ollamaDefaultModel = options.getOption('ollamaDefaultModel');
            const minimaxApiKey = options.getOption('minimaxApiKey');
            const minimaxBaseUrl = options.getOption('minimaxBaseUrl');
            const minimaxDefaultModel = options.getOption('minimaxDefaultModel');

            const settings: ProviderSettings = {};

            if (openaiApiKey || openaiBaseUrl || openaiDefaultModel) {
                settings.openai = {
                    apiKey: openaiApiKey,
                    baseUrl: openaiBaseUrl,
                    defaultModel: openaiDefaultModel
                };
            }

            if (anthropicApiKey || anthropicBaseUrl || anthropicDefaultModel) {
                settings.anthropic = {
                    apiKey: anthropicApiKey,
                    baseUrl: anthropicBaseUrl,
                    defaultModel: anthropicDefaultModel
                };
            }

            if (ollamaBaseUrl || ollamaDefaultModel) {
                settings.ollama = {
                    baseUrl: ollamaBaseUrl,
                    defaultModel: ollamaDefaultModel
                };
            }

            if (minimaxApiKey || minimaxBaseUrl || minimaxDefaultModel) {
                settings.minimax = {
                    apiKey: minimaxApiKey,
                    baseUrl: minimaxBaseUrl,
                    defaultModel: minimaxDefaultModel
                };
            }

            return settings;
        } catch (error) {
            log.error(`Error loading provider settings: ${error}`);
            return {};
        }
    }

    /**
     * Validate configuration
     */
    public async validateConfig(): Promise<ConfigValidationResult> {
        const result: ConfigValidationResult = {
            isValid: true,
            errors: [],
            warnings: []
        };

        try {
            const config = await this.getAIConfig();

            if (!config.enabled) {
                result.warnings.push('AI features are disabled');
                return result;
            }

            // Validate selected provider
            if (!config.selectedProvider) {
                result.errors.push('No AI provider selected');
                result.isValid = false;
            } else {
                // Validate selected provider settings
                const providerConfig = config.providerSettings[config.selectedProvider];

                if (config.selectedProvider === 'openai') {
                    const openaiConfig = providerConfig as OpenAISettings | undefined;
                    if (!openaiConfig?.apiKey) {
                        result.warnings.push('OpenAI API key is not configured');
                    }
                }

                if (config.selectedProvider === 'anthropic') {
                    const anthropicConfig = providerConfig as AnthropicSettings | undefined;
                    if (!anthropicConfig?.apiKey) {
                        result.warnings.push('Anthropic API key is not configured');
                    }
                }

                if (config.selectedProvider === 'ollama') {
                    const ollamaConfig = providerConfig as OllamaSettings | undefined;
                    if (!ollamaConfig?.baseUrl) {
                        result.warnings.push('Ollama base URL is not configured');
                    }
                }

                if (config.selectedProvider === 'minimax') {
                    const minimaxConfig = providerConfig as MiniMaxSettings | undefined;
                    if (!minimaxConfig?.apiKey) {
                        result.warnings.push('MiniMax API key is not configured');
                    }
                }
            }


        } catch (error) {
            result.errors.push(`Configuration validation error: ${error}`);
            result.isValid = false;
        }

        return result;
    }

    // Private helper methods

    private async getAIEnabled(): Promise<boolean> {
        try {
            return options.getOptionBool('aiEnabled');
        } catch {
            return false;
        }
    }

    private parseProviderList(precedenceOption: string | null): string[] {
        if (!precedenceOption) {
            // Don't assume any defaults - return empty array
            return [];
        }

        try {
            // Handle JSON array format
            if (precedenceOption.startsWith('[') && precedenceOption.endsWith(']')) {
                const parsed = JSON.parse(precedenceOption);
                if (Array.isArray(parsed)) {
                    return parsed.map(p => String(p).trim());
                }
            }

            // Handle comma-separated format
            if (precedenceOption.includes(',')) {
                return precedenceOption.split(',').map(p => p.trim());
            }

            // Handle single provider
            return [precedenceOption.trim()];

        } catch (error) {
            log.error(`Error parsing provider list "${precedenceOption}": ${error}`);
            // Don't assume defaults on parse error
            return [];
        }
    }

    private getDefaultConfig(): AIConfig {
        return {
            enabled: false,
            selectedProvider: null,
            defaultModels: {
                openai: undefined,
                anthropic: undefined,
                ollama: undefined,
                minimax: undefined
            },
            providerSettings: {}
        };
    }
}

// Export singleton instance
export default ConfigurationManager.getInstance();
