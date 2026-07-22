import { beforeEach, describe, expect, it } from "vitest";

import becca from "../../becca/becca.js";
import BBranch from "../../becca/entities/bbranch.js";
import BNote from "../../becca/entities/bnote.js";
import { note, NoteBuilder } from "../../test/becca_mocking.js";
import type { ContentMatchQuality, ContentMatchTier } from "./match_quality.js";
import SearchResult from "./search_result.js";

let rootNote: NoteBuilder;

/** Build a SearchResult for a note reachable directly under root. */
function resultFor(noteBuilder: NoteBuilder) {
    return new SearchResult(["root", noteBuilder.note.noteId]);
}

describe("SearchResult", () => {
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

    describe("constructor and getters", () => {
        it("derives notePath, noteId, and notePathTitle from the path array", () => {
            const austria = note("Austria");
            rootNote.child(austria);

            const result = new SearchResult(["root", austria.note.noteId]);

            expect(result.notePath).toBe(`root/${austria.note.noteId}`);
            expect(result.noteId).toBe(austria.note.noteId);
            // The path title joins ancestor titles below the hoisted (root) note.
            expect(result.notePathTitle).toBe("Austria");
            expect(result.score).toBe(0);
        });

        it("returns the last path segment as noteId for a deeper path", () => {
            const parent = note("Parent");
            const child = note("Child");
            parent.child(child);
            rootNote.child(parent);

            const result = new SearchResult(["root", parent.note.noteId, child.note.noteId]);

            expect(result.noteId).toBe(child.note.noteId);
            expect(result.notePath).toBe(`root/${parent.note.noteId}/${child.note.noteId}`);
            expect(result.notePathTitle).toBe("Parent › Child");
        });
    });

    describe("computeScore - title matching", () => {
        it("awards the exact-title bonus when the query equals the title", () => {
            const target = note("Austria");
            rootNote.child(target);

            const result = resultFor(target);
            result.computeScore("austria", ["austria"]);

            // Exact title match (2000) + exact token match on the title chunk.
            expect(result.score).toBeGreaterThanOrEqual(2000);
        });

        it("ranks an exact title match above a prefix match above a word match", () => {
            const exact = note("Vienna");
            const prefix = note("Vienna City");
            const word = note("The Vienna Region");
            rootNote.child(exact).child(prefix).child(word);

            const exactResult = resultFor(exact);
            exactResult.computeScore("vienna", ["vienna"], false);

            const prefixResult = resultFor(prefix);
            prefixResult.computeScore("vienna", ["vienna"], false);

            const wordResult = resultFor(word);
            wordResult.computeScore("vienna", ["vienna"], false);

            expect(exactResult.score).toBeGreaterThan(prefixResult.score);
            expect(prefixResult.score).toBeGreaterThan(wordResult.score);
        });

        it("matches the query as a complete word at the start, middle, and end of the title", () => {
            const start = note("vienna is great");
            const middle = note("the vienna region");
            const end = note("welcome to vienna");
            rootNote.child(start).child(middle).child(end);

            for (const builder of [start, middle, end]) {
                const result = resultFor(builder);
                // Disable fuzzy matching so any score reflects the word-match branch / tokens.
                result.computeScore("vienna", ["vienna"], false);
                // Word match (300) is awarded for all three positions.
                expect(result.score).toBeGreaterThanOrEqual(300);
            }
        });
    });

    describe("computeScore - note id matching", () => {
        it("adds the note-id bonus when the query equals the note id", () => {
            const target = note("Some title", { noteId: "abc123" });
            rootNote.child(target);

            const result = new SearchResult(["root", "abc123"]);
            // Query equals the lowercased note id but not the title.
            result.computeScore("abc123", ["abc123"], false);

            // Note-id exact match contributes 1000.
            expect(result.score).toBeGreaterThanOrEqual(1000);
        });
    });

    describe("computeScore - token matching via addScoreForStrings", () => {
        it("scores exact token matches higher than prefix matches higher than contains matches", () => {
            const target = note("alpha");
            rootNote.child(target);
            const result = resultFor(target);

            const exact = new SearchResult(["root", target.note.noteId]);
            exact.addScoreForStrings(["alpha"], "alpha", 1, false);

            const prefix = new SearchResult(["root", target.note.noteId]);
            prefix.addScoreForStrings(["alph"], "alpha", 1, false);

            const contains = new SearchResult(["root", target.note.noteId]);
            contains.addScoreForStrings(["lph"], "alpha", 1, false);

            expect(exact.score).toBeGreaterThan(prefix.score);
            expect(prefix.score).toBeGreaterThan(contains.score);
            expect(contains.score).toBeGreaterThan(0);
            // result is only constructed to anchor the note in becca for getNoteTitleForPath.
            expect(result.score).toBe(0);
        });

        it("scales the token score by the factor and the token length", () => {
            const target = note("alpha");
            rootNote.child(target);

            const single = new SearchResult(["root", target.note.noteId]);
            single.addScoreForStrings(["alpha"], "alpha", 1, false);

            const doubled = new SearchResult(["root", target.note.noteId]);
            doubled.addScoreForStrings(["alpha"], "alpha", 2, false);

            // factor 2 yields exactly double the exact-match contribution.
            expect(doubled.score).toBeCloseTo(single.score * 2);
        });

        it("scores a punctuation-wrapped chunk as an exact token match (#10616)", () => {
            const target = note("alpha");
            rootNote.child(target);

            // "(sync)" tokenizes to the word "sync", so it must score as an exact
            // token match — identical to an unwrapped "sync" chunk — rather than a
            // weaker contains match.
            const wrapped = new SearchResult(["root", target.note.noteId]);
            wrapped.addScoreForStrings(["sync"], "(sync) notes", 1, false);

            const bare = new SearchResult(["root", target.note.noteId]);
            bare.addScoreForStrings(["sync"], "sync notes", 1, false);

            const contains = new SearchResult(["root", target.note.noteId]);
            contains.addScoreForStrings(["sync"], "asynchronous", 1, false);

            expect(wrapped.score).toBe(bare.score);
            expect(wrapped.score).toBeGreaterThan(contains.score);
        });

        it("does not award token score when no chunk matches", () => {
            const target = note("alpha");
            rootNote.child(target);

            const result = new SearchResult(["root", target.note.noteId]);
            result.addScoreForStrings(["zzz"], "alpha", 1, false);

            expect(result.score).toBe(0);
        });
    });

    describe("computeScore - hidden subtree penalty", () => {
        it("divides the total score by the hidden-note penalty for hidden notes", () => {
            const hidden = new NoteBuilder(new BNote({ noteId: "_hidden", title: "Vienna", type: "text" }));
            new BBranch({
                branchId: "root__hidden",
                noteId: "_hidden",
                parentNoteId: "root",
                notePosition: 10
            });

            const result = new SearchResult(["root", "_hidden"]);
            result.computeScore("vienna", ["vienna"], false);

            const visible = note("Vienna");
            rootNote.child(visible);
            const visibleResult = resultFor(visible);
            visibleResult.computeScore("vienna", ["vienna"], false);

            expect(hidden.note.isInHiddenSubtree()).toBe(true);
            // Hidden note score is exactly one third (penalty = 3) of the visible equivalent.
            expect(result.score).toBeCloseTo(visibleResult.score / 3);
        });
    });

    describe("computeScore - content-aware scoring", () => {
        /** A content-only note whose title/path never matches the query, so the
         * score reflects only the supplied content match. */
        function contentOnlyScore(contentMatch: ContentMatchQuality | undefined): number {
            const target = note("Zzz Unrelated Title");
            rootNote.child(target);
            const result = resultFor(target);
            // Query tokens deliberately absent from the title; fuzzy disabled.
            result.computeScore("qqzzxx", ["qqzzxx"], false, contentMatch);
            return result.score;
        }

        it("adds the tier weight for a single matched token", () => {
            const expectations: [ContentMatchTier, boolean, number][] = [
                ["substring", false, 15],
                ["word_prefix", false, 30],
                ["exact_word", false, 60],
                ["proximity", false, 80],
                ["proximity", true, 100],
                ["exact_phrase", false, 150],
                ["fuzzy", false, 5]
            ];

            for (const [tier, inOrder, expected] of expectations) {
                expect(contentOnlyScore({ tier, matchedTokenCount: 1, inOrder })).toBe(expected);
            }
        });

        it("awards a per-token bonus beyond the first token, capped at five tokens", () => {
            expect(contentOnlyScore({ tier: "substring", matchedTokenCount: 1, inOrder: false })).toBe(15);
            expect(contentOnlyScore({ tier: "substring", matchedTokenCount: 2, inOrder: false })).toBe(20);
            expect(contentOnlyScore({ tier: "substring", matchedTokenCount: 5, inOrder: false })).toBe(35);
            // Sixth+ token contributes nothing beyond the five-token cap.
            expect(contentOnlyScore({ tier: "substring", matchedTokenCount: 6, inOrder: false })).toBe(35);
        });

        it("leaves legacy scores unchanged when no content match is supplied", () => {
            const target = note("Vienna");
            rootNote.child(target);

            const withUndefined = resultFor(target);
            withUndefined.computeScore("vienna", ["vienna"], false, undefined);

            const withoutArg = resultFor(target);
            withoutArg.computeScore("vienna", ["vienna"], false);

            expect(withUndefined.score).toBe(withoutArg.score);
            // Exact title match dominates; no content contribution applied.
            expect(withUndefined.score).toBeGreaterThanOrEqual(2000);
        });

        it("keeps the maximum content contribution below the title-word-match weight (300)", () => {
            const tiers: ContentMatchTier[] = [
                "fuzzy",
                "substring",
                "word_prefix",
                "exact_word",
                "proximity",
                "exact_phrase"
            ];

            let maxContent = 0;
            for (const tier of tiers) {
                // matchedTokenCount 5 and inOrder maximise the contribution.
                maxContent = Math.max(maxContent, contentOnlyScore({ tier, matchedTokenCount: 5, inOrder: true }));
            }

            // exact_phrase (150) + 4-token bonus (20) = 170 is the ceiling; the
            // in-order bonus never applies to exact_phrase, so it stays under 190.
            expect(maxContent).toBe(170);
            expect(maxContent).toBeLessThan(300); // TITLE_WORD_MATCH
        });

        it("ranks an exact-title note above any content-only match for the same query", () => {
            const titled = note("sync");
            const bodyOnly = note("Unrelated");
            rootNote.child(titled).child(bodyOnly);

            const titleResult = resultFor(titled);
            titleResult.computeScore("sync", ["sync"], false);

            const contentResult = resultFor(bodyOnly);
            contentResult.computeScore("sync", ["sync"], false, { tier: "exact_phrase", matchedTokenCount: 5, inOrder: true });

            expect(titleResult.score).toBeGreaterThan(contentResult.score);
        });

        it("feeds a fuzzy content contribution into the fuzzy-score cap", () => {
            // Build a query whose many tokens each fuzzy-match a distinct title word,
            // driving the fuzzy budget to MAX_TOTAL_FUZZY_SCORE. Once the budget is
            // exhausted, an additional fuzzy content match must contribute nothing.
            const titleWords = Array.from({ length: 300 }, (_, i) => `wordaaa${i}`);
            const tokens = Array.from({ length: 300 }, (_, i) => `wordaab${i}`); // edit distance 1 each
            const target = note(titleWords.join(" "));
            rootNote.child(target);

            const withFuzzyContent = resultFor(target);
            withFuzzyContent.computeScore("nomatchquery", tokens, true, { tier: "fuzzy", matchedTokenCount: 5, inOrder: false });

            const withoutContent = resultFor(target);
            withoutContent.computeScore("nomatchquery", tokens, true, undefined);

            // The fuzzy budget was already capped, so the fuzzy content match added 0.
            expect(withFuzzyContent.score).toBe(withoutContent.score);

            // Sanity: on a fresh budget the very same fuzzy content match does contribute,
            // proving the equality above is the cap gating it rather than a no-op.
            const fresh = note("Totally Different Title");
            rootNote.child(fresh);
            const freshResult = resultFor(fresh);
            freshResult.computeScore("zzznomatch", ["zzznomatch"], true, { tier: "fuzzy", matchedTokenCount: 5, inOrder: false });
            expect(freshResult.score).toBeGreaterThan(0);
        });
    });

    describe("computeScore - fuzzy matching", () => {
        it("awards a fuzzy title score for a near-miss query only when fuzzy matching is enabled", () => {
            const target = note("Vienna");
            rootNote.child(target);

            const fuzzy = resultFor(target);
            // "vienne" is one substitution away from "vienna".
            fuzzy.computeScore("vienne", ["vienne"], true);

            const strict = resultFor(target);
            strict.computeScore("vienne", ["vienne"], false);

            expect(fuzzy.score).toBeGreaterThan(strict.score);
        });

        it("ranks a fuzzy match strictly below an exact title match", () => {
            const exact = note("Vienna");
            const typo = note("Vienna");
            rootNote.child(exact).child(typo);

            const exactResult = resultFor(exact);
            exactResult.computeScore("vienna", ["vienna"], true);

            const fuzzyResult = resultFor(typo);
            fuzzyResult.computeScore("vienne", ["vienne"], true);

            expect(exactResult.score).toBeGreaterThan(fuzzyResult.score);
        });
    });
});
