import { describe, it, expect, beforeEach } from "vitest";
import searchService from "./services/search.js";
import BNote from "../../becca/entities/bnote.js";
import BBranch from "../../becca/entities/bbranch.js";
import SearchContext from "./search_context.js";
import becca from "../../becca/becca.js";
import { findNoteByTitle, note, NoteBuilder } from "../../test/becca_mocking.js";

/**
 * Content Search Tests
 *
 * Tests full-text content search features including:
 * - Fulltext tokens and operators
 * - Content size handling
 * - Note type-specific content extraction
 * - Protected content
 * - Combining content with other searches
 */
describe("Content Search", () => {
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

    describe("Fulltext Token Search", () => {
        it("should find notes with single fulltext token", () => {
            rootNote
                .child(note("Document containing Tolkien information"))
                .child(note("Another document"))
                .child(note("Reference to J.R.R. Tolkien"));

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery("tolkien", searchContext);

            expect(searchResults.length).toEqual(2);
            expect(findNoteByTitle(searchResults, "Document containing Tolkien information")).toBeTruthy();
            expect(findNoteByTitle(searchResults, "Reference to J.R.R. Tolkien")).toBeTruthy();
        });

        it("should find notes with multiple fulltext tokens (implicit AND)", () => {
            rootNote
                .child(note("The Lord of the Rings by Tolkien"))
                .child(note("Book about rings and jewelry"))
                .child(note("Tolkien biography"));

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery("tolkien rings", searchContext);

            expect(searchResults.length).toEqual(1);
            expect(findNoteByTitle(searchResults, "The Lord of the Rings by Tolkien")).toBeTruthy();
        });

        it("should find notes with exact phrase in quotes", () => {
            rootNote
                .child(note("The Lord of the Rings is a classic"))
                .child(note("Lord and Rings are different words"))
                .child(note("A ring for a lord"));

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery('"Lord of the Rings"', searchContext);

            expect(searchResults.length).toEqual(1);
            expect(findNoteByTitle(searchResults, "The Lord of the Rings is a classic")).toBeTruthy();
        });

        it("should combine exact phrases with tokens", () => {
            rootNote
                .child(note("The Lord of the Rings by Tolkien is amazing"))
                .child(note("Tolkien wrote many books"))
                .child(note("The Lord of the Rings was published in 1954"));

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery('"Lord of the Rings" Tolkien', searchContext);

            expect(searchResults.length).toEqual(1);
            expect(findNoteByTitle(searchResults, "The Lord of the Rings by Tolkien is amazing")).toBeTruthy();
        });
    });

    describe("Content Property Search", () => {
        it("should support note.content *=* operator syntax", () => {
            // Note: Content search requires database setup, tested in integration tests
            // This test validates the query syntax is recognized
            const searchContext = new SearchContext();

            // Should not throw error when parsing
            expect(() => {
                searchService.findResultsWithQuery('note.content *=* "search"', searchContext);
            }).not.toThrow();
        });

        it("should support note.text property syntax", () => {
            // Note: Text search requires database setup, tested in integration tests
            const searchContext = new SearchContext();

            // Should not throw error when parsing
            expect(() => {
                searchService.findResultsWithQuery('note.text *=* "sample"', searchContext);
            }).not.toThrow();
        });

        it("should support note.rawContent property syntax", () => {
            // Note: RawContent search requires database setup, tested in integration tests
            const searchContext = new SearchContext();

            // Should not throw error when parsing
            expect(() => {
                searchService.findResultsWithQuery('note.rawContent *=* "html"', searchContext);
            }).not.toThrow();
        });
    });

    describe("Content with OR Operator", () => {
        it("should support OR operator in queries", () => {
            // Note: OR with content requires proper fulltext setup
            const searchContext = new SearchContext();

            // Should parse without error
            expect(() => {
                searchService.findResultsWithQuery(
                    'note.content *=* "rings" OR note.content *=* "tolkien"',
                    searchContext
                );
            }).not.toThrow();
        });
    });

    describe("Content Size Handling", () => {
        it("should support contentSize property in queries", () => {
            // Note: Content size requires database setup
            const searchContext = new SearchContext();

            // Should parse contentSize queries without error
            expect(() => {
                searchService.findResultsWithQuery("# note.contentSize < 100", searchContext);
            }).not.toThrow();

            expect(() => {
                searchService.findResultsWithQuery("# note.contentSize > 1000", searchContext);
            }).not.toThrow();
        });
    });

    describe("Note Type-Specific Content", () => {
        it("should filter by note type", () => {
            rootNote
                .child(note("Text File", { type: "text", mime: "text/html" }))
                .child(note("Code File", { type: "code", mime: "application/javascript" }))
                .child(note("JSON File", { type: "code", mime: "application/json" }));

            const searchContext = new SearchContext();

            let searchResults = searchService.findResultsWithQuery("# note.type = text", searchContext);
            expect(findNoteByTitle(searchResults, "Text File")).toBeTruthy();

            searchResults = searchService.findResultsWithQuery("# note.type = code", searchContext);
            expect(searchResults.length).toBeGreaterThanOrEqual(2);
            expect(findNoteByTitle(searchResults, "Code File")).toBeTruthy();
            expect(findNoteByTitle(searchResults, "JSON File")).toBeTruthy();
        });

        it("should combine type and mime filters", () => {
            rootNote
                .child(note("JS File", { type: "code", mime: "application/javascript" }))
                .child(note("JSON File", { type: "code", mime: "application/json" }));

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery(
                "# note.type = code AND note.mime = 'application/json'",
                searchContext
            );

            expect(searchResults.length).toEqual(1);
            expect(findNoteByTitle(searchResults, "JSON File")).toBeTruthy();
        });
    });

    describe("Protected Content", () => {
        it("should filter by isProtected property", () => {
            rootNote
                .child(note("Protected Note", { isProtected: true }))
                .child(note("Public Note", { isProtected: false }));

            const searchContext = new SearchContext();

            // Find protected notes
            let searchResults = searchService.findResultsWithQuery("# note.isProtected = true", searchContext);
            expect(findNoteByTitle(searchResults, "Protected Note")).toBeTruthy();
            expect(findNoteByTitle(searchResults, "Public Note")).toBeFalsy();

            // Find public notes
            searchResults = searchService.findResultsWithQuery("# note.isProtected = false", searchContext);
            expect(findNoteByTitle(searchResults, "Public Note")).toBeTruthy();
        });
    });

    describe("Combining Content with Other Searches", () => {
        it("should combine fulltext search with labels", () => {
            rootNote
                .child(note("React Tutorial").label("tutorial"))
                .child(note("React Book").label("book"));

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery("react #tutorial", searchContext);

            expect(searchResults.length).toEqual(1);
            expect(findNoteByTitle(searchResults, "React Tutorial")).toBeTruthy();
        });

        it("should combine fulltext search with relations", () => {
            const framework = note("React Framework");

            rootNote
                .child(framework)
                .child(note("Introduction to React").relation("framework", framework.note))
                .child(note("Introduction to Programming"));

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery(
                'introduction ~framework.title = "React Framework"',
                searchContext
            );

            expect(searchResults.length).toEqual(1);
            expect(findNoteByTitle(searchResults, "Introduction to React")).toBeTruthy();
        });

        it("should combine type filter with note properties", () => {
            rootNote
                .child(note("Example Code", { type: "code", mime: "application/javascript" }))
                .child(note("Example Text", { type: "text" }));

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery(
                "# example AND note.type = code",
                searchContext
            );

            expect(searchResults.length).toEqual(1);
            expect(findNoteByTitle(searchResults, "Example Code")).toBeTruthy();
        });

        it("should combine fulltext with hierarchy", () => {
            rootNote
                .child(note("Tutorials")
                    .child(note("React Tutorial")))
                .child(note("References")
                    .child(note("React Reference")));

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery(
                '# react AND note.parents.title = "Tutorials"',
                searchContext
            );

            expect(searchResults.length).toEqual(1);
            expect(findNoteByTitle(searchResults, "React Tutorial")).toBeTruthy();
        });
    });

    describe("Fast Search Option", () => {
        it("should support fast search mode", () => {
            rootNote
                .child(note("Note Title").label("important"));

            const searchContext = new SearchContext({ fastSearch: true });

            // Fast search should still find by title
            let searchResults = searchService.findResultsWithQuery("Title", searchContext);
            expect(findNoteByTitle(searchResults, "Note Title")).toBeTruthy();

            // Fast search should still find by label
            searchResults = searchService.findResultsWithQuery("#important", searchContext);
            expect(findNoteByTitle(searchResults, "Note Title")).toBeTruthy();
        });
    });

    describe("Case Sensitivity", () => {
        it("should handle case-insensitive title search", () => {
            rootNote.child(note("TypeScript Programming"));

            const searchContext = new SearchContext();

            // Should find regardless of case in title
            let searchResults = searchService.findResultsWithQuery("typescript", searchContext);
            expect(findNoteByTitle(searchResults, "TypeScript Programming")).toBeTruthy();

            searchResults = searchService.findResultsWithQuery("PROGRAMMING", searchContext);
            expect(findNoteByTitle(searchResults, "TypeScript Programming")).toBeTruthy();
        });
    });

    describe("Multiple Word Phrases", () => {
        it("should handle multi-word fulltext search", () => {
            rootNote
                .child(note("Document about Lord of the Rings"))
                .child(note("Book review of The Hobbit"))
                .child(note("Random text about fantasy"));

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery("lord rings", searchContext);

            expect(searchResults.length).toEqual(1);
            expect(findNoteByTitle(searchResults, "Document about Lord of the Rings")).toBeTruthy();
        });

        it("should handle exact phrase with multiple words", () => {
            rootNote
                .child(note("The quick brown fox jumps"))
                .child(note("A brown fox is quick"))
                .child(note("Quick and brown animals"));

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery('"quick brown fox"', searchContext);

            expect(searchResults.length).toEqual(1);
            expect(findNoteByTitle(searchResults, "The quick brown fox jumps")).toBeTruthy();
        });
    });

    describe("Plain Text Search Matches Attribute Values", () => {
        it("should find notes by searching for label value as plain text", () => {
            // Note has a label with value "Tolkien", searching for "Tolkien" should find it
            rootNote
                .child(note("The Hobbit").label("author", "Tolkien"))
                .child(note("Dune").label("author", "Herbert"))
                .child(note("Random Note"));

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery("Tolkien", searchContext);

            expect(searchResults.length).toEqual(1);
            expect(findNoteByTitle(searchResults, "The Hobbit")).toBeTruthy();
        });

        it("should find notes by searching for label name as plain text", () => {
            // Note has a label named "important", searching for "important" should find it
            rootNote
                .child(note("Critical Task").label("important"))
                .child(note("Regular Task"));

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery("important", searchContext);

            expect(searchResults.length).toEqual(1);
            expect(findNoteByTitle(searchResults, "Critical Task")).toBeTruthy();
        });

        it("should find notes by searching for relation name as plain text", () => {
            const author = note("J.R.R. Tolkien");

            rootNote
                .child(note("The Hobbit").relation("writtenBy", author.note))
                .child(note("Random Book"))
                .child(author);

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery("writtenBy", searchContext);

            expect(searchResults.length).toEqual(1);
            expect(findNoteByTitle(searchResults, "The Hobbit")).toBeTruthy();
        });

        it("should find notes when label value contains the search term", () => {
            rootNote
                .child(note("Fantasy Book").label("genre", "Science Fiction"))
                .child(note("History Book").label("genre", "Historical"));

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery("Fiction", searchContext);

            expect(searchResults.length).toEqual(1);
            expect(findNoteByTitle(searchResults, "Fantasy Book")).toBeTruthy();
        });

        it("should combine plain text attribute search with title search", () => {
            rootNote
                .child(note("Programming Guide").label("language", "JavaScript"))
                .child(note("Programming Tutorial").label("language", "Python"))
                .child(note("Cooking Guide").label("cuisine", "Italian"));

            const searchContext = new SearchContext();
            // Search for notes with "Guide" in title AND "JavaScript" in attributes
            const searchResults = searchService.findResultsWithQuery("Guide JavaScript", searchContext);

            expect(searchResults.length).toEqual(1);
            expect(findNoteByTitle(searchResults, "Programming Guide")).toBeTruthy();
        });
    });
});
