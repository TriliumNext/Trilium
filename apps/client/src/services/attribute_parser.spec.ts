import { describe, it, expect } from "vitest";
import attributeParser from "./attribute_parser.js";

describe("Lexing", () => {
    it("simple label", () => {
        expect(attributeParser.lex("#label").map((t: any) => t.text)).toEqual(["#label"]);
    });

    it("simple label with trailing spaces", () => {
        expect(attributeParser.lex("   #label  ").map((t: any) => t.text)).toEqual(["#label"]);
    });

    it("inherited label", () => {
        expect(attributeParser.lex("#label(inheritable)").map((t: any) => t.text)).toEqual(["#label", "(", "inheritable", ")"]);

        expect(attributeParser.lex("#label ( inheritable ) ").map((t: any) => t.text)).toEqual(["#label", "(", "inheritable", ")"]);
    });

    it("label with value", () => {
        expect(attributeParser.lex("#label=Hallo").map((t: any) => t.text)).toEqual(["#label", "=", "Hallo"]);
    });

    it("label with value", () => {
        const tokens = attributeParser.lex("#label=Hallo");
        expect(tokens[0].startIndex).toEqual(0);
        expect(tokens[0].endIndex).toEqual(5);
    });

    it("relation with value", () => {
        expect(attributeParser.lex("~relation=#root/RclIpMauTOKS/NFi2gL4xtPxM").map((t: any) => t.text)).toEqual(["~relation", "=", "#root/RclIpMauTOKS/NFi2gL4xtPxM"]);
    });

    it("use quotes to define value", () => {
        expect(attributeParser.lex("#'label a'='hello\"` world'").map((t: any) => t.text)).toEqual(["#label a", "=", 'hello"` world']);

        expect(attributeParser.lex('#"label a" = "hello\'` world"').map((t: any) => t.text)).toEqual(["#label a", "=", "hello'` world"]);

        expect(attributeParser.lex("#`label a` = `hello'\" world`").map((t: any) => t.text)).toEqual(["#label a", "=", "hello'\" world"]);
    });

    it("returns no tokens for an empty / whitespace-only string", () => {
        expect(attributeParser.lex("")).toEqual([]);
        expect(attributeParser.lex("    ")).toEqual([]);
    });

    it("escapes the next character with a backslash", () => {
        // backslash before a space keeps it inside the word instead of finishing it
        expect(attributeParser.lex("#a\\ b").map((t: any) => t.text)).toEqual(["#a b"]);
        // backslash before a quote keeps the quote as a literal character
        expect(attributeParser.lex('#a\\"b').map((t: any) => t.text)).toEqual(['#a"b']);
    });

    it("keeps a trailing backslash literally when it is the last character", () => {
        expect(attributeParser.lex("#a\\").map((t: any) => t.text)).toEqual(["#a\\"]);
    });

    it("opens quotes directly after an operator symbol, finishing the operator first", () => {
        // the `=` is finished as its own token before the quoted value opens
        expect(attributeParser.lex("#a=\"b c\"").map((t: any) => t.text)).toEqual(["#a", "=", "b c"]);
    });

    it("treats parentheses as standalone tokens around a word", () => {
        expect(attributeParser.lex("#a(inheritable)").map((t: any) => t.text)).toEqual(["#a", "(", "inheritable", ")"]);
        // a lone parenthesis with no preceding word still becomes its own token
        expect(attributeParser.lex("()").map((t: any) => t.text)).toEqual(["(", ")"]);
    });

    it("splits operator symbols from adjacent non-operator characters", () => {
        // operator run is its own token, separate from the value
        expect(attributeParser.lex("#a>=b").map((t: any) => t.text)).toEqual(["#a", ">=", "b"]);
        // leading operator (no preceding word, currentWord empty) starts a fresh operator token
        expect(attributeParser.lex("=b").map((t: any) => t.text)).toEqual(["=", "b"]);
    });

    it("only treats # / ~ as a prefix at the start of a word", () => {
        // a # in the middle of a word is a literal character, not a new attribute marker
        expect(attributeParser.lex("#a#b").map((t: any) => t.text)).toEqual(["#a#b"]);
    });
});

describe("Parser", () => {
    it("parses a simple label without value or inheritance", () => {
        const attrs = attributeParser.lexAndParse("#token");

        expect(attrs.length).toEqual(1);
        expect(attrs[0].type).toEqual("label");
        expect(attrs[0].name).toEqual("token");
        expect(attrs[0].isInheritable).toBeFalsy();
        expect(attrs[0].value).toBeFalsy();
        expect(attrs[0].startIndex).toEqual(0);
        expect(attrs[0].endIndex).toEqual(5);
    });

    it("parses an inheritable label", () => {
        const attrs = attributeParser.lexAndParse("#token(inheritable)");

        expect(attrs.length).toEqual(1);
        expect(attrs[0].type).toEqual("label");
        expect(attrs[0].name).toEqual("token");
        expect(attrs[0].isInheritable).toBeTruthy();
        expect(attrs[0].value).toBeFalsy();
    });

    it("parses a label with a value and tracks the value end index", () => {
        const attrs = attributeParser.lexAndParse("#token=val");

        expect(attrs.length).toEqual(1);
        expect(attrs[0].type).toEqual("label");
        expect(attrs[0].name).toEqual("token");
        expect(attrs[0].value).toEqual("val");
        // endIndex moves to the end of the value token
        expect(attrs[0].endIndex).toEqual(9);
    });

    it("parses an inheritable label that also has a value", () => {
        const attrs = attributeParser.lexAndParse("#token(inheritable)=val");

        expect(attrs.length).toEqual(1);
        expect(attrs[0].isInheritable).toBeTruthy();
        expect(attrs[0].value).toEqual("val");
    });

    it("parses a relation, extracting the note id from a full note path", () => {
        const attrs = attributeParser.lexAndParse("~token=#root/RclIpMauTOKS/NFi2gL4xtPxM");

        expect(attrs.length).toEqual(1);
        expect(attrs[0].type).toEqual("relation");
        expect(attrs[0].name).toEqual("token");
        expect(attrs[0].value).toEqual("NFi2gL4xtPxM");
    });

    it("parses a relation whose target is a bare #-prefixed note id", () => {
        const attrs = attributeParser.lexAndParse("~token=#NFi2gL4xtPxM");

        expect(attrs.length).toEqual(1);
        expect(attrs[0].type).toEqual("relation");
        expect(attrs[0].name).toEqual("token");
        expect(attrs[0].value).toEqual("NFi2gL4xtPxM");
    });

    it("parses a relation whose target is a plain note id (no #)", () => {
        const attrs = attributeParser.lexAndParse("~token=NFi2gL4xtPxM");

        expect(attrs[0].value).toEqual("NFi2gL4xtPxM");
    });

    it("parses an inheritable relation", () => {
        const attrs = attributeParser.lexAndParse("~token(inheritable)=NFi2gL4xtPxM");

        expect(attrs.length).toEqual(1);
        expect(attrs[0].type).toEqual("relation");
        expect(attrs[0].isInheritable).toBeTruthy();
        expect(attrs[0].value).toEqual("NFi2gL4xtPxM");
    });

    it("parses multiple attributes in a single expression", () => {
        const attrs = attributeParser.lexAndParse("#a=1 #b ~c=NFi2gL4xtPxM");

        expect(attrs.map((a) => a.type)).toEqual(["label", "label", "relation"]);
        expect(attrs.map((a) => a.name)).toEqual(["a", "b", "c"]);
        expect(attrs.map((a) => a.value)).toEqual(["1", undefined, "NFi2gL4xtPxM"]);
    });

    it("allows an empty relation when allowEmptyRelations is set, stopping at it", () => {
        const attrs = attributeParser.lexAndParse("#a ~token", true);

        // the leading label is kept and parsing breaks out on the dangling relation
        expect(attrs.map((a) => a.name)).toEqual(["a", "token"]);
        expect(attrs[1].type).toEqual("relation");
        expect(attrs[1].value).toBeUndefined();
    });

    it("does not treat a partial 3-token inheritable suffix as inheritable", () => {
        // "(" "inheritable" present but the closing ")" is missing -> isInheritable false,
        // and the dangling tokens are then rejected as invalid attributes
        expect(() => attributeParser.lexAndParse("#a ( inheritable")).toThrow(/Invalid attribute "\("/);
    });
});

describe("error cases", () => {
    it("error cases", () => {
        expect(() => attributeParser.lexAndParse("~token")).toThrow('Relation "~token" in "~token" should point to a note.');

        expect(() => attributeParser.lexAndParse("#a&b/s")).toThrow(`Attribute name "a&b/s" contains disallowed characters, only alphanumeric characters, colon and underscore are allowed.`);

        expect(() => attributeParser.lexAndParse("#")).toThrow(`Attribute name is empty, please fill the name.`);
    });

    it("throws when a label ends with '=' but has no value", () => {
        expect(() => attributeParser.lexAndParse("#token=")).toThrow(/Missing value for label "#token"/);
    });

    it("throws for a relation with '=' but no target token", () => {
        expect(() => attributeParser.lexAndParse("~token=")).toThrow(/Relation "~token" .* should point to a note\./);
    });

    it("throws for a token that is neither a label nor a relation", () => {
        // a bare value with no leading # or ~ is an invalid attribute
        expect(() => attributeParser.lexAndParse("foo")).toThrow(/Invalid attribute "foo"/);
    });

    it("truncates long surrounding context with leading and trailing ellipses", () => {
        // a long run before and after the offending relation triggers both
        // the startIndex !== 0 ("...") and endIndex !== str.length ("...") branches in context()
        const prefix = "#aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        const suffix = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
        const str = `${prefix} ~token ${suffix}`;

        try {
            attributeParser.lexAndParse(str);
            throw new Error("should have thrown");
        } catch (e: any) {
            // the dangling relation is reported with truncated context on both sides
            expect(e.message).toContain('Relation "~token"');
            expect(e.message).toMatch(/in "\.\.\..*\.\.\."/);
        }
    });
});
