import type { AttributeRow } from "@triliumnext/commons";
import { describe, expect, it } from "vitest";

import attribute_formatter from "./attribute_formatter";

const { formatAttrForSearch } = attribute_formatter;

function label(name: string, value?: string): AttributeRow {
    return { type: "label", name, value };
}

function relation(name: string, value?: string): AttributeRow {
    return { type: "relation", name, value };
}

describe("formatAttrForSearch", () => {
    it("formats labels and relations with the correct prefix and no value", () => {
        expect(formatAttrForSearch(label("important"), false)).toBe("#important");
        expect(formatAttrForSearch(relation("author"), false)).toBe("~author");
    });

    it("omits the value when searchWithValue is false even if a value is present", () => {
        expect(formatAttrForSearch(label("year", "2024"), false)).toBe("#year");
        expect(formatAttrForSearch(relation("author", "abc123"), false)).toBe("~author");
    });

    it("omits the value when searchWithValue is true but the value is empty/undefined", () => {
        expect(formatAttrForSearch(label("year"), true)).toBe("#year");
        expect(formatAttrForSearch(label("year", ""), true)).toBe("#year");
        expect(formatAttrForSearch(relation("author", ""), true)).toBe("~author");
    });

    it("appends the value for labels when searchWithValue is true", () => {
        expect(formatAttrForSearch(label("year", "2024"), true)).toBe("#year=2024");
    });

    it("appends .noteId and the value for relations when searchWithValue is true", () => {
        expect(formatAttrForSearch(relation("author", "abc123"), true)).toBe("~author.noteId=abc123");
    });

    it("throws for an unrecognized attribute type", () => {
        const bogus = { type: "bogus", name: "x" } as unknown as AttributeRow;
        expect(() => formatAttrForSearch(bogus, false)).toThrow(/Unrecognized attribute type/);
    });
});

describe("formatAttrForSearch value quoting (formatValue)", () => {
    it("leaves bare word-character values unquoted", () => {
        expect(formatAttrForSearch(label("v", "abc_123"), true)).toBe("#v=abc_123");
    });

    it("wraps values containing non-word characters in double quotes", () => {
        expect(formatAttrForSearch(label("v", "hello world"), true)).toBe('#v="hello world"');
        expect(formatAttrForSearch(label("v", "a-b"), true)).toBe('#v="a-b"');
    });

    it("falls back to single quotes when the value contains a double quote", () => {
        expect(formatAttrForSearch(label("v", 'say "hi"'), true)).toBe("#v='say \"hi\"'");
    });

    it("falls back to backticks when the value contains both double and single quotes", () => {
        expect(formatAttrForSearch(label("v", `it's "ok"`), true)).toBe("#v=`it's \"ok\"`");
    });

    it("escapes double quotes when the value contains double, single and backtick", () => {
        const value = `a "b" 'c' \`d\``;
        expect(formatAttrForSearch(label("v", value), true)).toBe(`#v="a \\"b\\" 'c' \`d\`"`);
    });

    it("applies the same quoting rules to relation values after .noteId", () => {
        expect(formatAttrForSearch(relation("r", "weird value"), true)).toBe('~r.noteId="weird value"');
    });
});
