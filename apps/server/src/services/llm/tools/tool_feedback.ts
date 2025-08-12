/**
 * Real-time Tool Feedback System
 * 
 * Provides real-time feedback during tool execution including progress updates,
 * intermediate results, and execution history tracking.
 */

import { EventEmitter } from 'events';
import log from '../../log.js';
import type { ToolCall } from './tool_interfaces.js';
import {
    TIMING,
    LIMITS,
    ID_PREFIXES,
    generateId,
    formatDuration
} from './tool_constants.js';

/**
 * Tool execution status
 */
export type ToolExecutionStatus = 'pending' | 'running' | 'success' | 'error' | 'cancelled' | 'timeout';

/**
 * Tool execution step
 */
export interface ToolExecutionStep {
    timestamp: Date;
    message: string;
    type: 'info' | 'warning' | 'error' | 'progress';
    data?: any;
}

/**
 * Tool execution progress
 */
export interface ToolExecutionProgress {
    current: number;
    total: number;
    percentage: number;
    message?: string;
    estimatedTimeRemaining?: number;
}

/**
 * Tool execution record
 */
export interface ToolExecutionRecord {
    id: string;
    toolName: string;
    parameters: Record<string, unknown>;
    status: ToolExecutionStatus;
    startTime: Date;
    endTime?: Date;
    duration?: number;
    steps: ToolExecutionStep[];
    progress?: ToolExecutionProgress;
    result?: any;
    error?: string;
    cancelledBy?: string;
    cancelReason?: string;
}

/**
 * Tool execution history entry
 */
export interface ToolExecutionHistoryEntry {
    id: string;
    chatNoteId?: string;
    toolName: string;
    status: ToolExecutionStatus;
    startTime: Date;
    endTime?: Date;
    duration?: number;
    parameters: Record<string, unknown>;
    result?: any;
    error?: string;
}

/**
 * Tool feedback events
 */
export interface ToolFeedbackEvents {
    'execution:start': (record: ToolExecutionRecord) => void;
    'execution:progress': (id: string, progress: ToolExecutionProgress) => void;
    'execution:step': (id: string, step: ToolExecutionStep) => void;
    'execution:complete': (record: ToolExecutionRecord) => void;
    'execution:error': (id: string, error: string) => void;
    'execution:cancelled': (id: string, reason?: string) => void;
    'execution:timeout': (id: string) => void;
}

/**
 * Tool Feedback Manager
 */
export class ToolFeedbackManager extends EventEmitter {
    private activeExecutions: Map<string, ToolExecutionRecord> = new Map();
    private executionHistory: ToolExecutionHistoryEntry[] = [];
    private maxHistorySize: number = LIMITS.MAX_HISTORY_SIZE;
    private executionTimeouts: Map<string, NodeJS.Timeout> = new Map();
    private defaultTimeout: number = TIMING.DEFAULT_TOOL_TIMEOUT;

    constructor() {
        super();
        this.setMaxListeners(LIMITS.MAX_EVENT_LISTENERS); // Allow many listeners for concurrent executions
    }

    /**
     * Start tracking a tool execution
     */
    public startExecution(
        toolCall: ToolCall,
        timeout?: number
    ): string {
        const executionId = toolCall.id || generateId(ID_PREFIXES.EXECUTION);
        
        const parameters = typeof toolCall.function.arguments === 'string'
            ? JSON.parse(toolCall.function.arguments)
            : toolCall.function.arguments;

        const record: ToolExecutionRecord = {
            id: executionId,
            toolName: toolCall.function.name,
            parameters,
            status: 'pending',
            startTime: new Date(),
            steps: []
        };

        this.activeExecutions.set(executionId, record);
        
        // Set execution timeout
        const timeoutMs = timeout || this.defaultTimeout;
        const timeoutId = setTimeout(() => {
            this.handleTimeout(executionId);
        }, timeoutMs);
        this.executionTimeouts.set(executionId, timeoutId);

        // Update status to running
        record.status = 'running';
        this.addStep(executionId, {
            timestamp: new Date(),
            message: `Starting execution of ${toolCall.function.name}`,
            type: 'info'
        });

        this.emit('execution:start', record);
        log.info(`Started tracking execution ${executionId} for tool ${toolCall.function.name}`);

        return executionId;
    }

    /**
     * Update execution progress
     */
    public updateProgress(
        executionId: string,
        current: number,
        total: number,
        message?: string
    ): void {
        const record = this.activeExecutions.get(executionId);
        if (!record) {
            log.info(`Execution ${executionId} not found for progress update`);
            return;
        }

        const percentage = total > 0 ? Math.round((current / total) * 100) : 0;
        
        // Calculate estimated time remaining based on current progress
        let estimatedTimeRemaining: number | undefined;
        if (record.startTime && percentage > 0 && percentage < 100) {
            const elapsedMs = Date.now() - record.startTime.getTime();
            const estimatedTotalMs = (elapsedMs / percentage) * 100;
            estimatedTimeRemaining = Math.round(estimatedTotalMs - elapsedMs);
        }

        const progress: ToolExecutionProgress = {
            current,
            total,
            percentage,
            message,
            estimatedTimeRemaining
        };

        record.progress = progress;
        this.emit('execution:progress', executionId, progress);

        // Add progress step if message provided
        if (message) {
            this.addStep(executionId, {
                timestamp: new Date(),
                message: `Progress: ${message} (${percentage}%)`,
                type: 'progress',
                data: { current, total, percentage }
            });
        }
    }

    /**
     * Add an execution step
     */
    public addStep(
        executionId: string,
        step: ToolExecutionStep
    ): void {
        const record = this.activeExecutions.get(executionId);
        if (!record) {
            log.info(`Execution ${executionId} not found for step addition`);
            return;
        }

        record.steps.push(step);
        this.emit('execution:step', executionId, step);

        // Log significant steps
        if (step.type === 'error' || step.type === 'warning') {
            log.info(`Tool execution step [${executionId}]: ${step.message}`);
        }
    }

    /**
     * Add intermediate result
     */
    public addIntermediateResult(
        executionId: string,
        message: string,
        data?: any
    ): void {
        this.addStep(executionId, {
            timestamp: new Date(),
            message,
            type: 'info',
            data
        });
    }

    /**
     * Complete an execution successfully
     */
    public completeExecution(
        executionId: string,
        result?: any
    ): void {
        const record = this.activeExecutions.get(executionId);
        if (!record) {
            log.info(`Execution ${executionId} not found for completion`);
            return;
        }

        // Clear timeout
        this.clearExecutionTimeout(executionId);

        record.status = 'success';
        record.endTime = new Date();
        record.duration = record.endTime.getTime() - record.startTime.getTime();
        record.result = result;

        this.addStep(executionId, {
            timestamp: new Date(),
            message: `Completed successfully in ${formatDuration(record.duration)}`,
            type: 'info',
            data: result
        });

        this.emit('execution:complete', record);
        this.moveToHistory(record);
        this.activeExecutions.delete(executionId);

        log.info(`Completed execution ${executionId} for tool ${record.toolName} in ${record.duration}ms`);
    }

    /**
     * Mark an execution as failed
     */
    public failExecution(
        executionId: string,
        error: string
    ): void {
        const record = this.activeExecutions.get(executionId);
        if (!record) {
            log.info(`Execution ${executionId} not found for failure`);
            return;
        }

        // Clear timeout
        this.clearExecutionTimeout(executionId);

        record.status = 'error';
        record.endTime = new Date();
        record.duration = record.endTime.getTime() - record.startTime.getTime();
        record.error = error;

        this.addStep(executionId, {
            timestamp: new Date(),
            message: `Failed: ${error}`,
            type: 'error'
        });

        this.emit('execution:error', executionId, error);
        this.moveToHistory(record);
        this.activeExecutions.delete(executionId);

        log.error(`Failed execution ${executionId} for tool ${record.toolName}: ${error}`);
    }

    /**
     * Cancel an execution
     */
    public cancelExecution(
        executionId: string,
        cancelledBy?: string,
        reason?: string
    ): boolean {
        const record = this.activeExecutions.get(executionId);
        if (!record) {
            log.info(`Execution ${executionId} not found for cancellation`);
            return false;
        }

        if (record.status !== 'running' && record.status !== 'pending') {
            log.info(`Cannot cancel execution ${executionId} with status ${record.status}`);
            return false;
        }

        // Clear timeout
        this.clearExecutionTimeout(executionId);

        record.status = 'cancelled';
        record.endTime = new Date();
        record.duration = record.endTime.getTime() - record.startTime.getTime();
        record.cancelledBy = cancelledBy;
        record.cancelReason = reason;

        this.addStep(executionId, {
            timestamp: new Date(),
            message: `Cancelled${cancelledBy ? ` by ${cancelledBy}` : ''}${reason ? `: ${reason}` : ''}`,
            type: 'warning'
        });

        this.emit('execution:cancelled', executionId, reason);
        this.moveToHistory(record);
        this.activeExecutions.delete(executionId);

        log.info(`Cancelled execution ${executionId} for tool ${record.toolName}`);
        return true;
    }

    /**
     * Handle execution timeout
     */
    private handleTimeout(executionId: string): void {
        const record = this.activeExecutions.get(executionId);
        if (!record || record.status !== 'running') {
            return;
        }

        record.status = 'timeout';
        record.endTime = new Date();
        record.duration = record.endTime.getTime() - record.startTime.getTime();

        this.addStep(executionId, {
            timestamp: new Date(),
            message: `Execution timed out after ${formatDuration(record.duration)}`,
            type: 'error'
        });

        this.emit('execution:timeout', executionId);
        this.moveToHistory(record);
        this.activeExecutions.delete(executionId);
        this.executionTimeouts.delete(executionId);

        log.error(`Execution ${executionId} for tool ${record.toolName} timed out`);
    }

    /**
     * Clear execution timeout
     */
    private clearExecutionTimeout(executionId: string): void {
        const timeoutId = this.executionTimeouts.get(executionId);
        if (timeoutId) {
            clearTimeout(timeoutId);
            this.executionTimeouts.delete(executionId);
        }
    }

    /**
     * Move execution record to history
     */
    private moveToHistory(record: ToolExecutionRecord): void {
        const historyEntry: ToolExecutionHistoryEntry = {
            id: record.id,
            toolName: record.toolName,
            status: record.status,
            startTime: record.startTime,
            endTime: record.endTime,
            duration: record.duration,
            parameters: record.parameters,
            result: record.result,
            error: record.error
        };

        this.executionHistory.unshift(historyEntry);

        // Trim history if needed
        if (this.executionHistory.length > this.maxHistorySize) {
            this.executionHistory = this.executionHistory.slice(0, this.maxHistorySize);
        }
    }

    /**
     * Get active executions
     */
    public getActiveExecutions(): ToolExecutionRecord[] {
        return Array.from(this.activeExecutions.values());
    }

    /**
     * Get execution by ID
     */
    public getExecution(executionId: string): ToolExecutionRecord | undefined {
        return this.activeExecutions.get(executionId);
    }

    /**
     * Get execution history
     */
    public getHistory(
        filter?: {
            toolName?: string;
            status?: ToolExecutionStatus;
            chatNoteId?: string;
            limit?: number;
        }
    ): ToolExecutionHistoryEntry[] {
        let history = [...this.executionHistory];

        if (filter) {
            if (filter.toolName) {
                history = history.filter(h => h.toolName === filter.toolName);
            }
            if (filter.status) {
                history = history.filter(h => h.status === filter.status);
            }
            if (filter.chatNoteId) {
                history = history.filter(h => h.chatNoteId === filter.chatNoteId);
            }
            if (filter.limit) {
                history = history.slice(0, filter.limit);
            }
        }

        return history;
    }

    /**
     * Get execution statistics
     */
    public getStatistics(): {
        totalExecutions: number;
        successfulExecutions: number;
        failedExecutions: number;
        cancelledExecutions: number;
        timeoutExecutions: number;
        averageDuration: number;
        toolStatistics: Record<string, {
            count: number;
            successRate: number;
            averageDuration: number;
        }>;
    } {
        const stats = this.initializeStatistics();
        this.calculateOverallStatistics(stats);
        this.calculateToolStatistics(stats);
        return stats;
    }

    /**
     * Initialize statistics object
     */
    private initializeStatistics(): any {
        return {
            totalExecutions: this.executionHistory.length,
            successfulExecutions: 0,
            failedExecutions: 0,
            cancelledExecutions: 0,
            timeoutExecutions: 0,
            averageDuration: 0,
            toolStatistics: {}
        };
    }

    /**
     * Calculate overall statistics
     */
    private calculateOverallStatistics(stats: any): void {
        let totalDuration = 0;
        let durationCount = 0;

        for (const entry of this.executionHistory) {
            // Count by status
            this.incrementStatusCount(stats, entry.status);

            // Track durations
            if (entry.duration) {
                totalDuration += entry.duration;
                durationCount++;
            }

            // Initialize per-tool statistics
            if (!stats.toolStatistics[entry.toolName]) {
                stats.toolStatistics[entry.toolName] = {
                    count: 0,
                    successRate: 0,
                    averageDuration: 0
                };
            }
            stats.toolStatistics[entry.toolName].count++;
        }

        // Calculate average duration
        stats.averageDuration = durationCount > 0 
            ? Math.round(totalDuration / durationCount) 
            : 0;
    }

    /**
     * Increment status count
     */
    private incrementStatusCount(stats: any, status: ToolExecutionStatus): void {
        switch (status) {
            case 'success':
                stats.successfulExecutions++;
                break;
            case 'error':
                stats.failedExecutions++;
                break;
            case 'cancelled':
                stats.cancelledExecutions++;
                break;
            case 'timeout':
                stats.timeoutExecutions++;
                break;
        }
    }

    /**
     * Calculate per-tool statistics
     */
    private calculateToolStatistics(stats: any): void {
        for (const toolName of Object.keys(stats.toolStatistics)) {
            const toolEntries = this.executionHistory.filter(e => e.toolName === toolName);
            const successCount = toolEntries.filter(e => e.status === 'success').length;
            const toolDurations = toolEntries
                .filter(e => e.duration)
                .map(e => e.duration!);

            stats.toolStatistics[toolName].successRate = 
                toolEntries.length > 0 
                    ? Math.round((successCount / toolEntries.length) * 100) 
                    : 0;
            
            stats.toolStatistics[toolName].averageDuration = 
                toolDurations.length > 0 
                    ? Math.round(toolDurations.reduce((a, b) => a + b, 0) / toolDurations.length)
                    : 0;
        }
    }


    /**
     * Clear all execution data
     */
    public clear(): void {
        // Cancel all active executions
        for (const executionId of this.activeExecutions.keys()) {
            this.cancelExecution(executionId, 'system', 'System cleanup');
        }

        this.activeExecutions.clear();
        this.executionHistory = [];
        this.executionTimeouts.clear();
    }
}

// Export singleton instance
export const toolFeedbackManager = new ToolFeedbackManager();
export default toolFeedbackManager;