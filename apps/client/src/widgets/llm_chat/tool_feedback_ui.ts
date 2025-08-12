/**
 * Tool Feedback UI Component
 * 
 * Provides real-time feedback UI during tool execution including
 * progress tracking, step visualization, and execution history.
 */

import { t } from "../../services/i18n.js";
import { VirtualScrollManager, createVirtualScroll } from './virtual_scroll.js';

// UI Constants
const UI_CONSTANTS = {
    HISTORY_MOVE_DELAY: 5000,
    STEP_COLLAPSE_DELAY: 1000,
    FADE_OUT_DURATION: 300,
    MAX_HISTORY_UI_SIZE: 50,
    MAX_VISIBLE_STEPS: 3,
    MAX_STRING_DISPLAY_LENGTH: 100,
    MAX_STEP_CONTAINER_HEIGHT: 150,
} as const;

/**
 * Tool execution status
 */
export type ToolExecutionStatus = 'pending' | 'running' | 'success' | 'error' | 'cancelled' | 'timeout';

/**
 * Tool execution progress data
 */
export interface ToolProgressData {
    executionId: string;
    current: number;
    total: number;
    percentage: number;
    message?: string;
    estimatedTimeRemaining?: number;
}

/**
 * Tool execution step data
 */
export interface ToolStepData {
    executionId: string;
    timestamp: string;
    message: string;
    type: 'info' | 'warning' | 'error' | 'progress';
    data?: any;
}

/**
 * Tool execution tracker
 */
interface ExecutionTracker {
    id: string;
    toolName: string;
    element: HTMLElement;
    startTime: number;
    status: ToolExecutionStatus;
    steps: ToolStepData[];
    animationFrameId?: number;
}

/**
 * Tool Feedback UI Manager
 */
export class ToolFeedbackUI {
    private container: HTMLElement;
    private executions: Map<string, ExecutionTracker> = new Map();
    private historyContainer?: HTMLElement;
    private statsContainer?: HTMLElement;
    private virtualScroll?: VirtualScrollManager;
    private historyItems: any[] = [];

    constructor(container: HTMLElement) {
        this.container = container;
    }

    /**
     * Start tracking a tool execution
     */
    public startExecution(
        executionId: string,
        toolName: string,
        displayName?: string
    ): void {
        // Create execution element
        const element = this.createExecutionElement(executionId, toolName, displayName);
        this.container.appendChild(element);

        // Create tracker
        const tracker: ExecutionTracker = {
            id: executionId,
            toolName,
            element,
            startTime: Date.now(),
            status: 'running',
            steps: []
        };

        // Start elapsed time update with requestAnimationFrame
        this.startElapsedTimeAnimation(tracker);

        this.executions.set(executionId, tracker);

        // Auto-scroll to new execution
        element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    /**
     * Update execution progress
     */
    public updateProgress(data: ToolProgressData): void {
        const tracker = this.executions.get(data.executionId);
        if (!tracker) return;

        const progressBar = tracker.element.querySelector('.progress-bar') as HTMLElement;
        const progressText = tracker.element.querySelector('.progress-text') as HTMLElement;
        const progressContainer = tracker.element.querySelector('.tool-progress') as HTMLElement;

        if (progressContainer) {
            progressContainer.style.display = 'block';
        }

        if (progressBar) {
            progressBar.style.width = `${data.percentage}%`;
            progressBar.setAttribute('aria-valuenow', String(data.percentage));
        }

        if (progressText) {
            let text = `${data.current}/${data.total}`;
            if (data.message) {
                text += ` - ${data.message}`;
            }
            if (data.estimatedTimeRemaining) {
                text += ` (${this.formatDuration(data.estimatedTimeRemaining)} remaining)`;
            }
            progressText.textContent = text;
        }
    }

    /**
     * Add execution step
     */
    public addStep(data: ToolStepData): void {
        const tracker = this.executions.get(data.executionId);
        if (!tracker) return;

        tracker.steps.push(data);

        const stepsContainer = tracker.element.querySelector('.tool-steps') as HTMLElement;
        if (stepsContainer) {
            const stepElement = this.createStepElement(data);
            stepsContainer.appendChild(stepElement);

            // Show steps container if hidden
            stepsContainer.style.display = 'block';

            // Auto-scroll steps
            stepsContainer.scrollTop = stepsContainer.scrollHeight;
        }

        // Update status indicator for warnings/errors
        if (data.type === 'warning' || data.type === 'error') {
            this.updateStatusIndicator(tracker, data.type);
        }
    }

    /**
     * Complete execution
     */
    public completeExecution(
        executionId: string,
        status: 'success' | 'error' | 'cancelled' | 'timeout',
        result?: any,
        error?: string
    ): void {
        const tracker = this.executions.get(executionId);
        if (!tracker) return;

        tracker.status = status;

        // Stop elapsed time update
        if (tracker.animationFrameId) {
            cancelAnimationFrame(tracker.animationFrameId);
            tracker.animationFrameId = undefined;
        }

        // Update UI
        this.updateStatusIndicator(tracker, status);

        const duration = Date.now() - tracker.startTime;
        const durationElement = tracker.element.querySelector('.tool-duration') as HTMLElement;
        if (durationElement) {
            durationElement.textContent = this.formatDuration(duration);
        }

        // Show result or error
        if (status === 'success' && result) {
            const resultElement = tracker.element.querySelector('.tool-result') as HTMLElement;
            if (resultElement) {
                resultElement.style.display = 'block';
                resultElement.textContent = this.formatResult(result);
            }
        } else if ((status === 'error' || status === 'timeout') && error) {
            const errorElement = tracker.element.querySelector('.tool-error') as HTMLElement;
            if (errorElement) {
                errorElement.style.display = 'block';
                errorElement.textContent = error;
            }
        }

        // Collapse steps after completion
        setTimeout(() => {
            this.collapseStepsIfNeeded(tracker);
        }, UI_CONSTANTS.STEP_COLLAPSE_DELAY);

        // Move to history after a delay
        setTimeout(() => {
            this.moveToHistory(tracker);
        }, UI_CONSTANTS.HISTORY_MOVE_DELAY);
    }

    /**
     * Cancel execution
     */
    public cancelExecution(executionId: string): void {
        this.completeExecution(executionId, 'cancelled', undefined, 'Cancelled by user');
    }

    /**
     * Create execution element
     */
    private createExecutionElement(
        executionId: string,
        toolName: string,
        displayName?: string
    ): HTMLElement {
        const element = document.createElement('div');
        element.className = 'tool-execution-feedback mb-2 p-2 border rounded bg-light';
        element.dataset.executionId = executionId;

        element.innerHTML = `
            <div class="d-flex align-items-start">
                <div class="tool-status-icon me-2">
                    <div class="spinner-border spinner-border-sm text-primary" role="status">
                        <span class="visually-hidden">Running...</span>
                    </div>
                </div>
                <div class="flex-grow-1">
                    <div class="d-flex align-items-center justify-content-between">
                        <div class="tool-name fw-bold small">
                            ${displayName || toolName}
                        </div>
                        <div class="tool-actions">
                            <button class="btn btn-sm btn-link p-0 cancel-btn" title="Cancel">
                                <i class="bx bx-x"></i>
                            </button>
                        </div>
                    </div>
                    <div class="tool-progress mt-1" style="display: none;">
                        <div class="progress" style="height: 4px;">
                            <div class="progress-bar progress-bar-striped progress-bar-animated" 
                                 role="progressbar" 
                                 style="width: 0%"
                                 aria-valuenow="0" 
                                 aria-valuemin="0" 
                                 aria-valuemax="100">
                            </div>
                        </div>
                        <div class="progress-text text-muted small mt-1"></div>
                    </div>
                    <div class="tool-steps mt-2 small" style="display: none; max-height: ${UI_CONSTANTS.MAX_STEP_CONTAINER_HEIGHT}px; overflow-y: auto;">
                    </div>
                    <div class="tool-result text-success small mt-2" style="display: none;"></div>
                    <div class="tool-error text-danger small mt-2" style="display: none;"></div>
                </div>
                <div class="tool-duration text-muted small ms-2">
                    <span class="elapsed-time">0s</span>
                </div>
            </div>
        `;

        // Add cancel button listener
        const cancelBtn = element.querySelector('.cancel-btn') as HTMLButtonElement;
        cancelBtn?.addEventListener('click', () => {
            this.cancelExecution(executionId);
        });

        return element;
    }

    /**
     * Create step element
     */
    private createStepElement(step: ToolStepData): HTMLElement {
        const element = document.createElement('div');
        element.className = `tool-step tool-step-${step.type} text-${this.getStepColor(step.type)} mb-1`;

        const timestamp = new Date(step.timestamp).toLocaleTimeString();

        element.innerHTML = `
            <i class="bx ${this.getStepIcon(step.type)} me-1"></i>
            <span class="step-time text-muted">[${timestamp}]</span>
            <span class="step-message ms-1">${step.message}</span>
        `;

        return element;
    }

    /**
     * Update status indicator
     */
    private updateStatusIndicator(tracker: ExecutionTracker, status: string): void {
        const statusIcon = tracker.element.querySelector('.tool-status-icon');
        if (!statusIcon) return;

        const icons: Record<string, string> = {
            'success': '<i class="bx bx-check-circle text-success fs-5"></i>',
            'error': '<i class="bx bx-error-circle text-danger fs-5"></i>',
            'warning': '<i class="bx bx-error text-warning fs-5"></i>',
            'cancelled': '<i class="bx bx-x-circle text-warning fs-5"></i>',
            'timeout': '<i class="bx bx-time-five text-danger fs-5"></i>'
        };

        if (icons[status]) {
            statusIcon.innerHTML = icons[status];
        }

        // Update container style
        const borderColors: Record<string, string> = {
            'success': 'border-success',
            'error': 'border-danger',
            'warning': 'border-warning',
            'cancelled': 'border-warning',
            'timeout': 'border-danger'
        };

        if (borderColors[status]) {
            tracker.element.classList.add(borderColors[status]);
        }
    }

    /**
     * Start elapsed time animation with requestAnimationFrame
     */
    private startElapsedTimeAnimation(tracker: ExecutionTracker): void {
        const updateTime = () => {
            if (this.executions.has(tracker.id)) {
                const elapsed = Date.now() - tracker.startTime;
                const elapsedElement = tracker.element.querySelector('.elapsed-time') as HTMLElement;
                if (elapsedElement) {
                    elapsedElement.textContent = this.formatDuration(elapsed);
                }
                tracker.animationFrameId = requestAnimationFrame(updateTime);
            }
        };
        tracker.animationFrameId = requestAnimationFrame(updateTime);
    }

    /**
     * Move execution to history
     */
    private moveToHistory(tracker: ExecutionTracker): void {
        // Remove from active executions
        this.executions.delete(tracker.id);

        // Fade out and remove
        tracker.element.classList.add('fade-out');
        setTimeout(() => {
            tracker.element.remove();
        }, UI_CONSTANTS.FADE_OUT_DURATION);

        // Add to history
        this.addToHistory(tracker);
    }

    /**
     * Add tracker to history
     */
    private addToHistory(tracker: ExecutionTracker): void {
        // Add to history items array
        this.historyItems.unshift(tracker);
        
        // Limit history size
        if (this.historyItems.length > UI_CONSTANTS.MAX_HISTORY_UI_SIZE) {
            this.historyItems = this.historyItems.slice(0, UI_CONSTANTS.MAX_HISTORY_UI_SIZE);
        }
        
        // Update display
        if (this.virtualScroll) {
            this.virtualScroll.updateTotalItems(this.historyItems.length);
            this.virtualScroll.refresh();
        } else if (this.historyContainer) {
            const historyItem = this.createHistoryItem(tracker);
            this.historyContainer.prepend(historyItem);
            
            // Limit DOM elements
            const elements = this.historyContainer.querySelectorAll('.history-item');
            if (elements.length > UI_CONSTANTS.MAX_HISTORY_UI_SIZE) {
                elements[elements.length - 1].remove();
            }
        }
    }

    /**
     * Create history item
     */
    private createHistoryItem(tracker: ExecutionTracker): HTMLElement {
        const element = document.createElement('div');
        element.className = 'history-item small text-muted mb-1';

        const duration = Date.now() - tracker.startTime;
        const statusIcon = this.getStatusIcon(tracker.status);
        const time = new Date(tracker.startTime).toLocaleTimeString();

        element.innerHTML = `
            ${statusIcon}
            <span class="ms-1">${tracker.toolName}</span>
            <span class="ms-1">(${this.formatDuration(duration)})</span>
            <span class="ms-1 text-muted">${time}</span>
        `;

        return element;
    }

    /**
     * Get step color
     */
    private getStepColor(type: string): string {
        const colors: Record<string, string> = {
            'info': 'muted',
            'warning': 'warning',
            'error': 'danger',
            'progress': 'primary'
        };
        return colors[type] || 'muted';
    }

    /**
     * Get step icon
     */
    private getStepIcon(type: string): string {
        const icons: Record<string, string> = {
            'info': 'bx-info-circle',
            'warning': 'bx-error',
            'error': 'bx-error-circle',
            'progress': 'bx-loader-alt'
        };
        return icons[type] || 'bx-circle';
    }

    /**
     * Get status icon
     */
    private getStatusIcon(status: string): string {
        const icons: Record<string, string> = {
            'success': '<i class="bx bx-check-circle text-success"></i>',
            'error': '<i class="bx bx-error-circle text-danger"></i>',
            'cancelled': '<i class="bx bx-x-circle text-warning"></i>',
            'timeout': '<i class="bx bx-time-five text-danger"></i>',
            'running': '<i class="bx bx-loader-alt text-primary"></i>',
            'pending': '<i class="bx bx-time text-muted"></i>'
        };
        return icons[status] || '<i class="bx bx-circle text-muted"></i>';
    }

    /**
     * Collapse steps if there are too many
     */
    private collapseStepsIfNeeded(tracker: ExecutionTracker): void {
        const stepsContainer = tracker.element.querySelector('.tool-steps') as HTMLElement;
        if (stepsContainer && tracker.steps.length > UI_CONSTANTS.MAX_VISIBLE_STEPS) {
            const details = document.createElement('details');
            details.className = 'mt-2';
            details.innerHTML = `
                <summary class="text-muted small cursor-pointer">
                    Show ${tracker.steps.length} execution steps
                </summary>
            `;
            details.appendChild(stepsContainer.cloneNode(true));
            stepsContainer.replaceWith(details);
        }
    }

    /**
     * Format result for display
     */
    private formatResult(result: any): string {
        if (typeof result === 'string') {
            return this.truncateString(result);
        }
        const json = JSON.stringify(result);
        return this.truncateString(json);
    }

    /**
     * Truncate string for display
     */
    private truncateString(str: string, maxLength: number = UI_CONSTANTS.MAX_STRING_DISPLAY_LENGTH): string {
        if (str.length <= maxLength) {
            return str;
        }
        return `${str.substring(0, maxLength)}...`;
    }

    /**
     * Format duration
     */
    private formatDuration(milliseconds: number): string {
        if (milliseconds < 1000) {
            return `${Math.round(milliseconds)}ms`;
        } else if (milliseconds < 60000) {
            return `${(milliseconds / 1000).toFixed(1)}s`;
        } else {
            const minutes = Math.floor(milliseconds / 60000);
            const seconds = Math.floor((milliseconds % 60000) / 1000);
            return `${minutes}m ${seconds}s`;
        }
    }

    /**
     * Set history container with virtual scrolling
     */
    public setHistoryContainer(container: HTMLElement, useVirtualScroll: boolean = false): void {
        this.historyContainer = container;
        
        if (useVirtualScroll && this.historyItems.length > 20) {
            this.initializeVirtualScroll();
        }
    }

    /**
     * Initialize virtual scrolling for history
     */
    private initializeVirtualScroll(): void {
        if (!this.historyContainer) return;
        
        this.virtualScroll = createVirtualScroll({
            container: this.historyContainer,
            itemHeight: 30, // Approximate height of history items
            totalItems: this.historyItems.length,
            overscan: 3,
            onRenderItem: (index) => {
                return this.renderHistoryItemAtIndex(index);
            }
        });
    }

    /**
     * Render history item at specific index
     */
    private renderHistoryItemAtIndex(index: number): HTMLElement {
        const item = this.historyItems[index];
        if (!item) {
            const empty = document.createElement('div');
            empty.className = 'history-item-empty';
            return empty;
        }
        
        return this.createHistoryItem(item);
    }

    /**
     * Set statistics container
     */
    public setStatsContainer(container: HTMLElement): void {
        this.statsContainer = container;
    }

    /**
     * Clear all executions
     */
    public clear(): void {
        this.executions.forEach(tracker => {
            if (tracker.animationFrameId) {
                cancelAnimationFrame(tracker.animationFrameId);
            }
        });
        this.executions.clear();
        this.container.innerHTML = '';
        this.historyItems = [];
        
        if (this.virtualScroll) {
            this.virtualScroll.destroy();
            this.virtualScroll = undefined;
        }
        
        if (this.historyContainer) {
            this.historyContainer.innerHTML = '';
        }
    }
}

/**
 * Create a tool feedback UI instance
 */
export function createToolFeedbackUI(container: HTMLElement): ToolFeedbackUI {
    return new ToolFeedbackUI(container);
}