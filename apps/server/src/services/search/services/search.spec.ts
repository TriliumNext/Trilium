import { describe, it, expect, beforeEach,  } from "vitest";
import searchService from "./search.js";
import BNote from "../../../becca/entities/bnote.js";
import BBranch from "../../../becca/entities/bbranch.js";
import SearchContext from "../search_context.js";
import dateUtils from "../../date_utils.js";
import becca from "../../../becca/becca.js";
import { findNoteByTitle, note, NoteBuilder } from "../../../test/becca_mocking.js";

describe("Search", () => {
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

    it("simple path match", () => {
        rootNote.child(note("Europe").child(note("Austria")));

        const searchContext = new SearchContext();
        const searchResults = searchService.findResultsWithQuery("europe austria", searchContext);

        expect(searchResults.length).toEqual(1);
        expect(findNoteByTitle(searchResults, "Austria")).toBeTruthy();
    });

    it("normal search looks also at attributes", () => {
        const austria = note("Austria");
        const vienna = note("Vienna");

        rootNote.child(austria.relation("capital", vienna.note)).child(vienna.label("inhabitants", "1888776"));

        const searchContext = new SearchContext();
        let searchResults = searchService.findResultsWithQuery("capital", searchContext);

        expect(searchResults.length).toEqual(1);
        expect(findNoteByTitle(searchResults, "Austria")).toBeTruthy();

        searchResults = searchService.findResultsWithQuery("inhabitants", searchContext);

        expect(searchResults.length).toEqual(1);
        expect(findNoteByTitle(searchResults, "Vienna")).toBeTruthy();
    });

    it("normal search looks also at type and mime", () => {
        rootNote.child(note("Effective Java", { type: "book", mime: "" })).child(note("Hello World.java", { type: "code", mime: "text/x-java" }));

        const searchContext = new SearchContext();
        let searchResults = searchService.findResultsWithQuery("book", searchContext);

        expect(searchResults.length).toEqual(1);
        expect(findNoteByTitle(searchResults, "Effective Java")).toBeTruthy();

        searchResults = searchService.findResultsWithQuery("text", searchContext); // should match mime

        expect(searchResults.length).toEqual(1);
        expect(findNoteByTitle(searchResults, "Hello World.java")).toBeTruthy();

        searchResults = searchService.findResultsWithQuery("java", searchContext);

        expect(searchResults.length).toEqual(2);
    });

    it("only end leafs are results", () => {
        rootNote.child(note("Europe").child(note("Austria")));

        const searchContext = new SearchContext();
        const searchResults = searchService.findResultsWithQuery("europe", searchContext);

        expect(searchResults.length).toEqual(1);
        expect(findNoteByTitle(searchResults, "Europe")).toBeTruthy();
    });

    it("only end leafs are results", () => {
        rootNote.child(note("Europe").child(note("Austria").label("capital", "Vienna")));

        const searchContext = new SearchContext();

        const searchResults = searchService.findResultsWithQuery("Vienna", searchContext);
        expect(searchResults.length).toEqual(1);
        expect(findNoteByTitle(searchResults, "Austria")).toBeTruthy();
    });

    it("label comparison with short syntax", () => {
        rootNote.child(note("Europe").child(note("Austria").label("capital", "Vienna")).child(note("Czech Republic").label("capital", "Prague")));

        const searchContext = new SearchContext();

        let searchResults = searchService.findResultsWithQuery("#capital=Vienna", searchContext);
        expect(searchResults.length).toEqual(1);
        expect(findNoteByTitle(searchResults, "Austria")).toBeTruthy();

        // case sensitivity:
        searchResults = searchService.findResultsWithQuery("#CAPITAL=VIENNA", searchContext);
        expect(searchResults.length).toEqual(1);
        expect(findNoteByTitle(searchResults, "Austria")).toBeTruthy();

        searchResults = searchService.findResultsWithQuery("#caPItal=vienNa", searchContext);
        expect(searchResults.length).toEqual(1);
        expect(findNoteByTitle(searchResults, "Austria")).toBeTruthy();
    });

    it("label comparison with full syntax", () => {
        rootNote.child(note("Europe").child(note("Austria").label("capital", "Vienna")).child(note("Czech Republic").label("capital", "Prague")));

        const searchContext = new SearchContext();

        let searchResults = searchService.findResultsWithQuery("# note.labels.capital=Prague", searchContext);
        expect(searchResults.length).toEqual(1);
        expect(findNoteByTitle(searchResults, "Czech Republic")).toBeTruthy();
    });

    it("numeric label comparison", () => {
        rootNote.child(note("Europe")
                .label("country", "", true)
                .child(note("Austria").label("population", "8859000"))
                .child(note("Czech Republic").label("population", "10650000"))
        );

        const searchContext = new SearchContext();

        const searchResults = searchService.findResultsWithQuery("#country #population >= 10000000", searchContext);
        expect(searchResults.length).toEqual(1);
        expect(findNoteByTitle(searchResults, "Czech Republic")).toBeTruthy();
    });

    it("inherited label comparison", () => {
        rootNote.child(note("Europe").label("country", "", true).child(note("Austria")).child(note("Czech Republic")));

        const searchContext = new SearchContext();

        const searchResults = searchService.findResultsWithQuery("austria #country", searchContext);
        expect(searchResults.length).toEqual(1);
        expect(findNoteByTitle(searchResults, "Austria")).toBeTruthy();
    });

    it("numeric label comparison fallback to string comparison", () => {
        // dates should not be coerced into numbers which would then give wrong numbers

        rootNote.child(note("Europe")
                .label("country", "", true)
                .child(note("Austria").label("established", "1955-07-27"))
                .child(note("Czech Republic").label("established", "1993-01-01"))
                .child(note("Hungary").label("established", "1920-06-04"))
        );

        const searchContext = new SearchContext();

        let searchResults = searchService.findResultsWithQuery('#established <= "1955-01-01"', searchContext);
        expect(searchResults.length).toEqual(1);
        expect(findNoteByTitle(searchResults, "Hungary")).toBeTruthy();

        searchResults = searchService.findResultsWithQuery('#established > "1955-01-01"', searchContext);
        expect(searchResults.length).toEqual(2);
        expect(findNoteByTitle(searchResults, "Austria")).toBeTruthy();
        expect(findNoteByTitle(searchResults, "Czech Republic")).toBeTruthy();
    });

    it("smart date comparisons", () => {
        // dates should not be coerced into numbers which would then give wrong numbers

        rootNote.child(note("My note", { dateCreated: dateUtils.localNowDateTime() })
                .label("year", new Date().getFullYear().toString())
                .label("month", dateUtils.localNowDate().substr(0, 7))
                .label("date", dateUtils.localNowDate())
                .label("dateTime", dateUtils.localNowDateTime())
        );

        const searchContext = new SearchContext();

        function test(query: string, expectedResultCount: number) {
            const searchResults = searchService.findResultsWithQuery(query, searchContext);
            expect(searchResults.length, `Searching for '${query}' unexpectedly returned ${Number(searchResults?.length)} instead of ${expectedResultCount} results. SearchResult: '${JSON.stringify(searchResults)}'`)
                .toEqual(expectedResultCount);

            if (expectedResultCount === 1) {
                expect(findNoteByTitle(searchResults, "My note")).toBeTruthy();
            }
        }

        test("#year = YEAR", 1);
        test("#year = 'YEAR'", 0);
        test("#year >= YEAR", 1);
        test("#year <= YEAR", 1);
        test("#year < YEAR+1", 1);
        test("#year < YEAR + 1", 1);
        test("#year < year + 1", 1);
        test("#year > YEAR+1", 0);

        test("#month = MONTH", 1);
        test("#month = month", 1);
        test("#month = 'MONTH'", 0);

        test("note.dateCreated =* month", 2);

        test("#date = TODAY", 1);
        test("#date = today", 1);
        test("#date = 'today'", 0);
        test("#date > TODAY", 0);
        test("#date > TODAY-1", 1);
        test("#date > TODAY - 1", 1);
        test("#date < TODAY+1", 1);
        test("#date < TODAY + 1", 1);
        test("#date < 'TODAY + 1'", 1);

        test("#dateTime <= NOW+10", 1);
        test("#dateTime <= NOW + 10", 1);
        test("#dateTime < NOW-10", 0);
        test("#dateTime >= NOW-10", 1);
        test("#dateTime < NOW-10", 0);
    });

    it("logical or", () => {
        rootNote.child(note("Europe")
                .label("country", "", true)
                .child(note("Austria").label("languageFamily", "germanic"))
                .child(note("Czech Republic").label("languageFamily", "slavic"))
                .child(note("Hungary").label("languageFamily", "finnougric"))
        );

        const searchContext = new SearchContext();

        const searchResults = searchService.findResultsWithQuery("#languageFamily = slavic OR #languageFamily = germanic", searchContext);
        expect(searchResults.length).toEqual(2);
        expect(findNoteByTitle(searchResults, "Czech Republic")).toBeTruthy();
        expect(findNoteByTitle(searchResults, "Austria")).toBeTruthy();
    });

    it("leading = operator for exact match", () => {
        rootNote
            .child(note("Example Note").label("type", "document"))
            .child(note("Examples of Usage").label("type", "tutorial"))
            .child(note("Sample").label("type", "example"));

        const searchContext = new SearchContext();

        // Using leading = for exact word match - should find notes containing the exact word "example"
        let searchResults = searchService.findResultsWithQuery("=example", searchContext);
        expect(searchResults.length).toEqual(2); // "Example Note" and "Sample" (has label "example")
        expect(findNoteByTitle(searchResults, "Example Note")).toBeTruthy();
        expect(findNoteByTitle(searchResults, "Sample")).toBeTruthy();

        // Without =, it should find all notes containing "example" (substring match)
        searchResults = searchService.findResultsWithQuery("example", searchContext);
        expect(searchResults.length).toEqual(3); // All notes

        // = operator should not match partial words
        searchResults = searchService.findResultsWithQuery("=examples", searchContext);
        expect(searchResults.length).toEqual(1); // Only "Examples of Usage"
        expect(findNoteByTitle(searchResults, "Examples of Usage")).toBeTruthy();
    });

    it("leading = operator for exact match - comprehensive title tests", () => {
        // Create notes with varying titles to test exact vs contains matching
        rootNote
            .child(note("testing"))
            .child(note("testing123"))
            .child(note("My testing notes"))
            .child(note("123testing"))
            .child(note("test"));

        const searchContext = new SearchContext();

        // Test 1: Exact word match with leading = should find notes containing the exact word "testing"
        let searchResults = searchService.findResultsWithQuery("=testing", searchContext);
        expect(searchResults.length).toEqual(2); // "testing" and "My testing notes" (word boundary)
        expect(findNoteByTitle(searchResults, "testing")).toBeTruthy();
        expect(findNoteByTitle(searchResults, "My testing notes")).toBeTruthy();

        // Test 2: Without =, it should find all notes containing "testing" (substring contains behavior)
        searchResults = searchService.findResultsWithQuery("testing", searchContext);
        expect(searchResults.length).toEqual(4); // All notes with "testing" substring

        // Test 3: Exact match should only find the exact composite word
        searchResults = searchService.findResultsWithQuery("=testing123", searchContext);
        expect(searchResults.length).toEqual(1);
        expect(findNoteByTitle(searchResults, "testing123")).toBeTruthy();

        // Test 4: Exact match should only find the exact composite word
        searchResults = searchService.findResultsWithQuery("=123testing", searchContext);
        expect(searchResults.length).toEqual(1);
        expect(findNoteByTitle(searchResults, "123testing")).toBeTruthy();

        // Test 5: Verify that "test" doesn't match "testing" with exact search
        searchResults = searchService.findResultsWithQuery("=test", searchContext);
        expect(searchResults.length).toEqual(1);
        expect(findNoteByTitle(searchResults, "test")).toBeTruthy();
    });

    it("leading = operator with quoted phrases", () => {
        rootNote
            .child(note("exact phrase"))
            .child(note("exact phrase match"))
            .child(note("this exact phrase here"))
            .child(note("phrase exact"));

        const searchContext = new SearchContext();

        // Test 1: With = and quotes, treat as exact phrase match (consecutive words in order)
        let searchResults = searchService.findResultsWithQuery("='exact phrase'", searchContext);
        // Should match only notes containing the exact phrase "exact phrase"
        expect(searchResults.length).toEqual(3); // Only notes with consecutive "exact phrase"
        expect(findNoteByTitle(searchResults, "exact phrase")).toBeTruthy();
        expect(findNoteByTitle(searchResults, "exact phrase match")).toBeTruthy();
        expect(findNoteByTitle(searchResults, "this exact phrase here")).toBeTruthy();

        // Test 2: Without =, quoted phrase should find substring/contains matches
        searchResults = searchService.findResultsWithQuery("'exact phrase'", searchContext);
        expect(searchResults.length).toEqual(3); // All notes containing the phrase substring
        expect(findNoteByTitle(searchResults, "exact phrase")).toBeTruthy();
        expect(findNoteByTitle(searchResults, "exact phrase match")).toBeTruthy();
        expect(findNoteByTitle(searchResults, "this exact phrase here")).toBeTruthy();

        // Test 3: Verify word order matters with exact phrase matching
        searchResults = searchService.findResultsWithQuery("='phrase exact'", searchContext);
        expect(searchResults.length).toEqual(1); // Only "phrase exact" matches
        expect(findNoteByTitle(searchResults, "phrase exact")).toBeTruthy();
    });

    it("leading = operator case sensitivity", () => {
        rootNote
            .child(note("TESTING"))
            .child(note("testing"))
            .child(note("Testing"))
            .child(note("TeStiNg"));

        const searchContext = new SearchContext();

        // Exact match should be case-insensitive (based on lex.ts line 4: str.toLowerCase())
        let searchResults = searchService.findResultsWithQuery("=testing", searchContext);
        expect(searchResults.length).toEqual(4); // All variants of "testing"

        searchResults = searchService.findResultsWithQuery("=TESTING", searchContext);
        expect(searchResults.length).toEqual(4); // All variants

        searchResults = searchService.findResultsWithQuery("=Testing", searchContext);
        expect(searchResults.length).toEqual(4); // All variants

        searchResults = searchService.findResultsWithQuery("=TeStiNg", searchContext);
        expect(searchResults.length).toEqual(4); // All variants
    });

    it("leading = operator with special characters", () => {
        rootNote
            .child(note("test-note"))
            .child(note("test_note"))
            .child(note("test.note"))
            .child(note("test note"))
            .child(note("testnote"));

        const searchContext = new SearchContext();

        // Each exact match should only find its specific variant (compound words are treated as single words)
        let searchResults = searchService.findResultsWithQuery("=test-note", searchContext);
        expect(searchResults.length).toEqual(1);
        expect(findNoteByTitle(searchResults, "test-note")).toBeTruthy();

        searchResults = searchService.findResultsWithQuery("=test_note", searchContext);
        expect(searchResults.length).toEqual(1);
        expect(findNoteByTitle(searchResults, "test_note")).toBeTruthy();

        searchResults = searchService.findResultsWithQuery("=test.note", searchContext);
        expect(searchResults.length).toEqual(1);
        expect(findNoteByTitle(searchResults, "test.note")).toBeTruthy();

        // For phrases with spaces, use quotes to keep them together
        // With exact phrase matching, this finds notes with the consecutive phrase
        searchResults = searchService.findResultsWithQuery("='test note'", searchContext);
        expect(searchResults.length).toEqual(1); // Only "test note" has the exact phrase
        expect(findNoteByTitle(searchResults, "test note")).toBeTruthy();

        // Without quotes, "test note" is tokenized as two separate tokens
        // and will be treated as an exact phrase search with = operator
        searchResults = searchService.findResultsWithQuery("=test note", searchContext);
        expect(searchResults.length).toEqual(1); // Only "test note" has the exact phrase

        // Without =, should find all matches containing "test" substring
        searchResults = searchService.findResultsWithQuery("test", searchContext);
        expect(searchResults.length).toEqual(5);
    });

    it("fuzzy attribute search", () => {
        rootNote.child(note("Europe")
                .label("country", "", true)
                .child(note("Austria").label("languageFamily", "germanic"))
                .child(note("Czech Republic").label("languageFamily", "slavic"))
        );

        let searchContext = new SearchContext({ fuzzyAttributeSearch: false });

        let searchResults = searchService.findResultsWithQuery("#language", searchContext);
        expect(searchResults.length).toEqual(0);

        searchResults = searchService.findResultsWithQuery("#languageFamily=ger", searchContext);
        expect(searchResults.length).toEqual(0);

        searchContext = new SearchContext({ fuzzyAttributeSearch: true });

        searchResults = searchService.findResultsWithQuery("#language", searchContext);
        expect(searchResults.length).toEqual(2);

        searchResults = searchService.findResultsWithQuery("#languageFamily=ger", searchContext);
        expect(searchResults.length).toEqual(1);
        expect(findNoteByTitle(searchResults, "Austria")).toBeTruthy();
    });

    it("filter by note property", () => {
        rootNote.child(note("Europe").child(note("Austria")).child(note("Czech Republic")));

        const searchContext = new SearchContext();

        const searchResults = searchService.findResultsWithQuery("# note.title =* czech", searchContext);
        expect(searchResults.length).toEqual(1);
        expect(findNoteByTitle(searchResults, "Czech Republic")).toBeTruthy();
    });

    it("filter by note's parent", () => {
        rootNote
            .child(note("Europe")
                    .child(note("Austria"))
                    .child(note("Czech Republic").child(note("Prague")))
            )
            .child(note("Asia").child(note("Taiwan")));

        const searchContext = new SearchContext();

        let searchResults = searchService.findResultsWithQuery("# note.parents.title = Europe", searchContext);
        expect(searchResults.length).toEqual(2);
        expect(findNoteByTitle(searchResults, "Austria")).toBeTruthy();
        expect(findNoteByTitle(searchResults, "Czech Republic")).toBeTruthy();

        searchResults = searchService.findResultsWithQuery("# note.parents.title = Asia", searchContext);
        expect(searchResults.length).toEqual(1);
        expect(findNoteByTitle(searchResults, "Taiwan")).toBeTruthy();

        searchResults = searchService.findResultsWithQuery("# note.parents.parents.title = Europe", searchContext);
        expect(searchResults.length).toEqual(1);
        expect(findNoteByTitle(searchResults, "Prague")).toBeTruthy();
    });

    it("filter by note's ancestor", () => {
        rootNote
            .child(note("Europe")
                    .child(note("Austria"))
                    .child(note("Czech Republic").child(note("Prague").label("city")))
            )
            .child(note("Asia").child(note("Taiwan").child(note("Taipei").label("city"))));

        const searchContext = new SearchContext();

        let searchResults = searchService.findResultsWithQuery("#city AND note.ancestors.title = Europe", searchContext);
        expect(searchResults.length).toEqual(1);
        expect(findNoteByTitle(searchResults, "Prague")).toBeTruthy();

        searchResults = searchService.findResultsWithQuery("#city AND note.ancestors.title = Asia", searchContext);
        expect(searchResults.length).toEqual(1);
        expect(findNoteByTitle(searchResults, "Taipei")).toBeTruthy();
    });

    it("filter by note's child", () => {
        rootNote
            .child(note("Europe")
                    .child(note("Austria").child(note("Vienna")))
                    .child(note("Czech Republic").child(note("Prague")))
            )
            .child(note("Oceania").child(note("Australia")));

        const searchContext = new SearchContext();

        let searchResults = searchService.findResultsWithQuery("# note.children.title =* Aust", searchContext);
        expect(searchResults.length).toEqual(2);
        expect(findNoteByTitle(searchResults, "Europe")).toBeTruthy();
        expect(findNoteByTitle(searchResults, "Oceania")).toBeTruthy();

        searchResults = searchService.findResultsWithQuery("# note.children.title =* Aust AND note.children.title *= republic", searchContext);
        expect(searchResults.length).toEqual(1);
        expect(findNoteByTitle(searchResults, "Europe")).toBeTruthy();

        searchResults = searchService.findResultsWithQuery("# note.children.children.title = Prague", searchContext);
        expect(searchResults.length).toEqual(1);
        expect(findNoteByTitle(searchResults, "Europe")).toBeTruthy();
    });

    it("filter by relation's note properties using short syntax", () => {
        const austria = note("Austria");
        const portugal = note("Portugal");

        rootNote.child(note("Europe")
                .child(austria)
                .child(note("Czech Republic").relation("neighbor", austria.note))
                .child(portugal)
                .child(note("Spain").relation("neighbor", portugal.note))
        );

        const searchContext = new SearchContext();

        let searchResults = searchService.findResultsWithQuery("# ~neighbor.title = Austria", searchContext);
        expect(searchResults.length).toEqual(1);
        expect(findNoteByTitle(searchResults, "Czech Republic")).toBeTruthy();

        searchResults = searchService.findResultsWithQuery("# ~neighbor.title = Portugal", searchContext);
        expect(searchResults.length).toEqual(1);
        expect(findNoteByTitle(searchResults, "Spain")).toBeTruthy();
    });

    it("filter by relation's note properties using long syntax", () => {
        const austria = note("Austria");
        const portugal = note("Portugal");

        rootNote.child(note("Europe")
                .child(austria)
                .child(note("Czech Republic").relation("neighbor", austria.note))
                .child(portugal)
                .child(note("Spain").relation("neighbor", portugal.note))
        );

        const searchContext = new SearchContext();

        const searchResults = searchService.findResultsWithQuery("# note.relations.neighbor.title = Austria", searchContext);
        expect(searchResults.length).toEqual(1);
        expect(findNoteByTitle(searchResults, "Czech Republic")).toBeTruthy();
    });

    it("filter by multiple level relation", () => {
        const austria = note("Austria");
        const slovakia = note("Slovakia");
        const italy = note("Italy");
        const ukraine = note("Ukraine");

        rootNote.child(note("Europe")
                .child(austria.relation("neighbor", italy.note).relation("neighbor", slovakia.note))
                .child(note("Czech Republic").relation("neighbor", austria.note).relation("neighbor", slovakia.note))
                .child(slovakia.relation("neighbor", ukraine.note))
                .child(ukraine)
        );

        const searchContext = new SearchContext();

        let searchResults = searchService.findResultsWithQuery("# note.relations.neighbor.relations.neighbor.title = Italy", searchContext);
        expect(searchResults.length).toEqual(1);
        expect(findNoteByTitle(searchResults, "Czech Republic")).toBeTruthy();

        searchResults = searchService.findResultsWithQuery("# note.relations.neighbor.relations.neighbor.title = Ukraine", searchContext);
        expect(searchResults.length).toEqual(2);
        expect(findNoteByTitle(searchResults, "Czech Republic")).toBeTruthy();
        expect(findNoteByTitle(searchResults, "Austria")).toBeTruthy();
    });

    it("test note properties", () => {
        const austria = note("Austria");

        austria.relation("myself", austria.note);
        austria.label("capital", "Vienna");
        austria.label("population", "8859000");

        rootNote
            .child(note("Asia"))
            .child(note("Europe").child(austria.child(note("Vienna")).child(note("Sebastian Kurz"))))
            .child(note("Mozart").child(austria));

        austria.note.isProtected = false;
        austria.note.dateCreated = "2020-05-14 12:11:42.001+0200";
        austria.note.dateModified = "2020-05-14 13:11:42.001+0200";
        austria.note.utcDateCreated = "2020-05-14 10:11:42.001Z";
        austria.note.utcDateModified = "2020-05-14 11:11:42.001Z";
        // austria.note.contentLength = 1001;

        const searchContext = new SearchContext();

        function test(propertyName: string, value: string, expectedResultCount: number) {
            const searchResults = searchService.findResultsWithQuery(`# note.${propertyName} = ${value}`, searchContext);
            expect(searchResults.length).toEqual(expectedResultCount);
        }

        test("type", "text", 7);
        test("TYPE", "TEXT", 7);
        test("type", "code", 0);

        test("mime", "text/html", 6);
        test("mime", "application/json", 0);

        test("isProtected", "false", 7);
        test("isProtected", "FALSE", 7);
        test("isProtected", "true", 0);
        test("isProtected", "TRUE", 0);

        test("dateCreated", "'2020-05-14 12:11:42.001+0200'", 1);
        test("dateCreated", "wrong", 0);

        test("dateModified", "'2020-05-14 13:11:42.001+0200'", 1);
        test("dateModified", "wrong", 0);

        test("utcDateCreated", "'2020-05-14 10:11:42.001Z'", 1);
        test("utcDateCreated", "wrong", 0);

        test("utcDateModified", "'2020-05-14 11:11:42.001Z'", 1);
        test("utcDateModified", "wrong", 0);

        test("parentCount", "2", 1);
        test("parentCount", "3", 0);

        test("childrenCount", "2", 1);
        test("childrenCount", "10", 0);

        test("attributeCount", "3", 1);
        test("attributeCount", "4", 0);

        test("labelCount", "2", 1);
        test("labelCount", "3", 0);

        test("relationCount", "1", 1);
        test("relationCount", "2", 0);
    });

    it("test order by", () => {
        const italy = note("Italy").label("capital", "Rome");
        const slovakia = note("Slovakia").label("capital", "Bratislava");
        const austria = note("Austria").label("capital", "Vienna");
        const ukraine = note("Ukraine").label("capital", "Kiev");

        rootNote.child(note("Europe").child(ukraine).child(slovakia).child(austria).child(italy));

        const searchContext = new SearchContext();

        let searchResults = searchService.findResultsWithQuery("# note.parents.title = Europe orderBy note.title", searchContext);
        expect(searchResults.length).toEqual(4);
        expect(becca.notes[searchResults[0].noteId].title).toEqual("Austria");
        expect(becca.notes[searchResults[1].noteId].title).toEqual("Italy");
        expect(becca.notes[searchResults[2].noteId].title).toEqual("Slovakia");
        expect(becca.notes[searchResults[3].noteId].title).toEqual("Ukraine");

        searchResults = searchService.findResultsWithQuery("# note.parents.title = Europe orderBy note.labels.capital", searchContext);
        expect(searchResults.length).toEqual(4);
        expect(becca.notes[searchResults[0].noteId].title).toEqual("Slovakia");
        expect(becca.notes[searchResults[1].noteId].title).toEqual("Ukraine");
        expect(becca.notes[searchResults[2].noteId].title).toEqual("Italy");
        expect(becca.notes[searchResults[3].noteId].title).toEqual("Austria");

        searchResults = searchService.findResultsWithQuery("# note.parents.title = Europe orderBy note.labels.capital DESC", searchContext);
        expect(searchResults.length).toEqual(4);
        expect(becca.notes[searchResults[0].noteId].title).toEqual("Austria");
        expect(becca.notes[searchResults[1].noteId].title).toEqual("Italy");
        expect(becca.notes[searchResults[2].noteId].title).toEqual("Ukraine");
        expect(becca.notes[searchResults[3].noteId].title).toEqual("Slovakia");

        searchResults = searchService.findResultsWithQuery("# note.parents.title = Europe orderBy note.labels.capital DESC limit 2", searchContext);
        expect(searchResults.length).toEqual(2);
        expect(becca.notes[searchResults[0].noteId].title).toEqual("Austria");
        expect(becca.notes[searchResults[1].noteId].title).toEqual("Italy");

        searchResults = searchService.findResultsWithQuery("# note.parents.title = Europe orderBy #capital DESC limit 1", searchContext);
        expect(searchResults.length).toEqual(1);

        searchResults = searchService.findResultsWithQuery("# note.parents.title = Europe orderBy #capital DESC limit 1000", searchContext);
        expect(searchResults.length).toEqual(4);
    });

    it("test not(...)", () => {
        const italy = note("Italy").label("capital", "Rome");
        const slovakia = note("Slovakia").label("capital", "Bratislava");

        rootNote.child(note("Europe").child(slovakia).child(italy));

        const searchContext = new SearchContext();

        let searchResults = searchService.findResultsWithQuery("# not(#capital) and note.noteId != root", searchContext);
        expect(searchResults.length).toEqual(1);
        expect(becca.notes[searchResults[0].noteId].title).toEqual("Europe");

        searchResults = searchService.findResultsWithQuery("#!capital and note.noteId != root", searchContext);
        expect(searchResults.length).toEqual(1);
        expect(becca.notes[searchResults[0].noteId].title).toEqual("Europe");
    });

    it("test note.text *=* something", () => {
        const italy = note("Italy").label("capital", "Rome");
        const slovakia = note("Slovakia").label("capital", "Bratislava");

        rootNote.child(note("Europe").child(slovakia).child(italy));

        const searchContext = new SearchContext();

        let searchResults = searchService.findResultsWithQuery("# note.text *=* vaki and note.noteId != root", searchContext);
        expect(searchResults.length).toEqual(1);
        expect(becca.notes[searchResults[0].noteId].title).toEqual("Slovakia");
    });

    it("test that fulltext does not match archived notes", () => {
        const italy = note("Italy").label("capital", "Rome");
        const slovakia = note("Slovakia").label("capital", "Bratislava");

        rootNote.child(note("Reddit").label("archived", "", true).child(note("Post X")).child(note("Post Y"))).child(note("Reddit is bad"));

        const searchContext = new SearchContext({ includeArchivedNotes: false });

        let searchResults = searchService.findResultsWithQuery("reddit", searchContext);
        expect(searchResults.length).toEqual(1);
        expect(becca.notes[searchResults[0].noteId].title).toEqual("Reddit is bad");
    });

    it("search completes in reasonable time", () => {
        // Create a moderate-sized dataset to test performance
        const countries = ["Austria", "Belgium", "Croatia", "Denmark", "Estonia", "Finland", "Germany", "Hungary", "Ireland", "Japan"];
        const europeanCountries = note("Europe");
        
        countries.forEach(country => {
            europeanCountries.child(note(country).label("type", "country").label("continent", "Europe"));
        });
        
        rootNote.child(europeanCountries);

        const searchContext = new SearchContext();
        const startTime = Date.now();
        
        // Perform a search that exercises multiple features
        const searchResults = searchService.findResultsWithQuery("#type=country AND continent", searchContext);
        
        const endTime = Date.now();
        const duration = endTime - startTime;
        
        // Search should complete in under 1 second for reasonable dataset
        expect(duration).toBeLessThan(1000);
        expect(searchResults.length).toEqual(10);
    });

    it("progressive search always puts exact matches before fuzzy matches", () => {
        rootNote
            .child(note("Analysis Report")) // Exact match
            .child(note("Data Analysis")) // Exact match
            .child(note("Test Analysis")) // Exact match
            .child(note("Advanced Anaylsis")) // Fuzzy match (typo)
            .child(note("Quick Anlaysis")); // Fuzzy match (typo)

        const searchContext = new SearchContext();
        const searchResults = searchService.findResultsWithQuery("analysis", searchContext);

        // With only 3 exact matches (below threshold), fuzzy should be triggered
        // Should find all 5 matches but exact ones should come first
        expect(searchResults.length).toEqual(5);

        // Get note titles in result order
        const resultTitles = searchResults.map(r => becca.notes[r.noteId].title);
        
        // Find all exact matches (contain "analysis")
        const exactMatchIndices = resultTitles.map((title, index) => 
            title.toLowerCase().includes("analysis") ? index : -1
        ).filter(index => index !== -1);
        
        // Find all fuzzy matches (contain typos)
        const fuzzyMatchIndices = resultTitles.map((title, index) => 
            (title.includes("Anaylsis") || title.includes("Anlaysis")) ? index : -1
        ).filter(index => index !== -1);

        expect(exactMatchIndices.length).toEqual(3);
        expect(fuzzyMatchIndices.length).toEqual(2);

        // CRITICAL: All exact matches must appear before all fuzzy matches
        const lastExactIndex = Math.max(...exactMatchIndices);
        const firstFuzzyIndex = Math.min(...fuzzyMatchIndices);
        
        expect(lastExactIndex).toBeLessThan(firstFuzzyIndex);
    });


    // FIXME: test what happens when we order without any filter criteria

    // it("comparison between labels", () => {
    //     rootNote
    //         .child(note("Europe")
    //             .child(note("Austria")
    //                 .label('capital', 'Vienna')
    //                 .label('largestCity', 'Vienna'))
    //             .child(note("Canada")
    //                 .label('capital', 'Ottawa')
    //                 .label('largestCity', 'Toronto'))
    //             .child(note("Czech Republic")
    //                 .label('capital', 'Prague')
    //                 .label('largestCity', 'Prague'))
    //         );
    //
    //     const searchContext = new SearchContext();
    //
    //     const searchResults = searchService.findResultsWithQuery('#capital = #largestCity', searchContext);
    //     expect(searchResults.length).toEqual(2);
    //     expect(findNoteByTitle(searchResults, "Czech Republic")).toBeTruthy();
    //     expect(findNoteByTitle(searchResults, "Austria")).toBeTruthy();
    // })
});
