import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";

import { getSql } from "../services/sql/index.js";
import { hashedBlobId } from "../services/utils/index.js";
import migration from "./0216__move_content_into_blobs.js";

// Spec files only ever run under vitest (ESM via Vite), so import.meta.url is available here; the
// CLAUDE.md ban applies to production code that gets bundled to CJS.
const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Migration 0216 is the one that introduced the `blobs` table: content used to live in per-entity
 * `note_contents` / `note_revision_contents` tables, and this migration hoists it into content-addressed
 * blobs so identical payloads are stored once. Those legacy tables are long gone from the schema, so
 * each test recreates them alongside the modern fixture and then runs the migration over them.
 */
describe("Migration 0216: move content into blobs", () => {
    let sql: ReturnType<typeof getSql>;

    /** Recreates the pre-0216 tables the migration reads from and writes back to. */
    function createLegacyTables() {
        sql.execute(/*sql*/`CREATE TABLE note_contents (noteId TEXT NOT NULL PRIMARY KEY, content TEXT, dateModified TEXT NOT NULL, utcDateModified TEXT NOT NULL)`);
        sql.execute(/*sql*/`CREATE TABLE note_revision_contents (noteRevisionId TEXT NOT NULL PRIMARY KEY, content TEXT, utcDateModified TEXT NOT NULL)`);
        sql.execute(/*sql*/`CREATE TABLE note_revisions (noteRevisionId TEXT NOT NULL PRIMARY KEY, noteId TEXT NOT NULL, blobId TEXT DEFAULT NULL)`);
    }

    /** A note row with no blobId yet — exactly the state the migration is meant to repair. */
    function insertLegacyNote(noteId: string, content: string) {
        sql.execute(/*sql*/`
            INSERT INTO notes (noteId, title, type, mime, blobId, dateCreated, dateModified, utcDateCreated, utcDateModified)
            VALUES (?, ?, 'text', 'text/html', NULL, datetime('now'), datetime('now'), datetime('now'), datetime('now'))
        `, [noteId, `Note ${noteId}`]);
        sql.execute(/*sql*/`
            INSERT INTO note_contents (noteId, content, dateModified, utcDateModified)
            VALUES (?, ?, datetime('now'), datetime('now'))
        `, [noteId, content]);
        sql.execute(/*sql*/`
            INSERT INTO entity_changes (entityName, entityId, hash, isErased, changeId, componentId, instanceId, isSynced, utcDateChanged)
            VALUES ('note_contents', ?, 'hash', 0, 'change', 'comp', 'inst', 1, datetime('now'))
        `, [noteId]);
    }

    function insertLegacyRevision(noteRevisionId: string, noteId: string, content: string) {
        sql.execute(/*sql*/`INSERT INTO note_revisions (noteRevisionId, noteId, blobId) VALUES (?, ?, NULL)`, [noteRevisionId, noteId]);
        sql.execute(/*sql*/`
            INSERT INTO note_revision_contents (noteRevisionId, content, utcDateModified)
            VALUES (?, ?, datetime('now'))
        `, [noteRevisionId, content]);
        sql.execute(/*sql*/`
            INSERT INTO entity_changes (entityName, entityId, hash, isErased, changeId, componentId, instanceId, isSynced, utcDateChanged)
            VALUES ('note_revision_contents', ?, 'hash', 0, 'change', 'comp', 'inst', 1, datetime('now'))
        `, [noteRevisionId]);
    }

    function entityChangeFor(entityName: string, entityId: string) {
        return sql.getRowOrNull<{ entityName: string; entityId: string }>(
            /*sql*/`SELECT entityName, entityId FROM entity_changes WHERE entityName = ? AND entityId = ?`, [entityName, entityId]
        );
    }

    beforeEach(() => {
        // Resolved here rather than at describe-collection time: describe callbacks run before the
        // setup's beforeAll, so getSql() would throw "SQL not initialized".
        sql = getSql();

        // Reload the fixture per test — every test mutates notes and entity_changes.
        sql.rebuildFromBuffer(readFileSync(join(__dirname, "../test/fixtures/document.db")));
        createLegacyTables();
    });

    it("moves note and revision content into content-addressed blobs, storing duplicates once", () => {
        const shared = "<p>the very same content</p>";
        const unique = "<p>something else</p>";
        insertLegacyNote("blobMigNoteA1", shared);
        insertLegacyNote("blobMigNoteB1", shared); // duplicate of A
        insertLegacyNote("blobMigNoteC1", unique);
        // A revision repeating a note's content, and one with content of its own.
        insertLegacyRevision("blobMigRev001", "blobMigNoteA1", shared);
        insertLegacyRevision("blobMigRev002", "blobMigNoteC1", "<p>revision only</p>");

        migration();

        const sharedBlobId = hashedBlobId(shared);
        const uniqueBlobId = hashedBlobId(unique);
        const revisionBlobId = hashedBlobId("<p>revision only</p>");

        // Both duplicate notes point at one blob; the distinct one gets its own.
        expect(sql.getValue(/*sql*/`SELECT blobId FROM notes WHERE noteId = 'blobMigNoteA1'`)).toBe(sharedBlobId);
        expect(sql.getValue(/*sql*/`SELECT blobId FROM notes WHERE noteId = 'blobMigNoteB1'`)).toBe(sharedBlobId);
        expect(sql.getValue(/*sql*/`SELECT blobId FROM notes WHERE noteId = 'blobMigNoteC1'`)).toBe(uniqueBlobId);
        expect(sql.getValue(/*sql*/`SELECT content FROM blobs WHERE blobId = ?`, [sharedBlobId])).toBe(shared);

        // Revisions are migrated the same way, and the one duplicating a note reuses that note's blob.
        expect(sql.getValue(/*sql*/`SELECT blobId FROM note_revisions WHERE noteRevisionId = 'blobMigRev001'`)).toBe(sharedBlobId);
        expect(sql.getValue(/*sql*/`SELECT blobId FROM note_revisions WHERE noteRevisionId = 'blobMigRev002'`)).toBe(revisionBlobId);

        // The first sighting of a payload re-points its entity change at the blob ...
        expect(entityChangeFor("blobs", sharedBlobId)).toMatchObject({ entityName: "blobs" });
        expect(entityChangeFor("blobs", revisionBlobId)).toMatchObject({ entityName: "blobs" });
        // ... while a duplicate's now-redundant change row is dropped rather than repointed.
        expect(entityChangeFor("note_contents", "blobMigNoteB1")).toBeNull();
        expect(entityChangeFor("note_revision_contents", "blobMigRev001")).toBeNull();
    });

    it("refuses to finish if a note was left without a blobId", () => {
        // A note with no note_contents row is never visited by the first loop, so its blobId stays
        // NULL — the migration must fail loudly rather than leave unreadable notes behind.
        sql.execute(/*sql*/`
            INSERT INTO notes (noteId, title, type, mime, blobId, dateCreated, dateModified, utcDateCreated, utcDateModified)
            VALUES ('blobMigOrphan1', 'Orphan', 'text', 'text/html', NULL, datetime('now'), datetime('now'), datetime('now'), datetime('now'))
        `);

        expect(() => migration()).toThrow(/BlobIds were not filled correctly in notes.*blobMigOrphan1/);
    });

    it("refuses to finish if a revision was left without a blobId", () => {
        sql.execute(/*sql*/`INSERT INTO note_revisions (noteRevisionId, noteId, blobId) VALUES ('blobMigOrphanRev', 'root', NULL)`);

        expect(() => migration()).toThrow(/BlobIds were not filled correctly in note revisions.*blobMigOrphanRev/);
    });
});
