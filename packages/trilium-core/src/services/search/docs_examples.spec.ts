/**
 * Validated documentation examples.
 *
 * Every example shown in the search documentation MUST appear here as a test,
 * using the SAME query string and the SAME fixture text as the docs. This spec
 * is the source of truth: the docs may only claim what a test here proves.
 *
 * Docs validated by this file:
 *   docs/User Guide/User Guide/Basic Concepts and Features/Navigation/Search.md
 *   docs/User Guide/User Guide/Basic Concepts and Features/Navigation/Quick search.md
 *
 * When adding a docs example, add its test here first (TDD). If a documented
 * claim does not hold, DO NOT bend the doc or the test — the engine is the
 * authority and the mismatch is a bug to report.
 */
import { describe, it, expect, beforeEach } from "vitest";

import becca from "../../becca/becca.js";
import BBranch from "../../becca/entities/bbranch.js";
import BNote from "../../becca/entities/bnote.js";
import { getContext } from "../context.js";
import dateUtils from "../utils/date.js";
import noteService from "../notes.js";
import { findNoteByTitle, note, NoteBuilder } from "../../test/becca_mocking.js";
import searchService from "./services/search.js";
import SearchContext from "./search_context.js";

describe("Search documentation examples", () => {
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

    /** Creates a real, content-indexed note under root (body text is searchable). */
    function contentNote(title: string, content: string) {
        return getContext().init(() =>
            noteService.createNewNote({
                parentNoteId: "root",
                title,
                content,
                type: "text"
            }).note
        );
    }

    function search(query: string) {
        return searchService.findResultsWithQuery(query, new SearchContext());
    }

    /** Zero-based position of a note in the result list, or -1 if absent. */
    function rank(results: Array<{ noteId: string }>, noteId: string) {
        return results.findIndex((result) => result.noteId === noteId);
    }

    describe('Default matching — no prefix: substring + fuzzy, relevance-ranked', () => {
        // Docs: Search.md § "The three matching modes" — default mode example
        it("`sync` finds the substring `synchronize`, but ranks the exact word `sync` higher", () => {
            const exactWord = contentNote("Guide", "please sync the folders");
            const substring = contentNote("Manual", "synchronize the database now");

            const results = search("sync");

            expect(rank(results, exactWord.noteId)).toBeGreaterThanOrEqual(0);
            expect(rank(results, substring.noteId)).toBeGreaterThanOrEqual(0);
            // exact whole-word match ranks above a mere substring match
            expect(rank(results, exactWord.noteId)).toBeLessThan(rank(results, substring.noteId));
        });
    });

    describe('Exact match prefix (=) — whole word / phrase, punctuation-insensitive, no fuzzy/substring', () => {
        // Docs: Search.md § "Exact match prefix (=)" — example 1
        it("`=sync` matches the whole word even wrapped in punctuation; not a substring, not a typo", () => {
            const paren = contentNote("Paren", "see (sync) mode");
            const comma = contentNote("Comma", "in sync, then continue");
            const quoted = contentNote("Quoted", `he said "sync" out loud`);
            const substring = contentNote("Long", "synchronize the database now");
            const typo = contentNote("Other", "please send the file");

            const results = search("=sync");

            expect(findNoteByTitle(results, "Paren")).toBeTruthy();
            expect(findNoteByTitle(results, "Comma")).toBeTruthy();
            expect(findNoteByTitle(results, "Quoted")).toBeTruthy();
            // no substring: "synchronize" is NOT matched
            expect(findNoteByTitle(results, "Long")).toBeFalsy();
            // no fuzzy: "send" is NOT matched
            expect(findNoteByTitle(results, "Other")).toBeFalsy();
            expect(results.length).toEqual(3);
        });

        // Docs: Search.md § "Exact match prefix (=)" — example 3 (quoted phrase)
        it('`="project plan"` matches the exact phrase in title or content, including across punctuation', () => {
            const titlePhrase = contentNote("Project Plan", "");
            const bodyPhrase = contentNote("Roadmap", "the (project plan) is ready to share");
            const scattered = contentNote("Notes", "the plan for this project is late");

            const results = search('="project plan"');

            expect(findNoteByTitle(results, "Project Plan")).toBeTruthy();
            expect(findNoteByTitle(results, "Roadmap")).toBeTruthy();
            // the words are present but not as a consecutive phrase → no match
            expect(findNoteByTitle(results, "Notes")).toBeFalsy();
            expect(results.length).toEqual(2);
        });
    });

    describe('Attribute / property equality (=, !=) — strict full-value, case/diacritic-insensitive', () => {
        function buildCapitals() {
            const austria = note("Austria").label("capital", "Vienna");
            const somewhere = note("Somewhere").label("capital", "Vienna Austria");
            const czech = note("Czech Republic").label("capital", "Prague");
            const swiss = note("Switzerland").label("capital", "Zürich");
            rootNote.child(austria).child(somewhere).child(czech).child(swiss);
        }

        // Docs: Search.md § "Attribute and property equality" — example 4
        it("`#capital=Vienna` matches the whole value `Vienna`, but NOT `Vienna Austria`", () => {
            buildCapitals();

            const results = search("#capital=Vienna");

            expect(findNoteByTitle(results, "Austria")).toBeTruthy();
            expect(findNoteByTitle(results, "Somewhere")).toBeFalsy();
            expect(results.length).toEqual(1);
        });

        // Docs: Search.md § "Attribute and property equality" — example 4 (quoted full value)
        it('`#capital="Vienna Austria"` matches the full multi-word value', () => {
            buildCapitals();

            const results = search('#capital="Vienna Austria"');

            expect(findNoteByTitle(results, "Somewhere")).toBeTruthy();
            expect(findNoteByTitle(results, "Austria")).toBeFalsy();
            expect(results.length).toEqual(1);
        });

        // Docs: Search.md § "Attribute and property equality" — example 4 (inversion)
        it("`#capital!=Vienna` inverts the equality: every capital label except `Vienna`", () => {
            buildCapitals();

            const results = search("#capital!=Vienna");

            expect(findNoteByTitle(results, "Austria")).toBeFalsy();
            expect(findNoteByTitle(results, "Somewhere")).toBeTruthy();
            expect(findNoteByTitle(results, "Czech Republic")).toBeTruthy();
            expect(findNoteByTitle(results, "Switzerland")).toBeTruthy();
            expect(results.length).toEqual(3);
        });

        // Docs: Search.md § "Attribute and property equality" — example 4 (diacritic-insensitive)
        it("`#capital=Zurich` matches the diacritic value `Zürich` (equality is diacritic-insensitive)", () => {
            buildCapitals();

            const results = search("#capital=Zurich");

            expect(findNoteByTitle(results, "Switzerland")).toBeTruthy();
            expect(results.length).toEqual(1);
        });
    });

    describe('Fuzzy operators (~= fuzzy-equals, ~* fuzzy-contains)', () => {
        // Docs: Search.md § "Fuzzy operators" — example 5
        it("`note.title ~= boks` finds title `Books`; `#author ~= tolkein` finds label value `tolkien`", () => {
            const books = note("Books").label("author", "Tolkien");
            rootNote.child(books);

            // fuzzy-equals on a note property (1 edit: boks → books)
            expect(findNoteByTitle(search("note.title ~= boks"), "Books")).toBeTruthy();
            // fuzzy-equals on a label value (typo: tolkein → tolkien)
            expect(findNoteByTitle(search("#author ~= tolkein"), "Books")).toBeTruthy();
        });

        // Docs: Search.md § "Fuzzy operators" — example 6
        it("`note.content ~* progr` and `~* programing` both find content `programming`", () => {
            const prog = contentNote("Prog", "learn programming today");

            // fragment-contains: a proper substring fragment matches
            expect(rank(search("note.content ~* progr"), prog.noteId)).toBeGreaterThanOrEqual(0);
            // fuzzy-contains: a 1-edit typo that is not a substring still matches
            expect(rank(search("note.content ~* programing"), prog.noteId)).toBeGreaterThanOrEqual(0);
        });
    });

    describe('Fuzzy tolerance (AUTO) — token length decides allowed edits', () => {
        // Docs: Search.md § "Fuzzy tolerance (AUTO)" — length-3-to-5 tier (1 edit)
        it("`cat` (length 3) finds `car` — one edit is allowed for 3-5 character tokens", () => {
            const car = contentNote("Vehicle", "a bright red car");

            expect(rank(search("cat"), car.noteId)).toBeGreaterThanOrEqual(0);
        });

        // Docs: Search.md § "Fuzzy tolerance (AUTO)" — length-3-to-5 tier rejects 2 edits
        it("`ceck` (length 4) does NOT find `tech` — two edits exceed the 1-edit budget", () => {
            const tech = contentNote("News", "the latest tech trends");

            expect(rank(search("ceck"), tech.noteId)).toEqual(-1);
        });

        // Docs: Search.md § "Fuzzy tolerance (AUTO)" — length-6+ tier (2 edits)
        it("`combinef` (length 8) finds `combined` — two edits are allowed for 6+ character tokens", () => {
            const combined = contentNote("Build", "the values were combined together");

            expect(rank(search("combinef"), combined.noteId)).toBeGreaterThanOrEqual(0);
        });
    });

    describe('Phrase and proximity ranking', () => {
        // Docs: Search.md § "Relevance ranking" — example 8
        it("`you and me` ranks the exact phrase above scattered words", () => {
            const phrase = contentNote("Alpha", "I like you and me as a phrase");
            const scattered = contentNote("Beta", "the menu is here and you know it");

            const results = search("you and me");

            const phraseRank = rank(results, phrase.noteId);
            const scatteredRank = rank(results, scattered.noteId);

            expect(phraseRank).toBeGreaterThanOrEqual(0);
            expect(scatteredRank).toBeGreaterThanOrEqual(0);
            expect(phraseRank).toBeLessThan(scatteredRank);
        });
    });

    describe('Link and reference indexing — reference-link target titles are searchable', () => {
        // Docs: Search.md § "What is searchable" — example 9
        it("a note that only reference-links to `Special Topic` is found by `special topic`; the target ranks first", () => {
            const target = contentNote("Special Topic", "");
            const linker = contentNote(
                "Linker",
                `<p>see <a class="reference-link" href="#root/${target.noteId}"></a></p>`
            );

            const results = search("special topic");

            const targetRank = rank(results, target.noteId);
            const linkerRank = rank(results, linker.noteId);

            expect(targetRank).toBeGreaterThanOrEqual(0);
            expect(linkerRank).toBeGreaterThanOrEqual(0);
            // the linked target (direct title match) ranks above the linking note (indirect match)
            expect(targetRank).toBeLessThan(linkerRank);
        });

        // Docs: Search.md § "What is searchable" — example 9 (single word)
        it("a single word `special` from the target's title still finds the reference-linking note", () => {
            const target = contentNote("Special Topic", "");
            const linker = contentNote(
                "Linker",
                `<p>see <a class="reference-link" href="#root/${target.noteId}"></a></p>`
            );

            const results = search("special");

            expect(rank(results, target.noteId)).toBeGreaterThanOrEqual(0);
            expect(rank(results, linker.noteId)).toBeGreaterThanOrEqual(0);
        });

        // Docs: Search.md § "What is searchable" — example 9 (diacritic-insensitive)
        it("`zurich` finds a note reference-linking to a note titled `Zürich` (diacritics normalized)", () => {
            const target = contentNote("Zürich", "");
            const linker = contentNote(
                "Linker",
                `<p>see <a class="reference-link" href="#root/${target.noteId}"></a></p>`
            );

            const results = search("zurich");

            expect(rank(results, linker.noteId)).toBeGreaterThanOrEqual(0);
        });
    });

    describe('Diacritics — normalization strips accents on both sides', () => {
        // Docs: Search.md § "Diacritics" — example 10
        it("`ktory` finds `ktorý`, and `ktorý` finds `ktory`", () => {
            const accented = contentNote("Slovak", "slovo ktorý znamena nieco");
            const plain = contentNote("Plain", "the word ktory appears here");

            expect(findNoteByTitle(search("ktory"), "Slovak")).toBeTruthy();
            expect(findNoteByTitle(search("ktorý"), "Plain")).toBeTruthy();
        });
    });

    describe('Regular expressions (%=)', () => {
        // Docs: Search.md § "Regular expressions" — example 11
        it("`note.content %= 'colou?r'` finds both `color` and `colour`", () => {
            const us = contentNote("US spelling", "my favorite color of all");
            const uk = contentNote("UK spelling", "my favourite colour of all");

            const results = search("note.content %= 'colou?r'");

            expect(findNoteByTitle(results, "US spelling")).toBeTruthy();
            expect(findNoteByTitle(results, "UK spelling")).toBeTruthy();
            expect(results.length).toEqual(2);
        });
    });

    // ------------------------------------------------------------------
    // Legacy reference examples (pre-existing docs sections). Each of the
    // example strings already present in Search.md is validated here so the
    // whole document — not only the newly-authored sections — is covered.
    // ------------------------------------------------------------------

    describe('Legacy: Simple Note Search Examples', () => {
        // Docs: Search.md § "Simple Note Search Examples" — `rings tolkien`
        it("`rings tolkien` finds a note containing both words, not one with only `rings`", () => {
            contentNote("Both", "the rings by tolkien are legendary");
            contentNote("OnlyRings", "the rings saga continues");

            const results = search("rings tolkien");

            expect(findNoteByTitle(results, "Both")).toBeTruthy();
            expect(findNoteByTitle(results, "OnlyRings")).toBeFalsy();
            expect(results.length).toEqual(1);
        });

        // Docs: Search.md § "Simple Note Search Examples" — `"The Lord of the Rings" Tolkien`
        it('`"The Lord of the Rings" Tolkien` requires the exact phrase plus the word', () => {
            contentNote("Book", "The Lord of the Rings was written by Tolkien");
            contentNote("Scrambled", "the rings lord of the tolkien mixed up");

            const results = search('"The Lord of the Rings" Tolkien');

            expect(findNoteByTitle(results, "Book")).toBeTruthy();
            expect(findNoteByTitle(results, "Scrambled")).toBeFalsy();
            expect(results.length).toEqual(1);
        });

        // Docs: Search.md § "Simple Note Search Examples" — `note.content *=* rings OR note.content *=* tolkien`
        it("`note.content *=* rings OR note.content *=* tolkien` matches either substring", () => {
            contentNote("RingsOnly", "many rings here");
            contentNote("TolkienOnly", "written by tolkien");
            contentNote("Neither", "nothing relevant at all");

            const results = search("note.content *=* rings OR note.content *=* tolkien");

            expect(findNoteByTitle(results, "RingsOnly")).toBeTruthy();
            expect(findNoteByTitle(results, "TolkienOnly")).toBeTruthy();
            expect(findNoteByTitle(results, "Neither")).toBeFalsy();
            expect(results.length).toEqual(2);
        });

        // Docs: Search.md § "Simple Note Search Examples" — `towers #book`, `towers #book or #author`, `towers #!book`
        it("combines full-text `towers` with label filters `#book`, `#book or #author`, `#!book`", () => {
            rootNote
                .child(note("Two Towers").label("book"))
                .child(note("Grey Towers").label("author", "someone"))
                .child(note("Dark Towers"))
                .child(note("Random Author").label("author", "other"));

            // full-text AND a label
            let results = search("towers #book");
            expect(findNoteByTitle(results, "Two Towers")).toBeTruthy();
            expect(results.length).toEqual(1);

            // full-text AND (labelA OR labelB): the author-only note (no "towers") is excluded
            results = search("towers #book or #author");
            expect(findNoteByTitle(results, "Two Towers")).toBeTruthy();
            expect(findNoteByTitle(results, "Grey Towers")).toBeTruthy();
            expect(findNoteByTitle(results, "Random Author")).toBeFalsy();
            expect(results.length).toEqual(2);

            // full-text AND NOT a label
            results = search("towers #!book");
            expect(findNoteByTitle(results, "Grey Towers")).toBeTruthy();
            expect(findNoteByTitle(results, "Dark Towers")).toBeTruthy();
            expect(findNoteByTitle(results, "Two Towers")).toBeFalsy();
            expect(results.length).toEqual(2);
        });

        // Docs: Search.md § "Simple Note Search Examples" — `#book #publicationYear = 1954`,
        //  `#book #publicationYear >= 1950 #publicationYear < 1960`, `#publicationYear %= '19[0-9]{2}'`
        it("filters by exact, numeric-range and regex label values on `publicationYear`", () => {
            rootNote
                .child(note("The Lord of the Rings").label("book").label("publicationYear", "1954"))
                .child(note("The Hobbit").label("book").label("publicationYear", "1937"))
                .child(note("Later Book").label("book").label("publicationYear", "1965"))
                .child(note("Modern Book").label("book").label("publicationYear", "2001"));

            // exact numeric equality
            let results = search("#book #publicationYear = 1954");
            expect(findNoteByTitle(results, "The Lord of the Rings")).toBeTruthy();
            expect(results.length).toEqual(1);

            // numeric range (the 1950s)
            results = search("#book #publicationYear >= 1950 #publicationYear < 1960");
            expect(findNoteByTitle(results, "The Lord of the Rings")).toBeTruthy();
            expect(results.length).toEqual(1);

            // regex: a 4-digit year in the 1900s
            results = search("#publicationYear %= '19[0-9]{2}'");
            expect(findNoteByTitle(results, "The Lord of the Rings")).toBeTruthy();
            expect(findNoteByTitle(results, "The Hobbit")).toBeTruthy();
            expect(findNoteByTitle(results, "Later Book")).toBeTruthy();
            expect(findNoteByTitle(results, "Modern Book")).toBeFalsy();
            expect(results.length).toEqual(3);
        });

        // Docs: Search.md § "Simple Note Search Examples" — `#genre *=* fan`
        it("`#genre *=* fan` matches a label value containing the substring `fan`", () => {
            rootNote
                .child(note("Fantasy Novel").label("genre", "fantasy"))
                .child(note("SciFi Novel").label("genre", "science fiction"));

            const results = search("#genre *=* fan");

            expect(findNoteByTitle(results, "Fantasy Novel")).toBeTruthy();
            expect(findNoteByTitle(results, "SciFi Novel")).toBeFalsy();
            expect(results.length).toEqual(1);
        });

        // Docs: Search.md § "Simple Note Search Examples" — `#dateNote >= TODAY-30`
        it("`#dateNote >= TODAY-30` matches a recent date but not an old one (smart date)", () => {
            rootNote
                .child(note("Recent").label("dateNote", dateUtils.localNowDate()))
                .child(note("Old").label("dateNote", "2000-01-01"));

            const results = search("#dateNote >= TODAY-30");

            expect(findNoteByTitle(results, "Recent")).toBeTruthy();
            expect(findNoteByTitle(results, "Old")).toBeFalsy();
            expect(results.length).toEqual(1);
        });

        // Docs: Search.md § "Simple Note Search Examples" — `~author.title *=* Tolkien`
        it("`~author.title *=* Tolkien` matches via the related author note's title", () => {
            const tolkien = note("J. R. R. Tolkien");
            const herbert = note("Frank Herbert");
            rootNote
                .child(tolkien)
                .child(herbert)
                .child(note("Lord of the Rings").relation("author", tolkien.note))
                .child(note("Dune").relation("author", herbert.note));

            const results = search("~author.title *=* Tolkien");

            expect(findNoteByTitle(results, "Lord of the Rings")).toBeTruthy();
            expect(findNoteByTitle(results, "Dune")).toBeFalsy();
            expect(results.length).toEqual(1);
        });

        // Docs: Search.md § "Simple Note Search Examples" — `note.content %= '\d{2}:\d{2} (PM|AM)'`
        // NOTE: the docs render the backslashes as `\\d` (a literal backslash must be
        // escaped in the query); in JS source that literal `\\` is written `\\\\`.
        it("`note.content %= '\\\\d{2}:\\\\d{2} (PM|AM)'` matches note content mentioning a time", () => {
            contentNote("Meeting", "the call is at 12:30 PM today");
            contentNote("Plain", "no time here just words");

            const results = search("note.content %= '\\\\d{2}:\\\\d{2} (PM|AM)'");

            expect(findNoteByTitle(results, "Meeting")).toBeTruthy();
            expect(findNoteByTitle(results, "Plain")).toBeFalsy();
            expect(results.length).toEqual(1);
        });
    });

    describe('Legacy: Advanced Use Cases', () => {
        // Docs: Search.md § "Advanced Use Cases" — `~author.relations.son.title = 'Christopher Tolkien'`
        it("`~author.relations.son.title = 'Christopher Tolkien'` traverses two relation hops", () => {
            const christopher = note("Christopher Tolkien");
            const brian = note("Brian Herbert");
            const jrr = note("J. R. R. Tolkien").relation("son", christopher.note);
            const frank = note("Frank Herbert").relation("son", brian.note);
            rootNote
                .child(christopher)
                .child(brian)
                .child(jrr)
                .child(frank)
                .child(note("Lord of the Rings").label("book").relation("author", jrr.note))
                .child(note("Dune").label("book").relation("author", frank.note));

            const results = search("~author.relations.son.title = 'Christopher Tolkien'");

            expect(findNoteByTitle(results, "Lord of the Rings")).toBeTruthy();
            expect(findNoteByTitle(results, "Dune")).toBeFalsy();
            expect(results.length).toEqual(1);
        });

        // Docs: Search.md § "Advanced Use Cases" — boolean expression with grouping parentheses
        it("`~author.title *= Tolkien OR (#publicationDate >= 1954 AND #publicationDate <= 1960)` groups clauses", () => {
            const tolkien = note("J. R. R. Tolkien");
            rootNote
                .child(tolkien)
                .child(note("Lord of the Rings").relation("author", tolkien.note))
                .child(note("Mid Century").label("publicationDate", "1955"))
                .child(note("Modern").label("publicationDate", "1990"));

            const results = search("~author.title *= Tolkien OR (#publicationDate >= 1954 AND #publicationDate <= 1960)");

            expect(findNoteByTitle(results, "Lord of the Rings")).toBeTruthy();
            expect(findNoteByTitle(results, "Mid Century")).toBeTruthy();
            expect(findNoteByTitle(results, "Modern")).toBeFalsy();
            expect(results.length).toEqual(2);
        });

        // Docs: Search.md § "Advanced Use Cases" — `note.parents.title`, `note.parents.parents.title`, `note.ancestors.title`
        it("filters by parent, grandparent and ancestor title against a `Books` subtree", () => {
            const lotr = note("Lord of the Rings");
            const fiction = note("Fiction").child(lotr);
            const books = note("Books").child(fiction);
            rootNote.child(books).child(note("Movies").child(note("Inception")));

            // direct parent named Books
            let results = search("note.parents.title = 'Books'");
            expect(findNoteByTitle(results, "Fiction")).toBeTruthy();
            expect(results.length).toEqual(1);

            // grandparent named Books
            results = search("note.parents.parents.title = 'Books'");
            expect(findNoteByTitle(results, "Lord of the Rings")).toBeTruthy();
            expect(results.length).toEqual(1);

            // any ancestor named Books — note the filter is subtree-inclusive: it
            // returns the "Books" note itself as well as its descendants.
            results = search("note.ancestors.title = 'Books'");
            expect(findNoteByTitle(results, "Fiction")).toBeTruthy();
            expect(findNoteByTitle(results, "Lord of the Rings")).toBeTruthy();
            expect(findNoteByTitle(results, "Books")).toBeTruthy();
            expect(findNoteByTitle(results, "Inception")).toBeFalsy();
            expect(results.length).toEqual(3);
        });

        // Docs: Search.md § "Advanced Use Cases" — `note.children.title = 'sub-note'`
        it("`note.children.title = 'sub-note'` matches a note that has such a child", () => {
            rootNote
                .child(note("Parent Note").child(note("sub-note")))
                .child(note("Lonely Note"));

            const results = search("note.children.title = 'sub-note'");

            expect(findNoteByTitle(results, "Parent Note")).toBeTruthy();
            expect(findNoteByTitle(results, "Lonely Note")).toBeFalsy();
            expect(results.length).toEqual(1);
        });
    });

    describe('Legacy: Note Properties', () => {
        // Docs: Search.md § "Search with Note Properties" — `note.type = code AND note.mime = 'application/json'`
        it("`note.type = code AND note.mime = 'application/json'` filters by type and mime", () => {
            rootNote
                .child(note("Config", { type: "code", mime: "application/json" }))
                .child(note("Script", { type: "code", mime: "application/javascript" }))
                .child(note("Doc", { type: "text", mime: "text/html" }));

            const results = search("note.type = code AND note.mime = 'application/json'");

            expect(findNoteByTitle(results, "Config")).toBeTruthy();
            expect(findNoteByTitle(results, "Script")).toBeFalsy();
            expect(findNoteByTitle(results, "Doc")).toBeFalsy();
            expect(results.length).toEqual(1);
        });
    });

    describe('Legacy: Order by and Limit', () => {
        // Docs: Search.md § "Order by and Limit" — `#author=Tolkien orderBy #publicationDate desc, note.title limit 10`
        it("orders by publication date descending with a title tie-breaker, limited", () => {
            rootNote
                .child(note("The Hobbit").label("author", "Tolkien").label("publicationDate", "1937"))
                .child(note("Fellowship").label("author", "Tolkien").label("publicationDate", "1954"))
                .child(note("Two Towers").label("author", "Tolkien").label("publicationDate", "1954"))
                .child(note("Dune").label("author", "Herbert").label("publicationDate", "1965"));

            const results = search("#author=Tolkien orderBy #publicationDate desc, note.title limit 10");

            // Only the three Tolkien books; Dune (author Herbert) is excluded.
            expect(results.length).toEqual(3);
            // 1954 books first (ties broken by title ascending), then 1937.
            expect(becca.notes[results[0].noteId]?.title).toEqual("Fellowship");
            expect(becca.notes[results[1].noteId]?.title).toEqual("Two Towers");
            expect(becca.notes[results[2].noteId]?.title).toEqual("The Hobbit");
        });
    });

    describe('Legacy: Negation', () => {
        // Docs: Search.md § "Negation" — `#book AND not(note.ancestors.title = 'Tolkien')`
        // NOTE: the docs previously wrote the singular `note.ancestor.title`, which is an
        // unrecognized property specifier and returns garbage; corrected to the plural
        // `note.ancestors.title` (see task report).
        it("`#book AND not(note.ancestors.title = 'Tolkien')` finds books outside the Tolkien subtree", () => {
            rootNote
                .child(note("Tolkien").child(note("LOTR").label("book")))
                .child(note("Herbert").child(note("Dune").label("book")));

            const results = search("#book AND not(note.ancestors.title = 'Tolkien')");

            expect(findNoteByTitle(results, "Dune")).toBeTruthy();
            expect(findNoteByTitle(results, "LOTR")).toBeFalsy();
            expect(results.length).toEqual(1);
        });
    });
});
