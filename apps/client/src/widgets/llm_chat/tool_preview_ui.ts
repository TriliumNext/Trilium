/**
 * Tool Preview UI Component
 * 
 * Provides UI for previewing tool executions before they run,
 * allowing users to approve, reject, or modify tool parameters.
 */

import { t } from "../../services/i18n.js";

/**
 * Tool preview data from server
 */
export interface ToolPreviewData {
    id: string;
    toolName: string;
    displayName: string;
    description: string;
    parameters: Record<string, unknown>;
    formattedParameters: string[];
    estimatedDuration: number;
    riskLevel: 'low' | 'medium' | 'high';
    requiresConfirmation: boolean;
    warnings?: string[];
}

/**
 * Execution plan from server
 */
export interface ExecutionPlanData {
    id: string;
    tools: ToolPreviewData[];
    totalEstimatedDuration: number;
    requiresConfirmation: boolean;
    createdAt: string;
}

/**
 * User approval data
 */
export interface UserApproval {
    planId: string;
    approved: boolean;
    rejectedTools?: string[];
    modifiedParameters?: Record<string, Record<string, unknown>>;
}

/**
 * Tool Preview UI Manager
 */
export class ToolPreviewUI {
    private container: HTMLElement;
    private currentPlan?: ExecutionPlanData;
    private onApprovalCallback?: (approval: UserApproval) => void;

    constructor(container: HTMLElement) {
        this.container = container;
    }

    /**
     * Show tool execution preview
     */
    public async showPreview(
        plan: ExecutionPlanData,
        onApproval: (approval: UserApproval) => void
    ): Promise<void> {
        this.currentPlan = plan;
        this.onApprovalCallback = onApproval;

        const previewElement = this.createPreviewElement(plan);
        this.container.appendChild(previewElement);

        // Auto-scroll to preview
        previewElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    /**
     * Create preview element
     */
    private createPreviewElement(plan: ExecutionPlanData): HTMLElement {
        const element = document.createElement('div');
        element.className = 'tool-preview-container mb-3 border rounded p-3 bg-light';
        element.dataset.planId = plan.id;

        // Header
        const header = document.createElement('div');
        header.className = 'tool-preview-header mb-3';
        header.innerHTML = `
            <h6 class="mb-2">
                <i class="bx bx-shield-quarter me-2"></i>
                ${t('Tool Execution Preview')}
            </h6>
            <p class="text-muted small mb-2">
                ${plan.tools.length} ${plan.tools.length === 1 ? 'tool' : 'tools'} will be executed
                ${plan.requiresConfirmation ? ' (confirmation required)' : ''}
            </p>
            <div class="d-flex align-items-center gap-3 small text-muted">
                <span>
                    <i class="bx bx-time-five me-1"></i>
                    Estimated time: ${this.formatDuration(plan.totalEstimatedDuration)}
                </span>
            </div>
        `;
        element.appendChild(header);

        // Tool list
        const toolList = document.createElement('div');
        toolList.className = 'tool-preview-list mb-3';

        plan.tools.forEach((tool, index) => {
            const toolElement = this.createToolPreviewItem(tool, index);
            toolList.appendChild(toolElement);
        });

        element.appendChild(toolList);

        // Actions
        const actions = document.createElement('div');
        actions.className = 'tool-preview-actions d-flex gap-2';

        if (plan.requiresConfirmation) {
            actions.innerHTML = `
                <button class="btn btn-success btn-sm approve-all-btn">
                    <i class="bx bx-check me-1"></i>
                    Approve All
                </button>
                <button class="btn btn-warning btn-sm modify-btn">
                    <i class="bx bx-edit me-1"></i>
                    Modify
                </button>
                <button class="btn btn-danger btn-sm reject-all-btn">
                    <i class="bx bx-x me-1"></i>
                    Reject All
                </button>
            `;

            // Add event listeners
            const approveBtn = actions.querySelector('.approve-all-btn') as HTMLButtonElement;
            const modifyBtn = actions.querySelector('.modify-btn') as HTMLButtonElement;
            const rejectBtn = actions.querySelector('.reject-all-btn') as HTMLButtonElement;

            approveBtn?.addEventListener('click', () => this.handleApproveAll());
            modifyBtn?.addEventListener('click', () => this.handleModify());
            rejectBtn?.addEventListener('click', () => this.handleRejectAll());
        } else {
            // Auto-approve after showing preview
            setTimeout(() => {
                this.handleApproveAll();
            }, 500);
        }

        element.appendChild(actions);

        return element;
    }

    /**
     * Create tool preview item
     */
    private createToolPreviewItem(tool: ToolPreviewData, index: number): HTMLElement {
        const item = document.createElement('div');
        item.className = 'tool-preview-item mb-2 p-2 border rounded bg-white';
        item.dataset.toolName = tool.toolName;

        const riskBadge = this.getRiskBadge(tool.riskLevel);
        const riskIcon = this.getRiskIcon(tool.riskLevel);

        item.innerHTML = `
            <div class="d-flex align-items-start">
                <div class="tool-preview-checkbox me-2 pt-1">
                    <input type="checkbox" class="form-check-input" 
                           id="tool-${index}" 
                           checked 
                           ${tool.requiresConfirmation ? '' : 'disabled'}>
                </div>
                <div class="flex-grow-1">
                    <div class="d-flex align-items-center mb-1">
                        <label class="tool-name fw-bold small mb-0" for="tool-${index}">
                            ${tool.displayName}
                        </label>
                        ${riskBadge}
                        ${riskIcon}
                    </div>
                    <div class="tool-description text-muted small mb-2">
                        ${tool.description}
                    </div>
                    <div class="tool-parameters small">
                        <details>
                            <summary class="text-primary cursor-pointer">
                                Parameters (${Object.keys(tool.parameters).length})
                            </summary>
                            <div class="mt-1 p-2 bg-light rounded">
                                ${this.formatParameters(tool.formattedParameters)}
                            </div>
                        </details>
                    </div>
                    ${tool.warnings && tool.warnings.length > 0 ? `
                        <div class="tool-warnings mt-2">
                            ${tool.warnings.map(w => `
                                <div class="alert alert-warning py-1 px-2 mb-1 small">
                                    <i class="bx bx-error-circle me-1"></i>
                                    ${w}
                                </div>
                            `).join('')}
                        </div>
                    ` : ''}
                </div>
                <div class="tool-duration text-muted small ms-2">
                    <i class="bx bx-time me-1"></i>
                    ~${this.formatDuration(tool.estimatedDuration)}
                </div>
            </div>
        `;

        return item;
    }

    /**
     * Get risk level badge
     */
    private getRiskBadge(riskLevel: 'low' | 'medium' | 'high'): string {
        const badges = {
            low: '<span class="badge bg-success ms-2">Low Risk</span>',
            medium: '<span class="badge bg-warning ms-2">Medium Risk</span>',
            high: '<span class="badge bg-danger ms-2">High Risk</span>'
        };
        return badges[riskLevel] || '';
    }

    /**
     * Get risk level icon
     */
    private getRiskIcon(riskLevel: 'low' | 'medium' | 'high'): string {
        const icons = {
            low: '<i class="bx bx-shield-check text-success ms-2"></i>',
            medium: '<i class="bx bx-shield text-warning ms-2"></i>',
            high: '<i class="bx bx-shield-x text-danger ms-2"></i>'
        };
        return icons[riskLevel] || '';
    }

    /**
     * Format parameters for display
     */
    private formatParameters(parameters: string[]): string {
        return parameters.map(param => {
            const [key, ...valueParts] = param.split(':');
            const value = valueParts.join(':').trim();
            return `
                <div class="parameter-item mb-1">
                    <span class="parameter-key text-muted">${key}:</span>
                    <span class="parameter-value ms-1">${this.escapeHtml(value)}</span>
                </div>
            `;
        }).join('');
    }

    /**
     * Handle approve all
     */
    private handleApproveAll(): void {
        if (!this.currentPlan || !this.onApprovalCallback) return;

        const approval: UserApproval = {
            planId: this.currentPlan.id,
            approved: true
        };

        this.onApprovalCallback(approval);
        this.hidePreview();
    }

    /**
     * Handle modify
     */
    private handleModify(): void {
        if (!this.currentPlan) return;

        // Get selected tools
        const checkboxes = this.container.querySelectorAll('.tool-preview-item input[type="checkbox"]');
        const rejectedTools: string[] = [];

        checkboxes.forEach((checkbox: Element) => {
            const input = checkbox as HTMLInputElement;
            const toolItem = input.closest('.tool-preview-item') as HTMLElement;
            const toolName = toolItem?.dataset.toolName;

            if (toolName && !input.checked) {
                rejectedTools.push(toolName);
            }
        });

        const approval: UserApproval = {
            planId: this.currentPlan.id,
            approved: true,
            rejectedTools: rejectedTools.length > 0 ? rejectedTools : undefined
        };

        if (this.onApprovalCallback) {
            this.onApprovalCallback(approval);
        }

        this.hidePreview();
    }

    /**
     * Handle reject all
     */
    private handleRejectAll(): void {
        if (!this.currentPlan || !this.onApprovalCallback) return;

        const approval: UserApproval = {
            planId: this.currentPlan.id,
            approved: false
        };

        this.onApprovalCallback(approval);
        this.hidePreview();
    }

    /**
     * Hide preview
     */
    private hidePreview(): void {
        const preview = this.container.querySelector('.tool-preview-container');
        if (preview) {
            // Add fade out animation
            preview.classList.add('fade-out');
            setTimeout(() => {
                preview.remove();
            }, 300);
        }

        this.currentPlan = undefined;
        this.onApprovalCallback = undefined;
    }

    /**
     * Format duration
     */
    private formatDuration(milliseconds: number): string {
        if (milliseconds < 1000) {
            return `${milliseconds}ms`;
        } else if (milliseconds < 60000) {
            return `${(milliseconds / 1000).toFixed(1)}s`;
        } else {
            const minutes = Math.floor(milliseconds / 60000);
            const seconds = Math.floor((milliseconds % 60000) / 1000);
            return `${minutes}m ${seconds}s`;
        }
    }

    /**
     * Escape HTML
     */
    private escapeHtml(text: string): string {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

/**
 * Create a tool preview UI instance
 */
export function createToolPreviewUI(container: HTMLElement): ToolPreviewUI {
    return new ToolPreviewUI(container);
}