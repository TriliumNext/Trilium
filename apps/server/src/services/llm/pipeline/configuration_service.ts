/**
 * Configuration Service - Phase 2.2 Implementation
 * 
 * Centralizes all LLM configuration management:
 * - Single source of truth for all configuration
 * - Validation at startup
 * - Type-safe configuration access
 * - No scattered options.getOption() calls
 */

import options from '../../options.js';
import log from '../../log.js';
import type { ChatCompletionOptions } from '../ai_interface.js';

// Configuration interfaces
export interface LLMConfiguration {
    providers: ProviderConfiguration;
    defaults: DefaultConfiguration;
    tools: ToolConfiguration;
    streaming: StreamingConfiguration;
    debug: DebugConfiguration;
    limits: LimitConfiguration;
}

export interface ProviderConfiguration {
    enabled: boolean;
    selected: 'openai' | 'anthropic' | 'ollama' | null;
    openai?: {
        apiKey: string;
        baseUrl?: string;
        defaultModel: string;
        maxTokens?: number;
    };
    anthropic?: {
        apiKey: string;
        baseUrl?: string;
        defaultModel: string;
        maxTokens?: number;
    };
    ollama?: {
        baseUrl: string;
        defaultModel: string;
        maxTokens?: number;
    };
}

export interface DefaultConfiguration {
    systemPrompt: string;
    temperature: number;
    maxTokens: number;
    topP: number;
    presencePenalty: number;
    frequencyPenalty: number;
}

export interface ToolConfiguration {
    enabled: boolean;
    maxIterations: number;
    timeout: number;
    parallelExecution: boolean;
}

export interface StreamingConfiguration {
    enabled: boolean;
    chunkSize: number;
    flushInterval: number;
}

export interface DebugConfiguration {
    enabled: boolean;
    logLevel: 'error' | 'warn' | 'info' | 'debug';
    enableMetrics: boolean;
    enableTracing: boolean;
}

export interface LimitConfiguration {
    maxMessageLength: number;
    maxConversationLength: number;
    maxContextLength: number;
    rateLimitPerMinute: number;
}

// Validation result interface
export interface ConfigurationValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
}

/**
 * Configuration Service Implementation
 */
export class ConfigurationService {
    private config: LLMConfiguration | null = null;
    private validationResult: ConfigurationValidationResult | null = null;
    private lastLoadTime: number = 0;
    private readonly CACHE_DURATION = 60000; // 1 minute cache

    /**
     * Load and validate configuration
     */
    async initialize(): Promise<ConfigurationValidationResult> {
        log.info('Initializing LLM configuration service');
        
        try {
            this.config = await this.loadConfiguration();
            this.validationResult = this.validateConfiguration(this.config);
            this.lastLoadTime = Date.now();
            
            if (!this.validationResult.valid) {
                log.error(`Configuration validation failed: ${JSON.stringify(this.validationResult.errors)}`);
            } else if (this.validationResult.warnings.length > 0) {
                log.info(`[WARN] Configuration warnings: ${JSON.stringify(this.validationResult.warnings)}`);
            } else {
                log.info('Configuration loaded and validated successfully');
            }
            
            return this.validationResult;
            
        } catch (error) {
            const errorMessage = `Failed to initialize configuration: ${error}`;
            log.error(errorMessage);
            
            this.validationResult = {
                valid: false,
                errors: [errorMessage],
                warnings: []
            };
            
            return this.validationResult;
        }
    }

    /**
     * Load configuration from options
     */
    private async loadConfiguration(): Promise<LLMConfiguration> {
        // Provider configuration
        const providers: ProviderConfiguration = {
            enabled: options.getOptionBool('aiEnabled'),
            selected: this.getSelectedProvider(),
            openai: this.loadOpenAIConfig(),
            anthropic: this.loadAnthropicConfig(),
            ollama: this.loadOllamaConfig()
        };

        // Default configuration
        const defaults: DefaultConfiguration = {
            systemPrompt: (options as any).getOptionOrNull('llmSystemPrompt') || 'You are a helpful AI assistant.',
            temperature: this.parseFloat((options as any).getOptionOrNull('llmTemperature'), 0.7),
            maxTokens: this.parseInt((options as any).getOptionOrNull('llmMaxTokens'), 2000),
            topP: this.parseFloat((options as any).getOptionOrNull('llmTopP'), 0.9),
            presencePenalty: this.parseFloat((options as any).getOptionOrNull('llmPresencePenalty'), 0),
            frequencyPenalty: this.parseFloat((options as any).getOptionOrNull('llmFrequencyPenalty'), 0)
        };

        // Tool configuration
        const tools: ToolConfiguration = {
            enabled: (options as any).getOptionBool('llmToolsEnabled') !== false,
            maxIterations: this.parseInt((options as any).getOptionOrNull('llmMaxToolIterations'), 5),
            timeout: this.parseInt((options as any).getOptionOrNull('llmToolTimeout'), 30000),
            parallelExecution: (options as any).getOptionBool('llmParallelTools') !== false
        };

        // Streaming configuration
        const streaming: StreamingConfiguration = {
            enabled: (options as any).getOptionBool('llmStreamingEnabled') !== false,
            chunkSize: this.parseInt((options as any).getOptionOrNull('llmStreamChunkSize'), 256),
            flushInterval: this.parseInt((options as any).getOptionOrNull('llmStreamFlushInterval'), 100)
        };

        // Debug configuration
        const debug: DebugConfiguration = {
            enabled: (options as any).getOptionBool('llmDebugEnabled'),
            logLevel: this.getLogLevel(),
            enableMetrics: (options as any).getOptionBool('llmMetricsEnabled'),
            enableTracing: (options as any).getOptionBool('llmTracingEnabled')
        };

        // Limit configuration
        const limits: LimitConfiguration = {
            maxMessageLength: this.parseInt((options as any).getOptionOrNull('llmMaxMessageLength'), 100000),
            maxConversationLength: this.parseInt((options as any).getOptionOrNull('llmMaxConversationLength'), 50),
            maxContextLength: this.parseInt((options as any).getOptionOrNull('llmMaxContextLength'), 10000),
            rateLimitPerMinute: this.parseInt((options as any).getOptionOrNull('llmRateLimitPerMinute'), 60)
        };

        return {
            providers,
            defaults,
            tools,
            streaming,
            debug,
            limits
        };
    }

    /**
     * Load OpenAI configuration
     */
    private loadOpenAIConfig() {
        const apiKey = options.getOption('openaiApiKey' as any);
        if (!apiKey) return undefined;

        return {
            apiKey,
            baseUrl: options.getOption('openaiBaseUrl' as any) || undefined,
            defaultModel: options.getOption('openaiDefaultModel' as any) || 'gpt-4-turbo-preview',
            maxTokens: this.parseInt(options.getOption('openaiMaxTokens' as any), 4096)
        };
    }

    /**
     * Load Anthropic configuration
     */
    private loadAnthropicConfig() {
        const apiKey = options.getOption('anthropicApiKey' as any);
        if (!apiKey) return undefined;

        return {
            apiKey,
            baseUrl: options.getOption('anthropicBaseUrl' as any) || undefined,
            defaultModel: options.getOption('anthropicDefaultModel' as any) || 'claude-3-opus-20240229',
            maxTokens: this.parseInt(options.getOption('anthropicMaxTokens' as any), 4096)
        };
    }

    /**
     * Load Ollama configuration
     */
    private loadOllamaConfig() {
        const baseUrl = options.getOption('ollamaBaseUrl' as any);
        if (!baseUrl) return undefined;

        return {
            baseUrl,
            defaultModel: options.getOption('ollamaDefaultModel' as any) || 'llama2',
            maxTokens: this.parseInt(options.getOption('ollamaMaxTokens' as any), 2048)
        };
    }

    /**
     * Validate configuration
     */
    private validateConfiguration(config: LLMConfiguration): ConfigurationValidationResult {
        const errors: string[] = [];
        const warnings: string[] = [];

        // Check if AI is enabled
        if (!config.providers.enabled) {
            warnings.push('AI features are disabled');
            return { valid: true, errors, warnings };
        }

        // Check provider selection
        if (!config.providers.selected) {
            errors.push('No AI provider selected');
        } else {
            // Validate selected provider configuration
            const selectedConfig = config.providers[config.providers.selected];
            if (!selectedConfig) {
                errors.push(`Configuration missing for selected provider: ${config.providers.selected}`);
            } else {
                // Provider-specific validation
                if (config.providers.selected === 'openai' && !('apiKey' in selectedConfig && selectedConfig.apiKey)) {
                    errors.push('OpenAI API key is required');
                }
                if (config.providers.selected === 'anthropic' && !('apiKey' in selectedConfig && selectedConfig.apiKey)) {
                    errors.push('Anthropic API key is required');
                }
                if (config.providers.selected === 'ollama' && !('baseUrl' in selectedConfig && selectedConfig.baseUrl)) {
                    errors.push('Ollama base URL is required');
                }
            }
        }

        // Validate limits
        if (config.limits.maxMessageLength < 100) {
            warnings.push('Maximum message length is very low, may cause issues');
        }
        if (config.limits.maxConversationLength < 2) {
            errors.push('Maximum conversation length must be at least 2');
        }
        if (config.tools.maxIterations > 10) {
            warnings.push('High tool iteration limit may cause performance issues');
        }

        // Validate defaults
        if (config.defaults.temperature < 0 || config.defaults.temperature > 2) {
            errors.push('Temperature must be between 0 and 2');
        }
        if (config.defaults.maxTokens < 1) {
            errors.push('Maximum tokens must be at least 1');
        }

        return {
            valid: errors.length === 0,
            errors,
            warnings
        };
    }

    /**
     * Get selected provider
     */
    private getSelectedProvider(): 'openai' | 'anthropic' | 'ollama' | null {
        const provider = options.getOption('aiSelectedProvider' as any);
        if (provider === 'openai' || provider === 'anthropic' || provider === 'ollama') {
            return provider;
        }
        return null;
    }

    /**
     * Get log level
     */
    private getLogLevel(): 'error' | 'warn' | 'info' | 'debug' {
        const level = options.getOption('llmLogLevel' as any) || 'info';
        if (level === 'error' || level === 'warn' || level === 'info' || level === 'debug') {
            return level;
        }
        return 'info';
    }

    /**
     * Parse integer with default
     */
    private parseInt(value: string | null, defaultValue: number): number {
        if (!value) return defaultValue;
        const parsed = parseInt(value, 10);
        return isNaN(parsed) ? defaultValue : parsed;
    }

    /**
     * Parse float with default
     */
    private parseFloat(value: string | null, defaultValue: number): number {
        if (!value) return defaultValue;
        const parsed = parseFloat(value);
        return isNaN(parsed) ? defaultValue : parsed;
    }

    /**
     * Ensure configuration is loaded
     */
    private ensureConfigLoaded(): LLMConfiguration {
        if (!this.config || Date.now() - this.lastLoadTime > this.CACHE_DURATION) {
            // Reload configuration if cache expired
            this.initialize().catch(error => {
                log.error(`Failed to reload configuration: ${error instanceof Error ? error.message : String(error)}`);
            });
        }
        
        if (!this.config) {
            throw new Error('Configuration not initialized');
        }
        
        return this.config;
    }

    // Public accessors

    /**
     * Get provider configuration
     */
    getProviderConfig(): ProviderConfiguration {
        return this.ensureConfigLoaded().providers;
    }

    /**
     * Get default configuration
     */
    getDefaultConfig(): DefaultConfiguration {
        return this.ensureConfigLoaded().defaults;
    }

    /**
     * Get tool configuration
     */
    getToolConfig(): ToolConfiguration {
        return this.ensureConfigLoaded().tools;
    }

    /**
     * Get streaming configuration
     */
    getStreamingConfig(): StreamingConfiguration {
        return this.ensureConfigLoaded().streaming;
    }

    /**
     * Get debug configuration
     */
    getDebugConfig(): DebugConfiguration {
        return this.ensureConfigLoaded().debug;
    }

    /**
     * Get limit configuration
     */
    getLimitConfig(): LimitConfiguration {
        return this.ensureConfigLoaded().limits;
    }

    /**
     * Get default system prompt
     */
    getDefaultSystemPrompt(): string {
        return this.getDefaultConfig().systemPrompt;
    }

    /**
     * Get default completion options
     */
    getDefaultCompletionOptions(): ChatCompletionOptions {
        const defaults = this.getDefaultConfig();
        return {
            temperature: defaults.temperature,
            maxTokens: defaults.maxTokens,
            topP: defaults.topP,
            presencePenalty: defaults.presencePenalty,
            frequencyPenalty: defaults.frequencyPenalty
        };
    }

    /**
     * Check if configuration is valid
     */
    isValid(): boolean {
        return this.validationResult?.valid ?? false;
    }

    /**
     * Get validation result
     */
    getValidationResult(): ConfigurationValidationResult | null {
        return this.validationResult;
    }

    /**
     * Force reload configuration
     */
    async reload(): Promise<ConfigurationValidationResult> {
        this.config = null;
        this.lastLoadTime = 0;
        return this.initialize();
    }
}

// Export singleton instance
const configurationService = new ConfigurationService();
export default configurationService;