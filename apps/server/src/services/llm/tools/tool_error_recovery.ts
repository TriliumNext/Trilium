/**
 * Tool Error Recovery System
 * 
 * Implements robust error recovery for tool failures including retry logic,
 * circuit breaker pattern, and user-friendly error handling.
 */

import log from '../../log.js';
import type { ToolCall, ToolHandler } from './tool_interfaces.js';
import {
    TIMING,
    LIMITS,
    ERROR_PATTERNS,
    TOOL_ALTERNATIVES,
    TOOL_NAMES
} from './tool_constants.js';

/**
 * Error types for tool execution
 */
export enum ToolErrorType {
    NETWORK = 'network',
    TIMEOUT = 'timeout',
    VALIDATION = 'validation',
    PERMISSION = 'permission',
    RATE_LIMIT = 'rate_limit',
    NOT_FOUND = 'not_found',
    INTERNAL = 'internal',
    UNKNOWN = 'unknown'
}

/**
 * Tool error with categorization
 */
export interface ToolError {
    type: ToolErrorType;
    message: string;
    originalError?: Error;
    retryable: boolean;
    userMessage: string;
    suggestions?: string[];
    context?: Record<string, unknown>;
}

/**
 * Retry configuration
 */
export interface RetryConfig {
    maxAttempts: number;
    initialDelayMs: number;
    maxDelayMs: number;
    backoffMultiplier: number;
    jitterMs: number;
    retryableErrors: ToolErrorType[];
}

/**
 * Circuit breaker state
 */
export enum CircuitState {
    CLOSED = 'closed',
    OPEN = 'open',
    HALF_OPEN = 'half_open'
}

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
    failureThreshold: number;
    successThreshold: number;
    timeout: number;
    halfOpenRequests: number;
}

/**
 * Tool execution result with error recovery
 */
export interface ToolExecutionResult<T = any> {
    success: boolean;
    data?: T;
    error?: ToolError;
    attempts: number;
    totalDuration: number;
    recovered: boolean;
}

/**
 * Recovery action
 */
export interface RecoveryAction {
    type: 'retry' | 'modify' | 'alternative' | 'skip' | 'abort';
    description: string;
    action?: () => Promise<any>;
    modifiedParameters?: Record<string, unknown>;
    alternativeTool?: string;
}

/**
 * Default retry configuration
 */
const DEFAULT_RETRY_CONFIG: RetryConfig = {
    maxAttempts: LIMITS.MAX_RETRY_ATTEMPTS,
    initialDelayMs: TIMING.RETRY_INITIAL_DELAY,
    maxDelayMs: TIMING.RETRY_MAX_DELAY,
    backoffMultiplier: LIMITS.RETRY_BACKOFF_MULTIPLIER,
    jitterMs: TIMING.RETRY_JITTER,
    retryableErrors: [
        ToolErrorType.NETWORK,
        ToolErrorType.TIMEOUT,
        ToolErrorType.RATE_LIMIT,
        ToolErrorType.INTERNAL
    ]
};

/**
 * Default circuit breaker configuration
 */
const DEFAULT_CIRCUIT_CONFIG: CircuitBreakerConfig = {
    failureThreshold: LIMITS.CIRCUIT_FAILURE_THRESHOLD,
    successThreshold: LIMITS.CIRCUIT_SUCCESS_THRESHOLD,
    timeout: TIMING.CIRCUIT_BREAKER_TIMEOUT,
    halfOpenRequests: LIMITS.CIRCUIT_HALF_OPEN_REQUESTS
};

/**
 * Circuit breaker for a tool
 */
class CircuitBreaker {
    private state: CircuitState = CircuitState.CLOSED;
    private failureCount: number = 0;
    private successCount: number = 0;
    private lastFailureTime?: Date;
    private halfOpenAttempts: number = 0;

    constructor(
        private toolName: string,
        private config: CircuitBreakerConfig
    ) {}

    /**
     * Check if the circuit allows execution
     */
    public canExecute(): boolean {
        switch (this.state) {
            case CircuitState.CLOSED:
                return true;
            
            case CircuitState.OPEN:
                // Check if timeout has passed
                if (this.lastFailureTime) {
                    const timeSinceFailure = Date.now() - this.lastFailureTime.getTime();
                    if (timeSinceFailure >= this.config.timeout) {
                        this.state = CircuitState.HALF_OPEN;
                        this.halfOpenAttempts = 0;
                        log.info(`Circuit breaker for ${this.toolName} moved to HALF_OPEN state`);
                        return true;
                    }
                }
                return false;
            
            case CircuitState.HALF_OPEN:
                return this.halfOpenAttempts < this.config.halfOpenRequests;
        }
    }

    /**
     * Record a successful execution
     */
    public recordSuccess(): void {
        switch (this.state) {
            case CircuitState.CLOSED:
                // Nothing to do
                break;
            
            case CircuitState.HALF_OPEN:
                this.successCount++;
                if (this.successCount >= this.config.successThreshold) {
                    this.state = CircuitState.CLOSED;
                    this.failureCount = 0;
                    this.successCount = 0;
                    log.info(`Circuit breaker for ${this.toolName} moved to CLOSED state`);
                }
                break;
            
            case CircuitState.OPEN:
                // Should not happen
                log.info(`Unexpected success recorded in OPEN state for ${this.toolName}`);
                break;
        }
    }

    /**
     * Record a failed execution
     */
    public recordFailure(): void {
        this.lastFailureTime = new Date();

        switch (this.state) {
            case CircuitState.CLOSED:
                this.failureCount++;
                if (this.failureCount >= this.config.failureThreshold) {
                    this.state = CircuitState.OPEN;
                    log.info(`Circuit breaker for ${this.toolName} moved to OPEN state after ${this.failureCount} failures`);
                }
                break;
            
            case CircuitState.HALF_OPEN:
                this.halfOpenAttempts++;
                this.state = CircuitState.OPEN;
                this.successCount = 0;
                log.info(`Circuit breaker for ${this.toolName} moved back to OPEN state`);
                break;
            
            case CircuitState.OPEN:
                // Already open
                break;
        }
    }

    /**
     * Get current state
     */
    public getState(): CircuitState {
        return this.state;
    }

    /**
     * Reset the circuit breaker
     */
    public reset(): void {
        this.state = CircuitState.CLOSED;
        this.failureCount = 0;
        this.successCount = 0;
        this.lastFailureTime = undefined;
        this.halfOpenAttempts = 0;
    }
}

/**
 * Tool Error Recovery Manager
 */
export class ToolErrorRecoveryManager {
    private retryConfig: RetryConfig;
    private circuitBreakerConfig: CircuitBreakerConfig;
    private circuitBreakers: Map<string, CircuitBreaker> = new Map();
    private errorHistory: Map<string, ToolError[]> = new Map();
    private maxErrorHistorySize: number = LIMITS.MAX_ERROR_HISTORY_SIZE;

    constructor(
        retryConfig?: Partial<RetryConfig>,
        circuitBreakerConfig?: Partial<CircuitBreakerConfig>
    ) {
        this.retryConfig = { ...DEFAULT_RETRY_CONFIG, ...retryConfig };
        this.circuitBreakerConfig = { ...DEFAULT_CIRCUIT_CONFIG, ...circuitBreakerConfig };
    }

    /**
     * Execute a tool with error recovery
     */
    public async executeWithRecovery<T = any>(
        toolCall: ToolCall,
        handler: ToolHandler,
        onRetry?: (attempt: number, delay: number) => void
    ): Promise<ToolExecutionResult<T>> {
        const toolName = toolCall.function.name;
        const startTime = Date.now();
        
        // Get or create circuit breaker
        let circuitBreaker = this.circuitBreakers.get(toolName);
        if (!circuitBreaker) {
            circuitBreaker = new CircuitBreaker(toolName, this.circuitBreakerConfig);
            this.circuitBreakers.set(toolName, circuitBreaker);
        }

        // Check circuit breaker
        if (!circuitBreaker.canExecute()) {
            const error: ToolError = {
                type: ToolErrorType.INTERNAL,
                message: `Circuit breaker is open for ${toolName}`,
                retryable: false,
                userMessage: 'This tool is temporarily unavailable due to repeated failures',
                suggestions: ['Try again later', 'Use an alternative approach']
            };

            this.recordError(toolName, error);

            return {
                success: false,
                error,
                attempts: 0,
                totalDuration: Date.now() - startTime,
                recovered: false
            };
        }

        // Parse arguments
        const args = typeof toolCall.function.arguments === 'string'
            ? JSON.parse(toolCall.function.arguments)
            : toolCall.function.arguments;

        let lastError: ToolError | undefined;
        let attempts = 0;

        // Retry loop
        for (let attempt = 1; attempt <= this.retryConfig.maxAttempts; attempt++) {
            attempts = attempt;

            try {
                // Execute the tool
                const result = await handler.execute(args);
                
                // Record success
                circuitBreaker.recordSuccess();

                return {
                    success: true,
                    data: result as T,
                    attempts,
                    totalDuration: Date.now() - startTime,
                    recovered: attempt > 1
                };

            } catch (error: any) {
                // Categorize the error
                const toolError = this.categorizeError(error);
                lastError = toolError;

                log.info(`Tool ${toolName} failed (attempt ${attempt}/${this.retryConfig.maxAttempts}): ${toolError.message}`);

                // Check if error is retryable
                if (!toolError.retryable || !this.retryConfig.retryableErrors.includes(toolError.type)) {
                    circuitBreaker.recordFailure();
                    this.recordError(toolName, toolError);
                    break;
                }

                // Check if we have more attempts
                if (attempt < this.retryConfig.maxAttempts) {
                    const delay = this.calculateRetryDelay(attempt);
                    
                    if (onRetry) {
                        onRetry(attempt, delay);
                    }

                    log.info(`Retrying ${toolName} after ${delay}ms...`);
                    await this.sleep(delay);
                } else {
                    // No more attempts
                    circuitBreaker.recordFailure();
                    this.recordError(toolName, toolError);
                }
            }
        }

        // All attempts failed
        return {
            success: false,
            error: lastError,
            attempts,
            totalDuration: Date.now() - startTime,
            recovered: false
        };
    }

    /**
     * Categorize an error
     */
    public categorizeError(error: any): ToolError {
        const message = error.message || String(error);

        // Network errors
        if (ERROR_PATTERNS.NETWORK.some(pattern => message.includes(pattern))) {
            return {
                type: ToolErrorType.NETWORK,
                message,
                originalError: error,
                retryable: true,
                userMessage: 'Network connection error. Please check your internet connection.',
                suggestions: ['Check network connectivity', 'Verify service availability']
            };
        }

        // Timeout errors
        if (ERROR_PATTERNS.TIMEOUT.some(pattern => message.includes(pattern))) {
            return {
                type: ToolErrorType.TIMEOUT,
                message,
                originalError: error,
                retryable: true,
                userMessage: 'The operation took too long to complete.',
                suggestions: ['Try again with smaller data', 'Check system performance']
            };
        }

        // Rate limit errors
        if (ERROR_PATTERNS.RATE_LIMIT.some(pattern => message.includes(pattern))) {
            return {
                type: ToolErrorType.RATE_LIMIT,
                message,
                originalError: error,
                retryable: true,
                userMessage: 'Too many requests. Please wait a moment.',
                suggestions: ['Wait before retrying', 'Reduce request frequency']
            };
        }

        // Permission errors
        if (ERROR_PATTERNS.PERMISSION.some(pattern => message.includes(pattern))) {
            return {
                type: ToolErrorType.PERMISSION,
                message,
                originalError: error,
                retryable: false,
                userMessage: 'Permission denied. Please check your credentials.',
                suggestions: ['Verify API keys', 'Check access permissions']
            };
        }

        // Not found errors
        if (ERROR_PATTERNS.NOT_FOUND.some(pattern => message.includes(pattern))) {
            return {
                type: ToolErrorType.NOT_FOUND,
                message,
                originalError: error,
                retryable: false,
                userMessage: 'The requested resource was not found.',
                suggestions: ['Verify the resource ID', 'Check if resource was deleted']
            };
        }

        // Validation errors
        if (ERROR_PATTERNS.VALIDATION.some(pattern => message.includes(pattern))) {
            return {
                type: ToolErrorType.VALIDATION,
                message,
                originalError: error,
                retryable: false,
                userMessage: 'Invalid input parameters.',
                suggestions: ['Check input format', 'Verify required fields']
            };
        }

        // Internal errors
        if (ERROR_PATTERNS.INTERNAL.some(pattern => message.includes(pattern))) {
            return {
                type: ToolErrorType.INTERNAL,
                message,
                originalError: error,
                retryable: true,
                userMessage: 'An internal error occurred.',
                suggestions: ['Try again later', 'Contact support if issue persists']
            };
        }

        // Unknown errors
        return {
            type: ToolErrorType.UNKNOWN,
            message,
            originalError: error,
            retryable: true,
            userMessage: 'An unexpected error occurred.',
            suggestions: ['Try again', 'Check logs for details']
        };
    }

    /**
     * Suggest recovery actions for an error
     */
    public suggestRecoveryActions(
        toolName: string,
        error: ToolError,
        parameters: Record<string, unknown>
    ): RecoveryAction[] {
        const actions: RecoveryAction[] = [];

        // Retry action for retryable errors
        if (error.retryable) {
            actions.push({
                type: 'retry',
                description: 'Retry the operation',
                action: async () => {
                    // Implementation would retry with same parameters
                    return null;
                }
            });
        }

        // Suggest parameter modifications based on error type
        if (error.type === ToolErrorType.VALIDATION) {
            actions.push({
                type: 'modify',
                description: 'Modify parameters and retry',
                modifiedParameters: this.suggestParameterModifications(toolName, parameters, error)
            });
        }

        // Suggest alternative tools
        const alternativeTool = this.suggestAlternativeTool(toolName, error);
        if (alternativeTool) {
            actions.push({
                type: 'alternative',
                description: `Use ${alternativeTool} instead`,
                alternativeTool
            });
        }

        // Skip action
        actions.push({
            type: 'skip',
            description: 'Skip this operation and continue'
        });

        // Abort action for critical errors
        if (error.type === ToolErrorType.PERMISSION || !error.retryable) {
            actions.push({
                type: 'abort',
                description: 'Abort the entire operation'
            });
        }

        return actions;
    }

    /**
     * Suggest parameter modifications
     */
    private suggestParameterModifications(
        toolName: string,
        parameters: Record<string, unknown>,
        error: ToolError
    ): Record<string, unknown> {
        const modified = { ...parameters };

        // Tool-specific modifications
        if (toolName === TOOL_NAMES.SEARCH_NOTES && error.message.includes('limit')) {
            modified.limit = Math.min((parameters.limit as number) || 10, 5);
        }

        if (toolName === TOOL_NAMES.WEB_SEARCH && error.type === ToolErrorType.TIMEOUT) {
            modified.timeout = TIMING.RETRY_MAX_DELAY; // Increase timeout
        }

        return modified;
    }

    /**
     * Suggest alternative tool
     */
    private suggestAlternativeTool(toolName: string, error: ToolError): string | undefined {
        const toolAlternatives = TOOL_ALTERNATIVES[toolName];
        if (toolAlternatives && toolAlternatives.length > 0) {
            return toolAlternatives[0];
        }

        return undefined;
    }

    /**
     * Calculate retry delay with exponential backoff and jitter
     */
    private calculateRetryDelay(attempt: number): number {
        const exponentialDelay = Math.min(
            this.retryConfig.initialDelayMs * Math.pow(this.retryConfig.backoffMultiplier, attempt - 1),
            this.retryConfig.maxDelayMs
        );

        // Add jitter to prevent thundering herd
        const jitter = Math.random() * this.retryConfig.jitterMs - this.retryConfig.jitterMs / 2;

        return Math.max(0, exponentialDelay + jitter);
    }

    /**
     * Record an error for history
     */
    private recordError(toolName: string, error: ToolError): void {
        if (!this.errorHistory.has(toolName)) {
            this.errorHistory.set(toolName, []);
        }

        const errors = this.errorHistory.get(toolName)!;
        errors.unshift(error);

        // Trim history
        if (errors.length > this.maxErrorHistorySize) {
            errors.splice(this.maxErrorHistorySize);
        }
    }

    /**
     * Get error history for a tool
     */
    public getErrorHistory(toolName: string): ToolError[] {
        return this.errorHistory.get(toolName) || [];
    }

    /**
     * Get circuit breaker state
     */
    public getCircuitBreakerState(toolName: string): CircuitState | undefined {
        const breaker = this.circuitBreakers.get(toolName);
        return breaker?.getState();
    }

    /**
     * Reset circuit breaker for a tool
     */
    public resetCircuitBreaker(toolName: string): void {
        const breaker = this.circuitBreakers.get(toolName);
        if (breaker) {
            breaker.reset();
            log.info(`Reset circuit breaker for ${toolName}`);
        }
    }

    /**
     * Sleep for specified milliseconds
     */
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Clear all error history
     */
    public clearHistory(): void {
        this.errorHistory.clear();
    }
}

// Export singleton instance
export const toolErrorRecoveryManager = new ToolErrorRecoveryManager();
export default toolErrorRecoveryManager;