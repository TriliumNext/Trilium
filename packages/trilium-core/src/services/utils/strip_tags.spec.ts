import { describe, expect, it } from "vitest";

import { stripTags } from "./strip_tags.js";

describe("stripTags", () => {
    it("removes tags and comments, keeping the text between them", () => {
        expect(stripTags(`<a href="">lorem <strong>ipsum</strong></a>`)).toBe("lorem ipsum");
        expect(stripTags("<p>abc\ndef</p>\n<p>ghi</p>")).toBe("abc\ndef\nghi");
        expect(stripTags("<!-- lorem -- ipsum -- --> dolor sit amet")).toBe(" dolor sit amet");
        expect(stripTags("<!-- <strong>lorem ipsum</strong> --> dolor sit")).toBe(" dolor sit");
        expect(stripTags("<!-->a<!--->b")).toBe("ab");
        expect(stripTags("Line1<br/>Line2<img src=\"x.png\"/>")).toBe("Line1Line2");
    });

    it("does not end a tag at a quoted or nested >", () => {
        expect(stripTags(`<article attr="foo 'bar'">lorem</article> ipsum`)).toBe("lorem ipsum");
        expect(stripTags(`<a title="a>b">x</a>`)).toBe("x");
        expect(stripTags(`<p data-description='1 > 0'>y</p>`)).toBe("y");
        expect(stripTags("<scr<script>ipt>alert(1)</script>")).toBe("alert(1)");
        expect(stripTags("<<b>script>code")).toBe("code");
    });

    it("keeps a < that cannot start a tag", () => {
        expect(stripTags("lorem ipsum < a> < div>")).toBe("lorem ipsum < a> < div>");
        expect(stripTags("1<2 and 3>2")).toBe("1<2 and 3>2");
        expect(stripTags("5 <10 and >3")).toBe("5 <10 and >3");
        expect(stripTags("<3 hearts")).toBe("<3 hearts");
        expect(stripTags("a <= b")).toBe("a <= b");
    });

    it("drops a tag or comment left open at the end", () => {
        expect(stripTags("Text with <b>unclosed bold")).toBe("Text with unclosed bold");
        expect(stripTags("dangling <b")).toBe("dangling ");
        expect(stripTags("dangling <")).toBe("dangling ");
        expect(stripTags("a<!-- never closed")).toBe("a");
    });

    it("keeps the allowed tags with their attributes", () => {
        expect(stripTags("<strong>lorem <em>ipsum</em></strong>", [ "strong", "em" ]))
            .toBe("<strong>lorem <em>ipsum</em></strong>");
        expect(stripTags(`<A HREF="https://example.com">lorem</A> <b>ipsum</b>`, [ "a" ]))
            .toBe(`<A HREF="https://example.com">lorem</A> ipsum`);
        expect(stripTags("<div<>>lorem ipsum</div>", [ "div" ])).toBe("<div>lorem ipsum</div>");
        expect(stripTags(`<a href="<script>">lorem ipsum</a>`, [ "a" ])).toBe(`<a href="script">lorem ipsum</a>`);
    });

    it("puts the replacement where each removed tag was", () => {
        expect(stripTags("Line One<br>Line Two", [], "\n")).toBe("Line One\nLine Two");
        expect(stripTags("<p>a</p><p>b</p>", [], " ")).toBe(" a  b ");
        expect(stripTags("<p>a<!-- c --></p>", [], " ")).toBe(" a ");
    });

    it("rejects input that is not a string", () => {
        expect(() => stripTags([ "type-confusion" ] as unknown as string)).toThrow(TypeError);
        expect(stripTags("")).toBe("");
    });
});
