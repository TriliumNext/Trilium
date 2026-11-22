// @vitest-environment happy-dom
import { describe, expect, it, onTestFinished, vi } from "vitest";

import {
    type BlockIndexHost, type IndexedBlock, indexMarkdownBlocks
} from "./markdown_block_index.js";
import {
    addMarkdownHeadingReference, applySourceChange, findMarkdownTargets, insertHtmlBlock,
    type NewBlockId, placeMarkerOnBlock, replayBlockIds
} from "./markdown_references.js";

const parse = (html: string) => {
    const template = document.createElement("template");
    template.innerHTML = html;
    return template.content;
};
const host: BlockIndexHost = { sanitize: (html) => html, parse };
/** A host whose sanitizer drops every block id. */
const idlessHost: BlockIndexHost = {
    sanitize: (html) => html.replace(/ data-trilium-block-id="[^"]*"/g, ""),
    parse
};

const marker = (id: string) => `<a data-trilium-block-id="${id}"></a>`;
const NEW = marker("new");
const draw = (...ids: string[]): NewBlockId =>
    ({ kind: "draw", createId: () => ids.shift() ?? "spare" });

/** What `placeMarkerOnBlock()` answers for the block on `line` of `source`. */
function placeAt(source: string, line: number, newId: NewBlockId, testHost = host) {
    const index = indexMarkdownBlocks(source, testHost);
    const block = index.blockAt(line);
    return block ? placeMarkerOnBlock(source, index, block, newId, testHost) : null;
}

/** The id of the block on `line` of `source`, and the source with its marker. */
function place(source: string, line: number, newId = draw("new"), testHost = host) {
    const placed = placeAt(source, line, newId, testHost);
    return placed && { id: placed.id, source: applySourceChange(source, placed.change) };
}

describe("placeMarkerOnBlock", () => {
    it("writes the marker of each kind of leaf block where the exporter writes it", () => {
        const fence = "```";
        const cases: [ string, number, string ][] = [
            [ "Para\ngraph", 1, `Para\ngraph ${NEW}` ],
            [ "Trailing  ", 1, `Trailing  ${NEW}` ],
            [ "## Title ##", 1, `## Title ${NEW} ##` ],
            [ "##", 1, `## ${NEW}` ],
            [ "Title\n===", 2, `Title ${NEW}\n===` ],
            [ "- parent\n    - child", 2, `- parent\n    - child ${NEW}` ],
            [ "- [ ] task", 1, `- [ ] task ${NEW}` ],
            [ "| a | b |\n| - | - |", 2, `| a ${NEW} | b |\n| - | - |` ],
            [ "|a\\|b|c|\n|-|-|", 1, `|a\\|b ${NEW}|c|\n|-|-|` ],
            [ "| a\n| -", 1, `| a ${NEW}\n| -` ],
            [ "a | b\n--- | ---", 1, `a ${NEW} | b\n--- | ---` ],
            [ `${fence}js\ncode\n${fence}`, 2, `${NEW}\n\n${fence}js\ncode\n${fence}` ],
            [ "    indented", 1, `${NEW}\n\n    indented` ],
            [ "> ~~~\n> code\n> ~~~", 2, `> ${NEW}\n>\n> ~~~\n> code\n> ~~~` ],
            [
                `- item\n\n  ${fence}\n  code\n  ${fence}`, 4,
                `- item\n\n  ${NEW}\n\n  ${fence}\n  code\n  ${fence}`
            ],
            [ `- ${fence}\n  code\n  ${fence}`, 2, `- ${NEW}\n\n  ${fence}\n  code\n  ${fence}` ],
            [
                `=== "Tab"\n\n    ${fence}\n    code\n    ${fence}`, 4,
                `=== "Tab"\n\n    ${NEW}\n\n    ${fence}\n    code\n    ${fence}`
            ],
            [ "Text\n\n---", 3, `Text\n\n${NEW}\n\n---` ],
            [ "> * * *", 1, `> ${NEW}\n>\n> * * *` ],
            [ "$$x$$", 1, `${NEW}$$x$$` ],
            [ "> $y$", 1, `> ${NEW}$y$` ]
        ];

        for (const [ source, line, expected ] of cases) {
            expect(place(source, line), source).toEqual({ id: "new", source: expected });
        }
    });

    it("keeps the line endings of the source", () => {
        expect(place("a\r\nb\r\n", 1)?.source).toBe(`a\r\nb ${NEW}\r\n`);
        expect(place("Title\r\n===\r\n", 1)?.source).toBe(`Title ${NEW}\r\n===\r\n`);
        expect(place("Intro\r\n\r\n```\r\ncode\r\n```", 4)?.source)
            .toBe(`Intro\r\n\r\n${NEW}\r\n\r\n\`\`\`\r\ncode\r\n\`\`\``);
    });

    it("answers the id that a block owns, without a change", () => {
        const source = `Text ${marker("own")}\n\n<details data-trilium-block-id="raw">\n\n`
            + "<summary>Raw</summary>\n\n</details>";

        expect(placeAt(source, 1, draw())).toEqual({ id: "own" });
        expect(placeAt(source, 1, { kind: "given", id: "own" })).toEqual({ id: "own" });
        expect(placeAt(source, 1, { kind: "given", id: "other" })).toBeNull();
        expect(placeAt(source, 3, draw())).toEqual({ id: "raw" });
    });

    it("gives nothing an id where no block can take one", () => {
        const raw = `Text ${marker("x")}\n\n<div data-trilium-block-id="x">\n\nraw\n\n</div>`;

        // A blank line, raw HTML without an id, raw HTML whose id another block owns.
        expect(place("a\n\nb", 2)).toBeNull();
        expect(place("<div>\n<p>raw</p>\n</div>", 2)).toBeNull();
        expect(place(raw, 3)).toBeNull();
        // An empty fence renders nothing.
        expect(place("```\n```", 1)).toBeNull();

        const quote = "> Quoted";
        const index = indexMarkdownBlocks(quote, host);
        const container = index.blocks.find((block) => block.isContainer);
        expect(container?.key.kind).toBe("quote");
        expect(placeMarkerOnBlock(quote, index, container as IndexedBlock, draw("new"), host))
            .toBeNull();
    });

    it("replaces the marker of a block whose id an earlier block owns", () => {
        const lineAbove = `Intro ${marker("a")}\n\n${marker("a")}\n\n## Heading`;
        const inline = `Intro ${marker("a")}\n\n## \`${marker("a")}\` example ${marker("a")}`;
        const inSpan = `Text <span data-trilium-block-id="a">x</span>\n\nPara ${marker("a")}`;

        expect(place(lineAbove, 5)?.source).toBe(`Intro ${marker("a")}\n\n${NEW}\n\n## Heading`);
        // The literal marker in the code span is text, not the marker of the heading.
        expect(place(inline, 3)?.source)
            .toBe(`Intro ${marker("a")}\n\n## \`${marker("a")}\` example ${NEW}`);
        // The first owner of the id is not a block.
        expect(place(inSpan, 3)?.source)
            .toBe(`Text <span data-trilium-block-id="a">x</span>\n\nPara ${NEW}`);
        // Marked reads `\|` in a cell as `|`, so the marker has no span to replace.
        expect(place(`Intro ${marker("a")}\n\n| a\\|b ${marker("a")} |\n| - |`, 3)).toBeNull();
    });

    it("takes a given id once, if nothing in the note holds it", () => {
        const source = `Intro ${marker("x")}\n\n<div data-trilium-block-id="y"></div>\n\n## Intro`;
        const given = (id: string): NewBlockId => ({ kind: "given", id });

        // Text that spells the id does not hold it.
        expect(place(source, 5, given("Intro"))?.source)
            .toBe(source.replace("## Intro", `## Intro ${marker("Intro")}`));
        for (const id of [ "x", "y", "a:b", "" ]) {
            expect(place(source, 5, given(id)), id).toBeNull();
        }
    });

    it("draws again while the source holds the id, sixteen times at most", () => {
        expect(place("Text taken", 1, draw("taken", "a:b", "new"))?.id).toBe("new");
        expect(place("Text taken", 1, { kind: "draw", createId: () => "taken" })).toBeNull();
    });

    it("keeps an edit only if the renderer gives the id to the block", () => {
        let renders = 0;
        // The second render checks the marker in the header cell, and loses its id.
        const flakyHost: BlockIndexHost = {
            sanitize: (html) => (++renders === 2 ? idlessHost.sanitize(html) : html),
            parse
        };

        expect(place("Text", 1, draw("new"), idlessHost)).toBeNull();
        expect(place("| a |\n| - |", 1, draw("new"), flakyHost)?.source)
            .toBe(`${NEW}\n\n| a |\n| - |`);
    });
});

describe("replayBlockIds", () => {
    it("replays ids given elsewhere when their markers are all that changed", () => {
        const fence = "```";
        const base = `${fence}\ncode\n${fence}\n\n## Next\n\nText`;
        const current = `${marker("a")}\n\n${fence}\ncode\n${fence}\n\n`
            + `## Next ${marker("b")}\n\nText`;

        const replay = replayBlockIds(base, current, host);
        expect(replay?.replayed.map(({ id, block }) => [ id, block.key.kind, block.startLine ]))
            .toEqual([ [ "a", "code", 1 ], [ "b", "heading", 5 ] ]);
        expect(replay?.changes.map(({ from }) => from)).toEqual([ 0, 21 ]);
    });

    it("replays nothing when anything else changed too", () => {
        const heldBy = "<span data-trilium-block-id=\"x\"></span>";
        const cases: [ string, string ][] = [
            // A changed link destination, a changed heading level, a heading of another text.
            [ "## Alpha\n\n[a](one)", `## Alpha ${marker("x")}\n\n[a](two)` ],
            [ "## Alpha", `### Alpha ${marker("x")}` ],
            [ "## Alpha", `## Beta ${marker("x")}` ],
            // No id was added, or an id the base has moved.
            [ "## Alpha", "## Alpha" ],
            [ `## A ${marker("x")}\n\n## B`, `## A\n\n## B ${marker("x")}` ],
            // The id is held elsewhere in the base, so no marker can give it to the heading.
            [ `## A\n\n\`${marker("x")}\`\n\n${heldBy}`,
                `## A ${marker("x")}\n\n\`${marker("x")}\`\n\n${heldBy}` ]
        ];

        for (const [ base, current ] of cases) {
            expect(replayBlockIds(base, current, host), current).toBeNull();
        }
    });
});

describe("insertHtmlBlock", () => {
    const figure = "<figure class=\"include-note\" data-note-id=\"n\"></figure>";
    const insert = (source: string, line: number, html = figure) => {
        const change = insertHtmlBlock(source, line, html, host);
        return change && applySourceChange(source, change);
    };

    it("puts the element after the block on the line, with blank lines and its prefix", () => {
        expect(insert("Para\n## Next", 1)).toBe(`Para\n\n${figure}\n\n## Next`);
        expect(insert("Para", 1)).toBe(`Para\n\n${figure}`);
        expect(insert("> Quoted\n>\n> More", 1)).toBe(`> Quoted\n>\n> ${figure}\n>\n> More`);
        expect(insert("- item\n- next", 1)).toBe(`- item\n\n  ${figure}\n\n- next`);
        expect(insert("Para\r\n## Next", 1)).toBe(`Para\r\n\r\n${figure}\r\n\r\n## Next`);
    });

    it("puts the element after the block above a line without one, or at the start", () => {
        expect(insert("a\n\n\nb", 2)).toBe(`a\n\n${figure}\n\n\nb`);
        expect(insert("", 1)).toBe(figure);
        expect(insert("\n\nText", 1)).toBe(`${figure}\n\nText`);
        expect(insert("\nText", 1)).toBe(`${figure}\n\nText`);
        expect(insert(" \r\n## Head", 1)).toBe(`${figure}\r\n \r\n## Head`);
        expect(insert("<div>\nraw\n</div>", 1)).toBe(`${figure}\n\n<div>\nraw\n</div>`);
    });

    it("inserts nothing that is not an element of its own, or that changes a block", () => {
        expect(insert("Para", 1, "plain text")).toBeNull();
        // An unclosed quote takes in the blocks after it.
        expect(insert("Para\n\nNext", 1, "<blockquote>")).toBeNull();
    });
});

describe("findMarkdownTargets", () => {
    it("lists the headings that can be linked to, then the anchors by name", () => {
        const source = [
            "# Top",
            `## Owned ${marker("o")}`,
            `## Copy ${marker("o")}`,
            "### See [docs](https://example.com) <a id=\"z\"></a>here",
            "> ### In *quote* $x$ `code`",
            "",
            "- #### Fish &amp; chips<br>to go",
            "",
            "=== \"Tab\"",
            "",
            "    ##### In tab",
            "",
            "##",
            "",
            "<h2>Raw</h2>",
            "",
            "<h2 data-trilium-block-id=\"r\">Raw <!-- note --> owned</h2>",
            "",
            "Text <a id=\"b\"></a> and <a id=\"a\"></a> <a id=\"b\"></a>"
                + " <a href=\"\" id=\"e\"></a>",
            "",
            "```",
            "<a id=\"c\"></a>",
            "```"
        ].join("\n");

        expect(findMarkdownTargets(source, host)).toEqual([
            { kind: "heading", title: "Top", level: 1 },
            { kind: "heading", title: "Owned", level: 2, params: { block: "o" } },
            { kind: "heading", title: "Copy", level: 2 },
            { kind: "heading", title: "See docs here", level: 3 },
            { kind: "heading", title: "In quote code", level: 3 },
            { kind: "heading", title: "Fish & chips to go", level: 4 },
            { kind: "heading", title: "In tab", level: 5 },
            { kind: "heading", title: "Raw owned", level: 2, params: { block: "r" } },
            { kind: "anchor", title: "a", params: { bookmark: "a" } },
            { kind: "anchor", title: "b", params: { bookmark: "b" } },
            { kind: "anchor", title: "z", params: { bookmark: "z" } }
        ]);
    });
});

describe("addMarkdownHeadingReference", () => {
    const createId = () => "new";

    it("gives the heading that the request names an id, found by position or by title", () => {
        const source = "## A\n\n## B";
        const expected = { content: `## A\n\n## B ${NEW}`, params: { block: "new" } };

        expect(addMarkdownHeadingReference(source, { index: 1, title: "B" }, createId, host))
            .toEqual(expected);
        expect(addMarkdownHeadingReference(source, { index: 0, title: "B" }, createId, host))
            .toEqual(expected);
    });

    it("answers the id of a heading that owns one, and nothing for no single match", () => {
        const owned = `## A ${marker("a")}`;
        const twice = "## B\n\n## B";

        expect(addMarkdownHeadingReference(owned, { index: 0, title: "A" }, createId, host))
            .toEqual({ content: owned, params: { block: "a" } });
        expect(addMarkdownHeadingReference(twice, { index: 5, title: "B" }, createId, host))
            .toBeNull();
        expect(addMarkdownHeadingReference(twice, { index: 0, title: "C" }, createId, host))
            .toBeNull();
        expect(addMarkdownHeadingReference("## A", { index: 0, title: "A" }, createId, idlessHost))
            .toBeNull();
    });

    it("finds the heading by the line its block starts on, while its title matches", () => {
        const source = "## A\n\n## B\n\n> ## B";
        const add = (line: number, title: string) =>
            addMarkdownHeadingReference(source, { line, title }, createId, host);

        expect(add(3, "B")).toEqual({
            content: `## A\n\n## B ${NEW}\n\n> ## B`, params: { block: "new" }
        });
        expect(add(5, "B")).toEqual({
            content: `## A\n\n## B\n\n> ## B ${NEW}`, params: { block: "new" }
        });
        expect(add(2, "B")).toBeNull();
        expect(add(1, "B")).toBeNull();
        expect(add(9, "B")).toBeNull();
    });

    it("gives a heading an id in a note with a formula in a code block", () => {
        let now = 0;
        const clock = vi.spyOn(Date, "now").mockImplementation(() => now++);
        onTestFinished(() => clock.mockRestore());
        const source = [ "## A", "", "````md", "```js", "a", "```", "$$x$$", "````" ].join("\n");

        expect(addMarkdownHeadingReference(source, { index: 0, title: "A" }, createId, host))
            .toEqual({ content: source.replace("## A", `## A ${NEW}`), params: { block: "new" } });
    });
});
