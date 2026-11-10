import { beforeEach, describe, expect, it } from "vitest";

import becca from "../../becca/becca.js";
import BNote from "../../becca/entities/bnote.js";
import { buildNote } from "../../test/becca_easy_mocking.js";
import SearchResult from "./search_result.js";

describe("SearchResult", () => {
    let note: BNote;

    beforeEach(() => {
        becca.reset();
        note = buildNote({
            id: "test123",
            title: "Test Note"
        });
    });

    describe("constructor", () => {
        it("should initialize with note path array", () => {
            const searchResult = new SearchResult([note.noteId]);

            expect(searchResult.notePathArray).toEqual(["test123"]);
            expect(searchResult.noteId).toBe("test123");
            expect(searchResult.notePath).toBe("test123");
            expect(searchResult.score).toBe(0);
            expect(searchResult.notePathTitle).toBe("Test Note");
        });
    });

    describe("computeScore", () => {
        let searchResult: SearchResult;

        beforeEach(() => {
            searchResult = new SearchResult([note.noteId]);
        });

        describe("basic scoring", () => {
            it("should give highest score for exact note ID match", () => {
                searchResult.computeScore("test123", ["test123"]);
                expect(searchResult.score).toBeGreaterThanOrEqual(1000);
            });

            it("should give high score for exact title match", () => {
                searchResult.computeScore("test note", ["test", "note"]);
                expect(searchResult.score).toBeGreaterThan(2000);
            });

            it("should give medium score for title prefix match", () => {
                searchResult.computeScore("test", ["test"]);
                expect(searchResult.score).toBeGreaterThan(500);
            });

            it("should give lower score for title word match", () => {
                note.title = "This is a test note";
                searchResult.computeScore("test", ["test"]);
                expect(searchResult.score).toBeGreaterThan(300);
            });
        });

        describe("hidden notes penalty", () => {
            it("should apply penalty for hidden notes", () => {
                const hiddenNote = buildNote({
                    id: "_hidden",
                    title: "Test Note"
                });
                const hiddenSearchResult = new SearchResult([hiddenNote.noteId]);

                hiddenSearchResult.computeScore("test", ["test"]);
                const hiddenScore = hiddenSearchResult.score;

                searchResult.computeScore("test", ["test"]);
                const normalScore = searchResult.score;

                expect(normalScore).toBeGreaterThan(hiddenScore);
                expect(hiddenScore).toBe(normalScore / 3);
            });
        });
    });

    describe("addScoreForStrings", () => {
        let searchResult: SearchResult;

        beforeEach(() => {
            searchResult = new SearchResult([note.noteId]);
        });

        it("should give highest score for exact token match", () => {
            searchResult.addScoreForStrings(["sample"], "sample text", 1.0);
            const exactScore = searchResult.score;

            searchResult.score = 0;
            searchResult.addScoreForStrings(["sample"], "sampling text", 1.0);
            const prefixScore = searchResult.score;

            searchResult.score = 0;
            searchResult.addScoreForStrings(["sample"], "text sample text", 1.0);
            const partialScore = searchResult.score;

            expect(exactScore).toBeGreaterThan(prefixScore);
            expect(exactScore).toBeGreaterThanOrEqual(partialScore);
        });

        it("should apply factor multiplier correctly", () => {
            searchResult.addScoreForStrings(["sample"], "sample text", 2.0);
            const doubleFactorScore = searchResult.score;

            searchResult.score = 0;
            searchResult.addScoreForStrings(["sample"], "sample text", 1.0);
            const singleFactorScore = searchResult.score;

            expect(doubleFactorScore).toBe(singleFactorScore * 2);
        });

        it("should handle multiple tokens", () => {
            searchResult.addScoreForStrings(["hello", "world"], "hello world test", 1.0);
            expect(searchResult.score).toBeGreaterThan(0);
        });

        it("should be case insensitive", () => {
            searchResult.addScoreForStrings(["sample"], "sample text", 1.0);
            const lowerCaseScore = searchResult.score;

            searchResult.score = 0;
            searchResult.addScoreForStrings(["sample"], "SAMPLE text", 1.0);
            const upperCaseScore = searchResult.score;

            expect(upperCaseScore).toEqual(lowerCaseScore);
            expect(upperCaseScore).toBeGreaterThan(0);
        });
    });
});
