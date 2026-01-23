/**
 * Configuration interfaces for LLM services
 * These interfaces replace string parsing with proper typed objects
 */

/**
 * Provider precedence configuration
 */
export interface ProviderPrecedenceConfig {
    providers: ProviderType[];
    defaultProvider?: ProviderType;
}

/**
 * Model configuration with provider information
 */
export interface ModelConfig {
    provider: ProviderType;
    modelId: string;
    displayName?: string;
    capabilities?: ModelCapabilities;
}


/**
 * Model capabilities
 */
export interface ModelCapabilities {
    contextWindow?: number;
    supportsTools?: boolean;
    supportsVision?: boolean;
    supportsStreaming?: boolean;
    maxTokens?: number;
    temperature?: number;
}

/**
 * Complete AI configuration
 */
export interface AIConfig {
    enabled: boolean;
    selectedProvider: ProviderType | null;
    defaultModels: Record<ProviderType, string | undefined>;
    providerSettings: ProviderSettings;
}

/**
 * Provider-specific settings
 */
export interface ProviderSettings {
    openai?: OpenAISettings;
    anthropic?: AnthropicSettings;
    ollama?: OllamaSettings;
    minimax?: MiniMaxSettings;
}

export interface OpenAISettings {
    apiKey?: string;
    baseUrl?: string;
    defaultModel?: string;
}

export interface AnthropicSettings {
    apiKey?: string;
    baseUrl?: string;
    defaultModel?: string;
}

export interface OllamaSettings {
    baseUrl?: string;
    defaultModel?: string;
    timeout?: number;
}

export interface MiniMaxSettings {
    apiKey?: string;
    baseUrl?: string;
    defaultModel?: string;
}

/**
 * Valid provider types
 */
export type ProviderType = 'openai' | 'anthropic' | 'ollama' | 'minimax';


/**
 * Model identifier with provider prefix (e.g., "openai:gpt-4" or "ollama:llama2")
 */
export interface ModelIdentifier {
    provider?: ProviderType;
    modelId: string;
    fullIdentifier: string; // The complete string representation
}

/**
 * Validation result for configuration
 */
export interface ConfigValidationResult {
    isValid: boolean;
    errors: string[];
    warnings: string[];
}
