import { describe, expect, it } from "vitest";

import { getDigraph } from "./vim_digraphs.js";
import StringStream from "./vim_string_stream.js";

describe("StringStream", () => {
    it("reads characters, spaces and matches", () => {
        const stream = new StringStream("ab  12cd");
        expect(stream.sol()).toBe(true);
        expect(stream.peek()).toBe("a");
        expect(stream.eat("a")).toBe("a");
        expect(stream.eat("x")).toBeUndefined();
        expect(stream.eat(/b/)).toBe("b");
        expect(stream.sol()).toBe(false);
        expect(stream.eatSpace()).toBe(true);
        expect(stream.eatSpace()).toBe(false);
        expect(stream.match("13")).toBe(false);
        expect(stream.match("12", false)).toBe(true);
        expect(stream.match("12")).toBe(true);
        expect(stream.match(/d/)).toBeNull();
        expect(stream.match(/z/)).toBeNull();
        expect(stream.match(/c/, false)?.[0]).toBe("c");
        expect(stream.match(/c/)?.[0]).toBe("c");
        stream.backUp(1);
        expect(stream.eatWhile(/[cd]/)).toBe(true);
        expect(stream.eol()).toBe(true);
        expect(stream.next()).toBeUndefined();
        expect(stream.peek()).toBeUndefined();
        expect(stream.eat("d")).toBeUndefined();
        stream.backUp(2);
        expect(stream.next()).toBe("c");
        stream.skipToEnd();
        expect(stream.eol()).toBe(true);
    });
});

describe("getDigraph", () => {
    it("composes letters with diacritics, symbols and Greek letters", () => {
        expect(getDigraph("e", ":")).toBe("\u{EB}");
        expect(getDigraph(":", "e")).toBe("\u{EB}");
        expect(getDigraph("E", "'")).toBe("\u{C9}");
        expect(getDigraph("s", "s")).toBe("\u{DF}");
        expect(getDigraph("E", "u")).toBe("\u{20AC}");
        expect(getDigraph("p", "*")).toBe("\u{3C0}");
        expect(getDigraph("P", "*")).toBe("\u{3A0}");
        expect(getDigraph("1", ":")).toBeNull();
        expect(getDigraph("q", ";")).toBeNull();
        expect(getDigraph("j", "*")).toBeNull();
        expect(getDigraph("x", "y")).toBeNull();
    });
});
