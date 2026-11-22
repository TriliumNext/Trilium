// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import {
    type BlockKey, collectBlocks, compareBlockIds, isSameBlockKey, isSameBlockShape
} from "./block_keys.js";

describe("collectBlocks", () => {
    it("tells the kinds of block apart and finds the element that holds each id", () => {
        const blocks = collect(`
            <h2 data-trilium-block-id="h">Heading</h2>
            <p data-trilium-block-id="p">Paragraph</p>
            <pre><code data-trilium-block-id="c">code</code></pre>
            <pre data-trilium-block-id="legacy"><code>old</code></pre>
            <figure class="table" data-trilium-block-id="t">
                <table><tr><td>cell</td></tr></table>
            </figure>
            <table><tr><td>bare</td></tr></table>
            <blockquote data-trilium-block-id="q"><p>quoted</p></blockquote>
            <aside class="admonition note" data-trilium-block-id="a"><p>note</p></aside>
            <aside data-trilium-block-id="aside"><p>beside</p></aside>
            <hr data-trilium-block-id="r">
            <span class="math-tex">\\[x\\]</span>
            <p data-trilium-block-id="f"><span class="math-tex">\\[y\\]</span></p>
            <div class="trilium-tabs"><section class="trilium-tab" data-trilium-block-id="tab">
                <p class="trilium-tab-title">One <span class="math-tex">\\[z\\]</span></p>
                <div class="trilium-tab-panel"><p>panel</p></div>
            </section></div>
            <details data-trilium-block-id="d">
                <summary data-trilium-block-id="s">More</summary><p>in</p>
            </details>
            <div data-trilium-block-id="div"><p>block</p></div>
            <span>stray</span>
            <section class="media-embed" data-trilium-block-id="m"></section>
            <custom-element data-trilium-block-id="other">x</custom-element>
            <figure class="image"><img src="x"></figure>
        `);
        expect(blocks.map(({ key, id, node }) => [ key.kind, id ?? "", node.tagName ])).toEqual([
            [ "heading", "h", "H2" ],
            [ "paragraph", "p", "P" ],
            [ "code", "c", "CODE" ],
            [ "code", "legacy", "PRE" ],
            [ "table", "t", "FIGURE" ],
            [ "table", "", "TABLE" ],
            [ "quote", "q", "BLOCKQUOTE" ],
            [ "paragraph", "", "P" ],
            [ "admonition", "a", "ASIDE" ],
            [ "paragraph", "", "P" ],
            [ "raw", "aside", "ASIDE" ],
            [ "paragraph", "", "P" ],
            [ "rule", "r", "HR" ],
            [ "formula", "", "SPAN" ],
            [ "formula", "f", "P" ],
            [ "tabs", "", "DIV" ],
            [ "tab", "tab", "SECTION" ],
            [ "paragraph", "", "P" ],
            [ "raw", "d", "DETAILS" ],
            [ "raw", "s", "SUMMARY" ],
            [ "paragraph", "", "P" ],
            [ "raw", "div", "DIV" ],
            [ "paragraph", "", "P" ],
            [ "raw", "m", "SECTION" ],
            [ "raw", "other", "CUSTOM-ELEMENT" ],
            [ "raw", "", "FIGURE" ]
        ]);
        expect(blocks[7].key.ancestry).toEqual([ "quote" ]);
        expect(blocks[17].key.ancestry).toEqual([ "tabs", "tab" ]);
        expect(blocks[16].key.text).toBe("One\\[z\\]panel");
    });

    it("reads an item as its <li>, with or without the paragraph around its text", () => {
        const plain = collect(
            `<ul><li>one<ul><li>nested <span class="math-tex">x</span></li></ul></li></ul>`);
        const referenced = collect(`<ul><li><p data-trilium-block-id="i">one</p><ul>`
            + `<li><p>nested <span class="math-tex">x</span></p></li></ul></li></ul>`);
        expect(plain.map(({ key }) => key)).toEqual(referenced.map(({ key }) => key));
        expect(plain.map(({ key }) => [ key.kind, key.ancestry, key.text ])).toEqual([
            [ "item", [], "one" ],
            [ "item", [ "item" ], "nestedx" ]
        ]);
        expect(referenced[0].id).toBe("i");
        expect(referenced[0].node.tagName).toBe("P");
        expect(plain[0].node.tagName).toBe("LI");

        const looseItem = collect(`<ol><li><p>first</p><p>second</p></li></ol>`);
        expect(looseItem.map(({ key }) => [ key.kind, key.ancestry, key.text ])).toEqual([
            [ "item", [], "firstsecond" ],
            [ "paragraph", [ "item" ], "second" ]
        ]);
    });

    it("reads both forms of a to-do item as the same block", () => {
        const plain = collect(`<ul class="todo-list"><li><label class="todo-list__label">`
            + `<input type="checkbox"><span class="todo-list__label__description">task</span>`
            + `</label></li></ul>`);
        const referenced = collect(`<ul class="todo-list"><li><label class="todo-list__label `
            + `todo-list__label_without-description"><input type="checkbox"></label>`
            + `<p data-trilium-block-id="t">task</p></li></ul>`);
        expect(referenced.map(({ key }) => key)).toEqual(plain.map(({ key }) => key));
        expect(referenced[0].id).toBe("t");
        expect(collect(`<ul><li><span>x</span><p>after</p></li></ul>`)[0].node.tagName).toBe("LI");
    });

    it("leaves out white space, the labels of reference links, comments and embedded notes", () => {
        const template = document.createElement("template");
        template.innerHTML = `
            <p>A  <a class="reference-link" href="#root/x">Old title</a>\n b</p>
            <figure class="include-note" data-note-id="other">
                <p data-trilium-block-id="inner">Embedded</p>
                <figcaption>Caption</figcaption>
            </figure>`;
        template.content.querySelector("p")?.append(document.createComment("comment"));
        const [ paragraph, embed ] = collectBlocks<HTMLElement>(template.content);
        expect(paragraph.key.text).toBe("Ab");
        expect(embed.key).toEqual({ kind: "raw", ancestry: [], text: "Caption", ordinal: 0 });
    });

    it("collects the caption of an embed of another note when it has an id", () => {
        const embed = (caption: string) => `<figure class="include-note" data-note-id="other">`
            + `<p data-trilium-block-id="inner">Embedded</p>${caption}</figure>`;
        const blocks = collect(
            embed(`<figcaption data-trilium-block-id="cap">Caption</figcaption>`));
        expect(blocks.map(({ key, id }) => [ key.kind, key.ancestry, key.text, id ])).toEqual([
            [ "raw", [], "Caption", undefined ],
            [ "raw", [ "raw" ], "Caption", "cap" ]
        ]);
        expect(compareBlockIds(blocks, collect(embed("<figcaption>Caption</figcaption>"))))
            .toEqual({ lostBlockIds: [ "cap" ], movedBlockIds: [] });
    });

    it("gives a block without text the text before it and the distance, and counts repeats", () => {
        const keys = collect(`<p>Same</p><hr><p>&nbsp;</p><p>Same</p><hr>`).map(({ key }) => key);
        expect(keys.map(({ text, ordinal }) => [ text, ordinal ])).toEqual([
            [ "Same", 0 ],
            [ "\u{0}1\u{0}Same", 0 ],
            [ "\u{0}2\u{0}Same", 0 ],
            [ "Same", 1 ],
            [ "\u{0}1\u{0}Same", 1 ]
        ]);
        expect(collect(`<hr>`)[0].key.text).toBe("\u{0}1\u{0}");
    });
});

describe("compareBlockIds", () => {
    const compare = (before: string, after: string) =>
        compareBlockIds(collect(before), collect(after));

    it("passes an id on the same block and reports one lost or on another block", () => {
        const before = `<p data-trilium-block-id="a">First</p><p>Second</p>`
            + `<p data-trilium-block-id="c">Third</p>`;
        expect(compare(before, before)).toEqual({ lostBlockIds: [], movedBlockIds: [] });
        expect(compare(before, `<p>First</p><p data-trilium-block-id="a">Second</p><p>Third</p>`))
            .toEqual({ lostBlockIds: [ "c" ], movedBlockIds: [ "a" ] });
    });

    it("tells two blocks of the same text apart, and the first of two equal ids owns it", () => {
        const before = `<p data-trilium-block-id="a">Same</p><p>Same</p>`
            + `<p data-trilium-block-id="a">x</p>`;
        expect(compare(before, `<p>Same</p><p data-trilium-block-id="a">Same</p>`))
            .toEqual({ lostBlockIds: [], movedBlockIds: [ "a" ] });
        expect(compare(before, `<p data-trilium-block-id="a">Same</p><p>Same</p>`))
            .toEqual({ lostBlockIds: [], movedBlockIds: [] });
    });

    it("passes a block whose text alone changed between the same neighbors", () => {
        const before = `<p>Intro</p><p data-trilium-block-id="m">Old text</p><p>End</p>`;
        expect(compare(before, `<p>Intro</p><p data-trilium-block-id="m">New text</p><p>End</p>`))
            .toEqual({ lostBlockIds: [], movedBlockIds: [] });
        expect(compare(before, `<p>Intro</p><h2 data-trilium-block-id="m">New text</h2><p>End</p>`))
            .toEqual({ lostBlockIds: [], movedBlockIds: [ "m" ] });
        expect(compare(before, `<p>Other</p><p data-trilium-block-id="m">New text</p><p>End</p>`))
            .toEqual({ lostBlockIds: [], movedBlockIds: [ "m" ] });
        const old = `<p data-trilium-block-id="m">Old</p>`;
        expect(compare(old, `<p data-trilium-block-id="m">New</p>`))
            .toEqual({ lostBlockIds: [], movedBlockIds: [] });
        expect(compare(old, `<p data-trilium-block-id="m">New</p><p>x</p>`))
            .toEqual({ lostBlockIds: [], movedBlockIds: [ "m" ] });
        // A neighbor without text is passed over.
        expect(compare(`<p>Intro</p><hr><p data-trilium-block-id="m">Old</p>`,
            `<p>Intro</p><hr><p data-trilium-block-id="m">New</p>`))
            .toEqual({ lostBlockIds: [], movedBlockIds: [] });
    });
});

describe("isSameBlockKey", () => {
    it("compares every part of two keys", () => {
        const key: BlockKey = { kind: "paragraph", ancestry: [ "quote" ], text: "a", ordinal: 0 };
        expect(isSameBlockKey(key, { ...key, ancestry: [ "quote" ] })).toBe(true);
        for (const other of [
            { ...key, kind: "heading" as const },
            { ...key, ancestry: [] },
            { ...key, ancestry: [ "item" as const ] },
            { ...key, text: "b" },
            { ...key, ordinal: 1 }
        ]) {
            expect(isSameBlockKey(key, other)).toBe(false);
        }
    });
});

describe("isSameBlockShape", () => {
    it("compares blocks without text by their kind and ancestry, and others by their keys", () => {
        const [ rule ] = collect("<p>Text</p><hr>").slice(1);
        const [ ruleAfterFigure ] = collect("<p>Text</p><figure></figure><hr>").slice(2);
        const [ ruleInQuote ] = collect("<p>Text</p><blockquote><hr></blockquote>").slice(2);
        const text: BlockKey = { kind: "paragraph", ancestry: [], text: "a", ordinal: 0 };

        expect(isSameBlockKey(rule.key, ruleAfterFigure.key)).toBe(false);
        expect(isSameBlockShape(rule.key, ruleAfterFigure.key)).toBe(true);
        expect(isSameBlockShape(rule.key, ruleInQuote.key)).toBe(false);
        expect(isSameBlockShape(text, { ...text })).toBe(true);
        expect(isSameBlockShape(text, { ...text, ordinal: 1 })).toBe(false);
        expect(isSameBlockShape(rule.key, { ...text, kind: "rule" })).toBe(false);
    });
});

function collect(html: string) {
    const template = document.createElement("template");
    template.innerHTML = html;
    return collectBlocks<HTMLElement>(template.content);
}
