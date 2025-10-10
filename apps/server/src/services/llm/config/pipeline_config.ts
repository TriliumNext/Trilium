/**
 * Pipeline Configuration - Phase 1 Implementation
 *
 * Centralized configuration for the LLM pipeline:
 * - Single source of truth for pipeline settings
 * - Type-safe configuration access
 * - Sensible defaults
 * - Backward compatible with existing options
 *
 * Design: Simple, focused configuration without complex validation
 */

import options from '../../options.js';

/**
 * Pipeline configuration interface
 */
export interface PipelineConfig {
    // Tool execution settings
    maxToolIterations: number;
    toolTimeout: number;
    enableTools: boolean;

    // Streaming settings
    enableStreaming: boolean;
    streamChunkSize: number;

    // Debug settings
    enableDebugLogging: boolean;
    enableMetrics: boolean;

    // Context settings
    maxContextLength: number;
    enableAdvancedContext: boolean;

    // Phase 3: Provider-specific settings
    ollamaContextWindow: number;
    ollamaMaxTools: number;
    enableQueryBasedFiltering: boolean;
}

/**
 * Default pipeline configuration
 */
export const DEFAULT_PIPELINE_CONFIG: PipelineConfig = {
    maxToolIterations: 5,
    toolTimeout: 30000,
    enableTools: true,
    enableStreaming: true,
    streamChunkSize: 256,
    enableDebugLogging: false,
    enableMetrics: false,
    maxContextLength: 10000,
    enableAdvancedContext: true,
    // Phase 3: Provider-specific defaults
    ollamaContextWindow: 8192,      // 4x increase from 2048
    ollamaMaxTools: 3,               // Local models work best with 3 tools
    enableQueryBasedFiltering: true  // Enable intelligent tool selection
};

/**
 * Pipeline Configuration Service
 * Provides centralized access to pipeline configuration
 */
export class PipelineConfigService {
    private config: PipelineConfig | null = null;
    private readonly CACHE_DURATION = 60000; // 1 minute cache
    private lastLoadTime: number = 0;

    /**
     * Get pipeline configuration
     * Lazy loads and caches configuration
     *
     * Note: This method has a theoretical race condition where multiple concurrent calls
     * could trigger duplicate loadConfiguration() calls. This is acceptable because:
     * 1. loadConfiguration() is a simple synchronous read from options (no side effects)
     * 2. Both loads will produce identical results
     * 3. The overhead of rare duplicate loads is negligible compared to async locking complexity
     * 4. Config changes are infrequent (typically only during app initialization)
     *
     * If this becomes a performance issue, consider making this async with a mutex.
     */
    getConfig(): PipelineConfig {
        // Check if we need to reload configuration
        if (!this.config || Date.now() - this.lastLoadTime > this.CACHE_DURATION) {
            this.config = this.loadConfiguration();
            this.lastLoadTime = Date.now();
        }

        return this.config;
    }

    /**
     * Load configuration from options
     */
    private loadConfiguration(): PipelineConfig {
        return {
            // Tool execution settings
            maxToolIterations: this.getIntOption('llmMaxToolIterations', DEFAULT_PIPELINE_CONFIG.maxToolIterations),
            toolTimeout: this.getIntOption('llmToolTimeout', DEFAULT_PIPELINE_CONFIG.toolTimeout),
            enableTools: this.getBoolOption('llmToolsEnabled', DEFAULT_PIPELINE_CONFIG.enableTools),

            // Streaming settings
            enableStreaming: this.getBoolOption('llmStreamingEnabled', DEFAULT_PIPELINE_CONFIG.enableStreaming),
            streamChunkSize: this.getIntOption('llmStreamChunkSize', DEFAULT_PIPELINE_CONFIG.streamChunkSize),

            // Debug settings
            enableDebugLogging: this.getBoolOption('llmDebugEnabled', DEFAULT_PIPELINE_CONFIG.enableDebugLogging),
            enableMetrics: this.getBoolOption('llmMetricsEnabled', DEFAULT_PIPELINE_CONFIG.enableMetrics),

            // Context settings
            maxContextLength: this.getIntOption('llmMaxContextLength', DEFAULT_PIPELINE_CONFIG.maxContextLength),
            enableAdvancedContext: this.getBoolOption('llmAdvancedContext', DEFAULT_PIPELINE_CONFIG.enableAdvancedContext),

            // Phase 3: Provider-specific settings
            ollamaContextWindow: this.getIntOption('llmOllamaContextWindow', DEFAULT_PIPELINE_CONFIG.ollamaContextWindow),
            ollamaMaxTools: this.getIntOption('llmOllamaMaxTools', DEFAULT_PIPELINE_CONFIG.ollamaMaxTools),
            enableQueryBasedFiltering: this.getBoolOption('llmEnableQueryFiltering', DEFAULT_PIPELINE_CONFIG.enableQueryBasedFiltering)
        };
    }

    /**
     * Get boolean option with default
     */
    private getBoolOption(key: string, defaultValue: boolean): boolean {
        try {
            const value = (options as any).getOptionBool(key);
            return value !== undefined ? value : defaultValue;
        } catch {
            return defaultValue;
        }
    }

    /**
     * Get integer option with default
     */
    private getIntOption(key: string, defaultValue: number): number {
        try {
            const value = (options as any).getOption(key);
            if (value === null || value === undefined) {
                return defaultValue;
            }
            const parsed = parseInt(value, 10);
            return isNaN(parsed) ? defaultValue : parsed;
        } catch {
            return defaultValue;
        }
    }

    /**
     * Get string option with default
     */
    private getStringOption(key: string, defaultValue: string): string {
        try {
            const value = (options as any).getOption(key);
            return value !== null && value !== undefined ? String(value) : defaultValue;
        } catch {
            return defaultValue;
        }
    }

    /**
     * Force reload configuration
     */
    reload(): void {
        this.config = null;
        this.lastLoadTime = 0;
    }

    /**
     * Get specific configuration values
     */
    getMaxToolIterations(): number {
        return this.getConfig().maxToolIterations;
    }

    getToolTimeout(): number {
        return this.getConfig().toolTimeout;
    }

    isToolsEnabled(): boolean {
        return this.getConfig().enableTools;
    }

    isStreamingEnabled(): boolean {
        return this.getConfig().enableStreaming;
    }

    getStreamChunkSize(): number {
        return this.getConfig().streamChunkSize;
    }

    isDebugLoggingEnabled(): boolean {
        return this.getConfig().enableDebugLogging;
    }

    isMetricsEnabled(): boolean {
        return this.getConfig().enableMetrics;
    }

    getMaxContextLength(): number {
        return this.getConfig().maxContextLength;
    }

    isAdvancedContextEnabled(): boolean {
        return this.getConfig().enableAdvancedContext;
    }

    // Phase 3: Provider-specific getters
    getOllamaContextWindow(): number {
        return this.getConfig().ollamaContextWindow;
    }

    getOllamaMaxTools(): number {
        return this.getConfig().ollamaMaxTools;
    }

    isQueryBasedFilteringEnabled(): boolean {
        return this.getConfig().enableQueryBasedFiltering;
    }
}

// Export singleton instance
const pipelineConfigService = new PipelineConfigService();
export default pipelineConfigService;

/**
 * Export convenience functions
 */
export function getPipelineConfig(): PipelineConfig {
    return pipelineConfigService.getConfig();
}

export function reloadPipelineConfig(): void {
    pipelineConfigService.reload();
}
