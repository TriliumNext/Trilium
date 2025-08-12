/**
 * LLM Service Configuration Options
 * 
 * Defines all configurable options for the LLM service that can be
 * managed through Trilium's options system.
 */

import optionService from '../../options.js';
import type { OptionNames, FilterOptionsByType } from '@triliumnext/commons';
import { ExportFormat } from '../metrics/metrics_exporter.js';

/**
 * LLM configuration options
 */
export interface LLMOptions {
    // Metrics Configuration
    metricsEnabled: boolean;
    metricsExportFormat: ExportFormat;
    metricsExportEndpoint?: string;
    metricsExportInterval: number;
    metricsPrometheusEnabled: boolean;
    metricsStatsdHost?: string;
    metricsStatsdPort?: number;
    metricsStatsdPrefix: string;
    
    // Provider Configuration
    providerHealthCheckEnabled: boolean;
    providerHealthCheckInterval: number;
    providerCachingEnabled: boolean;
    providerCacheTimeout: number;
    providerFallbackEnabled: boolean;
    providerFallbackList: string[];
}

/**
 * Default LLM options
 */
const DEFAULT_OPTIONS: LLMOptions = {
    // Metrics Defaults
    metricsEnabled: true,
    metricsExportFormat: 'prometheus' as ExportFormat,
    metricsExportInterval: 60000, // 1 minute
    metricsPrometheusEnabled: true,
    metricsStatsdPrefix: 'trilium.llm',
    
    // Provider Defaults
    providerHealthCheckEnabled: true,
    providerHealthCheckInterval: 60000, // 1 minute
    providerCachingEnabled: true,
    providerCacheTimeout: 300000, // 5 minutes
    providerFallbackEnabled: true,
    providerFallbackList: ['ollama']
};

/**
 * Option keys in Trilium's option system
 */
export const LLM_OPTION_KEYS = {
    // Metrics
    METRICS_ENABLED: 'llmMetricsEnabled' as const,
    METRICS_EXPORT_FORMAT: 'llmMetricsExportFormat' as const,
    METRICS_EXPORT_ENDPOINT: 'llmMetricsExportEndpoint' as const,
    METRICS_EXPORT_INTERVAL: 'llmMetricsExportInterval' as const,
    METRICS_PROMETHEUS_ENABLED: 'llmMetricsPrometheusEnabled' as const,
    METRICS_STATSD_HOST: 'llmMetricsStatsdHost' as const,
    METRICS_STATSD_PORT: 'llmMetricsStatsdPort' as const,
    METRICS_STATSD_PREFIX: 'llmMetricsStatsdPrefix' as const,
    
    // Provider
    PROVIDER_HEALTH_CHECK_ENABLED: 'llmProviderHealthCheckEnabled' as const,
    PROVIDER_HEALTH_CHECK_INTERVAL: 'llmProviderHealthCheckInterval' as const,
    PROVIDER_CACHING_ENABLED: 'llmProviderCachingEnabled' as const,
    PROVIDER_CACHE_TIMEOUT: 'llmProviderCacheTimeout' as const,
    PROVIDER_FALLBACK_ENABLED: 'llmProviderFallbackEnabled' as const,
    PROVIDER_FALLBACK_LIST: 'llmProviderFallbackList' as const
} as const;

/**
 * Get LLM options from Trilium's option service
 */
export function getLLMOptions(): LLMOptions {
    // Helper function to safely get option with fallback
    function getOptionSafe<T>(getter: () => T, defaultValue: T): T {
        try {
            return getter() ?? defaultValue;
        } catch {
            return defaultValue;
        }
    }

    return {
        // Metrics
        metricsEnabled: getOptionSafe(
            () => optionService.getOptionBool(LLM_OPTION_KEYS.METRICS_ENABLED),
            DEFAULT_OPTIONS.metricsEnabled
        ),
        metricsExportFormat: getOptionSafe(
            () => optionService.getOption(LLM_OPTION_KEYS.METRICS_EXPORT_FORMAT) as ExportFormat,
            DEFAULT_OPTIONS.metricsExportFormat
        ),
        metricsExportEndpoint: getOptionSafe(
            () => optionService.getOption(LLM_OPTION_KEYS.METRICS_EXPORT_ENDPOINT),
            undefined
        ),
        metricsExportInterval: getOptionSafe(
            () => optionService.getOptionInt(LLM_OPTION_KEYS.METRICS_EXPORT_INTERVAL),
            DEFAULT_OPTIONS.metricsExportInterval
        ),
        metricsPrometheusEnabled: getOptionSafe(
            () => optionService.getOptionBool(LLM_OPTION_KEYS.METRICS_PROMETHEUS_ENABLED),
            DEFAULT_OPTIONS.metricsPrometheusEnabled
        ),
        metricsStatsdHost: getOptionSafe(
            () => optionService.getOption(LLM_OPTION_KEYS.METRICS_STATSD_HOST),
            undefined
        ),
        metricsStatsdPort: getOptionSafe(
            () => optionService.getOptionInt(LLM_OPTION_KEYS.METRICS_STATSD_PORT),
            undefined
        ),
        metricsStatsdPrefix: getOptionSafe(
            () => optionService.getOption(LLM_OPTION_KEYS.METRICS_STATSD_PREFIX),
            DEFAULT_OPTIONS.metricsStatsdPrefix
        ),
        
        // Provider
        providerHealthCheckEnabled: getOptionSafe(
            () => optionService.getOptionBool(LLM_OPTION_KEYS.PROVIDER_HEALTH_CHECK_ENABLED),
            DEFAULT_OPTIONS.providerHealthCheckEnabled
        ),
        providerHealthCheckInterval: getOptionSafe(
            () => optionService.getOptionInt(LLM_OPTION_KEYS.PROVIDER_HEALTH_CHECK_INTERVAL),
            DEFAULT_OPTIONS.providerHealthCheckInterval
        ),
        providerCachingEnabled: getOptionSafe(
            () => optionService.getOptionBool(LLM_OPTION_KEYS.PROVIDER_CACHING_ENABLED),
            DEFAULT_OPTIONS.providerCachingEnabled
        ),
        providerCacheTimeout: getOptionSafe(
            () => optionService.getOptionInt(LLM_OPTION_KEYS.PROVIDER_CACHE_TIMEOUT),
            DEFAULT_OPTIONS.providerCacheTimeout
        ),
        providerFallbackEnabled: getOptionSafe(
            () => optionService.getOptionBool(LLM_OPTION_KEYS.PROVIDER_FALLBACK_ENABLED),
            DEFAULT_OPTIONS.providerFallbackEnabled
        ),
        providerFallbackList: getOptionSafe(
            () => {
                const value = optionService.getOption(LLM_OPTION_KEYS.PROVIDER_FALLBACK_LIST);
                if (typeof value === 'string' && value) {
                    return value.split(',').map((s: string) => s.trim()).filter(Boolean);
                }
                return DEFAULT_OPTIONS.providerFallbackList;
            },
            DEFAULT_OPTIONS.providerFallbackList
        )
    };
}

/**
 * Set an LLM option
 */
export async function setLLMOption(key: OptionNames, value: any): Promise<void> {
    await optionService.setOption(key, value);
}

/**
 * Initialize LLM options with defaults if not set
 */
export async function initializeLLMOptions(): Promise<void> {
    // Set defaults for any unset options
    const keysToCheck = Object.values(LLM_OPTION_KEYS) as OptionNames[];
    
    for (const key of keysToCheck) {
        try {
            const currentValue = optionService.getOption(key);
            
            if (currentValue === null || currentValue === undefined) {
                // Set default based on key
                const defaultKey = Object.entries(LLM_OPTION_KEYS)
                    .find(([_, v]) => v === key)?.[0];
                
                if (defaultKey) {
                    const defaultPath = defaultKey
                        .replace(/_([a-z])/g, (_, char) => char.toUpperCase())
                        .replace(/^[A-Z]/, char => char.toLowerCase())
                        .replace(/_/g, '');
                    
                    const defaultValue = (DEFAULT_OPTIONS as any)[defaultPath];
                    
                    if (defaultValue !== undefined) {
                        await setLLMOption(key, 
                            Array.isArray(defaultValue) ? defaultValue.join(',') : defaultValue
                        );
                    }
                }
            }
        } catch {
            // Option doesn't exist yet, create it with default
            const defaultKey = Object.entries(LLM_OPTION_KEYS)
                .find(([_, v]) => v === key)?.[0];
            
            if (defaultKey) {
                const defaultPath = defaultKey
                    .replace(/_([a-z])/g, (_, char) => char.toUpperCase())
                    .replace(/^[A-Z]/, char => char.toLowerCase())
                    .replace(/_/g, '');
                
                const defaultValue = (DEFAULT_OPTIONS as any)[defaultPath];
                
                if (defaultValue !== undefined) {
                    await setLLMOption(key, 
                        Array.isArray(defaultValue) ? defaultValue.join(',') : defaultValue
                    );
                }
            }
        }
    }
}

/**
 * Create provider factory options from LLM options
 */
export function createProviderFactoryOptions() {
    const options = getLLMOptions();
    
    return {
        enableHealthChecks: options.providerHealthCheckEnabled,
        healthCheckInterval: options.providerHealthCheckInterval,
        enableFallback: options.providerFallbackEnabled,
        fallbackProviders: options.providerFallbackList as any[],
        enableCaching: options.providerCachingEnabled,
        cacheTimeout: options.providerCacheTimeout,
        enableMetrics: options.metricsEnabled,
        metricsExporterConfig: {
            enabled: options.metricsEnabled,
            format: options.metricsExportFormat,
            endpoint: options.metricsExportEndpoint,
            interval: options.metricsExportInterval,
            statsdHost: options.metricsStatsdHost,
            statsdPort: options.metricsStatsdPort,
            prefix: options.metricsStatsdPrefix
        }
    };
}