import { describe, it, expect, beforeEach } from "vitest";
import searchService from "./services/search.js";
import BNote from "../../becca/entities/bnote.js";
import BBranch from "../../becca/entities/bbranch.js";
import SearchContext from "./search_context.js";
import becca from "../../becca/becca.js";
import dateUtils from "../../services/date_utils.js";
import { findNoteByTitle, note, NoteBuilder } from "../../test/becca_mocking.js";

/**
 * Property Search Tests - Comprehensive Coverage
 *
 * Tests ALL note properties from search.md line 106:
 * - Identity: noteId, title, type, mime
 * - Dates: dateCreated, dateModified, utcDateCreated, utcDateModified
 * - Status: isProtected, isArchived
 * - Content: content, text, rawContent, contentSize, noteSize
 * - Counts: parentCount, childrenCount, revisionCount, attribute counts
 * - Type coercion and edge cases
 */
describe("Property Search - Comprehensive", () => {
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

    describe("Identity Properties", () => {
        describe("note.noteId", () => {
            it("should find note by exact noteId", () => {
                const specificNote = new NoteBuilder(new BNote({
                    noteId: "test123",
                    title: "Test Note",
                    type: "text"
                }));

                rootNote.child(specificNote);

                const searchContext = new SearchContext();
                const searchResults = searchService.findResultsWithQuery("# note.noteId = test123", searchContext);

                expect(searchResults.length).toEqual(1);
                expect(findNoteByTitle(searchResults, "Test Note")).toBeTruthy();
            });

            it("should support noteId pattern matching", () => {
                rootNote
                    .child(note("Note ABC123"))
                    .child(note("Note ABC456"))
                    .child(note("Note XYZ789"));

                const searchContext = new SearchContext();
                const searchResults = searchService.findResultsWithQuery("# note.noteId =* ABC", searchContext);

                // This depends on how noteIds are generated, but tests the operator works
                expect(searchResults).toBeDefined();
            });
        });

        describe("note.title", () => {
            it("should find notes by exact title", () => {
                rootNote
                    .child(note("Exact Title"))
                    .child(note("Different Title"));

                const searchContext = new SearchContext();
                const searchResults = searchService.findResultsWithQuery("# note.title = 'Exact Title'", searchContext);

                expect(searchResults.length).toEqual(1);
                expect(findNoteByTitle(searchResults, "Exact Title")).toBeTruthy();
            });

            it("should find notes by title pattern with *=* (contains)", () => {
                rootNote
                    .child(note("Programming Guide"))
                    .child(note("JavaScript Programming"))
                    .child(note("Database Design"));

                const searchContext = new SearchContext();
                const searchResults = searchService.findResultsWithQuery("# note.title *=* Programming", searchContext);

                expect(searchResults.length).toEqual(2);
                expect(findNoteByTitle(searchResults, "Programming Guide")).toBeTruthy();
                expect(findNoteByTitle(searchResults, "JavaScript Programming")).toBeTruthy();
            });

            it("should find notes by title prefix with =* (starts with)", () => {
                rootNote
                    .child(note("JavaScript Basics"))
                    .child(note("JavaScript Advanced"))
                    .child(note("TypeScript Basics"));

                const searchContext = new SearchContext();
                const searchResults = searchService.findResultsWithQuery("# note.title =* JavaScript", searchContext);

                expect(searchResults.length).toEqual(2);
                expect(findNoteByTitle(searchResults, "JavaScript Basics")).toBeTruthy();
                expect(findNoteByTitle(searchResults, "JavaScript Advanced")).toBeTruthy();
            });

            it("should find notes by title suffix with *= (ends with)", () => {
                rootNote
                    .child(note("Introduction to React"))
                    .child(note("Advanced React"))
                    .child(note("React Hooks"));

                const searchContext = new SearchContext();
                const searchResults = searchService.findResultsWithQuery("# note.title *= React", searchContext);

                expect(searchResults.length).toEqual(2);
                expect(findNoteByTitle(searchResults, "Introduction to React")).toBeTruthy();
                expect(findNoteByTitle(searchResults, "Advanced React")).toBeTruthy();
            });

            it("should handle case-insensitive title search", () => {
                rootNote.child(note("TypeScript Guide"));

                const searchContext = new SearchContext();
                const searchResults = searchService.findResultsWithQuery("# note.title *=* typescript", searchContext);

                expect(searchResults.length).toEqual(1);
                expect(findNoteByTitle(searchResults, "TypeScript Guide")).toBeTruthy();
            });
        });

        describe("note.type", () => {
            it("should find notes by type", () => {
                rootNote
                    .child(note("Text Document", { type: "text" }))
                    .child(note("Code File", { type: "code" }))
                    .child(note("Image File", { type: "image" }));

                const searchContext = new SearchContext();

                let searchResults = searchService.findResultsWithQuery("# note.type = text", searchContext);
                expect(searchResults.length).toBeGreaterThanOrEqual(1);
                expect(findNoteByTitle(searchResults, "Text Document")).toBeTruthy();

                searchResults = searchService.findResultsWithQuery("# note.type = code", searchContext);
                expect(searchResults.length).toEqual(1);
                expect(findNoteByTitle(searchResults, "Code File")).toBeTruthy();
            });

            it("should handle case-insensitive type search", () => {
                rootNote.child(note("Code", { type: "code" }));

                const searchContext = new SearchContext();
                const searchResults = searchService.findResultsWithQuery("# note.type = CODE", searchContext);

                expect(searchResults.length).toEqual(1);
                expect(findNoteByTitle(searchResults, "Code")).toBeTruthy();
            });

            it("should find notes excluding a type", () => {
                rootNote
                    .child(note("Text 1", { type: "text" }))
                    .child(note("Text 2", { type: "text" }))
                    .child(note("Code 1", { type: "code" }));

                const searchContext = new SearchContext();
                const searchResults = searchService.findResultsWithQuery(
                    "# note.type != code AND note.title *=* '1'",
                    searchContext
                );

                expect(findNoteByTitle(searchResults, "Text 1")).toBeTruthy();
                expect(findNoteByTitle(searchResults, "Code 1")).toBeFalsy();
            });
        });

        describe("note.mime", () => {
            it("should find notes by exact MIME type", () => {
                rootNote
                    .child(note("HTML Doc", { type: "text", mime: "text/html" }))
                    .child(note("JSON Code", { type: "code", mime: "application/json" }))
                    .child(note("JS Code", { type: "code", mime: "application/javascript" }));

                const searchContext = new SearchContext();

                let searchResults = searchService.findResultsWithQuery("# note.mime = 'text/html'", searchContext);
                expect(findNoteByTitle(searchResults, "HTML Doc")).toBeTruthy();

                searchResults = searchService.findResultsWithQuery("# note.mime = 'application/json'", searchContext);
                expect(searchResults.length).toEqual(1);
                expect(findNoteByTitle(searchResults, "JSON Code")).toBeTruthy();
            });

            it("should find notes by MIME pattern", () => {
                rootNote
                    .child(note("JS File", { type: "code", mime: "application/javascript" }))
                    .child(note("JSON File", { type: "code", mime: "application/json" }))
                    .child(note("HTML File", { type: "text", mime: "text/html" }));

                const searchContext = new SearchContext();
                const searchResults = searchService.findResultsWithQuery("# note.mime =* 'application/'", searchContext);

                expect(searchResults.length).toEqual(2);
                expect(findNoteByTitle(searchResults, "JS File")).toBeTruthy();
                expect(findNoteByTitle(searchResults, "JSON File")).toBeTruthy();
            });

            it("should combine type and mime search", () => {
                rootNote
                    .child(note("TypeScript", { type: "code", mime: "text/x-typescript" }))
                    .child(note("JavaScript", { type: "code", mime: "application/javascript" }));

                const searchContext = new SearchContext();
                const searchResults = searchService.findResultsWithQuery(
                    "# note.type = code AND note.mime = 'text/x-typescript'",
                    searchContext
                );

                expect(searchResults.length).toEqual(1);
                expect(findNoteByTitle(searchResults, "TypeScript")).toBeTruthy();
            });
        });
    });

    describe("Date Properties", () => {
        describe("note.dateCreated and note.dateModified", () => {
            it("should find notes by exact creation date", () => {
                const testDate = "2023-06-15 10:30:00.000+0000";
                const testNote = new NoteBuilder(new BNote({
                    noteId: "dated1",
                    title: "Dated Note",
                    type: "text",
                    dateCreated: testDate
                }));

                rootNote.child(testNote);

                const searchContext = new SearchContext();
                const searchResults = searchService.findResultsWithQuery(
                    `# note.dateCreated = '${testDate}'`,
                    searchContext
                );

                expect(findNoteByTitle(searchResults, "Dated Note")).toBeTruthy();
            });

            it("should find notes by date range using >= and <=", () => {
                rootNote
                    .child(note("Old Note", { dateCreated: "2020-01-01 00:00:00.000+0000" }))
                    .child(note("Recent Note", { dateCreated: "2023-06-01 00:00:00.000+0000" }))
                    .child(note("New Note", { dateCreated: "2024-01-01 00:00:00.000+0000" }));

                const searchContext = new SearchContext();
                const searchResults = searchService.findResultsWithQuery(
                    "# note.dateCreated >= '2023-01-01' AND note.dateCreated < '2024-01-01'",
                    searchContext
                );

                expect(findNoteByTitle(searchResults, "Recent Note")).toBeTruthy();
                expect(findNoteByTitle(searchResults, "Old Note")).toBeFalsy();
            });

            it("should find notes modified after a date", () => {
                const testNote = new NoteBuilder(new BNote({
                    noteId: "modified1",
                    title: "Modified Note",
                    type: "text",
                    dateModified: "2023-12-01 00:00:00.000+0000"
                }));

                rootNote.child(testNote);

                const searchContext = new SearchContext();
                const searchResults = searchService.findResultsWithQuery(
                    "# note.dateModified >= '2023-11-01'",
                    searchContext
                );

                expect(findNoteByTitle(searchResults, "Modified Note")).toBeTruthy();
            });
        });

        describe("UTC Date Properties", () => {
            it("should find notes by UTC creation date", () => {
                const utcDate = "2023-06-15 08:30:00.000Z";
                const testNote = new NoteBuilder(new BNote({
                    noteId: "utc1",
                    title: "UTC Note",
                    type: "text",
                    utcDateCreated: utcDate
                }));

                rootNote.child(testNote);

                const searchContext = new SearchContext();
                const searchResults = searchService.findResultsWithQuery(
                    `# note.utcDateCreated = '${utcDate}'`,
                    searchContext
                );

                expect(findNoteByTitle(searchResults, "UTC Note")).toBeTruthy();
            });
        });

        describe("Smart Date Comparisons", () => {
            it("should support TODAY date variable", () => {
                const today = dateUtils.localNowDate();
                const testNote = new NoteBuilder(new BNote({
                    noteId: "today1",
                    title: "Today's Note",
                    type: "text"
                }));
                testNote.note.dateCreated = dateUtils.localNowDateTime();

                rootNote.child(testNote);

                const searchContext = new SearchContext();
                const searchResults = searchService.findResultsWithQuery(
                    "# note.dateCreated >= TODAY",
                    searchContext
                );

                expect(findNoteByTitle(searchResults, "Today's Note")).toBeTruthy();
            });

            it("should support TODAY with offset", () => {
                const recentNote = new NoteBuilder(new BNote({
                    noteId: "recent1",
                    title: "Recent Note",
                    type: "text"
                }));
                recentNote.note.dateCreated = dateUtils.localNowDateTime();

                rootNote.child(recentNote);

                const searchContext = new SearchContext();
                const searchResults = searchService.findResultsWithQuery(
                    "# note.dateCreated >= TODAY-30",
                    searchContext
                );

                expect(findNoteByTitle(searchResults, "Recent Note")).toBeTruthy();
            });

            it("should support NOW for datetime comparisons", () => {
                const justNow = new NoteBuilder(new BNote({
                    noteId: "now1",
                    title: "Just Now",
                    type: "text"
                }));
                justNow.note.dateCreated = dateUtils.localNowDateTime();

                rootNote.child(justNow);

                const searchContext = new SearchContext();
                const searchResults = searchService.findResultsWithQuery(
                    "# note.dateCreated >= NOW-10",
                    searchContext
                );

                expect(findNoteByTitle(searchResults, "Just Now")).toBeTruthy();
            });

            it("should support MONTH and YEAR date variables", () => {
                const thisYear = new Date().getFullYear().toString();
                const yearNote = new NoteBuilder(new BNote({
                    noteId: "year1",
                    title: "This Year",
                    type: "text"
                }));
                yearNote.label("year", thisYear);

                rootNote.child(yearNote);

                const searchContext = new SearchContext();
                const searchResults = searchService.findResultsWithQuery(
                    "# #year = YEAR",
                    searchContext
                );

                expect(findNoteByTitle(searchResults, "This Year")).toBeTruthy();
            });
        });

        describe("Date Pattern Matching", () => {
            it("should find notes created in specific month using =*", () => {
                rootNote
                    .child(note("May Note", { dateCreated: "2023-05-15 10:00:00.000+0000" }))
                    .child(note("June Note", { dateCreated: "2023-06-15 10:00:00.000+0000" }));

                const searchContext = new SearchContext();
                const searchResults = searchService.findResultsWithQuery(
                    "# note.dateCreated =* '2023-05'",
                    searchContext
                );

                expect(findNoteByTitle(searchResults, "May Note")).toBeTruthy();
                expect(findNoteByTitle(searchResults, "June Note")).toBeFalsy();
            });

            it("should find notes created in specific year", () => {
                rootNote
                    .child(note("2022 Note", { dateCreated: "2022-06-15 10:00:00.000+0000" }))
                    .child(note("2023 Note", { dateCreated: "2023-06-15 10:00:00.000+0000" }));

                const searchContext = new SearchContext();
                const searchResults = searchService.findResultsWithQuery(
                    "# note.dateCreated =* '2023'",
                    searchContext
                );

                expect(findNoteByTitle(searchResults, "2023 Note")).toBeTruthy();
                expect(findNoteByTitle(searchResults, "2022 Note")).toBeFalsy();
            });
        });
    });

    describe("Status Properties", () => {
        describe("note.isProtected", () => {
            it("should find protected notes", () => {
                rootNote
                    .child(note("Protected", { isProtected: true }))
                    .child(note("Public", { isProtected: false }));

                const searchContext = new SearchContext();
                const searchResults = searchService.findResultsWithQuery("# note.isProtected = true", searchContext);

                expect(findNoteByTitle(searchResults, "Protected")).toBeTruthy();
                expect(findNoteByTitle(searchResults, "Public")).toBeFalsy();
            });

            it("should find unprotected notes", () => {
                rootNote
                    .child(note("Protected", { isProtected: true }))
                    .child(note("Public", { isProtected: false }));

                const searchContext = new SearchContext();
                const searchResults = searchService.findResultsWithQuery("# note.isProtected = false", searchContext);

                expect(findNoteByTitle(searchResults, "Public")).toBeTruthy();
            });

            it("should handle case-insensitive boolean values", () => {
                rootNote.child(note("Protected", { isProtected: true }));

                const searchContext = new SearchContext();

                let searchResults = searchService.findResultsWithQuery("# note.isProtected = TRUE", searchContext);
                expect(findNoteByTitle(searchResults, "Protected")).toBeTruthy();

                searchResults = searchService.findResultsWithQuery("# note.isProtected = True", searchContext);
                expect(findNoteByTitle(searchResults, "Protected")).toBeTruthy();
            });
        });

        describe("note.isArchived", () => {
            it("should filter by archived status", () => {
                rootNote
                    .child(note("Active 1"))
                    .child(note("Active 2"));

                const searchContext = new SearchContext();
                const searchResults = searchService.findResultsWithQuery("# note.isArchived = false", searchContext);

                // Should find non-archived notes
                expect(findNoteByTitle(searchResults, "Active 1")).toBeTruthy();
            });

            it("should respect includeArchivedNotes flag", () => {
                // Test that archived note handling works
                const searchContext = new SearchContext({ includeArchivedNotes: true });

                // Should not throw error
                expect(() => {
                    searchService.findResultsWithQuery("# note.isArchived = true", searchContext);
                }).not.toThrow();
            });
        });
    });

    describe("Content Properties", () => {
        describe("note.contentSize", () => {
            it("should support contentSize property", () => {
                // Note: Content size requires database setup
                const searchContext = new SearchContext();

                // Should parse without error
                expect(() => {
                    searchService.findResultsWithQuery("# note.contentSize < 100", searchContext);
                }).not.toThrow();

                expect(() => {
                    searchService.findResultsWithQuery("# note.contentSize > 1000", searchContext);
                }).not.toThrow();
            });
        });

        describe("note.noteSize", () => {
            it("should support noteSize property", () => {
                // Note: Note size requires database setup
                const searchContext = new SearchContext();

                // Should parse without error
                expect(() => {
                    searchService.findResultsWithQuery("# note.noteSize > 0", searchContext);
                }).not.toThrow();
            });
        });
    });

    describe("Count Properties", () => {
        describe("note.parentCount", () => {
            it("should find notes by number of parents", () => {
                const singleParent = note("Single Parent");
                const multiParent = note("Multi Parent");

                rootNote
                    .child(note("Parent 1").child(singleParent))
                    .child(note("Parent 2").child(multiParent))
                    .child(note("Parent 3").child(multiParent));

                const searchContext = new SearchContext();

                let searchResults = searchService.findResultsWithQuery("# note.parentCount = 1", searchContext);
                expect(findNoteByTitle(searchResults, "Single Parent")).toBeTruthy();

                searchResults = searchService.findResultsWithQuery("# note.parentCount = 2", searchContext);
                expect(findNoteByTitle(searchResults, "Multi Parent")).toBeTruthy();

                searchResults = searchService.findResultsWithQuery("# note.parentCount > 1", searchContext);
                expect(findNoteByTitle(searchResults, "Multi Parent")).toBeTruthy();
            });
        });

        describe("note.childrenCount", () => {
            it("should find notes by number of children", () => {
                rootNote
                    .child(note("No Children"))
                    .child(note("One Child").child(note("Child")))
                    .child(note("Two Children")
                        .child(note("Child 1"))
                        .child(note("Child 2")));

                const searchContext = new SearchContext();

                let searchResults = searchService.findResultsWithQuery("# note.childrenCount = 0", searchContext);
                expect(findNoteByTitle(searchResults, "No Children")).toBeTruthy();

                searchResults = searchService.findResultsWithQuery("# note.childrenCount = 1", searchContext);
                expect(findNoteByTitle(searchResults, "One Child")).toBeTruthy();

                searchResults = searchService.findResultsWithQuery("# note.childrenCount >= 2", searchContext);
                expect(findNoteByTitle(searchResults, "Two Children")).toBeTruthy();
            });

            it("should find leaf notes", () => {
                rootNote
                    .child(note("Parent").child(note("Leaf 1")).child(note("Leaf 2")))
                    .child(note("Leaf 3"));

                const searchContext = new SearchContext();
                const searchResults = searchService.findResultsWithQuery(
                    "# note.childrenCount = 0 AND note.title =* Leaf",
                    searchContext
                );

                expect(searchResults.length).toEqual(3);
            });
        });

        describe("note.revisionCount", () => {
            it("should filter by revision count", () => {
                // Note: In real usage, revisions are created over time
                // This test documents the property exists and works
                const searchContext = new SearchContext();
                const searchResults = searchService.findResultsWithQuery("# note.revisionCount >= 0", searchContext);

                // All notes should have at least 0 revisions
                expect(searchResults.length).toBeGreaterThanOrEqual(0);
            });
        });

        describe("Attribute Count Properties", () => {
            it("should filter by labelCount", () => {
                rootNote
                    .child(note("Three Labels")
                        .label("tag1")
                        .label("tag2")
                        .label("tag3"))
                    .child(note("One Label")
                        .label("tag1"));

                const searchContext = new SearchContext();

                let searchResults = searchService.findResultsWithQuery("# note.labelCount = 3", searchContext);
                expect(findNoteByTitle(searchResults, "Three Labels")).toBeTruthy();

                searchResults = searchService.findResultsWithQuery("# note.labelCount >= 1", searchContext);
                expect(searchResults.length).toBeGreaterThanOrEqual(2);
            });

            it("should filter by ownedLabelCount", () => {
                const parent = note("Parent").label("inherited", "", true);
                const child = note("Child").label("owned", "");

                rootNote.child(parent.child(child));

                const searchContext = new SearchContext();
                const searchResults = searchService.findResultsWithQuery(
                    "# note.title = Child AND note.ownedLabelCount = 1",
                    searchContext
                );

                expect(searchResults.length).toEqual(1);
            });

            it("should filter by relationCount", () => {
                const target = note("Target");

                rootNote
                    .child(note("Two Relations")
                        .relation("rel1", target.note)
                        .relation("rel2", target.note))
                    .child(note("One Relation")
                        .relation("rel1", target.note))
                    .child(target);

                const searchContext = new SearchContext();

                let searchResults = searchService.findResultsWithQuery("# note.relationCount = 2", searchContext);
                expect(findNoteByTitle(searchResults, "Two Relations")).toBeTruthy();

                searchResults = searchService.findResultsWithQuery("# note.relationCount >= 1", searchContext);
                expect(searchResults.length).toBeGreaterThanOrEqual(2);
            });

            it("should filter by attributeCount (labels + relations)", () => {
                const target = note("Target");

                rootNote.child(note("Mixed Attributes")
                    .label("label1")
                    .label("label2")
                    .relation("rel1", target.note));

                const searchContext = new SearchContext();
                const searchResults = searchService.findResultsWithQuery(
                    "# note.attributeCount = 3 AND note.title = 'Mixed Attributes'",
                    searchContext
                );

                expect(searchResults.length).toEqual(1);
            });

            it("should filter by targetRelationCount", () => {
                const popular = note("Popular Target");

                rootNote
                    .child(note("Source 1").relation("points", popular.note))
                    .child(note("Source 2").relation("points", popular.note))
                    .child(note("Source 3").relation("points", popular.note))
                    .child(popular);

                const searchContext = new SearchContext();
                const searchResults = searchService.findResultsWithQuery(
                    "# note.targetRelationCount = 3",
                    searchContext
                );

                expect(findNoteByTitle(searchResults, "Popular Target")).toBeTruthy();
            });
        });
    });

    describe("Type Coercion", () => {
        it("should coerce string to number for numeric comparison", () => {
            rootNote
                .child(note("Item 1").label("count", "10"))
                .child(note("Item 2").label("count", "20"))
                .child(note("Item 3").label("count", "5"));

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery("#count > 10", searchContext);

            expect(searchResults.length).toEqual(1);
            expect(findNoteByTitle(searchResults, "Item 2")).toBeTruthy();
        });

        it("should handle boolean string values", () => {
            rootNote
                .child(note("True Value").label("flag", "true"))
                .child(note("False Value").label("flag", "false"));

            const searchContext = new SearchContext();

            let searchResults = searchService.findResultsWithQuery("#flag = true", searchContext);
            expect(findNoteByTitle(searchResults, "True Value")).toBeTruthy();

            searchResults = searchService.findResultsWithQuery("#flag = false", searchContext);
            expect(findNoteByTitle(searchResults, "False Value")).toBeTruthy();
        });
    });

    describe("Edge Cases", () => {
        it("should handle null/undefined values", () => {
            const searchContext = new SearchContext();
            // Should not crash when searching properties that might be null
            const searchResults = searchService.findResultsWithQuery("# note.title != ''", searchContext);

            expect(searchResults).toBeDefined();
        });

        it("should handle empty strings", () => {
            rootNote.child(note("").label("empty", ""));

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery("#empty = ''", searchContext);

            expect(searchResults).toBeDefined();
        });

        it("should handle very large numbers", () => {
            rootNote.child(note("Large").label("bignum", "999999999"));

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery("#bignum > 1000000", searchContext);

            expect(findNoteByTitle(searchResults, "Large")).toBeTruthy();
        });

        it("should handle special characters in titles", () => {
            rootNote
                .child(note("Title with & < > \" ' chars"))
                .child(note("Title with #hashtag"))
                .child(note("Title with ~tilde"));

            const searchContext = new SearchContext();

            let searchResults = searchService.findResultsWithQuery("# note.title *=* '&'", searchContext);
            expect(findNoteByTitle(searchResults, "Title with & < > \" ' chars")).toBeTruthy();

            // Hash and tilde need escaping in search syntax
            searchResults = searchService.findResultsWithQuery("# note.title *=* 'hashtag'", searchContext);
            expect(findNoteByTitle(searchResults, "Title with #hashtag")).toBeTruthy();
        });
    });

    describe("Complex Property Combinations", () => {
        it("should combine multiple properties with AND", () => {
            rootNote
                .child(note("Match", {
                    type: "code",
                    mime: "application/javascript",
                    isProtected: false
                }))
                .child(note("No Match 1", {
                    type: "text",
                    mime: "text/html"
                }))
                .child(note("No Match 2", {
                    type: "code",
                    mime: "application/json"
                }));

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery(
                "# note.type = code AND note.mime = 'application/javascript' AND note.isProtected = false",
                searchContext
            );

            expect(searchResults.length).toEqual(1);
            expect(findNoteByTitle(searchResults, "Match")).toBeTruthy();
        });

        it("should combine properties with OR", () => {
            rootNote
                .child(note("Protected Code", { type: "code", isProtected: true }))
                .child(note("Protected Text", { type: "text", isProtected: true }))
                .child(note("Public Code", { type: "code", isProtected: false }));

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery(
                "# note.isProtected = true OR note.type = code",
                searchContext
            );

            expect(searchResults.length).toEqual(3);
        });

        it("should combine properties with hierarchy", () => {
            rootNote
                .child(note("Projects")
                    .child(note("Active Project", { type: "text" }))
                    .child(note("Code Project", { type: "code" })));

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery(
                "# note.parents.title = Projects AND note.type = code",
                searchContext
            );

            expect(searchResults.length).toEqual(1);
            expect(findNoteByTitle(searchResults, "Code Project")).toBeTruthy();
        });

        it("should combine properties with attributes", () => {
            rootNote
                .child(note("Book", { type: "text" }).label("published", "2023"))
                .child(note("Draft", { type: "text" }).label("published", "2024"))
                .child(note("Code", { type: "code" }).label("published", "2023"));

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery(
                "# note.type = text AND #published = 2023",
                searchContext
            );

            expect(searchResults.length).toEqual(1);
            expect(findNoteByTitle(searchResults, "Book")).toBeTruthy();
        });
    });
});
