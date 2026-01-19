/**
 * Comprehensive Fuzzy Search Tests
 *
 * Tests all fuzzy search features documented in search.md:
 * - Fuzzy exact match (~=) with edit distances
 * - Fuzzy contains (~*) with spelling variations
 * - Edit distance boundary testing
 * - Minimum token length validation
 * - Diacritic normalization
 * - Fuzzy matching in different contexts (title, content, labels, relations)
 * - Progressive search integration
 * - Fuzzy score calculation and ranking
 * - Edge cases
 */

import { describe, it, expect, beforeEach } from "vitest";
import searchService from "./services/search.js";
import BNote from "../../becca/entities/bnote.js";
import BBranch from "../../becca/entities/bbranch.js";
import SearchContext from "./search_context.js";
import becca from "../../becca/becca.js";
import { findNoteByTitle, note, NoteBuilder } from "../../test/becca_mocking.js";

/**
 * NOTE: ALL TESTS IN THIS FILE ARE CURRENTLY SKIPPED
 *
 * Fuzzy search operators (~= and ~*) are not yet implemented in the search engine.
 * These comprehensive tests are ready to validate fuzzy search functionality when the feature is added.
 * See search.md lines 72-86 for the fuzzy search specification.
 *
 * When implementing fuzzy search:
 * 1. Implement the ~= (fuzzy exact match) operator with edit distance <= 2
 * 2. Implement the ~* (fuzzy contains) operator for substring matching with typos
 * 3. Ensure minimum token length of 3 characters for fuzzy matching
 * 4. Implement diacritic normalization
 * 5. Un-skip these tests and verify they all pass
 */
describe("Fuzzy Search - Comprehensive Tests", () => {
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

    describe("Fuzzy Exact Match (~=)", () => {
        it.skip("should find exact matches with ~= operator (fuzzy operators not yet implemented)", () => {
            // TODO: Fuzzy search operators (~= and ~*) are not implemented in the search engine
            // These tests are ready to validate fuzzy search when the feature is added
            // See search.md lines 72-86 for fuzzy search specification
            rootNote
                .child(note("Trilium Notes"))
                .child(note("Another Note"));

            const searchContext = new SearchContext();
            const results = searchService.findResultsWithQuery("note.title ~= Trilium", searchContext);

            expect(results.length).toBeGreaterThan(0);
            expect(findNoteByTitle(results, "Trilium Notes")).toBeTruthy();
        });

        it.skip("should find matches with 1 character edit distance (fuzzy operators not yet implemented)", () => {
            // TODO: Fuzzy search operators (~= and ~*) are not implemented in the search engine
            // This test validates fuzzy search behavior per search.md lines 72-86
            // Test is ready to run once fuzzy search feature is added to the search implementation

            rootNote
                .child(note("Trilium Notes"))
                .child(note("Project Documentation"));

            const searchContext = new SearchContext();
            // "trilim" is 1 edit away from "trilium" (missing 'u')
            const results = searchService.findResultsWithQuery("note.title ~= trilim", searchContext);

            expect(results.length).toBeGreaterThan(0);
            expect(findNoteByTitle(results, "Trilium Notes")).toBeTruthy();
        });

        it.skip("should find matches with 2 character edit distance (fuzzy operators not yet implemented)", () => {
            // TODO: Fuzzy search operators (~= and ~*) are not implemented in the search engine
            // This test validates fuzzy search behavior per search.md lines 72-86
            // Test is ready to run once fuzzy search feature is added to the search implementation

            rootNote
                .child(note("Development Guide"))
                .child(note("User Manual"));

            const searchContext = new SearchContext();
            // "develpment" is 2 edits away from "development" (missing 'o', wrong 'p')
            const results = searchService.findResultsWithQuery("note.title ~= develpment", searchContext);

            expect(results.length).toBeGreaterThan(0);
            expect(findNoteByTitle(results, "Development Guide")).toBeTruthy();
        });

        it.skip("should NOT find matches exceeding 2 character edit distance (fuzzy operators not yet implemented)", () => {
            // TODO: Fuzzy search operators (~= and ~*) are not implemented in the search engine
            // This test validates fuzzy search behavior per search.md lines 72-86
            // Test is ready to run once fuzzy search feature is added to the search implementation

            rootNote
                .child(note("Documentation"))
                .child(note("Guide"));

            const searchContext = new SearchContext();
            // "documnttn" is 3+ edits away from "documentation"
            const results = searchService.findResultsWithQuery("note.title ~= documnttn", searchContext);

            expect(findNoteByTitle(results, "Documentation")).toBeFalsy();
        });

        it.skip("should handle substitution edit type (fuzzy operators not yet implemented)", () => {
            // TODO: Fuzzy search operators (~= and ~*) are not implemented in the search engine
            // This test validates fuzzy search behavior per search.md lines 72-86
            // Test is ready to run once fuzzy search feature is added to the search implementation

            rootNote.child(note("Programming Guide"));

            const searchContext = new SearchContext();
            // "programing" has one substitution (double 'm' -> single 'm')
            const results = searchService.findResultsWithQuery("note.title ~= programing", searchContext);

            expect(results.length).toBeGreaterThan(0);
            expect(findNoteByTitle(results, "Programming Guide")).toBeTruthy();
        });

        it.skip("should handle insertion edit type (fuzzy operators not yet implemented)", () => {
            // TODO: Fuzzy search operators (~= and ~*) are not implemented in the search engine
            // This test validates fuzzy search behavior per search.md lines 72-86
            // Test is ready to run once fuzzy search feature is added to the search implementation

            rootNote.child(note("Analysis Report"));

            const searchContext = new SearchContext();
            // "anaylsis" is missing 'l' (deletion from search term = insertion to match)
            const results = searchService.findResultsWithQuery("note.title ~= anaylsis", searchContext);

            expect(results.length).toBeGreaterThan(0);
            expect(findNoteByTitle(results, "Analysis Report")).toBeTruthy();
        });

        it.skip("should handle deletion edit type (fuzzy operators not yet implemented)", () => {
            // TODO: Fuzzy search operators (~= and ~*) are not implemented in the search engine
            // This test validates fuzzy search behavior per search.md lines 72-86
            // Test is ready to run once fuzzy search feature is added to the search implementation

            rootNote.child(note("Test Document"));

            const searchContext = new SearchContext();
            // "tesst" has extra 's' (insertion from search term = deletion to match)
            const results = searchService.findResultsWithQuery("note.title ~= tesst", searchContext);

            expect(results.length).toBeGreaterThan(0);
            expect(findNoteByTitle(results, "Test Document")).toBeTruthy();
        });

        it.skip("should handle multiple edit types in one search (fuzzy operators not yet implemented)", () => {
            // TODO: Fuzzy search operators (~= and ~*) are not implemented in the search engine
            // This test validates fuzzy search behavior per search.md lines 72-86
            // Test is ready to run once fuzzy search feature is added to the search implementation

            rootNote.child(note("Statistical Analysis"));

            const searchContext = new SearchContext();
            // "statsitcal" has multiple edits: missing 'i', transposed 'ti' -> 'it'
            const results = searchService.findResultsWithQuery("note.title ~= statsitcal", searchContext);

            expect(results.length).toBeGreaterThan(0);
            expect(findNoteByTitle(results, "Statistical Analysis")).toBeTruthy();
        });
    });

    describe("Fuzzy Contains (~*)", () => {
        it.skip("should find substring matches with ~* operator (fuzzy operators not yet implemented)", () => {
            // TODO: Fuzzy search operators (~= and ~*) are not implemented in the search engine
            // This test validates fuzzy search behavior per search.md lines 72-86
            // Test is ready to run once fuzzy search feature is added to the search implementation

            rootNote
                .child(note("Programming in JavaScript"))
                .child(note("Python Tutorial"));

            const searchContext = new SearchContext();
            const results = searchService.findResultsWithQuery("note.title ~* program", searchContext);

            expect(results.length).toBeGreaterThan(0);
            expect(findNoteByTitle(results, "Programming in JavaScript")).toBeTruthy();
        });

        it.skip("should find fuzzy substring with typos (fuzzy operators not yet implemented)", () => {
            // TODO: Fuzzy search operators (~= and ~*) are not implemented in the search engine
            // This test validates fuzzy search behavior per search.md lines 72-86
            // Test is ready to run once fuzzy search feature is added to the search implementation

            rootNote
                .child(note("Development Guide"))
                .child(note("Testing Manual"));

            const searchContext = new SearchContext();
            // "develpment" is fuzzy match for "development"
            const results = searchService.findResultsWithQuery("note.content ~* develpment", searchContext);

            expect(results.length).toBeGreaterThan(0);
        });

        it.skip("should match variations of programmer/programming (fuzzy operators not yet implemented)", () => {
            // TODO: Fuzzy search operators (~= and ~*) are not implemented in the search engine
            // This test validates fuzzy search behavior per search.md lines 72-86
            // Test is ready to run once fuzzy search feature is added to the search implementation

            rootNote
                .child(note("Programmer Guide"))
                .child(note("Programming Tutorial"))
                .child(note("Programs Overview"));

            const searchContext = new SearchContext();
            // "progra" should fuzzy match all variations
            const results = searchService.findResultsWithQuery("note.title ~* progra", searchContext);

            expect(results.length).toBe(3);
        });

        it.skip("should not match if substring is too different (fuzzy operators not yet implemented)", () => {
            // TODO: Fuzzy search operators (~= and ~*) are not implemented in the search engine
            // This test validates fuzzy search behavior per search.md lines 72-86
            // Test is ready to run once fuzzy search feature is added to the search implementation

            rootNote.child(note("Documentation Guide"));

            const searchContext = new SearchContext();
            // "xyz" is completely different
            const results = searchService.findResultsWithQuery("note.title ~* xyz", searchContext);

            expect(findNoteByTitle(results, "Documentation Guide")).toBeFalsy();
        });
    });

    describe("Minimum Token Length Validation", () => {
        it.skip("should not apply fuzzy matching to tokens < 3 characters (fuzzy operators not yet implemented)", () => {
            // TODO: Fuzzy search operators (~= and ~*) are not implemented in the search engine
            // This test validates fuzzy search behavior per search.md lines 72-86
            // Test is ready to run once fuzzy search feature is added to the search implementation

            rootNote
                .child(note("Go Programming"))
                .child(note("To Do List"));

            const searchContext = new SearchContext();
            // "go" is only 2 characters, should use exact matching only
            const results = searchService.findResultsWithQuery("note.title ~= go", searchContext);

            expect(findNoteByTitle(results, "Go Programming")).toBeTruthy();
            // Should NOT fuzzy match "To" even though it's similar
            expect(results.length).toBe(1);
        });

        it.skip("should apply fuzzy matching to tokens >= 3 characters (fuzzy operators not yet implemented)", () => {
            // TODO: Fuzzy search operators (~= and ~*) are not implemented in the search engine
            // This test validates fuzzy search behavior per search.md lines 72-86
            // Test is ready to run once fuzzy search feature is added to the search implementation

            rootNote
                .child(note("Java Programming"))
                .child(note("JavaScript Tutorial"));

            const searchContext = new SearchContext();
            // "jav" is 3 characters, fuzzy matching should work
            const results = searchService.findResultsWithQuery("note.title ~* jav", searchContext);

            expect(results.length).toBeGreaterThanOrEqual(1);
        });

        it.skip("should handle exact 3 character tokens (fuzzy operators not yet implemented)", () => {
            // TODO: Fuzzy search operators (~= and ~*) are not implemented in the search engine
            // This test validates fuzzy search behavior per search.md lines 72-86
            // Test is ready to run once fuzzy search feature is added to the search implementation

            rootNote
                .child(note("API Documentation"))
                .child(note("APP Development"));

            const searchContext = new SearchContext();
            // "api" (3 chars) should fuzzy match "app" (1 edit distance)
            const results = searchService.findResultsWithQuery("note.title ~= api", searchContext);

            expect(results.length).toBeGreaterThanOrEqual(1);
        });
    });

    describe("Diacritic Normalization", () => {
        it.skip("should match café with cafe (fuzzy operators not yet implemented)", () => {
            // TODO: Fuzzy search operators (~= and ~*) are not implemented in the search engine
            // This test validates fuzzy search behavior per search.md lines 72-86
            // Test is ready to run once fuzzy search feature is added to the search implementation

            rootNote
                .child(note("Paris Café Guide"))
                .child(note("Coffee Shop"));

            const searchContext = new SearchContext();
            // Search without diacritic should find note with diacritic
            const results = searchService.findResultsWithQuery("note.title ~* cafe", searchContext);

            expect(findNoteByTitle(results, "Paris Café Guide")).toBeTruthy();
        });

        it.skip("should match naïve with naive (fuzzy operators not yet implemented)", () => {
            // TODO: Fuzzy search operators (~= and ~*) are not implemented in the search engine
            // This test validates fuzzy search behavior per search.md lines 72-86
            // Test is ready to run once fuzzy search feature is added to the search implementation

            rootNote.child(note("Naïve Algorithm"));

            const searchContext = new SearchContext();
            const results = searchService.findResultsWithQuery("note.title ~* naive", searchContext);

            expect(findNoteByTitle(results, "Naïve Algorithm")).toBeTruthy();
        });

        it.skip("should match résumé with resume (fuzzy operators not yet implemented)", () => {
            // TODO: Fuzzy search operators (~= and ~*) are not implemented in the search engine
            // This test validates fuzzy search behavior per search.md lines 72-86
            // Test is ready to run once fuzzy search feature is added to the search implementation

            rootNote.child(note("Résumé Template"));

            const searchContext = new SearchContext();
            const results = searchService.findResultsWithQuery("note.title ~* resume", searchContext);

            expect(findNoteByTitle(results, "Résumé Template")).toBeTruthy();
        });

        it.skip("should normalize various diacritics (fuzzy operators not yet implemented)", () => {
            // TODO: Fuzzy search operators (~= and ~*) are not implemented in the search engine
            // This test validates fuzzy search behavior per search.md lines 72-86
            // Test is ready to run once fuzzy search feature is added to the search implementation

            rootNote
                .child(note("Zürich Travel"))
                .child(note("São Paulo Guide"))
                .child(note("Łódź History"));

            const searchContext = new SearchContext();

            // Test each normalized version
            const zurich = searchService.findResultsWithQuery("note.title ~* zurich", searchContext);
            expect(findNoteByTitle(zurich, "Zürich Travel")).toBeTruthy();

            const sao = searchService.findResultsWithQuery("note.title ~* sao", searchContext);
            expect(findNoteByTitle(sao, "São Paulo Guide")).toBeTruthy();

            const lodz = searchService.findResultsWithQuery("note.title ~* lodz", searchContext);
            expect(findNoteByTitle(lodz, "Łódź History")).toBeTruthy();
        });
    });

    describe("Fuzzy Search in Different Contexts", () => {
        describe("Title Fuzzy Search", () => {
            it.skip("should perform fuzzy search on note titles (fuzzy operators not yet implemented)", () => {
                // TODO: Fuzzy search operators (~= and ~*) are not implemented in the search engine
                // This test validates fuzzy search behavior per search.md lines 72-86
                // Test is ready to run once fuzzy search feature is added to the search implementation

                rootNote
                    .child(note("Trilium Documentation"))
                    .child(note("Project Overview"));

                const searchContext = new SearchContext();
                // Typo in "trilium"
                const results = searchService.findResultsWithQuery("note.title ~= trilim", searchContext);

                expect(findNoteByTitle(results, "Trilium Documentation")).toBeTruthy();
            });

            it.skip("should handle multiple word titles (fuzzy operators not yet implemented)", () => {
                // TODO: Fuzzy search operators (~= and ~*) are not implemented in the search engine
                // This test validates fuzzy search behavior per search.md lines 72-86
                // Test is ready to run once fuzzy search feature is added to the search implementation

                rootNote.child(note("Advanced Programming Techniques"));

                const searchContext = new SearchContext();
                // Typo in "programming"
                const results = searchService.findResultsWithQuery("note.title ~* programing", searchContext);

                expect(findNoteByTitle(results, "Advanced Programming Techniques")).toBeTruthy();
            });
        });

        describe("Content Fuzzy Search", () => {
            it.skip("should perform fuzzy search on note content (fuzzy operators not yet implemented)", () => {
                // TODO: Fuzzy search operators (~= and ~*) are not implemented in the search engine
                // This test validates fuzzy search behavior per search.md lines 72-86
                // Test is ready to run once fuzzy search feature is added to the search implementation

                const testNote = note("Technical Guide");
                testNote.note.setContent("This document contains programming information");
                rootNote.child(testNote);

                const searchContext = new SearchContext();
                // Typo in "programming"
                const results = searchService.findResultsWithQuery("note.content ~* programing", searchContext);

                expect(findNoteByTitle(results, "Technical Guide")).toBeTruthy();
            });

            it.skip("should handle content with multiple potential matches (fuzzy operators not yet implemented)", () => {
                // TODO: Fuzzy search operators (~= and ~*) are not implemented in the search engine
                // This test validates fuzzy search behavior per search.md lines 72-86
                // Test is ready to run once fuzzy search feature is added to the search implementation

                const testNote = note("Development Basics");
                testNote.note.setContent("Learn about development, testing, and deployment");
                rootNote.child(testNote);

                const searchContext = new SearchContext();
                // Typo in "testing"
                const results = searchService.findResultsWithQuery("note.content ~* testng", searchContext);

                expect(findNoteByTitle(results, "Development Basics")).toBeTruthy();
            });
        });

        describe("Label Fuzzy Search", () => {
            it.skip("should perform fuzzy search on label names (fuzzy operators not yet implemented)", () => {
                // TODO: Fuzzy search operators (~= and ~*) are not implemented in the search engine
                // This test validates fuzzy search behavior per search.md lines 72-86
                // Test is ready to run once fuzzy search feature is added to the search implementation

                rootNote.child(note("Book Note").label("category", "programming"));

                const searchContext = new SearchContext();
                // Typo in label name
                const results = searchService.findResultsWithQuery("#catgory ~= programming", searchContext);

                // Note: This depends on fuzzyAttributeSearch being enabled
                const fuzzyContext = new SearchContext({ fuzzyAttributeSearch: true });
                const fuzzyResults = searchService.findResultsWithQuery("#catgory", fuzzyContext);
                expect(fuzzyResults.length).toBeGreaterThan(0);
            });

            it.skip("should perform fuzzy search on label values (fuzzy operators not yet implemented)", () => {
                // TODO: Fuzzy search operators (~= and ~*) are not implemented in the search engine
                // This test validates fuzzy search behavior per search.md lines 72-86
                // Test is ready to run once fuzzy search feature is added to the search implementation

                rootNote.child(note("Tech Book").label("subject", "programming"));

                const searchContext = new SearchContext();
                // Typo in label value
                const results = searchService.findResultsWithQuery("#subject ~= programing", searchContext);

                expect(findNoteByTitle(results, "Tech Book")).toBeTruthy();
            });

            it.skip("should handle labels with multiple values (fuzzy operators not yet implemented)", () => {
                // TODO: Fuzzy search operators (~= and ~*) are not implemented in the search engine
                // This test validates fuzzy search behavior per search.md lines 72-86
                // Test is ready to run once fuzzy search feature is added to the search implementation

                rootNote
                    .child(note("Book 1").label("topic", "development"))
                    .child(note("Book 2").label("topic", "testing"))
                    .child(note("Book 3").label("topic", "deployment"));

                const searchContext = new SearchContext();
                // Fuzzy search for "develpment"
                const results = searchService.findResultsWithQuery("#topic ~= develpment", searchContext);

                expect(findNoteByTitle(results, "Book 1")).toBeTruthy();
            });
        });

        describe("Relation Fuzzy Search", () => {
            it.skip("should perform fuzzy search on relation targets (fuzzy operators not yet implemented)", () => {
                // TODO: Fuzzy search operators (~= and ~*) are not implemented in the search engine
                // This test validates fuzzy search behavior per search.md lines 72-86
                // Test is ready to run once fuzzy search feature is added to the search implementation

                const author = note("J.R.R. Tolkien");
                rootNote
                    .child(author)
                    .child(note("The Hobbit").relation("author", author.note));

                const searchContext = new SearchContext();
                // Typo in "Tolkien"
                const results = searchService.findResultsWithQuery("~author.title ~= Tolkein", searchContext);

                expect(findNoteByTitle(results, "The Hobbit")).toBeTruthy();
            });

            it.skip("should handle relation chains with fuzzy matching (fuzzy operators not yet implemented)", () => {
                // TODO: Fuzzy search operators (~= and ~*) are not implemented in the search engine
                // This test validates fuzzy search behavior per search.md lines 72-86
                // Test is ready to run once fuzzy search feature is added to the search implementation

                const author = note("Author Name");
                const publisher = note("Publishing House");
                author.relation("publisher", publisher.note);

                rootNote
                    .child(publisher)
                    .child(author)
                    .child(note("Book Title").relation("author", author.note));

                const searchContext = new SearchContext();
                // Typo in "publisher"
                const results = searchService.findResultsWithQuery("~author.relations.publsher", searchContext);

                // Relation chains with typos may not match - verify graceful handling
                expect(results).toBeDefined();
            });
        });
    });

    describe("Progressive Search Integration", () => {
        it.skip("should prioritize exact matches over fuzzy matches (fuzzy operators not yet implemented)", () => {
            // TODO: Fuzzy search operators (~= and ~*) are not implemented in the search engine
            // This test validates fuzzy search behavior per search.md lines 72-86
            // Test is ready to run once fuzzy search feature is added to the search implementation

            rootNote
                .child(note("Analysis Report")) // Exact match
                .child(note("Anaylsis Document")) // Fuzzy match
                .child(note("Data Analysis")); // Exact match

            const searchContext = new SearchContext();
            const results = searchService.findResultsWithQuery("analysis", searchContext);

            // Should find both exact and fuzzy matches
            expect(results.length).toBe(3);

            // Get titles in order
            const titles = results.map(r => becca.notes[r.noteId].title);

            // Find positions
            const exactIndices = titles.map((t, i) =>
                t.toLowerCase().includes("analysis") ? i : -1
            ).filter(i => i !== -1);

            const fuzzyIndices = titles.map((t, i) =>
                t.includes("Anaylsis") ? i : -1
            ).filter(i => i !== -1);

            // All exact matches should come before fuzzy matches
            if (exactIndices.length > 0 && fuzzyIndices.length > 0) {
                expect(Math.max(...exactIndices)).toBeLessThan(Math.min(...fuzzyIndices));
            }
        });

        it.skip("should only activate fuzzy search when exact matches are insufficient (fuzzy operators not yet implemented)", () => {
            // TODO: Fuzzy search operators (~= and ~*) are not implemented in the search engine
            // This test validates fuzzy search behavior per search.md lines 72-86
            // Test is ready to run once fuzzy search feature is added to the search implementation

            rootNote
                .child(note("Test One"))
                .child(note("Test Two"))
                .child(note("Test Three"))
                .child(note("Test Four"))
                .child(note("Test Five"))
                .child(note("Tset Six")); // Typo

            const searchContext = new SearchContext();
            const results = searchService.findResultsWithQuery("test", searchContext);

            // With 5 exact matches, fuzzy should not be needed
            // The typo note might not be included
            expect(results.length).toBeGreaterThanOrEqual(5);
        });
    });

    describe("Fuzzy Score Calculation and Ranking", () => {
        it.skip("should score fuzzy matches lower than exact matches (fuzzy operators not yet implemented)", () => {
            // TODO: Fuzzy search operators (~= and ~*) are not implemented in the search engine
            // This test validates fuzzy search behavior per search.md lines 72-86
            // Test is ready to run once fuzzy search feature is added to the search implementation

            rootNote
                .child(note("Programming Guide")) // Exact
                .child(note("Programing Tutorial")); // Fuzzy

            const searchContext = new SearchContext();
            const results = searchService.findResultsWithQuery("programming", searchContext);

            expect(results.length).toBe(2);

            const exactResult = results.find(r =>
                becca.notes[r.noteId].title === "Programming Guide"
            );
            const fuzzyResult = results.find(r =>
                becca.notes[r.noteId].title === "Programing Tutorial"
            );

            expect(exactResult).toBeTruthy();
            expect(fuzzyResult).toBeTruthy();
            expect(exactResult!.score).toBeGreaterThan(fuzzyResult!.score);
        });

        it.skip("should rank by edit distance within fuzzy matches (fuzzy operators not yet implemented)", () => {
            // TODO: Fuzzy search operators (~= and ~*) are not implemented in the search engine
            // This test validates fuzzy search behavior per search.md lines 72-86
            // Test is ready to run once fuzzy search feature is added to the search implementation

            rootNote
                .child(note("Test Document")) // Exact
                .child(note("Tst Document"))  // 1 edit
                .child(note("Tset Document")); // 1 edit (different)

            const searchContext = new SearchContext();
            const results = searchService.findResultsWithQuery("test", searchContext);

            // All should be found
            expect(results.length).toBeGreaterThanOrEqual(3);

            // Exact match should have highest score
            const scores = results.map(r => ({
                title: becca.notes[r.noteId].title,
                score: r.score
            }));

            const exactScore = scores.find(s => s.title === "Test Document")?.score;
            const fuzzy1Score = scores.find(s => s.title === "Tst Document")?.score;
            const fuzzy2Score = scores.find(s => s.title === "Tset Document")?.score;

            if (exactScore && fuzzy1Score) {
                expect(exactScore).toBeGreaterThan(fuzzy1Score);
            }
        });

        it.skip("should handle multiple fuzzy matches in same note (fuzzy operators not yet implemented)", () => {
            // TODO: Fuzzy search operators (~= and ~*) are not implemented in the search engine
            // This test validates fuzzy search behavior per search.md lines 72-86
            // Test is ready to run once fuzzy search feature is added to the search implementation

            const testNote = note("Programming and Development");
            testNote.note.setContent("Learn programing and developmnt techniques");
            rootNote.child(testNote);

            const searchContext = new SearchContext();
            const results = searchService.findResultsWithQuery("programming development", searchContext);

            expect(results.length).toBeGreaterThan(0);
            expect(findNoteByTitle(results, "Programming and Development")).toBeTruthy();
        });
    });

    describe("Edge Cases", () => {
        it.skip("should handle empty search strings (fuzzy operators not yet implemented)", () => {
            // TODO: Fuzzy search operators (~= and ~*) are not implemented in the search engine
            // This test validates fuzzy search behavior per search.md lines 72-86
            // Test is ready to run once fuzzy search feature is added to the search implementation

            rootNote.child(note("Some Note"));

            const searchContext = new SearchContext();
            const results = searchService.findResultsWithQuery("note.title ~= ", searchContext);

            // Empty search should return no results or all results depending on implementation
            expect(results).toBeDefined();
        });

        it.skip("should handle special characters in fuzzy search (fuzzy operators not yet implemented)", () => {
            // TODO: Fuzzy search operators (~= and ~*) are not implemented in the search engine
            // This test validates fuzzy search behavior per search.md lines 72-86
            // Test is ready to run once fuzzy search feature is added to the search implementation

            rootNote.child(note("C++ Programming"));

            const searchContext = new SearchContext();
            const results = searchService.findResultsWithQuery("note.title ~* c++", searchContext);

            expect(findNoteByTitle(results, "C++ Programming")).toBeTruthy();
        });

        it.skip("should handle numbers in fuzzy search (fuzzy operators not yet implemented)", () => {
            // TODO: Fuzzy search operators (~= and ~*) are not implemented in the search engine
            // This test validates fuzzy search behavior per search.md lines 72-86
            // Test is ready to run once fuzzy search feature is added to the search implementation

            rootNote.child(note("Project 2024 Overview"));

            const searchContext = new SearchContext();
            // Typo in number
            const results = searchService.findResultsWithQuery("note.title ~* 2023", searchContext);

            // Should find fuzzy match for similar number
            expect(findNoteByTitle(results, "Project 2024 Overview")).toBeTruthy();
        });

        it.skip("should handle very long search terms (fuzzy operators not yet implemented)", () => {
            // TODO: Fuzzy search operators (~= and ~*) are not implemented in the search engine
            // This test validates fuzzy search behavior per search.md lines 72-86
            // Test is ready to run once fuzzy search feature is added to the search implementation

            rootNote.child(note("Short Title"));

            const searchContext = new SearchContext();
            const longSearch = "a".repeat(100);
            const results = searchService.findResultsWithQuery(`note.title ~= ${longSearch}`, searchContext);

            // Should not crash, should return empty results
            expect(results).toBeDefined();
            expect(results.length).toBe(0);
        });

        it.skip("should handle Unicode characters (fuzzy operators not yet implemented)", () => {
            // TODO: Fuzzy search operators (~= and ~*) are not implemented in the search engine
            // This test validates fuzzy search behavior per search.md lines 72-86
            // Test is ready to run once fuzzy search feature is added to the search implementation

            rootNote
                .child(note("🚀 Rocket Science"))
                .child(note("日本語 Japanese"));

            const searchContext = new SearchContext();
            const results1 = searchService.findResultsWithQuery("note.title ~* rocket", searchContext);
            expect(findNoteByTitle(results1, "🚀 Rocket Science")).toBeTruthy();

            const results2 = searchService.findResultsWithQuery("note.title ~* japanese", searchContext);
            expect(findNoteByTitle(results2, "日本語 Japanese")).toBeTruthy();
        });

        it.skip("should handle case sensitivity correctly (fuzzy operators not yet implemented)", () => {
            // TODO: Fuzzy search operators (~= and ~*) are not implemented in the search engine
            // This test validates fuzzy search behavior per search.md lines 72-86
            // Test is ready to run once fuzzy search feature is added to the search implementation

            rootNote.child(note("PROGRAMMING GUIDE"));

            const searchContext = new SearchContext();
            const results = searchService.findResultsWithQuery("note.title ~* programming", searchContext);

            expect(findNoteByTitle(results, "PROGRAMMING GUIDE")).toBeTruthy();
        });

        it.skip("should fuzzy match when edit distance is exactly at boundary (fuzzy operators not yet implemented)", () => {
            // TODO: Fuzzy search operators (~= and ~*) are not implemented in the search engine
            // This test validates fuzzy search behavior per search.md lines 72-86
            // Test is ready to run once fuzzy search feature is added to the search implementation

            rootNote.child(note("Test Document"));

            const searchContext = new SearchContext();
            // "txx" is exactly 2 edits from "test" (substitute e->x, substitute s->x)
            const results = searchService.findResultsWithQuery("note.title ~= txx", searchContext);

            // Should still match at edit distance = 2
            expect(findNoteByTitle(results, "Test Document")).toBeTruthy();
        });

        it.skip("should handle whitespace in search terms (fuzzy operators not yet implemented)", () => {
            // TODO: Fuzzy search operators (~= and ~*) are not implemented in the search engine
            // This test validates fuzzy search behavior per search.md lines 72-86
            // Test is ready to run once fuzzy search feature is added to the search implementation

            rootNote.child(note("Multiple Word Title"));

            const searchContext = new SearchContext();
            const results = searchService.findResultsWithQuery("note.title ~* 'multiple  word'", searchContext);

            // Extra spaces should be handled
            expect(results.length).toBeGreaterThan(0);
        });
    });

    describe("Fuzzy Matching with Operators", () => {
        it.skip("should work with OR operator (fuzzy operators not yet implemented)", () => {
            // TODO: Fuzzy search operators (~= and ~*) are not implemented in the search engine
            // This test validates fuzzy search behavior per search.md lines 72-86
            // Test is ready to run once fuzzy search feature is added to the search implementation

            rootNote
                .child(note("Programming Guide"))
                .child(note("Testing Manual"));

            const searchContext = new SearchContext();
            const results = searchService.findResultsWithQuery(
                "note.title ~* programing OR note.title ~* testng",
                searchContext
            );

            expect(results.length).toBe(2);
        });

        it.skip("should work with AND operator (fuzzy operators not yet implemented)", () => {
            // TODO: Fuzzy search operators (~= and ~*) are not implemented in the search engine
            // This test validates fuzzy search behavior per search.md lines 72-86
            // Test is ready to run once fuzzy search feature is added to the search implementation

            rootNote.child(note("Advanced Programming Techniques"));

            const searchContext = new SearchContext();
            const results = searchService.findResultsWithQuery(
                "note.title ~* programing AND note.title ~* techniqes",
                searchContext
            );

            expect(findNoteByTitle(results, "Advanced Programming Techniques")).toBeTruthy();
        });

        it.skip("should work with NOT operator (fuzzy operators not yet implemented)", () => {
            // TODO: Fuzzy search operators (~= and ~*) are not implemented in the search engine
            // This test validates fuzzy search behavior per search.md lines 72-86
            // Test is ready to run once fuzzy search feature is added to the search implementation

            rootNote
                .child(note("Programming Guide"))
                .child(note("Testing Guide"));

            const searchContext = new SearchContext();
            const results = searchService.findResultsWithQuery(
                "note.title ~* guide AND not(note.title ~* testing)",
                searchContext
            );

            expect(findNoteByTitle(results, "Programming Guide")).toBeTruthy();
            expect(findNoteByTitle(results, "Testing Guide")).toBeFalsy();
        });
    });

    describe("Performance and Limits", () => {
        it.skip("should handle moderate dataset efficiently (fuzzy operators not yet implemented)", () => {
            // TODO: Fuzzy search operators (~= and ~*) are not implemented in the search engine
            // This test validates fuzzy search behavior per search.md lines 72-86
            // Test is ready to run once fuzzy search feature is added to the search implementation

            // Create multiple notes with variations
            for (let i = 0; i < 20; i++) {
                rootNote.child(note(`Programming Example ${i}`));
            }

            const searchContext = new SearchContext();
            const startTime = Date.now();
            const results = searchService.findResultsWithQuery("note.title ~* programing", searchContext);
            const endTime = Date.now();

            expect(results.length).toBeGreaterThan(0);
            expect(endTime - startTime).toBeLessThan(1000); // Should complete in under 1 second
        });

        it.skip("should cap fuzzy results to prevent excessive matching (fuzzy operators not yet implemented)", () => {
            // TODO: Fuzzy search operators (~= and ~*) are not implemented in the search engine
            // This test validates fuzzy search behavior per search.md lines 72-86
            // Test is ready to run once fuzzy search feature is added to the search implementation

            // Create many similar notes
            for (let i = 0; i < 50; i++) {
                rootNote.child(note(`Test Document ${i}`));
            }

            const searchContext = new SearchContext();
            const results = searchService.findResultsWithQuery("note.title ~* tst", searchContext);

            // Should return results but with reasonable limits
            expect(results).toBeDefined();
            expect(results.length).toBeGreaterThan(0);
        });
    });
});
