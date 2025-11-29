CREATE TABLE IF NOT EXISTS "entity_changes" (
                                                `id`	INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
                                                `entityName`	TEXT NOT NULL,
                                                `entityId`	TEXT NOT NULL,
                                                `hash`	TEXT NOT NULL,
                                                `isErased` INT NOT NULL,
                                                `changeId` TEXT NOT NULL,
                                                `componentId` TEXT NOT NULL,
                                                `instanceId` TEXT NOT NULL,
                                                `isSynced` INTEGER NOT NULL,
                                                `utcDateChanged` TEXT NOT NULL
                                                );
CREATE TABLE IF NOT EXISTS "etapi_tokens"
(
    etapiTokenId TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    tokenHash TEXT NOT NULL,
    utcDateCreated TEXT NOT NULL,
    utcDateModified TEXT NOT NULL,
    isDeleted INT NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS "branches" (
                                          `branchId`	TEXT NOT NULL,
                                          `noteId`	TEXT NOT NULL,
                                          `parentNoteId`	TEXT NOT NULL,
                                          `notePosition`	INTEGER NOT NULL,
                                          `prefix`	TEXT,
                                          `isExpanded`	INTEGER NOT NULL DEFAULT 0,
                                          `isDeleted`	INTEGER NOT NULL DEFAULT 0,
                                          `deleteId`    TEXT DEFAULT NULL,
                                          `utcDateModified`	TEXT NOT NULL,
                                          PRIMARY KEY(`branchId`));
CREATE TABLE IF NOT EXISTS "notes" (
                                       `noteId`	TEXT NOT NULL,
                                       `title`	TEXT NOT NULL DEFAULT "note",
                                       `isProtected`	INT NOT NULL DEFAULT 0,
                                       `type` TEXT NOT NULL DEFAULT 'text',
                                       `mime` TEXT NOT NULL DEFAULT 'text/html',
                                       blobId TEXT DEFAULT NULL,
                                       `isDeleted`	INT NOT NULL DEFAULT 0,
                                       `deleteId`   TEXT DEFAULT NULL,
                                       `dateCreated`	TEXT NOT NULL,
                                       `dateModified`	TEXT NOT NULL,
                                       `utcDateCreated`	TEXT NOT NULL,
                                       `utcDateModified`	TEXT NOT NULL,
                                       PRIMARY KEY(`noteId`));
CREATE TABLE IF NOT EXISTS "revisions" (`revisionId`	TEXT NOT NULL PRIMARY KEY,
                                             `noteId`	TEXT NOT NULL,
                                             type TEXT DEFAULT '' NOT NULL,
                                             mime TEXT DEFAULT '' NOT NULL,
                                             `title`	TEXT NOT NULL,
                                             `isProtected`	INT NOT NULL DEFAULT 0,
                                            blobId TEXT DEFAULT NULL,
                                             `utcDateLastEdited` TEXT NOT NULL,
                                             `utcDateCreated` TEXT NOT NULL,
                                             `utcDateModified` TEXT NOT NULL,
                                             `dateLastEdited` TEXT NOT NULL,
                                             `dateCreated` TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS "options"
(
    name TEXT not null PRIMARY KEY,
    value TEXT not null,
    isSynced INTEGER default 0 not null,
    utcDateModified TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS "attributes"
(
    attributeId      TEXT not null primary key,
    noteId       TEXT not null,
    type         TEXT not null,
    name         TEXT not null,
    value        TEXT default '' not null,
    position     INT  default 0 not null,
    utcDateModified TEXT not null,
    isDeleted    INT  not null,
    `deleteId`    TEXT DEFAULT NULL,
    isInheritable int DEFAULT 0 NULL);
CREATE UNIQUE INDEX `IDX_entityChanges_entityName_entityId` ON "entity_changes" (
                                                                                 `entityName`,
                                                                                 `entityId`
    );
CREATE INDEX `IDX_branches_noteId_parentNoteId` ON `branches` (`noteId`,`parentNoteId`);
CREATE INDEX IDX_branches_parentNoteId ON branches (parentNoteId);
CREATE INDEX `IDX_notes_title` ON `notes` (`title`);
CREATE INDEX `IDX_notes_type` ON `notes` (`type`);
CREATE INDEX `IDX_notes_dateCreated` ON `notes` (`dateCreated`);
CREATE INDEX `IDX_notes_dateModified` ON `notes` (`dateModified`);
CREATE INDEX `IDX_notes_utcDateModified` ON `notes` (`utcDateModified`);
CREATE INDEX `IDX_notes_utcDateCreated` ON `notes` (`utcDateCreated`);
CREATE INDEX `IDX_revisions_noteId` ON `revisions` (`noteId`);
CREATE INDEX `IDX_revisions_utcDateCreated` ON `revisions` (`utcDateCreated`);
CREATE INDEX `IDX_revisions_utcDateLastEdited` ON `revisions` (`utcDateLastEdited`);
CREATE INDEX `IDX_revisions_dateCreated` ON `revisions` (`dateCreated`);
CREATE INDEX `IDX_revisions_dateLastEdited` ON `revisions` (`dateLastEdited`);
CREATE INDEX `IDX_entity_changes_changeId` ON `entity_changes` (`changeId`);
CREATE INDEX IDX_attributes_name_value
    on attributes (name, value);
CREATE INDEX IDX_attributes_noteId_index
    on attributes (noteId);
CREATE INDEX IDX_attributes_value_index
    on attributes (value);
CREATE TABLE IF NOT EXISTS "recent_notes"
(
    noteId TEXT not null primary key,
    notePath TEXT not null,
    utcDateCreated TEXT not null
);
CREATE TABLE IF NOT EXISTS "blobs" (
                                               `blobId`	TEXT NOT NULL,
                                               `content`	TEXT NULL DEFAULT NULL,
                                               `dateModified` TEXT NOT NULL,
                                               `utcDateModified` TEXT NOT NULL,
                                               PRIMARY KEY(`blobId`)
);
CREATE TABLE IF NOT EXISTS "attachments"
(
    attachmentId      TEXT not null primary key,
    ownerId       TEXT not null,
    role         TEXT not null,
    mime         TEXT not null,
    title         TEXT not null,
    isProtected    INT  not null DEFAULT 0,
    position     INT  default 0 not null,
    blobId    TEXT DEFAULT null,
    dateModified TEXT NOT NULL,
    utcDateModified TEXT not null,
    utcDateScheduledForErasureSince TEXT DEFAULT NULL,
    isDeleted    INT  not null,
    deleteId    TEXT DEFAULT NULL);
CREATE TABLE IF NOT EXISTS "user_data"
(
    tmpID INT,
    username TEXT,
    email TEXT,
    userIDEncryptedDataKey TEXT,
    userIDVerificationHash TEXT,
    salt TEXT,
    derivedKey TEXT,
    isSetup TEXT DEFAULT "false",
    UNIQUE (tmpID),
    PRIMARY KEY (tmpID)
);
CREATE INDEX IDX_attachments_ownerId_role
    on attachments (ownerId, role);

CREATE INDEX IDX_notes_blobId on notes (blobId);
CREATE INDEX IDX_revisions_blobId on revisions (blobId);
CREATE INDEX IDX_attachments_blobId on attachments (blobId);

-- Strategic Performance Indexes from migration 234
-- NOTES TABLE INDEXES
CREATE INDEX IDX_notes_search_composite 
ON notes (isDeleted, type, mime, dateModified DESC);

CREATE INDEX IDX_notes_metadata_covering 
ON notes (noteId, isDeleted, type, mime, title, dateModified, isProtected);

CREATE INDEX IDX_notes_protected_deleted 
ON notes (isProtected, isDeleted) 
WHERE isProtected = 1;

-- BRANCHES TABLE INDEXES  
CREATE INDEX IDX_branches_tree_traversal 
ON branches (parentNoteId, isDeleted, notePosition);

CREATE INDEX IDX_branches_covering 
ON branches (noteId, parentNoteId, isDeleted, notePosition, prefix);

CREATE INDEX IDX_branches_note_parents 
ON branches (noteId, isDeleted) 
WHERE isDeleted = 0;

-- ATTRIBUTES TABLE INDEXES
CREATE INDEX IDX_attributes_search_composite 
ON attributes (name, value, isDeleted);

CREATE INDEX IDX_attributes_covering 
ON attributes (noteId, name, value, type, isDeleted, position);

CREATE INDEX IDX_attributes_inheritable 
ON attributes (isInheritable, isDeleted) 
WHERE isInheritable = 1 AND isDeleted = 0;

CREATE INDEX IDX_attributes_labels 
ON attributes (type, name, value) 
WHERE type = 'label' AND isDeleted = 0;

CREATE INDEX IDX_attributes_relations 
ON attributes (type, name, value) 
WHERE type = 'relation' AND isDeleted = 0;

-- BLOBS TABLE INDEXES
CREATE INDEX IDX_blobs_content_size 
ON blobs (blobId, LENGTH(content));

-- ATTACHMENTS TABLE INDEXES
CREATE INDEX IDX_attachments_composite 
ON attachments (ownerId, role, isDeleted, position);

-- REVISIONS TABLE INDEXES
CREATE INDEX IDX_revisions_note_date 
ON revisions (noteId, utcDateCreated DESC);

-- ENTITY_CHANGES TABLE INDEXES
CREATE INDEX IDX_entity_changes_sync
ON entity_changes (isSynced, utcDateChanged);

-- RECENT_NOTES TABLE INDEXES
CREATE INDEX IDX_recent_notes_date 
ON recent_notes (utcDateCreated DESC);


CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    data TEXT,
    expires INTEGER
);

-- FTS5 Full-Text Search Support
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
CREATE VIRTUAL TABLE notes_fts USING fts5(
    noteId UNINDEXED,
    title,
    content,
    tokenize = 'trigram',
    detail = 'full'
);

-- Triggers to keep FTS table synchronized with notes
-- IMPORTANT: These triggers must handle all SQL operations including:
-- - Regular INSERT/UPDATE/DELETE
-- - INSERT OR REPLACE
-- - INSERT ... ON CONFLICT ... DO UPDATE (upsert)
-- - Cases where notes are created before blobs (import scenarios)

-- Trigger for INSERT operations on notes
-- Handles: INSERT, INSERT OR REPLACE, INSERT OR IGNORE, and the INSERT part of upsert
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
END;

-- Trigger for UPDATE operations on notes table
-- Handles: Regular UPDATE and the UPDATE part of upsert (ON CONFLICT DO UPDATE)
-- Fires for ANY update to searchable notes to ensure FTS stays in sync
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
END;

-- Trigger for UPDATE operations on blobs
-- Handles: Regular UPDATE and the UPDATE part of upsert (ON CONFLICT DO UPDATE)
-- IMPORTANT: Uses INSERT OR REPLACE for efficiency with deduplicated blobs
CREATE TRIGGER notes_fts_blob_update 
AFTER UPDATE ON blobs
BEGIN
    -- Use INSERT OR REPLACE for atomic update of all notes sharing this blob
    -- This is more efficient than DELETE + INSERT when many notes share the same blob
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
END;

-- Trigger for DELETE operations
CREATE TRIGGER notes_fts_delete 
AFTER DELETE ON notes
BEGIN
    DELETE FROM notes_fts WHERE noteId = OLD.noteId;
END;

-- Trigger for soft delete (isDeleted = 1)
CREATE TRIGGER notes_fts_soft_delete 
AFTER UPDATE ON notes
WHEN OLD.isDeleted = 0 AND NEW.isDeleted = 1
BEGIN
    DELETE FROM notes_fts WHERE noteId = NEW.noteId;
END;

-- Trigger for notes becoming protected
-- Remove from FTS when a note becomes protected
CREATE TRIGGER notes_fts_protect 
AFTER UPDATE ON notes
WHEN OLD.isProtected = 0 AND NEW.isProtected = 1
BEGIN
    DELETE FROM notes_fts WHERE noteId = NEW.noteId;
END;

-- Trigger for notes becoming unprotected
-- Add to FTS when a note becomes unprotected (if eligible)
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
END;

-- Trigger for INSERT operations on blobs
-- Handles: INSERT, INSERT OR REPLACE, and the INSERT part of upsert
-- Updates all notes that reference this blob (common during import and deduplication)
CREATE TRIGGER notes_fts_blob_insert
AFTER INSERT ON blobs
BEGIN
    -- Use INSERT OR REPLACE to handle both new and existing FTS entries
    -- This is crucial for blob deduplication where multiple notes may already
    -- exist that reference this blob before the blob itself is created
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
END;

-- =====================================================
-- FTS5 Full-Text Search Index for Attributes
-- =====================================================
-- This FTS5 table enables fast full-text searching of attribute names and values
-- Benefits:
-- - Fast free-text searches like ="somevalue" (10-50ms vs 1-2 seconds)
-- - Scales well with large attribute counts (650K+ attributes)
-- - Consistent performance with notes_fts
--
-- Uses trigram tokenizer with detail='full' for:
-- 1. Substring matching (3+ characters)
-- 2. Phrase query support (exact matches with word boundaries)
-- 3. Multi-language support without stemming assumptions

CREATE VIRTUAL TABLE attributes_fts USING fts5(
    attributeId UNINDEXED,
    noteId UNINDEXED,
    name,
    value,
    tokenize = 'trigram',
    detail = 'full'
);

-- Triggers to keep attributes_fts synchronized with attributes table

-- Trigger for INSERT operations
CREATE TRIGGER attributes_fts_insert
AFTER INSERT ON attributes
WHEN NEW.isDeleted = 0
BEGIN
    INSERT INTO attributes_fts (attributeId, noteId, name, value)
    VALUES (NEW.attributeId, NEW.noteId, NEW.name, COALESCE(NEW.value, ''));
END;

-- Trigger for UPDATE operations
CREATE TRIGGER attributes_fts_update
AFTER UPDATE ON attributes
BEGIN
    -- Remove old entry
    DELETE FROM attributes_fts WHERE attributeId = OLD.attributeId;

    -- Add new entry if not deleted
    INSERT INTO attributes_fts (attributeId, noteId, name, value)
    SELECT NEW.attributeId, NEW.noteId, NEW.name, COALESCE(NEW.value, '')
    WHERE NEW.isDeleted = 0;
END;

-- Trigger for DELETE operations
CREATE TRIGGER attributes_fts_delete
AFTER DELETE ON attributes
BEGIN
    DELETE FROM attributes_fts WHERE attributeId = OLD.attributeId;
END;

-- Trigger for soft delete (isDeleted = 1)
CREATE TRIGGER attributes_fts_soft_delete
AFTER UPDATE ON attributes
WHEN OLD.isDeleted = 0 AND NEW.isDeleted = 1
BEGIN
    DELETE FROM attributes_fts WHERE attributeId = NEW.attributeId;
END;
