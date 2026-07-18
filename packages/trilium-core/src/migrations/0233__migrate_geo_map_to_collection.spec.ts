import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, beforeEach } from "vitest";
import * as cls from "../services/context.js";
import { getSql } from "../services/sql/index.js";
import becca from "../becca/becca.js";
import becca_loader from "../becca/becca_loader.js";
import migration from "./0233__migrate_geo_map_to_collection.js";

// Resolve fixture path relative to this spec file. Spec files only ever run
// under vitest (which uses ESM via Vite), so import.meta.url is available;
// the CLAUDE.md restriction against import.meta.url applies to production
// code that gets bundled to CJS, not to test files.
const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Test suite for migration 0233 which converts geoMap notes to book type with viewConfig attachments.
 *
 * This migration:
 * 1. Changes note type from "geoMap" to "book"
 * 2. Clears the mime type
 * 3. Moves the note content to a viewConfig attachment named "geoMap.json"
 * 4. Clears the note content
 * 5. Sets a template relation to "_template_geo_map"
 *
 * The test simulates the database state before migration by directly inserting
 * test data into the database, then verifies the migration transforms the data correctly.
 */
describe("Migration 0233: Migrate geoMap to collection", () => {
    let sql: ReturnType<typeof getSql>;

    beforeEach(async () => {
        // getSql() is resolved here (not at describe-collection time) so that
        // initializeCore() in the test setup's beforeAll has had a chance to
        // run first. Capturing it eagerly at the top of describe crashes with
        // "SQL not initialized" because describe callbacks run before any
        // beforeAll hooks fire.
        sql = getSql();

        // Reload the integration test database from the fixture for each test
        // so mutations from one test don't leak into the next.
        const dbBytes = readFileSync(join(__dirname, "../test/fixtures/document.db"));
        sql.rebuildFromBuffer(dbBytes);

        await new Promise<void>((resolve) => {
            cls.getContext().init(() => {
                becca_loader.load();
                resolve();
            });
        });
    });

    it("should migrate geoMap notes to book type with viewConfig attachment", async () => {
        await new Promise<void>((resolve) => {
            cls.getContext().init(() => {
                // Create a test geoMap note with content
                const geoMapContent = JSON.stringify({
                    markers: [
                        { lat: 40.7128, lng: -74.0060, title: "New York" },
                        { lat: 34.0522, lng: -118.2437, title: "Los Angeles" }
                    ],
                    center: { lat: 39.8283, lng: -98.5795 },
                    zoom: 4
                });

                // Insert test data directly into the database
                const testNoteId = "test_geo_note_1";
                const testBlobId = "test_blob_geo_1";

                // Insert note record
                sql.execute(/*sql*/`
                    INSERT INTO notes (noteId, title, type, mime, blobId, dateCreated, dateModified, utcDateCreated, utcDateModified)
                    VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'), datetime('now'), datetime('now'))
                `, [testNoteId, "Test GeoMap Note", "geoMap", "application/json", testBlobId]);

                // Insert blob content
                sql.execute(/*sql*/`
                    INSERT INTO blobs (blobId, content, dateModified, utcDateModified)
                    VALUES (?, ?, datetime('now'), datetime('now'))
                `, [testBlobId, geoMapContent]);

                // Create a note without content to test edge case
                const testNoteId2 = "test_geo_note_2";
                const testBlobId2 = "test_blob_geo_2";

                sql.execute(/*sql*/`
                    INSERT INTO notes (noteId, title, type, mime, blobId, dateCreated, dateModified, utcDateCreated, utcDateModified)
                    VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'), datetime('now'), datetime('now'))
                `, [testNoteId2, "Empty GeoMap Note", "geoMap", "application/json", testBlobId2]);

                sql.execute(/*sql*/`
                    INSERT INTO blobs (blobId, content, dateModified, utcDateModified)
                    VALUES (?, ?, datetime('now'), datetime('now'))
                `, [testBlobId2, ""]);

                // Also create a non-geoMap note to ensure it's not affected
                const regularNoteId = "test_regular_note";
                const regularBlobId = "test_blob_regular";

                sql.execute(/*sql*/`
                    INSERT INTO notes (noteId, title, type, mime, blobId, dateCreated, dateModified, utcDateCreated, utcDateModified)
                    VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'), datetime('now'), datetime('now'))
                `, [regularNoteId, "Regular Text Note", "text", "text/html", regularBlobId]);

                sql.execute(/*sql*/`
                    INSERT INTO blobs (blobId, content, dateModified, utcDateModified)
                    VALUES (?, ?, datetime('now'), datetime('now'))
                `, [regularBlobId, "<p>Regular content</p>"]);

                // Reload becca to include our test data
                becca_loader.load();

                // Verify initial state
                const geoMapNote1 = becca.getNote(testNoteId);
                const geoMapNote2 = becca.getNote(testNoteId2);
                const regularNote = becca.getNote(regularNoteId);

                expect(geoMapNote1).toBeTruthy();
                expect(geoMapNote1?.type).toBe("geoMap");
                expect(geoMapNote2).toBeTruthy();
                expect(geoMapNote2?.type).toBe("geoMap");
                expect(regularNote).toBeTruthy();
                expect(regularNote?.type).toBe("text");

                // Run the migration
                migration();

                // Reload becca after migration
                becca_loader.load();

                // Verify migration results
                const migratedNote1 = becca.getNote(testNoteId);
                const migratedNote2 = becca.getNote(testNoteId2);
                const unchangedNote = becca.getNote(regularNoteId);

                // Check that geoMap notes were converted to book type
                expect(migratedNote1).toBeTruthy();
                expect(migratedNote1?.type).toBe("book");
                expect(migratedNote1?.mime).toBe("");

                expect(migratedNote2).toBeTruthy();
                expect(migratedNote2?.type).toBe("book");
                expect(migratedNote2?.mime).toBe("");

                // Check that regular note was not affected
                expect(unchangedNote).toBeTruthy();
                expect(unchangedNote?.type).toBe("text");

                // Check that content was moved to viewConfig attachment for note with content
                if (migratedNote1) {
                    const viewConfigAttachments = migratedNote1.getAttachmentsByRole("viewConfig");
                    expect(viewConfigAttachments).toHaveLength(1);

                    const attachment = viewConfigAttachments[0];
                    expect(attachment.title).toBe("geoMap.json");
                    expect(attachment.mime).toBe("application/json");
                    expect(attachment.getContent()).toBe(geoMapContent);

                    // Check that note content was cleared
                    expect(migratedNote1.getContent()).toBe("");

                    // Check that template relation was set
                    const templateRelations = migratedNote1.getRelations("template");
                    expect(templateRelations).toHaveLength(1);
                    expect(templateRelations[0].value).toBe("_template_geo_map");
                }

                // Check that note without content doesn't have viewConfig attachment
                if (migratedNote2) {
                    const viewConfigAttachments = migratedNote2.getAttachmentsByRole("viewConfig");
                    expect(viewConfigAttachments).toHaveLength(0);

                    // Check that template relation was still set
                    const templateRelations = migratedNote2.getRelations("template");
                    expect(templateRelations).toHaveLength(1);
                    expect(templateRelations[0].value).toBe("_template_geo_map");
                }

                resolve();
            });
        });
    });

    it("should handle existing viewConfig attachments with same title", async () => {
        await new Promise<void>((resolve) => {
            cls.getContext().init(() => {
                const geoMapContent = JSON.stringify({ test: "data" });
                const testNoteId = "test_geo_note_existing";
                const testBlobId = "test_blob_geo_existing";

                // Insert note record
                sql.execute(/*sql*/`
                    INSERT INTO notes (noteId, title, type, mime, blobId, dateCreated, dateModified, utcDateCreated, utcDateModified)
                    VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'), datetime('now'), datetime('now'))
                `, [testNoteId, "Test GeoMap with Existing Attachment", "geoMap", "application/json", testBlobId]);

                // Insert blob content
                sql.execute(/*sql*/`
                    INSERT INTO blobs (blobId, content, dateModified, utcDateModified)
                    VALUES (?, ?, datetime('now'), datetime('now'))
                `, [testBlobId, geoMapContent]);

                // Reload becca
                becca_loader.load();

                const note = becca.getNote(testNoteId);
                expect(note).toBeTruthy();

                // Create an existing viewConfig attachment with the same title
                const existingContent = JSON.stringify({ existing: "data" });
                note?.saveAttachment({
                    role: "viewConfig",
                    title: "geoMap.json",
                    mime: "application/json",
                    content: existingContent,
                    position: 0
                });

                // Verify existing attachment was created
                let attachments = note?.getAttachmentsByRole("viewConfig") || [];
                expect(attachments).toHaveLength(1);
                expect(attachments[0].getContent()).toBe(existingContent);

                // Run migration
                migration();

                // Reload becca after migration
                becca_loader.load();
                const migratedNote = becca.getNote(testNoteId);

                // Verify that existing attachment was updated, not duplicated
                if (migratedNote) {
                    const viewConfigAttachments = migratedNote.getAttachmentsByRole("viewConfig");
                    expect(viewConfigAttachments).toHaveLength(1);

                    const attachment = viewConfigAttachments[0];
                    expect(attachment.title).toBe("geoMap.json");
                    expect(attachment.getContent()).toBe(geoMapContent); // Should be updated with note content
                }

                resolve();
            });
        });
    });

    it("should handle protected geoMap notes appropriately", async () => {
        await new Promise<void>((resolve, reject) => {
            cls.getContext().init(() => {
                const geoMapContent = JSON.stringify({
                    markers: [{ lat: 51.5074, lng: -0.1278, title: "London" }],
                    center: { lat: 51.5074, lng: -0.1278 },
                    zoom: 10
                });

                const testNoteId = "protected_geo_note";
                const testBlobId = "protected_blob_geo";

                // Insert protected geoMap note
                sql.execute(/*sql*/`
                    INSERT INTO notes (noteId, title, type, mime, blobId, isProtected, dateCreated, dateModified, utcDateCreated, utcDateModified)
                    VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), datetime('now'), datetime('now'))
                `, [testNoteId, "Protected GeoMap Note", "geoMap", "application/json", testBlobId, 1]);

                // Insert encrypted blob content (in reality this would be encrypted, but for test we use plain text)
                sql.execute(/*sql*/`
                    INSERT INTO blobs (blobId, content, dateModified, utcDateModified)
                    VALUES (?, ?, datetime('now'), datetime('now'))
                `, [testBlobId, geoMapContent]);

                // Reload becca
                becca_loader.load();

                // Verify initial state
                const protectedNote = becca.getNote(testNoteId);
                expect(protectedNote).toBeTruthy();
                expect(protectedNote?.type).toBe("geoMap");
                expect(protectedNote?.isProtected).toBe(true);

                // Run migration - this should either handle protected notes gracefully or throw an error
                try {
                    migration();
                } catch (error) {
                    reject(error);
                }

                // Reload becca after migration attempt
                becca_loader.load();
                const noteAfterMigration = becca.getNote(testNoteId);

                // If migration succeeds, verify the transformation
                expect(noteAfterMigration).toBeTruthy();
                expect(noteAfterMigration?.type).toBe("book");
                expect(noteAfterMigration?.mime).toBe("");
                expect(noteAfterMigration?.isProtected).toBe(true); // Should remain protected

                // Check if content migration worked or was skipped for protected notes
                const viewConfigAttachments = noteAfterMigration?.getAttachmentsByRole("viewConfig") || [];

                // Document the behavior - either content was migrated or it was skipped
                if (viewConfigAttachments.length > 0) {
                    const attachment = viewConfigAttachments[0];
                    expect(attachment.title).toBe("geoMap.json");
                    console.log("Protected note content was successfully migrated to attachment");
                } else {
                    console.log("Protected note content migration was skipped (expected behavior)");
                }

                // Template relation should still be set regardless
                const templateRelations = noteAfterMigration?.getRelations("template") || [];
                expect(templateRelations).toHaveLength(1);
                expect(templateRelations[0].value).toBe("_template_geo_map");

                resolve();
            });
        });
    });

});
