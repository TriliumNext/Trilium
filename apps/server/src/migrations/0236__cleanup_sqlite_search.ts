/**
 * Migration to clean up custom SQLite search implementation
 *
 * This migration removes tables and triggers created by migration 0235
 * which implemented a custom SQLite-based search system. That system
 * has been replaced by FTS5 with trigram tokenizer (migration 0234),
 * making these custom tables redundant.
 *
 * Tables removed:
 * - note_search_content: Stored normalized note content for custom search
 * - note_tokens: Stored tokenized words for custom token-based search
 *
 * This migration is safe to run on databases that:
 * 1. Never ran migration 0235 (tables don't exist)
 * 2. Already ran migration 0235 (tables will be dropped)
 */

import sql from "../services/sql.js";
import log from "../services/log.js";

export default function cleanupSqliteSearch() {
    log.info("Starting SQLite custom search cleanup migration...");

    try {
        sql.transactional(() => {
            // Drop custom search tables if they exist
            log.info("Dropping note_search_content table...");
            sql.executeScript(`DROP TABLE IF EXISTS note_search_content`);

            log.info("Dropping note_tokens table...");
            sql.executeScript(`DROP TABLE IF EXISTS note_tokens`);

            // Clean up any entity changes for these tables
            // This prevents sync issues and cleans up change tracking
            log.info("Cleaning up entity changes for removed tables...");
            sql.execute(`
                DELETE FROM entity_changes
                WHERE entityName IN ('note_search_content', 'note_tokens')
            `);

            log.info("SQLite custom search cleanup completed successfully");
        });
    } catch (error) {
        log.error(`Error during SQLite search cleanup: ${error}`);
        throw new Error(`Failed to clean up SQLite search tables: ${error}`);
    }
}
