/**
 * FTS5 Search Service
 *
 * Core search operations using SQLite's FTS5 extension with:
 * - Trigram tokenization for fast substring matching
 * - Snippet extraction for context
 * - Highlighting of matched terms
 * - LIKE-based substring searches
 * - Protected notes search
 * - Attribute search
 */

import sql from "../../sql.js";
import log from "../../log.js";
import protectedSessionService from "../../protected_session.js";
import { FTSError, FTSQueryError } from "./errors.js";
import { FTS_CONFIG, type FTSSearchResult, type FTSSearchOptions } from "./types.js";
import {
    convertToFTS5Query,
    sanitizeFTS5Token,
    escapeLikeWildcards,
    containsExactPhrase,
    generateSnippet
} from "./query_builder.js";
import { filterNonProtectedNoteIds } from "./index_manager.js";

/**
 * Performs substring search using LIKE queries optimized by trigram index
 * This is used for *=*, *=, and =* operators with detail='none'
 *
 * @param tokens - Search tokens
 * @param operator - Search operator (*=*, *=, =*)
 * @param noteIds - Optional set of note IDs to filter
 * @param options - Search options
 * @returns Array of search results (noteIds only, no scoring)
 */
export function searchWithLike(
    tokens: string[],
    operator: string,
    noteIds?: Set<string>,
    options: FTSSearchOptions = {}
): FTSSearchResult[] {
    // Handle empty tokens efficiently - return all notes without running diagnostics
    if (tokens.length === 0) {
        // Empty query means return all indexed notes (optionally filtered by noteIds)
        log.info('[FTS-OPTIMIZATION] Empty token array - returning all indexed notes without diagnostics');

        const results: FTSSearchResult[] = [];
        let query: string;
        const params: any[] = [];

        if (noteIds && noteIds.size > 0) {
            const nonProtectedNoteIds = filterNonProtectedNoteIds(noteIds);
            if (nonProtectedNoteIds.length === 0) {
                return []; // No non-protected notes to search
            }
            query = `SELECT noteId, title FROM notes_fts WHERE noteId IN (${nonProtectedNoteIds.map(() => '?').join(',')})`;
            params.push(...nonProtectedNoteIds);
        } else {
            // Return all indexed notes
            query = `SELECT noteId, title FROM notes_fts`;
        }

        for (const row of sql.iterateRows<{ noteId: string; title: string }>(query, params)) {
            results.push({
                noteId: row.noteId,
                title: row.title,
                score: 0, // No ranking for empty query
                snippet: undefined
            });
        }

        log.info(`[FTS-OPTIMIZATION] Empty token search returned ${results.length} results`);
        return results;
    }

    // Normalize tokens to lowercase for case-insensitive search
    const normalizedTokens = tokens.map(t => t.toLowerCase());

    // Validate token lengths to prevent memory issues
    const longTokens = normalizedTokens.filter(t => t.length > FTS_CONFIG.MAX_TOKEN_LENGTH);
    if (longTokens.length > 0) {
        throw new FTSQueryError(
            `Search tokens too long (max ${FTS_CONFIG.MAX_TOKEN_LENGTH} characters). ` +
            `Long tokens: ${longTokens.map(t => t.substring(0, 50) + '...').join(', ')}`
        );
    }

    const {
        limit, // No default limit - return all results
        offset = 0,
        skipDiagnostics = false
    } = options;

    // Run diagnostics BEFORE the actual search (not counted in performance timing)
    if (!skipDiagnostics) {
        log.info('[FTS-DIAGNOSTICS] Running index completeness checks (not counted in search timing)...');
        const totalInFts = sql.getValue<number>(`SELECT COUNT(*) FROM notes_fts`);
        const totalNotes = sql.getValue<number>(`
            SELECT COUNT(*)
            FROM notes n
            LEFT JOIN blobs b ON n.blobId = b.blobId
            WHERE n.type IN ('text', 'code', 'mermaid', 'canvas', 'mindMap')
                AND n.isDeleted = 0
                AND n.isProtected = 0
                AND b.content IS NOT NULL
        `);

        if (totalInFts < totalNotes) {
            log.info(`[FTS-DIAGNOSTICS] FTS index incomplete: ${totalInFts} indexed out of ${totalNotes} total notes. Run syncMissingNotes().`);
        } else {
            log.info(`[FTS-DIAGNOSTICS] FTS index complete: ${totalInFts} notes indexed`);
        }
    }

    try {
        // Start timing for actual search (excludes diagnostics)
        const searchStartTime = Date.now();

        // Optimization: If noteIds set is very large, skip filtering to avoid expensive IN clauses
        // The FTS table already excludes protected notes, so we can search all notes
        const isLargeNoteSet = noteIds && noteIds.size > FTS_CONFIG.LARGE_SET_THRESHOLD;

        if (isLargeNoteSet) {
            log.info(`[FTS-OPTIMIZATION] Large noteIds set (${noteIds!.size} notes) - skipping IN clause filter, searching all FTS notes`);
        }

        // Only filter noteIds if the set is small enough to benefit from it
        const shouldFilterByNoteIds = noteIds && noteIds.size > 0 && !isLargeNoteSet;
        const nonProtectedNoteIds = shouldFilterByNoteIds
            ? filterNonProtectedNoteIds(noteIds)
            : [];

        let whereConditions: string[] = [];
        const params: any[] = [];

        // Build LIKE conditions for each token - search BOTH title and content
        switch (operator) {
            case "*=*": // Contains (substring)
                normalizedTokens.forEach(token => {
                    // Search in BOTH title and content with escaped wildcards
                    whereConditions.push(`(title LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\')`);
                    const escapedToken = escapeLikeWildcards(token);
                    params.push(`%${escapedToken}%`, `%${escapedToken}%`);
                });
                break;

            case "*=": // Ends with
                normalizedTokens.forEach(token => {
                    whereConditions.push(`(title LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\')`);
                    const escapedToken = escapeLikeWildcards(token);
                    params.push(`%${escapedToken}`, `%${escapedToken}`);
                });
                break;

            case "=*": // Starts with
                normalizedTokens.forEach(token => {
                    whereConditions.push(`(title LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\')`);
                    const escapedToken = escapeLikeWildcards(token);
                    params.push(`${escapedToken}%`, `${escapedToken}%`);
                });
                break;

            default:
                throw new FTSQueryError(`Unsupported LIKE operator: ${operator}`);
        }

        // Validate that we have search criteria
        if (whereConditions.length === 0 && nonProtectedNoteIds.length === 0) {
            throw new FTSQueryError("No search criteria provided (empty tokens and no note filter)");
        }

        // Add noteId filter if provided
        if (nonProtectedNoteIds.length > 0) {
            const tokenParamCount = params.length;
            const additionalParams = 2; // For limit and offset

            if (nonProtectedNoteIds.length <= FTS_CONFIG.MAX_PARAMS_PER_QUERY - tokenParamCount - additionalParams) {
                // Normal case: all IDs fit in one query
                whereConditions.push(`noteId IN (${nonProtectedNoteIds.map(() => '?').join(',')})`);
                params.push(...nonProtectedNoteIds);
            } else {
                // Large noteIds set: split into chunks and execute multiple queries
                const chunks: string[][] = [];
                for (let i = 0; i < nonProtectedNoteIds.length; i += FTS_CONFIG.MAX_PARAMS_PER_QUERY) {
                    chunks.push(nonProtectedNoteIds.slice(i, i + FTS_CONFIG.MAX_PARAMS_PER_QUERY));
                }

                log.info(`Large noteIds set detected (${nonProtectedNoteIds.length} notes), splitting into ${chunks.length} chunks`);

                // Execute a query for each chunk and combine results
                const allResults: FTSSearchResult[] = [];
                let remainingLimit = limit !== undefined ? limit : Number.MAX_SAFE_INTEGER;
                let currentOffset = offset;

                for (const chunk of chunks) {
                    if (remainingLimit <= 0) break;

                    const chunkWhereConditions = [...whereConditions];
                    const chunkParams: any[] = [...params];

                    chunkWhereConditions.push(`noteId IN (${chunk.map(() => '?').join(',')})`);
                    chunkParams.push(...chunk);

                    // Build chunk query
                    const chunkQuery = `
                        SELECT noteId, title
                        FROM notes_fts
                        WHERE ${chunkWhereConditions.join(' AND ')}
                        ${remainingLimit !== Number.MAX_SAFE_INTEGER ? 'LIMIT ?' : ''}
                        ${currentOffset > 0 ? 'OFFSET ?' : ''}
                    `;

                    if (remainingLimit !== Number.MAX_SAFE_INTEGER) chunkParams.push(remainingLimit);
                    if (currentOffset > 0) chunkParams.push(currentOffset);

                    const chunkResults = sql.getRows<{ noteId: string; title: string }>(chunkQuery, chunkParams);
                    allResults.push(...chunkResults.map(row => ({
                        noteId: row.noteId,
                        title: row.title,
                        score: 1.0
                    })));

                    if (remainingLimit !== Number.MAX_SAFE_INTEGER) {
                        remainingLimit -= chunkResults.length;
                    }
                    currentOffset = 0; // Only apply offset to first chunk
                }

                const searchTime = Date.now() - searchStartTime;
                log.info(`FTS5 LIKE search (chunked) returned ${allResults.length} results in ${searchTime}ms`);

                return allResults;
            }
        }

        // Build query - LIKE queries are automatically optimized by trigram index
        // Only add LIMIT/OFFSET if specified
        const query = `
            SELECT noteId, title
            FROM notes_fts
            WHERE ${whereConditions.join(' AND ')}
            ${limit !== undefined ? 'LIMIT ?' : ''}
            ${offset > 0 ? 'OFFSET ?' : ''}
        `;

        // Only add limit/offset params if specified
        if (limit !== undefined) params.push(limit);
        if (offset > 0) params.push(offset);

        // Log the search parameters
        log.info(`FTS5 LIKE search: tokens=[${normalizedTokens.join(', ')}], operator=${operator}, limit=${limit || 'none'}, offset=${offset}`);

        const rows = sql.getRows<{ noteId: string; title: string }>(query, params);

        const searchTime = Date.now() - searchStartTime;
        log.info(`FTS5 LIKE search returned ${rows.length} results in ${searchTime}ms`);

        return rows.map(row => ({
            noteId: row.noteId,
            title: row.title,
            score: 1.0 // LIKE queries don't have ranking
        }));

    } catch (error: any) {
        log.error(`FTS5 LIKE search error: ${error}`);
        throw new FTSQueryError(
            `FTS5 LIKE search failed: ${error.message}`,
            undefined
        );
    }
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
export function searchSync(
    tokens: string[],
    operator: string,
    noteIds?: Set<string>,
    options: FTSSearchOptions = {}
): FTSSearchResult[] {
    // Handle empty tokens efficiently - return all notes without MATCH query
    if (tokens.length === 0) {
        log.info('[FTS-OPTIMIZATION] Empty token array in searchSync - returning all indexed notes');

        // Reuse the empty token logic from searchWithLike
        const results: FTSSearchResult[] = [];
        let query: string;
        const params: any[] = [];

        if (noteIds && noteIds.size > 0) {
            const nonProtectedNoteIds = filterNonProtectedNoteIds(noteIds);
            if (nonProtectedNoteIds.length === 0) {
                return []; // No non-protected notes to search
            }
            query = `SELECT noteId, title FROM notes_fts WHERE noteId IN (${nonProtectedNoteIds.map(() => '?').join(',')})`;
            params.push(...nonProtectedNoteIds);
        } else {
            // Return all indexed notes
            query = `SELECT noteId, title FROM notes_fts`;
        }

        for (const row of sql.iterateRows<{ noteId: string; title: string }>(query, params)) {
            results.push({
                noteId: row.noteId,
                title: row.title,
                score: 0, // No ranking for empty query
                snippet: undefined
            });
        }

        log.info(`[FTS-OPTIMIZATION] Empty token search returned ${results.length} results`);
        return results;
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
        // Start timing for actual search
        const searchStartTime = Date.now();

        const ftsQuery = convertToFTS5Query(tokens, operator);

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

        // Optimization: If noteIds set is very large, skip filtering to avoid expensive IN clauses
        // The FTS table already excludes protected notes, so we can search all notes
        const isLargeNoteSet = noteIds && noteIds.size > FTS_CONFIG.LARGE_SET_THRESHOLD;

        if (isLargeNoteSet) {
            log.info(`[FTS-OPTIMIZATION] Large noteIds set (${noteIds!.size} notes) - skipping IN clause filter, searching all FTS notes`);
        }

        // Filter by noteIds if provided and set is small enough
        const shouldFilterByNoteIds = noteIds && noteIds.size > 0 && !isLargeNoteSet;
        if (shouldFilterByNoteIds) {
            // First filter out any protected notes from the noteIds
            const nonProtectedNoteIds = filterNonProtectedNoteIds(noteIds!);
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

        // For exact match (=), include content for post-filtering word boundaries
        const contentSelect = operator === "=" ? ', content' : '';

        const query = `
            SELECT
                noteId,
                title,
                rank as score
                ${snippetSelect}
                ${contentSelect}
            FROM notes_fts
            WHERE ${whereConditions.join(' AND ')}
            ORDER BY rank
            LIMIT ? OFFSET ?
        `;

        params.push(limit, offset);

        let results = sql.getRows<{
            noteId: string;
            title: string;
            score: number;
            snippet?: string;
            content?: string;
        }>(query, params);

        // Post-filter for exact match operator (=) to handle word boundaries
        // Trigram FTS5 doesn't respect word boundaries in phrase queries,
        // so "test123" matches "test1234" due to shared trigrams.
        // We need to post-filter results to only include exact word matches.
        if (operator === "=") {
            const phrase = tokens.join(" ");
            results = results.filter(result => {
                // Use content from result if available, otherwise fetch it
                let noteContent = result.content;
                if (!noteContent) {
                    noteContent = sql.getValue<string>(`
                        SELECT b.content
                        FROM notes n
                        LEFT JOIN blobs b ON n.blobId = b.blobId
                        WHERE n.noteId = ?
                    `, [result.noteId]);
                }

                if (!noteContent) {
                    return false;
                }

                // Check if phrase appears as exact words in content or title
                return containsExactPhrase(phrase, result.title) ||
                       containsExactPhrase(phrase, noteContent);
            });
        }

        const searchTime = Date.now() - searchStartTime;
        log.info(`FTS5 MATCH search returned ${results.length} results in ${searchTime}ms`);

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
 * Searches attributes using FTS5
 * Returns noteIds of notes that have matching attributes
 */
export function searchAttributesSync(
    tokens: string[],
    operator: string,
    noteIds?: Set<string>
): Set<string> {
    // Check if attributes_fts table exists
    const tableExists = sql.getValue<number>(`
        SELECT COUNT(*)
        FROM sqlite_master
        WHERE type='table' AND name='attributes_fts'
    `);

    if (!tableExists) {
        log.info("attributes_fts table does not exist - skipping FTS attribute search");
        return new Set();
    }

    try {
        // Sanitize tokens to prevent FTS5 syntax injection
        const sanitizedTokens = tokens.map(token => sanitizeFTS5Token(token));

        // Check if any tokens became invalid after sanitization
        if (sanitizedTokens.some(t => t === '__empty_token__' || t === '__invalid_token__')) {
            return new Set();
        }

        const phrase = sanitizedTokens.join(" ");

        // Build FTS5 query for exact match
        const ftsQuery = operator === "=" ? `"${phrase}"` : phrase;

        // Search both name and value columns using parameterized query
        const whereConditions: string[] = [
            `attributes_fts MATCH ?`
        ];

        const params: any[] = [ftsQuery];

        // Filter by noteIds if provided
        if (noteIds && noteIds.size > 0 && noteIds.size < 1000) {
            const noteIdList = Array.from(noteIds);
            whereConditions.push(`noteId IN (${noteIdList.map(() => '?').join(',')})`);
            params.push(...noteIdList);
        }

        const query = `
            SELECT DISTINCT noteId, name, value
            FROM attributes_fts
            WHERE ${whereConditions.join(' AND ')}
        `;

        const results = sql.getRows<{
            noteId: string;
            name: string;
            value: string;
        }>(query, params);

        // Post-filter for exact word matches when operator is "="
        if (operator === "=") {
            const matchingNoteIds = new Set<string>();
            for (const result of results) {
                // Check if phrase matches attribute name or value with word boundaries
                // For attribute names, check exact match (attribute name "test125" matches search "test125")
                // For attribute values, check if phrase appears as exact words
                const nameMatch = result.name.toLowerCase() === phrase.toLowerCase();
                const valueMatch = result.value ? containsExactPhrase(phrase, result.value) : false;

                if (nameMatch || valueMatch) {
                    matchingNoteIds.add(result.noteId);
                }
            }
            return matchingNoteIds;
        }

        // For other operators, return all matching noteIds
        const matchingNoteIds = new Set(results.map(r => r.noteId));
        return matchingNoteIds;

    } catch (error: any) {
        log.error(`FTS5 attribute search error: ${error}`);
        return new Set();
    }
}

/**
 * Searches protected notes separately (not in FTS index)
 * This is a fallback method for protected notes
 */
export function searchProtectedNotesSync(
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
                        snippet: generateSnippet(decryptedContent)
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
