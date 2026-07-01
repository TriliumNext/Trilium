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
    it("translates substring / starts-with / ends-with / exact operators into a trigram phrase AND query", () => {
        // All four operators are substring-superset, so trigram FTS can narrow
        // candidates and let findInText enforce the precise boundary semantics.
        expect(buildFtsMatchQuery("*=*", ["hello", "world"])).toBe(`"hello" "world"`);
        expect(buildFtsMatchQuery("=", ["hello"])).toBe(`"hello"`);
        expect(buildFtsMatchQuery("*=", ["hello"])).toBe(`"hello"`);
        expect(buildFtsMatchQuery("=*", ["hello"])).toBe(`"hello"`);
    });

    it("returns null for operators FTS trigram can't safely narrow", () => {
        // Fuzzy operators can match through typos that don't share trigrams with
        // the target; FTS would silently drop those matches.
        expect(buildFtsMatchQuery("~=", ["hello"])).toBeNull();
        expect(buildFtsMatchQuery("~*", ["hello"])).toBeNull();
        // Negation and regex need to see every row.
        expect(buildFtsMatchQuery("!=", ["foo"])).toBeNull();
        expect(buildFtsMatchQuery("%=", ["foo"])).toBeNull();
    });

    it("returns null when no usable tokens remain", () => {
        expect(buildFtsMatchQuery("*=*", [])).toBeNull();
        // Trigram cannot match phrases shorter than 3 codepoints.
        expect(buildFtsMatchQuery("*=*", ["a"])).toBeNull();
        expect(buildFtsMatchQuery("*=*", ["ab"])).toBeNull();
        expect(buildFtsMatchQuery("*=*", ["", "  "])).toBeNull();
        // Punctuation-only tokens have no alphanumeric codepoint, so they'd
        // tokenize to nothing in the trigram index and FTS5 would raise
        // `fts5: syntax error` on the empty phrase.
        expect(buildFtsMatchQuery("*=*", ["++", "=="])).toBeNull();
    });

    it("keeps tokens with mixed punctuation and alphanumeric content", () => {
        // `v2.0` and similar still carry indexable trigrams (e.g. `v2.`, `2.0`),
        // so they're kept rather than being treated as pure punctuation.
        expect(buildFtsMatchQuery("*=*", ["v2.0"])).toBe(`"v2.0"`);
    });

    it("filters out tokens shorter than the trigram window but keeps the rest", () => {
        expect(buildFtsMatchQuery("*=*", ["a", "hello"])).toBe(`"hello"`);
        expect(buildFtsMatchQuery("*=*", ["ok", "hello"])).toBe(`"hello"`);
    });

    it("escapes embedded double-quotes by doubling", () => {
        // FTS5 phrase syntax escapes `"` as `""` inside a quoted phrase.
        expect(buildFtsMatchQuery("*=*", [`he"llo`])).toBe(`"he""llo"`);
    });
});
