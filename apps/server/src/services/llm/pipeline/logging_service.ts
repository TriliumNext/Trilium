/**
 * Logging Service - Phase 2.3 Implementation
 * 
 * Structured logging with:
 * - Proper log levels
 * - Request ID tracking
 * - Conditional debug logging
 * - No production debug statements
 */

import log from '../../log.js';
import configurationService from './configuration_service.js';

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
    duration?: number;
}

// Structured log data
export interface LogContext {
    requestId?: string;
    userId?: string;
    sessionId?: string;
    provider?: string;
    model?: string;
    operation?: string;
    [key: string]: any;
}

/**
 * Logging Service Implementation
 */
export class LoggingService {
    private enabled: boolean = true;
    private logLevel: LogLevel = LogLevel.INFO;
    private debugEnabled: boolean = false;
    private requestContexts: Map<string, LogContext> = new Map();
    private logBuffer: LogEntry[] = [];
    private readonly MAX_BUFFER_SIZE = 1000;

    constructor() {
        this.initialize();
    }

    /**
     * Initialize logging configuration
     */
    private initialize(): void {
        try {
            const debugConfig = configurationService.getDebugConfig();
            this.enabled = debugConfig.enabled;
            this.debugEnabled = debugConfig.logLevel === 'debug';
            this.logLevel = this.parseLogLevel(debugConfig.logLevel);
        } catch (error) {
            // Fall back to defaults if configuration is not available
            this.enabled = true;
            this.logLevel = LogLevel.INFO;
            this.debugEnabled = false;
        }
    }

    /**
     * Parse log level from string
     */
    private parseLogLevel(level: string): LogLevel {
        switch (level?.toLowerCase()) {
            case 'error': return LogLevel.ERROR;
            case 'warn': return LogLevel.WARN;
            case 'info': return LogLevel.INFO;
            case 'debug': return LogLevel.DEBUG;
            default: return LogLevel.INFO;
        }
    }

    /**
     * Check if a log level should be logged
     */
    private shouldLog(level: LogLevel): boolean {
        if (!this.enabled) return false;
        
        const levels = [LogLevel.ERROR, LogLevel.WARN, LogLevel.INFO, LogLevel.DEBUG];
        const currentIndex = levels.indexOf(this.logLevel);
        const messageIndex = levels.indexOf(level);
        
        return messageIndex <= currentIndex;
    }

    /**
     * Format log message with context
     */
    private formatMessage(message: string, context?: LogContext): string {
        if (!context?.requestId) {
            return message;
        }
        return `[${context.requestId}] ${message}`;
    }

    /**
     * Write log entry
     */
    private writeLog(entry: LogEntry): void {
        // Add to buffer for debugging
        this.bufferLog(entry);
        
        // Skip debug logs in production
        if (entry.level === LogLevel.DEBUG && !this.debugEnabled) {
            return;
        }
        
        // Format message with request ID if present
        const formattedMessage = this.formatMessage(entry.message, { requestId: entry.requestId });
        
        // Log based on level
        switch (entry.level) {
            case LogLevel.ERROR:
                if (entry.error) {
                    log.error(`${formattedMessage}: ${entry.error instanceof Error ? entry.error.message : String(entry.error)}`);
                } else if (entry.data) {
                    log.error(`${formattedMessage}: ${JSON.stringify(entry.data)}`);
                } else {
                    log.error(formattedMessage);
                }
                break;
                
            case LogLevel.WARN:
                if (entry.data && Object.keys(entry.data).length > 0) {
                    log.info(`[WARN] ${formattedMessage} - ${JSON.stringify(entry.data)}`);
                } else {
                    log.info(`[WARN] ${formattedMessage}`);
                }
                break;
                
            case LogLevel.INFO:
                if (entry.data && Object.keys(entry.data).length > 0) {
                    log.info(`${formattedMessage} - ${JSON.stringify(entry.data)}`);
                } else {
                    log.info(formattedMessage);
                }
                break;
                
            case LogLevel.DEBUG:
                // Only log debug messages if debug is enabled
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
     * Buffer log entry for debugging
     */
    private bufferLog(entry: LogEntry): void {
        this.logBuffer.push(entry);
        
        // Trim buffer if it exceeds max size
        if (this.logBuffer.length > this.MAX_BUFFER_SIZE) {
            this.logBuffer = this.logBuffer.slice(-this.MAX_BUFFER_SIZE);
        }
    }

    /**
     * Main logging method
     */
    log(level: LogLevel, message: string, data?: any): void {
        if (!this.shouldLog(level)) return;
        
        const entry: LogEntry = {
            timestamp: new Date(),
            level,
            message,
            data: data instanceof Error ? undefined : data,
            error: data instanceof Error ? data : undefined
        };
        
        this.writeLog(entry);
    }

    /**
     * Log with request context
     */
    logWithContext(level: LogLevel, message: string, context: LogContext, data?: any): void {
        if (!this.shouldLog(level)) return;
        
        const entry: LogEntry = {
            timestamp: new Date(),
            level,
            requestId: context.requestId,
            message,
            data: { ...context, ...data }
        };
        
        this.writeLog(entry);
    }

    /**
     * Create a logger with a fixed request ID
     */
    withRequestId(requestId: string): {
        requestId: string;
        log: (level: LogLevel, message: string, data?: any) => void;
        error: (message: string, error?: Error | any) => void;
        warn: (message: string, data?: any) => void;
        info: (message: string, data?: any) => void;
        debug: (message: string, data?: any) => void;
        startTimer: (operation: string) => () => void;
    } {
        const self = this;
        
        return {
            requestId,
            
            log(level: LogLevel, message: string, data?: any): void {
                self.logWithContext(level, message, { requestId }, data);
            },
            
            error(message: string, error?: Error | any): void {
                self.logWithContext(LogLevel.ERROR, message, { requestId }, error);
            },
            
            warn(message: string, data?: any): void {
                self.logWithContext(LogLevel.WARN, message, { requestId }, data);
            },
            
            info(message: string, data?: any): void {
                self.logWithContext(LogLevel.INFO, message, { requestId }, data);
            },
            
            debug(message: string, data?: any): void {
                self.logWithContext(LogLevel.DEBUG, message, { requestId }, data);
            },
            
            startTimer(operation: string): () => void {
                const startTime = Date.now();
                return () => {
                    const duration = Date.now() - startTime;
                    self.logWithContext(LogLevel.DEBUG, `${operation} completed`, { requestId }, { duration });
                };
            }
        };
    }

    /**
     * Start a timer for performance tracking
     */
    startTimer(operation: string, requestId?: string): () => void {
        const startTime = Date.now();
        
        return () => {
            const duration = Date.now() - startTime;
            const entry: LogEntry = {
                timestamp: new Date(),
                level: LogLevel.DEBUG,
                requestId,
                message: `${operation} completed in ${duration}ms`,
                duration
            };
            
            if (this.shouldLog(LogLevel.DEBUG)) {
                this.writeLog(entry);
            }
        };
    }

    /**
     * Log error with stack trace
     */
    error(message: string, error?: Error | any, requestId?: string): void {
        const entry: LogEntry = {
            timestamp: new Date(),
            level: LogLevel.ERROR,
            requestId,
            message,
            error: error instanceof Error ? error : new Error(String(error))
        };
        
        this.writeLog(entry);
    }

    /**
     * Log warning
     */
    warn(message: string, data?: any, requestId?: string): void {
        const entry: LogEntry = {
            timestamp: new Date(),
            level: LogLevel.WARN,
            requestId,
            message,
            data
        };
        
        this.writeLog(entry);
    }

    /**
     * Log info
     */
    info(message: string, data?: any, requestId?: string): void {
        const entry: LogEntry = {
            timestamp: new Date(),
            level: LogLevel.INFO,
            requestId,
            message,
            data
        };
        
        this.writeLog(entry);
    }

    /**
     * Log debug (only in debug mode)
     */
    debug(message: string, data?: any, requestId?: string): void {
        if (!this.debugEnabled) return;
        
        const entry: LogEntry = {
            timestamp: new Date(),
            level: LogLevel.DEBUG,
            requestId,
            message,
            data
        };
        
        this.writeLog(entry);
    }

    /**
     * Set request context
     */
    setRequestContext(requestId: string, context: LogContext): void {
        this.requestContexts.set(requestId, context);
    }

    /**
     * Get request context
     */
    getRequestContext(requestId: string): LogContext | undefined {
        return this.requestContexts.get(requestId);
    }

    /**
     * Clear request context
     */
    clearRequestContext(requestId: string): void {
        this.requestContexts.delete(requestId);
    }

    /**
     * Get recent logs for debugging
     */
    getRecentLogs(count: number = 100, level?: LogLevel): LogEntry[] {
        let logs = [...this.logBuffer];
        
        if (level) {
            logs = logs.filter(entry => entry.level === level);
        }
        
        return logs.slice(-count);
    }

    /**
     * Clear log buffer
     */
    clearBuffer(): void {
        this.logBuffer = [];
    }

    /**
     * Set log level dynamically
     */
    setLogLevel(level: LogLevel): void {
        this.logLevel = level;
        this.debugEnabled = level === LogLevel.DEBUG;
    }

    /**
     * Get current log level
     */
    getLogLevel(): LogLevel {
        return this.logLevel;
    }

    /**
     * Enable/disable logging
     */
    setEnabled(enabled: boolean): void {
        this.enabled = enabled;
    }

    /**
     * Check if logging is enabled
     */
    isEnabled(): boolean {
        return this.enabled;
    }

    /**
     * Check if debug logging is enabled
     */
    isDebugEnabled(): boolean {
        return this.debugEnabled;
    }

    /**
     * Reload configuration
     */
    reloadConfiguration(): void {
        this.initialize();
    }
}

// Export singleton instance
const loggingService = new LoggingService();
export default loggingService;