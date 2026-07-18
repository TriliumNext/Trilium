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
    });
});