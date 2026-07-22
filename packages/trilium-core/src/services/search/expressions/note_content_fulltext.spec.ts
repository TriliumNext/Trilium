import { beforeEach, describe, expect, it } from "vitest";

import becca from "../../../becca/becca.js";
import BBranch from "../../../becca/entities/bbranch.js";
import BNote from "../../../becca/entities/bnote.js";
import { getContext } from "../../context.js";
import noteService from "../../notes.js";
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
