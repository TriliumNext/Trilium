/**
 * Tool System Constants
 * 
 * Centralized configuration constants for the tool system to improve
 * maintainability and avoid magic numbers/strings throughout the codebase.
 */

/**
 * Timing constants (in milliseconds)
 */
export const TIMING = {
    // Default timeouts
    DEFAULT_TOOL_TIMEOUT: 60000, // 60 seconds
    CLEANUP_MAX_AGE: 3600000, // 1 hour
    
    // Retry delays
    RETRY_INITIAL_DELAY: 1000,
    RETRY_MAX_DELAY: 10000,
    RETRY_JITTER: 500,
    
    // Circuit breaker
    CIRCUIT_BREAKER_TIMEOUT: 60000, // 1 minute
    
    // UI updates
    HISTORY_MOVE_DELAY: 5000, // 5 seconds
    STEP_COLLAPSE_DELAY: 1000, // 1 second
    FADE_OUT_DURATION: 300,
    
    // Performance
    DURATION_UPDATE_INTERVAL: 100, // replaced by requestAnimationFrame
} as const;

/**
 * Limits and thresholds
 */
export const LIMITS = {
    // History
    MAX_HISTORY_SIZE: 1000,
    MAX_HISTORY_UI_SIZE: 50,
    MAX_ERROR_HISTORY_SIZE: 100,
    
    // Circuit breaker
    CIRCUIT_FAILURE_THRESHOLD: 5,
    CIRCUIT_SUCCESS_THRESHOLD: 2,
    CIRCUIT_HALF_OPEN_REQUESTS: 3,
    
    // Retry
    MAX_RETRY_ATTEMPTS: 3,
    RETRY_BACKOFF_MULTIPLIER: 2,
    
    // UI
    MAX_VISIBLE_STEPS: 3,
    MAX_STRING_DISPLAY_LENGTH: 100,
    MAX_STEP_CONTAINER_HEIGHT: 150, // pixels
    LARGE_CONTENT_THRESHOLD: 10000, // characters
    
    // Listeners
    MAX_EVENT_LISTENERS: 100,
} as const;

/**
 * Tool names and operations
 */
export const TOOL_NAMES = {
    // Core tools
    SEARCH_NOTES: 'search_notes',
    GET_NOTE_CONTENT: 'get_note_content',
    CREATE_NOTE: 'create_note',
    UPDATE_NOTE: 'update_note',
    DELETE_NOTE: 'delete_note',
    EXECUTE_CODE: 'execute_code',
    WEB_SEARCH: 'web_search',
    GET_NOTE_ATTRIBUTES: 'get_note_attributes',
    SET_NOTE_ATTRIBUTE: 'set_note_attribute',
    NAVIGATE_NOTES: 'navigate_notes',
    QUERY_DECOMPOSITION: 'query_decomposition',
    CONTEXTUAL_THINKING: 'contextual_thinking',
} as const;

/**
 * Sensitive operations requiring confirmation
 */
export const SENSITIVE_OPERATIONS = [
    TOOL_NAMES.CREATE_NOTE,
    TOOL_NAMES.UPDATE_NOTE,
    TOOL_NAMES.DELETE_NOTE,
    TOOL_NAMES.EXECUTE_CODE,
    TOOL_NAMES.SET_NOTE_ATTRIBUTE,
    'modify_note_hierarchy',
] as const;

/**
 * Tool display names
 */
export const TOOL_DISPLAY_NAMES: Record<string, string> = {
    [TOOL_NAMES.SEARCH_NOTES]: 'Search Notes',
    [TOOL_NAMES.GET_NOTE_CONTENT]: 'Read Note',
    [TOOL_NAMES.CREATE_NOTE]: 'Create Note',
    [TOOL_NAMES.UPDATE_NOTE]: 'Update Note',
    [TOOL_NAMES.DELETE_NOTE]: 'Delete Note',
    [TOOL_NAMES.EXECUTE_CODE]: 'Execute Code',
    [TOOL_NAMES.WEB_SEARCH]: 'Search Web',
    [TOOL_NAMES.GET_NOTE_ATTRIBUTES]: 'Get Note Properties',
    [TOOL_NAMES.SET_NOTE_ATTRIBUTE]: 'Set Note Property',
    [TOOL_NAMES.NAVIGATE_NOTES]: 'Navigate Notes',
    [TOOL_NAMES.QUERY_DECOMPOSITION]: 'Analyze Query',
    [TOOL_NAMES.CONTEXTUAL_THINKING]: 'Process Context',
} as const;

/**
 * Tool descriptions
 */
export const TOOL_DESCRIPTIONS: Record<string, string> = {
    [TOOL_NAMES.SEARCH_NOTES]: 'Search through your notes database',
    [TOOL_NAMES.GET_NOTE_CONTENT]: 'Retrieve the content of a specific note',
    [TOOL_NAMES.CREATE_NOTE]: 'Create a new note with specified content',
    [TOOL_NAMES.UPDATE_NOTE]: 'Modify an existing note',
    [TOOL_NAMES.DELETE_NOTE]: 'Permanently delete a note',
    [TOOL_NAMES.EXECUTE_CODE]: 'Run code in a sandboxed environment',
    [TOOL_NAMES.WEB_SEARCH]: 'Search the web for information',
    [TOOL_NAMES.GET_NOTE_ATTRIBUTES]: 'Retrieve note metadata and properties',
    [TOOL_NAMES.SET_NOTE_ATTRIBUTE]: 'Modify note metadata',
    [TOOL_NAMES.NAVIGATE_NOTES]: 'Browse through the note hierarchy',
    [TOOL_NAMES.QUERY_DECOMPOSITION]: 'Break down complex queries into parts',
    [TOOL_NAMES.CONTEXTUAL_THINKING]: 'Analyze context for better understanding',
} as const;

/**
 * Estimated durations for tools (in milliseconds)
 */
export const TOOL_ESTIMATED_DURATIONS: Record<string, number> = {
    [TOOL_NAMES.SEARCH_NOTES]: 500,
    [TOOL_NAMES.GET_NOTE_CONTENT]: 200,
    [TOOL_NAMES.CREATE_NOTE]: 300,
    [TOOL_NAMES.UPDATE_NOTE]: 300,
    [TOOL_NAMES.EXECUTE_CODE]: 2000,
    [TOOL_NAMES.WEB_SEARCH]: 3000,
    [TOOL_NAMES.GET_NOTE_ATTRIBUTES]: 150,
    [TOOL_NAMES.SET_NOTE_ATTRIBUTE]: 250,
    [TOOL_NAMES.NAVIGATE_NOTES]: 400,
    [TOOL_NAMES.QUERY_DECOMPOSITION]: 1000,
    [TOOL_NAMES.CONTEXTUAL_THINKING]: 1500,
} as const;

/**
 * Tool risk levels
 */
export const TOOL_RISK_LEVELS: Record<string, 'low' | 'medium' | 'high'> = {
    [TOOL_NAMES.SEARCH_NOTES]: 'low',
    [TOOL_NAMES.GET_NOTE_CONTENT]: 'low',
    [TOOL_NAMES.CREATE_NOTE]: 'medium',
    [TOOL_NAMES.UPDATE_NOTE]: 'high',
    [TOOL_NAMES.DELETE_NOTE]: 'high',
    [TOOL_NAMES.EXECUTE_CODE]: 'high',
    [TOOL_NAMES.WEB_SEARCH]: 'low',
    [TOOL_NAMES.GET_NOTE_ATTRIBUTES]: 'low',
    [TOOL_NAMES.SET_NOTE_ATTRIBUTE]: 'medium',
    [TOOL_NAMES.NAVIGATE_NOTES]: 'low',
    [TOOL_NAMES.QUERY_DECOMPOSITION]: 'low',
    [TOOL_NAMES.CONTEXTUAL_THINKING]: 'low',
} as const;

/**
 * Tool warnings
 */
export const TOOL_WARNINGS: Record<string, string[]> = {
    [TOOL_NAMES.DELETE_NOTE]: ['This action cannot be undone'],
    [TOOL_NAMES.EXECUTE_CODE]: ['Code will be executed in a sandboxed environment'],
    [TOOL_NAMES.WEB_SEARCH]: ['External web search may include third-party content'],
} as const;

/**
 * Error type strings for categorization
 */
export const ERROR_PATTERNS = {
    NETWORK: ['ECONNREFUSED', 'ENOTFOUND', 'ENETUNREACH', 'fetch failed'],
    TIMEOUT: ['ETIMEDOUT', 'timeout', 'Timeout'],
    RATE_LIMIT: ['429', 'rate limit', 'too many requests'],
    PERMISSION: ['401', '403', 'unauthorized', 'forbidden'],
    NOT_FOUND: ['404', 'not found', 'does not exist'],
    VALIDATION: ['validation', 'invalid', 'required'],
    INTERNAL: ['500', 'internal', 'server error'],
} as const;

/**
 * UI Style classes and icons
 */
export const UI_STYLES = {
    // Status icons
    STATUS_ICONS: {
        success: 'bx-check-circle',
        error: 'bx-error-circle',
        warning: 'bx-error',
        cancelled: 'bx-x-circle',
        timeout: 'bx-time-five',
        running: 'bx-loader-alt',
        pending: 'bx-time',
    },
    
    // Step icons
    STEP_ICONS: {
        info: 'bx-info-circle',
        warning: 'bx-error',
        error: 'bx-error-circle',
        progress: 'bx-loader-alt',
    },
    
    // Color mappings
    STATUS_COLORS: {
        success: 'success',
        error: 'danger',
        warning: 'warning',
        cancelled: 'warning',
        timeout: 'danger',
        info: 'muted',
        progress: 'primary',
    },
    
    // Border colors
    BORDER_COLORS: {
        success: 'border-success',
        error: 'border-danger',
        warning: 'border-warning',
        cancelled: 'border-warning',
        timeout: 'border-danger',
    },
} as const;

/**
 * Alternative tool mappings for error recovery
 */
export const TOOL_ALTERNATIVES: Record<string, string[]> = {
    [TOOL_NAMES.WEB_SEARCH]: [TOOL_NAMES.SEARCH_NOTES],
    [TOOL_NAMES.EXECUTE_CODE]: [TOOL_NAMES.GET_NOTE_CONTENT],
    [TOOL_NAMES.UPDATE_NOTE]: [TOOL_NAMES.CREATE_NOTE],
} as const;

/**
 * ID generation prefixes
 */
export const ID_PREFIXES = {
    PREVIEW: 'preview',
    PLAN: 'plan',
    EXECUTION: 'exec',
} as const;

/**
 * Generate a unique ID with the specified prefix
 */
export function generateId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Format duration for display
 */
export function formatDuration(milliseconds: number): string {
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
 * Truncate string for display
 */
export function truncateString(str: string, maxLength: number = LIMITS.MAX_STRING_DISPLAY_LENGTH): string {
    if (str.length <= maxLength) {
        return str;
    }
    return `${str.substring(0, maxLength)}...`;
}