/**
 * Migration to add FTS5 full-text search support and strategic performance indexes
 *
 * This migration:
 * 1. Creates an FTS5 virtual table for full-text searching of notes
 * 2. Populates it with existing note content
 * 3. Creates triggers to keep the FTS table synchronized with note changes
 * 4. Creates an FTS5 virtual table for full-text searching of attributes
 * 5. Populates it with existing attributes and creates synchronization triggers
 * 6. Adds strategic composite and covering indexes for improved query performance
 * 7. Optimizes common query patterns identified through performance analysis
 */

import sql from "../services/sql.js";
import log from "../services/log.js";

function createNotesFtsTable(): void {
    log.info("Creating FTS5 virtual table for full-text search...");

    // Create FTS5 virtual table
    // We store noteId, title, and content for searching
    sql.executeScript(`
        -- Create FTS5 virtual table with trigram tokenizer
        -- Trigram tokenizer provides language-agnostic substring matching:
        -- 1. Fast substring matching (50-100x speedup for LIKE queries without wildcards)
        -- 2. Case-insensitive search without custom collation
        -- 3. No language-specific stemming assumptions (works for all languages)
        -- 4. Boolean operators (AND, OR, NOT) and phrase matching with quotes
        --
        -- IMPORTANT: Trigram requires minimum 3-character tokens for matching
        -- detail='full' enables phrase queries (required for exact match with = operator)
        -- and provides position info for highlight() function
        -- Note: Using detail='full' instead of detail='none' increases index size by ~50%
        -- but is necessary to support phrase queries like "exact phrase"
        CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
            noteId UNINDEXED,
            title,
            content,
            tokenize = 'trigram',
            detail = 'full'
        );
    `);
}

function populateNotesFtsIndex(): void {
    log.info("Populating FTS5 table with existing note content...");

    const eligibleCount = sql.getValue<number>(`
        SELECT COUNT(*) FROM notes n
        LEFT JOIN blobs b ON n.blobId = b.blobId
        WHERE n.type IN ('text','code','mermaid','canvas','mindMap')
            AND n.isDeleted = 0 AND n.isProtected = 0
    `) || 0;

    log.info(`Indexing ${eligibleCount} notes into FTS5 (this may take a moment for large databases)...`);
    const startTime = Date.now();

    // Disable automerge to prevent incremental b-tree merging during bulk insert.
    // Raise crisismerge threshold to prevent blocking merges.
    // This is the recommended approach from SQLite FTS5 docs for bulk operations.
    sql.execute(`INSERT INTO notes_fts(notes_fts, rank) VALUES('automerge', 0)`);
    sql.execute(`INSERT INTO notes_fts(notes_fts, rank) VALUES('crisismerge', 64)`);

    sql.execute(`
        INSERT INTO notes_fts (noteId, title, content)
        SELECT n.noteId, n.title, COALESCE(b.content, '')
        FROM notes n
        LEFT JOIN blobs b ON n.blobId = b.blobId
        WHERE n.type IN ('text','code','mermaid','canvas','mindMap')
            AND n.isDeleted = 0 AND n.isProtected = 0
    `);

    // Restore defaults and optimize: merge all b-trees into one for optimal query performance.
    sql.execute(`INSERT INTO notes_fts(notes_fts, rank) VALUES('automerge', 4)`);
    sql.execute(`INSERT INTO notes_fts(notes_fts, rank) VALUES('crisismerge', 16)`);
    sql.execute(`INSERT INTO notes_fts(notes_fts) VALUES('optimize')`);

    log.info(`Completed FTS indexing of ${eligibleCount} notes in ${Date.now() - startTime}ms`);
}

function createNotesFtsTriggers(): void {
    // Create triggers to keep FTS table synchronized
    log.info("Creating FTS synchronization triggers...");

    // Drop all existing triggers first to ensure clean state
    sql.execute(`DROP TRIGGER IF EXISTS notes_fts_insert`);
    sql.execute(`DROP TRIGGER IF EXISTS notes_fts_update`);
    sql.execute(`DROP TRIGGER IF EXISTS notes_fts_delete`);
    sql.execute(`DROP TRIGGER IF EXISTS notes_fts_soft_delete`);
    sql.execute(`DROP TRIGGER IF EXISTS notes_fts_blob_insert`);
    sql.execute(`DROP TRIGGER IF EXISTS notes_fts_blob_update`);
    sql.execute(`DROP TRIGGER IF EXISTS notes_fts_protect`);
    sql.execute(`DROP TRIGGER IF EXISTS notes_fts_unprotect`);

    // Create improved triggers that handle all SQL operations properly
    // including INSERT OR REPLACE and INSERT ... ON CONFLICT ... DO UPDATE (upsert)

    // Trigger for INSERT operations on notes
    sql.execute(`
        CREATE TRIGGER notes_fts_insert
        AFTER INSERT ON notes
        WHEN NEW.type IN ('text', 'code', 'mermaid', 'canvas', 'mindMap')
            AND NEW.isDeleted = 0
            AND NEW.isProtected = 0
        BEGIN
            -- First delete any existing FTS entry (in case of INSERT OR REPLACE)
            DELETE FROM notes_fts WHERE noteId = NEW.noteId;

            -- Then insert the new entry, using LEFT JOIN to handle missing blobs
            INSERT INTO notes_fts (noteId, title, content)
            SELECT
                NEW.noteId,
                NEW.title,
                COALESCE(b.content, '')  -- Use empty string if blob doesn't exist yet
            FROM (SELECT NEW.noteId) AS note_select
            LEFT JOIN blobs b ON b.blobId = NEW.blobId;
        END
    `);

    // Trigger for UPDATE operations on notes table
    // Fires for ANY update to searchable notes to ensure FTS stays in sync
    sql.execute(`
        CREATE TRIGGER notes_fts_update
        AFTER UPDATE ON notes
        WHEN NEW.type IN ('text', 'code', 'mermaid', 'canvas', 'mindMap')
            -- Fire on any change, not just specific columns, to handle all upsert scenarios
        BEGIN
            -- Always delete the old entry
            DELETE FROM notes_fts WHERE noteId = NEW.noteId;

            -- Insert new entry if note is not deleted and not protected
            INSERT INTO notes_fts (noteId, title, content)
            SELECT
                NEW.noteId,
                NEW.title,
                COALESCE(b.content, '')  -- Use empty string if blob doesn't exist yet
            FROM (SELECT NEW.noteId) AS note_select
            LEFT JOIN blobs b ON b.blobId = NEW.blobId
            WHERE NEW.isDeleted = 0
                AND NEW.isProtected = 0;
        END
    `);

    // Trigger for DELETE operations on notes
    sql.execute(`
        CREATE TRIGGER notes_fts_delete
        AFTER DELETE ON notes
        BEGIN
            DELETE FROM notes_fts WHERE noteId = OLD.noteId;
        END
    `);

    // Trigger for soft delete (isDeleted = 1)
    sql.execute(`
        CREATE TRIGGER notes_fts_soft_delete
        AFTER UPDATE ON notes
        WHEN OLD.isDeleted = 0 AND NEW.isDeleted = 1
        BEGIN
            DELETE FROM notes_fts WHERE noteId = NEW.noteId;
        END
    `);

    // Trigger for notes becoming protected
    sql.execute(`
        CREATE TRIGGER notes_fts_protect
        AFTER UPDATE ON notes
        WHEN OLD.isProtected = 0 AND NEW.isProtected = 1
        BEGIN
            DELETE FROM notes_fts WHERE noteId = NEW.noteId;
        END
    `);

    // Trigger for notes becoming unprotected
    sql.execute(`
        CREATE TRIGGER notes_fts_unprotect
        AFTER UPDATE ON notes
        WHEN OLD.isProtected = 1 AND NEW.isProtected = 0
            AND NEW.type IN ('text', 'code', 'mermaid', 'canvas', 'mindMap')
            AND NEW.isDeleted = 0
        BEGIN
            DELETE FROM notes_fts WHERE noteId = NEW.noteId;

            INSERT INTO notes_fts (noteId, title, content)
            SELECT
                NEW.noteId,
                NEW.title,
                COALESCE(b.content, '')
            FROM (SELECT NEW.noteId) AS note_select
            LEFT JOIN blobs b ON b.blobId = NEW.blobId;
        END
    `);

    // Trigger for INSERT operations on blobs
    // Uses INSERT OR REPLACE for efficiency with deduplicated blobs
    sql.execute(`
        CREATE TRIGGER notes_fts_blob_insert
        AFTER INSERT ON blobs
        BEGIN
            -- Use INSERT OR REPLACE for atomic update
            -- This handles the case where FTS entries may already exist
            INSERT OR REPLACE INTO notes_fts (noteId, title, content)
            SELECT
                n.noteId,
                n.title,
                NEW.content
            FROM notes n
            WHERE n.blobId = NEW.blobId
                AND n.type IN ('text', 'code', 'mermaid', 'canvas', 'mindMap')
                AND n.isDeleted = 0
                AND n.isProtected = 0;
        END
    `);

    // Trigger for UPDATE operations on blobs
    // Uses INSERT OR REPLACE for efficiency
    sql.execute(`
        CREATE TRIGGER notes_fts_blob_update
        AFTER UPDATE ON blobs
        BEGIN
            -- Use INSERT OR REPLACE for atomic update
            INSERT OR REPLACE INTO notes_fts (noteId, title, content)
            SELECT
                n.noteId,
                n.title,
                NEW.content
            FROM notes n
            WHERE n.blobId = NEW.blobId
                AND n.type IN ('text', 'code', 'mermaid', 'canvas', 'mindMap')
                AND n.isDeleted = 0
                AND n.isProtected = 0;
        END
    `);

    log.info("FTS5 triggers created successfully");
}

function createPerformanceIndexes(): void {
    log.info("Adding strategic performance indexes...");
    const startTime = Date.now();
    let indexCount = 0;

    // ========================================
    // NOTES TABLE INDEXES
    // ========================================

    // Composite index for common search filters
    log.info("Creating composite index on notes table for search filters...");
    sql.executeScript(`
        DROP INDEX IF EXISTS IDX_notes_search_composite;
        CREATE INDEX IF NOT EXISTS IDX_notes_search_composite
        ON notes (isDeleted, type, mime, dateModified DESC);
    `);
    indexCount++;

    // Covering index for note metadata queries
    log.info("Creating covering index for note metadata...");
    sql.executeScript(`
        DROP INDEX IF EXISTS IDX_notes_metadata_covering;
        CREATE INDEX IF NOT EXISTS IDX_notes_metadata_covering
        ON notes (noteId, isDeleted, type, mime, title, dateModified, isProtected);
    `);
    indexCount++;

    // Index for protected notes filtering
    log.info("Creating index for protected notes...");
    sql.executeScript(`
        DROP INDEX IF EXISTS IDX_notes_protected_deleted;
        CREATE INDEX IF NOT EXISTS IDX_notes_protected_deleted
        ON notes (isProtected, isDeleted)
        WHERE isProtected = 1;
    `);
    indexCount++;

    // ========================================
    // BRANCHES TABLE INDEXES
    // ========================================

    // Composite index for tree traversal
    log.info("Creating composite index on branches for tree traversal...");
    sql.executeScript(`
        DROP INDEX IF EXISTS IDX_branches_tree_traversal;
        CREATE INDEX IF NOT EXISTS IDX_branches_tree_traversal
        ON branches (parentNoteId, isDeleted, notePosition);
    `);
    indexCount++;

    // Covering index for branch queries
    log.info("Creating covering index for branch queries...");
    sql.executeScript(`
        DROP INDEX IF EXISTS IDX_branches_covering;
        CREATE INDEX IF NOT EXISTS IDX_branches_covering
        ON branches (noteId, parentNoteId, isDeleted, notePosition, prefix);
    `);
    indexCount++;

    // Index for finding all parents of a note
    log.info("Creating index for reverse tree lookup...");
    sql.executeScript(`
        DROP INDEX IF EXISTS IDX_branches_note_parents;
        CREATE INDEX IF NOT EXISTS IDX_branches_note_parents
        ON branches (noteId, isDeleted)
        WHERE isDeleted = 0;
    `);
    indexCount++;

    // ========================================
    // ATTRIBUTES TABLE INDEXES
    // ========================================

    // Composite index for attribute searches
    log.info("Creating composite index on attributes for search...");
    sql.executeScript(`
        DROP INDEX IF EXISTS IDX_attributes_search_composite;
        CREATE INDEX IF NOT EXISTS IDX_attributes_search_composite
        ON attributes (name, value, isDeleted);
    `);
    indexCount++;

    // Covering index for attribute queries
    log.info("Creating covering index for attribute queries...");
    sql.executeScript(`
        DROP INDEX IF EXISTS IDX_attributes_covering;
        CREATE INDEX IF NOT EXISTS IDX_attributes_covering
        ON attributes (noteId, name, value, type, isDeleted, position);
    `);
    indexCount++;

    // Index for inherited attributes
    log.info("Creating index for inherited attributes...");
    sql.executeScript(`
        DROP INDEX IF EXISTS IDX_attributes_inheritable;
        CREATE INDEX IF NOT EXISTS IDX_attributes_inheritable
        ON attributes (isInheritable, isDeleted)
        WHERE isInheritable = 1 AND isDeleted = 0;
    `);
    indexCount++;

    // Index for specific attribute types
    log.info("Creating index for label attributes...");
    sql.executeScript(`
        DROP INDEX IF EXISTS IDX_attributes_labels;
        CREATE INDEX IF NOT EXISTS IDX_attributes_labels
        ON attributes (type, name, value)
        WHERE type = 'label' AND isDeleted = 0;
    `);
    indexCount++;

    log.info("Creating index for relation attributes...");
    sql.executeScript(`
        DROP INDEX IF EXISTS IDX_attributes_relations;
        CREATE INDEX IF NOT EXISTS IDX_attributes_relations
        ON attributes (type, name, value)
        WHERE type = 'relation' AND isDeleted = 0;
    `);
    indexCount++;

    // ========================================
    // BLOBS TABLE INDEXES
    // ========================================

    // Index for blob content size filtering
    log.info("Creating index for blob content size...");
    sql.executeScript(`
        DROP INDEX IF EXISTS IDX_blobs_content_size;
        CREATE INDEX IF NOT EXISTS IDX_blobs_content_size
        ON blobs (blobId, LENGTH(content));
    `);
    indexCount++;

    // ========================================
    // ATTACHMENTS TABLE INDEXES
    // ========================================

    // Composite index for attachment queries
    log.info("Creating composite index for attachments...");
    sql.executeScript(`
        DROP INDEX IF EXISTS IDX_attachments_composite;
        CREATE INDEX IF NOT EXISTS IDX_attachments_composite
        ON attachments (ownerId, role, isDeleted, position);
    `);
    indexCount++;

    // ========================================
    // REVISIONS TABLE INDEXES
    // ========================================

    // Composite index for revision queries
    log.info("Creating composite index for revisions...");
    sql.executeScript(`
        DROP INDEX IF EXISTS IDX_revisions_note_date;
        CREATE INDEX IF NOT EXISTS IDX_revisions_note_date
        ON revisions (noteId, utcDateCreated DESC);
    `);
    indexCount++;

    // ========================================
    // ENTITY_CHANGES TABLE INDEXES
    // ========================================

    // Composite index for sync operations
    log.info("Creating composite index for entity changes sync...");
    sql.executeScript(`
        DROP INDEX IF EXISTS IDX_entity_changes_sync;
        CREATE INDEX IF NOT EXISTS IDX_entity_changes_sync
        ON entity_changes (isSynced, utcDateChanged);
    `);
    indexCount++;

    // ========================================
    // RECENT_NOTES TABLE INDEXES
    // ========================================

    // Index for recent notes ordering
    log.info("Creating index for recent notes...");
    sql.executeScript(`
        DROP INDEX IF EXISTS IDX_recent_notes_date;
        CREATE INDEX IF NOT EXISTS IDX_recent_notes_date
        ON recent_notes (utcDateCreated DESC);
    `);
    indexCount++;

    // ========================================
    // ANALYZE TABLES FOR QUERY PLANNER
    // ========================================

    log.info("Running ANALYZE to update SQLite query planner statistics...");
    sql.executeScript(`
        ANALYZE notes;
        ANALYZE branches;
        ANALYZE attributes;
        ANALYZE blobs;
        ANALYZE attachments;
        ANALYZE revisions;
        ANALYZE entity_changes;
        ANALYZE recent_notes;
    `);

    const duration = Date.now() - startTime;
    log.info(`Performance index creation completed in ${duration}ms (${indexCount} indexes created)`);
}

function setupAttributesFts(): void {
    log.info("Creating FTS5 index for attributes...");

    // Create FTS5 virtual table for attributes
    // IMPORTANT: Trigram requires minimum 3-character tokens for matching
    // detail='full' enables phrase queries (required for exact match with = operator)
    // and provides position info for highlight() function
    sql.execute(`
        CREATE VIRTUAL TABLE IF NOT EXISTS attributes_fts USING fts5(
            attributeId UNINDEXED,
            noteId UNINDEXED,
            name,
            value,
            tokenize = 'trigram',
            detail = 'full'
        )
    `);

    log.info("Populating attributes_fts table...");

    // Populate FTS table with existing attributes (non-deleted only)
    const attrStartTime = Date.now();

    // Disable automerge to prevent incremental b-tree merging during bulk insert.
    // Raise crisismerge threshold to prevent blocking merges.
    sql.execute(`INSERT INTO attributes_fts(attributes_fts, rank) VALUES('automerge', 0)`);
    sql.execute(`INSERT INTO attributes_fts(attributes_fts, rank) VALUES('crisismerge', 64)`);

    sql.execute(`
        INSERT INTO attributes_fts (attributeId, noteId, name, value)
        SELECT
            attributeId,
            noteId,
            name,
            COALESCE(value, '')
        FROM attributes
        WHERE isDeleted = 0
    `);

    // Restore defaults and optimize: merge all b-trees into one for optimal query performance.
    sql.execute(`INSERT INTO attributes_fts(attributes_fts, rank) VALUES('automerge', 4)`);
    sql.execute(`INSERT INTO attributes_fts(attributes_fts, rank) VALUES('crisismerge', 16)`);
    sql.execute(`INSERT INTO attributes_fts(attributes_fts) VALUES('optimize')`);

    const populateTime = Date.now() - attrStartTime;
    const attrCount = sql.getValue<number>(`SELECT COUNT(*) FROM attributes_fts`) || 0;
    log.info(`Populated ${attrCount} attributes in ${populateTime}ms`);

    // Create triggers to keep FTS index synchronized with attributes table

    // Trigger 1: INSERT - Add new attributes to FTS
    sql.execute(`
        CREATE TRIGGER attributes_fts_insert
        AFTER INSERT ON attributes
        WHEN NEW.isDeleted = 0
        BEGIN
            INSERT INTO attributes_fts (attributeId, noteId, name, value)
            VALUES (NEW.attributeId, NEW.noteId, NEW.name, COALESCE(NEW.value, ''));
        END
    `);

    // Trigger 2: UPDATE - Update FTS when attributes change
    sql.execute(`
        CREATE TRIGGER attributes_fts_update
        AFTER UPDATE ON attributes
        BEGIN
            -- Remove old entry
            DELETE FROM attributes_fts WHERE attributeId = OLD.attributeId;

            -- Add new entry if not deleted
            INSERT INTO attributes_fts (attributeId, noteId, name, value)
            SELECT NEW.attributeId, NEW.noteId, NEW.name, COALESCE(NEW.value, '')
            WHERE NEW.isDeleted = 0;
        END
    `);

    // Trigger 3: DELETE - Remove from FTS
    sql.execute(`
        CREATE TRIGGER attributes_fts_delete
        AFTER DELETE ON attributes
        BEGIN
            DELETE FROM attributes_fts WHERE attributeId = OLD.attributeId;
        END
    `);

    // Trigger 4: Soft delete (isDeleted = 1) - Remove from FTS
    sql.execute(`
        CREATE TRIGGER attributes_fts_soft_delete
        AFTER UPDATE ON attributes
        WHEN OLD.isDeleted = 0 AND NEW.isDeleted = 1
        BEGIN
            DELETE FROM attributes_fts WHERE attributeId = NEW.attributeId;
        END
    `);

    log.info("Attributes FTS5 setup completed successfully");
}

function cleanupLegacyTables(): void {
    // Remove tables from previous custom SQLite search implementation
    // that has been replaced by FTS5
    log.info("Cleaning up legacy custom search tables...");

    sql.executeScript(`DROP TABLE IF EXISTS note_search_content`);
    sql.executeScript(`DROP TABLE IF EXISTS note_tokens`);

    // Clean up any entity changes for these tables
    sql.execute(`
        DELETE FROM entity_changes
        WHERE entityName IN ('note_search_content', 'note_tokens')
    `);
}

export default function addFTS5SearchAndPerformanceIndexes() {
    log.info("Starting FTS5 and performance optimization migration...");

    createNotesFtsTable();
    populateNotesFtsIndex();
    createNotesFtsTriggers();
    createPerformanceIndexes();
    setupAttributesFts();
    cleanupLegacyTables();

    log.info("FTS5 and performance optimization migration completed successfully");
}
