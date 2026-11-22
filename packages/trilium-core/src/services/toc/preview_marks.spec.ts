import { describe, expect, it } from "vitest";

import { indexElementIds, spliceInsertions, writePreviewMarks } from "./preview_marks.js";

describe("indexElementIds", () => {
    it("indexes the first element of each id asked for, decoded, with its count", () => {
        const html = "<p id=\"a\">1</p><H2 class=\"x\" id=\"a\">2</H2>"
            + "<span id=\"b&amp;c\">3</span><p id=\"other\">4</p><p data-id=\"d\">5</p>";
        const span = html.indexOf("<span");

        const elements = indexElementIds(html, new Set([ "a", "b&c", "d", "missing" ]));

        expect(Object.fromEntries(elements)).toStrictEqual({
            a: { tagName: "p", tagOffset: 0, tagNameEnd: 2, count: 2 },
            "b&c": { tagName: "span", tagOffset: span, tagNameEnd: span + 5, count: 1 }
        });
    });
});

describe("writePreviewMarks", () => {
    it("writes the ids of an element's headings into one attribute, before its bookmark", () => {
        const html = "<h2 id=\"x\">A</h2><p>B</p>";
        const paragraph = html.indexOf("<p") + 2;

        const marked = writePreviewMarks(html, [
            { at: 3, id: "id1" }, { at: paragraph, id: "id3" }, { at: 3, id: "id2" }
        ], [ { at: 3, name: "say \"hi\" & <go>" } ]);

        expect(marked).toBe("<h2 data-toc-heading=\"id1 id2\""
            + " data-toc-bookmark=\"say &quot;hi&quot; &amp; &lt;go&gt;\" id=\"x\">A</h2>"
            + "<p data-toc-heading=\"id3\">B</p>");
        expect(writePreviewMarks(html, [])).toBe(html);
    });
});

describe("spliceInsertions", () => {
    it("inserts each text at its offset, keeping the order of the insertions at one offset", () => {
        expect(spliceInsertions("abc", [
            { at: 3, text: "3" }, { at: 1, text: "x" }, { at: 1, text: "y" }, { at: 0, text: "0" }
        ])).toBe("0axybc3");
    });
});
