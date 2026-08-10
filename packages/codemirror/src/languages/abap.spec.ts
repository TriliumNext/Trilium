import { StringStream } from "@codemirror/language";
import { describe, expect, it } from "vitest";

import { abapMode } from "./abap.js";

describe("abapMode", () => {
    it("starts with the string mode off", () => {
        expect(abapMode.startState?.(2)).toEqual({ mode: false });
    });

    it("recognises keywords, case-insensitively", () => {
        // ABAP source is conventionally upper-case but the editor must colour either casing.
        expect(tokenize("DATA lv_x")).toEqual([
            { text: "DATA", type: "keyword" },
            { text: "lv_x", type: null }
        ]);
        expect(typesOf("data lv_x")).toEqual([ "keyword", null ]);
        expect(typesOf("IF lv_x")).toEqual([ "keyword", null ]);
    });

    it("stops a keyword at each of its separators", () => {
        // A keyword can be followed by `(`, `.`, `,`, `:` or a space, and must still be matched.
        expect(typesOf("ENDIF.")).toEqual([ "keyword", null ]);
        expect(typesOf("METHODS:")).toEqual([ "keyword", null ]);
        const valueCall = tokenize("VALUE(lv_x)");
        expect(valueCall[0]).toEqual({ text: "VALUE", type: "keyword" });
        expect(valueCall.map((t) => t.text).join("")).toBe("VALUE(lv_x)");
    });

    it("rewinds a word that only looked like a keyword", () => {
        // `DATAX` shares a prefix with `DATA`; the scanner has to back all the way up so the
        // whole identifier is emitted rather than half of it being coloured.
        expect(tokenize("DATAX")).toEqual([ { text: "DATAX", type: null } ]);
        expect(tokenize("lv_value")).toEqual([ { text: "lv_value", type: null } ]);
    });

    it("recognises numbers only where a number can end", () => {
        expect(tokenize("42 ")).toEqual([ { text: "42", type: "number" } ]);
        expect(tokenize("42.")).toEqual([
            { text: "42", type: "number" },
            { text: ".", type: null }
        ]);
        expect(tokenize("42")).toEqual([ { text: "42", type: "number" } ]);
        // A digit run glued to letters is an identifier, not a number.
        expect(typesOf("42abc")).toEqual([ null ]);
    });

    it("recognises pragmas", () => {
        expect(tokenize("##NEEDED")).toEqual([ { text: "##NEEDED", type: "comment" } ]);
    });

    it("treats a leading asterisk as a full-line comment", () => {
        expect(tokenize("* commented out")).toEqual([ { text: "* commented out", type: "comment" } ]);
    });

    it("treats a double quote as a comment to end of line", () => {
        expect(tokenize(`lv_x " trailing note`)).toEqual([
            { text: "lv_x", type: null },
            { text: `" trailing note`, type: "comment" }
        ]);
    });

    it("does not treat an asterisk away from column 0 as a comment", () => {
        // Mid-line `*` is multiplication.
        expect(typesOf("2 * 3")).toEqual([ "number", "operator", "number" ]);
    });

    it("recognises symbol operators", () => {
        expect(typesOf("a = b")).toEqual([ null, "operator", null ]);
        expect(typesOf("a <> b")).toEqual([ null, "operator", null ]);
        expect(typesOf("a >= b")).toEqual([ null, "operator", null ]);
        // `&&` is ABAP's string-concatenation operator. It has to be matched as one token: the
        // two lists of operators used to be concatenated without a separator, which glued "&&"
        // onto "EQ" and left `&&` matching nothing.
        expect(tokenize("a && b")).toEqual([
            { text: "a", type: null },
            { text: "&&", type: "operator" },
            { text: "b", type: null }
        ]);
    });

    it("recognises word operators that are not also statement keywords", () => {
        expect(typesOf("a MOD b")).toEqual([ null, "operator", null ]);
        expect(typesOf("a XOR b")).toEqual([ null, "operator", null ]);
        expect(typesOf("a BETWEEN b")).toEqual([ null, "operator", null ]);
    });

    it("colours a word appearing in both lists as a keyword", () => {
        // EQ, AND and NOT are listed as ABAP statement keywords as well as comparison operators.
        // Keywords are checked first, so that is what wins — worth pinning, since flipping the
        // order would silently recolour a large amount of ordinary ABAP.
        expect(typesOf("a EQ b")).toEqual([ null, "keyword", null ]);
        expect(typesOf("a AND b")).toEqual([ null, "keyword", null ]);
    });

    it("recognises quoted strings", () => {
        expect(tokenize("'hello'")).toEqual([ { text: "'hello'", type: "string" } ]);
        expect(typesOf("lv_x = 'hi'")).toEqual([ null, "operator", "string" ]);
    });

    it("recognises pipe-delimited string templates", () => {
        expect(tokenize("|hello|")).toEqual([ { text: "|hello|", type: "string" } ]);
    });

    it("runs an unterminated string to the end of the line", () => {
        // A half-typed literal must still colour as a string rather than derailing the line.
        expect(tokenize("'unterminated")).toEqual([ { text: "'unterminated", type: "string" } ]);
        expect(tokenize("|unterminated")).toEqual([ { text: "|unterminated", type: "string" } ]);
    });

    it("emits no token for blank input and skips whitespace", () => {
        expect(tokenize("   ")).toEqual([]);
        expect(tokenize("")).toEqual([]);
    });

    it("tokenises a realistic statement end to end", () => {
        expect(typesOf("IF lv_count > 10.")).toEqual([
            "keyword", null, "operator", "number", null
        ]);
    });
});

/** Runs the parser over one line, returning each token's text and type. */
function tokenize(line: string): { text: string; type: string | null }[] {
    const state = abapMode.startState?.(2) ?? {};
    const stream = new StringStream(line, 2, 2, 0);
    const tokens: { text: string; type: string | null }[] = [];

    while (!stream.eol()) {
        stream.start = stream.pos;
        const type = abapMode.token(stream, state) ?? null;
        // A parser that consumes nothing would spin forever; force progress the way CodeMirror does.
        if (stream.pos === stream.start) {
            stream.next();
            continue;
        }
        const text = stream.current();
        if (text.trim() !== "") {
            tokens.push({ text, type });
        }
    }
    return tokens;
}

function typesOf(line: string): (string | null)[] {
    return tokenize(line).map((token) => token.type);
}
