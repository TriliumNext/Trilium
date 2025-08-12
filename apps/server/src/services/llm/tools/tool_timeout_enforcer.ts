/**
 * Tool Timeout Enforcer
 * 
 * Implements timeout enforcement for tool executions with configurable timeouts
 * per tool type, graceful cleanup, and Promise.race pattern for detection.
 */

import log from '../../log.js';
import type { ToolHandler } from './tool_interfaces.js';

/**
 * Timeout configuration per tool type
 */
export interface TimeoutConfig {
    /** Timeout for search operations in milliseconds */
    search: number;
    /** Timeout for create/update operations in milliseconds */
    mutation: number;
    /** Timeout for script execution in milliseconds */
    script: number;
    /** Default timeout for unspecified tools in milliseconds */
    default: number;
}

/**
 * Tool execution result with timeout metadata
 */
export interface TimeoutResult<T = any> {
    success: boolean;
    result?: T;
    error?: Error;
    timedOut: boolean;
    executionTime: number;
    toolName: string;
}

/**
 * Tool categories for timeout assignment
 */
export enum ToolCategory {
    SEARCH = 'search',
    MUTATION = 'mutation',
    SCRIPT = 'script',
    READ = 'read',
    DEFAULT = 'default'
}

/**
 * Default timeout configuration
 */
const DEFAULT_TIMEOUTS: TimeoutConfig = {
    search: 5000,      // 5 seconds for search operations
    mutation: 3000,    // 3 seconds for create/update operations  
    script: 10000,     // 10 seconds for script execution
    default: 5000      // 5 seconds default
};

/**
 * Tool timeout enforcer class
 */
export class ToolTimeoutEnforcer {
    private timeouts: TimeoutConfig;
    private executionStats: Map<string, { total: number; timeouts: number; avgTime: number }>;
    private activeExecutions: Map<string, AbortController>;

    constructor(timeoutConfig?: Partial<TimeoutConfig>) {
        this.timeouts = { ...DEFAULT_TIMEOUTS, ...timeoutConfig };
        this.executionStats = new Map();
        this.activeExecutions = new Map();
    }

    /**
     * Categorize tool based on its name
     */
    private categorizeeTool(toolName: string): ToolCategory {
        const name = toolName.toLowerCase();
        
        // Search tools
        if (name.includes('search') || name.includes('find') || name.includes('query')) {
            return ToolCategory.SEARCH;
        }
        
        // Mutation tools
        if (name.includes('create') || name.includes('update') || name.includes('delete') || 
            name.includes('modify') || name.includes('save')) {
            return ToolCategory.MUTATION;
        }
        
        // Script tools
        if (name.includes('script') || name.includes('execute') || name.includes('eval')) {
            return ToolCategory.SCRIPT;
        }
        
        // Read tools
        if (name.includes('read') || name.includes('get') || name.includes('fetch')) {
            return ToolCategory.READ;
        }
        
        return ToolCategory.DEFAULT;
    }

    /**
     * Get timeout for a specific tool
     */
    private getToolTimeout(toolName: string): number {
        const category = this.categorizeeTool(toolName);
        
        switch (category) {
            case ToolCategory.SEARCH:
                return this.timeouts.search;
            case ToolCategory.MUTATION:
                return this.timeouts.mutation;
            case ToolCategory.SCRIPT:
                return this.timeouts.script;
            case ToolCategory.READ:
                return this.timeouts.search; // Use search timeout for read operations
            default:
                return this.timeouts.default;
        }
    }

    /**
     * Execute a tool with timeout enforcement
     */
    async executeWithTimeout<T>(
        toolName: string,
        executeFn: () => Promise<T>,
        customTimeout?: number
    ): Promise<TimeoutResult<T>> {
        const timeout = customTimeout || this.getToolTimeout(toolName);
        const startTime = Date.now();
        const executionId = `${toolName}_${startTime}_${Math.random()}`;
        
        // Create abort controller for cleanup
        const abortController = new AbortController();
        this.activeExecutions.set(executionId, abortController);
        
        log.info(`Executing tool '${toolName}' with timeout ${timeout}ms`);
        
        try {
            // Create timeout promise
            const timeoutPromise = new Promise<never>((_, reject) => {
                const timer = setTimeout(() => {
                    abortController.abort();
                    reject(new Error(`Tool '${toolName}' execution timed out after ${timeout}ms`));
                }, timeout);
                
                // Clean up timer if aborted
                abortController.signal.addEventListener('abort', () => clearTimeout(timer));
            });
            
            // Race between execution and timeout
            const result = await Promise.race([
                executeFn(),
                timeoutPromise
            ]);
            
            const executionTime = Date.now() - startTime;
            
            // Update statistics
            this.updateStats(toolName, false, executionTime);
            
            log.info(`Tool '${toolName}' completed successfully in ${executionTime}ms`);
            
            return {
                success: true,
                result,
                timedOut: false,
                executionTime,
                toolName
            };
            
        } catch (error) {
            const executionTime = Date.now() - startTime;
            const timedOut = executionTime >= timeout - 50; // Allow 50ms buffer
            
            // Update statistics
            this.updateStats(toolName, timedOut, executionTime);
            
            if (timedOut) {
                log.error(`Tool '${toolName}' timed out after ${executionTime}ms`);
            } else {
                log.error(`Tool '${toolName}' failed after ${executionTime}ms: ${error}`);
            }
            
            return {
                success: false,
                error: error as Error,
                timedOut,
                executionTime,
                toolName
            };
            
        } finally {
            // Clean up
            this.activeExecutions.delete(executionId);
            if (!abortController.signal.aborted) {
                abortController.abort();
            }
        }
    }

    /**
     * Execute multiple tools with timeout enforcement
     */
    async executeBatchWithTimeout<T>(
        executions: Array<{
            toolName: string;
            executeFn: () => Promise<T>;
            customTimeout?: number;
        }>
    ): Promise<TimeoutResult<T>[]> {
        return Promise.all(
            executions.map(({ toolName, executeFn, customTimeout }) =>
                this.executeWithTimeout(toolName, executeFn, customTimeout)
            )
        );
    }

    /**
     * Wrap a tool handler with timeout enforcement
     */
    wrapToolHandler(handler: ToolHandler, customTimeout?: number): ToolHandler {
        const toolName = handler.definition.function.name;
        
        return {
            definition: handler.definition,
            execute: async (args: Record<string, unknown>) => {
                const result = await this.executeWithTimeout(
                    toolName,
                    () => handler.execute(args),
                    customTimeout
                );
                
                if (!result.success) {
                    if (result.timedOut) {
                        throw new Error(`Tool execution timed out after ${result.executionTime}ms`);
                    }
                    throw result.error;
                }
                
                return result.result!;
            }
        };
    }

    /**
     * Update execution statistics
     */
    private updateStats(toolName: string, timedOut: boolean, executionTime: number): void {
        const current = this.executionStats.get(toolName) || { 
            total: 0, 
            timeouts: 0, 
            avgTime: 0 
        };
        
        const newTotal = current.total + 1;
        const newTimeouts = current.timeouts + (timedOut ? 1 : 0);
        const newAvgTime = (current.avgTime * current.total + executionTime) / newTotal;
        
        this.executionStats.set(toolName, {
            total: newTotal,
            timeouts: newTimeouts,
            avgTime: newAvgTime
        });
    }

    /**
     * Get execution statistics for a tool
     */
    getToolStats(toolName: string) {
        return this.executionStats.get(toolName);
    }

    /**
     * Get all execution statistics
     */
    getAllStats() {
        return Object.fromEntries(this.executionStats);
    }

    /**
     * Clear statistics
     */
    clearStats(): void {
        this.executionStats.clear();
    }

    /**
     * Abort all active executions
     */
    abortAll(): void {
        log.info(`Aborting ${this.activeExecutions.size} active tool executions`);
        
        for (const [id, controller] of this.activeExecutions) {
            controller.abort();
        }
        
        this.activeExecutions.clear();
    }

    /**
     * Get timeout configuration
     */
    getTimeouts(): TimeoutConfig {
        return { ...this.timeouts };
    }

    /**
     * Update timeout configuration
     */
    updateTimeouts(config: Partial<TimeoutConfig>): void {
        this.timeouts = { ...this.timeouts, ...config };
        log.info(`Updated timeout configuration: ${JSON.stringify(this.timeouts)}`);
    }

    /**
     * Check if a tool has high timeout rate
     */
    hasHighTimeoutRate(toolName: string, threshold: number = 0.5): boolean {
        const stats = this.executionStats.get(toolName);
        if (!stats || stats.total === 0) return false;
        
        return (stats.timeouts / stats.total) > threshold;
    }
}

// Export singleton instance
export const toolTimeoutEnforcer = new ToolTimeoutEnforcer();