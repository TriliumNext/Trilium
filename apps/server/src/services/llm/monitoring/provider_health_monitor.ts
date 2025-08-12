/**
 * Provider Health Monitor
 * 
 * Monitors health status of LLM providers with periodic checks,
 * automatic disabling after failures, and event emissions.
 */

import { EventEmitter } from 'events';
import log from '../../log.js';
import type { AIService } from '../ai_interface.js';
import type { ProviderType } from '../providers/provider_factory.js';

/**
 * Provider health status
 */
export interface ProviderHealth {
    provider: string;
    healthy: boolean;
    lastChecked: Date;
    lastSuccessful?: Date;
    consecutiveFailures: number;
    totalChecks: number;
    totalFailures: number;
    averageLatency: number;
    lastError?: string;
    disabled: boolean;
    disabledAt?: Date;
    disabledReason?: string;
}

/**
 * Health check result
 */
interface HealthCheckResult {
    success: boolean;
    latency: number;
    error?: string;
    tokensUsed?: number;
}

/**
 * Health monitor configuration
 */
export interface HealthMonitorConfig {
    /** Check interval in milliseconds (default: 60000) */
    checkInterval: number;
    /** Number of consecutive failures before disabling (default: 3) */
    failureThreshold: number;
    /** Timeout for health checks in milliseconds (default: 5000) */
    checkTimeout: number;
    /** Enable automatic recovery attempts (default: true) */
    autoRecover: boolean;
    /** Recovery check interval in milliseconds (default: 300000) */
    recoveryInterval: number;
    /** Minimum time between checks in milliseconds (default: 30000) */
    minCheckInterval: number;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: HealthMonitorConfig = {
    checkInterval: 60000,        // 1 minute
    failureThreshold: 3,
    checkTimeout: 5000,          // 5 seconds
    autoRecover: true,
    recoveryInterval: 300000,    // 5 minutes
    minCheckInterval: 30000      // 30 seconds
};

/**
 * Provider health monitor class
 */
export class ProviderHealthMonitor extends EventEmitter {
    private config: HealthMonitorConfig;
    private providers: Map<string, AIService>;
    private healthStatus: Map<string, ProviderHealth>;
    private checkTimers: Map<string, NodeJS.Timeout>;
    private isMonitoring: boolean;
    private lastCheckTime: Map<string, number>;

    constructor(config?: Partial<HealthMonitorConfig>) {
        super();
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.providers = new Map();
        this.healthStatus = new Map();
        this.checkTimers = new Map();
        this.isMonitoring = false;
        this.lastCheckTime = new Map();
    }

    /**
     * Register a provider for monitoring
     */
    registerProvider(name: string, service: AIService): void {
        this.providers.set(name, service);
        this.healthStatus.set(name, {
            provider: name,
            healthy: true,
            lastChecked: new Date(),
            consecutiveFailures: 0,
            totalChecks: 0,
            totalFailures: 0,
            averageLatency: 0,
            disabled: false
        });
        
        log.info(`Registered provider '${name}' for health monitoring`);
        
        // Start monitoring if not already running
        if (!this.isMonitoring) {
            this.startMonitoring();
        }
    }

    /**
     * Unregister a provider
     */
    unregisterProvider(name: string): void {
        this.providers.delete(name);
        this.healthStatus.delete(name);
        
        const timer = this.checkTimers.get(name);
        if (timer) {
            clearTimeout(timer);
            this.checkTimers.delete(name);
        }
        
        log.info(`Unregistered provider '${name}' from health monitoring`);
    }

    /**
     * Start health monitoring
     */
    startMonitoring(): void {
        if (this.isMonitoring) {
            log.info('Health monitoring is already running');
            return;
        }
        
        this.isMonitoring = true;
        log.info('Starting provider health monitoring');
        
        // Schedule initial checks for all providers
        for (const provider of this.providers.keys()) {
            this.scheduleHealthCheck(provider);
        }
        
        this.emit('monitoring:started');
    }

    /**
     * Stop health monitoring
     */
    stopMonitoring(): void {
        if (!this.isMonitoring) {
            return;
        }
        
        this.isMonitoring = false;
        
        // Clear all timers
        for (const timer of this.checkTimers.values()) {
            clearTimeout(timer);
        }
        this.checkTimers.clear();
        
        log.info('Stopped provider health monitoring');
        this.emit('monitoring:stopped');
    }

    /**
     * Schedule a health check for a provider
     */
    private scheduleHealthCheck(provider: string, delay?: number): void {
        if (!this.isMonitoring) return;
        
        // Clear existing timer
        const existingTimer = this.checkTimers.get(provider);
        if (existingTimer) {
            clearTimeout(existingTimer);
        }
        
        // Calculate delay based on provider status
        const status = this.healthStatus.get(provider);
        const checkDelay = delay || (status?.disabled 
            ? this.config.recoveryInterval 
            : this.config.checkInterval);
        
        // Schedule the check
        const timer = setTimeout(async () => {
            await this.performHealthCheck(provider);
            
            // Schedule next check
            if (this.isMonitoring) {
                this.scheduleHealthCheck(provider);
            }
        }, checkDelay);
        
        this.checkTimers.set(provider, timer);
    }

    /**
     * Perform a health check for a provider
     */
    private async performHealthCheck(provider: string): Promise<HealthCheckResult> {
        const service = this.providers.get(provider);
        const status = this.healthStatus.get(provider);
        
        if (!service || !status) {
            return { success: false, latency: 0, error: 'Provider not found' };
        }
        
        // Check if enough time has passed since last check
        const lastCheck = this.lastCheckTime.get(provider) || 0;
        const now = Date.now();
        if (now - lastCheck < this.config.minCheckInterval) {
            log.info(`Skipping health check for ${provider}, too soon since last check`);
            return { success: true, latency: 0 };
        }
        
        this.lastCheckTime.set(provider, now);
        
        log.info(`Performing health check for provider '${provider}'`);
        
        const startTime = Date.now();
        
        try {
            // Simple ping test with minimal token usage
            const result = await Promise.race([
                service.generateChatCompletion(
                    [{ 
                        role: 'user', 
                        content: 'Hi' 
                    }],
                    {
                        model: 'default', // Use a default model name
                        maxTokens: 5,
                        temperature: 0
                    }
                ),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Health check timeout')), 
                    this.config.checkTimeout)
                )
            ]);
            
            const latency = Date.now() - startTime;
            
            // Update status for successful check
            this.updateHealthStatus(provider, {
                success: true,
                latency,
                tokensUsed: (result as any).usage?.totalTokens
            });
            
            log.info(`Health check successful for '${provider}' (${latency}ms)`);
            
            return { success: true, latency, tokensUsed: (result as any).usage?.totalTokens };
            
        } catch (error) {
            const latency = Date.now() - startTime;
            const errorMessage = error instanceof Error ? error.message : String(error);
            
            // Update status for failed check
            this.updateHealthStatus(provider, {
                success: false,
                latency,
                error: errorMessage
            });
            
            log.error(`Health check failed for '${provider}': ${errorMessage}`);
            
            return { success: false, latency, error: errorMessage };
        }
    }

    /**
     * Update health status based on check result
     */
    private updateHealthStatus(provider: string, result: HealthCheckResult): void {
        const status = this.healthStatus.get(provider);
        if (!status) return;
        
        const wasHealthy = status.healthy;
        const wasDisabled = status.disabled;
        
        // Update basic stats
        status.lastChecked = new Date();
        status.totalChecks++;
        
        if (result.success) {
            // Successful check
            status.healthy = true;
            status.lastSuccessful = new Date();
            status.consecutiveFailures = 0;
            status.lastError = undefined;
            
            // Update average latency
            const prevTotal = status.averageLatency * (status.totalChecks - 1);
            status.averageLatency = (prevTotal + result.latency) / status.totalChecks;
            
            // Re-enable if was disabled and auto-recover is on
            if (status.disabled && this.config.autoRecover) {
                status.disabled = false;
                status.disabledAt = undefined;
                status.disabledReason = undefined;
                
                log.info(`Provider '${provider}' recovered and re-enabled`);
                this.emit('provider:recovered', { provider, status });
            }
            
        } else {
            // Failed check
            status.totalFailures++;
            status.consecutiveFailures++;
            status.lastError = result.error;
            
            // Check if should disable
            if (status.consecutiveFailures >= this.config.failureThreshold) {
                status.healthy = false;
                
                if (!status.disabled) {
                    status.disabled = true;
                    status.disabledAt = new Date();
                    status.disabledReason = `${status.consecutiveFailures} consecutive failures`;
                    
                    log.error(`Provider '${provider}' disabled after ${status.consecutiveFailures} failures`);
                    this.emit('provider:disabled', { provider, status, reason: status.disabledReason });
                }
            }
        }
        
        // Emit status change events
        if (wasHealthy !== status.healthy) {
            this.emit('provider:health-changed', { 
                provider, 
                healthy: status.healthy, 
                status 
            });
        }
        
        if (wasDisabled !== status.disabled) {
            this.emit('provider:status-changed', { 
                provider, 
                disabled: status.disabled, 
                status 
            });
        }
    }

    /**
     * Manually trigger a health check
     */
    async checkProvider(provider: string): Promise<HealthCheckResult> {
        return this.performHealthCheck(provider);
    }

    /**
     * Check all providers
     */
    async checkAllProviders(): Promise<Map<string, HealthCheckResult>> {
        const results = new Map<string, HealthCheckResult>();
        
        const checks = Array.from(this.providers.keys()).map(async provider => {
            const result = await this.performHealthCheck(provider);
            results.set(provider, result);
        });
        
        await Promise.all(checks);
        return results;
    }

    /**
     * Get health status for a provider
     */
    getProviderHealth(provider: string): ProviderHealth | undefined {
        return this.healthStatus.get(provider);
    }

    /**
     * Get all health statuses
     */
    getAllHealthStatus(): Map<string, ProviderHealth> {
        return new Map(this.healthStatus);
    }

    /**
     * Check if a provider is healthy
     */
    isProviderHealthy(provider: string): boolean {
        const status = this.healthStatus.get(provider);
        return status ? status.healthy && !status.disabled : false;
    }

    /**
     * Get healthy providers
     */
    getHealthyProviders(): string[] {
        return Array.from(this.healthStatus.entries())
            .filter(([_, status]) => status.healthy && !status.disabled)
            .map(([provider, _]) => provider);
    }

    /**
     * Manually enable a provider
     */
    enableProvider(provider: string): void {
        const status = this.healthStatus.get(provider);
        if (status && status.disabled) {
            status.disabled = false;
            status.disabledAt = undefined;
            status.disabledReason = undefined;
            status.consecutiveFailures = 0;
            
            log.info(`Provider '${provider}' manually enabled`);
            this.emit('provider:enabled', { provider, status });
            
            // Schedule immediate health check
            this.scheduleHealthCheck(provider, 0);
        }
    }

    /**
     * Manually disable a provider
     */
    disableProvider(provider: string, reason?: string): void {
        const status = this.healthStatus.get(provider);
        if (status && !status.disabled) {
            status.disabled = true;
            status.disabledAt = new Date();
            status.disabledReason = reason || 'Manually disabled';
            status.healthy = false;
            
            log.info(`Provider '${provider}' manually disabled: ${status.disabledReason}`);
            this.emit('provider:disabled', { provider, status, reason: status.disabledReason });
        }
    }

    /**
     * Reset statistics for a provider
     */
    resetProviderStats(provider: string): void {
        const status = this.healthStatus.get(provider);
        if (status) {
            status.totalChecks = 0;
            status.totalFailures = 0;
            status.averageLatency = 0;
            status.consecutiveFailures = 0;
            
            log.info(`Reset statistics for provider '${provider}'`);
        }
    }

    /**
     * Get monitoring configuration
     */
    getConfig(): HealthMonitorConfig {
        return { ...this.config };
    }

    /**
     * Update monitoring configuration
     */
    updateConfig(config: Partial<HealthMonitorConfig>): void {
        this.config = { ...this.config, ...config };
        log.info(`Updated health monitor configuration: ${JSON.stringify(this.config)}`);
        
        // Restart monitoring with new config
        if (this.isMonitoring) {
            this.stopMonitoring();
            this.startMonitoring();
        }
    }
}

// Export singleton instance
export const providerHealthMonitor = new ProviderHealthMonitor();