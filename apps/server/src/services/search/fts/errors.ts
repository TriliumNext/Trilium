/**
 * FTS5 Error Classes
 *
 * Custom error types for FTS5 operations to enable proper error handling
 * and recovery strategies.
 */

/**
 * Base error class for FTS operations
 */
export class FTSError extends Error {
    constructor(
        message: string,
        public readonly code: string,
        public readonly recoverable: boolean = true
    ) {
        super(message);
        this.name = 'FTSError';
    }
}

/**
 * Error thrown when FTS5 is not available
 */
export class FTSNotAvailableError extends FTSError {
    constructor(message: string = "FTS5 is not available") {
        super(message, 'FTS_NOT_AVAILABLE', true);
        this.name = 'FTSNotAvailableError';
    }
}

/**
 * Error thrown when an FTS query is malformed or invalid
 */
export class FTSQueryError extends FTSError {
    constructor(message: string, public readonly query?: string) {
        super(message, 'FTS_QUERY_ERROR', true);
        this.name = 'FTSQueryError';
    }
}
