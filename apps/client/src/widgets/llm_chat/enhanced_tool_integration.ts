/**
 * Enhanced Tool Integration
 * 
 * Integrates tool preview, feedback, and error recovery into the LLM chat experience.
 */

import server from "../../services/server.js";
import { ToolPreviewUI, type ExecutionPlanData, type UserApproval } from "./tool_preview_ui.js";
import { ToolFeedbackUI, type ToolProgressData, type ToolStepData } from "./tool_feedback_ui.js";

/**
 * Enhanced tool integration configuration
 */
export interface EnhancedToolConfig {
    enablePreview?: boolean;
    enableFeedback?: boolean;
    enableErrorRecovery?: boolean;
    requireConfirmation?: boolean;
    autoApproveTimeout?: number;
    showHistory?: boolean;
    showStatistics?: boolean;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: EnhancedToolConfig = {
    enablePreview: true,
    enableFeedback: true,
    enableErrorRecovery: true,
    requireConfirmation: true,
    autoApproveTimeout: 30000, // 30 seconds
    showHistory: true,
    showStatistics: true
};

/**
 * Enhanced Tool Integration Manager
 */
export class EnhancedToolIntegration {
    private config: EnhancedToolConfig;
    private previewUI?: ToolPreviewUI;
    private feedbackUI?: ToolFeedbackUI;
    private container: HTMLElement;
    private eventHandlers: Map<string, Function[]> = new Map();
    private activeExecutions: Set<string> = new Set();

    constructor(container: HTMLElement, config?: Partial<EnhancedToolConfig>) {
        this.container = container;
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.initialize();
    }

    /**
     * Initialize the integration
     */
    private initialize(): void {
        // Create UI containers
        this.createUIContainers();

        // Initialize UI components
        if (this.config.enablePreview) {
            const previewContainer = this.container.querySelector('.tool-preview-area') as HTMLElement;
            if (previewContainer) {
                this.previewUI = new ToolPreviewUI(previewContainer);
            }
        }

        if (this.config.enableFeedback) {
            const feedbackContainer = this.container.querySelector('.tool-feedback-area') as HTMLElement;
            if (feedbackContainer) {
                this.feedbackUI = new ToolFeedbackUI(feedbackContainer);

                // Set up history and stats containers if enabled
                if (this.config.showHistory) {
                    const historyContainer = this.container.querySelector('.tool-history-area') as HTMLElement;
                    if (historyContainer) {
                        this.feedbackUI.setHistoryContainer(historyContainer);
                    }
                }

                if (this.config.showStatistics) {
                    const statsContainer = this.container.querySelector('.tool-stats-area') as HTMLElement;
                    if (statsContainer) {
                        this.feedbackUI.setStatsContainer(statsContainer);
                        this.loadStatistics();
                    }
                }
            }
        }

        // Load initial data
        this.loadActiveExecutions();
        this.loadCircuitBreakerStatus();
    }

    /**
     * Create UI containers
     */
    private createUIContainers(): void {
        // Add enhanced tool UI areas if they don't exist
        if (!this.container.querySelector('.tool-preview-area')) {
            const previewArea = document.createElement('div');
            previewArea.className = 'tool-preview-area mb-3';
            this.container.appendChild(previewArea);
        }

        if (!this.container.querySelector('.tool-feedback-area')) {
            const feedbackArea = document.createElement('div');
            feedbackArea.className = 'tool-feedback-area mb-3';
            this.container.appendChild(feedbackArea);
        }

        if (this.config.showHistory && !this.container.querySelector('.tool-history-area')) {
            const historySection = document.createElement('div');
            historySection.className = 'tool-history-section mt-3';
            historySection.innerHTML = `
                <details class="small">
                    <summary class="text-muted cursor-pointer">
                        <i class="bx bx-history me-1"></i>
                        Execution History
                    </summary>
                    <div class="tool-history-area mt-2"></div>
                </details>
            `;
            this.container.appendChild(historySection);
        }

        if (this.config.showStatistics && !this.container.querySelector('.tool-stats-area')) {
            const statsSection = document.createElement('div');
            statsSection.className = 'tool-stats-section mt-3';
            statsSection.innerHTML = `
                <details class="small">
                    <summary class="text-muted cursor-pointer">
                        <i class="bx bx-bar-chart me-1"></i>
                        Tool Statistics
                    </summary>
                    <div class="tool-stats-area mt-2"></div>
                </details>
            `;
            this.container.appendChild(statsSection);
        }
    }

    /**
     * Handle tool preview request
     */
    public async handleToolPreview(toolCalls: any[]): Promise<UserApproval | null> {
        if (!this.config.enablePreview || !this.previewUI) {
            // Auto-approve if preview is disabled
            return {
                planId: `auto-${Date.now()}`,
                approved: true
            };
        }

        try {
            // Get preview from server
            const response = await server.post<ExecutionPlanData>('api/llm-tools/preview', {
                toolCalls
            });

            if (!response) {
                console.error('Failed to get tool preview');
                return null;
            }

            // Show preview and wait for user approval
            return new Promise((resolve) => {
                let timeoutId: number | undefined;

                const handleApproval = (approval: UserApproval) => {
                    if (timeoutId) {
                        clearTimeout(timeoutId);
                    }
                    
                    // Send approval to server
                    server.post(`api/llm-tools/preview/${approval.planId}/approval`, approval)
                        .catch(error => console.error('Failed to record approval:', error));

                    resolve(approval);
                };

                // Show preview UI
                this.previewUI!.showPreview(response, handleApproval);

                // Auto-approve after timeout if configured
                if (this.config.autoApproveTimeout && response.requiresConfirmation) {
                    timeoutId = window.setTimeout(() => {
                        const autoApproval: UserApproval = {
                            planId: response.id,
                            approved: true
                        };
                        handleApproval(autoApproval);
                    }, this.config.autoApproveTimeout);
                }
            });

        } catch (error) {
            console.error('Error handling tool preview:', error);
            return null;
        }
    }

    /**
     * Start tool execution tracking
     */
    public startToolExecution(
        executionId: string,
        toolName: string,
        displayName?: string
    ): void {
        if (!this.config.enableFeedback || !this.feedbackUI) {
            return;
        }

        this.activeExecutions.add(executionId);
        this.feedbackUI.startExecution(executionId, toolName, displayName);
    }

    /**
     * Update tool execution progress
     */
    public updateToolProgress(data: ToolProgressData): void {
        if (!this.config.enableFeedback || !this.feedbackUI) {
            return;
        }

        this.feedbackUI.updateProgress(data);
    }

    /**
     * Add tool execution step
     */
    public addToolStep(data: ToolStepData): void {
        if (!this.config.enableFeedback || !this.feedbackUI) {
            return;
        }

        this.feedbackUI.addStep(data);
    }

    /**
     * Complete tool execution
     */
    public completeToolExecution(
        executionId: string,
        status: 'success' | 'error' | 'cancelled' | 'timeout',
        result?: any,
        error?: string
    ): void {
        if (!this.config.enableFeedback || !this.feedbackUI) {
            return;
        }

        this.activeExecutions.delete(executionId);
        this.feedbackUI.completeExecution(executionId, status, result, error);

        // Refresh statistics
        if (this.config.showStatistics) {
            setTimeout(() => this.loadStatistics(), 1000);
        }
    }

    /**
     * Cancel tool execution
     */
    public async cancelToolExecution(executionId: string, reason?: string): Promise<boolean> {
        try {
            const response = await server.post<any>(`api/llm-tools/executions/${executionId}/cancel`, {
                reason
            });

            if (response?.success) {
                this.completeToolExecution(executionId, 'cancelled', undefined, reason);
                return true;
            }
        } catch (error) {
            console.error('Failed to cancel execution:', error);
        }

        return false;
    }

    /**
     * Load active executions
     */
    private async loadActiveExecutions(): Promise<void> {
        if (!this.config.enableFeedback) {
            return;
        }

        try {
            const executions = await server.get<any[]>('api/llm-tools/executions/active');
            
            if (executions && Array.isArray(executions)) {
                executions.forEach(exec => {
                    if (!this.activeExecutions.has(exec.id)) {
                        this.startToolExecution(exec.id, exec.toolName);
                        // Restore progress if available
                        if (exec.progress) {
                            this.updateToolProgress({
                                executionId: exec.id,
                                ...exec.progress
                            });
                        }
                    }
                });
            }
        } catch (error) {
            console.error('Failed to load active executions:', error);
        }
    }

    /**
     * Load execution statistics
     */
    private async loadStatistics(): Promise<void> {
        if (!this.config.showStatistics) {
            return;
        }

        try {
            const stats = await server.get<any>('api/llm-tools/executions/stats');
            
            if (stats) {
                this.displayStatistics(stats);
            }
        } catch (error) {
            console.error('Failed to load statistics:', error);
        }
    }

    /**
     * Display statistics
     */
    private displayStatistics(stats: any): void {
        const container = this.container.querySelector('.tool-stats-area') as HTMLElement;
        if (!container) return;

        container.innerHTML = `
            <div class="tool-stats-container">
                <div class="tool-stat-item">
                    <div class="tool-stat-value">${stats.totalExecutions}</div>
                    <div class="tool-stat-label">Total</div>
                </div>
                <div class="tool-stat-item">
                    <div class="tool-stat-value text-success">${stats.successfulExecutions}</div>
                    <div class="tool-stat-label">Success</div>
                </div>
                <div class="tool-stat-item">
                    <div class="tool-stat-value text-danger">${stats.failedExecutions}</div>
                    <div class="tool-stat-label">Failed</div>
                </div>
                <div class="tool-stat-item">
                    <div class="tool-stat-value">${this.formatDuration(stats.averageDuration)}</div>
                    <div class="tool-stat-label">Avg Time</div>
                </div>
            </div>
        `;

        // Add tool-specific statistics if available
        if (stats.toolStatistics && Object.keys(stats.toolStatistics).length > 0) {
            const toolStatsHtml = Object.entries(stats.toolStatistics)
                .map(([toolName, toolStats]: [string, any]) => `
                    <tr>
                        <td>${toolName}</td>
                        <td>${toolStats.count}</td>
                        <td>${toolStats.successRate}%</td>
                        <td>${this.formatDuration(toolStats.averageDuration)}</td>
                    </tr>
                `).join('');

            container.innerHTML += `
                <div class="mt-3">
                    <h6 class="small text-muted">Per-Tool Statistics</h6>
                    <table class="table table-sm small">
                        <thead>
                            <tr>
                                <th>Tool</th>
                                <th>Count</th>
                                <th>Success</th>
                                <th>Avg Time</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${toolStatsHtml}
                        </tbody>
                    </table>
                </div>
            `;
        }
    }

    /**
     * Load circuit breaker status
     */
    private async loadCircuitBreakerStatus(): Promise<void> {
        try {
            const statuses = await server.get<any[]>('api/llm-tools/circuit-breakers');
            
            if (statuses && Array.isArray(statuses)) {
                this.displayCircuitBreakerStatus(statuses);
            }
        } catch (error) {
            console.error('Failed to load circuit breaker status:', error);
        }
    }

    /**
     * Display circuit breaker status
     */
    private displayCircuitBreakerStatus(statuses: any[]): void {
        const openBreakers = statuses.filter(s => s.state === 'open');
        const halfOpenBreakers = statuses.filter(s => s.state === 'half_open');

        if (openBreakers.length > 0 || halfOpenBreakers.length > 0) {
            const alertContainer = document.createElement('div');
            alertContainer.className = 'circuit-breaker-alerts mb-3';

            if (openBreakers.length > 0) {
                alertContainer.innerHTML += `
                    <div class="alert alert-danger small py-2">
                        <i class="bx bx-error-circle me-1"></i>
                        <strong>Circuit Breakers Open:</strong> 
                        ${openBreakers.map(b => b.toolName).join(', ')}
                        <button class="btn btn-sm btn-link reset-breakers-btn float-end py-0">
                            Reset All
                        </button>
                    </div>
                `;
            }

            if (halfOpenBreakers.length > 0) {
                alertContainer.innerHTML += `
                    <div class="alert alert-warning small py-2">
                        <i class="bx bx-error me-1"></i>
                        <strong>Circuit Breakers Half-Open:</strong> 
                        ${halfOpenBreakers.map(b => b.toolName).join(', ')}
                    </div>
                `;
            }

            // Add to container
            const existingAlerts = this.container.querySelector('.circuit-breaker-alerts');
            if (existingAlerts) {
                existingAlerts.replaceWith(alertContainer);
            } else {
                this.container.insertBefore(alertContainer, this.container.firstChild);
            }

            // Add reset handler
            const resetBtn = alertContainer.querySelector('.reset-breakers-btn');
            resetBtn?.addEventListener('click', () => this.resetAllCircuitBreakers(openBreakers));
        }
    }

    /**
     * Reset all circuit breakers
     */
    private async resetAllCircuitBreakers(breakers: any[]): Promise<void> {
        for (const breaker of breakers) {
            try {
                await server.post(`api/llm-tools/circuit-breakers/${breaker.toolName}/reset`, {});
            } catch (error) {
                console.error(`Failed to reset circuit breaker for ${breaker.toolName}:`, error);
            }
        }

        // Reload status
        this.loadCircuitBreakerStatus();
    }

    /**
     * Format duration
     */
    private formatDuration(milliseconds: number): string {
        if (!milliseconds || milliseconds === 0) return '0ms';
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
     * Clean up resources
     */
    public dispose(): void {
        this.eventHandlers.clear();
        this.activeExecutions.clear();
        
        if (this.feedbackUI) {
            this.feedbackUI.clear();
        }
    }
}

/**
 * Create enhanced tool integration
 */
export function createEnhancedToolIntegration(
    container: HTMLElement,
    config?: Partial<EnhancedToolConfig>
): EnhancedToolIntegration {
    return new EnhancedToolIntegration(container, config);
}