/**
 * @module
 *
 * Contains all the migrations that are run on the database.
 */

// Migrations should be kept in descending order, so the latest migration is first.
const MIGRATIONS: (SqlMigration | JsMigration)[] = [
    // Migrate aiChat notes to code notes since LLM integration has been removed
    {
        version: 234,
        module: async () => import("./0234__migrate_ai_chat_to_code.js")
    },
    // Migrate geo map to collection
    {
        version: 233,
        module: async () => import("./0233__migrate_geo_map_to_collection.js")
    },
    // Remove embedding tables since LLM embedding functionality has been removed
    {
        version: 232,
        sql: /*sql*/`
            -- Remove LLM embedding tables and data
            DROP TABLE IF EXISTS "note_embeddings";
            DROP TABLE IF EXISTS "embedding_queue";
            DROP TABLE IF EXISTS "embedding_providers";

            -- Remove embedding-related entity changes
            DELETE FROM entity_changes WHERE entityName IN ('note_embeddings', 'embedding_queue', 'embedding_providers');
        `
    },
    // Session store
    {
        version: 231,
        sql: /*sql*/`\
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                data TEXT,
                expires INTEGER
            );
        `
    },
    // Add tables for vector embeddings storage and management
    // This migration adds embedding support to the main document.db database
    {
        version: 230,
        sql: /*sql*/`\
            -- Store embeddings for notes
            CREATE TABLE IF NOT EXISTS "note_embeddings" (
                "embedId" TEXT NOT NULL PRIMARY KEY,
                "noteId" TEXT NOT NULL,
                "providerId" TEXT NOT NULL,
                "modelId" TEXT NOT NULL,
                "dimension" INTEGER NOT NULL,
                "embedding" BLOB NOT NULL,
                "version" INTEGER NOT NULL DEFAULT 1,
                "dateCreated" TEXT NOT NULL,
                "utcDateCreated" TEXT NOT NULL,
                "dateModified" TEXT NOT NULL,
                "utcDateModified" TEXT NOT NULL
            );

            CREATE INDEX "IDX_note_embeddings_noteId" ON "note_embeddings" ("noteId");
            CREATE INDEX "IDX_note_embeddings_providerId_modelId" ON "note_embeddings" ("providerId", "modelId");

            -- Table to track which notes need embedding updates
            CREATE TABLE IF NOT EXISTS "embedding_queue" (
                "noteId" TEXT NOT NULL PRIMARY KEY,
                "operation" TEXT NOT NULL, -- CREATE, UPDATE, DELETE
                "dateQueued" TEXT NOT NULL,
                "utcDateQueued" TEXT NOT NULL,
                "priority" INTEGER NOT NULL DEFAULT 0,
                "attempts" INTEGER NOT NULL DEFAULT 0,
                "lastAttempt" TEXT NULL,
                "error" TEXT NULL,
                "failed" INTEGER NOT NULL DEFAULT 0,
                "isProcessing" INTEGER NOT NULL DEFAULT 0
            );

            -- Table to store embedding provider configurations
            CREATE TABLE IF NOT EXISTS "embedding_providers" (
                "providerId" TEXT NOT NULL PRIMARY KEY,
                "name" TEXT NOT NULL,
                "priority" INTEGER NOT NULL DEFAULT 0,
                "config" TEXT NOT NULL, -- JSON config object
                "dateCreated" TEXT NOT NULL,
                "utcDateCreated" TEXT NOT NULL,
                "dateModified" TEXT NOT NULL,
                "utcDateModified" TEXT NOT NULL
            );
        `
    },

    // add the oauth user data table
    {
        version: 229,
        sql: /*sql*/`\
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
        `
    },
    // fix blob IDs
    {
        version: 228,
        sql: /*sql*/`\
        -- + is normally replaced by X and / by Y, but this can temporarily cause UNIQUE key exception
        -- this might create blob duplicates, but cleanup will eventually take care of it

        UPDATE blobs SET blobId = REPLACE(blobId, '+', 'A');
        UPDATE blobs SET blobId = REPLACE(blobId, '/', 'B');

        UPDATE notes SET blobId = REPLACE(blobId, '+', 'A');
        UPDATE notes SET blobId = REPLACE(blobId, '/', 'B');

        UPDATE attachments SET blobId = REPLACE(blobId, '+', 'A');
        UPDATE attachments SET blobId = REPLACE(blobId, '/', 'B');

        UPDATE revisions SET blobId = REPLACE(blobId, '+', 'A');
        UPDATE revisions SET blobId = REPLACE(blobId, '/', 'B');

        UPDATE entity_changes SET entityId = REPLACE(entityId, '+', 'A') WHERE entityName = 'blobs';
        UPDATE entity_changes SET entityId = REPLACE(entityId, '/', 'B') WHERE entityName = 'blobs';
        `
    },
    // disable image compression
    {
        version: 227,
        sql: /*sql*/`\
            -- emergency disabling of image compression since it appears to make problems in migration to 0.61
            UPDATE options SET value = 'false' WHERE name = 'compressImages';
        `
    },
    // rename note size label
    {
        version: 226,
        sql: /*sql*/`\
            UPDATE attributes SET value = 'contentAndAttachmentsAndRevisionsSize' WHERE name = 'orderBy' AND value = 'noteSize';
        `
    },
    // create blob ID indices
    {
        version: 225,
        sql: /*sql*/`\
            CREATE INDEX IF NOT EXISTS IDX_notes_blobId on notes (blobId);
            CREATE INDEX IF NOT EXISTS IDX_revisions_blobId on revisions (blobId);
            CREATE INDEX IF NOT EXISTS IDX_attachments_blobId on attachments (blobId);
        `
    },
    // fix blob IDs
    {
        version: 224,
        sql: /*sql*/`\
            UPDATE blobs SET blobId = REPLACE(blobId, '+', 'X');
            UPDATE blobs SET blobId = REPLACE(blobId, '/', 'Y');

            UPDATE notes SET blobId = REPLACE(blobId, '+', 'X');
            UPDATE notes SET blobId = REPLACE(blobId, '/', 'Y');

            UPDATE attachments SET blobId = REPLACE(blobId, '+', 'X');
            UPDATE attachments SET blobId = REPLACE(blobId, '/', 'Y');

            UPDATE revisions SET blobId = REPLACE(blobId, '+', 'X');
            UPDATE revisions SET blobId = REPLACE(blobId, '/', 'Y');

            UPDATE entity_changes SET entityId = REPLACE(entityId, '+', 'X') WHERE entityName = 'blobs';
            UPDATE entity_changes SET entityId = REPLACE(entityId, '/', 'Y') WHERE entityName = 'blobs';
        `
    },
    // no operation
    {
        version: 223,
        sql: /*sql*/`\
            SELECT 1;
        `
    },
    // rename open tabs to open note contexts
    {
        version: 222,
        sql: /*sql*/`\
            UPDATE options SET name = 'openNoteContexts' WHERE name = 'openTabs';
            UPDATE entity_changes SET entityId = 'openNoteContexts' WHERE entityName = 'options' AND entityId = 'openTabs';
        `
    },
    // remove hide included images option
    {
        version: 221,
        sql: /*sql*/`\
            DELETE FROM options WHERE name = 'hideIncludedImages_main';
            DELETE FROM entity_changes WHERE entityName = 'options' AND entityId = 'hideIncludedImages_main';
        `
    },
    // migrate images to attachments
    {
        version: 220,
        module: () => import("./0220__migrate_images_to_attachments.js")
    },
    // attachments
    {
        version: 219,
        sql: /*sql*/`\
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

            CREATE INDEX IDX_attachments_ownerId_role
                on attachments (ownerId, role);

            CREATE INDEX IDX_attachments_utcDateScheduledForErasureSince
                on attachments (utcDateScheduledForErasureSince);

            CREATE INDEX IF NOT EXISTS IDX_attachments_blobId on attachments (blobId);
        `
    },
    // rename note revision to revision
    {
        version: 218,
        sql: /*sql*/`\
            CREATE TABLE IF NOT EXISTS "revisions" (
                revisionId	TEXT NOT NULL PRIMARY KEY,
                noteId	TEXT NOT NULL,
                type TEXT DEFAULT '' NOT NULL,
                mime TEXT DEFAULT '' NOT NULL,
                title	TEXT NOT NULL,
                isProtected	INT NOT NULL DEFAULT 0,
                blobId TEXT DEFAULT NULL,
                utcDateLastEdited TEXT NOT NULL,
                utcDateCreated TEXT NOT NULL,
                utcDateModified TEXT NOT NULL,
                dateLastEdited TEXT NOT NULL,
                dateCreated TEXT NOT NULL
            );

            INSERT INTO revisions (revisionId, noteId, type, mime, title, isProtected, utcDateLastEdited, utcDateCreated, utcDateModified, dateLastEdited, dateCreated, blobId)
            SELECT noteRevisionId, noteId, type, mime, title, isProtected, utcDateLastEdited, utcDateCreated, utcDateModified, dateLastEdited, dateCreated, blobId FROM note_revisions;

            DROP TABLE note_revisions;

            CREATE INDEX IDX_revisions_noteId ON revisions (noteId);
            CREATE INDEX IDX_revisions_utcDateCreated ON revisions (utcDateCreated);
            CREATE INDEX IDX_revisions_utcDateLastEdited ON revisions (utcDateLastEdited);
            CREATE INDEX IDX_revisions_dateCreated ON revisions (dateCreated);
            CREATE INDEX IDX_revisions_dateLastEdited ON revisions (dateLastEdited);
            CREATE INDEX IF NOT EXISTS IDX_revisions_blobId on revisions (blobId);

            UPDATE entity_changes SET entityName = 'revisions' WHERE entityName = 'note_revisions';
        `
    },
    // drop content tables
    {
        version: 217,
        sql: /*sql*/`\
            DROP TABLE note_contents;
            DROP TABLE note_revision_contents;

            DELETE FROM entity_changes WHERE entityName IN ('note_contents', 'note_revision_contents');
        `
    },
    {
        version: 216,
        module: async () => import("./0216__move_content_into_blobs.js")
    },
    // content structure
    {
        version: 215,
        sql: /*sql*/`\
            CREATE TABLE IF NOT EXISTS "blobs" (
                blobId	TEXT NOT NULL,
                content	TEXT NULL DEFAULT NULL,
                dateModified TEXT NOT NULL,
                utcDateModified TEXT NOT NULL,
                PRIMARY KEY (blobId)
            );

            ALTER TABLE notes ADD blobId TEXT DEFAULT NULL;
            ALTER TABLE note_revisions ADD blobId TEXT DEFAULT NULL;

            CREATE INDEX IF NOT EXISTS IDX_notes_blobId on notes (blobId);
            CREATE INDEX IF NOT EXISTS IDX_note_revisions_blobId on note_revisions (blobId);
        `
    }
];

export default MIGRATIONS;

interface Migration {
    version: number;
}

interface SqlMigration extends Migration {
    sql: string;
}

interface JsMigration extends Migration {
    module: () => Promise<{ default: () => void }>;
}
