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
});
