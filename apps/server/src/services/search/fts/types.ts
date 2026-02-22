/**
 * FTS5 Types and Configuration
 *
 * Shared interfaces and configuration constants for FTS5 operations.
 */

import type { FTSError } from "./errors.js";

export interface FTSSearchResult {
    noteId: string;
    title: string;
    score: number;
    snippet?: string;
    highlights?: string[];
}

export interface FTSSearchOptions {
    limit?: number;
    offset?: number;
    includeSnippets?: boolean;
    snippetLength?: number;
    highlightTag?: string;
    searchProtected?: boolean;
    skipDiagnostics?: boolean;
}

export interface FTSErrorInfo {
    error: FTSError;
    fallbackUsed: boolean;
    message: string;
}

export interface FTSIndexStats {
    totalDocuments: number;
    indexSize: number;
    isOptimized: boolean;
    dbstatAvailable: boolean;
}

/**
 * Configuration for FTS5 search operations
 */
export const FTS_CONFIG = {
    /** Maximum number of results to return by default */
    DEFAULT_LIMIT: 100,
    /** Default snippet length in tokens */
    DEFAULT_SNIPPET_LENGTH: 30,
    /** Default highlight tags */
    DEFAULT_HIGHLIGHT_START: '<mark>',
    DEFAULT_HIGHLIGHT_END: '</mark>',
    /** Maximum query length to prevent DoS */
    MAX_QUERY_LENGTH: 1000,
    /** Maximum token length to prevent memory issues */
    MAX_TOKEN_LENGTH: 1000,
    /** Threshold for considering a noteIds set as "large" */
    LARGE_SET_THRESHOLD: 1000,
    /** SQLite parameter limit (with margin) */
    MAX_PARAMS_PER_QUERY: 900,
    /** Snippet column indices */
    SNIPPET_COLUMN_TITLE: 1,
    SNIPPET_COLUMN_CONTENT: 2,
} as const;
