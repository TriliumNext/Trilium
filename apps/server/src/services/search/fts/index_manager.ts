/**
 * FTS5 Index Manager
 *
 * Handles FTS5 index CRUD operations including:
 * - Index availability verification
 * - Note indexing and removal
 * - Index synchronization and rebuilding
 * - Index statistics
 */

import sql from "../../sql.js";
import log from "../../log.js";
import type { FTSIndexStats } from "./types.js";

/**
 * Asserts that FTS5 is available. Should be called at application startup.
 * Throws an error if FTS5 tables are not found.
 */
export function assertFTS5Available(): void {
    const result = sql.getValue<number>(`
        SELECT COUNT(*)
        FROM sqlite_master
        WHERE type = 'table'
        AND name = 'notes_fts'
    `);

    if (result === 0) {
        throw new Error("CRITICAL: FTS5 table 'notes_fts' not found. Run database migration.");
    }

    log.info("FTS5 tables verified - full-text search is available");
}

/**
 * Checks if FTS5 is available for search operations.
 * @returns false during unit tests (VITEST) to use traditional becca-based search,
 *          true in production where FTS5 is required and validated at startup.
 *
 * Note: Unit tests use in-memory becca mocks that aren't in the database,
 * so FTS5 (which searches the database) would return incorrect results.
 * FTS5-specific tests (fts5_integration.spec.ts) test database operations directly.
 */
export function checkFTS5Availability(): boolean {
    // During unit tests, disable FTS5 to use traditional becca-based search
    // This ensures tests with in-memory mocks work correctly
    if (process.env.VITEST) {
        return false;
    }
    return true;
}

/**
 * Updates the FTS index for a specific note (synchronous)
 *
 * @param noteId - The note ID to update
 * @param title - The note title
 * @param content - The note content
 */
export function updateNoteIndex(noteId: string, title: string, content: string): void {
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
export function removeNoteFromIndex(noteId: string): void {
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
export function syncMissingNotes(noteIds?: string[]): number {
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
export function rebuildIndex(): void {
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
export function getIndexStats(): FTSIndexStats {
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

/**
 * Filters out protected note IDs from the given set
 */
export function filterNonProtectedNoteIds(noteIds: Set<string>): string[] {
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
