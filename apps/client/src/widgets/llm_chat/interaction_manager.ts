interface UserInteractionRequest {
    id: string;
    type: 'confirmation' | 'choice' | 'input' | 'tool_confirmation';
    title: string;
    message: string;
    options?: Array<{
        id: string;
        label: string;
        description?: string;
        style?: 'primary' | 'secondary' | 'warning' | 'danger';
        action?: string;
    }>;
    defaultValue?: string;
    timeout?: number; // milliseconds
    tool?: {
        name: string;
        description: string;
        arguments: Record<string, unknown>;
        riskLevel?: 'low' | 'medium' | 'high';
    };
}

interface UserInteractionResponse {
    id: string;
    response: string;
    value?: any;
    timestamp: number;
}

/**
 * User Interaction Manager for LLM Chat
 * Handles confirmations, choices, and input prompts during LLM operations
 */
export class InteractionManager {
    private activeInteractions: Map<string, UserInteractionRequest> = new Map();
    private responseCallbacks: Map<string, (response: UserInteractionResponse) => void> = new Map();
    private modalContainer: HTMLElement;
    private overlay: HTMLElement;

    constructor(parentElement: HTMLElement) {
        this.createModalContainer(parentElement);
    }

    /**
     * Create modal container and overlay
     */
    private createModalContainer(parentElement: HTMLElement): void {
        // Create overlay
        this.overlay = document.createElement('div');
        this.overlay.className = 'llm-interaction-overlay';
        this.overlay.style.display = 'none';
        
        // Create modal container
        this.modalContainer = document.createElement('div');
        this.modalContainer.className = 'llm-interaction-modal-container';
        
        this.overlay.appendChild(this.modalContainer);
        parentElement.appendChild(this.overlay);

        // Close on overlay click
        this.overlay.addEventListener('click', (e) => {
            if (e.target === this.overlay) {
                this.cancelAllInteractions();
            }
        });

        // Handle escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.hasActiveInteractions()) {
                this.cancelAllInteractions();
            }
        });
    }

    /**
     * Request user interaction
     */
    public async requestUserInteraction(request: UserInteractionRequest): Promise<UserInteractionResponse> {
        this.activeInteractions.set(request.id, request);
        
        return new Promise((resolve, reject) => {
            // Set up response callback
            this.responseCallbacks.set(request.id, resolve);

            // Create and show modal
            const modal = this.createInteractionModal(request);
            this.showModal(modal);

            // Set up timeout if specified
            if (request.timeout && request.timeout > 0) {
                setTimeout(() => {
                    if (this.activeInteractions.has(request.id)) {
                        this.handleTimeout(request.id);
                    }
                }, request.timeout);
            }
        });
    }

    /**
     * Create interaction modal based on request type
     */
    private createInteractionModal(request: UserInteractionRequest): HTMLElement {
        const modal = document.createElement('div');
        modal.className = `llm-interaction-modal llm-interaction-${request.type}`;
        modal.setAttribute('data-interaction-id', request.id);

        switch (request.type) {
            case 'tool_confirmation':
                return this.createToolConfirmationModal(modal, request);
            case 'confirmation':
                return this.createConfirmationModal(modal, request);
            case 'choice':
                return this.createChoiceModal(modal, request);
            case 'input':
                return this.createInputModal(modal, request);
            default:
                return this.createGenericModal(modal, request);
        }
    }

    /**
     * Create tool confirmation modal
     */
    private createToolConfirmationModal(modal: HTMLElement, request: UserInteractionRequest): HTMLElement {
        const tool = request.tool!;
        const riskClass = tool.riskLevel ? `risk-${tool.riskLevel}` : '';
        
        modal.innerHTML = `
            <div class="modal-header ${riskClass}">
                <div class="modal-title">
                    <i class="fas fa-tools"></i>
                    Tool Execution Confirmation
                </div>
                <div class="risk-indicator ${riskClass}">
                    <span class="risk-label">${(tool.riskLevel || 'medium').toUpperCase()} RISK</span>
                </div>
            </div>
            <div class="modal-body">
                <div class="tool-info">
                    <div class="tool-name">${tool.name}</div>
                    <div class="tool-description">${tool.description}</div>
                </div>
                <div class="tool-arguments">
                    <div class="arguments-label">Parameters:</div>
                    <div class="arguments-content">
                        ${this.formatToolArguments(tool.arguments)}
                    </div>
                </div>
                <div class="confirmation-message">${request.message}</div>
                ${this.createTimeoutIndicator(request.timeout)}
            </div>
            <div class="modal-footer">
                ${this.createActionButtons(request)}
            </div>
        `;

        this.attachButtonEvents(modal, request);
        return modal;
    }

    /**
     * Create confirmation modal
     */
    private createConfirmationModal(modal: HTMLElement, request: UserInteractionRequest): HTMLElement {
        modal.innerHTML = `
            <div class="modal-header">
                <div class="modal-title">
                    <i class="fas fa-question-circle"></i>
                    ${request.title}
                </div>
            </div>
            <div class="modal-body">
                <div class="confirmation-message">${request.message}</div>
                ${this.createTimeoutIndicator(request.timeout)}
            </div>
            <div class="modal-footer">
                ${this.createActionButtons(request)}
            </div>
        `;

        this.attachButtonEvents(modal, request);
        return modal;
    }

    /**
     * Create choice modal
     */
    private createChoiceModal(modal: HTMLElement, request: UserInteractionRequest): HTMLElement {
        modal.innerHTML = `
            <div class="modal-header">
                <div class="modal-title">
                    <i class="fas fa-list"></i>
                    ${request.title}
                </div>
            </div>
            <div class="modal-body">
                <div class="choice-message">${request.message}</div>
                <div class="choice-options">
                    ${(request.options || []).map(option => `
                        <div class="choice-option" data-option-id="${option.id}">
                            <div class="option-label">${option.label}</div>
                            ${option.description ? `<div class="option-description">${option.description}</div>` : ''}
                        </div>
                    `).join('')}
                </div>
                ${this.createTimeoutIndicator(request.timeout)}
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary cancel-btn">Cancel</button>
            </div>
        `;

        this.attachChoiceEvents(modal, request);
        return modal;
    }

    /**
     * Create input modal
     */
    private createInputModal(modal: HTMLElement, request: UserInteractionRequest): HTMLElement {
        modal.innerHTML = `
            <div class="modal-header">
                <div class="modal-title">
                    <i class="fas fa-edit"></i>
                    ${request.title}
                </div>
            </div>
            <div class="modal-body">
                <div class="input-message">${request.message}</div>
                <div class="input-field">
                    <input type="text" class="form-control" placeholder="Enter your response..." 
                           value="${request.defaultValue || ''}" autofocus>
                </div>
                ${this.createTimeoutIndicator(request.timeout)}
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary cancel-btn">Cancel</button>
                <button class="btn btn-primary submit-btn">Submit</button>
            </div>
        `;

        this.attachInputEvents(modal, request);
        return modal;
    }

    /**
     * Create generic modal
     */
    private createGenericModal(modal: HTMLElement, request: UserInteractionRequest): HTMLElement {
        modal.innerHTML = `
            <div class="modal-header">
                <div class="modal-title">${request.title}</div>
            </div>
            <div class="modal-body">
                <div class="generic-message">${request.message}</div>
                ${this.createTimeoutIndicator(request.timeout)}
            </div>
            <div class="modal-footer">
                ${this.createActionButtons(request)}
            </div>
        `;

        this.attachButtonEvents(modal, request);
        return modal;
    }

    /**
     * Format tool arguments for display
     */
    private formatToolArguments(args: Record<string, unknown>): string {
        const formatted = Object.entries(args).map(([key, value]) => {
            let displayValue: string;
            if (typeof value === 'string') {
                displayValue = value.length > 100 ? value.substring(0, 100) + '...' : value;
                displayValue = `"${displayValue}"`;
            } else if (typeof value === 'object') {
                displayValue = JSON.stringify(value, null, 2);
            } else {
                displayValue = String(value);
            }
            
            return `<div class="argument-item">
                <span class="argument-key">${key}:</span>
                <span class="argument-value">${displayValue}</span>
            </div>`;
        }).join('');

        return formatted || '<div class="no-arguments">No parameters</div>';
    }

    /**
     * Create action buttons based on request options
     */
    private createActionButtons(request: UserInteractionRequest): string {
        if (request.options && request.options.length > 0) {
            return request.options.map(option => `
                <button class="btn btn-${option.style || 'secondary'} action-btn" 
                        data-action="${option.id}" data-response="${option.action || option.id}">
                    ${option.label}
                </button>
            `).join('');
        } else {
            // Default confirmation buttons
            return `
                <button class="btn btn-secondary cancel-btn" data-response="cancel">Cancel</button>
                <button class="btn btn-primary confirm-btn" data-response="confirm">Confirm</button>
            `;
        }
    }

    /**
     * Create timeout indicator
     */
    private createTimeoutIndicator(timeout?: number): string {
        if (!timeout || timeout <= 0) return '';
        
        return `
            <div class="timeout-indicator">
                <div class="timeout-label">Auto-cancel in:</div>
                <div class="timeout-countdown" data-timeout="${timeout}">
                    <div class="countdown-bar">
                        <div class="countdown-fill"></div>
                    </div>
                    <div class="countdown-text">${Math.ceil(timeout / 1000)}s</div>
                </div>
            </div>
        `;
    }

    /**
     * Show modal
     */
    private showModal(modal: HTMLElement): void {
        this.modalContainer.innerHTML = '';
        this.modalContainer.appendChild(modal);
        this.overlay.style.display = 'flex';
        
        // Trigger animation
        setTimeout(() => {
            this.overlay.classList.add('show');
            modal.classList.add('show');
        }, 10);

        // Start timeout countdown if present
        this.startTimeoutCountdown(modal);

        // Focus first input if present
        const firstInput = modal.querySelector('input, button') as HTMLElement;
        if (firstInput) {
            firstInput.focus();
        }
    }

    /**
     * Hide modal
     */
    private hideModal(): void {
        this.overlay.classList.remove('show');
        const modal = this.modalContainer.querySelector('.llm-interaction-modal') as HTMLElement;
        if (modal) {
            modal.classList.remove('show');
        }
        
        setTimeout(() => {
            this.overlay.style.display = 'none';
            this.modalContainer.innerHTML = '';
        }, 300);
    }

    /**
     * Attach button events
     */
    private attachButtonEvents(modal: HTMLElement, request: UserInteractionRequest): void {
        const buttons = modal.querySelectorAll('.action-btn, .confirm-btn, .cancel-btn');
        buttons.forEach(button => {
            button.addEventListener('click', (e) => {
                const target = e.target as HTMLElement;
                const response = target.getAttribute('data-response') || 'cancel';
                this.respondToInteraction(request.id, response);
            });
        });
    }

    /**
     * Attach choice events
     */
    private attachChoiceEvents(modal: HTMLElement, request: UserInteractionRequest): void {
        const options = modal.querySelectorAll('.choice-option');
        options.forEach(option => {
            option.addEventListener('click', (e) => {
                const target = e.currentTarget as HTMLElement;
                const optionId = target.getAttribute('data-option-id');
                if (optionId) {
                    this.respondToInteraction(request.id, optionId);
                }
            });
        });

        // Cancel button
        const cancelBtn = modal.querySelector('.cancel-btn');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                this.respondToInteraction(request.id, 'cancel');
            });
        }
    }

    /**
     * Attach input events
     */
    private attachInputEvents(modal: HTMLElement, request: UserInteractionRequest): void {
        const input = modal.querySelector('input') as HTMLInputElement;
        const submitBtn = modal.querySelector('.submit-btn') as HTMLElement;
        const cancelBtn = modal.querySelector('.cancel-btn') as HTMLElement;

        const submitValue = () => {
            const value = input.value.trim();
            this.respondToInteraction(request.id, 'submit', value);
        };

        submitBtn.addEventListener('click', submitValue);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                submitValue();
            }
        });

        cancelBtn.addEventListener('click', () => {
            this.respondToInteraction(request.id, 'cancel');
        });
    }

    /**
     * Start timeout countdown
     */
    private startTimeoutCountdown(modal: HTMLElement): void {
        const countdown = modal.querySelector('.timeout-countdown') as HTMLElement;
        if (!countdown) return;

        const timeout = parseInt(countdown.getAttribute('data-timeout') || '0');
        if (timeout <= 0) return;

        const startTime = Date.now();
        const interval = setInterval(() => {
            const elapsed = Date.now() - startTime;
            const remaining = Math.max(0, timeout - elapsed);
            const progress = (elapsed / timeout) * 100;

            // Update countdown bar
            const fill = countdown.querySelector('.countdown-fill') as HTMLElement;
            if (fill) {
                fill.style.width = `${Math.min(100, progress)}%`;
            }

            // Update countdown text
            const text = countdown.querySelector('.countdown-text') as HTMLElement;
            if (text) {
                text.textContent = `${Math.ceil(remaining / 1000)}s`;
            }

            // Stop when timeout reached
            if (remaining <= 0) {
                clearInterval(interval);
            }
        }, 100);

        // Store interval for cleanup
        countdown.setAttribute('data-interval', interval.toString());
    }

    /**
     * Respond to interaction
     */
    private respondToInteraction(id: string, response: string, value?: any): void {
        const callback = this.responseCallbacks.get(id);
        if (!callback) return;

        const interactionResponse: UserInteractionResponse = {
            id,
            response,
            value,
            timestamp: Date.now()
        };

        // Clean up
        this.activeInteractions.delete(id);
        this.responseCallbacks.delete(id);
        this.hideModal();

        // Call callback
        callback(interactionResponse);
    }

    /**
     * Handle interaction timeout
     */
    private handleTimeout(id: string): void {
        this.respondToInteraction(id, 'timeout');
    }

    /**
     * Cancel all active interactions
     */
    public cancelAllInteractions(): void {
        const activeIds = Array.from(this.activeInteractions.keys());
        activeIds.forEach(id => {
            this.respondToInteraction(id, 'cancel');
        });
    }

    /**
     * Check if there are active interactions
     */
    public hasActiveInteractions(): boolean {
        return this.activeInteractions.size > 0;
    }

    /**
     * Get active interaction count
     */
    public getActiveInteractionCount(): number {
        return this.activeInteractions.size;
    }
}

// Export types for use in other modules
export type { UserInteractionRequest, UserInteractionResponse };