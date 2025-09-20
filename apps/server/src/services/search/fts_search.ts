/**
 * FTS5 Search Service
 * 
 * Encapsulates all FTS5-specific operations for full-text searching.
 * Provides efficient text search using SQLite's FTS5 extension with:
 * - Porter stemming for better matching
 * - Snippet extraction for context
 * - Highlighting of matched terms
 * - Query syntax conversion from Trilium to FTS5
 */

import sql from "../sql.js";
import log from "../log.js";
import protectedSessionService from "../protected_session.js";
import striptags from "striptags";
import { normalize } from "../utils.js";

/**
 * Custom error classes for FTS operations
 */
export class FTSError extends Error {
    constructor(message: string, public readonly code: string, public readonly recoverable: boolean = true) {
        super(message);
        this.name = 'FTSError';
    }
}

export class FTSNotAvailableError extends FTSError {
    constructor(message: string = "FTS5 is not available") {
        super(message, 'FTS_NOT_AVAILABLE', true);
        this.name = 'FTSNotAvailableError';
    }
}

export class FTSQueryError extends FTSError {
    constructor(message: string, public readonly query?: string) {
        super(message, 'FTS_QUERY_ERROR', true);
        this.name = 'FTSQueryError';
    }
}

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
}

export interface FTSErrorInfo {
    error: FTSError;
    fallbackUsed: boolean;
    message: string;
}

/**
 * Configuration for FTS5 search operations
 */
const FTS_CONFIG = {
    /** Maximum number of results to return by default */
    DEFAULT_LIMIT: 100,
    /** Default snippet length in tokens */
    DEFAULT_SNIPPET_LENGTH: 30,
    /** Default highlight tags */
    DEFAULT_HIGHLIGHT_START: '<mark>',
    DEFAULT_HIGHLIGHT_END: '</mark>',
    /** Maximum query length to prevent DoS */
    MAX_QUERY_LENGTH: 1000,
    /** Snippet column indices */
    SNIPPET_COLUMN_TITLE: 1,
    SNIPPET_COLUMN_CONTENT: 2,
};

class FTSSearchService {
    private isFTS5Available: boolean | null = null;

    /**
     * Checks if FTS5 is available in the current SQLite instance
     */
    checkFTS5Availability(): boolean {
        if (this.isFTS5Available !== null) {
            return this.isFTS5Available;
        }

        try {
            // Check if FTS5 module is available
            const result = sql.getValue<number>(`
                SELECT COUNT(*) 
                FROM sqlite_master 
                WHERE type = 'table' 
                AND name = 'notes_fts'
            `);
            
            this.isFTS5Available = result > 0;
            
            if (!this.isFTS5Available) {
                log.info("FTS5 table not found. Full-text search will use fallback implementation.");
            }
        } catch (error) {
            log.error(`Error checking FTS5 availability: ${error}`);
            this.isFTS5Available = false;
        }

        return this.isFTS5Available;
    }

    /**
     * Converts Trilium search syntax to FTS5 MATCH syntax
     * 
     * @param tokens - Array of search tokens
     * @param operator - Trilium search operator
     * @returns FTS5 MATCH query string
     */
    convertToFTS5Query(tokens: string[], operator: string): string {
        if (!tokens || tokens.length === 0) {
            throw new Error("No search tokens provided");
        }

        // Sanitize tokens to prevent FTS5 syntax injection
        const sanitizedTokens = tokens.map(token => 
            this.sanitizeFTS5Token(token)
        );

        switch (operator) {
            case "=": // Exact match (phrase search)
                return `"${sanitizedTokens.join(" ")}"`;
            
            case "*=*": // Contains all tokens (AND)
                return sanitizedTokens.join(" AND ");
            
            case "*=": // Ends with
                return sanitizedTokens.map(t => `*${t}`).join(" AND ");
            
            case "=*": // Starts with  
                return sanitizedTokens.map(t => `${t}*`).join(" AND ");
            
            case "!=": // Does not contain (NOT)
                return `NOT (${sanitizedTokens.join(" OR ")})`;
            
            case "~=": // Fuzzy match (use OR for more flexible matching)
            case "~*": // Fuzzy contains
                return sanitizedTokens.join(" OR ");
            
            case "%=": // Regex match - fallback to OR search
                log.error(`Regex search operator ${operator} not fully supported in FTS5, using OR search`);
                return sanitizedTokens.join(" OR ");
            
            default:
                // Default to AND search
                return sanitizedTokens.join(" AND ");
        }
    }

    /**
     * Sanitizes a token for safe use in FTS5 queries
     * Validates that the token is not empty after sanitization
     */
    private sanitizeFTS5Token(token: string): string {
        // Remove special FTS5 characters that could break syntax
        const sanitized = token
            .replace(/["\(\)\*]/g, '') // Remove quotes, parens, wildcards
            .replace(/\s+/g, ' ')       // Normalize whitespace
            .trim();
        
        // Validate that token is not empty after sanitization
        if (!sanitized || sanitized.length === 0) {
            log.info(`Token became empty after sanitization: "${token}"`);
            // Return a safe placeholder that won't match anything
            return "__empty_token__";
        }
        
        // Additional validation: ensure token doesn't contain SQL injection attempts
        if (sanitized.includes(';') || sanitized.includes('--')) {
            log.error(`Potential SQL injection attempt detected in token: "${token}"`);
            return "__invalid_token__";
        }
        
        return sanitized;
    }

    /**
     * Performs a synchronous full-text search using FTS5
     * 
     * @param tokens - Search tokens
     * @param operator - Search operator
     * @param noteIds - Optional set of note IDs to search within
     * @param options - Search options
     * @returns Array of search results
     */
    searchSync(
        tokens: string[], 
        operator: string,
        noteIds?: Set<string>,
        options: FTSSearchOptions = {}
    ): FTSSearchResult[] {
        if (!this.checkFTS5Availability()) {
            throw new FTSNotAvailableError();
        }

        const {
            limit = FTS_CONFIG.DEFAULT_LIMIT,
            offset = 0,
            includeSnippets = true,
            snippetLength = FTS_CONFIG.DEFAULT_SNIPPET_LENGTH,
            highlightTag = FTS_CONFIG.DEFAULT_HIGHLIGHT_START,
            searchProtected = false
        } = options;

        try {
            const ftsQuery = this.convertToFTS5Query(tokens, operator);
            
            // Validate query length
            if (ftsQuery.length > FTS_CONFIG.MAX_QUERY_LENGTH) {
                throw new FTSQueryError(
                    `Query too long: ${ftsQuery.length} characters (max: ${FTS_CONFIG.MAX_QUERY_LENGTH})`,
                    ftsQuery
                );
            }

            // Check if we're searching for protected notes
            // Protected notes are NOT in the FTS index, so we need to handle them separately
            if (searchProtected && protectedSessionService.isProtectedSessionAvailable()) {
                log.info("Protected session available - will search protected notes separately");
                // Return empty results from FTS and let the caller handle protected notes
                // The caller should use a fallback search method for protected notes
                return [];
            }

            // Build the SQL query
            let whereConditions = [`notes_fts MATCH ?`];
            const params: any[] = [ftsQuery];

            // Filter by noteIds if provided
            if (noteIds && noteIds.size > 0) {
                // First filter out any protected notes from the noteIds
                const nonProtectedNoteIds = this.filterNonProtectedNoteIds(noteIds);
                if (nonProtectedNoteIds.length === 0) {
                    // All provided notes are protected, return empty results
                    return [];
                }
                whereConditions.push(`noteId IN (${nonProtectedNoteIds.map(() => '?').join(',')})`);
                params.push(...nonProtectedNoteIds);
            }

            // Build snippet extraction if requested
            const snippetSelect = includeSnippets 
                ? `, snippet(notes_fts, ${FTS_CONFIG.SNIPPET_COLUMN_CONTENT}, '${highlightTag}', '${highlightTag.replace('<', '</')}', '...', ${snippetLength}) as snippet`
                : '';

            const query = `
                SELECT 
                    noteId,
                    title,
                    rank as score
                    ${snippetSelect}
                FROM notes_fts
                WHERE ${whereConditions.join(' AND ')}
                ORDER BY rank
                LIMIT ? OFFSET ?
            `;

            params.push(limit, offset);

            const results = sql.getRows<{
                noteId: string;
                title: string;
                score: number;
                snippet?: string;
            }>(query, params);

            return results;

        } catch (error: any) {
            // Provide structured error information
            if (error instanceof FTSError) {
                throw error;
            }
            
            log.error(`FTS5 search error: ${error}`);
            
            // Determine if this is a recoverable error
            const isRecoverable = 
                error.message?.includes('syntax error') ||
                error.message?.includes('malformed MATCH') ||
                error.message?.includes('no such table');
            
            throw new FTSQueryError(
                `FTS5 search failed: ${error.message}. ${isRecoverable ? 'Falling back to standard search.' : ''}`,
                undefined
            );
        }
    }

    /**
     * Filters out protected note IDs from the given set
     */
    private filterNonProtectedNoteIds(noteIds: Set<string>): string[] {
        const noteIdList = Array.from(noteIds);
        const placeholders = noteIdList.map(() => '?').join(',');
        
        const nonProtectedNotes = sql.getColumn<string>(`
            SELECT noteId 
            FROM notes 
            WHERE noteId IN (${placeholders})
                AND isProtected = 0
        `, noteIdList);
        
        return nonProtectedNotes;
    }

    /**
     * Searches protected notes separately (not in FTS index)
     * This is a fallback method for protected notes
     */
    searchProtectedNotesSync(
        tokens: string[],
        operator: string,
        noteIds?: Set<string>,
        options: FTSSearchOptions = {}
    ): FTSSearchResult[] {
        if (!protectedSessionService.isProtectedSessionAvailable()) {
            return [];
        }

        const {
            limit = FTS_CONFIG.DEFAULT_LIMIT,
            offset = 0
        } = options;

        try {
            // Build query for protected notes only
            let whereConditions = [`n.isProtected = 1`, `n.isDeleted = 0`];
            const params: any[] = [];

            if (noteIds && noteIds.size > 0) {
                const noteIdList = Array.from(noteIds);
                whereConditions.push(`n.noteId IN (${noteIdList.map(() => '?').join(',')})`);  
                params.push(...noteIdList);
            }

            // Get protected notes
            const protectedNotes = sql.getRows<{
                noteId: string;
                title: string;
                content: string | null;
            }>(`
                SELECT n.noteId, n.title, b.content
                FROM notes n
                LEFT JOIN blobs b ON n.blobId = b.blobId
                WHERE ${whereConditions.join(' AND ')}
                    AND n.type IN ('text', 'code', 'mermaid', 'canvas', 'mindMap')
                LIMIT ? OFFSET ?
            `, [...params, limit, offset]);

            const results: FTSSearchResult[] = [];

            for (const note of protectedNotes) {
                if (!note.content) continue;

                try {
                    // Decrypt content
                    const decryptedContent = protectedSessionService.decryptString(note.content);
                    if (!decryptedContent) continue;

                    // Simple token matching for protected notes
                    const contentLower = decryptedContent.toLowerCase();
                    const titleLower = note.title.toLowerCase();
                    let matches = false;

                    switch (operator) {
                        case "=": // Exact match
                            const phrase = tokens.join(' ').toLowerCase();
                            matches = contentLower.includes(phrase) || titleLower.includes(phrase);
                            break;
                        case "*=*": // Contains all tokens
                            matches = tokens.every(token => 
                                contentLower.includes(token.toLowerCase()) || 
                                titleLower.includes(token.toLowerCase())
                            );
                            break;
                        case "~=": // Contains any token
                        case "~*":
                            matches = tokens.some(token => 
                                contentLower.includes(token.toLowerCase()) || 
                                titleLower.includes(token.toLowerCase())
                            );
                            break;
                        default:
                            matches = tokens.every(token => 
                                contentLower.includes(token.toLowerCase()) || 
                                titleLower.includes(token.toLowerCase())
                            );
                    }

                    if (matches) {
                        results.push({
                            noteId: note.noteId,
                            title: note.title,
                            score: 1.0, // Simple scoring for protected notes
                            snippet: this.generateSnippet(decryptedContent)
                        });
                    }
                } catch (error) {
                    log.info(`Could not decrypt protected note ${note.noteId}`);
                }
            }

            return results;
        } catch (error: any) {
            log.error(`Protected notes search error: ${error}`);
            return [];
        }
    }

    /**
     * Generates a snippet from content
     */
    private generateSnippet(content: string, maxLength: number = 30): string {
        // Strip HTML tags for snippet
        const plainText = striptags(content);
        const normalized = normalize(plainText);
        
        if (normalized.length <= maxLength * 10) {
            return normalized;
        }

        // Extract snippet around first occurrence
        return normalized.substring(0, maxLength * 10) + '...';
    }

    /**
     * Updates the FTS index for a specific note (synchronous)
     * 
     * @param noteId - The note ID to update
     * @param title - The note title
     * @param content - The note content
     */
    updateNoteIndex(noteId: string, title: string, content: string): void {
        if (!this.checkFTS5Availability()) {
            return;
        }

        try {
            sql.transactional(() => {
                // Delete existing entry
                sql.execute(`DELETE FROM notes_fts WHERE noteId = ?`, [noteId]);
                
                // Insert new entry
                sql.execute(`
                    INSERT INTO notes_fts (noteId, title, content)
                    VALUES (?, ?, ?)
                `, [noteId, title, content]);
            });
        } catch (error) {
            log.error(`Failed to update FTS index for note ${noteId}: ${error}`);
        }
    }

    /**
     * Removes a note from the FTS index (synchronous)
     * 
     * @param noteId - The note ID to remove
     */
    removeNoteFromIndex(noteId: string): void {
        if (!this.checkFTS5Availability()) {
            return;
        }

        try {
            sql.execute(`DELETE FROM notes_fts WHERE noteId = ?`, [noteId]);
        } catch (error) {
            log.error(`Failed to remove note ${noteId} from FTS index: ${error}`);
        }
    }

    /**
     * Syncs missing notes to the FTS index (synchronous)
     * This is useful after bulk operations like imports where triggers might not fire
     * 
     * @param noteIds - Optional array of specific note IDs to sync. If not provided, syncs all missing notes.
     * @returns The number of notes that were synced
     */
    syncMissingNotes(noteIds?: string[]): number {
        if (!this.checkFTS5Availability()) {
            log.error("Cannot sync FTS index - FTS5 not available");
            return 0;
        }

        try {
            let syncedCount = 0;
            
            sql.transactional(() => {
                let query: string;
                let params: any[] = [];
                
                if (noteIds && noteIds.length > 0) {
                    // Sync specific notes that are missing from FTS
                    const placeholders = noteIds.map(() => '?').join(',');
                    query = `
                        WITH missing_notes AS (
                            SELECT 
                                n.noteId,
                                n.title,
                                b.content
                            FROM notes n
                            LEFT JOIN blobs b ON n.blobId = b.blobId
                            WHERE n.noteId IN (${placeholders})
                                AND n.type IN ('text', 'code', 'mermaid', 'canvas', 'mindMap')
                                AND n.isDeleted = 0
                                AND n.isProtected = 0
                                AND b.content IS NOT NULL
                                AND NOT EXISTS (SELECT 1 FROM notes_fts WHERE noteId = n.noteId)
                        )
                        INSERT INTO notes_fts (noteId, title, content)
                        SELECT noteId, title, content FROM missing_notes
                    `;
                    params = noteIds;
                } else {
                    // Sync all missing notes
                    query = `
                        WITH missing_notes AS (
                            SELECT 
                                n.noteId,
                                n.title,
                                b.content
                            FROM notes n
                            LEFT JOIN blobs b ON n.blobId = b.blobId
                            WHERE n.type IN ('text', 'code', 'mermaid', 'canvas', 'mindMap')
                                AND n.isDeleted = 0
                                AND n.isProtected = 0
                                AND b.content IS NOT NULL
                                AND NOT EXISTS (SELECT 1 FROM notes_fts WHERE noteId = n.noteId)
                        )
                        INSERT INTO notes_fts (noteId, title, content)
                        SELECT noteId, title, content FROM missing_notes
                    `;
                }
                
                const result = sql.execute(query, params);
                syncedCount = result.changes;
                
                if (syncedCount > 0) {
                    log.info(`Synced ${syncedCount} missing notes to FTS index`);
                    // Optimize if we synced a significant number of notes
                    if (syncedCount > 100) {
                        sql.execute(`INSERT INTO notes_fts(notes_fts) VALUES('optimize')`);
                    }
                }
            });
            
            return syncedCount;
        } catch (error) {
            log.error(`Failed to sync missing notes to FTS index: ${error}`);
            return 0;
        }
    }

    /**
     * Rebuilds the entire FTS index (synchronous)
     * This is useful for maintenance or after bulk operations
     */
    rebuildIndex(): void {
        if (!this.checkFTS5Availability()) {
            log.error("Cannot rebuild FTS index - FTS5 not available");
            return;
        }

        log.info("Rebuilding FTS5 index...");

        try {
            sql.transactional(() => {
                // Clear existing index
                sql.execute(`DELETE FROM notes_fts`);

                // Rebuild from notes
                sql.execute(`
                    INSERT INTO notes_fts (noteId, title, content)
                    SELECT 
                        n.noteId,
                        n.title,
                        b.content
                    FROM notes n
                    LEFT JOIN blobs b ON n.blobId = b.blobId
                    WHERE n.type IN ('text', 'code', 'mermaid', 'canvas', 'mindMap')
                        AND n.isDeleted = 0
                        AND n.isProtected = 0
                `);

                // Optimize the FTS table
                sql.execute(`INSERT INTO notes_fts(notes_fts) VALUES('optimize')`);
            });

            log.info("FTS5 index rebuild completed");
        } catch (error) {
            log.error(`Failed to rebuild FTS index: ${error}`);
            throw error;
        }
    }

    /**
     * Gets statistics about the FTS index (synchronous)
     * Includes fallback when dbstat is not available
     */
    getIndexStats(): {
        totalDocuments: number;
        indexSize: number;
        isOptimized: boolean;
        dbstatAvailable: boolean;
    } {
        if (!this.checkFTS5Availability()) {
            return {
                totalDocuments: 0,
                indexSize: 0,
                isOptimized: false,
                dbstatAvailable: false
            };
        }

        const totalDocuments = sql.getValue<number>(`
            SELECT COUNT(*) FROM notes_fts
        `) || 0;

        let indexSize = 0;
        let dbstatAvailable = false;

        try {
            // Try to get index size from dbstat
            // dbstat is a virtual table that may not be available in all SQLite builds
            indexSize = sql.getValue<number>(`
                SELECT SUM(pgsize) 
                FROM dbstat 
                WHERE name LIKE 'notes_fts%'
            `) || 0;
            dbstatAvailable = true;
        } catch (error: any) {
            // dbstat not available, use fallback
            if (error.message?.includes('no such table: dbstat')) {
                log.info("dbstat virtual table not available, using fallback for index size estimation");
                
                // Fallback: Estimate based on number of documents and average content size
                try {
                    const avgContentSize = sql.getValue<number>(`
                        SELECT AVG(LENGTH(content) + LENGTH(title))
                        FROM notes_fts
                        LIMIT 1000
                    `) || 0;
                    
                    // Rough estimate: avg size * document count * overhead factor
                    indexSize = Math.round(avgContentSize * totalDocuments * 1.5);
                } catch (fallbackError) {
                    log.info(`Could not estimate index size: ${fallbackError}`);
                    indexSize = 0;
                }
            } else {
                log.error(`Error accessing dbstat: ${error}`);
            }
        }

        return {
            totalDocuments,
            indexSize,
            isOptimized: true, // FTS5 manages optimization internally
            dbstatAvailable
        };
    }
}

// Export singleton instance
export const ftsSearchService = new FTSSearchService();

export default ftsSearchService;