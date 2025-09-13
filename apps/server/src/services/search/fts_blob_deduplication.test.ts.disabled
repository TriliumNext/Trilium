/**
 * Tests for FTS5 blob deduplication scenarios
 * 
 * This test file validates that FTS indexing works correctly when:
 * 1. Multiple notes share the same blob (deduplication)
 * 2. Notes change content to match existing blobs
 * 3. Blobs are updated and affect multiple notes
 * 4. Notes switch between unique and shared blobs
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sql from '../sql.js';
import beccaLoader from '../../becca/becca_loader.js';
import noteService from '../notes.js';
import searchService from './services/search.js';
import { ftsSearchService } from './fts_search.js';

describe('FTS5 Blob Deduplication Tests', () => {
    beforeEach(() => {
        // Ensure we have a clean test database with FTS enabled
        sql.execute("DELETE FROM notes WHERE noteId LIKE 'test_%'");
        sql.execute("DELETE FROM blobs WHERE blobId LIKE 'test_%'");
        sql.execute("DELETE FROM notes_fts WHERE noteId LIKE 'test_%'");
        
        // Reload becca to ensure cache is in sync
        beccaLoader.load();
    });

    afterEach(() => {
        // Clean up test data
        sql.execute("DELETE FROM notes WHERE noteId LIKE 'test_%'");
        sql.execute("DELETE FROM blobs WHERE blobId LIKE 'test_%'");
        sql.execute("DELETE FROM notes_fts WHERE noteId LIKE 'test_%'");
    });

    describe('Blob Deduplication Scenarios', () => {
        it('should index multiple notes sharing the same blob', async () => {
            // Create first note with unique content
            const note1 = await noteService.createNewNote({
                noteId: 'test_note1',
                parentNoteId: 'root',
                title: 'Test Note 1',
                content: 'Shared content for deduplication test',
                type: 'text'
            });

            // Create second note with the same content (will share blob)
            const note2 = await noteService.createNewNote({
                noteId: 'test_note2',
                parentNoteId: 'root',
                title: 'Test Note 2',
                content: 'Shared content for deduplication test',
                type: 'text'
            });

            // Verify both notes share the same blob
            const blob1 = sql.getRow("SELECT blobId FROM notes WHERE noteId = ?", ['test_note1']);
            const blob2 = sql.getRow("SELECT blobId FROM notes WHERE noteId = ?", ['test_note2']);
            expect(blob1.blobId).toBe(blob2.blobId);

            // Verify both notes are indexed in FTS
            const ftsCount = sql.getValue(
                "SELECT COUNT(*) FROM notes_fts WHERE noteId IN (?, ?)",
                ['test_note1', 'test_note2']
            );
            expect(ftsCount).toBe(2);

            // Search should find both notes
            const searchResults = searchService.searchNotes('deduplication');
            const foundNoteIds = searchResults.map(r => r.noteId);
            expect(foundNoteIds).toContain('test_note1');
            expect(foundNoteIds).toContain('test_note2');
        });

        it('should update FTS when note content changes to match existing blob', async () => {
            // Create first note with unique content
            const note1 = await noteService.createNewNote({
                noteId: 'test_note3',
                parentNoteId: 'root',
                title: 'Note with existing content',
                content: 'This is existing content in the database',
                type: 'text'
            });

            // Create second note with different content
            const note2 = await noteService.createNewNote({
                noteId: 'test_note4',
                parentNoteId: 'root',
                title: 'Note with different content',
                content: 'This is completely different content',
                type: 'text'
            });

            // Verify notes have different blobs initially
            const initialBlob1 = sql.getValue("SELECT blobId FROM notes WHERE noteId = ?", ['test_note3']);
            const initialBlob2 = sql.getValue("SELECT blobId FROM notes WHERE noteId = ?", ['test_note4']);
            expect(initialBlob1).not.toBe(initialBlob2);

            // Change note2's content to match note1 (deduplication occurs)
            await noteService.updateNoteContent('test_note4', 'This is existing content in the database');
            
            // Verify both notes now share the same blob
            const finalBlob1 = sql.getValue("SELECT blobId FROM notes WHERE noteId = ?", ['test_note3']);
            const finalBlob2 = sql.getValue("SELECT blobId FROM notes WHERE noteId = ?", ['test_note4']);
            expect(finalBlob1).toBe(finalBlob2);

            // Verify FTS is updated correctly for note2
            const ftsContent = sql.getValue(
                "SELECT content FROM notes_fts WHERE noteId = ?",
                ['test_note4']
            );
            expect(ftsContent).toBe('This is existing content in the database');

            // Search for old content should not find note2
            const oldContentSearch = searchService.searchNotes('completely different');
            const oldSearchIds = oldContentSearch.map(r => r.noteId);
            expect(oldSearchIds).not.toContain('test_note4');

            // Search for new content should find both notes
            const newContentSearch = searchService.searchNotes('existing content');
            const newSearchIds = newContentSearch.map(r => r.noteId);
            expect(newSearchIds).toContain('test_note3');
            expect(newSearchIds).toContain('test_note4');
        });

        it('should update all notes when shared blob content changes', async () => {
            // Create three notes with the same content
            const sharedContent = 'Original shared content for blob update test';
            
            await noteService.createNewNote({
                noteId: 'test_note5',
                parentNoteId: 'root',
                title: 'Shared Note 1',
                content: sharedContent,
                type: 'text'
            });

            await noteService.createNewNote({
                noteId: 'test_note6',
                parentNoteId: 'root',
                title: 'Shared Note 2',
                content: sharedContent,
                type: 'text'
            });

            await noteService.createNewNote({
                noteId: 'test_note7',
                parentNoteId: 'root',
                title: 'Shared Note 3',
                content: sharedContent,
                type: 'text'
            });

            // Verify all three share the same blob
            const blobIds = sql.getColumn(
                "SELECT DISTINCT blobId FROM notes WHERE noteId IN (?, ?, ?)",
                ['test_note5', 'test_note6', 'test_note7']
            );
            expect(blobIds.length).toBe(1);
            const sharedBlobId = blobIds[0];

            // Update the blob content directly (simulating what would happen in real update)
            sql.execute(
                "UPDATE blobs SET content = ? WHERE blobId = ?",
                ['Updated shared content for all notes', sharedBlobId]
            );

            // Verify FTS is updated for all three notes
            const ftsContents = sql.getColumn(
                "SELECT content FROM notes_fts WHERE noteId IN (?, ?, ?) ORDER BY noteId",
                ['test_note5', 'test_note6', 'test_note7']
            );
            
            expect(ftsContents).toHaveLength(3);
            ftsContents.forEach(content => {
                expect(content).toBe('Updated shared content for all notes');
            });

            // Search for old content should find nothing
            const oldSearch = searchService.searchNotes('Original shared');
            expect(oldSearch.filter(r => r.noteId.startsWith('test_'))).toHaveLength(0);

            // Search for new content should find all three
            const newSearch = searchService.searchNotes('Updated shared');
            const foundIds = newSearch.map(r => r.noteId).filter(id => id.startsWith('test_'));
            expect(foundIds).toContain('test_note5');
            expect(foundIds).toContain('test_note6');
            expect(foundIds).toContain('test_note7');
        });

        it('should handle note switching from shared to unique blob', async () => {
            // Create two notes with shared content
            const sharedContent = 'Shared content before divergence';
            
            const note1 = await noteService.createNewNote({
                noteId: 'test_note8',
                parentNoteId: 'root',
                title: 'Diverging Note 1',
                content: sharedContent,
                type: 'text'
            });

            const note2 = await noteService.createNewNote({
                noteId: 'test_note9',
                parentNoteId: 'root',
                title: 'Diverging Note 2',
                content: sharedContent,
                type: 'text'
            });

            // Verify they share the same blob
            const initialBlob1 = sql.getValue("SELECT blobId FROM notes WHERE noteId = ?", ['test_note8']);
            const initialBlob2 = sql.getValue("SELECT blobId FROM notes WHERE noteId = ?", ['test_note9']);
            expect(initialBlob1).toBe(initialBlob2);

            // Change note2 to unique content
            await noteService.updateNoteContent('test_note9', 'Unique content after divergence');

            // Verify they now have different blobs
            const finalBlob1 = sql.getValue("SELECT blobId FROM notes WHERE noteId = ?", ['test_note8']);
            const finalBlob2 = sql.getValue("SELECT blobId FROM notes WHERE noteId = ?", ['test_note9']);
            expect(finalBlob1).not.toBe(finalBlob2);

            // Verify FTS is correctly updated
            const ftsContent1 = sql.getValue(
                "SELECT content FROM notes_fts WHERE noteId = ?",
                ['test_note8']
            );
            const ftsContent2 = sql.getValue(
                "SELECT content FROM notes_fts WHERE noteId = ?",
                ['test_note9']
            );
            
            expect(ftsContent1).toBe('Shared content before divergence');
            expect(ftsContent2).toBe('Unique content after divergence');

            // Search should find correct notes
            const sharedSearch = searchService.searchNotes('before divergence');
            expect(sharedSearch.map(r => r.noteId)).toContain('test_note8');
            expect(sharedSearch.map(r => r.noteId)).not.toContain('test_note9');

            const uniqueSearch = searchService.searchNotes('after divergence');
            expect(uniqueSearch.map(r => r.noteId)).not.toContain('test_note8');
            expect(uniqueSearch.map(r => r.noteId)).toContain('test_note9');
        });

        it('should handle import scenarios where notes exist before blobs', async () => {
            // Simulate import scenario: create note without blob first
            sql.execute(`
                INSERT INTO notes (noteId, title, type, mime, blobId, isDeleted, isProtected, dateCreated, dateModified, utcDateCreated, utcDateModified)
                VALUES ('test_note10', 'Import Test Note', 'text', 'text/html', 'pending_blob_123', 0, 0, datetime('now'), datetime('now'), datetime('now'), datetime('now'))
            `);

            // Verify note is not in FTS yet (no blob content)
            const initialFts = sql.getValue(
                "SELECT COUNT(*) FROM notes_fts WHERE noteId = ?",
                ['test_note10']
            );
            expect(initialFts).toBe(0);

            // Now create the blob (simulating delayed blob creation during import)
            sql.execute(`
                INSERT INTO blobs (blobId, content, dateModified, utcDateModified)
                VALUES ('pending_blob_123', 'Imported content finally available', datetime('now'), datetime('now'))
            `);

            // Verify note is now indexed in FTS
            const finalFts = sql.getValue(
                "SELECT content FROM notes_fts WHERE noteId = ?",
                ['test_note10']
            );
            expect(finalFts).toBe('Imported content finally available');

            // Search should now find the note
            const searchResults = searchService.searchNotes('Imported content');
            expect(searchResults.map(r => r.noteId)).toContain('test_note10');
        });

        it('should correctly handle protected notes during deduplication', async () => {
            // Create a regular note
            const note1 = await noteService.createNewNote({
                noteId: 'test_note11',
                parentNoteId: 'root',
                title: 'Regular Note',
                content: 'Content that will be shared',
                type: 'text'
            });

            // Create a protected note with same content
            sql.execute(`
                INSERT INTO notes (noteId, title, type, mime, blobId, isDeleted, isProtected, dateCreated, dateModified, utcDateCreated, utcDateModified)
                VALUES ('test_note12', 'Protected Note', 'text', 'text/html', 
                    (SELECT blobId FROM notes WHERE noteId = 'test_note11'),
                    0, 1, datetime('now'), datetime('now'), datetime('now'), datetime('now'))
            `);

            // Verify protected note is NOT in FTS
            const protectedInFts = sql.getValue(
                "SELECT COUNT(*) FROM notes_fts WHERE noteId = ?",
                ['test_note12']
            );
            expect(protectedInFts).toBe(0);

            // Verify regular note IS in FTS
            const regularInFts = sql.getValue(
                "SELECT COUNT(*) FROM notes_fts WHERE noteId = ?",
                ['test_note11']
            );
            expect(regularInFts).toBe(1);

            // Update blob content
            const blobId = sql.getValue("SELECT blobId FROM notes WHERE noteId = ?", ['test_note11']);
            sql.execute("UPDATE blobs SET content = ? WHERE blobId = ?", ['Updated shared content', blobId]);

            // Verify regular note is updated in FTS
            const updatedContent = sql.getValue(
                "SELECT content FROM notes_fts WHERE noteId = ?",
                ['test_note11']
            );
            expect(updatedContent).toBe('Updated shared content');

            // Verify protected note is still NOT in FTS
            const protectedStillNotInFts = sql.getValue(
                "SELECT COUNT(*) FROM notes_fts WHERE noteId = ?",
                ['test_note12']
            );
            expect(protectedStillNotInFts).toBe(0);
        });
    });

    describe('FTS Sync and Cleanup', () => {
        it('should sync missing notes to FTS index', async () => {
            // Manually create notes without triggering FTS (simulating missed triggers)
            sql.execute(`
                INSERT INTO notes (noteId, title, type, mime, blobId, isDeleted, isProtected, dateCreated, dateModified, utcDateCreated, utcDateModified)
                VALUES ('test_note13', 'Missed Note 1', 'text', 'text/html', 'blob_missed_1', 0, 0, datetime('now'), datetime('now'), datetime('now'), datetime('now'))
            `);
            
            sql.execute(`
                INSERT INTO blobs (blobId, content, dateModified, utcDateModified)
                VALUES ('blob_missed_1', 'Content that was missed by triggers', datetime('now'), datetime('now'))
            `);

            // Delete from FTS to simulate missing index
            sql.execute("DELETE FROM notes_fts WHERE noteId = 'test_note13'");

            // Verify note is missing from FTS
            const beforeSync = sql.getValue(
                "SELECT COUNT(*) FROM notes_fts WHERE noteId = ?",
                ['test_note13']
            );
            expect(beforeSync).toBe(0);

            // Run sync
            const syncedCount = ftsSearchService.syncMissingNotes(['test_note13']);
            expect(syncedCount).toBe(1);

            // Verify note is now in FTS
            const afterSync = sql.getValue(
                "SELECT content FROM notes_fts WHERE noteId = ?",
                ['test_note13']
            );
            expect(afterSync).toBe('Content that was missed by triggers');
        });

        it('should handle FTS rebuild correctly', () => {
            // Create some test notes
            const noteIds = ['test_note14', 'test_note15', 'test_note16'];
            noteIds.forEach((noteId, index) => {
                sql.execute(`
                    INSERT INTO notes (noteId, title, type, mime, blobId, isDeleted, isProtected, dateCreated, dateModified, utcDateCreated, utcDateModified)
                    VALUES (?, ?, 'text', 'text/html', ?, 0, 0, datetime('now'), datetime('now'), datetime('now'), datetime('now'))
                `, [noteId, `Test Note ${index}`, `blob_${noteId}`]);
                
                sql.execute(`
                    INSERT INTO blobs (blobId, content, dateModified, utcDateModified)
                    VALUES (?, ?, datetime('now'), datetime('now'))
                `, [`blob_${noteId}`, `Content for note ${index}`]);
            });

            // Corrupt FTS by adding invalid entries
            sql.execute("INSERT INTO notes_fts (noteId, title, content) VALUES ('invalid_note', 'Invalid', 'Invalid content')");

            // Rebuild index
            ftsSearchService.rebuildIndex();

            // Verify only valid notes are in FTS
            const ftsCount = sql.getValue("SELECT COUNT(*) FROM notes_fts WHERE noteId LIKE 'test_%'");
            expect(ftsCount).toBe(3);

            // Verify invalid entry is gone
            const invalidCount = sql.getValue("SELECT COUNT(*) FROM notes_fts WHERE noteId = 'invalid_note'");
            expect(invalidCount).toBe(0);

            // Verify content is correct
            noteIds.forEach((noteId, index) => {
                const content = sql.getValue(
                    "SELECT content FROM notes_fts WHERE noteId = ?",
                    [noteId]
                );
                expect(content).toBe(`Content for note ${index}`);
            });
        });
    });
});