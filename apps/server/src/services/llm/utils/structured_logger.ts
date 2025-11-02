/**
 * Structured Logger - Phase 1 Implementation
 *
 * Provides structured logging with:
 * - Proper log levels (ERROR, WARN, INFO, DEBUG)
 * - Request ID tracking
 * - Conditional debug logging
 * - Performance tracking
 *
 * Design: Lightweight wrapper around existing log system
 * No dependencies on configuration service for simplicity
 */

import log from '../../log.js';

// Log levels
export enum LogLevel {
    ERROR = 'error',
    WARN = 'warn',
    INFO = 'info',
    DEBUG = 'debug'
}

// Log entry interface
export interface LogEntry {
    timestamp: Date;
    level: LogLevel;
    requestId?: string;
    message: string;
    data?: any;
    error?: Error;
}

/**
 * Structured Logger Implementation
 * Simple, focused implementation for Phase 1
 */
export class StructuredLogger {
    private debugEnabled: boolean = false;
    private requestId?: string;

    constructor(debugEnabled: boolean = false, requestId?: string) {
        this.debugEnabled = debugEnabled;
        this.requestId = requestId;
    }

    /**
     * Main logging method
     */
    log(level: LogLevel, message: string, data?: any): void {
        // Skip debug logs if debug is not enabled
        if (level === LogLevel.DEBUG && !this.debugEnabled) {
            return;
        }

        const entry = this.createLogEntry(level, message, data);
        this.writeLog(entry);
    }

    /**
     * Convenience methods
     */
    error(message: string, error?: Error | any): void {
        this.log(LogLevel.ERROR, message, error);
    }

    warn(message: string, data?: any): void {
        this.log(LogLevel.WARN, message, data);
    }

    info(message: string, data?: any): void {
        this.log(LogLevel.INFO, message, data);
    }

    debug(message: string, data?: any): void {
        this.log(LogLevel.DEBUG, message, data);
    }

    /**
     * Create a timer for performance tracking
     */
    startTimer(operation: string): () => void {
        const startTime = Date.now();
        return () => {
            const duration = Date.now() - startTime;
            this.debug(`${operation} completed`, { duration });
        };
    }

    /**
     * Create log entry
     */
    private createLogEntry(level: LogLevel, message: string, data?: any): LogEntry {
        return {
            timestamp: new Date(),
            level,
            requestId: this.requestId,
            message,
            data: data instanceof Error ? undefined : data,
            error: data instanceof Error ? data : undefined
        };
    }

    /**
     * Write log entry to underlying log system
     */
    private writeLog(entry: LogEntry): void {
        const formattedMessage = this.formatMessage(entry);

        switch (entry.level) {
            case LogLevel.ERROR:
                if (entry.error) {
                    log.error(`${formattedMessage}: ${entry.error.message}`);
                } else if (entry.data) {
                    log.error(`${formattedMessage}: ${JSON.stringify(entry.data)}`);
                } else {
                    log.error(formattedMessage);
                }
                break;

            case LogLevel.WARN:
                if (entry.data) {
                    log.info(`[WARN] ${formattedMessage} - ${JSON.stringify(entry.data)}`);
                } else {
                    log.info(`[WARN] ${formattedMessage}`);
                }
                break;

            case LogLevel.INFO:
                if (entry.data) {
                    log.info(`${formattedMessage} - ${JSON.stringify(entry.data)}`);
                } else {
                    log.info(formattedMessage);
                }
                break;

            case LogLevel.DEBUG:
                if (this.debugEnabled) {
                    if (entry.data) {
                        log.info(`[DEBUG] ${formattedMessage} - ${JSON.stringify(entry.data)}`);
                    } else {
                        log.info(`[DEBUG] ${formattedMessage}`);
                    }
                }
                break;
        }
    }

    /**
     * Format message with request ID
     */
    private formatMessage(entry: LogEntry): string {
        if (entry.requestId) {
            return `[${entry.requestId}] ${entry.message}`;
        }
        return entry.message;
    }

    /**
     * Enable/disable debug logging
     */
    setDebugEnabled(enabled: boolean): void {
        this.debugEnabled = enabled;
    }

    /**
     * Check if debug logging is enabled
     */
    isDebugEnabled(): boolean {
        return this.debugEnabled;
    }

    /**
     * Get request ID
     */
    getRequestId(): string | undefined {
        return this.requestId;
    }

    /**
     * Create a child logger with a new request ID
     */
    withRequestId(requestId: string): StructuredLogger {
        return new StructuredLogger(this.debugEnabled, requestId);
    }
}

/**
 * Create a logger instance
 * @param debugEnabled Whether debug logging is enabled
 * @param requestId Optional request ID for tracking
 */
export function createLogger(debugEnabled: boolean = false, requestId?: string): StructuredLogger {
    return new StructuredLogger(debugEnabled, requestId);
}

/**
 * Generate a unique request ID
 */
export function generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substring(7)}`;
}

// Export default logger instance (without request ID)
export default new StructuredLogger(false);
