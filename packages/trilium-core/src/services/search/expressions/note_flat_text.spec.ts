import { beforeEach, describe, expect, it } from "vitest";

import becca from "../../../becca/becca.js";
import BBranch from "../../../becca/entities/bbranch.js";
import BNote from "../../../becca/entities/bnote.js";
import { note, NoteBuilder } from "../../../test/becca_mocking.js";
import NoteSet from "../note_set.js";
import NoteFlatTextExp from "./note_flat_text.js";

/**
 * Minimal SearchContext stand-in. execute() only reads `autocomplete`,
 * `enableFuzzyMatching` and `highlightedTokens`, so a plain object suffices.
 */
function searchContext(overrides: Record<string, unknown> = {}) {
    return {
        autocomplete: false,
        enableFuzzyMatching: false,
        highlightedTokens: [] as string[],
        ...overrides
    } as any;
}

/** Build a NoteSet containing every note currently registered in becca. */
function allNotesSet() {
    return new NoteSet(Object.values(becca.notes));
}

function execute(exp: NoteFlatTextExp, ctx = searchContext(), inputNoteSet = allNotesSet()) {
    const executionContext = { noteIdToNotePath: {} as Record<string, string[]> };
    const result = exp.execute(inputNoteSet, executionContext, ctx);
    return { result, executionContext };
}

function noteIds(noteSet: NoteSet) {
    return noteSet.notes.map((n) => n.noteId).sort();
}

let rootNote: NoteBuilder;

describe("NoteFlatTextExp", () => {
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

    it("normalizes tokens in the constructor (lowercasing and stripping diacritics)", () => {
        const exp = new NoteFlatTextExp(["Café", "HELLO"]);
        expect(exp.tokens).toEqual(["cafe", "hello"]);
    });

    it("matches notes by a title token and records the resolved note path", () => {
        const austria = note("Austria");
        const germany = note("Germany");
        rootNote.child(austria).child(germany);

        const exp = new NoteFlatTextExp(["austria"]);
        const { result, executionContext } = execute(exp);

        expect(noteIds(result)).toEqual([austria.note.noteId]);
        // The path is recorded for the matched note and ends at that note.
        const recordedPath = executionContext.noteIdToNotePath[austria.note.noteId];
        expect(recordedPath[recordedPath.length - 1]).toBe(austria.note.noteId);
        expect(recordedPath[0]).toBe("root");
    });

    it("returns an empty set when no candidate note contains any token", () => {
        rootNote.child(note("Austria"));

        const { result } = execute(new NoteFlatTextExp(["nonexistenttoken"]));

        expect(result.notes).toHaveLength(0);
    });

    it("requires every token to be matched along the path towards the root", () => {
        // "europe" lives on the parent, "austria" on the child; both tokens together
        // are only satisfied by walking the child's path up to its parent.
        const europe = note("Europe");
        const austria = note("Austria");
        const asia = note("Asia");
        rootNote.child(europe.child(austria)).child(asia);

        const both = new NoteFlatTextExp(["europe", "austria"]);
        expect(noteIds(execute(both).result)).toEqual([austria.note.noteId]);

        // A token that appears on neither the note nor its ancestors yields nothing,
        // even though one of the two tokens does match.
        const partial = new NoteFlatTextExp(["austria", "africa"]);
        expect(execute(partial).result.notes).toHaveLength(0);
    });

    it("matches by attribute name and value", () => {
        const tagged = note("Plain").label("country", "austria");
        rootNote.child(tagged);

        // matches on the label value...
        expect(noteIds(execute(new NoteFlatTextExp(["austria"])).result)).toEqual([
            tagged.note.noteId
        ]);
        // ...and on the label name.
        expect(noteIds(execute(new NoteFlatTextExp(["country"])).result)).toEqual([
            tagged.note.noteId
        ]);
    });

    it("matches by note type and mime", () => {
        const code = note("Snippet", { type: "code", mime: "application/javascript" });
        rootNote.child(code);

        expect(noteIds(execute(new NoteFlatTextExp(["javascript"])).result)).toEqual([
            code.note.noteId
        ]);
    });

    it("finds a note by its noteId for a single token (leaf lookup)", () => {
        const target = note("Hidden Title", { noteId: "abcdef0123" });
        rootNote.child(target);

        const exp = new NoteFlatTextExp(["abcdef0123"]);
        const { result, executionContext } = execute(exp);

        expect(noteIds(result)).toEqual(["abcdef0123"]);
        expect(executionContext.noteIdToNotePath["abcdef0123"]).toBeDefined();
    });

    it("uses the single-token autocomplete fast path", () => {
        const austria = note("Austria");
        const australia = note("Australia");
        rootNote.child(austria).child(australia);

        const exp = new NoteFlatTextExp(["austr"]);
        const { result, executionContext } = execute(exp, searchContext({ autocomplete: true }));

        // Both notes contain "austr" in their flat text, so both are returned and
        // each gets a best note path recorded.
        expect(noteIds(result)).toEqual([australia.note.noteId, austria.note.noteId].sort());
        expect(executionContext.noteIdToNotePath[austria.note.noteId]).toBeDefined();
        expect(executionContext.noteIdToNotePath[australia.note.noteId]).toBeDefined();
    });

    it("does not return duplicate notes when a note is matched via multiple parents", () => {
        const austria = note("Austria");
        const europe = note("Europe");
        const continent = note("Continent");
        // Clone austria under two different parents.
        rootNote.child(europe.child(austria)).child(continent.child(austria));

        const { result } = execute(new NoteFlatTextExp(["austria"]));

        const matches = result.notes.filter((n) => n.noteId === austria.note.noteId);
        expect(matches).toHaveLength(1);
    });

    it("restricts results to notes present in the input note set", () => {
        const austria = note("Austria");
        const australia = note("Australia");
        rootNote.child(austria).child(australia);

        const exp = new NoteFlatTextExp(["austr"]);
        const restricted = new NoteSet([austria.note]);
        const { result } = execute(exp, searchContext(), restricted);

        expect(noteIds(result)).toEqual([austria.note.noteId]);
    });

    it("supports fuzzy matching only when enabled and records the highlighted word", () => {
        const austria = note("Austria");
        rootNote.child(austria);

        // Typo "austira" (>= 4 chars) should not match with fuzzy matching disabled.
        const noFuzzy = new NoteFlatTextExp(["austira"]);
        expect(execute(noFuzzy, searchContext({ enableFuzzyMatching: false })).result.notes)
            .toHaveLength(0);

        // With fuzzy matching enabled it matches and the matched word is tracked.
        const ctx = searchContext({ enableFuzzyMatching: true });
        const fuzzy = new NoteFlatTextExp(["austira"]);
        const { result } = execute(fuzzy, ctx);
        expect(noteIds(result)).toEqual([austria.note.noteId]);
        expect(ctx.highlightedTokens).toContain("austria");
    });

    describe("getNotePath", () => {
        it("throws when the taken path is empty", () => {
            const austria = note("Austria");
            rootNote.child(austria);

            const exp = new NoteFlatTextExp(["austria"]);
            expect(() => exp.getNotePath(austria.note, [])).toThrow(/empty/);
        });

        it("returns the best note path when the taken path is just the note itself", () => {
            const austria = note("Austria");
            rootNote.child(austria);

            const exp = new NoteFlatTextExp(["austria"]);
            const path = exp.getNotePath(austria.note, [austria.note.noteId]);
            expect(path[path.length - 1]).toBe(austria.note.noteId);
            expect(path[0]).toBe("root");
        });

        it("prefixes the best path of the top-most matching note for a longer taken path", () => {
            const europe = note("Europe");
            const austria = note("Austria");
            rootNote.child(europe.child(austria));

            const exp = new NoteFlatTextExp(["europe"]);
            // takenPath: [child, ...] where the first element is the closest-to-root match.
            const path = exp.getNotePath(europe.note, [europe.note.noteId, austria.note.noteId]);
            expect(path[0]).toBe("root");
            expect(path[path.length - 1]).toBe(austria.note.noteId);
            expect(path).toContain(europe.note.noteId);
        });
    });

    describe("getCandidateNotes", () => {
        it("returns notes whose flat text matches at least one token", () => {
            const austria = note("Austria");
            const germany = note("Germany");
            rootNote.child(austria).child(germany);

            const exp = new NoteFlatTextExp(["austria"]);
            const candidates = exp.getCandidateNotes(allNotesSet(), searchContext());

            expect(candidates.map((n) => n.noteId)).toContain(austria.note.noteId);
            expect(candidates.map((n) => n.noteId)).not.toContain(germany.note.noteId);
        });

        it("only considers notes within the supplied note set when it is a subset", () => {
            const austria = note("Austria");
            const australia = note("Australia");
            rootNote.child(austria).child(australia);

            const exp = new NoteFlatTextExp(["austr"]);
            const subset = new NoteSet([australia.note]);
            const candidates = exp.getCandidateNotes(subset, searchContext());

            expect(candidates.map((n) => n.noteId)).toEqual([australia.note.noteId]);
        });
    });
});
