/**
 * Tool Preview System
 * 
 * Provides preview functionality for tool calls before execution,
 * allowing users to review and approve/reject tool operations.
 */

import type { Tool, ToolCall, ToolHandler } from './tool_interfaces.js';
import log from '../../log.js';
import {
    TOOL_DISPLAY_NAMES,
    TOOL_DESCRIPTIONS,
    TOOL_ESTIMATED_DURATIONS,
    TOOL_RISK_LEVELS,
    TOOL_WARNINGS,
    SENSITIVE_OPERATIONS,
    TIMING,
    LIMITS,
    ID_PREFIXES,
    generateId,
    truncateString
} from './tool_constants.js';

/**
 * Tool preview information
 */
export interface ToolPreview {
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
 * Tool execution plan
 */
export interface ToolExecutionPlan {
    id: string;
    tools: ToolPreview[];
    totalEstimatedDuration: number;
    requiresConfirmation: boolean;
    createdAt: Date;
}

/**
 * Tool approval status
 */
export interface ToolApproval {
    planId: string;
    approved: boolean;
    rejectedTools?: string[];
    modifiedParameters?: Record<string, Record<string, unknown>>;
    approvedAt?: Date;
    approvedBy?: string;
}

/**
 * Tool preview configuration
 */
interface ToolPreviewConfig {
    requireConfirmationForSensitive: boolean;
    sensitiveOperations: string[];
    estimatedDurations: Record<string, number>;
    riskLevels: Record<string, 'low' | 'medium' | 'high'>;
}

/**
 * Default configuration for tool previews
 */
const DEFAULT_CONFIG: ToolPreviewConfig = {
    requireConfirmationForSensitive: true,
    sensitiveOperations: [...SENSITIVE_OPERATIONS],
    estimatedDurations: { ...TOOL_ESTIMATED_DURATIONS },
    riskLevels: { ...TOOL_RISK_LEVELS }
};

/**
 * Tool Preview Manager
 */
export class ToolPreviewManager {
    private config: ToolPreviewConfig;
    private executionPlans: Map<string, ToolExecutionPlan> = new Map();
    private approvals: Map<string, ToolApproval> = new Map();

    constructor(config?: Partial<ToolPreviewConfig>) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Create a preview for a single tool call
     */
    public createToolPreview(toolCall: ToolCall, handler?: ToolHandler): ToolPreview {
        const toolName = toolCall.function.name;
        const parameters = typeof toolCall.function.arguments === 'string'
            ? JSON.parse(toolCall.function.arguments)
            : toolCall.function.arguments;

        const preview: ToolPreview = {
            id: toolCall.id || generateId(ID_PREFIXES.PREVIEW),
            toolName,
            displayName: this.getDisplayName(toolName),
            description: this.getToolDescription(toolName, handler),
            parameters,
            formattedParameters: this.formatParameters(parameters, handler),
            estimatedDuration: this.getEstimatedDuration(toolName),
            riskLevel: this.getRiskLevel(toolName),
            requiresConfirmation: this.requiresConfirmation(toolName),
            warnings: this.getWarnings(toolName, parameters)
        };

        return preview;
    }

    /**
     * Create an execution plan for multiple tool calls
     */
    public createExecutionPlan(toolCalls: ToolCall[], handlers?: Map<string, ToolHandler>): ToolExecutionPlan {
        const planId = generateId(ID_PREFIXES.PLAN);
        const tools: ToolPreview[] = [];
        let totalDuration = 0;
        let requiresConfirmation = false;

        for (const toolCall of toolCalls) {
            const handler = handlers?.get(toolCall.function.name);
            const preview = this.createToolPreview(toolCall, handler);
            tools.push(preview);
            totalDuration += preview.estimatedDuration;
            if (preview.requiresConfirmation) {
                requiresConfirmation = true;
            }
        }

        const plan: ToolExecutionPlan = {
            id: planId,
            tools,
            totalEstimatedDuration: totalDuration,
            requiresConfirmation,
            createdAt: new Date()
        };

        this.executionPlans.set(planId, plan);
        return plan;
    }

    /**
     * Get a stored execution plan
     */
    public getExecutionPlan(planId: string): ToolExecutionPlan | undefined {
        return this.executionPlans.get(planId);
    }

    /**
     * Record tool approval
     */
    public recordApproval(approval: ToolApproval): void {
        approval.approvedAt = new Date();
        this.approvals.set(approval.planId, approval);
        log.info(`Tool execution plan ${approval.planId} ${approval.approved ? 'approved' : 'rejected'}`);
    }

    /**
     * Get approval for a plan
     */
    public getApproval(planId: string): ToolApproval | undefined {
        return this.approvals.get(planId);
    }

    /**
     * Check if a plan is approved
     */
    public isPlanApproved(planId: string): boolean {
        const approval = this.approvals.get(planId);
        return approval?.approved === true;
    }

    /**
     * Get display name for a tool
     */
    private getDisplayName(toolName: string): string {
        return TOOL_DISPLAY_NAMES[toolName] || toolName;
    }

    /**
     * Get tool description
     */
    private getToolDescription(toolName: string, handler?: ToolHandler): string {
        if (handler?.definition.function.description) {
            return handler.definition.function.description;
        }

        return TOOL_DESCRIPTIONS[toolName] || 'Execute tool operation';
    }

    /**
     * Format parameters for display
     */
    private formatParameters(parameters: Record<string, unknown>, handler?: ToolHandler): string[] {
        const formatted: string[] = [];

        for (const [key, value] of Object.entries(parameters)) {
            let displayValue: string;
            
            if (value === null || value === undefined) {
                displayValue = 'none';
            } else if (typeof value === 'string') {
                // Truncate long strings
                displayValue = `"${truncateString(value, LIMITS.MAX_STRING_DISPLAY_LENGTH)}"`;
            } else if (Array.isArray(value)) {
                displayValue = `[${value.length} items]`;
            } else if (typeof value === 'object') {
                displayValue = '{object}';
            } else {
                displayValue = String(value);
            }

            // Get parameter description from handler if available
            const paramDef = handler?.definition.function.parameters.properties[key];
            const description = paramDef?.description || '';

            formatted.push(`${key}: ${displayValue}${description ? ` (${description})` : ''}`);
        }

        return formatted;
    }

    /**
     * Get estimated duration for a tool
     */
    private getEstimatedDuration(toolName: string): number {
        return this.config.estimatedDurations[toolName] || 1000;
    }

    /**
     * Get risk level for a tool
     */
    private getRiskLevel(toolName: string): 'low' | 'medium' | 'high' {
        return this.config.riskLevels[toolName] || 'low';
    }

    /**
     * Check if tool requires confirmation
     */
    private requiresConfirmation(toolName: string): boolean {
        if (!this.config.requireConfirmationForSensitive) {
            return false;
        }
        return this.config.sensitiveOperations.includes(toolName);
    }

    /**
     * Get warnings for a tool call
     */
    private getWarnings(toolName: string, parameters: Record<string, unknown>): string[] | undefined {
        const warnings: string[] = [];

        // Add predefined warnings
        const predefinedWarnings = TOOL_WARNINGS[toolName];
        if (predefinedWarnings) {
            warnings.push(...predefinedWarnings);
        }

        // Add dynamic warnings based on parameters
        if (toolName === 'update_note' && parameters.content) {
            const content = String(parameters.content);
            if (content.length > LIMITS.LARGE_CONTENT_THRESHOLD) {
                warnings.push('Large content update may take longer');
            }
        }

        return warnings.length > 0 ? warnings : undefined;
    }

    /**
     * Clean up old execution plans
     */
    public cleanup(maxAgeMs: number = TIMING.CLEANUP_MAX_AGE): void {
        const now = Date.now();
        const cutoff = new Date(now - maxAgeMs);

        for (const [planId, plan] of this.executionPlans.entries()) {
            if (plan.createdAt < cutoff) {
                this.executionPlans.delete(planId);
                this.approvals.delete(planId);
            }
        }

        log.info(`Cleaned up execution plans older than ${maxAgeMs}ms`);
    }
}

// Export singleton instance
export const toolPreviewManager = new ToolPreviewManager();
export default toolPreviewManager;