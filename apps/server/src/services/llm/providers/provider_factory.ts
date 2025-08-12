/**
 * Provider Factory Pattern Implementation
 * 
 * This module implements a factory pattern for clean provider instantiation,
 * unified streaming interfaces, capability detection, and provider-specific
 * feature support.
 */

import log from '../../log.js';
import type { AIService, ChatCompletionOptions } from '../ai_interface.js';
import { OpenAIService } from './openai_service.js';
import { AnthropicService } from './anthropic_service.js';
import { OllamaService } from './ollama_service.js';
import type { 
    OpenAIOptions, 
    AnthropicOptions, 
    OllamaOptions,
    ModelMetadata 
} from './provider_options.js';
import { 
    getOpenAIOptions, 
    getAnthropicOptions, 
    getOllamaOptions 
} from './providers.js';
import { 
    MetricsExporter,
    ExportFormat,
    type ExporterConfig 
} from '../metrics/metrics_exporter.js';
import { providerHealthMonitor } from '../monitoring/provider_health_monitor.js';
import { edgeCaseHandler } from './edge_case_handler.js';
import { providerToolValidator } from '../tools/provider_tool_validator.js';

/**
 * Provider type enumeration
 */
export enum ProviderType {
    OPENAI = 'openai',
    ANTHROPIC = 'anthropic',
    OLLAMA = 'ollama',
    CUSTOM = 'custom'
}

/**
 * Provider capabilities interface
 */
export interface ProviderCapabilities {
    streaming: boolean;
    functionCalling: boolean;
    vision: boolean;
    contextWindow: number;
    maxOutputTokens: number;
    supportsSystemPrompt: boolean;
    supportsTools: boolean;
    supportedModalities: string[];
    customEndpoints: boolean;
    batchProcessing: boolean;
}

/**
 * Provider health status
 */
export interface ProviderHealthStatus {
    provider: ProviderType;
    healthy: boolean;
    lastChecked: Date;
    latency?: number;
    error?: string;
    version?: string;
}

/**
 * Provider configuration
 */
export interface ProviderConfig {
    type: ProviderType;
    apiKey?: string;
    baseUrl?: string;
    timeout?: number;
    maxRetries?: number;
    retryDelay?: number;
    customHeaders?: Record<string, string>;
    proxy?: string;
}

/**
 * Factory creation options
 */
export interface ProviderFactoryOptions {
    enableHealthChecks?: boolean;
    healthCheckInterval?: number;
    enableFallback?: boolean;
    fallbackProviders?: ProviderType[];
    enableCaching?: boolean;
    cacheTimeout?: number;
    enableMetrics?: boolean;
    metricsExporterConfig?: Partial<ExporterConfig>;
}

/**
 * Provider instance with metadata
 */
interface ProviderInstance {
    service: AIService;
    type: ProviderType;
    capabilities: ProviderCapabilities;
    config: ProviderConfig;
    createdAt: Date;
    lastUsed: Date;
    usageCount: number;
    healthStatus?: ProviderHealthStatus;
}

/**
 * Provider Factory Class
 * 
 * Manages creation, caching, and lifecycle of AI service providers
 */
export class ProviderFactory {
    private static instance: ProviderFactory | null = null;
    private providers: Map<string, ProviderInstance> = new Map();
    private capabilities: Map<ProviderType, ProviderCapabilities> = new Map();
    private healthStatuses: Map<ProviderType, ProviderHealthStatus> = new Map();
    private options: ProviderFactoryOptions;
    private healthCheckTimer?: NodeJS.Timeout;
    private disposed: boolean = false;
    private retryCount: Map<string, number> = new Map();
    private lastRetryTime: Map<string, number> = new Map();
    private metricsExporter?: MetricsExporter;

    constructor(options: ProviderFactoryOptions = {}) {
        this.options = {
            enableHealthChecks: options.enableHealthChecks ?? true,
            healthCheckInterval: options.healthCheckInterval ?? 60000, // 1 minute
            enableFallback: options.enableFallback ?? true,
            fallbackProviders: options.fallbackProviders ?? [ProviderType.OLLAMA],
            enableCaching: options.enableCaching ?? true,
            cacheTimeout: options.cacheTimeout ?? 300000, // 5 minutes
            enableMetrics: options.enableMetrics ?? true,
            metricsExporterConfig: options.metricsExporterConfig
        };

        this.initializeCapabilities();

        // Initialize metrics exporter if enabled
        if (this.options.enableMetrics) {
            this.metricsExporter = MetricsExporter.getInstance({
                enabled: true,
                ...this.options.metricsExporterConfig
            });
        }
        
        if (this.options.enableHealthChecks) {
            this.startHealthChecks();
        }
    }

    /**
     * Get singleton instance
     */
    public static getInstance(options?: ProviderFactoryOptions): ProviderFactory {
        if (!ProviderFactory.instance) {
            ProviderFactory.instance = new ProviderFactory(options);
        }
        return ProviderFactory.instance;
    }

    /**
     * Initialize provider capabilities registry
     */
    private initializeCapabilities(): void {
        // OpenAI capabilities
        this.capabilities.set(ProviderType.OPENAI, {
            streaming: true,
            functionCalling: true,
            vision: true,
            contextWindow: 128000, // GPT-4 Turbo
            maxOutputTokens: 4096,
            supportsSystemPrompt: true,
            supportsTools: true,
            supportedModalities: ['text', 'image'],
            customEndpoints: true,
            batchProcessing: true
        });

        // Anthropic capabilities
        this.capabilities.set(ProviderType.ANTHROPIC, {
            streaming: true,
            functionCalling: true,
            vision: true,
            contextWindow: 200000, // Claude 3
            maxOutputTokens: 4096,
            supportsSystemPrompt: true,
            supportsTools: true,
            supportedModalities: ['text', 'image'],
            customEndpoints: false,
            batchProcessing: false
        });

        // Ollama capabilities (default, can be overridden per model)
        this.capabilities.set(ProviderType.OLLAMA, {
            streaming: true,
            functionCalling: true,
            vision: false,
            contextWindow: 8192, // Default, varies by model
            maxOutputTokens: 2048,
            supportsSystemPrompt: true,
            supportsTools: true,
            supportedModalities: ['text'],
            customEndpoints: true,
            batchProcessing: false
        });
    }

    /**
     * Create a provider instance
     */
    public async createProvider(
        type: ProviderType,
        config?: Partial<ProviderConfig>,
        options?: ChatCompletionOptions
    ): Promise<AIService> {
        if (this.disposed) {
            throw new Error('ProviderFactory has been disposed');
        }

        const cacheKey = this.getCacheKey(type, config);

        // Check cache if enabled
        if (this.options.enableCaching) {
            const cached = this.providers.get(cacheKey);
            if (cached && this.isInstanceValid(cached)) {
                cached.lastUsed = new Date();
                cached.usageCount++;
                
                if (this.options.enableMetrics) {
                    log.info(`[ProviderFactory] Using cached ${type} provider (usage: ${cached.usageCount})`);
                }
                
                return cached.service;
            }
        }

        // Create new provider instance
        const service = await this.instantiateProvider(type, config, options);
        
        if (!service) {
            throw new Error(`Failed to create provider of type: ${type}`);
        }

        // Get capabilities for this provider
        const capabilities = await this.detectCapabilities(type, service);

        // Create provider instance
        const instance: ProviderInstance = {
            service,
            type,
            capabilities,
            config: { type, ...config },
            createdAt: new Date(),
            lastUsed: new Date(),
            usageCount: 1
        };

        // Cache the instance
        if (this.options.enableCaching) {
            this.providers.set(cacheKey, instance);
            
            // Schedule cache cleanup
            setTimeout(() => {
                this.cleanupCache(cacheKey);
            }, this.options.cacheTimeout);
        }

        if (this.options.enableMetrics) {
            log.info(`[ProviderFactory] Created new ${type} provider`);
        }

        return service;
    }

    /**
     * Instantiate a specific provider with retry and fallback logic
     */
    private async instantiateProvider(
        type: ProviderType,
        config?: Partial<ProviderConfig>,
        options?: ChatCompletionOptions
    ): Promise<AIService | null> {
        const startTime = Date.now();
        const maxRetries = 3;
        const baseDelay = 1000; // 1 second
        
        try {
            // Try to create the provider
            const service = await this.createProviderByType(type, config, options);
            
            if (service && service.isAvailable()) {
                // Record success metric
                if (this.metricsExporter) {
                    const latency = Date.now() - startTime;
                    this.metricsExporter.getCollector().recordLatency(type, latency);
                    this.metricsExporter.getCollector().recordRequest(type, true);
                }
                
                // Reset retry count on success
                this.retryCount.delete(type);
                this.lastRetryTime.delete(type);
                
                return service;
            }
            
            // If not available, try fallback
            if (this.options.enableFallback && this.options.fallbackProviders?.length) {
                log.info(`[ProviderFactory] Provider ${type} not available, trying fallback`);
                return this.tryFallbackProvider(options);
            }
            
            return null;
        } catch (error: any) {
            log.error(`[ProviderFactory] Error creating ${type} provider: ${error.message}`);
            
            // Record failure metric
            if (this.metricsExporter) {
                this.metricsExporter.getCollector().recordRequest(type, false);
                this.metricsExporter.getCollector().recordError(type, error.message);
            }
            
            // Simple exponential backoff for retries
            if (this.shouldRetry(type, error, maxRetries)) {
                const retryDelay = await this.getRetryDelay(type, baseDelay, error);
                log.info(`[ProviderFactory] Retrying ${type} after ${retryDelay}ms`);
                
                await new Promise(resolve => setTimeout(resolve, retryDelay));
                
                // Increment retry count
                const currentRetries = this.retryCount.get(type) || 0;
                this.retryCount.set(type, currentRetries + 1);
                this.lastRetryTime.set(type, Date.now());
                
                return this.instantiateProvider(type, config, options);
            }
            
            // Try fallback on failure
            if (this.options.enableFallback && this.options.fallbackProviders?.length) {
                log.info(`[ProviderFactory] Max retries reached for ${type}, trying fallback`);
                return this.tryFallbackProvider(options);
            }
            
            throw error;
        }
    }

    /**
     * Create provider by type
     */
    private async createProviderByType(
        type: ProviderType,
        config?: Partial<ProviderConfig>,
        options?: ChatCompletionOptions
    ): Promise<AIService | null> {
        switch (type) {
            case ProviderType.OPENAI:
                return this.createOpenAIProvider(config, options);
            
            case ProviderType.ANTHROPIC:
                return this.createAnthropicProvider(config, options);
            
            case ProviderType.OLLAMA:
                return await this.createOllamaProvider(config, options);
            
            case ProviderType.CUSTOM:
                return this.createCustomProvider(config, options);
            
            default:
                log.error(`[ProviderFactory] Unknown provider type: ${type}`);
                return null;
        }
    }

    /**
     * Check if we should retry a failed request
     */
    private shouldRetry(type: ProviderType, error: any, maxRetries: number): boolean {
        const currentRetries = this.retryCount.get(type) || 0;
        
        if (currentRetries >= maxRetries) {
            return false;
        }
        
        // Check for retryable errors
        if (error.status === 429) { // Rate limit
            return true;
        }
        
        if (error.status >= 500) { // Server errors
            return true;
        }
        
        if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
            return true;
        }
        
        return false;
    }

    /**
     * Calculate retry delay with exponential backoff
     */
    private async getRetryDelay(type: ProviderType, baseDelay: number, error: any): Promise<number> {
        const currentRetries = this.retryCount.get(type) || 0;
        
        // Check for rate limit headers
        if (error.status === 429 && error.headers) {
            // Check for Retry-After header
            const retryAfter = error.headers['retry-after'];
            if (retryAfter) {
                const delay = parseInt(retryAfter) * 1000;
                return Math.min(delay, 60000); // Cap at 60 seconds
            }
            
            // Check for X-RateLimit-Reset header
            const resetTime = error.headers['x-ratelimit-reset'];
            if (resetTime) {
                const delay = Math.max(0, parseInt(resetTime) * 1000 - Date.now());
                return Math.min(delay, 60000);
            }
        }
        
        // Exponential backoff: baseDelay * (2 ^ retries)
        const delay = baseDelay * Math.pow(2, currentRetries);
        
        // Add jitter to prevent thundering herd
        const jitter = Math.random() * 0.3 * delay;
        
        return Math.min(delay + jitter, 30000); // Cap at 30 seconds
    }


    /**
     * Create OpenAI provider
     */
    private createOpenAIProvider(
        config?: Partial<ProviderConfig>,
        options?: ChatCompletionOptions
    ): AIService {
        const service = new OpenAIService();
        
        if (!service.isAvailable()) {
            throw new Error('OpenAI service is not available');
        }
        
        return service;
    }

    /**
     * Create Anthropic provider
     */
    private createAnthropicProvider(
        config?: Partial<ProviderConfig>,
        options?: ChatCompletionOptions
    ): AIService {
        const service = new AnthropicService();
        
        if (!service.isAvailable()) {
            throw new Error('Anthropic service is not available');
        }
        
        return service;
    }

    /**
     * Create Ollama provider
     */
    private async createOllamaProvider(
        config?: Partial<ProviderConfig>,
        options?: ChatCompletionOptions
    ): Promise<AIService> {
        const service = new OllamaService();
        
        if (!service.isAvailable()) {
            throw new Error('Ollama service is not available');
        }
        
        // Ollama might need model pulling or other async setup
        // This is handled internally by the service
        
        return service;
    }

    /**
     * Create custom provider (for future extensibility)
     */
    private createCustomProvider(
        config?: Partial<ProviderConfig>,
        options?: ChatCompletionOptions
    ): AIService {
        throw new Error('Custom providers not yet implemented');
    }

    /**
     * Try fallback providers
     */
    private async tryFallbackProvider(options?: ChatCompletionOptions): Promise<AIService | null> {
        if (!this.options.fallbackProviders) {
            return null;
        }

        for (const fallbackType of this.options.fallbackProviders) {
            try {
                log.info(`[ProviderFactory] Trying fallback provider: ${fallbackType}`);
                const service = await this.createProviderByType(fallbackType, undefined, options);
                
                if (service && service.isAvailable()) {
                    log.info(`[ProviderFactory] Fallback to ${fallbackType} successful`);
                    return service;
                }
            } catch (error) {
                log.error(`[ProviderFactory] Fallback to ${fallbackType} failed: ${error}`);
            }
        }

        return null;
    }

    /**
     * Detect capabilities for a provider
     */
    private async detectCapabilities(
        type: ProviderType,
        service: AIService
    ): Promise<ProviderCapabilities> {
        // Start with default capabilities
        let capabilities = this.capabilities.get(type) || this.getDefaultCapabilities();

        // Try to detect actual capabilities from the service
        try {
            // Check for streaming support
            if ('supportsStreaming' in service && typeof service.supportsStreaming === 'function') {
                capabilities.streaming = (service as any).supportsStreaming();
            }

            // Check for tool support
            if ('supportsTools' in service && typeof service.supportsTools === 'function') {
                capabilities.supportsTools = (service as any).supportsTools();
            }

            // For Ollama, try to get model-specific capabilities
            if (type === ProviderType.OLLAMA) {
                capabilities = await this.detectOllamaCapabilities(service, capabilities);
            }
        } catch (error) {
            log.info(`[ProviderFactory] Could not detect capabilities for ${type}: ${error}`);
        }

        return capabilities;
    }

    /**
     * Detect Ollama-specific capabilities
     */
    private async detectOllamaCapabilities(
        service: AIService,
        defaultCaps: ProviderCapabilities
    ): Promise<ProviderCapabilities> {
        // This would query the Ollama API for model info
        // For now, return defaults
        return defaultCaps;
    }

    /**
     * Get default capabilities
     */
    private getDefaultCapabilities(): ProviderCapabilities {
        return {
            streaming: true,
            functionCalling: false,
            vision: false,
            contextWindow: 4096,
            maxOutputTokens: 1024,
            supportsSystemPrompt: true,
            supportsTools: false,
            supportedModalities: ['text'],
            customEndpoints: false,
            batchProcessing: false
        };
    }

    /**
     * Perform health check on a provider
     */
    public async checkProviderHealth(type: ProviderType): Promise<ProviderHealthStatus> {
        const startTime = Date.now();
        
        try {
            // Just try to create the provider and check if it's available
            const service = await this.createProviderByType(type);
            const isHealthy = service ? service.isAvailable() : false;
            const latency = Date.now() - startTime;
            
            const status: ProviderHealthStatus = {
                provider: type,
                healthy: isHealthy,
                lastChecked: new Date(),
                latency
            };

            this.healthStatuses.set(type, status);
            return status;
        } catch (error: any) {
            const status: ProviderHealthStatus = {
                provider: type,
                healthy: false,
                lastChecked: new Date(),
                error: error.message || 'Unknown error'
            };

            this.healthStatuses.set(type, status);
            return status;
        }
    }

    /**
     * Start periodic health checks
     */
    private startHealthChecks(): void {
        if (this.healthCheckTimer) {
            return;
        }

        this.healthCheckTimer = setInterval(async () => {
            if (this.disposed) {
                return;
            }

            for (const type of this.capabilities.keys()) {
                try {
                    await this.checkProviderHealth(type);
                } catch (error) {
                    log.error(`[ProviderFactory] Health check failed for ${type}: ${error}`);
                }
            }
        }, this.options.healthCheckInterval);

        // Perform initial health check
        this.performInitialHealthCheck();
    }

    /**
     * Perform initial health check
     */
    private async performInitialHealthCheck(): Promise<void> {
        for (const type of this.capabilities.keys()) {
            try {
                await this.checkProviderHealth(type);
            } catch (error) {
                log.error(`[ProviderFactory] Initial health check failed for ${type}: ${error}`);
            }
        }
    }

    /**
     * Get health status for a provider
     */
    public getHealthStatus(type: ProviderType): ProviderHealthStatus | undefined {
        return this.healthStatuses.get(type);
    }

    /**
     * Get all health statuses
     */
    public getAllHealthStatuses(): Map<ProviderType, ProviderHealthStatus> {
        return new Map(this.healthStatuses);
    }

    /**
     * Get capabilities for a provider
     */
    public getCapabilities(type: ProviderType): ProviderCapabilities | undefined {
        return this.capabilities.get(type);
    }

    /**
     * Register custom provider capabilities
     */
    public registerCapabilities(type: ProviderType, capabilities: ProviderCapabilities): void {
        this.capabilities.set(type, capabilities);
    }

    /**
     * Get cache key for provider
     */
    private getCacheKey(type: ProviderType, config?: Partial<ProviderConfig>): string {
        const baseKey = type;
        
        if (config?.baseUrl) {
            return `${baseKey}:${config.baseUrl}`;
        }
        
        return baseKey;
    }

    /**
     * Check if cached instance is still valid
     */
    private isInstanceValid(instance: ProviderInstance): boolean {
        if (!this.options.cacheTimeout) {
            return true;
        }

        const age = Date.now() - instance.createdAt.getTime();
        return age < this.options.cacheTimeout;
    }

    /**
     * Cleanup specific cache entry
     */
    private cleanupCache(key: string): void {
        const instance = this.providers.get(key);
        
        if (instance && !this.isInstanceValid(instance)) {
            this.disposeProvider(instance);
            this.providers.delete(key);
            
            if (this.options.enableMetrics) {
                log.info(`[ProviderFactory] Cleaned up cached provider: ${key}`);
            }
        }
    }

    /**
     * Cleanup all expired cache entries
     */
    public cleanupExpiredCache(): void {
        const keys = Array.from(this.providers.keys());
        
        for (const key of keys) {
            this.cleanupCache(key);
        }
    }

    /**
     * Dispose a provider instance
     */
    private disposeProvider(instance: ProviderInstance): void {
        try {
            if ('dispose' in instance.service && typeof (instance.service as any).dispose === 'function') {
                (instance.service as any).dispose();
            }
        } catch (error) {
            log.error(`[ProviderFactory] Error disposing provider: ${error}`);
        }
    }

    /**
     * Get provider statistics
     */
    public getStatistics(): {
        cachedProviders: number;
        totalUsage: number;
        providerUsage: Record<string, number>;
        healthyProviders: number;
        unhealthyProviders: number;
    } {
        const stats = {
            cachedProviders: this.providers.size,
            totalUsage: 0,
            providerUsage: {} as Record<string, number>,
            healthyProviders: 0,
            unhealthyProviders: 0
        };

        // Calculate usage statistics
        for (const [key, instance] of this.providers) {
            stats.totalUsage += instance.usageCount;
            
            const type = instance.type.toString();
            stats.providerUsage[type] = (stats.providerUsage[type] || 0) + instance.usageCount;
        }

        // Calculate health statistics
        for (const status of this.healthStatuses.values()) {
            if (status.healthy) {
                stats.healthyProviders++;
            } else {
                stats.unhealthyProviders++;
            }
        }

        return stats;
    }

    /**
     * Clear all cached providers
     */
    public clearCache(): void {
        for (const instance of this.providers.values()) {
            this.disposeProvider(instance);
        }
        
        this.providers.clear();
        
        if (this.options.enableMetrics) {
            log.info('[ProviderFactory] Cleared all cached providers');
        }
    }


    /**
     * Get metrics summary
     */
    public getMetricsSummary(): any {
        if (!this.metricsExporter) {
            return null;
        }

        const collector = this.metricsExporter.getCollector();
        return {
            providers: Array.from(collector.getProviderMetricsMap().values()),
            system: collector.getSystemMetrics()
        };
    }

    /**
     * Export metrics in specified format
     */
    public exportMetrics(format?: 'prometheus' | 'statsd' | 'opentelemetry' | 'json'): any {
        if (!this.metricsExporter) {
            return null;
        }

        const exportFormat = format ? {
            prometheus: ExportFormat.PROMETHEUS,
            statsd: ExportFormat.STATSD,
            opentelemetry: ExportFormat.OPENTELEMETRY,
            json: ExportFormat.JSON
        }[format] : undefined;

        return this.metricsExporter.export(exportFormat);
    }


    /**
     * Configure metrics export
     */
    public configureMetricsExport(config: Partial<ExporterConfig>): void {
        if (!this.metricsExporter) {
            return;
        }

        this.metricsExporter.updateConfig(config);
        log.info('[ProviderFactory] Metrics export configuration updated');
    }

    /**
     * Dispose the factory and cleanup resources
     */
    public dispose(): void {
        if (this.disposed) {
            return;
        }

        this.disposed = true;

        // Stop health checks
        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
            this.healthCheckTimer = undefined;
        }


        // Dispose metrics exporter
        if (this.metricsExporter) {
            this.metricsExporter.dispose();
        }

        // Clear cache
        this.clearCache();

        // Clear singleton instance
        ProviderFactory.instance = null;

        log.info('[ProviderFactory] Disposed successfully');
    }
}

// Export singleton instance getter
export const getProviderFactory = (options?: ProviderFactoryOptions): ProviderFactory => {
    return ProviderFactory.getInstance(options);
};