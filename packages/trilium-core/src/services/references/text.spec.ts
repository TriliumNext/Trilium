import type { ReferenceTarget } from "@triliumnext/commons";
import { parse } from "node-html-parser";
import { describe, expect, it, vi } from "vitest";

import textReferences, { addHeadingReference, findTextTargets, insertBlockId } from "./text";

/** A heading as `findTextTargets()` lists it. */
function heading(title: string, level: number, block?: string): ReferenceTarget {
    return block
        ? { kind: "heading", title, level, params: { block } }
        : { kind: "heading", title, level };
}

/** An anchor as `findTextTargets()` lists it. */
function anchor(name: string): ReferenceTarget {
    return { kind: "anchor", title: name, params: { bookmark: name } };
}

function findHeadings(content: string) {
    return findTextTargets(content).filter((target) => target.kind === "heading");
}

describe("textReferences", () => {
    it("reads text notes, and gives only a heading a reference", () => {
        const content = `<h2>Intro</h2><p><a id="top"></a></p>`;

        expect(textReferences.isFor("text", "text/html")).toBe(true);
        expect(textReferences.isFor("code", "text/html")).toBe(false);
        expect(textReferences.findTargets(content)).toStrictEqual([
            heading("Intro", 2), anchor("top")
        ]);
        expect(textReferences.findTargets(new Uint8Array([ 60, 104, 50, 62 ]))).toStrictEqual([]);

        const created = textReferences.createReference?.(
            content, { kind: "heading", index: 0, title: "Intro" }
        );
        expect(created?.params.block).toMatch(/^[A-Za-z0-9]{12}$/);
        expect(created?.content)
            .toBe(content.replace("<h2>", `<h2 data-trilium-block-id="${created?.params.block}">`));
        expect(textReferences.createReference?.(
            content, { kind: "anchor", index: 0, title: "top" }
        )).toBeNull();
        expect(textReferences.createReference?.(
            new Uint8Array(), { kind: "heading", index: 0, title: "Intro" }
        )).toBeNull();
    });
});

describe("findTextTargets", () => {
    it("lists the headings with text at every depth, in document order", () => {
        const content = [
            `<h1>One</h1>`,
            `<h2 class="x">Two</h2>`,
            `<figure class="table"><table><tbody><tr><td><h3>In a cell</h3></td></tr></tbody>`
                + `</table></figure>`,
            `<blockquote><h4>Quoted</h4></blockquote>`,
            `<details><summary>Summary</summary><h5>Collapsed</h5></details>`,
            `<div class="trilium-multicolumn-layout"><div class="trilium-multicolumn-column">`
                + `<h6>In a column</h6></div></div>`,
            `<aside class="admonition note"><H2>Upper case</H2></aside>`,
            `<h3\nclass="y">Line break in the tag</h3>`
        ].join("\n");

        expect(findTextTargets(content)).toStrictEqual([
            heading("One", 1),
            heading("Two", 2),
            heading("In a cell", 3),
            heading("Quoted", 4),
            heading("Collapsed", 5),
            heading("In a column", 6),
            heading("Upper case", 2),
            heading("Line break in the tag", 3)
        ]);
    });

    it("reads a heading as plain text, as the editor lists it", () => {
        const content = [
            `<h2>Tom &amp; <strong>Jerry</strong></h2>`,
            `<h2>Line<br>break</h2>`,
            `<h2>Area<span class="math-tex">\\(\\pi r^2\\)</span>formula</h2>`,
            `<h2><img src="x" onerror="alert(1)">Image</h2>`,
            `<h2>Book<a id="mark"></a>mark</h2>`,
            `<h2>See <a class="reference-link" href="#root/abc">Other note</a></h2>`,
            `<h2>  Spaced \n\t out&nbsp; </h2>`,
            `<h2>&lt;b&gt;Not bold&lt;/b&gt;</h2>`,
            `<h2>Outer<h3>Inner</h3></h2>`
        ].join("");

        expect(findHeadings(content).map((target) => target.title)).toEqual([
            "Tom & Jerry",
            "Line break",
            "Area formula",
            "Image",
            "Book mark",
            "See Other note",
            "Spaced out",
            "<b>Not bold</b>",
            "Outer",
            "Inner"
        ]);
    });

    it("leaves out headings without text", () => {
        const content = `<h2></h2><h3> &nbsp; </h3><h4><br></h4><h5><img src="x"></h5>`
            + `<h6><span class="math-tex">\\(x\\)</span></h6><h2><a id="only"></a></h2>`
            + `<h2>Kept</h2>`;

        expect(findTextTargets(content)).toStrictEqual([ heading("Kept", 2), anchor("only") ]);
    });

    it("links a heading to its block id only when the id is valid", () => {
        const content = `<h2 data-trilium-block-id="a1">A</h2>`
            + `<h2 data-trilium-block-id="">B</h2>`
            + `<h2 data-trilium-block-id>C</h2>`
            + `<h2 data-trilium-block-id="x:y">D</h2>`
            + `<h2 DATA-TRILIUM-BLOCK-ID="Up">E</h2>`
            + `<h2 data-trilium-block-id="a&amp;b">F</h2>`;

        expect(findHeadings(content).map((target) => target.params)).toEqual([
            { block: "a1" }, undefined, undefined, undefined, { block: "Up" }, { block: "a&b" }
        ]);
    });

    it("links a block id only from the first element that has it, which a link reaches", () => {
        const content = `<p data-trilium-block-id="para">P</p>`
            + `<h2 data-trilium-block-id="para">A</h2>`
            + `<h2 data-trilium-block-id="twice">B</h2><h3 data-trilium-block-id="twice">C</h3>`
            + `<h2 data-trilium-block-id="outer"><span data-trilium-block-id="outer">D</span></h2>`;

        expect(findHeadings(content).map((target) => target.params?.block)).toEqual([
            undefined, "twice", undefined, "outer"
        ]);
    });

    it("lists each anchor once, sorted by name, with its decoded name as the parameter", () => {
        const content = `<p><a id="one"></a>Text</p>`
            + `<h2><a id="two"></a>Heading</h2>`
            + `<p><a id="a&amp;b"></a><a id="one"></a></p>`
            + `<p><A ID="Upper"></A><a\nid="split"></a></p>`
            + `<p><a href="#x" id="link">Link</a><a href="" id="empty-href"></a></p>`
            + `<p><a name="named"></a><a id=""></a></p>`;

        const anchors = findTextTargets(content).filter((target) => target.kind === "anchor");
        expect(anchors).toStrictEqual([ "a&b", "one", "split", "two", "Upper" ].map(anchor));
    });

    it("finds nothing in code blocks, comments, attribute values or tags that start alike", () => {
        const content = `<pre><code class="language-html">&lt;h2&gt;Code&lt;/h2&gt;</code></pre>`
            + `<pre><code><h3>Unescaped</h3><a id="code"></a></code></pre>`
            + `<!-- <h4>Comment</h4><a id="comment"></a> -->`
            + `<p title="<h5>Attribute</h5>">Text</p>`
            + `<abbr id="abbr">A</abbr><aside id="aside">B</aside><hr id="rule"><h2>Real</h2>`;

        expect(findTextTargets(content)).toStrictEqual([ heading("Real", 2) ]);
        for (const plain of [ "", "Plain text", "<p>Paragraph</p>", "<abbr>A</abbr><hr>" ]) {
            expect(findTextTargets(plain)).toStrictEqual([]);
        }
    });

    it("walks content nested deeper than a recursive walk could go", () => {
        const depth = 20_000;
        const content = `${"<div>".repeat(depth)}<h2>${"<span>".repeat(depth)}Deep<a id="deep"></a>`
            + `${"</span>".repeat(depth)}</h2>${"</div>".repeat(depth)}`;

        expect(findTextTargets(content)).toStrictEqual([ heading("Deep", 2), anchor("deep") ]);
    });
});

describe("addHeadingReference", () => {
    it("puts the id right after the tag name of the heading and keeps every other byte", () => {
        const before = `﻿<p>Ünïcödé 😀 &amp; text</p>\r\n<!-- <h2>Not this</h2> -->`
            + `<pre><code>&lt;h2&gt;Code&lt;/h2&gt;</code></pre><h2 class="first">First</h2>\r\n`
            + `<figure class="table"><table><tbody><tr><td><H3`;
        const after = `\n class="c"\tdata-x='y'>In a cell</H3></td></tr></tbody></table></figure>`;
        const request = { index: 1, title: "In a cell" };

        const result = addHeadingReference(`${before}${after}`, request, () => "New1");
        expect(result).toStrictEqual({
            content: `${before} data-trilium-block-id="New1"${after}`,
            params: { block: "New1" }
        });
        expect(findTextTargets(result?.content ?? "")).toStrictEqual([
            heading("First", 2), heading("In a cell", 3, "New1")
        ]);
    });

    it("matches the text as it is listed, and tells headings of one text apart by index", () => {
        const tom = `Tom &amp; <em>Jerry</em><br>show</h2>`;
        const content = `<h2>${tom}<h2>Same</h2><h2>Same</h2>`;
        const add = (index: number, title: string) => (
            addHeadingReference(content, { index, title }, () => "Id")?.content
        );

        expect(add(0, "Tom & Jerry show"))
            .toBe(`<h2 data-trilium-block-id="Id">${tom}<h2>Same</h2><h2>Same</h2>`);
        expect(add(2, "Same"))
            .toBe(`<h2>${tom}<h2>Same</h2><h2 data-trilium-block-id="Id">Same</h2>`);
    });

    it("finds a heading that moved by its text while no other heading has it", () => {
        const content = `<h2>New</h2><h2>Target</h2><h2>Twin</h2><h2>Twin</h2>`;
        const withId = `<h2>New</h2><h2 data-trilium-block-id="Id">Target</h2>`
            + `<h2>Twin</h2><h2>Twin</h2>`;
        const add = (index: number, title: string) => (
            addHeadingReference(content, { index, title }, () => "Id")?.content ?? null
        );

        expect(add(0, "Target")).toBe(withId);
        expect(add(9, "Target")).toBe(withId);
        expect(add(-1, "Target")).toBe(withId);
        expect(add(0, "Twin")).toBeNull();
        expect(add(1, "Gone")).toBeNull();
        expect(add(0, "")).toBeNull();
        expect(addHeadingReference("<p>Text</p>", { index: 0, title: "Text" }, () => "Id"))
            .toBeNull();
    });

    it("returns the id that the heading has, without a change", () => {
        const content = `<h2 data-trilium-block-id="kept">Kept</h2>`;
        const createId = vi.fn(() => "Id");

        expect(addHeadingReference(content, { index: 0, title: "Kept" }, createId))
            .toStrictEqual({ content, params: { block: "kept" } });
        expect(createId).not.toHaveBeenCalled();
    });

    it("puts a new id in front of an invalid one, and the new one is read", () => {
        const attributes = [
            `data-trilium-block-id=""`, "data-trilium-block-id", `data-trilium-block-id="a:b"`
        ];
        for (const attribute of attributes) {
            const content = `<h2 ${attribute}>Heading</h2>`;

            const result = addHeadingReference(content, { index: 0, title: "Heading" }, () => "Id");
            expect(result?.content)
                .toBe(`<h2 data-trilium-block-id="Id" ${attribute}>Heading</h2>`);
            expect(findHeadings(result?.content ?? "")[0]?.params).toStrictEqual({ block: "Id" });
        }
    });

    it("gives a new id to a heading whose id an earlier block has", () => {
        const content = `<p data-trilium-block-id="dup">P</p>`
            + `<h2 data-trilium-block-id="dup">H</h2>`;

        const result = addHeadingReference(content, { index: 0, title: "H" }, () => "Id");
        expect(result).toStrictEqual({
            content: `<p data-trilium-block-id="dup">P</p>`
                + `<h2 data-trilium-block-id="Id" data-trilium-block-id="dup">H</h2>`,
            params: { block: "Id" }
        });
        expect(findHeadings(result?.content ?? "")[0]?.params).toStrictEqual({ block: "Id" });
    });

    it("draws another id while the one drawn occurs in the content", () => {
        const content = `<p>Taken</p><h2>Heading</h2>`;
        const createId = vi.fn()
            .mockReturnValueOnce("Taken")
            .mockReturnValueOnce("Head")
            .mockReturnValue("Free");

        expect(addHeadingReference(content, { index: 0, title: "Heading" }, createId))
            .toStrictEqual({
                content: `<p>Taken</p><h2 data-trilium-block-id="Free">Heading</h2>`,
                params: { block: "Free" }
            });
        expect(createId).toHaveBeenCalledTimes(3);
    });
});

describe("insertBlockId", () => {
    it("refuses an element that is not at its offset in the content", () => {
        const element = parse("<h2>A</h2>").querySelector("h2");
        if (!element) {
            throw new Error("The heading was not parsed.");
        }

        expect(insertBlockId("<h2>A</h2>", element, "Id"))
            .toBe(`<h2 data-trilium-block-id="Id">A</h2>`);
        expect(() => insertBlockId("<p>x</p><h2>A</h2>", element, "Id")).toThrow();
        expect(() => insertBlockId("<h3>A</h3>", element, "Id")).toThrow();
    });
});
