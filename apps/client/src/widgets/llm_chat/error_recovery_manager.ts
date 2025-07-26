interface ErrorRecoveryOptions {
    errorId: string;
    toolName: string;
    message: string;
    errorType: string;
    attempt: number;
    maxAttempts: number;
    recoveryActions: Array<{
        id: string;
        label: string;
        description?: string;
        action: 'retry' | 'skip' | 'modify' | 'abort' | 'alternative';
        parameters?: Record<string, unknown>;
    }>;
    autoRetryIn?: number; // seconds
    context?: {
        originalParams?: Record<string, unknown>;
        previousAttempts?: string[];
        suggestions?: string[];
    };
}

interface ErrorRecoveryResponse {
    errorId: string;
    action: string;
    parameters?: Record<string, unknown>;
    timestamp: number;
}

/**
 * Error Recovery Manager for LLM Chat
 * Handles sophisticated error recovery with multiple strategies and user guidance
 */
export class ErrorRecoveryManager {
    private activeErrors: Map<string, ErrorRecoveryOptions> = new Map();
    private responseCallbacks: Map<string, (response: ErrorRecoveryResponse) => void> = new Map();
    private container: HTMLElement;

    constructor(parentElement: HTMLElement) {
        this.container = this.createErrorContainer();
        parentElement.appendChild(this.container);
    }

    /**
     * Create error recovery container
     */
    private createErrorContainer(): HTMLElement {
        const container = document.createElement('div');
        container.className = 'llm-error-recovery-container';
        container.style.display = 'none';
        return container;
    }

    /**
     * Show error recovery options
     */
    public async showErrorRecovery(options: ErrorRecoveryOptions): Promise<ErrorRecoveryResponse> {
        this.activeErrors.set(options.errorId, options);
        
        return new Promise((resolve) => {
            this.responseCallbacks.set(options.errorId, resolve);
            
            const errorElement = this.createErrorElement(options);
            this.container.appendChild(errorElement);
            this.container.style.display = 'block';
            
            // Start auto-retry countdown if enabled
            if (options.autoRetryIn && options.autoRetryIn > 0) {
                this.startAutoRetryCountdown(options);
            }
        });
    }

    /**
     * Create error recovery element
     */
    private createErrorElement(options: ErrorRecoveryOptions): HTMLElement {
        const element = document.createElement('div');
        element.className = 'llm-error-recovery-item';
        element.setAttribute('data-error-id', options.errorId);
        
        element.innerHTML = `
            <div class="error-header">
                <div class="error-icon">
                    <i class="fas fa-exclamation-triangle"></i>
                </div>
                <div class="error-title">
                    <div class="error-tool-name">${options.toolName} Failed</div>
                    <div class="error-attempt-info">Attempt ${options.attempt}/${options.maxAttempts}</div>
                </div>
                <div class="error-type-badge ${this.getErrorTypeBadgeClass(options.errorType)}">
                    ${options.errorType}
                </div>
            </div>
            
            <div class="error-body">
                <div class="error-message">
                    <div class="error-message-label">Error Details:</div>
                    <div class="error-message-content">${options.message}</div>
                </div>
                
                ${this.createContextSection(options.context)}
                ${this.createAutoRetrySection(options.autoRetryIn)}
                
                <div class="recovery-actions">
                    <div class="recovery-actions-label">Recovery Options:</div>
                    <div class="recovery-actions-grid">
                        ${this.createRecoveryActions(options)}
                    </div>
                </div>
            </div>
        `;

        this.attachErrorEvents(element, options);
        return element;
    }

    /**
     * Create context section
     */
    private createContextSection(context?: ErrorRecoveryOptions['context']): string {
        if (!context) return '';

        return `
            <div class="error-context">
                ${context.originalParams ? `
                    <div class="context-section">
                        <div class="context-label">Original Parameters:</div>
                        <div class="context-content">
                            ${this.formatParameters(context.originalParams)}
                        </div>
                    </div>
                ` : ''}
                
                ${context.previousAttempts && context.previousAttempts.length > 0 ? `
                    <div class="context-section">
                        <div class="context-label">Previous Attempts:</div>
                        <div class="context-content">
                            <ul class="previous-attempts-list">
                                ${context.previousAttempts.map(attempt => `<li>${attempt}</li>`).join('')}
                            </ul>
                        </div>
                    </div>
                ` : ''}
                
                ${context.suggestions && context.suggestions.length > 0 ? `
                    <div class="context-section">
                        <div class="context-label">Suggestions:</div>
                        <div class="context-content">
                            <ul class="suggestions-list">
                                ${context.suggestions.map(suggestion => `<li>${suggestion}</li>`).join('')}
                            </ul>
                        </div>
                    </div>
                ` : ''}
            </div>
        `;
    }

    /**
     * Create auto-retry section
     */
    private createAutoRetrySection(autoRetryIn?: number): string {
        if (!autoRetryIn || autoRetryIn <= 0) return '';

        return `
            <div class="auto-retry-section">
                <div class="auto-retry-info">
                    <i class="fas fa-clock"></i>
                    <span>Auto-retry in <span class="retry-countdown">${autoRetryIn}</span> seconds</span>
                </div>
                <div class="auto-retry-progress">
                    <div class="retry-progress-bar">
                        <div class="retry-progress-fill"></div>
                    </div>
                </div>
                <button class="btn btn-sm btn-secondary cancel-auto-retry">Cancel Auto-retry</button>
            </div>
        `;
    }

    /**
     * Create recovery actions
     */
    private createRecoveryActions(options: ErrorRecoveryOptions): string {
        return options.recoveryActions.map(action => {
            const actionClass = this.getActionClass(action.action);
            const icon = this.getActionIcon(action.action);
            
            return `
                <div class="recovery-action ${actionClass}" data-action-id="${action.id}">
                    <div class="action-icon">
                        <i class="${icon}"></i>
                    </div>
                    <div class="action-content">
                        <div class="action-label">${action.label}</div>
                        ${action.description ? `<div class="action-description">${action.description}</div>` : ''}
                    </div>
                    <div class="action-arrow">
                        <i class="fas fa-chevron-right"></i>
                    </div>
                </div>
            `;
        }).join('');
    }

    /**
     * Format parameters for display
     */
    private formatParameters(params: Record<string, unknown>): string {
        return Object.entries(params).map(([key, value]) => {
            let displayValue: string;
            if (typeof value === 'string') {
                displayValue = value.length > 50 ? value.substring(0, 50) + '...' : value;
                displayValue = `"${displayValue}"`;
            } else if (typeof value === 'object') {
                displayValue = JSON.stringify(value, null, 2);
            } else {
                displayValue = String(value);
            }
            
            return `<div class="param-item">
                <span class="param-key">${key}:</span>
                <span class="param-value">${displayValue}</span>
            </div>`;
        }).join('');
    }

    /**
     * Get error type badge class
     */
    private getErrorTypeBadgeClass(errorType: string): string {
        const typeMap: Record<string, string> = {
            'NetworkError': 'badge-warning',
            'TimeoutError': 'badge-warning',
            'ValidationError': 'badge-danger',
            'NotFoundError': 'badge-info',
            'PermissionError': 'badge-danger',
            'RateLimitError': 'badge-warning',
            'UnknownError': 'badge-secondary'
        };
        
        return typeMap[errorType] || 'badge-secondary';
    }

    /**
     * Get action class
     */
    private getActionClass(action: string): string {
        const actionMap: Record<string, string> = {
            'retry': 'action-retry',
            'skip': 'action-skip',
            'modify': 'action-modify',
            'abort': 'action-abort',
            'alternative': 'action-alternative'
        };
        
        return actionMap[action] || 'action-default';
    }

    /**
     * Get action icon
     */
    private getActionIcon(action: string): string {
        const iconMap: Record<string, string> = {
            'retry': 'fas fa-redo',
            'skip': 'fas fa-forward',
            'modify': 'fas fa-edit',
            'abort': 'fas fa-times',
            'alternative': 'fas fa-route'
        };
        
        return iconMap[action] || 'fas fa-cog';
    }

    /**
     * Attach error events
     */
    private attachErrorEvents(element: HTMLElement, options: ErrorRecoveryOptions): void {
        // Recovery action clicks
        const actions = element.querySelectorAll('.recovery-action');
        actions.forEach(action => {
            action.addEventListener('click', (e) => {
                const target = e.currentTarget as HTMLElement;
                const actionId = target.getAttribute('data-action-id');
                if (actionId) {
                    const recoveryAction = options.recoveryActions.find(a => a.id === actionId);
                    if (recoveryAction) {
                        this.executeRecoveryAction(options.errorId, recoveryAction);
                    }
                }
            });
        });

        // Cancel auto-retry
        const cancelAutoRetry = element.querySelector('.cancel-auto-retry');
        if (cancelAutoRetry) {
            cancelAutoRetry.addEventListener('click', () => {
                this.cancelAutoRetry(options.errorId);
            });
        }
    }

    /**
     * Start auto-retry countdown
     */
    private startAutoRetryCountdown(options: ErrorRecoveryOptions): void {
        if (!options.autoRetryIn) return;

        const element = this.container.querySelector(`[data-error-id="${options.errorId}"]`) as HTMLElement;
        if (!element) return;

        const countdownElement = element.querySelector('.retry-countdown') as HTMLElement;
        const progressFill = element.querySelector('.retry-progress-fill') as HTMLElement;
        
        let remainingTime = options.autoRetryIn;
        const totalTime = options.autoRetryIn;
        
        const interval = setInterval(() => {
            remainingTime--;
            
            if (countdownElement) {
                countdownElement.textContent = remainingTime.toString();
            }
            
            if (progressFill) {
                const progress = ((totalTime - remainingTime) / totalTime) * 100;
                progressFill.style.width = `${progress}%`;
            }
            
            if (remainingTime <= 0) {
                clearInterval(interval);
                // Auto-execute retry
                const retryAction = options.recoveryActions.find(a => a.action === 'retry');
                if (retryAction) {
                    this.executeRecoveryAction(options.errorId, retryAction);
                }
            }
        }, 1000);

        // Store interval for potential cancellation
        element.setAttribute('data-retry-interval', interval.toString());
    }

    /**
     * Cancel auto-retry
     */
    private cancelAutoRetry(errorId: string): void {
        const element = this.container.querySelector(`[data-error-id="${errorId}"]`) as HTMLElement;
        if (!element) return;

        const intervalId = element.getAttribute('data-retry-interval');
        if (intervalId) {
            clearInterval(parseInt(intervalId));
            element.removeAttribute('data-retry-interval');
        }

        // Hide auto-retry section
        const autoRetrySection = element.querySelector('.auto-retry-section') as HTMLElement;
        if (autoRetrySection) {
            autoRetrySection.style.display = 'none';
        }
    }

    /**
     * Execute recovery action
     */
    private executeRecoveryAction(errorId: string, action: ErrorRecoveryOptions['recoveryActions'][0]): void {
        const callback = this.responseCallbacks.get(errorId);
        if (!callback) return;

        const response: ErrorRecoveryResponse = {
            errorId,
            action: action.action,
            parameters: action.parameters,
            timestamp: Date.now()
        };

        // Clean up
        this.activeErrors.delete(errorId);
        this.responseCallbacks.delete(errorId);
        this.removeErrorElement(errorId);

        // Call callback
        callback(response);
    }

    /**
     * Remove error element
     */
    private removeErrorElement(errorId: string): void {
        const element = this.container.querySelector(`[data-error-id="${errorId}"]`) as HTMLElement;
        if (element) {
            element.classList.add('fade-out');
            setTimeout(() => {
                element.remove();
                
                // Hide container if no more errors
                if (this.container.children.length === 0) {
                    this.container.style.display = 'none';
                }
            }, 300);
        }
    }

    /**
     * Clear all errors
     */
    public clearAllErrors(): void {
        this.activeErrors.clear();
        this.responseCallbacks.clear();
        this.container.innerHTML = '';
        this.container.style.display = 'none';
    }

    /**
     * Get active error count
     */
    public getActiveErrorCount(): number {
        return this.activeErrors.size;
    }

    /**
     * Check if error recovery is active
     */
    public hasActiveErrors(): boolean {
        return this.activeErrors.size > 0;
    }

    /**
     * Update error context (for adding new information)
     */
    public updateErrorContext(errorId: string, newContext: Partial<ErrorRecoveryOptions['context']>): void {
        const options = this.activeErrors.get(errorId);
        if (!options) return;

        options.context = { ...options.context, ...newContext };
        
        // Re-render the context section
        const element = this.container.querySelector(`[data-error-id="${errorId}"]`) as HTMLElement;
        if (element) {
            const contextContainer = element.querySelector('.error-context') as HTMLElement;
            if (contextContainer) {
                contextContainer.outerHTML = this.createContextSection(options.context);
            }
        }
    }
}

// Export types for use in other modules
export type { ErrorRecoveryOptions, ErrorRecoveryResponse };