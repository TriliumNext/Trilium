/**
 * Tool Execution UI Components
 * 
 * This module provides enhanced UI components for displaying tool execution status,
 * progress, and user-friendly error messages during LLM tool calls.
 */

import { t } from "../../services/i18n.js";

/**
 * Tool execution status types
 */
export type ToolExecutionStatus = 'pending' | 'running' | 'success' | 'error' | 'cancelled';

/**
 * Tool execution display data
 */
export interface ToolExecutionDisplay {
    toolName: string;
    displayName: string;
    status: ToolExecutionStatus;
    description?: string;
    progress?: {
        current: number;
        total: number;
        message?: string;
    };
    result?: string;
    error?: string;
    startTime?: number;
    endTime?: number;
}

/**
 * Map of tool names to user-friendly display names
 */
const TOOL_DISPLAY_NAMES: Record<string, string> = {
    'search_notes': 'Searching Notes',
    'get_note_content': 'Reading Note',
    'create_note': 'Creating Note',
    'update_note': 'Updating Note',
    'execute_code': 'Running Code',
    'web_search': 'Searching Web',
    'get_note_attributes': 'Reading Note Properties',
    'set_note_attribute': 'Setting Note Property',
    'navigate_notes': 'Navigating Notes',
    'query_decomposition': 'Analyzing Query',
    'contextual_thinking': 'Processing Context'
};

/**
 * Map of tool names to descriptions
 */
const TOOL_DESCRIPTIONS: Record<string, string> = {
    'search_notes': 'Finding relevant notes in your knowledge base',
    'get_note_content': 'Reading the content of a specific note',
    'create_note': 'Creating a new note with the provided content',
    'update_note': 'Updating an existing note',
    'execute_code': 'Running code in a safe environment',
    'web_search': 'Searching the web for current information',
    'get_note_attributes': 'Reading note metadata and properties',
    'set_note_attribute': 'Updating note metadata',
    'navigate_notes': 'Exploring the note hierarchy',
    'query_decomposition': 'Breaking down complex queries',
    'contextual_thinking': 'Analyzing context for better understanding'
};

/**
 * Create a tool execution indicator element
 */
export function createToolExecutionIndicator(toolName: string): HTMLElement {
    const container = document.createElement('div');
    container.className = 'tool-execution-indicator mb-2 p-2 border rounded bg-light';
    container.dataset.toolName = toolName;
    
    const displayName = TOOL_DISPLAY_NAMES[toolName] || toolName;
    const description = TOOL_DESCRIPTIONS[toolName] || '';
    
    container.innerHTML = `
        <div class="d-flex align-items-center">
            <div class="tool-status-icon me-2">
                <div class="spinner-border spinner-border-sm text-primary" role="status">
                    <span class="visually-hidden">Loading...</span>
                </div>
            </div>
            <div class="flex-grow-1">
                <div class="tool-name fw-bold small">${displayName}</div>
                ${description ? `<div class="tool-description text-muted small">${description}</div>` : ''}
                <div class="tool-progress" style="display: none;">
                    <div class="progress mt-1" style="height: 4px;">
                        <div class="progress-bar" role="progressbar" style="width: 0%"></div>
                    </div>
                    <div class="progress-message text-muted small mt-1"></div>
                </div>
                <div class="tool-result text-success small mt-1" style="display: none;"></div>
                <div class="tool-error text-danger small mt-1" style="display: none;"></div>
            </div>
            <div class="tool-duration text-muted small ms-2" style="display: none;"></div>
        </div>
    `;
    
    return container;
}

/**
 * Update tool execution status
 */
export function updateToolExecutionStatus(
    container: HTMLElement,
    status: ToolExecutionStatus,
    data?: {
        progress?: { current: number; total: number; message?: string };
        result?: string;
        error?: string;
        duration?: number;
    }
): void {
    const statusIcon = container.querySelector('.tool-status-icon');
    const progressDiv = container.querySelector('.tool-progress') as HTMLElement;
    const progressBar = container.querySelector('.progress-bar') as HTMLElement;
    const progressMessage = container.querySelector('.progress-message') as HTMLElement;
    const resultDiv = container.querySelector('.tool-result') as HTMLElement;
    const errorDiv = container.querySelector('.tool-error') as HTMLElement;
    const durationDiv = container.querySelector('.tool-duration') as HTMLElement;
    
    if (!statusIcon) return;
    
    // Update status icon
    switch (status) {
        case 'pending':
            statusIcon.innerHTML = `
                <div class="spinner-border spinner-border-sm text-secondary" role="status">
                    <span class="visually-hidden">Pending...</span>
                </div>
            `;
            break;
            
        case 'running':
            statusIcon.innerHTML = `
                <div class="spinner-border spinner-border-sm text-primary" role="status">
                    <span class="visually-hidden">Running...</span>
                </div>
            `;
            break;
            
        case 'success':
            statusIcon.innerHTML = '<i class="bx bx-check-circle text-success fs-5"></i>';
            container.classList.add('border-success', 'bg-success-subtle');
            break;
            
        case 'error':
            statusIcon.innerHTML = '<i class="bx bx-error-circle text-danger fs-5"></i>';
            container.classList.add('border-danger', 'bg-danger-subtle');
            break;
            
        case 'cancelled':
            statusIcon.innerHTML = '<i class="bx bx-x-circle text-warning fs-5"></i>';
            container.classList.add('border-warning', 'bg-warning-subtle');
            break;
    }
    
    // Update progress if provided
    if (data?.progress && progressDiv && progressBar && progressMessage) {
        progressDiv.style.display = 'block';
        const percentage = (data.progress.current / data.progress.total) * 100;
        progressBar.style.width = `${percentage}%`;
        if (data.progress.message) {
            progressMessage.textContent = data.progress.message;
        }
    }
    
    // Update result if provided
    if (data?.result && resultDiv) {
        resultDiv.style.display = 'block';
        resultDiv.textContent = data.result;
    }
    
    // Update error if provided
    if (data?.error && errorDiv) {
        errorDiv.style.display = 'block';
        errorDiv.textContent = formatErrorMessage(data.error);
    }
    
    // Update duration if provided
    if (data?.duration && durationDiv) {
        durationDiv.style.display = 'block';
        durationDiv.textContent = formatDuration(data.duration);
    }
}

/**
 * Format error messages to be user-friendly
 */
function formatErrorMessage(error: string): string {
    // Remove technical details and provide user-friendly messages
    const errorMappings: Record<string, string> = {
        'ECONNREFUSED': 'Connection refused. Please check if the service is running.',
        'ETIMEDOUT': 'Request timed out. Please try again.',
        'ENOTFOUND': 'Service not found. Please check your configuration.',
        '401': 'Authentication failed. Please check your API credentials.',
        '403': 'Access denied. Please check your permissions.',
        '404': 'Resource not found.',
        '429': 'Rate limit exceeded. Please wait a moment and try again.',
        '500': 'Server error. Please try again later.',
        '503': 'Service temporarily unavailable. Please try again later.'
    };
    
    for (const [key, message] of Object.entries(errorMappings)) {
        if (error.includes(key)) {
            return message;
        }
    }
    
    // Generic error formatting
    if (error.length > 100) {
        return error.substring(0, 100) + '...';
    }
    
    return error;
}

/**
 * Format duration in a human-readable way
 */
function formatDuration(milliseconds: number): string {
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
 * Create a tool execution summary
 */
export function createToolExecutionSummary(executions: ToolExecutionDisplay[]): HTMLElement {
    const container = document.createElement('div');
    container.className = 'tool-execution-summary mt-2 p-2 border rounded bg-light small';
    
    const successful = executions.filter(e => e.status === 'success').length;
    const failed = executions.filter(e => e.status === 'error').length;
    const total = executions.length;
    
    const totalDuration = executions.reduce((sum, e) => {
        if (e.startTime && e.endTime) {
            return sum + (e.endTime - e.startTime);
        }
        return sum;
    }, 0);
    
    container.innerHTML = `
        <div class="d-flex align-items-center justify-content-between">
            <div>
                <i class="bx bx-check-shield me-1"></i>
                <span class="fw-bold">Tools Executed:</span>
                <span class="badge bg-success ms-1">${successful} successful</span>
                ${failed > 0 ? `<span class="badge bg-danger ms-1">${failed} failed</span>` : ''}
                <span class="badge bg-secondary ms-1">${total} total</span>
            </div>
            ${totalDuration > 0 ? `
                <div class="text-muted">
                    <i class="bx bx-time me-1"></i>
                    ${formatDuration(totalDuration)}
                </div>
            ` : ''}
        </div>
    `;
    
    return container;
}

/**
 * Create a loading indicator with custom message
 */
export function createLoadingIndicator(message: string = 'Processing...'): HTMLElement {
    const container = document.createElement('div');
    container.className = 'loading-indicator-enhanced d-flex align-items-center p-2';
    
    container.innerHTML = `
        <div class="spinner-grow spinner-grow-sm text-primary me-2" role="status">
            <span class="visually-hidden">Loading...</span>
        </div>
        <span class="loading-message">${message}</span>
    `;
    
    return container;
}

/**
 * Update loading indicator message
 */
export function updateLoadingMessage(container: HTMLElement, message: string): void {
    const messageElement = container.querySelector('.loading-message');
    if (messageElement) {
        messageElement.textContent = message;
    }
}

export default {
    createToolExecutionIndicator,
    updateToolExecutionStatus,
    createToolExecutionSummary,
    createLoadingIndicator,
    updateLoadingMessage
};