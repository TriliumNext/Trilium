/**
 * Migration to add FTS5 full-text search support and strategic performance indexes
 * 
 * This migration:
 * 1. Creates an FTS5 virtual table for full-text searching
 * 2. Populates it with existing note content
 * 3. Creates triggers to keep the FTS table synchronized with note changes
 * 4. Adds strategic composite and covering indexes for improved query performance
 * 5. Optimizes common query patterns identified through performance analysis
 */

import sql from "../services/sql.js";
import log from "../services/log.js";

export default function addFTS5SearchAndPerformanceIndexes() {
    log.info("Starting FTS5 and performance optimization migration...");
    
    // Part 1: FTS5 Setup
    log.info("Creating FTS5 virtual table for full-text search...");

    // Create FTS5 virtual table
    // We store noteId, title, and content for searching
    // The 'tokenize' option uses porter stemming for better search results
    sql.executeScript(`
        -- Drop existing FTS table if it exists (for re-running migration in dev)
        DROP TABLE IF EXISTS notes_fts;
        
        -- Create FTS5 virtual table
        CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
            noteId UNINDEXED,
            title,
            content,
            tokenize = 'porter unicode61'
        );
    `);

    log.info("Populating FTS5 table with existing note content...");

    // Populate the FTS table with existing notes
    // We only index text-based note types that contain searchable content
    const batchSize = 100;
    let processedCount = 0;
    let hasError = false;

    // Wrap entire population process in a transaction for consistency
    // If any error occurs, the entire population will be rolled back
    try {
        sql.transactional(() => {
            let offset = 0;
            
            while (true) {
                const notes = sql.getRows<{
                    noteId: string;
                    title: string;
                    content: string | null;
                }>(`
                    SELECT 
                        n.noteId,
                        n.title,
                        b.content
                    FROM notes n
                    LEFT JOIN blobs b ON n.blobId = b.blobId
                    WHERE n.type IN ('text', 'code', 'mermaid', 'canvas', 'mindMap')
                        AND n.isDeleted = 0
                        AND n.isProtected = 0  -- Skip protected notes - they require special handling
                    ORDER BY n.noteId
                    LIMIT ? OFFSET ?
                `, [batchSize, offset]);

                if (notes.length === 0) {
                    break;
                }

                for (const note of notes) {
                    if (note.content) {
                        // Process content based on type (simplified for migration)
                        let processedContent = note.content;
                        
                        // For HTML content, we'll strip tags in the search service
                        // For now, just insert the raw content
                        sql.execute(`
                            INSERT INTO notes_fts (noteId, title, content)
                            VALUES (?, ?, ?)
                        `, [note.noteId, note.title, processedContent]);
                        processedCount++;
                    }
                }

                offset += batchSize;
                
                if (processedCount % 1000 === 0) {
                    log.info(`Processed ${processedCount} notes for FTS indexing...`);
                }
            }
        });
    } catch (error) {
        hasError = true;
        log.error(`Failed to populate FTS index. Rolling back... ${error}`);
        // Clean up partial data if transaction failed
        try {
            sql.execute("DELETE FROM notes_fts");
        } catch (cleanupError) {
            log.error(`Failed to clean up FTS table after error: ${cleanupError}`);
        }
        throw new Error(`FTS5 migration failed during population: ${error}`);
    }

    log.info(`Completed FTS indexing of ${processedCount} notes`);

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

    log.info("FTS5 setup completed successfully");
    
    // Final cleanup: ensure all eligible notes are indexed
    // This catches any edge cases where notes might have been missed
    log.info("Running final FTS index cleanup...");
    
    // First check for missing notes
    const missingCount = sql.getValue<number>(`
        SELECT COUNT(*) FROM notes n
        LEFT JOIN blobs b ON n.blobId = b.blobId
        WHERE n.type IN ('text', 'code', 'mermaid', 'canvas', 'mindMap')
            AND n.isDeleted = 0
            AND n.isProtected = 0
            AND b.content IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM notes_fts WHERE noteId = n.noteId)
    `) || 0;
    
    if (missingCount > 0) {
        // Insert missing notes
        sql.execute(`
            WITH missing_notes AS (
                SELECT n.noteId, n.title, b.content
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
        `);
    }
    
    const cleanupCount = missingCount;
    
    if (cleanupCount && cleanupCount > 0) {
        log.info(`Indexed ${cleanupCount} additional notes during cleanup`);
    }
    
    // ========================================
    // Part 2: Strategic Performance Indexes
    // ========================================
    
    log.info("Adding strategic performance indexes...");
    const startTime = Date.now();
    const indexesCreated: string[] = [];

    try {
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
        indexesCreated.push("IDX_notes_search_composite");

        // Covering index for note metadata queries
        log.info("Creating covering index for note metadata...");
        sql.executeScript(`
            DROP INDEX IF EXISTS IDX_notes_metadata_covering;
            CREATE INDEX IF NOT EXISTS IDX_notes_metadata_covering 
            ON notes (noteId, isDeleted, type, mime, title, dateModified, isProtected);
        `);
        indexesCreated.push("IDX_notes_metadata_covering");

        // Index for protected notes filtering
        log.info("Creating index for protected notes...");
        sql.executeScript(`
            DROP INDEX IF EXISTS IDX_notes_protected_deleted;
            CREATE INDEX IF NOT EXISTS IDX_notes_protected_deleted 
            ON notes (isProtected, isDeleted) 
            WHERE isProtected = 1;
        `);
        indexesCreated.push("IDX_notes_protected_deleted");

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
        indexesCreated.push("IDX_branches_tree_traversal");

        // Covering index for branch queries
        log.info("Creating covering index for branch queries...");
        sql.executeScript(`
            DROP INDEX IF EXISTS IDX_branches_covering;
            CREATE INDEX IF NOT EXISTS IDX_branches_covering 
            ON branches (noteId, parentNoteId, isDeleted, notePosition, prefix);
        `);
        indexesCreated.push("IDX_branches_covering");

        // Index for finding all parents of a note
        log.info("Creating index for reverse tree lookup...");
        sql.executeScript(`
            DROP INDEX IF EXISTS IDX_branches_note_parents;
            CREATE INDEX IF NOT EXISTS IDX_branches_note_parents 
            ON branches (noteId, isDeleted) 
            WHERE isDeleted = 0;
        `);
        indexesCreated.push("IDX_branches_note_parents");

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
        indexesCreated.push("IDX_attributes_search_composite");

        // Covering index for attribute queries
        log.info("Creating covering index for attribute queries...");
        sql.executeScript(`
            DROP INDEX IF EXISTS IDX_attributes_covering;
            CREATE INDEX IF NOT EXISTS IDX_attributes_covering 
            ON attributes (noteId, name, value, type, isDeleted, position);
        `);
        indexesCreated.push("IDX_attributes_covering");

        // Index for inherited attributes
        log.info("Creating index for inherited attributes...");
        sql.executeScript(`
            DROP INDEX IF EXISTS IDX_attributes_inheritable;
            CREATE INDEX IF NOT EXISTS IDX_attributes_inheritable 
            ON attributes (isInheritable, isDeleted) 
            WHERE isInheritable = 1 AND isDeleted = 0;
        `);
        indexesCreated.push("IDX_attributes_inheritable");

        // Index for specific attribute types
        log.info("Creating index for label attributes...");
        sql.executeScript(`
            DROP INDEX IF EXISTS IDX_attributes_labels;
            CREATE INDEX IF NOT EXISTS IDX_attributes_labels 
            ON attributes (type, name, value) 
            WHERE type = 'label' AND isDeleted = 0;
        `);
        indexesCreated.push("IDX_attributes_labels");

        log.info("Creating index for relation attributes...");
        sql.executeScript(`
            DROP INDEX IF EXISTS IDX_attributes_relations;
            CREATE INDEX IF NOT EXISTS IDX_attributes_relations 
            ON attributes (type, name, value) 
            WHERE type = 'relation' AND isDeleted = 0;
        `);
        indexesCreated.push("IDX_attributes_relations");

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
        indexesCreated.push("IDX_blobs_content_size");

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
        indexesCreated.push("IDX_attachments_composite");

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
        indexesCreated.push("IDX_revisions_note_date");

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
        indexesCreated.push("IDX_entity_changes_sync");

        // Index for component-based queries
        log.info("Creating index for component-based entity change queries...");
        sql.executeScript(`
            DROP INDEX IF EXISTS IDX_entity_changes_component;
            CREATE INDEX IF NOT EXISTS IDX_entity_changes_component 
            ON entity_changes (componentId, utcDateChanged DESC);
        `);
        indexesCreated.push("IDX_entity_changes_component");

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
        indexesCreated.push("IDX_recent_notes_date");

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
            ANALYZE notes_fts;
        `);

        const endTime = Date.now();
        const duration = endTime - startTime;
        
        log.info(`Performance index creation completed in ${duration}ms`);
        log.info(`Created ${indexesCreated.length} indexes: ${indexesCreated.join(", ")}`);

    } catch (error) {
        log.error(`Error creating performance indexes: ${error}`);
        throw error;
    }
    
    log.info("FTS5 and performance optimization migration completed successfully");
}