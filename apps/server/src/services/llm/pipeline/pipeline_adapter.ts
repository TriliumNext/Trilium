/**
 * Pipeline Adapter
 * 
 * Provides compatibility layer between the existing ChatPipeline 
 * and the new SimplifiedChatPipeline implementation.
 * This allows gradual migration without breaking existing code.
 */

import type { ChatPipelineInput, ChatPipelineConfig, PipelineMetrics } from './interfaces.js';
import type { ChatResponse } from '../ai_interface.js';
import simplifiedPipeline from './simplified_pipeline.js';
import configurationService from './configuration_service.js';
import loggingService, { LogLevel } from './logging_service.js';

/**
 * Adapter class that maintains the existing ChatPipeline interface
 * while using the new simplified implementation underneath
 */
export class ChatPipelineAdapter {
    private config: ChatPipelineConfig;
    private useSimplified: boolean;

    constructor(config?: Partial<ChatPipelineConfig>) {
        // Initialize configuration service on first use
        this.initializeServices();
        
        // Merge provided config with defaults from configuration service
        const toolConfig = configurationService.getToolConfig();
        const streamingConfig = configurationService.getStreamingConfig();
        const debugConfig = configurationService.getDebugConfig();
        
        this.config = {
            enableStreaming: streamingConfig.enabled,
            enableMetrics: debugConfig.enableMetrics,
            maxToolCallIterations: toolConfig.maxIterations,
            ...config
        };
        
        // Check if we should use the simplified pipeline
        this.useSimplified = this.shouldUseSimplified();
    }

    /**
     * Initialize configuration and logging services
     */
    private async initializeServices(): Promise<void> {
        try {
            // Initialize configuration service
            const validationResult = await configurationService.initialize();
            if (!validationResult.valid) {
                loggingService.error('Configuration validation failed', validationResult.errors);
            }
            
            // Reload logging configuration
            loggingService.reloadConfiguration();
            
        } catch (error) {
            loggingService.error('Failed to initialize services', error);
        }
    }

    /**
     * Determine if we should use the simplified pipeline
     */
    private shouldUseSimplified(): boolean {
        // Check environment variable or feature flag
        const useSimplified = process.env.USE_SIMPLIFIED_PIPELINE;
        if (useSimplified === 'true') return true;
        if (useSimplified === 'false') return false;
        
        // Default to using simplified pipeline
        return true;
    }

    /**
     * Execute the pipeline (compatible with existing interface)
     */
    async execute(input: ChatPipelineInput): Promise<ChatResponse> {
        if (this.useSimplified) {
            // Use the new simplified pipeline
            return await simplifiedPipeline.execute({
                messages: input.messages,
                options: input.options,
                noteId: input.noteId,
                query: input.query,
                streamCallback: input.streamCallback,
                requestId: this.generateRequestId()
            });
        } else {
            // Fall back to the original implementation if needed
            // This would import and use the original ChatPipeline
            throw new Error('Original pipeline not available - use simplified pipeline');
        }
    }

    /**
     * Get pipeline metrics (compatible with existing interface)
     */
    getMetrics(): PipelineMetrics {
        if (this.useSimplified) {
            const metrics = simplifiedPipeline.getMetrics();
            
            // Convert simplified metrics to existing format
            const stageMetrics: Record<string, any> = {};
            Object.entries(metrics).forEach(([key, value]) => {
                stageMetrics[key] = {
                    totalExecutions: 0, // Not tracked in simplified version
                    averageExecutionTime: value
                };
            });
            
            return {
                totalExecutions: 0,
                averageExecutionTime: metrics['pipeline_duration'] || 0,
                stageMetrics
            };
        } else {
            // Return empty metrics for original pipeline
            return {
                totalExecutions: 0,
                averageExecutionTime: 0,
                stageMetrics: {}
            };
        }
    }

    /**
     * Reset pipeline metrics (compatible with existing interface)
     */
    resetMetrics(): void {
        if (this.useSimplified) {
            simplifiedPipeline.resetMetrics();
        }
    }

    /**
     * Generate a unique request ID
     */
    private generateRequestId(): string {
        return `req_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    }
}

/**
 * Factory function to create ChatPipeline instances
 * This maintains backward compatibility with existing code
 */
export function createChatPipeline(config?: Partial<ChatPipelineConfig>) {
    return new ChatPipelineAdapter(config);
}

/**
 * Export as ChatPipeline for drop-in replacement
 */
export const ChatPipeline = ChatPipelineAdapter;