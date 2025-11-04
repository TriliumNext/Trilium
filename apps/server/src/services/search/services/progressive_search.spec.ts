import { describe, it, expect, beforeEach } from "vitest";
import searchService from "./search.js";
import BNote from "../../../becca/entities/bnote.js";
import BBranch from "../../../becca/entities/bbranch.js";
import SearchContext from "../search_context.js";
import becca from "../../../becca/becca.js";
import { findNoteByTitle, note, NoteBuilder } from "../../../test/becca_mocking.js";

describe("Progressive Search Strategy", () => {
    let rootNote: any;

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

    describe("Phase 1: Exact Matches Only", () => {
        it("should complete search with exact matches when sufficient results found", () => {
            // Create notes with exact matches
            rootNote
                .child(note("Document Analysis One"))
                .child(note("Document Report Two"))
                .child(note("Document Review Three"))
                .child(note("Document Summary Four"))
                .child(note("Document Overview Five"))
                .child(note("Documnt Analysis Six")); // This has a typo that should require fuzzy matching

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery("document", searchContext);

            // Should find 5 exact matches and not need fuzzy matching
            expect(searchResults.length).toEqual(5);
            
            // Verify all results have high scores (exact matches)
            const highQualityResults = searchResults.filter(result => result.score >= 10);
            expect(highQualityResults.length).toEqual(5);
            
            // The typo document should not be in results since we have enough exact matches
            expect(findNoteByTitle(searchResults, "Documnt Analysis Six")).toBeFalsy();
        });

        it("should use exact match scoring only in Phase 1", () => {
            rootNote
                .child(note("Testing Exact Match"))
                .child(note("Test Document"))
                .child(note("Another Test"));

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery("test", searchContext);

            // All results should have scores from exact matching only
            for (const result of searchResults) {
                expect(result.score).toBeGreaterThan(0);
                // Scores should be from exact/prefix/contains matches, not fuzzy
                expect(result.score % 0.5).not.toBe(0); // Fuzzy scores are multiples of 0.5
            }
        });
    });

    describe("Phase 2: Fuzzy Fallback", () => {
        it("should trigger fuzzy matching when insufficient exact matches", () => {
            // Create only a few notes, some with typos
            rootNote
                .child(note("Document One"))
                .child(note("Report Two"))
                .child(note("Anaylsis Three")) // Typo: "Analysis"
                .child(note("Sumary Four")); // Typo: "Summary"

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery("analysis", searchContext);

            // Should find the typo through fuzzy matching
            expect(searchResults.length).toBeGreaterThan(0);
            expect(findNoteByTitle(searchResults, "Anaylsis Three")).toBeTruthy();
        });

        it("should merge exact and fuzzy results with exact matches always ranked higher", () => {
            rootNote
                .child(note("Analysis Report")) // Exact match
                .child(note("Data Analysis")) // Exact match
                .child(note("Anaylsis Doc")) // Fuzzy match
                .child(note("Statistical Anlaysis")); // Fuzzy match

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery("analysis", searchContext);

            expect(searchResults.length).toBe(4);

            // Get the note titles in result order
            const resultTitles = searchResults.map(r => becca.notes[r.noteId].title);
            
            // Find positions of exact and fuzzy matches
            const exactPositions = resultTitles.map((title, index) => 
                title.toLowerCase().includes("analysis") ? index : -1
            ).filter(pos => pos !== -1);
            
            const fuzzyPositions = resultTitles.map((title, index) => 
                (title.includes("Anaylsis") || title.includes("Anlaysis")) ? index : -1
            ).filter(pos => pos !== -1);

            expect(exactPositions.length).toBe(2);
            expect(fuzzyPositions.length).toBe(2);

            // CRITICAL: All exact matches must come before all fuzzy matches
            const lastExactPosition = Math.max(...exactPositions);
            const firstFuzzyPosition = Math.min(...fuzzyPositions);
            
            expect(lastExactPosition).toBeLessThan(firstFuzzyPosition);
        });

        it("should not duplicate results between phases", () => {
            rootNote
                .child(note("Test Document")) // Would match in both phases
                .child(note("Tset Report")); // Only fuzzy match

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery("test", searchContext);

            // Should only have unique results
            const noteIds = searchResults.map(r => r.noteId);
            const uniqueNoteIds = [...new Set(noteIds)];
            
            expect(noteIds.length).toBe(uniqueNoteIds.length);
            expect(findNoteByTitle(searchResults, "Test Document")).toBeTruthy();
            expect(findNoteByTitle(searchResults, "Tset Report")).toBeTruthy();
        });
    });

    describe("Result Sufficiency Thresholds", () => {
        it("should respect minimum result count threshold", () => {
            // Create exactly 4 high-quality results (below threshold of 5)
            rootNote
                .child(note("Test One"))
                .child(note("Test Two"))
                .child(note("Test Three"))
                .child(note("Test Four"))
                .child(note("Tset Five")); // Typo that should be found via fuzzy

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery("test", searchContext);

            // Should proceed to Phase 2 and include fuzzy match
            expect(searchResults.length).toBe(5);
            expect(findNoteByTitle(searchResults, "Tset Five")).toBeTruthy();
        });

        it("should respect minimum quality score threshold", () => {
            // Create notes that might have low exact match scores
            rootNote
                .child(note("Testing Document")) // Should have decent score
                .child(note("Document with test inside")) // Lower score due to position
                .child(note("Another test case"))
                .child(note("Test case example"))
                .child(note("Tset with typo")); // Fuzzy match

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery("test", searchContext);

            // Should include fuzzy results if exact results don't meet quality threshold
            expect(searchResults.length).toBeGreaterThan(4);
        });
    });

    describe("Fuzzy Score Management", () => {
        it("should cap fuzzy token scores to prevent outranking exact matches", () => {
            // Create note with exact match
            rootNote.child(note("Test Document"));
            // Create note that could accumulate high fuzzy scores
            rootNote.child(note("Tset Documnt with many fuzzy tockens for testng")); // Multiple typos

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery("test document", searchContext);

            expect(searchResults.length).toBe(2);
            
            // Find the exact and fuzzy match results
            const exactResult = searchResults.find(r => becca.notes[r.noteId].title === "Test Document");
            const fuzzyResult = searchResults.find(r => becca.notes[r.noteId].title.includes("Tset"));

            expect(exactResult).toBeTruthy();
            expect(fuzzyResult).toBeTruthy();
            
            // Exact match should always score higher than fuzzy, even with multiple fuzzy matches
            expect(exactResult!.score).toBeGreaterThan(fuzzyResult!.score);
        });

        it("should enforce maximum total fuzzy score per search", () => {
            // Create note with many potential fuzzy matches
            rootNote.child(note("Tset Documnt Anaylsis Sumary Reportng")); // Many typos

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery("test document analysis summary reporting", searchContext);

            expect(searchResults.length).toBe(1);
            
            // Total score should be bounded despite many fuzzy matches
            expect(searchResults[0].score).toBeLessThan(500); // Should not exceed reasonable bounds due to caps
        });
    });

    describe("SearchContext Integration", () => {
        it("should respect enableFuzzyMatching flag", () => {
            rootNote
                .child(note("Test Document"))
                .child(note("Tset Report")); // Typo

            // Test with fuzzy matching disabled
            const exactOnlyContext = new SearchContext();
            exactOnlyContext.enableFuzzyMatching = false;
            
            const exactResults = searchService.findResultsWithQuery("test", exactOnlyContext);
            expect(exactResults.length).toBe(1);
            expect(findNoteByTitle(exactResults, "Test Document")).toBeTruthy();
            expect(findNoteByTitle(exactResults, "Tset Report")).toBeFalsy();

            // Test with fuzzy matching enabled (default)
            const fuzzyContext = new SearchContext();
            const fuzzyResults = searchService.findResultsWithQuery("test", fuzzyContext);
            expect(fuzzyResults.length).toBe(2);
            expect(findNoteByTitle(fuzzyResults, "Tset Report")).toBeTruthy();
        });
    });

    describe("Edge Cases", () => {
        it("should handle empty search results gracefully", () => {
            rootNote.child(note("Unrelated Content"));

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery("nonexistent", searchContext);

            expect(searchResults.length).toBe(0);
        });

        it("should handle single character queries", () => {
            rootNote
                .child(note("A Document"))
                .child(note("Another Note"));

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery("a", searchContext);

            expect(searchResults.length).toBeGreaterThan(0);
        });

        it("should handle very long queries", () => {
            const longQuery = "test ".repeat(50); // 250 characters
            rootNote.child(note("Test Document"));

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery(longQuery, searchContext);

            // Should handle gracefully without crashing
            expect(searchResults).toBeDefined();
        });

        it("should handle queries with special characters", () => {
            rootNote.child(note("Test-Document_2024"));

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery("test-document", searchContext);

            expect(searchResults.length).toBeGreaterThan(0);
        });
    });

    describe("Real Content Search Integration", () => {
        // Note: These tests require proper CLS (continuation-local-storage) context setup
        // which is complex in unit tests. They are skipped but document expected behavior.

        it.skip("should search within note content when available", () => {
            // TODO: Requires CLS context setup - implement in integration tests
            // Create notes with actual content
            const contentNote = note("Title Only");
            contentNote.note.setContent("This document contains searchable content text");
            rootNote.child(contentNote);

            rootNote.child(note("Another Note"));

            const searchContext = new SearchContext();
            searchContext.fastSearch = false; // Enable content search

            const searchResults = searchService.findResultsWithQuery("searchable content", searchContext);

            expect(searchResults.length).toBeGreaterThan(0);
            expect(findNoteByTitle(searchResults, "Title Only")).toBeTruthy();
        });

        it.skip("should handle large note content", () => {
            // TODO: Requires CLS context setup - implement in integration tests
            const largeContent = "Important data ".repeat(1000); // ~15KB content
            const contentNote = note("Large Document");
            contentNote.note.setContent(largeContent);
            rootNote.child(contentNote);

            const searchContext = new SearchContext();
            searchContext.fastSearch = false;

            const searchResults = searchService.findResultsWithQuery("important data", searchContext);

            expect(searchResults.length).toBeGreaterThan(0);
        });

        it.skip("should respect content size limits", () => {
            // TODO: Requires CLS context setup - implement in integration tests
            // Content over 10MB should be handled appropriately
            const hugeContent = "x".repeat(11 * 1024 * 1024); // 11MB
            const contentNote = note("Huge Document");
            contentNote.note.setContent(hugeContent);
            rootNote.child(contentNote);

            const searchContext = new SearchContext();
            searchContext.fastSearch = false;

            // Should not crash, even with oversized content
            const searchResults = searchService.findResultsWithQuery("test", searchContext);
            expect(searchResults).toBeDefined();
        });

        it.skip("should find content with fuzzy matching in Phase 2", () => {
            // TODO: Requires CLS context setup - implement in integration tests
            const contentNote = note("Article Title");
            contentNote.note.setContent("This contains improtant information"); // "important" typo
            rootNote.child(contentNote);

            const searchContext = new SearchContext();
            searchContext.fastSearch = false;

            const searchResults = searchService.findResultsWithQuery("important", searchContext);

            // Should find via fuzzy matching in Phase 2
            expect(searchResults.length).toBeGreaterThan(0);
            expect(findNoteByTitle(searchResults, "Article Title")).toBeTruthy();
        });
    });

    describe("Progressive Strategy with Attributes", () => {
        it("should combine attribute and content search in progressive strategy", () => {
            const labeledNote = note("Document One");
            labeledNote.label("important");
            // Note: Skipping content set due to CLS context requirement
            rootNote.child(labeledNote);

            rootNote.child(note("Document Two"));

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery("#important", searchContext);

            expect(searchResults.length).toBeGreaterThan(0);
            expect(findNoteByTitle(searchResults, "Document One")).toBeTruthy();
        });

        it("should handle complex queries with progressive search", () => {
            rootNote
                .child(note("Test Report").label("status", "draft"))
                .child(note("Test Analysis").label("status", "final"))
                .child(note("Tset Summary").label("status", "draft")); // Typo

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery("test #status=draft", searchContext);

            expect(searchResults.length).toBeGreaterThan(0);
            // Should find both exact "Test Report" and fuzzy "Tset Summary"
        });
    });

    describe("Performance Characteristics", () => {
        it("should complete Phase 1 quickly with sufficient results", () => {
            // Create many exact matches
            for (let i = 0; i < 20; i++) {
                rootNote.child(note(`Test Document ${i}`));
            }

            const searchContext = new SearchContext();
            const startTime = Date.now();

            const searchResults = searchService.findResultsWithQuery("test", searchContext);

            const duration = Date.now() - startTime;

            expect(searchResults.length).toBeGreaterThanOrEqual(5);
            expect(duration).toBeLessThan(1000); // Should be fast with exact matches
        });

        it("should complete both phases within reasonable time", () => {
            // Create few exact matches to trigger Phase 2
            rootNote
                .child(note("Test One"))
                .child(note("Test Two"))
                .child(note("Tset Three")) // Typo
                .child(note("Tset Four")); // Typo

            const searchContext = new SearchContext();
            const startTime = Date.now();

            const searchResults = searchService.findResultsWithQuery("test", searchContext);

            const duration = Date.now() - startTime;

            expect(searchResults.length).toBeGreaterThan(0);
            expect(duration).toBeLessThan(2000); // Should complete both phases reasonably fast
        });

        it("should handle dataset with mixed exact and fuzzy matches efficiently", () => {
            // Create a mix of exact and fuzzy matches
            for (let i = 0; i < 10; i++) {
                rootNote.child(note(`Document ${i}`));
            }
            for (let i = 0; i < 10; i++) {
                rootNote.child(note(`Documnt ${i}`)); // Typo
            }

            const searchContext = new SearchContext();
            const startTime = Date.now();

            const searchResults = searchService.findResultsWithQuery("document", searchContext);

            const duration = Date.now() - startTime;

            expect(searchResults.length).toBeGreaterThan(0);
            expect(duration).toBeLessThan(3000);
        });
    });

    describe("Result Quality Assessment", () => {
        it("should assign higher scores to exact matches than fuzzy matches", () => {
            rootNote
                .child(note("Analysis Report")) // Exact
                .child(note("Anaylsis Data")); // Fuzzy

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery("analysis", searchContext);

            const exactResult = searchResults.find(r => becca.notes[r.noteId].title === "Analysis Report");
            const fuzzyResult = searchResults.find(r => becca.notes[r.noteId].title === "Anaylsis Data");

            expect(exactResult).toBeTruthy();
            expect(fuzzyResult).toBeTruthy();
            expect(exactResult!.score).toBeGreaterThan(fuzzyResult!.score);
        });

        it("should maintain score consistency across phases", () => {
            // Create notes that will be found in different phases
            rootNote
                .child(note("Test Exact")) // Phase 1
                .child(note("Test Match")) // Phase 1
                .child(note("Tset Fuzzy")); // Phase 2

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery("test", searchContext);

            // All scores should be positive and ordered correctly
            for (let i = 0; i < searchResults.length - 1; i++) {
                expect(searchResults[i].score).toBeGreaterThanOrEqual(0);
                expect(searchResults[i].score).toBeGreaterThanOrEqual(searchResults[i + 1].score);
            }
        });

        it("should apply relevance scoring appropriately", () => {
            rootNote
                .child(note("Testing")) // Prefix match
                .child(note("A Testing Document")) // Contains match
                .child(note("Document about testing and more")); // Later position

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery("testing", searchContext);

            expect(searchResults.length).toBe(3);

            // First result should have highest score (prefix match)
            const titles = searchResults.map(r => becca.notes[r.noteId].title);
            expect(titles[0]).toBe("Testing");
        });
    });

    describe("Fuzzy Matching Scenarios", () => {
        it("should find notes with single character typos", () => {
            rootNote.child(note("Docuemnt")); // "Document" with 'e' and 'm' swapped

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery("document", searchContext);

            expect(searchResults.length).toBeGreaterThan(0);
            expect(findNoteByTitle(searchResults, "Docuemnt")).toBeTruthy();
        });

        it("should find notes with missing characters", () => {
            rootNote.child(note("Documnt")); // "Document" with missing 'e'

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery("document", searchContext);

            expect(searchResults.length).toBeGreaterThan(0);
            expect(findNoteByTitle(searchResults, "Documnt")).toBeTruthy();
        });

        it("should find notes with extra characters", () => {
            rootNote.child(note("Docuument")); // "Document" with extra 'u'

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery("document", searchContext);

            expect(searchResults.length).toBeGreaterThan(0);
            expect(findNoteByTitle(searchResults, "Docuument")).toBeTruthy();
        });

        it("should find notes with substituted characters", () => {
            rootNote.child(note("Documant")); // "Document" with 'e' -> 'a'

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery("document", searchContext);

            expect(searchResults.length).toBeGreaterThan(0);
            expect(findNoteByTitle(searchResults, "Documant")).toBeTruthy();
        });

        it("should handle multiple typos with appropriate scoring", () => {
            rootNote
                .child(note("Document")) // Exact
                .child(note("Documnt")) // 1 typo
                .child(note("Documant")) // 1 typo (different)
                .child(note("Docmnt")); // 2 typos

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery("document", searchContext);

            expect(searchResults.length).toBe(4);

            // Exact should score highest
            expect(becca.notes[searchResults[0].noteId].title).toBe("Document");

            // Notes with fewer typos should score higher than those with more
            const twoTypoResult = searchResults.find(r => becca.notes[r.noteId].title === "Docmnt");
            const oneTypoResult = searchResults.find(r => becca.notes[r.noteId].title === "Documnt");

            expect(oneTypoResult!.score).toBeGreaterThan(twoTypoResult!.score);
        });
    });

    describe("Multi-token Query Scenarios", () => {
        it("should handle multi-word exact matches", () => {
            rootNote.child(note("Project Status Report"));

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery("project status", searchContext);

            expect(searchResults.length).toBeGreaterThan(0);
            expect(findNoteByTitle(searchResults, "Project Status Report")).toBeTruthy();
        });

        it("should handle multi-word queries with typos", () => {
            rootNote.child(note("Project Staus Report")); // "Status" typo

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery("project status report", searchContext);

            expect(searchResults.length).toBeGreaterThan(0);
            expect(findNoteByTitle(searchResults, "Project Staus Report")).toBeTruthy();
        });

        it("should prioritize notes matching more tokens", () => {
            rootNote
                .child(note("Project Analysis Report"))
                .child(note("Project Report"))
                .child(note("Report"));

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery("project analysis report", searchContext);

            expect(searchResults.length).toBeGreaterThanOrEqual(1);

            // Note matching all three tokens should rank highest
            if (searchResults.length > 0) {
                expect(becca.notes[searchResults[0].noteId].title).toBe("Project Analysis Report");
            }
        });

        it("should accumulate scores across multiple fuzzy matches", () => {
            rootNote
                .child(note("Projct Analsis Reprt")) // All three words have typos
                .child(note("Project Analysis"));

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery("project analysis report", searchContext);

            expect(searchResults.length).toBeGreaterThan(0);

            // Should find both, with appropriate scoring
            const multiTypoNote = searchResults.find(r => becca.notes[r.noteId].title === "Projct Analsis Reprt");
            expect(multiTypoNote).toBeTruthy();
        });
    });

    describe("Integration with Fast Search Mode", () => {
        it.skip("should skip content search in fast search mode", () => {
            // TODO: Requires CLS context setup - implement in integration tests
            const contentNote = note("Fast Search Test");
            contentNote.note.setContent("This content should not be searched in fast mode");
            rootNote.child(contentNote);

            const searchContext = new SearchContext();
            searchContext.fastSearch = true;

            const searchResults = searchService.findResultsWithQuery("should not be searched", searchContext);

            // Should not find content in fast search mode
            expect(searchResults.length).toBe(0);
        });

        it("should still perform progressive search on titles in fast mode", () => {
            rootNote
                .child(note("Test Document"))
                .child(note("Tset Report")); // Typo

            const searchContext = new SearchContext();
            searchContext.fastSearch = true;

            const searchResults = searchService.findResultsWithQuery("test", searchContext);

            // Should find both via title search with progressive strategy
            expect(searchResults.length).toBe(2);
        });
    });

    describe("Empty and Minimal Query Handling", () => {
        it("should handle empty query string", () => {
            rootNote.child(note("Some Document"));

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery("", searchContext);

            // Empty query behavior - should return all or none based on implementation
            expect(searchResults).toBeDefined();
        });

        it("should handle whitespace-only query", () => {
            rootNote.child(note("Some Document"));

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery("   ", searchContext);

            expect(searchResults).toBeDefined();
        });

        it("should handle query with only special characters", () => {
            rootNote.child(note("Test Document"));

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery("@#$%", searchContext);

            expect(searchResults).toBeDefined();
        });
    });
});