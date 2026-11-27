// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";

import { type BlockIndexHost, indexMarkdownBlocks } from "./markdown_block_index.js";

const host: BlockIndexHost = {
    sanitize: (html) => html,
    parse(html) {
        const template = document.createElement("template");
        template.innerHTML = html;
        return template.content;
    }
};

const marker = (id: string) => `<a data-trilium-block-id="${id}"></a>`;

/** A note whose blocks each hold their own line number as text. */
const NESTED = [
    "# 1",
    "2 paragraph",
    "3 continued",
    "",
    "- 5 item",
    "    - 6 nested",
    "      7 lazy",
    "",
    "      9 second paragraph",
    "- 10 item",
    "",
    "1. 12 loose",
    "",
    "   ```",
    "   14 fence",
    "   ```",
    "",
    "> 18 quote",
    "19 lazy",
    ">",
    "> - 21 item in quote",
    ">",
    "> ## 23 heading in quote",
    "",
    "> [!NOTE]",
    "> 26 admonition",
    "",
    "=== \"28 tab\"",
    "",
    "    30 in tab",
    "",
    "| 32 | b |",
    "| --- | --- |",
    "| c | d |",
    "",
    "---",
    "",
    "$$",
    "39 formula",
    "$$",
    "",
    "42 last"
].join("\n");

describe("indexMarkdownBlocks", () => {
    it("counts the lines of nested blocks down the token tree, with LF and CRLF", () => {
        for (const source of [ NESTED, NESTED.replaceAll("\n", "\r\n") ]) {
            const index = indexMarkdownBlocks(source, host);
            const lines = index.blocks.map(({ key, startLine, endLine }) =>
                [ key.kind, startLine, endLine, firstNumber(key.text) ]);
            expect(lines).toEqual([
                [ "heading", 1, 1, 1 ],
                [ "paragraph", 2, 3, 2 ],
                [ "item", 5, 5, 5 ],
                [ "item", 6, 7, 6 ],
                [ "paragraph", 9, 9, 9 ],
                [ "item", 10, 10, 10 ],
                [ "item", 12, 12, 12 ],
                [ "code", 14, 16, 14 ],
                [ "quote", 18, 23, 18 ],
                [ "paragraph", 18, 19, 18 ],
                [ "item", 21, 21, 21 ],
                [ "heading", 23, 23, 23 ],
                [ "admonition", 25, 26, 26 ],
                [ "paragraph", 25, 26, 26 ],
                [ "tabs", 28, 30, 28 ],
                [ "tab", 28, 30, 28 ],
                [ "paragraph", 30, 30, 30 ],
                [ "table", 32, 34, 32 ],
                [ "rule", 36, 36, 32 ],
                [ "formula", 38, 40, 39 ],
                [ "paragraph", 42, 42, 42 ]
            ]);
            expect(index.blocks.every((block) => block.isWritable)).toBe(true);
        }
    });

    it("reads the blocks that the host's sanitizer keeps", () => {
        const index = indexMarkdownBlocks("first\n\nsecond", {
            ...host,
            sanitize: (html) => html.replace(/<p[^>]*>first<\/p>/, "")
        });
        expect(index.blocks.map(({ key }) => key.text)).toEqual([ "second" ]);
    });

    it("finds an id of raw HTML in the lines of its HTML block, and gives it no marker", () => {
        const index = indexMarkdownBlocks([
            "intro",
            "",
            "<details data-trilium-block-id=\"d\">",
            "<summary data-trilium-block-id='s'>More</summary>",
            "",
            `Inside ${marker("in")}`,
            "",
            "</details>"
        ].join("\n"), host);
        const details = index.resolve("d");
        expect(details).toMatchObject({ startLine: 3, endLine: 4, isWritable: false });
        expect(details?.marker).toBeUndefined();
        expect(index.resolve("s")).toMatchObject({ startLine: 3, isWritable: false });
        expect(index.resolve("in")).toMatchObject({ startLine: 6, isWritable: true });
        expect(index.blockAt(3)?.id).toBe("s");
        expect(index.blockAt(6)?.id).toBe("in");
    });

    it("finds an id on the caption of an embed of another note", () => {
        const index = indexMarkdownBlocks([
            "intro",
            "",
            "<figure class=\"include-note\" data-note-id=\"other\">",
            "<figcaption data-trilium-block-id=\"cap\">Caption</figcaption></figure>"
        ].join("\n"), host);
        expect(index.resolve("cap")).toMatchObject({ startLine: 3, endLine: 4, id: "cap" });
    });

    it("reads the ids of a note a number of times that grows with the note, not faster", () => {
        const countReads = (paragraphs: number) => {
            const source = Array.from({ length: paragraphs },
                (_, index) => `Paragraph ${index} ${marker(`b${index}`)}`).join("\n\n");
            const getAttribute = vi.spyOn(Element.prototype, "getAttribute");
            const index = indexMarkdownBlocks(source, host);
            const reads = getAttribute.mock.calls
                .filter(([ name ]) => name === "data-trilium-block-id").length;
            getAttribute.mockRestore();
            expect(index.markers.every((found) => found.isEffective)).toBe(true);
            return reads;
        };
        expect(countReads(200)).toBeLessThan(countReads(100) * 3);
    });

    it("tells effective markers from inert ones", () => {
        const source = [
            `Two ${marker("a")} markers ${marker("b")}`,
            "",
            marker("raw"),
            "<div>raw " + marker("inside") + "</div>",
            "",
            `Again ${marker("a")}`,
            "",
            marker("fence"),
            "",
            "```",
            "```",
            "",
            `Bad ${marker("x:y")}`,
            "",
            "```",
            marker("code"),
            "```",
            "",
            marker("last")
        ].join("\n");
        const index = indexMarkdownBlocks(source, host);
        expect(index.markers.map(({ id, isEffective, from, to }) =>
            [ id, isEffective, source.slice(from, to) === marker(id ?? "x:y") ])).toEqual([
            [ "a", true, true ],
            [ "b", false, true ],
            [ "raw", false, true ],
            [ "inside", false, true ],
            [ "a", false, true ],
            [ "fence", false, true ],
            [ null, false, true ],
            [ "last", false, true ]
        ]);
        expect(index.resolve("a")?.startLine).toBe(1);
        const again = index.blocks.find((block) => block.startLine === 6);
        expect(again?.marker?.isEffective).toBe(false);
    });

    it("locates each marker in its source, past a literal one in a code span", () => {
        const source = [
            `## Heading \`${marker("h")}\` ${marker("h")} ##`,
            "",
            `A paragraph \`${marker("p")}\``,
            `on two lines *with ${marker("p")}*`,
            "",
            "- `literal`",
            `  - nested ${marker("n")}`,
            "",
            `> quote \`${marker("q")}\``,
            `lazy ${marker("q")}`,
            "",
            `Setext ${marker("s")}`,
            "------",
            "",
            `| A${marker("t")} | B |`,
            "| --- | --- |",
            "",
            `=== "Tab ${marker("tab")}"`,
            "",
            "    Body"
        ].join("\r\n");
        const index = indexMarkdownBlocks(source, host);
        const located = index.markers.map(({ id, from, to }) => [ id, source.slice(from, to) ]);
        const ids = [ "h", "p", "n", "q", "s", "t", "tab" ];
        expect(located).toEqual(ids.map((id) => [ id, marker(id) ]));
        const literal = source.indexOf(`\`${marker("h")}\``) + 1;
        expect(index.markers[0].from).toBeGreaterThan(literal);
        expect(index.markers.every(({ isEffective }) => isEffective)).toBe(true);
    });

    it("answers the owner of an id and the leaf that covers a line", () => {
        const source = [
            `- parent ${marker("p")}`,
            "    - child",
            "",
            "> quoted",
            ">",
            "> more",
            "",
            "after"
        ].join("\n");
        const index = indexMarkdownBlocks(source, host);
        expect(index.blockAt(1)?.id).toBe("p");
        expect(index.blockAt(2)?.key).toMatchObject({ kind: "item", text: "child" });
        expect(index.blockAt(3)).toBeUndefined();
        expect(index.blockAt(5)).toBeUndefined();
        expect(index.blockAt(6)?.key.text).toBe("more");
        expect(index.resolve("missing")).toBeUndefined();
        const parent = index.resolve("p");
        expect(parent).toMatchObject({ from: 0, to: source.indexOf("\n") });
        expect(parent?.marker).toMatchObject({ id: "p", isEffective: true });
    });

    it("lists the anchors of the output with the line of their block", () => {
        const index = indexMarkdownBlocks([
            "Intro",
            "",
            "Text <a id=\"one\"></a>here",
            "",
            "<div><a id=\"two\"></a></div>",
            "",
            "```",
            "<a id=\"code\"></a>",
            "```",
            "",
            "<a id=\"three\"></a>"
        ].join("\n"), host);
        expect(index.anchors).toEqual([
            { name: "one", line: 3 },
            { name: "two", line: 5 },
            { name: "three", line: 11 }
        ]);
    });

    it("reads setext headings, list items that end in white space and raw HTML without ids", () => {
        const source = [
            "Two line",
            `setext ${marker("s")}`,
            "===",
            "",
            "<details><summary>No id</summary>",
            "",
            "Inside",
            "",
            "</details>",
            "",
            "<div data-trilium-block-id=\"a:b\"><a id=\"x&amp;y\"></a></div>",
            "",
            `- last ${marker("l")}   `
        ].join("\n");
        const index = indexMarkdownBlocks(source, host);
        expect(index.resolve("s")).toMatchObject({ startLine: 1, endLine: 3 });
        expect(index.resolve("s")?.marker?.from).toBe(source.indexOf("<a"));
        expect(index.resolve("l")?.marker?.from).toBe(source.lastIndexOf("<a"));
        expect(index.blocks.map(({ key }) => key.kind)).toEqual([ "heading", "paragraph", "item" ]);
        expect(index.anchors).toEqual([ { name: "x&y", line: 11 } ]);
    });

    it("finds no spans where the text of a block is not its source", () => {
        const source = `| A \\| ${marker("t")} | B |\n| --- | --- |`;
        const index = indexMarkdownBlocks(source, host);
        expect(index.resolve("t")?.marker).toBeUndefined();
        expect(index.markers).toEqual([]);
    });
});

/** The first number in the text of a key, past the distance of a block without text. */
function firstNumber(text: string) {
    return Number(/\d+/.exec(text.replace(/^\u{0}\d+\u{0}/u, ""))?.[0]);
}
