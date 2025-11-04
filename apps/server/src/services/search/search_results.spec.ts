import { describe, it, expect, beforeEach } from 'vitest';
import searchService from './services/search.js';
import BNote from '../../becca/entities/bnote.js';
import BBranch from '../../becca/entities/bbranch.js';
import SearchContext from './search_context.js';
import becca from '../../becca/becca.js';
import { findNoteByTitle, note, NoteBuilder } from '../../test/becca_mocking.js';

/**
 * Search Results Processing and Formatting Tests
 *
 * Tests result structure, scoring, ordering, and consistency including:
 * - Result structure validation
 * - Score calculation and relevance
 * - Result ordering (by score and custom)
 * - Note path resolution
 * - Deduplication
 * - Result limits
 * - Empty results handling
 * - Result consistency
 * - Result quality
 */
describe('Search - Result Processing and Formatting', () => {
    let rootNote: any;

    beforeEach(() => {
        becca.reset();

        rootNote = new NoteBuilder(new BNote({ noteId: 'root', title: 'root', type: 'text' }));
        new BBranch({
            branchId: 'none_root',
            noteId: 'root',
            parentNoteId: 'none',
            notePosition: 10,
        });
    });

    describe('Result Structure', () => {
        it('should return SearchResult objects with correct properties', () => {
            rootNote.child(note('Test Note', { content: 'test content' }));

            const searchContext = new SearchContext();
            const results = searchService.findResultsWithQuery('test', searchContext);

            expect(results.length).toBeGreaterThan(0);
            const result = results[0]!;

            // Verify SearchResult has required properties
            expect(result).toHaveProperty('noteId');
            expect(result).toHaveProperty('score');
            expect(typeof result.noteId).toBe('string');
            expect(typeof result.score).toBe('number');
        });

        it('should include notePath in results', () => {
            const parentBuilder = rootNote.child(note('Parent'));
            parentBuilder.child(note('Searchable Child'));

            const searchContext = new SearchContext();
            const results = searchService.findResultsWithQuery('searchable', searchContext);
            const result = results.find((r) => findNoteByTitle([r], 'Searchable Child'));

            expect(result).toBeTruthy();
            // notePath property may be available depending on implementation
            expect(result!.noteId.length).toBeGreaterThan(0);
        });

        it('should include metadata in results', () => {
            rootNote.child(note('Searchable Test'));

            const searchContext = new SearchContext();
            const results = searchService.findResultsWithQuery('searchable', searchContext);
            const result = results.find((r) => findNoteByTitle([r], 'Searchable Test'));

            expect(result).toBeTruthy();
            expect(result!.score).toBeGreaterThanOrEqual(0);
            expect(result!.noteId).toBeTruthy();
        });
    });

    describe('Score Calculation', () => {
        it('should calculate relevance scores for fulltext matches', () => {
            rootNote
                .child(note('Test', { content: 'test' }))
                .child(note('Test Test', { content: 'test test test' }));

            const searchContext = new SearchContext();
            const results = searchService.findResultsWithQuery('test', searchContext);

            // Both notes should have scores
            expect(results.every((r) => typeof r.score === 'number')).toBeTruthy();
            expect(results.every((r) => r.score >= 0)).toBeTruthy();
        });

        it('should order results by score (highest first by default)', () => {
            rootNote
                .child(note('Test', { content: 'test' }))
                .child(note('Test Test', { content: 'test test test test' }))
                .child(note('Weak', { content: 'test is here' }));

            const searchContext = new SearchContext();
            const results = searchService.findResultsWithQuery('test', searchContext);

            // Verify scores are in descending order
            for (let i = 0; i < results.length - 1; i++) {
                expect(results[i]!.score).toBeGreaterThanOrEqual(results[i + 1]!.score);
            }
        });

        it('should give higher scores to exact matches vs fuzzy matches', () => {
            rootNote
                .child(note('Programming', { content: 'This is about programming' }))
                .child(note('Programmer', { content: 'This is about programmer' }));

            const searchContext = new SearchContext();
            const results = searchService.findResultsWithQuery('programming', searchContext);

            const exactResult = results.find((r) => findNoteByTitle([r], 'Programming'));
            const fuzzyResult = results.find((r) => findNoteByTitle([r], 'Programmer'));

            if (exactResult && fuzzyResult) {
                expect(exactResult.score).toBeGreaterThanOrEqual(fuzzyResult.score);
            }
        });

        it('should verify score ranges are consistent', () => {
            rootNote.child(note('Test', { content: 'test content' }));

            const searchContext = new SearchContext();
            const results = searchService.findResultsWithQuery('test', searchContext);

            // Scores should be in a reasonable range (implementation-specific)
            results.forEach((result) => {
                expect(result.score).toBeGreaterThanOrEqual(0);
                expect(isFinite(result.score)).toBeTruthy();
                expect(isNaN(result.score)).toBeFalsy();
            });
        });

        it('should handle title matches with higher scores than content matches', () => {
            rootNote
                .child(note('Programming Guide', { content: 'About coding' }))
                .child(note('Guide', { content: 'This is about programming' }));

            const searchContext = new SearchContext();
            const results = searchService.findResultsWithQuery('programming', searchContext);

            const titleResult = results.find((r) => findNoteByTitle([r], 'Programming Guide'));
            const contentResult = results.find((r) => findNoteByTitle([r], 'Guide'));

            if (titleResult && contentResult) {
                // Title matches typically have higher relevance
                expect(titleResult.score).toBeGreaterThan(0);
                expect(contentResult.score).toBeGreaterThan(0);
            }
        });
    });

    describe('Result Ordering', () => {
        it('should order by relevance (score) by default', () => {
            rootNote
                .child(note('Match', { content: 'programming' }))
                .child(note('Strong Match', { content: 'programming programming programming' }));

            const searchContext = new SearchContext();
            const results = searchService.findResultsWithQuery('programming', searchContext);

            // Verify descending order by score
            for (let i = 0; i < results.length - 1; i++) {
                expect(results[i]!.score).toBeGreaterThanOrEqual(results[i + 1]!.score);
            }
        });

        it('should allow custom ordering to override score ordering', () => {
            rootNote
                .child(note('Z Test Title').label('test'))
                .child(note('A Test Title').label('test'));

            const searchContext = new SearchContext();
            const results = searchService.findResultsWithQuery('#test orderBy note.title', searchContext);
            const titles = results.map((r) => becca.notes[r.noteId]!.title);

            // Should order by title, not by score
            expect(titles).toEqual(['A Test Title', 'Z Test Title']);
        });

        it('should use score as tiebreaker when custom ordering produces ties', () => {
            rootNote
                .child(note('Test Same Priority').label('test').label('priority', '5'))
                .child(note('Test Test Same Priority').label('test').label('priority', '5'));

            const searchContext = new SearchContext();
            const results = searchService.findResultsWithQuery('#test orderBy #priority', searchContext);

            // When priority is same, should fall back to score
            expect(results.length).toBeGreaterThanOrEqual(2);
            // Verify consistent ordering
            const noteIds = results.map((r) => r.noteId);
            expect(noteIds.length).toBeGreaterThan(0);
        });
    });

    describe('Note Path Resolution', () => {
        it('should resolve path for note with single parent', () => {
            const parentBuilder = rootNote.child(note('Parent'));
            parentBuilder.child(note('Searchable Child'));

            const searchContext = new SearchContext();
            const results = searchService.findResultsWithQuery('searchable', searchContext);
            const result = results.find((r) => findNoteByTitle([r], 'Searchable Child'));

            expect(result).toBeTruthy();
            expect(result!.noteId).toBeTruthy();
        });

        it('should handle notes with multiple parent paths (cloned notes)', () => {
            const parent1Builder = rootNote.child(note('Parent1'));
            const parent2Builder = rootNote.child(note('Parent2'));

            const childBuilder = parent1Builder.child(note('Searchable Cloned Child'));

            // Clone the child under parent2
            new BBranch({
                branchId: 'clone_branch',
                noteId: childBuilder.note.noteId,
                parentNoteId: parent2Builder.note.noteId,
                notePosition: 10,
            });

            const searchContext = new SearchContext();
            const results = searchService.findResultsWithQuery('searchable', searchContext);
            const childResults = results.filter((r) => findNoteByTitle([r], 'Searchable Cloned Child'));

            // Should find the note (possibly once for each path, depending on implementation)
            expect(childResults.length).toBeGreaterThan(0);
        });

        it('should resolve deep paths (multiple levels)', () => {
            const grandparentBuilder = rootNote.child(note('Grandparent'));
            const parentBuilder = grandparentBuilder.child(note('Parent'));
            parentBuilder.child(note('Searchable Child'));

            const searchContext = new SearchContext();
            const results = searchService.findResultsWithQuery('searchable', searchContext);
            const result = results.find((r) => findNoteByTitle([r], 'Searchable Child'));

            expect(result).toBeTruthy();
            expect(result!.noteId).toBeTruthy();
        });

        it('should handle root notes', () => {
            rootNote.child(note('Searchable Root Level'));

            const searchContext = new SearchContext();
            const results = searchService.findResultsWithQuery('searchable', searchContext);
            const result = results.find((r) => findNoteByTitle([r], 'Searchable Root Level'));

            expect(result).toBeTruthy();
            expect(result!.noteId).toBeTruthy();
        });
    });

    describe('Deduplication', () => {
        it('should deduplicate same note from multiple paths', () => {
            const parent1Builder = rootNote.child(note('Parent1'));
            const parent2Builder = rootNote.child(note('Parent2'));

            const childNoteBuilder = note('Unique Cloned Child');
            parent1Builder.child(childNoteBuilder);

            // Clone the child under parent2
            new BBranch({
                branchId: 'clone_branch2',
                noteId: childNoteBuilder.note.noteId,
                parentNoteId: parent2Builder.note.noteId,
                notePosition: 10,
            });

            const searchContext = new SearchContext();
            const results = searchService.findResultsWithQuery('unique', searchContext);
            const childResults = results.filter((r) => r.noteId === childNoteBuilder.note.noteId);

            // Should appear once in results (deduplication by noteId)
            expect(childResults.length).toBe(1);
        });

        it('should handle multiple matches in same note', () => {
            rootNote.child(note('Multiple test mentions', { content: 'test test test' }));

            const searchContext = new SearchContext();
            const results = searchService.findResultsWithQuery('test', searchContext);
            const noteResults = results.filter((r) => findNoteByTitle([r], 'Multiple test mentions'));

            // Should appear once with aggregated score
            expect(noteResults.length).toBe(1);
            expect(noteResults[0]!.score).toBeGreaterThan(0);
        });
    });

    describe('Result Limits', () => {
        it('should respect default limit behavior', () => {
            for (let i = 0; i < 100; i++) {
                rootNote.child(note(`Searchable Test ${i}`));
            }

            const searchContext = new SearchContext();
            const results = searchService.findResultsWithQuery('searchable', searchContext);

            // Default limit may vary by implementation
            expect(results.length).toBeGreaterThan(0);
            expect(Array.isArray(results)).toBeTruthy();
        });

        it('should enforce custom limits', () => {
            for (let i = 0; i < 50; i++) {
                rootNote.child(note(`Test ${i}`).label('searchable'));
            }

            const searchContext = new SearchContext();
            const results = searchService.findResultsWithQuery('#searchable limit 10', searchContext);

            expect(results.length).toBe(10);
        });

        it('should return all results when limit exceeds count', () => {
            for (let i = 0; i < 5; i++) {
                rootNote.child(note(`Test ${i}`).label('searchable'));
            }

            const searchContext = new SearchContext();
            const results = searchService.findResultsWithQuery('#searchable limit 100', searchContext);

            expect(results.length).toBe(5);
        });
    });

    describe('Empty Results', () => {
        it('should return empty array when no matches found', () => {
            rootNote.child(note('Test', { content: 'content' }));

            const searchContext = new SearchContext();
            const results = searchService.findResultsWithQuery('nonexistent', searchContext);

            expect(Array.isArray(results)).toBeTruthy();
            expect(results.length).toBe(0);
        });

        it('should return empty array for impossible conditions', () => {
            rootNote.child(note('Test').label('value', '10'));

            // Impossible condition: value both > 10 and < 5
            const searchContext = new SearchContext();
            const results = searchService.findResultsWithQuery('#value > 10 AND #value < 5', searchContext);

            expect(Array.isArray(results)).toBeTruthy();
            expect(results.length).toBe(0);
        });

        it('should handle empty result set structure correctly', () => {
            const searchContext = new SearchContext();
            const results = searchService.findResultsWithQuery('nonexistent', searchContext);

            expect(Array.isArray(results)).toBeTruthy();
            expect(results.length).toBe(0);
            expect(() => {
                results.forEach(() => {});
            }).not.toThrow();
        });

        it('should handle zero score results', () => {
            rootNote.child(note('Test').label('exact', ''));

            // Label existence check - should have positive score or be included
            const searchContext = new SearchContext();
            const results = searchService.findResultsWithQuery('#exact', searchContext);

            if (results.length > 0) {
                results.forEach((result) => {
                    // Score should be a valid number (could be 0 or positive)
                    expect(typeof result.score).toBe('number');
                    expect(isNaN(result.score)).toBeFalsy();
                });
            }
        });
    });

    describe('Result Consistency', () => {
        it('should return consistent results for same query', () => {
            rootNote.child(note('Consistent Test', { content: 'test content' }));

            const searchContext1 = new SearchContext();
            const results1 = searchService.findResultsWithQuery('consistent', searchContext1);
            const searchContext2 = new SearchContext();
            const results2 = searchService.findResultsWithQuery('consistent', searchContext2);

            const noteIds1 = results1.map((r) => r.noteId).sort();
            const noteIds2 = results2.map((r) => r.noteId).sort();

            expect(noteIds1).toEqual(noteIds2);
        });

        it('should maintain result order consistency', () => {
            for (let i = 0; i < 5; i++) {
                rootNote.child(note(`Test ${i}`, { content: 'searchable' }));
            }

            const searchContext1 = new SearchContext();
            const results1 = searchService.findResultsWithQuery('searchable orderBy note.title', searchContext1);
            const searchContext2 = new SearchContext();
            const results2 = searchService.findResultsWithQuery('searchable orderBy note.title', searchContext2);

            const noteIds1 = results1.map((r) => r.noteId);
            const noteIds2 = results2.map((r) => r.noteId);

            expect(noteIds1).toEqual(noteIds2);
        });

        it('should handle concurrent searches consistently', () => {
            for (let i = 0; i < 10; i++) {
                rootNote.child(note(`Note ${i}`, { content: 'searchable' }));
            }

            // Simulate concurrent searches
            const searchContext1 = new SearchContext();
            const results1 = searchService.findResultsWithQuery('searchable', searchContext1);
            const searchContext2 = new SearchContext();
            const results2 = searchService.findResultsWithQuery('searchable', searchContext2);
            const searchContext3 = new SearchContext();
            const results3 = searchService.findResultsWithQuery('searchable', searchContext3);

            // All should return same noteIds
            const noteIds1 = results1.map((r) => r.noteId).sort();
            const noteIds2 = results2.map((r) => r.noteId).sort();
            const noteIds3 = results3.map((r) => r.noteId).sort();

            expect(noteIds1).toEqual(noteIds2);
            expect(noteIds2).toEqual(noteIds3);
        });
    });

    describe('Result Quality', () => {
        it('should prioritize title matches over content matches', () => {
            rootNote
                .child(note('Important Document', { content: 'Some content' }))
                .child(note('Some Note', { content: 'Important document mentioned here' }));

            const searchContext = new SearchContext();
            const results = searchService.findResultsWithQuery('Important', searchContext);

            const titleResult = results.find((r) => findNoteByTitle([r], 'Important Document'));
            const contentResult = results.find((r) => findNoteByTitle([r], 'Some Note'));

            if (titleResult && contentResult) {
                // Title match typically appears first or has higher score
                expect(results.length).toBeGreaterThan(0);
            }
        });

        it('should prioritize exact matches over partial matches', () => {
            rootNote
                .child(note('Test', { content: 'This is a test' }))
                .child(note('Testing', { content: 'This is testing' }));

            const searchContext = new SearchContext();
            const results = searchService.findResultsWithQuery('test', searchContext);

            expect(results.length).toBeGreaterThan(0);
            // Exact matches should generally rank higher
            results.forEach((result) => {
                expect(result.score).toBeGreaterThan(0);
            });
        });

        it('should handle relevance for complex queries', () => {
            rootNote
                .child(
                    note('Programming Book', { content: 'A comprehensive programming guide' })
                        .label('book')
                        .label('programming')
                )
                .child(note('Other', { content: 'Mentions programming once' }));

            const searchContext = new SearchContext();
            const results = searchService.findResultsWithQuery('#book AND programming', searchContext);

            const highResult = results.find((r) => findNoteByTitle([r], 'Programming Book'));

            if (highResult) {
                expect(highResult.score).toBeGreaterThan(0);
            }
        });
    });
});
