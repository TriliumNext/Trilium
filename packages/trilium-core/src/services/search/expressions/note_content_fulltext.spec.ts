import { describe, expect,it } from "vitest";

import NoteContentFulltextExp, { buildFtsMatchQuery } from "./note_content_fulltext.js";

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

describe("buildFtsMatchQuery", () => {
    it("translates substring/fuzzy operators into a prefix-matched AND query", () => {
        expect(buildFtsMatchQuery("*=*", ["hello", "world"])).toBe(`"hello"* "world"*`);
        expect(buildFtsMatchQuery("~=", ["hello"])).toBe(`"hello"*`);
        expect(buildFtsMatchQuery("~*", ["hello", "world"])).toBe(`"hello"* "world"*`);
    });

    it("returns null for operators FTS can't precisely express", () => {
        expect(buildFtsMatchQuery("!=", ["foo"])).toBeNull();
        expect(buildFtsMatchQuery("%=", ["foo"])).toBeNull();
        expect(buildFtsMatchQuery("=", ["foo"])).toBeNull();
        expect(buildFtsMatchQuery("*=", ["foo"])).toBeNull();
        expect(buildFtsMatchQuery("=*", ["foo"])).toBeNull();
    });

    it("returns null when no usable tokens remain", () => {
        expect(buildFtsMatchQuery("*=*", [])).toBeNull();
        expect(buildFtsMatchQuery("*=*", ["a"])).toBeNull(); // single char filtered out
        expect(buildFtsMatchQuery("*=*", ["", "  "])).toBeNull();
        // Punctuation-only tokens are dropped because the unicode61 tokenizer
        // would strip them down to an empty phrase, which FTS5 rejects as a
        // syntax error.
        expect(buildFtsMatchQuery("*=*", ["++", "=="])).toBeNull();
    });

    it("keeps tokens with mixed punctuation and alphanumeric content", () => {
        // Tokens like "v2.0" or "foo-1" still contain alphanumeric code points,
        // so the unicode61 tokenizer will produce non-empty terms from them.
        expect(buildFtsMatchQuery("*=*", ["v2.0"])).toBe(`"v2.0"*`);
    });

    it("filters out tokens shorter than 2 chars but keeps the rest", () => {
        expect(buildFtsMatchQuery("*=*", ["a", "hello"])).toBe(`"hello"*`);
    });

    it("escapes embedded double-quotes by doubling", () => {
        // FTS5 phrase syntax escapes `"` as `""` inside a quoted phrase.
        expect(buildFtsMatchQuery("*=*", [`he"llo`])).toBe(`"he""llo"*`);
    });
});
