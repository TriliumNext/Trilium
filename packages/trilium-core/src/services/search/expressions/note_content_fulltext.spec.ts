import { afterEach, beforeEach, describe, expect, it } from "vitest";

import becca from "../../../becca/becca.js";
import BBranch from "../../../becca/entities/bbranch.js";
import BNote from "../../../becca/entities/bnote.js";
import { getContext } from "../../context.js";
import noteService from "../../notes.js";
import protectedSessionService from "../../protected_session.js";
import { getSql } from "../../sql/index.js";
import { decodeBase64, encodeBase64, encodeUtf8 } from "../../utils/binary.js";
import NoteSet from "../note_set.js";
import SearchContext from "../search_context.js";
import { NoteBuilder } from "../../../test/becca_mocking.js";
import NoteContentFulltextExp from "./note_content_fulltext.js";

describe("Fuzzy Search Operators", () => {
    it("~= operator works with typos", () => {
        // Test that the ~= operator can handle common typos
        const expression = new NoteContentFulltextExp("~=", { tokens: ["hello"] });
        expect(expression.tokens).toEqual(["hello"]);
        expect(() => new NoteContentFulltextExp("~=", { tokens: ["he"] })).toThrow(); // Too short
    });

    it("~* operator works with fuzzy contains", () => {
        // Test that the ~* operator handles fuzzy substring matching
        const expression = new NoteContentFulltextExp("~*", { tokens: ["world"] });
        expect(expression.tokens).toEqual(["world"]);
        expect(() => new NoteContentFulltextExp("~*", { tokens: ["wo"] })).toThrow(); // Too short
    });
});

describe("~* fuzzy-contains against note content", () => {
    beforeEach(() => {
        becca.reset();
        new NoteBuilder(new BNote({ noteId: "root", title: "root", type: "text" }));
        new BBranch({ branchId: "none_root", noteId: "root", parentNoteId: "none", notePosition: 10 });
    });

    function matches(operator: string, token: string, content: string): boolean {
        const note = getContext().init(() => noteService.createNewNote({
            parentNoteId: "root",
            title: "Untitled",
            content,
            type: "text"
        }).note);

        const exp = new NoteContentFulltextExp(operator, { tokens: [token] });
        const result = exp.execute(new NoteSet([note]), {}, new SearchContext());
        return result.notes.some(n => n.noteId === note.noteId);
    }

    it("matches a fragment that is a proper substring of a longer word (#10616)", () => {
        // "progr" is a proper substring of "programming"; fuzzy contains must match.
        expect(matches("~*", "progr", "learn programming today")).toBe(true);
        expect(matches("~*", "progr", "nothing relevant here")).toBe(false);
    });

    it("still matches a fuzzy typo that is not a substring", () => {
        // "programing" is one edit from "programming" but not a substring of it.
        expect(matches("~*", "programing", "learn programming today")).toBe(true);
    });
});

describe("fuzzy fallback for note body content (A4)", () => {
    beforeEach(() => {
        becca.reset();
        new NoteBuilder(new BNote({ noteId: "root", title: "root", type: "text" }));
        new BBranch({ branchId: "none_root", noteId: "root", parentNoteId: "none", notePosition: 10 });
    });

    function matchesWithFallback(tokens: string[], content: string, enableFuzzyMatching: boolean): boolean {
        const note = getContext().init(() => noteService.createNewNote({
            parentNoteId: "root",
            title: "Untitled",
            content,
            type: "text"
        }).note);

        const exp = new NoteContentFulltextExp("*=*", { tokens, flatText: true, fuzzyFallback: true });
        const searchContext = new SearchContext();
        searchContext.enableFuzzyMatching = enableFuzzyMatching;
        const result = exp.execute(new NoteSet([note]), {}, searchContext);
        return result.notes.some(n => n.noteId === note.noteId);
    }

    it("finds a body typo only when fuzzy matching is enabled (phase 2)", () => {
        // "combinef" is one edit from the body word "combined" and not a substring.
        expect(matchesWithFallback(["combinef"], "the values were combined here", false)).toBe(false);
        expect(matchesWithFallback(["combinef"], "the values were combined here", true)).toBe(true);
    });

    it("does not trigger the fallback without the fuzzyFallback opt", () => {
        const note = getContext().init(() => noteService.createNewNote({
            parentNoteId: "root",
            title: "Untitled",
            content: "the values were combined here",
            type: "text"
        }).note);

        // Explicit *=* (no fuzzyFallback) stays substring-only even with fuzzy enabled.
        const exp = new NoteContentFulltextExp("*=*", { tokens: ["combinef"], flatText: true });
        const searchContext = new SearchContext();
        searchContext.enableFuzzyMatching = true;
        const result = exp.execute(new NoteSet([note]), {}, searchContext);

        expect(result.notes.some(n => n.noteId === note.noteId)).toBe(false);
    });

    it("records a fuzzy content-match tier for a fallback hit", () => {
        const note = getContext().init(() => noteService.createNewNote({
            parentNoteId: "root",
            title: "Untitled",
            content: "the values were combined here",
            type: "text"
        }).note);

        const exp = new NoteContentFulltextExp("*=*", { tokens: ["combinef"], flatText: true, fuzzyFallback: true });
        const searchContext = new SearchContext();
        searchContext.enableFuzzyMatching = true;
        exp.execute(new NoteSet([note]), {}, searchContext);

        expect(searchContext.contentMatches.get(note.noteId)?.tier).toBe("fuzzy");
    });
});

describe("protected note content", () => {
    beforeEach(() => {
        becca.reset();
        new NoteBuilder(new BNote({ noteId: "root", title: "root", type: "text" }));
        new BBranch({ branchId: "none_root", noteId: "root", parentNoteId: "none", notePosition: 10 });
        protectedSessionService.setDataKey(encodeUtf8("0123456789abcdef"));
    });

    afterEach(() => protectedSessionService.resetDataKey());

    function findsNote(note: BNote, token: string) {
        const exp = new NoteContentFulltextExp("*=*", { tokens: [token] });
        return exp.execute(new NoteSet([note]), {}, new SearchContext()).hasNote(note);
    }

    it("matches a protected note whose content arrived by sync (#8491)", () => {
        const note = getContext().init(() => noteService.createNewNote({
            parentNoteId: "root",
            title: "Protected",
            content: "<p>an artist under constant critique</p>",
            type: "text",
            isProtected: true
        }).note);
        expect(findsNote(note, "critique")).toBe(true);

        // Sync sends a blob's stored content as base64 and `sync_update` writes it back as bytes,
        // so the ciphertext a local save stores as text lands in the database as a BLOB.
        const { blobId } = note;
        const ciphertext = getSql().getValue<string>("SELECT content FROM blobs WHERE blobId = ?", [blobId]);
        expect(typeof ciphertext).toBe("string");
        getSql().execute("UPDATE blobs SET content = ? WHERE blobId = ?", [
            decodeBase64(encodeBase64(encodeUtf8(ciphertext))),
            blobId
        ]);
        expect(getSql().getValue("SELECT typeof(content) FROM blobs WHERE blobId = ?", [blobId])).toBe("blob");
        expect(getContext().init(() => note.getContent())).toBe("<p>an artist under constant critique</p>");

        expect(findsNote(note, "critique")).toBe(true);
    });
});
