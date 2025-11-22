import { describe, it, expect, beforeEach } from "vitest";
import searchService from "./services/search.js";
import BNote from "../../becca/entities/bnote.js";
import BBranch from "../../becca/entities/bbranch.js";
import SearchContext from "./search_context.js";
import becca from "../../becca/becca.js";
import { findNoteByTitle, note, NoteBuilder } from "../../test/becca_mocking.js";

/**
 * Attribute Search Tests - Comprehensive Coverage
 *
 * Tests all attribute-related search features including:
 * - Label search with all operators
 * - Relation search with traversal
 * - Promoted vs regular labels
 * - Inherited vs owned attributes
 * - Attribute counts
 * - Multi-hop relations
 */
describe("Attribute Search - Comprehensive", () => {
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

    describe("Label Search - Existence", () => {
        it("should find notes with label using #label syntax", () => {
            rootNote
                .child(note("Book One").label("book"))
                .child(note("Book Two").label("book"))
                .child(note("Article").label("article"));

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery("#book", searchContext);

            expect(searchResults.length).toEqual(2);
            expect(findNoteByTitle(searchResults, "Book One")).toBeTruthy();
            expect(findNoteByTitle(searchResults, "Book Two")).toBeTruthy();
        });

        it("should find notes without label using #!label syntax", () => {
            rootNote
                .child(note("Book").label("published"))
                .child(note("Draft"))
                .child(note("Article"));

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery("#!published", searchContext);

            expect(searchResults.length).toBeGreaterThanOrEqual(2);
            expect(findNoteByTitle(searchResults, "Draft")).toBeTruthy();
            expect(findNoteByTitle(searchResults, "Article")).toBeTruthy();
            expect(findNoteByTitle(searchResults, "Book")).toBeFalsy();
        });

        it("should find notes using full syntax note.labels.labelName", () => {
            rootNote
                .child(note("Tagged").label("important"))
                .child(note("Untagged"));

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery("# note.labels.important", searchContext);

            expect(searchResults.length).toEqual(1);
            expect(findNoteByTitle(searchResults, "Tagged")).toBeTruthy();
        });
    });

    describe("Label Search - Value Comparisons", () => {
        it("should find labels with exact value using = operator", () => {
            rootNote
                .child(note("Book 1").label("status", "published"))
                .child(note("Book 2").label("status", "draft"))
                .child(note("Book 3").label("status", "published"));

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery("#status = published", searchContext);

            expect(searchResults.length).toEqual(2);
            expect(findNoteByTitle(searchResults, "Book 1")).toBeTruthy();
            expect(findNoteByTitle(searchResults, "Book 3")).toBeTruthy();
        });

        it("should find labels with value not equal using != operator", () => {
            rootNote
                .child(note("Book 1").label("status", "published"))
                .child(note("Book 2").label("status", "draft"));

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery("#status != published", searchContext);

            expect(searchResults.length).toEqual(1);
            expect(findNoteByTitle(searchResults, "Book 2")).toBeTruthy();
        });

        it("should find labels containing substring using *=* operator", () => {
            rootNote
                .child(note("Genre 1").label("genre", "science fiction"))
                .child(note("Genre 2").label("genre", "fantasy"))
                .child(note("Genre 3").label("genre", "historical fiction"));

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery("#genre *=* fiction", searchContext);

            expect(searchResults.length).toEqual(2);
            expect(findNoteByTitle(searchResults, "Genre 1")).toBeTruthy();
            expect(findNoteByTitle(searchResults, "Genre 3")).toBeTruthy();
        });

        it("should find labels starting with prefix using =* operator", () => {
            rootNote
                .child(note("File 1").label("filename", "document.pdf"))
                .child(note("File 2").label("filename", "document.txt"))
                .child(note("File 3").label("filename", "image.pdf"));

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery("#filename =* document", searchContext);

            expect(searchResults.length).toEqual(2);
            expect(findNoteByTitle(searchResults, "File 1")).toBeTruthy();
            expect(findNoteByTitle(searchResults, "File 2")).toBeTruthy();
        });

        it("should find labels ending with suffix using *= operator", () => {
            rootNote
                .child(note("File 1").label("filename", "report.pdf"))
                .child(note("File 2").label("filename", "document.pdf"))
                .child(note("File 3").label("filename", "image.png"));

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery("#filename *= pdf", searchContext);

            expect(searchResults.length).toEqual(2);
            expect(findNoteByTitle(searchResults, "File 1")).toBeTruthy();
            expect(findNoteByTitle(searchResults, "File 2")).toBeTruthy();
        });

        it("should find labels matching regex using %= operator", () => {
            rootNote
                .child(note("Year 1950").label("year", "1950"))
                .child(note("Year 1975").label("year", "1975"))
                .child(note("Year 2000").label("year", "2000"));

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery("#year %= '19[0-9]{2}'", searchContext);

            expect(searchResults.length).toEqual(2);
            expect(findNoteByTitle(searchResults, "Year 1950")).toBeTruthy();
            expect(findNoteByTitle(searchResults, "Year 1975")).toBeTruthy();
        });
    });

    describe("Label Search - Numeric Comparisons", () => {
        it("should compare label values as numbers using >= operator", () => {
            rootNote
                .child(note("Book 1").label("pages", "150"))
                .child(note("Book 2").label("pages", "300"))
                .child(note("Book 3").label("pages", "500"));

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery("#pages >= 300", searchContext);

            expect(searchResults.length).toEqual(2);
            expect(findNoteByTitle(searchResults, "Book 2")).toBeTruthy();
            expect(findNoteByTitle(searchResults, "Book 3")).toBeTruthy();
        });

        it("should compare label values using > operator", () => {
            rootNote
                .child(note("Item 1").label("price", "10"))
                .child(note("Item 2").label("price", "20"))
                .child(note("Item 3").label("price", "30"));

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery("#price > 15", searchContext);

            expect(searchResults.length).toEqual(2);
            expect(findNoteByTitle(searchResults, "Item 2")).toBeTruthy();
            expect(findNoteByTitle(searchResults, "Item 3")).toBeTruthy();
        });

        it("should compare label values using <= operator", () => {
            rootNote
                .child(note("Score 1").label("score", "75"))
                .child(note("Score 2").label("score", "85"))
                .child(note("Score 3").label("score", "95"));

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery("#score <= 85", searchContext);

            expect(searchResults.length).toEqual(2);
            expect(findNoteByTitle(searchResults, "Score 1")).toBeTruthy();
            expect(findNoteByTitle(searchResults, "Score 2")).toBeTruthy();
        });

        it("should compare label values using < operator", () => {
            rootNote
                .child(note("Value 1").label("value", "100"))
                .child(note("Value 2").label("value", "200"))
                .child(note("Value 3").label("value", "300"));

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery("#value < 250", searchContext);

            expect(searchResults.length).toEqual(2);
            expect(findNoteByTitle(searchResults, "Value 1")).toBeTruthy();
            expect(findNoteByTitle(searchResults, "Value 2")).toBeTruthy();
        });
    });

    describe("Label Search - Multiple Labels", () => {
        it("should find notes with multiple labels using AND", () => {
            rootNote
                .child(note("Book 1").label("book").label("fiction"))
                .child(note("Book 2").label("book").label("nonfiction"))
                .child(note("Article").label("article").label("fiction"));

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery("#book AND #fiction", searchContext);

            expect(searchResults.length).toEqual(1);
            expect(findNoteByTitle(searchResults, "Book 1")).toBeTruthy();
        });

        it("should find notes with any of multiple labels using OR", () => {
            rootNote
                .child(note("Item 1").label("book"))
                .child(note("Item 2").label("article"))
                .child(note("Item 3").label("video"));

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery("#book OR #article", searchContext);

            expect(searchResults.length).toEqual(2);
            expect(findNoteByTitle(searchResults, "Item 1")).toBeTruthy();
            expect(findNoteByTitle(searchResults, "Item 2")).toBeTruthy();
        });

        it("should combine multiple label conditions", () => {
            rootNote
                .child(note("Book 1").label("type", "book").label("year", "1950"))
                .child(note("Book 2").label("type", "book").label("year", "1960"))
                .child(note("Article").label("type", "article").label("year", "1955"));

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery(
                "#type = book AND #year >= 1950 AND #year < 1960",
                searchContext
            );

            expect(searchResults.length).toEqual(1);
            expect(findNoteByTitle(searchResults, "Book 1")).toBeTruthy();
        });
    });

    describe("Label Search - Promoted vs Regular", () => {
        it("should find both promoted and regular labels", () => {
            rootNote
                .child(note("Note 1").label("tag", "value", false)) // Regular
                .child(note("Note 2").label("tag", "value", true)); // Promoted (inheritable)

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery("#tag", searchContext);

            expect(searchResults.length).toEqual(2);
            expect(findNoteByTitle(searchResults, "Note 1")).toBeTruthy();
            expect(findNoteByTitle(searchResults, "Note 2")).toBeTruthy();
        });
    });

    describe("Label Search - Inherited Labels", () => {
        it("should find notes with inherited labels", () => {
            rootNote
                .child(note("Parent")
                    .label("category", "books", true) // Inheritable
                    .child(note("Child 1"))
                    .child(note("Child 2")));

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery("#category = books", searchContext);

            expect(searchResults.length).toBeGreaterThanOrEqual(2);
            expect(findNoteByTitle(searchResults, "Child 1")).toBeTruthy();
            expect(findNoteByTitle(searchResults, "Child 2")).toBeTruthy();
        });

        it("should distinguish inherited vs owned labels in counts", () => {
            const parent = note("Parent").label("inherited", "value", true);
            const child = note("Child").label("owned", "value", false);

            rootNote.child(parent.child(child));

            const searchContext = new SearchContext();

            // Child should have 2 total labels (1 owned + 1 inherited)
            const searchResults = searchService.findResultsWithQuery(
                "# note.title = Child AND note.labelCount = 2",
                searchContext
            );

            expect(searchResults.length).toEqual(1);
        });
    });

    describe("Relation Search - Existence", () => {
        it("should find notes with relation using ~relation syntax", () => {
            const target = note("Target");

            rootNote
                .child(note("Note 1").relation("linkedTo", target.note))
                .child(note("Note 2").relation("linkedTo", target.note))
                .child(note("Note 3"))
                .child(target);

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery("~linkedTo", searchContext);

            expect(searchResults.length).toEqual(2);
            expect(findNoteByTitle(searchResults, "Note 1")).toBeTruthy();
            expect(findNoteByTitle(searchResults, "Note 2")).toBeTruthy();
        });

        it("should find notes without relation using ~!relation syntax", () => {
            const target = note("Target");

            rootNote
                .child(note("Linked").relation("author", target.note))
                .child(note("Unlinked 1"))
                .child(note("Unlinked 2"))
                .child(target);

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery("~!author AND note.title *=* Unlinked", searchContext);

            expect(searchResults.length).toEqual(2);
            expect(findNoteByTitle(searchResults, "Unlinked 1")).toBeTruthy();
            expect(findNoteByTitle(searchResults, "Unlinked 2")).toBeTruthy();
        });

        it("should find notes using full syntax note.relations.relationName", () => {
            const author = note("Tolkien");

            rootNote
                .child(note("Book").relation("author", author.note))
                .child(author);

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery("# note.relations.author", searchContext);

            expect(searchResults.length).toEqual(1);
            expect(findNoteByTitle(searchResults, "Book")).toBeTruthy();
        });
    });

    describe("Relation Search - Target Properties", () => {
        it("should find relations by target title using ~relation.title", () => {
            const tolkien = note("J.R.R. Tolkien");
            const herbert = note("Frank Herbert");

            rootNote
                .child(note("Lord of the Rings").relation("author", tolkien.note))
                .child(note("The Hobbit").relation("author", tolkien.note))
                .child(note("Dune").relation("author", herbert.note))
                .child(tolkien)
                .child(herbert);

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery("~author.title = 'J.R.R. Tolkien'", searchContext);

            expect(searchResults.length).toEqual(2);
            expect(findNoteByTitle(searchResults, "Lord of the Rings")).toBeTruthy();
            expect(findNoteByTitle(searchResults, "The Hobbit")).toBeTruthy();
        });

        it("should find relations by target title pattern", () => {
            const author1 = note("Author Tolkien");
            const author2 = note("Editor Tolkien");
            const author3 = note("Publisher Smith");

            rootNote
                .child(note("Book 1").relation("creator", author1.note))
                .child(note("Book 2").relation("creator", author2.note))
                .child(note("Book 3").relation("creator", author3.note))
                .child(author1)
                .child(author2)
                .child(author3);

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery("~creator.title *=* Tolkien", searchContext);

            expect(searchResults.length).toEqual(2);
            expect(findNoteByTitle(searchResults, "Book 1")).toBeTruthy();
            expect(findNoteByTitle(searchResults, "Book 2")).toBeTruthy();
        });

        it("should find relations by target properties", () => {
            const codeNote = note("Code Example", { type: "code" });
            const textNote = note("Text Example", { type: "text" });

            rootNote
                .child(note("Reference 1").relation("example", codeNote.note))
                .child(note("Reference 2").relation("example", textNote.note))
                .child(codeNote)
                .child(textNote);

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery("~example.type = code", searchContext);

            expect(searchResults.length).toEqual(1);
            expect(findNoteByTitle(searchResults, "Reference 1")).toBeTruthy();
        });
    });

    describe("Relation Search - Multi-Hop Traversal", () => {
        it("should traverse two-hop relations", () => {
            const tolkien = note("J.R.R. Tolkien");
            const christopher = note("Christopher Tolkien");

            tolkien.relation("son", christopher.note);

            rootNote
                .child(note("Lord of the Rings").relation("author", tolkien.note))
                .child(note("The Hobbit").relation("author", tolkien.note))
                .child(tolkien)
                .child(christopher);

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery(
                "~author.relations.son.title = 'Christopher Tolkien'",
                searchContext
            );

            expect(searchResults.length).toEqual(2);
            expect(findNoteByTitle(searchResults, "Lord of the Rings")).toBeTruthy();
            expect(findNoteByTitle(searchResults, "The Hobbit")).toBeTruthy();
        });

        it("should traverse three-hop relations", () => {
            const person1 = note("Person 1");
            const person2 = note("Person 2");
            const person3 = note("Person 3");

            person1.relation("knows", person2.note);
            person2.relation("knows", person3.note);

            rootNote
                .child(note("Document").relation("author", person1.note))
                .child(person1)
                .child(person2)
                .child(person3);

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery(
                "~author.relations.knows.relations.knows.title = 'Person 3'",
                searchContext
            );

            expect(searchResults.length).toEqual(1);
            expect(findNoteByTitle(searchResults, "Document")).toBeTruthy();
        });

        it("should handle relation chains with labels", () => {
            const tolkien = note("J.R.R. Tolkien").label("profession", "author");

            rootNote
                .child(note("Book").relation("creator", tolkien.note))
                .child(tolkien);

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery(
                "~creator.labels.profession = author",
                searchContext
            );

            expect(searchResults.length).toEqual(1);
            expect(findNoteByTitle(searchResults, "Book")).toBeTruthy();
        });
    });

    describe("Relation Search - Circular References", () => {
        it("should handle circular relations without infinite loop", () => {
            const note1 = note("Note 1");
            const note2 = note("Note 2");

            note1.relation("linkedTo", note2.note);
            note2.relation("linkedTo", note1.note);

            rootNote.child(note1).child(note2);

            const searchContext = new SearchContext();

            // This should complete without hanging
            const searchResults = searchService.findResultsWithQuery("~linkedTo", searchContext);

            expect(searchResults.length).toEqual(2);
        });
    });

    describe("Attribute Count Properties", () => {
        it("should filter by total label count", () => {
            rootNote
                .child(note("Note 1").label("tag1").label("tag2").label("tag3"))
                .child(note("Note 2").label("tag1"))
                .child(note("Note 3"));

            const searchContext = new SearchContext();

            let searchResults = searchService.findResultsWithQuery("# note.labelCount = 3", searchContext);
            expect(findNoteByTitle(searchResults, "Note 1")).toBeTruthy();

            searchResults = searchService.findResultsWithQuery("# note.labelCount >= 1", searchContext);
            expect(searchResults.length).toBeGreaterThanOrEqual(2);
        });

        it("should filter by owned label count", () => {
            const parent = note("Parent").label("inherited", "", true);
            const child = note("Child").label("owned", "");

            rootNote.child(parent.child(child));

            const searchContext = new SearchContext();

            // Child should have exactly 1 owned label
            const searchResults = searchService.findResultsWithQuery(
                "# note.title = Child AND note.ownedLabelCount = 1",
                searchContext
            );

            expect(searchResults.length).toEqual(1);
        });

        it("should filter by relation count", () => {
            const target1 = note("Target 1");
            const target2 = note("Target 2");

            rootNote
                .child(note("Note With Two Relations")
                    .relation("rel1", target1.note)
                    .relation("rel2", target2.note))
                .child(note("Note With One Relation")
                    .relation("rel1", target1.note))
                .child(target1)
                .child(target2);

            const searchContext = new SearchContext();

            let searchResults = searchService.findResultsWithQuery("# note.relationCount = 2", searchContext);
            expect(findNoteByTitle(searchResults, "Note With Two Relations")).toBeTruthy();

            searchResults = searchService.findResultsWithQuery("# note.relationCount >= 1", searchContext);
            expect(searchResults.length).toBeGreaterThanOrEqual(2);
        });

        it("should filter by owned relation count", () => {
            const target = note("Target");
            const owned = note("Owned Relation").relation("owns", target.note);

            rootNote.child(owned).child(target);

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery(
                "# note.ownedRelationCount = 1 AND note.title = 'Owned Relation'",
                searchContext
            );

            expect(searchResults.length).toEqual(1);
        });

        it("should filter by total attribute count", () => {
            rootNote
                .child(note("Note 1")
                    .label("label1")
                    .label("label2")
                    .relation("rel1", rootNote.note))
                .child(note("Note 2")
                    .label("label1"));

            const searchContext = new SearchContext();

            const searchResults = searchService.findResultsWithQuery("# note.attributeCount = 3", searchContext);
            expect(findNoteByTitle(searchResults, "Note 1")).toBeTruthy();
        });

        it("should filter by owned attribute count", () => {
            const noteWithAttrs = note("NoteWithAttrs")
                .label("label1")
                .relation("rel1", rootNote.note);

            rootNote.child(noteWithAttrs);

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery(
                "# note.ownedAttributeCount = 2 AND note.title = 'NoteWithAttrs'",
                searchContext
            );

            expect(findNoteByTitle(searchResults, "NoteWithAttrs")).toBeTruthy();
        });

        it("should filter by target relation count", () => {
            const popularTarget = note("Popular Target");

            rootNote
                .child(note("Source 1").relation("pointsTo", popularTarget.note))
                .child(note("Source 2").relation("pointsTo", popularTarget.note))
                .child(note("Source 3").relation("pointsTo", popularTarget.note))
                .child(popularTarget);

            const searchContext = new SearchContext();

            // Popular target should have 3 incoming relations
            const searchResults = searchService.findResultsWithQuery(
                "# note.targetRelationCount = 3",
                searchContext
            );

            expect(findNoteByTitle(searchResults, "Popular Target")).toBeTruthy();
        });
    });

    describe("Complex Attribute Combinations", () => {
        it("should combine labels, relations, and properties", () => {
            const tolkien = note("J.R.R. Tolkien");

            rootNote
                .child(note("Lord of the Rings", { type: "text" })
                    .label("published", "1954")
                    .relation("author", tolkien.note))
                .child(note("Code Example", { type: "code" })
                    .label("published", "2020")
                    .relation("author", tolkien.note))
                .child(tolkien);

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery(
                "# #published < 2000 AND ~author.title = 'J.R.R. Tolkien' AND note.type = text",
                searchContext
            );

            expect(searchResults.length).toEqual(1);
            expect(findNoteByTitle(searchResults, "Lord of the Rings")).toBeTruthy();
        });

        it("should use OR conditions with attributes", () => {
            rootNote
                .child(note("Item 1").label("priority", "high"))
                .child(note("Item 2").label("priority", "urgent"))
                .child(note("Item 3").label("priority", "low"));

            const searchContext = new SearchContext();
            const searchResults = searchService.findResultsWithQuery(
                "#priority = high OR #priority = urgent",
                searchContext
            );

            expect(searchResults.length).toEqual(2);
            expect(findNoteByTitle(searchResults, "Item 1")).toBeTruthy();
            expect(findNoteByTitle(searchResults, "Item 2")).toBeTruthy();
        });

        it("should negate attribute conditions", () => {
            rootNote
                .child(note("Active Note").label("status", "active"))
                .child(note("Archived Note").label("status", "archived"));

            const searchContext = new SearchContext();

            // Use #!label syntax for negation
            const searchResults = searchService.findResultsWithQuery(
                "# #status AND #status != archived",
                searchContext
            );

            // Should find the note with status=active
            expect(findNoteByTitle(searchResults, "Active Note")).toBeTruthy();
            expect(findNoteByTitle(searchResults, "Archived Note")).toBeFalsy();
        });
    });
});
