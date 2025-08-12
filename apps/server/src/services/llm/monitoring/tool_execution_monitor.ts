/**
 * Tool Execution Monitor
 * 
 * Tracks success/failure rates per tool and provider, calculates reliability scores,
 * auto-disables unreliable tools, and provides metrics for dashboards.
 */

import { EventEmitter } from 'events';
import log from '../../log.js';

/**
 * Tool execution statistics
 */
export interface ToolExecutionStats {
    toolName: string;
    provider: string;
    totalExecutions: number;
    successfulExecutions: number;
    failedExecutions: number;
    timeoutExecutions: number;
    averageExecutionTime: number;
    minExecutionTime: number;
    maxExecutionTime: number;
    lastExecutionTime?: number;
    lastExecutionStatus?: 'success' | 'failure' | 'timeout';
    lastError?: string;
    reliabilityScore: number;
    disabled: boolean;
    disabledAt?: Date;
    disabledReason?: string;
}

/**
 * Execution record
 */
export interface ExecutionRecord {
    toolName: string;
    provider: string;
    status: 'success' | 'failure' | 'timeout';
    executionTime: number;
    timestamp: Date;
    error?: string;
    inputSize?: number;
    outputSize?: number;
}

/**
 * Monitor configuration
 */
export interface MonitorConfig {
    /** Failure rate threshold for auto-disable (default: 0.5) */
    failureRateThreshold: number;
    /** Minimum executions before calculating reliability (default: 5) */
    minExecutionsForReliability: number;
    /** Time window for recent stats in milliseconds (default: 3600000) */
    recentStatsWindow: number;
    /** Enable auto-disable of unreliable tools (default: true) */
    autoDisable: boolean;
    /** Cooldown period after disable in milliseconds (default: 300000) */
    disableCooldown: number;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: MonitorConfig = {
    failureRateThreshold: 0.5,
    minExecutionsForReliability: 5,
    recentStatsWindow: 3600000,      // 1 hour
    autoDisable: true,
    disableCooldown: 300000           // 5 minutes
};

/**
 * Tool execution monitor class
 */
export class ToolExecutionMonitor extends EventEmitter {
    private config: MonitorConfig;
    private stats: Map<string, ToolExecutionStats>;
    private recentExecutions: ExecutionRecord[];
    private disabledTools: Set<string>;

    constructor(config?: Partial<MonitorConfig>) {
        super();
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.stats = new Map();
        this.recentExecutions = [];
        this.disabledTools = new Set();
    }

    /**
     * Record a tool execution
     */
    recordExecution(record: ExecutionRecord): void {
        const key = this.getStatsKey(record.toolName, record.provider);
        
        // Update or create stats
        let stats = this.stats.get(key);
        if (!stats) {
            stats = this.createEmptyStats(record.toolName, record.provider);
            this.stats.set(key, stats);
        }
        
        // Update counters
        stats.totalExecutions++;
        
        switch (record.status) {
            case 'success':
                stats.successfulExecutions++;
                break;
            case 'failure':
                stats.failedExecutions++;
                break;
            case 'timeout':
                stats.timeoutExecutions++;
                break;
        }
        
        // Update timing statistics
        this.updateTimingStats(stats, record.executionTime);
        
        // Update last execution info
        stats.lastExecutionTime = record.executionTime;
        stats.lastExecutionStatus = record.status;
        stats.lastError = record.error;
        
        // Calculate reliability score
        stats.reliabilityScore = this.calculateReliabilityScore(stats);
        
        // Add to recent executions
        this.recentExecutions.push(record);
        this.pruneRecentExecutions();
        
        // Check if tool should be auto-disabled
        if (this.config.autoDisable && this.shouldAutoDisable(stats)) {
            this.disableTool(record.toolName, record.provider, 'High failure rate');
        }
        
        // Emit events
        this.emit('execution:recorded', record);
        
        if (record.status === 'failure') {
            this.emit('execution:failed', record);
        } else if (record.status === 'timeout') {
            this.emit('execution:timeout', record);
        }
        
        // Log if reliability is concerning
        if (stats.reliabilityScore < 0.5 && stats.totalExecutions >= this.config.minExecutionsForReliability) {
            log.info(`Tool '${record.toolName}' has low reliability score: ${stats.reliabilityScore.toFixed(2)}`);
        }
    }

    /**
     * Update timing statistics
     */
    private updateTimingStats(stats: ToolExecutionStats, executionTime: number): void {
        const prevAvg = stats.averageExecutionTime;
        const prevCount = stats.totalExecutions - 1;
        
        // Update average
        stats.averageExecutionTime = prevCount === 0 
            ? executionTime 
            : (prevAvg * prevCount + executionTime) / stats.totalExecutions;
        
        // Update min/max
        if (stats.minExecutionTime === 0 || executionTime < stats.minExecutionTime) {
            stats.minExecutionTime = executionTime;
        }
        if (executionTime > stats.maxExecutionTime) {
            stats.maxExecutionTime = executionTime;
        }
    }

    /**
     * Calculate reliability score (0-1)
     */
    private calculateReliabilityScore(stats: ToolExecutionStats): number {
        if (stats.totalExecutions === 0) return 1;
        
        // Weight factors
        const successWeight = 0.7;
        const timeoutWeight = 0.2;
        const consistencyWeight = 0.1;
        
        // Success rate
        const successRate = stats.successfulExecutions / stats.totalExecutions;
        
        // Timeout penalty
        const timeoutRate = stats.timeoutExecutions / stats.totalExecutions;
        const timeoutScore = 1 - timeoutRate;
        
        // Consistency score (based on execution time variance)
        let consistencyScore = 1;
        if (stats.totalExecutions > 1 && stats.averageExecutionTime > 0) {
            const variance = (stats.maxExecutionTime - stats.minExecutionTime) / stats.averageExecutionTime;
            consistencyScore = Math.max(0, 1 - variance / 10); // Normalize variance
        }
        
        // Calculate weighted score
        const score = 
            successRate * successWeight +
            timeoutScore * timeoutWeight +
            consistencyScore * consistencyWeight;
        
        return Math.min(1, Math.max(0, score));
    }

    /**
     * Check if tool should be auto-disabled
     */
    private shouldAutoDisable(stats: ToolExecutionStats): boolean {
        // Don't disable if already disabled
        if (stats.disabled) return false;
        
        // Need minimum executions
        if (stats.totalExecutions < this.config.minExecutionsForReliability) {
            return false;
        }
        
        // Check failure rate
        const failureRate = (stats.failedExecutions + stats.timeoutExecutions) / stats.totalExecutions;
        return failureRate > this.config.failureRateThreshold;
    }

    /**
     * Disable a tool
     */
    disableTool(toolName: string, provider: string, reason: string): void {
        const key = this.getStatsKey(toolName, provider);
        const stats = this.stats.get(key);
        
        if (!stats || stats.disabled) return;
        
        stats.disabled = true;
        stats.disabledAt = new Date();
        stats.disabledReason = reason;
        
        this.disabledTools.add(key);
        
        log.error(`Tool '${toolName}' disabled for provider '${provider}': ${reason}`);
        this.emit('tool:disabled', { toolName, provider, reason, stats });
        
        // Schedule re-enable check
        if (this.config.disableCooldown > 0) {
            setTimeout(() => {
                this.checkReEnableTool(toolName, provider);
            }, this.config.disableCooldown);
        }
    }

    /**
     * Check if a tool can be re-enabled
     */
    private checkReEnableTool(toolName: string, provider: string): void {
        const key = this.getStatsKey(toolName, provider);
        const stats = this.stats.get(key);
        
        if (!stats || !stats.disabled) return;
        
        // Calculate recent success rate
        const recentExecutions = this.getRecentExecutions(toolName, provider);
        if (recentExecutions.length === 0) {
            // No recent executions, re-enable for retry
            this.enableTool(toolName, provider);
            return;
        }
        
        const recentSuccesses = recentExecutions.filter(e => e.status === 'success').length;
        const recentSuccessRate = recentSuccesses / recentExecutions.length;
        
        // Re-enable if recent performance is good
        if (recentSuccessRate > 0.7) {
            this.enableTool(toolName, provider);
        }
    }

    /**
     * Enable a tool
     */
    enableTool(toolName: string, provider: string): void {
        const key = this.getStatsKey(toolName, provider);
        const stats = this.stats.get(key);
        
        if (!stats || !stats.disabled) return;
        
        stats.disabled = false;
        stats.disabledAt = undefined;
        stats.disabledReason = undefined;
        
        this.disabledTools.delete(key);
        
        log.info(`Tool '${toolName}' re-enabled for provider '${provider}'`);
        this.emit('tool:enabled', { toolName, provider, stats });
    }

    /**
     * Get stats for a tool
     */
    getToolStats(toolName: string, provider: string): ToolExecutionStats | undefined {
        return this.stats.get(this.getStatsKey(toolName, provider));
    }

    /**
     * Get all stats
     */
    getAllStats(): Map<string, ToolExecutionStats> {
        return new Map(this.stats);
    }

    /**
     * Get stats by provider
     */
    getStatsByProvider(provider: string): ToolExecutionStats[] {
        return Array.from(this.stats.values()).filter(s => s.provider === provider);
    }

    /**
     * Get stats by tool
     */
    getStatsByTool(toolName: string): ToolExecutionStats[] {
        return Array.from(this.stats.values()).filter(s => s.toolName === toolName);
    }

    /**
     * Get recent executions for a tool
     */
    getRecentExecutions(toolName: string, provider: string): ExecutionRecord[] {
        const cutoff = Date.now() - this.config.recentStatsWindow;
        return this.recentExecutions.filter(e => 
            e.toolName === toolName &&
            e.provider === provider &&
            e.timestamp.getTime() > cutoff
        );
    }

    /**
     * Get metrics for dashboard
     */
    getDashboardMetrics(): {
        totalTools: number;
        activeTools: number;
        disabledTools: number;
        overallReliability: number;
        topPerformers: ToolExecutionStats[];
        bottomPerformers: ToolExecutionStats[];
        recentFailures: ExecutionRecord[];
    } {
        const allStats = Array.from(this.stats.values());
        const activeStats = allStats.filter(s => !s.disabled);
        
        // Calculate overall reliability
        const overallReliability = activeStats.length > 0
            ? activeStats.reduce((sum, s) => sum + s.reliabilityScore, 0) / activeStats.length
            : 1;
        
        // Sort by reliability
        const sorted = [...allStats].sort((a, b) => b.reliabilityScore - a.reliabilityScore);
        
        // Get recent failures
        const recentFailures = this.recentExecutions
            .filter(e => e.status !== 'success')
            .slice(-10);
        
        return {
            totalTools: allStats.length,
            activeTools: activeStats.length,
            disabledTools: this.disabledTools.size,
            overallReliability,
            topPerformers: sorted.slice(0, 5),
            bottomPerformers: sorted.slice(-5).reverse(),
            recentFailures
        };
    }

    /**
     * Check if a tool is disabled
     */
    isToolDisabled(toolName: string, provider: string): boolean {
        return this.disabledTools.has(this.getStatsKey(toolName, provider));
    }

    /**
     * Reset stats for a tool
     */
    resetToolStats(toolName: string, provider: string): void {
        const key = this.getStatsKey(toolName, provider);
        this.stats.delete(key);
        this.disabledTools.delete(key);
        
        // Remove from recent executions
        this.recentExecutions = this.recentExecutions.filter(e =>
            !(e.toolName === toolName && e.provider === provider)
        );
        
        log.info(`Reset stats for tool '${toolName}' with provider '${provider}'`);
    }

    /**
     * Reset all statistics
     */
    resetAllStats(): void {
        this.stats.clear();
        this.recentExecutions = [];
        this.disabledTools.clear();
        log.info('Reset all tool execution statistics');
    }

    /**
     * Prune old recent executions
     */
    private pruneRecentExecutions(): void {
        const cutoff = Date.now() - this.config.recentStatsWindow;
        this.recentExecutions = this.recentExecutions.filter(e =>
            e.timestamp.getTime() > cutoff
        );
    }

    /**
     * Create empty stats object
     */
    private createEmptyStats(toolName: string, provider: string): ToolExecutionStats {
        return {
            toolName,
            provider,
            totalExecutions: 0,
            successfulExecutions: 0,
            failedExecutions: 0,
            timeoutExecutions: 0,
            averageExecutionTime: 0,
            minExecutionTime: 0,
            maxExecutionTime: 0,
            reliabilityScore: 1,
            disabled: false
        };
    }

    /**
     * Get stats key
     */
    private getStatsKey(toolName: string, provider: string): string {
        return `${provider}:${toolName}`;
    }

    /**
     * Export statistics to JSON
     */
    exportStats(): string {
        return JSON.stringify({
            stats: Array.from(this.stats.entries()),
            recentExecutions: this.recentExecutions,
            disabledTools: Array.from(this.disabledTools),
            config: this.config
        }, null, 2);
    }

    /**
     * Import statistics from JSON
     */
    importStats(json: string): void {
        try {
            const data = JSON.parse(json);
            
            // Restore stats
            this.stats.clear();
            for (const [key, value] of data.stats) {
                this.stats.set(key, value);
            }
            
            // Restore recent executions with date conversion
            this.recentExecutions = data.recentExecutions.map((e: any) => ({
                ...e,
                timestamp: new Date(e.timestamp)
            }));
            
            // Restore disabled tools
            this.disabledTools = new Set(data.disabledTools);
            
            log.info('Imported tool execution statistics');
        } catch (error) {
            log.error(`Failed to import statistics: ${error}`);
            throw error;
        }
    }

    /**
     * Get configuration
     */
    getConfig(): MonitorConfig {
        return { ...this.config };
    }

    /**
     * Update configuration
     */
    updateConfig(config: Partial<MonitorConfig>): void {
        this.config = { ...this.config, ...config };
        log.info(`Updated tool execution monitor configuration: ${JSON.stringify(this.config)}`);
    }
}

// Export singleton instance
export const toolExecutionMonitor = new ToolExecutionMonitor();