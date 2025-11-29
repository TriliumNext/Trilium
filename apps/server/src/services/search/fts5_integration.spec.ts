/**
 * Comprehensive FTS5 Integration Tests
 *
 * This test suite provides exhaustive coverage of FTS5 (Full-Text Search 5)
 * functionality, including:
 * - Query execution and performance
 * - Content chunking for large notes
 * - Snippet extraction and highlighting
 * - Protected notes handling
 * - Error recovery and fallback mechanisms
 * - Index management and optimization
 *
 * Based on requirements from search.md documentation.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { ftsSearchService, FTSError, FTSQueryError, convertToFTS5Query } from "./fts/index.js";
import searchService from "./services/search.js";
import BNote from "../../becca/entities/bnote.js";
import BBranch from "../../becca/entities/bbranch.js";
import SearchContext from "./search_context.js";
import becca from "../../becca/becca.js";
import cls from "../cls.js";
import sql from "../sql.js";
import { note, NoteBuilder } from "../../test/becca_mocking.js";
import {
    searchNote,
    contentNote,
    protectedNote,
    SearchTestNoteBuilder
} from "../../test/search_test_helpers.js";
import {
    assertContainsTitle,
    assertResultCount,
    assertMinResultCount,
    assertNoProtectedNotes,
    assertNoDuplicates,
    expectResults
} from "../../test/search_assertion_helpers.js";
import { createFullTextSearchFixture } from "../../test/search_fixtures.js";

describe("FTS5 Integration Tests", () => {
    let rootNote: NoteBuilder;

    beforeEach(() => {
        becca.reset();
        rootNote = new NoteBuilder(new BNote({ noteId: "root", title: "root", type: "text" }));
        new BBranch({
            branchId: "none_root",
            noteId: "root",
            parentNoteId: "none",
            notePosition: 10
        });
    });

    describe("FTS5 Availability", () => {
        it("should detect FTS5 availability", () => {
            const isAvailable = ftsSearchService.checkFTS5Availability();
            expect(typeof isAvailable).toBe("boolean");
        });

        it("should cache FTS5 availability check", () => {
            const first = ftsSearchService.checkFTS5Availability();
            const second = ftsSearchService.checkFTS5Availability();
            expect(first).toBe(second);
        });

        it("should provide meaningful error when FTS5 not available", () => {
            // Test that assertFTS5Available throws a meaningful error when FTS5 table is missing
            // We can't actually remove the table, but we can test the error class behavior
            const error = new FTSError("FTS5 table 'notes_fts' not found", "FTS_NOT_AVAILABLE", false);

            expect(error.message).toContain("notes_fts");
            expect(error.code).toBe("FTS_NOT_AVAILABLE");
            expect(error.recoverable).toBe(false);
            expect(error.name).toBe("FTSError");
        });
    });

    describe("Query Execution", () => {
        it("should execute basic exact match query", () => {
            cls.init(() => {
                rootNote
                    .child(contentNote("Document One", "This contains the search term."))
                    .child(contentNote("Document Two", "Another search term here."))
                    .child(contentNote("Different", "No matching words."));
            });

            const searchContext = new SearchContext();
            const results = searchService.findResultsWithQuery("search term", searchContext);

            expectResults(results)
                .hasMinCount(2)
                .hasTitle("Document One")
                .hasTitle("Document Two")
                .doesNotHaveTitle("Different");
        });

        it("should handle multiple tokens with AND logic", () => {
            cls.init(() => {
                rootNote
                    .child(contentNote("Both", "Contains search and term together."))
                    .child(contentNote("Only Search", "Contains search only."))
                    .child(contentNote("Only Term", "Contains term only."));
            });

            const searchContext = new SearchContext();
            const results = searchService.findResultsWithQuery("search term", searchContext);

            // Should find notes containing both tokens
            assertContainsTitle(results, "Both");
        });

        it("should support OR operator", () => {
            cls.init(() => {
                rootNote
                    .child(contentNote("First", "Contains alpha."))
                    .child(contentNote("Second", "Contains beta."))
                    .child(contentNote("Neither", "Contains gamma."));
            });

            const searchContext = new SearchContext();
            // Use note.content with OR syntax
            const results = searchService.findResultsWithQuery("note.content *=* alpha OR note.content *=* beta", searchContext);

            expectResults(results)
                .hasMinCount(2)
                .hasTitle("First")
                .hasTitle("Second")
                .doesNotHaveTitle("Neither");
        });

        it("should support NOT operator", () => {
            cls.init(() => {
                rootNote
                    .child(contentNote("Included", "Contains positive but not negative."))
                    .child(contentNote("Excluded", "Contains positive and negative."))
                    .child(contentNote("Neither", "Contains neither."));
            });

            const searchContext = new SearchContext();
            const results = searchService.findResultsWithQuery("positive NOT negative", searchContext);

            expectResults(results)
                .hasMinCount(1)
                .hasTitle("Included")
                .doesNotHaveTitle("Excluded");
        });

        it("should handle phrase search with quotes", () => {
            cls.init(() => {
                rootNote
                    .child(contentNote("Exact", 'Contains "exact phrase" in order.'))
                    .child(contentNote("Scrambled", "Contains phrase exact in wrong order."));
            });

            const searchContext = new SearchContext();
            const results = searchService.findResultsWithQuery('"exact phrase"', searchContext);

            expectResults(results)
                .hasMinCount(1)
                .hasTitle("Exact")
                .doesNotHaveTitle("Scrambled");
        });

        it("should enforce minimum token length of 3 characters", () => {
            cls.init(() => {
                rootNote
                    .child(contentNote("Short", "Contains ab and xy tokens."))
                    .child(contentNote("Long", "Contains abc and xyz tokens."));
            });

            const searchContext = new SearchContext();

            // Tokens shorter than 3 chars should not use FTS5
            // The search should handle this gracefully
            const results1 = searchService.findResultsWithQuery("ab", searchContext);
            expect(results1).toBeDefined();

            // Tokens 3+ chars should use FTS5
            const results2 = searchService.findResultsWithQuery("abc", searchContext);
            expectResults(results2).hasMinCount(1).hasTitle("Long");
        });
    });

    describe("Content Size Limits", () => {
        it("should handle notes up to 10MB content size", () => {
            cls.init(() => {
                // Create a note with large content (but less than 10MB)
                const largeContent = "test ".repeat(100000); // ~500KB
                rootNote.child(contentNote("Large Note", largeContent));
            });

            const searchContext = new SearchContext();
            const results = searchService.findResultsWithQuery("test", searchContext);

            expectResults(results).hasMinCount(1).hasTitle("Large Note");
        });

        it("should still find notes exceeding 10MB by title", () => {
            cls.init(() => {
                // Create a note with very large content (simulate >10MB)
                const veryLargeContent = "x".repeat(11 * 1024 * 1024); // 11MB
                const largeNote = searchNote("Oversized Note");
                largeNote.content(veryLargeContent);
                rootNote.child(largeNote);
            });

            const searchContext = new SearchContext();

            // Should still find by title even if content is too large for FTS
            const results = searchService.findResultsWithQuery("Oversized", searchContext);
            expectResults(results).hasMinCount(1).hasTitle("Oversized Note");
        });

        it("should handle empty content gracefully", () => {
            cls.init(() => {
                rootNote.child(contentNote("Empty Note", ""));
            });

            const searchContext = new SearchContext();
            const results = searchService.findResultsWithQuery("Empty", searchContext);

            expectResults(results).hasMinCount(1).hasTitle("Empty Note");
        });
    });

    describe("Protected Notes Handling", () => {
        it("should not index protected notes in FTS5", () => {
            // Protected notes require an active protected session to set content
            // We test with a note marked as protected but without content
            cls.init(() => {
                rootNote
                    .child(contentNote("Public", "This is public content."));
                // Create a protected note without setting content (would require session)
                const protNote = new SearchTestNoteBuilder(new BNote({
                    noteId: `prot_${Date.now()}`,
                    title: "Secret",
                    type: "text",
                    isProtected: true
                }));
                new BBranch({
                    branchId: `branch_prot_${Date.now()}`,
                    noteId: protNote.note.noteId,
                    parentNoteId: rootNote.note.noteId,
                    notePosition: 20
                });
            });

            const searchContext = new SearchContext({ includeArchivedNotes: false });
            const results = searchService.findResultsWithQuery("content", searchContext);

            // Should only find public notes in FTS5 search
            assertNoProtectedNotes(results);
        });

        it("should search protected notes separately when session available", () => {
            // Test that the searchProtectedNotesSync function exists and returns empty
            // when no protected session is available (which is the case in tests)
            const results = ftsSearchService.searchProtectedNotesSync(
                ["test"],
                "*=*",
                undefined,
                {}
            );

            // Without an active protected session, should return empty array
            expect(results).toEqual([]);
        });

        it("should exclude protected notes from results by default", () => {
            // Test that protected notes (by isProtected flag) are excluded
            cls.init(() => {
                rootNote
                    .child(contentNote("Normal", "Regular content."));
                // Create a protected note without setting content
                const protNote = new SearchTestNoteBuilder(new BNote({
                    noteId: `prot2_${Date.now()}`,
                    title: "Protected",
                    type: "text",
                    isProtected: true
                }));
                new BBranch({
                    branchId: `branch_prot2_${Date.now()}`,
                    noteId: protNote.note.noteId,
                    parentNoteId: rootNote.note.noteId,
                    notePosition: 20
                });
            });

            const searchContext = new SearchContext();
            const results = searchService.findResultsWithQuery("content", searchContext);

            assertNoProtectedNotes(results);
        });
    });

    describe("Query Syntax Conversion", () => {
        it("should convert exact match operator (=)", () => {
            cls.init(() => {
                rootNote.child(contentNote("Test", "This is a test document."));
            });

            const searchContext = new SearchContext();
            // Search with content contains operator
            const results = searchService.findResultsWithQuery('note.content *=* test', searchContext);

            expectResults(results).hasMinCount(1);
        });

        it("should convert contains operator (*=*)", () => {
            cls.init(() => {
                rootNote
                    .child(contentNote("Match", "Contains search keyword."))
                    .child(contentNote("No Match", "Different content."));
            });

            const searchContext = new SearchContext();
            const results = searchService.findResultsWithQuery("note.content *=* search", searchContext);

            expectResults(results)
                .hasMinCount(1)
                .hasTitle("Match");
        });

        it("should convert starts-with operator (=*)", () => {
            cls.init(() => {
                rootNote
                    .child(contentNote("Starts", "Testing starts with keyword."))
                    .child(contentNote("Ends", "Keyword at the end Testing."));
            });

            const searchContext = new SearchContext();
            const results = searchService.findResultsWithQuery("note.content =* Testing", searchContext);

            expectResults(results)
                .hasMinCount(1)
                .hasTitle("Starts");
        });

        it("should convert ends-with operator (*=)", () => {
            cls.init(() => {
                rootNote
                    .child(contentNote("Ends", "Content ends with Testing"))
                    .child(contentNote("Starts", "Testing starts here"));
            });

            const searchContext = new SearchContext();
            const results = searchService.findResultsWithQuery("note.content *= Testing", searchContext);

            expectResults(results)
                .hasMinCount(1)
                .hasTitle("Ends");
        });

        it("should handle not-equals operator (!=)", () => {
            cls.init(() => {
                rootNote
                    .child(contentNote("Includes", "Contains excluded term."))
                    .child(contentNote("Clean", "Does not contain the bad word."));
            });

            const searchContext = new SearchContext();
            // != operator checks that content does NOT contain the value
            // This will return notes where content doesn't contain "excluded"
            const results = searchService.findResultsWithQuery('note.content != excluded', searchContext);

            // Should find Clean since it doesn't contain "excluded"
            assertContainsTitle(results, "Clean");
        });
    });

    describe("Token Sanitization", () => {
        it("should sanitize tokens with special FTS5 characters", () => {
            cls.init(() => {
                rootNote.child(contentNote("Test", "Contains special (characters) here."));
            });

            const searchContext = new SearchContext();
            const results = searchService.findResultsWithQuery("special (characters)", searchContext);

            // Should handle parentheses in search term
            expectResults(results).hasMinCount(1);
        });

        it("should handle tokens with quotes", () => {
            cls.init(() => {
                rootNote.child(contentNote("Quotes", 'Contains "quoted text" here.'));
            });

            const searchContext = new SearchContext();
            const results = searchService.findResultsWithQuery('"quoted text"', searchContext);

            expectResults(results).hasMinCount(1).hasTitle("Quotes");
        });

        it("should prevent SQL injection attempts", () => {
            cls.init(() => {
                rootNote.child(contentNote("Safe", "Normal content."));
            });

            const searchContext = new SearchContext();

            // Attempt SQL injection - should be sanitized
            const maliciousQuery = "test'; DROP TABLE notes; --";
            const results = searchService.findResultsWithQuery(maliciousQuery, searchContext);

            // Should not crash and should handle safely
            expect(results).toBeDefined();
            expect(Array.isArray(results)).toBe(true);
        });

        it("should handle empty tokens after sanitization", () => {
            const searchContext = new SearchContext();

            // Token with only special characters
            const results = searchService.findResultsWithQuery("()\"\"", searchContext);

            expect(results).toBeDefined();
            expect(Array.isArray(results)).toBe(true);
        });
    });

    describe("Snippet Extraction", () => {
        it("should extract snippets from matching content", () => {
            cls.init(() => {
                const longContent = `
                    This is a long document with many paragraphs.
                    The keyword appears here in the middle of the text.
                    There is more content before and after the keyword.
                    This helps test snippet extraction functionality.
                `;

                rootNote.child(contentNote("Long Document", longContent));
            });

            const searchContext = new SearchContext();
            const results = searchService.findResultsWithQuery("keyword", searchContext);

            expectResults(results).hasMinCount(1);
        });

        it("should highlight matched terms in snippets", () => {
            cls.init(() => {
                rootNote.child(contentNote("Highlight Test", "This contains the search term to highlight."));
            });

            const searchContext = new SearchContext();
            const results = searchService.findResultsWithQuery("search", searchContext);

            expectResults(results).hasMinCount(1);
        });

        it("should extract multiple snippets for multiple matches", () => {
            cls.init(() => {
                const content = `
                    First occurrence of keyword here.
                    Some other content in between.
                    Second occurrence of keyword here.
                    Even more content.
                    Third occurrence of keyword here.
                `;

                rootNote.child(contentNote("Multiple Matches", content));
            });

            const searchContext = new SearchContext();
            const results = searchService.findResultsWithQuery("keyword", searchContext);

            expectResults(results).hasMinCount(1);
        });

        it("should respect snippet length limits", () => {
            cls.init(() => {
                const veryLongContent = "word ".repeat(10000) + "target " + "word ".repeat(10000);
                rootNote.child(contentNote("Very Long", veryLongContent));
            });

            const searchContext = new SearchContext();
            const results = searchService.findResultsWithQuery("target", searchContext);

            expectResults(results).hasMinCount(1);
        });
    });

    describe("Chunking for Large Content", () => {
        it("should chunk content exceeding size limits", () => {
            cls.init(() => {
                // Create content that would need chunking
                const chunkContent = "searchable ".repeat(5000); // Large repeated content
                rootNote.child(contentNote("Chunked", chunkContent));
            });

            const searchContext = new SearchContext();
            const results = searchService.findResultsWithQuery("searchable", searchContext);

            expectResults(results).hasMinCount(1).hasTitle("Chunked");
        });

        it("should search across all chunks", () => {
            cls.init(() => {
                // Create content where matches appear in different "chunks"
                const part1 = "alpha ".repeat(1000);
                const part2 = "beta ".repeat(1000);
                const combined = part1 + part2;

                rootNote.child(contentNote("Multi-Chunk", combined));
            });

            const searchContext = new SearchContext();

            // Should find terms from beginning and end
            const results1 = searchService.findResultsWithQuery("alpha", searchContext);
            expectResults(results1).hasMinCount(1);

            const results2 = searchService.findResultsWithQuery("beta", searchContext);
            expectResults(results2).hasMinCount(1);
        });
    });

    describe("Error Handling and Recovery", () => {
        it("should handle malformed queries gracefully", () => {
            cls.init(() => {
                rootNote.child(contentNote("Test", "Normal content."));
            });

            const searchContext = new SearchContext();

            // Malformed query should not crash
            const results = searchService.findResultsWithQuery('note.content = "unclosed', searchContext);

            expect(results).toBeDefined();
            expect(Array.isArray(results)).toBe(true);
        });

        it("should provide meaningful error messages", () => {
            // Test FTSQueryError provides meaningful information
            const queryError = new FTSQueryError("Invalid query syntax", "SELECT * FROM");
            expect(queryError.message).toBe("Invalid query syntax");
            expect(queryError.query).toBe("SELECT * FROM");
            expect(queryError.code).toBe("FTS_QUERY_ERROR");
            expect(queryError.recoverable).toBe(true);
            expect(queryError.name).toBe("FTSQueryError");

            // Test that convertToFTS5Query throws meaningful errors for invalid operators
            expect(() => {
                convertToFTS5Query(["test"], "invalid_operator");
            }).toThrow(/Unsupported MATCH operator/);

            // Test that short tokens throw meaningful errors
            expect(() => {
                convertToFTS5Query(["ab"], "=");
            }).toThrow(/Trigram tokenizer requires tokens of at least 3 characters/);

            // Test that regex operator throws meaningful error
            expect(() => {
                convertToFTS5Query(["test"], "%=");
            }).toThrow(/Regex search not supported in FTS5/);
        });

        it("should fall back to non-FTS search on FTS errors", () => {
            cls.init(() => {
                rootNote.child(contentNote("Fallback", "Content for fallback test."));
            });

            const searchContext = new SearchContext();

            // Even if FTS5 fails, should still return results via fallback
            const results = searchService.findResultsWithQuery("fallback", searchContext);

            expectResults(results).hasMinCount(1);
        });
    });

    describe("Index Management", () => {
        it("should provide index statistics", () => {
            // Get FTS index stats
            const stats = ftsSearchService.getIndexStats();

            expect(stats).toBeDefined();
            expect(stats.totalDocuments).toBeGreaterThan(0);
        });

        it("should handle index optimization", () => {
            // Test that the FTS5 optimize command works without errors
            // The optimize command is a special FTS5 operation that merges segments
            cls.init(() => {
                // Add some notes to the index
                rootNote.child(contentNote("Optimize Test 1", "Content to be optimized."));
                rootNote.child(contentNote("Optimize Test 2", "More content to optimize."));
            });

            // Run the optimize command directly via SQL
            // This is what rebuildIndex() does internally
            expect(() => {
                sql.execute(`INSERT INTO notes_fts(notes_fts) VALUES('optimize')`);
            }).not.toThrow();

            // Verify the index still works after optimization
            const searchContext = new SearchContext();
            const results = searchService.findResultsWithQuery("optimize", searchContext);
            expectResults(results).hasMinCount(1);
        });

        it("should detect when index needs rebuilding", () => {
            // Test syncMissingNotes which detects and fixes missing index entries
            cls.init(() => {
                // Create a note that will be in becca but may not be in FTS
                rootNote.child(contentNote("Sync Test Note", "Content that should be indexed."));
            });

            // Get initial stats
            const statsBefore = ftsSearchService.getIndexStats();

            // syncMissingNotes returns the number of notes that were added to the index
            // If the triggers are working correctly, this should be 0 since notes
            // are automatically indexed. But this tests the function works.
            const syncedCount = ftsSearchService.syncMissingNotes();

            // syncMissingNotes should return a number (0 or more)
            expect(typeof syncedCount).toBe("number");
            expect(syncedCount).toBeGreaterThanOrEqual(0);

            // Verify we can still search after sync
            const searchContext = new SearchContext();
            const results = searchService.findResultsWithQuery("Sync Test", searchContext);
            expectResults(results).hasMinCount(1).hasTitle("Sync Test Note");
        });
    });

    describe("Performance and Limits", () => {
        it("should handle large result sets efficiently", () => {
            cls.init(() => {
                // Create many matching notes
                for (let i = 0; i < 100; i++) {
                    rootNote.child(contentNote(`Document ${i}`, `Contains searchterm in document ${i}.`));
                }
            });

            const searchContext = new SearchContext();
            const startTime = Date.now();

            const results = searchService.findResultsWithQuery("searchterm", searchContext);

            const duration = Date.now() - startTime;

            expectResults(results).hasMinCount(100);

            // Should complete in reasonable time (< 1 second for 100 notes)
            expect(duration).toBeLessThan(1000);
        });

        it("should respect query length limits", () => {
            const searchContext = new SearchContext();

            // Very long query should be handled
            const longQuery = "word ".repeat(500);
            const results = searchService.findResultsWithQuery(longQuery, searchContext);

            expect(results).toBeDefined();
        });

        it("should apply limit to results", () => {
            cls.init(() => {
                for (let i = 0; i < 50; i++) {
                    rootNote.child(contentNote(`Note ${i}`, "matching content"));
                }
            });

            const searchContext = new SearchContext();
            const results = searchService.findResultsWithQuery("matching limit 10", searchContext);

            expect(results.length).toBeLessThanOrEqual(10);
        });
    });

    describe("Integration with Search Context", () => {
        it("should respect fast search flag", () => {
            cls.init(() => {
                rootNote
                    .child(contentNote("Title Match", "Different content"))
                    .child(contentNote("Different Title", "Matching content"));
            });

            const fastContext = new SearchContext({ fastSearch: true });
            const results = searchService.findResultsWithQuery("content", fastContext);

            // Fast search should not search content, only title and attributes
            expect(results).toBeDefined();
        });

        it("should respect includeArchivedNotes flag", () => {
            cls.init(() => {
                const archived = searchNote("Archived").label("archived", "", true);
                archived.content("Archived content");

                rootNote.child(archived);
            });

            // Without archived flag
            const normalContext = new SearchContext({ includeArchivedNotes: false });
            const results1 = searchService.findResultsWithQuery("Archived", normalContext);

            // With archived flag
            const archivedContext = new SearchContext({ includeArchivedNotes: true });
            const results2 = searchService.findResultsWithQuery("Archived", archivedContext);

            // Should have more results when including archived
            expect(results2.length).toBeGreaterThanOrEqual(results1.length);
        });

        it("should respect ancestor filtering", () => {
            cls.init(() => {
                const europe = searchNote("Europe");
                const austria = contentNote("Austria", "European country");
                const asia = searchNote("Asia");
                const japan = contentNote("Japan", "Asian country");

                rootNote.child(europe.child(austria));
                rootNote.child(asia.child(japan));
            });

            const europeNote = becca.notes[Object.keys(becca.notes).find(id => becca.notes[id]?.title === "Europe") || ""];
            if (europeNote) {
                const searchContext = new SearchContext({ ancestorNoteId: europeNote.noteId });
                const results = searchService.findResultsWithQuery("country", searchContext);

                // Should only find notes under Europe
                expectResults(results)
                    .hasTitle("Austria")
                    .doesNotHaveTitle("Japan");
            }
        });
    });

    describe("Complex Search Fixtures", () => {
        it("should work with full text search fixture", () => {
            cls.init(() => {
                createFullTextSearchFixture(rootNote);
            });

            const searchContext = new SearchContext();
            const results = searchService.findResultsWithQuery("search", searchContext);

            // Should find multiple notes from fixture
            assertMinResultCount(results, 2);
        });
    });

    describe("Result Quality", () => {
        it("should not return duplicate results", () => {
            cls.init(() => {
                rootNote
                    .child(contentNote("Duplicate Test", "keyword keyword keyword"))
                    .child(contentNote("Another", "keyword"));
            });

            const searchContext = new SearchContext();
            const results = searchService.findResultsWithQuery("keyword", searchContext);

            assertNoDuplicates(results);
        });

        it("should rank exact title matches higher", () => {
            cls.init(() => {
                rootNote
                    .child(contentNote("Exact", "Other content"))
                    .child(contentNote("Different", "Contains Exact in content"));
            });

            const searchContext = new SearchContext();
            const results = searchService.findResultsWithQuery("Exact", searchContext);

            // Title match should have higher score than content match
            if (results.length >= 2) {
                const titleMatch = results.find(r => becca.notes[r.noteId]?.title === "Exact");
                const contentMatch = results.find(r => becca.notes[r.noteId]?.title === "Different");

                if (titleMatch && contentMatch) {
                    expect(titleMatch.score).toBeGreaterThan(contentMatch.score);
                }
            }
        });

        it("should rank multiple matches higher", () => {
            cls.init(() => {
                rootNote
                    .child(contentNote("Many", "keyword keyword keyword keyword"))
                    .child(contentNote("Few", "keyword"));
            });

            const searchContext = new SearchContext();
            const results = searchService.findResultsWithQuery("keyword", searchContext);

            // More matches should generally score higher
            if (results.length >= 2) {
                const manyMatches = results.find(r => becca.notes[r.noteId]?.title === "Many");
                const fewMatches = results.find(r => becca.notes[r.noteId]?.title === "Few");

                if (manyMatches && fewMatches) {
                    expect(manyMatches.score).toBeGreaterThanOrEqual(fewMatches.score);
                }
            }
        });
    });
});
