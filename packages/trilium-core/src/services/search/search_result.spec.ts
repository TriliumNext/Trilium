import { beforeEach, describe, expect, it } from "vitest";

import { getBecca } from "../../becca/becca.js";
import BBranch from "../../becca/entities/bbranch.js";
import BNote from "../../becca/entities/bnote.js";
import { note, NoteBuilder } from "../../test/becca_mocking.js";
import SearchResult from "./search_result.js";

let rootNote: NoteBuilder;

/** Build a SearchResult for a note reachable directly under root. */
function resultFor(noteBuilder: NoteBuilder) {
    return new SearchResult(["root", noteBuilder.note.noteId]);
}

describe("SearchResult", () => {
    beforeEach(() => {
        getBecca().reset();

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
