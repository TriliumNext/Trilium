import { describe, expect, it } from "vitest";

import { convertNotionHtml } from "./converter.js";

describe("convertNotionHtml — to-do lists", () => {
    it("converts an unchecked Notion to-do item to a CKEditor todo-list", () => {
        const input = `<ul class="to-do-list"><li><div class="checkbox checkbox-off"></div> <span class="to-do-children-unchecked">To do</span><div class="indented"></div></li></ul>`;
        expect(convertNotionHtml(input)).toBe(
            `<ul class="todo-list"><li><label class="todo-list__label"><input type="checkbox" disabled="disabled"><span class="todo-list__label__description">To do</span></label></li></ul>`
        );
    });

    it("marks a checked item with checked=\"checked\"", () => {
        const input = `<ul class="to-do-list"><li><div class="checkbox checkbox-on"></div> <span class="to-do-children-checked">Done</span><div class="indented"></div></li></ul>`;
        expect(convertNotionHtml(input)).toBe(
            `<ul class="todo-list"><li><label class="todo-list__label"><input type="checkbox" checked="checked" disabled="disabled"><span class="todo-list__label__description">Done</span></label></li></ul>`
        );
    });

    it("preserves inline formatting inside the item text", () => {
        const input = `<ul class="to-do-list"><li><div class="checkbox checkbox-off"></div> <span class="to-do-children-unchecked">Buy <strong>milk</strong></span><div class="indented"></div></li></ul>`;
        expect(convertNotionHtml(input)).toContain(`<span class="todo-list__label__description">Buy <strong>milk</strong></span>`);
    });

    it("leaves non-to-do HTML untouched", () => {
        const input = `<p id="x">Hello</p>`;
        expect(convertNotionHtml(input)).toBe(`<p id="x">Hello</p>`);
    });
});

describe("convertNotionHtml — to-do nesting and merging", () => {
    // Each Notion to-do item is its own <ul class="to-do-list"> wrapped in a display:contents <div>;
    // a parent's children live in its <div class="indented">, each again its own wrapped single-item list.
    const wrap = (ulInner: string) => `<div style="display:contents" dir="auto"><ul class="to-do-list"><li>${ulInner}</li></ul></div>`;
    const off = (text: string, indented = "") => `<div class="checkbox checkbox-off"></div> <span class="to-do-children-unchecked">${text}</span><div class="indented">${indented}</div>`;
    const on = (text: string, indented = "") => `<div class="checkbox checkbox-on"></div> <span class="to-do-children-checked">${text}</span><div class="indented">${indented}</div>`;

    const item = (text: string, opts: { checked?: boolean; nested?: string } = {}) =>
        `<li><label class="todo-list__label"><input type="checkbox"${opts.checked ? ` checked="checked"` : ""} disabled="disabled"><span class="todo-list__label__description">${text}</span></label>${opts.nested ?? ""}</li>`;
    const list = (...items: string[]) => `<ul class="todo-list">${items.join("")}</ul>`;

    it("nests a parent's sub-items into a single nested todo-list inside its <li>", () => {
        const input = wrap(off("Parent", wrap(off("Child 1")) + wrap(on("Child 2"))));
        expect(convertNotionHtml(input)).toBe(
            list(item("Parent", { nested: list(item("Child 1"), item("Child 2", { checked: true })) }))
        );
    });

    it("merges adjacent top-level to-do items into one list", () => {
        const input = wrap(off("A")) + wrap(on("B"));
        expect(convertNotionHtml(input)).toBe(list(item("A"), item("B", { checked: true })));
    });

    it("does not merge to-do items separated by other content", () => {
        const input = `${wrap(off("A"))}<p>Sep</p>${wrap(off("B"))}`;
        expect(convertNotionHtml(input)).toBe(`${list(item("A"))}<p>Sep</p>${list(item("B"))}`);
    });

    it("converts to-do lists nested inside other blocks (e.g. a toggle's <details>)", () => {
        const toggle = (summary: string, body: string) => `<ul class="toggle"><li><details open=""><summary>${summary}</summary>${body}</details></li></ul>`;
        const input = toggle("The quick brownie", wrap(off("The quick brown", wrap(off("fox jumps")))));
        expect(convertNotionHtml(input)).toBe(
            `<details open class="trilium-collapsible"><summary>The quick brownie</summary>${list(item("The quick brown", { nested: list(item("fox jumps")) }))}</details>`
        );
    });
});

describe("convertNotionHtml — display:contents wrappers", () => {
    it("unwraps the display:contents div Notion puts around each block", () => {
        expect(convertNotionHtml(`<div style="display:contents" dir="auto"><p id="x">A</p></div>`)).toBe(`<p id="x">A</p>`);
    });

    it("unwraps several wrapped blocks", () => {
        const input = `<div style="display:contents" dir="auto"><h1>A</h1></div><div style="display:contents" dir="auto"><p>B</p></div>`;
        expect(convertNotionHtml(input)).toBe(`<h1>A</h1><p>B</p>`);
    });

    it("flattens nested display:contents wrappers", () => {
        const input = `<div style="display:contents"><div style="display:contents"><p>A</p></div></div>`;
        expect(convertNotionHtml(input)).toBe(`<p>A</p>`);
    });

    it("leaves meaningful (non display:contents) divs intact", () => {
        const input = `<section><div style="font-size:1.5em"><span class="icon">x</span></div><div style="width:100%">body</div></section>`;
        expect(convertNotionHtml(input)).toBe(input);
    });
});

describe("convertNotionHtml — toggles", () => {
    it("unwraps a Notion toggle into a bare collapsible <details>, preserving its open state", () => {
        const input = `<div style="display:contents" dir="auto"><ul class="toggle"><li><details open=""><summary>Toggle title</summary><div style="display:contents" dir="auto"><p>Content goes here.</p></div><div style="display:contents" dir="auto"><p>And here.</p></div></details></li></ul></div>`;
        expect(convertNotionHtml(input)).toBe(
            `<details open class="trilium-collapsible"><summary>Toggle title</summary><p>Content goes here.</p><p>And here.</p></details>`
        );
    });

    it("preserves a collapsed toggle's state (no open attribute)", () => {
        expect(convertNotionHtml(`<ul class="toggle"><li><details><summary>Closed</summary></details></li></ul>`)).toBe(
            `<details class="trilium-collapsible"><summary>Closed</summary></details>`
        );
    });

    it("handles a toggle with no body and an empty summary", () => {
        expect(convertNotionHtml(`<ul class="toggle"><li><details open=""><summary>Title only</summary></details></li></ul>`)).toBe(
            `<details open class="trilium-collapsible"><summary>Title only</summary></details>`
        );
        expect(convertNotionHtml(`<ul class="toggle"><li><details open=""><summary></summary></details></li></ul>`)).toBe(
            `<details open class="trilium-collapsible"><summary></summary></details>`
        );
    });

    it("appends the collapsible class to a <details> that already has a class", () => {
        const input = `<ul class="toggle"><li><details class="existing"><summary>Title</summary></details></li></ul>`;
        expect(convertNotionHtml(input)).toBe(
            `<details class="existing trilium-collapsible"><summary>Title</summary></details>`
        );
    });

    it("keeps a nested toggle nested rather than flattening it", () => {
        const input = `<ul class="toggle"><li><details open=""><summary>Outer</summary><div style="display:contents"><ul class="toggle"><li><details open=""><summary>Inner</summary></details></li></ul></div></details></li></ul>`;
        expect(convertNotionHtml(input)).toBe(
            `<details open class="trilium-collapsible"><summary>Outer</summary><details open class="trilium-collapsible"><summary>Inner</summary></details></details>`
        );
    });
});

describe("convertNotionHtml — toggle headings", () => {
    // A toggle heading exports as a bare <details> (no ul.toggle wrapper) whose <summary> font-size encodes
    // the level; Notion nests its body in a `.indented` div and wraps blocks in display:contents.
    const toggleHeading = (size: string, title: string, body: string) =>
        `<div style="display:contents" dir="auto"><details open=""><summary style="font-weight:600;font-size:${size};line-height:1.3;margin:0">${title}</summary><div class="indented"><div style="display:contents" dir="auto">${body}</div></div></details></div>`;

    it("flattens a toggle heading into a plain heading, hoisting its body out of the `.indented` wrapper", () => {
        expect(convertNotionHtml(toggleHeading("1.875em", "Section A", "<p>Content goes here.</p>"))).toBe(
            `<h2>Section A</h2><p>Content goes here.</p>`
        );
    });

    it("maps each Notion toggle-heading size to the matching (shifted) heading level", () => {
        const input =
            toggleHeading("1.875em", "L1", "<p>a</p>") +
            toggleHeading("1.5em", "L2", "<p>b</p>") +
            toggleHeading("1.25em", "L3", "<p>c</p>") +
            toggleHeading("1.125em", "L4", "<p>d</p>");
        expect(convertNotionHtml(input)).toBe(
            `<h2>L1</h2><p>a</p><h3>L2</h3><p>b</p><h4>L3</h4><p>c</p><h5>L4</h5><p>d</p>`
        );
    });

    it("preserves inline formatting in the heading title and handles an empty body", () => {
        expect(convertNotionHtml(toggleHeading("1.5em", "A <strong>bold</strong> title", ""))).toBe(
            `<h3>A <strong>bold</strong> title</h3>`
        );
    });

    it("leaves a regular list toggle as a collapsible (its summary has no heading font-size)", () => {
        expect(convertNotionHtml(`<ul class="toggle"><li><details open=""><summary>Plain</summary><div style="display:contents"><p>x</p></div></details></li></ul>`)).toBe(
            `<details open class="trilium-collapsible"><summary>Plain</summary><p>x</p></details>`
        );
    });
});

describe("convertNotionHtml — table of contents", () => {
    it("drops Notion's table-of-contents nav, keeping the surrounding content (Trilium generates its own)", () => {
        const toc = `<nav class="block-color-gray table_of_contents"><div class="table_of_contents-item table_of_contents-indent-0"><a class="table_of_contents-link" href="#389c5eca-1b8b-805d-81d3-c56b2184de54">Heading 1</a></div></nav>`;
        expect(convertNotionHtml(`${toc}<h2 id="389c5eca-1b8b-805d-81d3-c56b2184de54">Heading 1</h2><p>Body</p>`)).toBe(
            `<h2 id="389c5eca-1b8b-805d-81d3-c56b2184de54">Heading 1</h2><p>Body</p>`
        );
    });
});

describe("convertNotionHtml — list fragmentation", () => {
    // Notion exports each list item as its own single-item <ul>/<ol> (wrapped in a display:contents <div>),
    // and fragments nested lists the same way; consecutive same-kind fragments must merge into one clean list.
    const dc = (inner: string) => `<div style="display:contents" dir="auto">${inner}</div>`;

    it("merges fragmented bullet items into a single list, including nested sublists", () => {
        const nested =
            dc(`<ul class="bulleted-list"><li style="list-style-type:circle">Nested 1</li></ul>`) +
            dc(`<ul class="bulleted-list"><li style="list-style-type:circle">Nested 2</li></ul>`);
        const input =
            dc(`<ul class="bulleted-list"><li style="list-style-type:disc">Item 1</li></ul>`) +
            dc(`<ul class="bulleted-list"><li style="list-style-type:disc">Item 2${nested}</li></ul>`);
        expect(convertNotionHtml(input)).toBe(
            `<ul><li style="list-style-type:disc">Item 1</li><li style="list-style-type:disc">Item 2<ul><li style="list-style-type:circle">Nested 1</li><li style="list-style-type:circle">Nested 2</li></ul></li></ul>`
        );
    });

    it("merges fragmented numbered items into a single list, dropping per-fragment start/type", () => {
        const nested =
            dc(`<ol type="a" class="numbered-list" start="1"><li>A</li></ol>`) +
            dc(`<ol type="a" class="numbered-list" start="2"><li>B</li></ol>`);
        const input =
            dc(`<ol type="1" class="numbered-list" start="1"><li>One</li></ol>`) +
            dc(`<ol type="1" class="numbered-list" start="2"><li>Two</li></ol>`) +
            dc(`<ol type="1" class="numbered-list" start="3"><li>Three${nested}</li></ol>`);
        expect(convertNotionHtml(input)).toBe(
            `<ol><li>One</li><li>Two</li><li>Three<ol><li>A</li><li>B</li></ol></li></ol>`
        );
    });

    it("does not merge lists separated by other content or of a different type", () => {
        const input =
            dc(`<ul class="bulleted-list"><li>A</li></ul>`) +
            dc(`<p>break</p>`) +
            dc(`<ul class="bulleted-list"><li>B</li></ul>`) +
            dc(`<ol class="numbered-list" start="1"><li>C</li></ol>`);
        expect(convertNotionHtml(input)).toBe(
            `<ul><li>A</li></ul><p>break</p><ul><li>B</li></ul><ol><li>C</li></ol>`
        );
    });
});

describe("convertNotionHtml — columns", () => {
    // Notion column layouts are a <div class="column-list"> of <div class="column" style="width:N%"> divs,
    // each wrapping its content in display:contents. They render as a single-row borderless table.
    const dc = (inner: string) => `<div style="display:contents" dir="auto">${inner}</div>`;
    const column = (width: string, text: string) =>
        dc(`<div style="width:${width}" class="column">${dc(`<p class="">${text}</p>`)}</div>`);
    const columnList = (...cols: string[]) => dc(`<div id="x" class="column-list">${cols.join("")}</div>`);

    it("renders a two-column layout as a borderless table with per-cell widths", () => {
        const input = columnList(column("50%", "First column"), column("50%", "Second column"));
        expect(convertNotionHtml(input)).toBe(
            `<figure class="table"><table style="border-color:transparent;"><tbody><tr>` +
            `<td style="border-color:transparent;width:50%;">First column</td>` +
            `<td style="border-color:transparent;width:50%;">Second column</td>` +
            `</tr></tbody></table></figure>`
        );
    });

    it("rounds an awkward column width to two decimals", () => {
        const input = columnList(
            column("33.33333333333333%", "First column"),
            column("33.33333333333333%", "Second column"),
            column("33.33333333333333%", "Third column")
        );
        expect(convertNotionHtml(input)).toBe(
            `<figure class="table"><table style="border-color:transparent;"><tbody><tr>` +
            `<td style="border-color:transparent;width:33.33%;">First column</td>` +
            `<td style="border-color:transparent;width:33.33%;">Second column</td>` +
            `<td style="border-color:transparent;width:33.33%;">Third column</td>` +
            `</tr></tbody></table></figure>`
        );
    });

    it("flattens a nested column list into one row, splitting the wrapper's width across the inner columns", () => {
        // The 50% wrapper column holds a 3-column list (each 100%, i.e. equal) plus an empty trailing
        // paragraph; the inner columns collapse into the row at 50% ÷ 3 = 16.67% each, the empty <p> dropped.
        const inner = dc(`<div class="column-list">${column("100%", "1") + column("100%", "2") + column("100%", "3")}</div>`);
        const wrapper = dc(`<div style="width:50%" class="column">${inner}${dc(`<p class=""></p>`)}</div>`);
        const input = dc(`<div id="x" class="column-list">${wrapper}${column("50%", "2/2")}</div>`);
        expect(convertNotionHtml(input)).toBe(
            `<figure class="table"><table style="border-color:transparent;"><tbody><tr>` +
            `<td style="border-color:transparent;width:16.67%;">1</td>` +
            `<td style="border-color:transparent;width:16.67%;">2</td>` +
            `<td style="border-color:transparent;width:16.67%;">3</td>` +
            `<td style="border-color:transparent;width:50%;">2/2</td>` +
            `</tr></tbody></table></figure>`
        );
    });

    it("keeps a column with loose content and a nested list as one cell (nested table inside), not losing content", () => {
        // Left column is a pure wrapper (flattens); the right column has loose content "2/2" plus a nested
        // list, so it stays a single cell carrying the paragraph and the nested columns as a nested table.
        const nestedA = dc(`<div class="column-list">${column("100%", "1") + column("100%", "2") + column("100%", "3")}</div>`);
        const wrapper = dc(`<div style="width:50%" class="column">${nestedA}${dc(`<p class=""></p>`)}</div>`);
        const nestedB = dc(`<div class="column-list">${column("100%", "the") + column("100%", "quick") + column("100%", "brown")}</div>`);
        const mixed = dc(`<div style="width:50%" class="column">${dc(`<p class="">2/2</p>`)}${nestedB}</div>`);
        const input = dc(`<div id="x" class="column-list">${wrapper}${mixed}</div>`);
        expect(convertNotionHtml(input)).toBe(
            `<figure class="table"><table style="border-color:transparent;"><tbody><tr>` +
            `<td style="border-color:transparent;width:16.67%;">1</td>` +
            `<td style="border-color:transparent;width:16.67%;">2</td>` +
            `<td style="border-color:transparent;width:16.67%;">3</td>` +
            `<td style="border-color:transparent;width:50%;"><p class="">2/2</p>` +
            `<figure class="table"><table style="border-color:transparent;"><tbody><tr>` +
            `<td style="border-color:transparent;width:33.33%;">the</td>` +
            `<td style="border-color:transparent;width:33.33%;">quick</td>` +
            `<td style="border-color:transparent;width:33.33%;">brown</td>` +
            `</tr></tbody></table></figure></td>` +
            `</tr></tbody></table></figure>`
        );
    });
});

describe("convertNotionHtml — callouts", () => {
    const callout = (emoji: string, body: string) =>
        `<div style="display:contents" dir="ltr"><figure class="block-color-gray_background callout" style="white-space:pre-wrap;display:flex" id="386c5eca"><div style="font-size:1.5em"><span class="icon">${emoji}</span></div><div style="width:100%"><div style="display:contents" dir="auto">${body}</div></div></figure></div>`;

    it("maps the default light-bulb callout to a tip admonition, dropping the redundant icon", () => {
        expect(convertNotionHtml(callout("💡", `<p>Callout with default icon.</p>`))).toBe(
            `<aside class="admonition tip"><p>Callout with default icon.</p></aside>`
        );
    });

    it("maps a non-default emoji callout to a note admonition, preserving the emoji in the content", () => {
        expect(convertNotionHtml(callout("♻️", `<p>Callout with custom emoji.</p>`))).toBe(
            `<aside class="admonition note"><p>♻️ Callout with custom emoji.</p></aside>`
        );
    });

    it("preserves a non-default emoji as a leading paragraph when the content doesn't start with one", () => {
        expect(convertNotionHtml(callout("♻️", `<h2>Heading body</h2>`))).toBe(
            `<aside class="admonition note"><p>♻️</p><h2>Heading body</h2></aside>`
        );
    });

    it("merges the emoji inline when the callout body is unwrapped inline content (Notion's usual shape)", () => {
        // Real Notion callouts hold raw text/inline markup with no wrapping <p>, so the emoji must share
        // the first line rather than sit on its own line above it.
        expect(convertNotionHtml(callout("📚", `The modern <strong>day</strong> reading list.`))).toBe(
            `<aside class="admonition note">📚 The modern <strong>day</strong> reading list.</aside>`
        );
    });
});

describe("convertNotionHtml — math", () => {
    it("converts an inline Notion equation to a Trilium math-tex span and drops the katex style import", () => {
        const input = `<p><style>@import url('https://cdn.jsdelivr.net/npm/katex@0.16.25/dist/katex-swap.min.css')</style><span data-token-index="0" contenteditable="false" class="notion-text-equation-token" style="user-select:all"><span></span><span><span class="katex"><span class="katex-mathml"><math xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><mi>e</mi><mo>=</mo><mi>m</mi><msup><mi>c</mi><mn>2</mn></msup></mrow><annotation encoding="application/x-tex">e=mc^2</annotation></semantics></math></span><span class="katex-html" aria-hidden="true">e=mc2</span></span></span></span></p>`;
        expect(convertNotionHtml(input)).toBe(`<p><span class="math-tex">\\(e=mc^2\\)</span></p>`);
    });

    it("converts a block Notion equation to a Trilium display math-tex figure and drops the katex style import", () => {
        const input = `<figure id="386c5eca-1b8b-8032-9922-d271e443683f" class="equation"><style>@import url('https://cdn.jsdelivr.net/npm/katex@0.16.25/dist/katex-swap.min.css')</style><div class="equation-container"><span class="katex-display"><span class="katex"><span class="katex-mathml"><math xmlns="http://www.w3.org/1998/Math/MathML" display="block"><semantics><mrow><mi>e</mi><mo>=</mo><mi>m</mi><msup><mi>c</mi><mn>2</mn></msup></mrow><annotation encoding="application/x-tex">e=mc^2</annotation></semantics></math></span><span class="katex-html" aria-hidden="true">e=mc2</span></span></span></div></figure>`;
        expect(convertNotionHtml(input)).toBe(`<figure><span class="math-tex">\\[e=mc^2\\]</span></figure>`);
    });

    it("removes a stray katex style block on its own", () => {
        expect(convertNotionHtml(`<p>Text<style>@import url('x')</style></p>`)).toBe(`<p>Text</p>`);
    });
});

describe("convertNotionHtml — bookmarks", () => {
    it("converts a Notion bookmark card to a Trilium link-embed, keeping the favicon and preview image", () => {
        const input = `<div style="display:contents" dir="ltr"><figure id="386c5eca"><a href="https://triliumnotes.org/" class="bookmark source"><div class="bookmark-info"><div class="bookmark-text"><div class="bookmark-title">Trilium Notes</div><div class="bookmark-description">Trilium is an open-source solution for note-taking and personal knowledge bases. Use it locally or sync with your own server to access notes anywhere.</div></div><div class="bookmark-href"><img src="https://triliumnotes.org/assets/favicon-BI5VJBD3.ico" class="icon bookmark-icon"/>https://triliumnotes.org/</div></div><img src="https://triliumnotes.org/assets/preview.jpg" class="bookmark-image"/></a></figure></div>`;
        expect(convertNotionHtml(input)).toBe(
            `<section class="link-embed" data-url="https://triliumnotes.org/" data-embed-type="opengraph" data-title="Trilium Notes" data-description="Trilium is an open-source solution for note-taking and personal knowledge bases. Use it locally or sync with your own server to access notes anywhere." data-favicon="https://triliumnotes.org/assets/favicon-BI5VJBD3.ico" data-image="https://triliumnotes.org/assets/preview.jpg"></section>`
        );
    });

    it("omits optional attributes that the bookmark doesn't provide", () => {
        const input = `<figure><a href="https://example.com/" class="bookmark source"><div class="bookmark-info"><div class="bookmark-text"><div class="bookmark-title">Example</div></div></div></a></figure>`;
        expect(convertNotionHtml(input)).toBe(
            `<section class="link-embed" data-url="https://example.com/" data-embed-type="opengraph" data-title="Example"></section>`
        );
    });
});

describe("convertNotionHtml — colors", () => {
    it("maps a text-color mark to a span with an opaque color style", () => {
        expect(convertNotionHtml(`<p><mark class="highlight-blue">Highlight</mark></p>`)).toBe(
            `<p><span style="color:rgb(56, 125, 201)">Highlight</span></p>`
        );
    });

    it("flattens a translucent background mark over white into a solid background-color", () => {
        // gray_background is rgba(42, 28, 0, 0.07); over white that resolves to a light tint, not near-black.
        expect(convertNotionHtml(`<p><mark class="highlight-gray_background">Highlight</mark></p>`)).toBe(
            `<p><span style="background-color:rgb(240, 239, 237)">Highlight</span></p>`
        );
    });

    it("drops the wrapper for default (uncolored) marks, keeping nested colored content", () => {
        // Notion nests a background mark inside a default text-color mark; only the inner color survives.
        expect(convertNotionHtml(`<p><mark class="highlight-default"><mark class="highlight-red_background">Highlight</mark></mark></p>`)).toBe(
            `<p><span style="background-color:rgb(252, 233, 231)">Highlight</span></p>`
        );
    });

    it("leaves a plain default mark as bare text", () => {
        expect(convertNotionHtml(`<p><mark class="highlight-default">Plain</mark></p>`)).toBe(`<p>Plain</p>`);
    });
});

describe("convertNotionHtml — tables", () => {
    it("rewrites a Notion simple-table into a canonical figure.table with scoped headers", () => {
        const input = `<div style="display:contents" dir="ltr"><table id="386c5eca" class="simple-table"><thead class="simple-table-header"><div style="display:contents" dir="ltr"><tr id="r0"><th id="?Hr:" class="simple-table-header-color simple-table-header" style="width:239.7px">Column 1</th><th id="SDzW" class="simple-table-header-color simple-table-header" style="width:239.7px">Column 2</th><th id="q@CU" class="simple-table-header-color simple-table-header" style="width:239.7px">Column 3</th></tr></div></thead><tbody><div style="display:contents" dir="ltr"><tr id="r1"><th id="?Hr:" class="simple-table-header-color simple-table-header" style="width:239.7px">Row 1</th><td id="SDzW" class="" style="width:239.7px">A</td><td id="q@CU" class="" style="width:239.7px">B</td></tr></div><div style="display:contents" dir="ltr"><tr id="r2"><th id="?Hr:" class="simple-table-header-color simple-table-header" style="width:239.7px">Row 2</th><td id="SDzW" class="" style="width:239.7px">C</td><td id="q@CU" class="" style="width:239.7px">D</td></tr></div></tbody></table></div>`;
        expect(convertNotionHtml(input)).toBe(
            `<figure class="table"><table><thead><tr><th scope="col">Column 1</th><th scope="col">Column 2</th><th scope="col">Column 3</th></tr></thead><tbody><tr><th scope="row">Row 1</th><td>A</td><td>B</td></tr><tr><th scope="row">Row 2</th><td>C</td><td>D</td></tr></tbody></table></figure>`
        );
    });
});

describe("convertNotionHtml — images", () => {
    it("normalizes a Notion image figure into a canonical figure>img (src left for the importer to rewrite)", () => {
        const input = `<div style="display:contents" dir="ltr"><figure id="386c5eca" class="image"><a href="Formatting%20test/Screenshot.png"><img style="width:463.98px" src="Formatting%20test/Screenshot.png"/></a></figure></div>`;
        expect(convertNotionHtml(input)).toBe(
            `<figure class="image"><img src="Formatting%20test/Screenshot.png"></figure>`
        );
    });

    it("leaves a plain figure>img untouched apart from dropping inline sizing", () => {
        expect(convertNotionHtml(`<figure class="image"><img src="x.png" style="width:10px"></figure>`)).toBe(
            `<figure class="image"><img src="x.png"></figure>`
        );
    });
});

describe("convertNotionHtml — attachments", () => {
    it("rewrites a Notion file block into a marked anchor for the importer to bind", () => {
        const input = `<div style="display:contents" dir="ltr"><figure id="386c5eca"><div class="source"><a href="Attachment%20test/demo.rtf">demo.rtf</a></div></figure></div>`;
        expect(convertNotionHtml(input)).toBe(
            `<p><a href="Attachment%20test/demo.rtf" class="notion-attachment">demo.rtf</a></p>`
        );
    });

    it("does not touch a bookmark card (its source class is on the anchor, not a wrapping div)", () => {
        const input = `<figure><a href="https://example.com/" class="bookmark source"><div class="bookmark-info"><div class="bookmark-text"><div class="bookmark-title">Example</div></div></div></a></figure>`;
        expect(convertNotionHtml(input)).toBe(
            `<section class="link-embed" data-url="https://example.com/" data-embed-type="opengraph" data-title="Example"></section>`
        );
    });
});

describe("convertNotionHtml — code blocks", () => {
    it("maps a known Notion code language to Trilium's mime class and drops the Prism includes", () => {
        const input = `<div style="display:contents" dir="auto"><script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/prism.min.js"></script><link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/themes/prism.min.css"/><script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-c.min.js"></script><pre id="386c5eca" class="code code-wrap"><code class="language-c" style="white-space:pre-wrap;word-break:break-all">void main() {}</code></pre></div>`;
        expect(convertNotionHtml(input)).toBe(`<pre><code class="language-text-x-csrc">void main() {}</code></pre>`);
    });

    it("falls back to auto-detect for an unknown language", () => {
        expect(convertNotionHtml(`<pre class="code"><code class="language-nonexistentlang">x</code></pre>`)).toBe(
            `<pre><code class="language-text-x-trilium-auto">x</code></pre>`
        );
    });

    it("falls back to auto-detect for an unlabelled code block", () => {
        expect(convertNotionHtml(`<pre class="code"><code>x</code></pre>`)).toBe(
            `<pre><code class="language-text-x-trilium-auto">x</code></pre>`
        );
    });

    it("preserves a mermaid code block as language-mermaid (not a mime) so Trilium renders the diagram", () => {
        const input = `<pre id="386c5eca" class="code code-wrap"><code class="language-mermaid" style="white-space:pre-wrap;word-break:break-all">graph TD
  Mermaid --&gt; Diagram</code></pre>`;
        expect(convertNotionHtml(input)).toBe(`<pre><code class="language-mermaid">graph TD
  Mermaid --&gt; Diagram</code></pre>`);
    });
});

describe("convertNotionHtml — inline databases", () => {
    const dbId = "38ac5eca1b8b808babeaf10c0980fa5b";
    const placeholder = `<section class="include-note" data-notion-id="${dbId}" data-box-size="medium">&nbsp;</section>`;

    it("replaces a rendered inline-database table (partial export) with an include-note placeholder", () => {
        const input =
            `<div style="display:contents" dir="ltr"><div id="38ac5eca-1b8b-808b-abea-f10c0980fa5b" class="collection-content"><h4 class="collection-title">Database title</h4>` +
            `<div class="collection-content-wrapper"><table class="collection-content"><thead><tr><th>Name</th></tr></thead><tbody>` +
            `<tr id="38ac5eca-1b8b-8069-afb5-c9fe40e53c42"><td class="cell-title"><a href="Inline%20database%20test/Database%20title/First%2038ac5eca1b8b8069afb5c9fe40e53c42.html">First</a></td></tr>` +
            `</tbody></table></div></div></div>`;
        expect(convertNotionHtml(input)).toBe(placeholder);
    });

    it("replaces an inline-database CSV link (full/workspace export) with the same placeholder", () => {
        const input =
            `<div style="display:contents" dir="ltr"><div id="38ac5eca-1b8b-808b-abea-f10c0980fa5b" class="collection-content"><h4 class="collection-title">Database title</h4>` +
            `<a href="Inline%20database%20test/Database%20title%20${dbId}.csv"><code>x</code></a></div></div>`;
        expect(convertNotionHtml(input)).toBe(placeholder);
    });

    it("leaves a collection-content block without an id untouched", () => {
        const input = `<div class="collection-content"><h4 class="collection-title">No id</h4></div>`;
        expect(convertNotionHtml(input)).toBe(input);
    });
});

describe("convertNotionHtml — link-to-page blocks", () => {
    it("unwraps a link-to-page figure into a paragraph link (href left for the importer to resolve)", () => {
        const input = `<div style="display:contents" dir="ltr"><figure id="386c5eca" class="link-to-page"><a href="Formatting%20test/Subpage%20386c5eca1b8b802a90d8d891c7e62cd5.html">Subpage</a></figure></div>`;
        expect(convertNotionHtml(input)).toBe(
            `<p><a href="Formatting%20test/Subpage%20386c5eca1b8b802a90d8d891c7e62cd5.html">Subpage</a></p>`
        );
    });
});

describe("convertNotionHtml — date mentions", () => {
    it("strips the @ prefix Notion puts on inline <time> date mentions", () => {
        expect(convertNotionHtml(`<p><time>@June 21, 2026</time></p>`)).toBe(`<p><time>June 21, 2026</time></p>`);
    });

    it("leaves date text without an @ untouched", () => {
        expect(convertNotionHtml(`<p><time>June 21, 2026</time></p>`)).toBe(`<p><time>June 21, 2026</time></p>`);
    });
});

describe("convertNotionHtml — math edge cases", () => {
    it("leaves an inline equation token with no annotation alone (no math-tex span)", () => {
        const input = `<p><span class="notion-text-equation-token"><span class="katex"><span class="katex-html">e=mc2</span></span></span></p>`;
        const output = convertNotionHtml(input);
        expect(output).not.toContain("math-tex");
        expect(output).toBe(input);
    });

    it("leaves a block equation figure with no annotation alone (no math-tex figure)", () => {
        const input = `<figure class="equation"><div class="equation-container"><span class="katex-display"><span class="katex"><span class="katex-html">e=mc2</span></span></span></div></figure>`;
        const output = convertNotionHtml(input);
        expect(output).not.toContain("math-tex");
        expect(output).toBe(input);
    });

    it("falls back to the first annotation when none is encoded as application/x-tex", () => {
        const input = `<p><span class="notion-text-equation-token"><span class="katex"><math><semantics><annotation encoding="application/x-llamapun">e = mc^2</annotation></semantics></math></span></span></p>`;
        expect(convertNotionHtml(input)).toBe(`<p><span class="math-tex">\\(e = mc^2\\)</span></p>`);
    });
});

describe("convertNotionHtml — to-do edge cases", () => {
    it("does not merge to-do items separated by a non-whitespace text node", () => {
        const wrap = (text: string) => `<ul class="to-do-list"><li><div class="checkbox checkbox-off"></div> <span class="to-do-children-unchecked">${text}</span></li></ul>`;
        const list = (text: string) => `<ul class="todo-list"><li><label class="todo-list__label"><input type="checkbox" disabled="disabled"><span class="todo-list__label__description">${text}</span></label></li></ul>`;
        const input = `${wrap("A")}separator${wrap("B")}`;
        expect(convertNotionHtml(input)).toBe(`${list("A")}separator${list("B")}`);
    });

    it("merges to-do items separated only by whitespace text nodes", () => {
        const wrap = (text: string) => `<ul class="to-do-list"><li><div class="checkbox checkbox-off"></div> <span class="to-do-children-unchecked">${text}</span></li></ul>`;
        const item = (text: string) => `<li><label class="todo-list__label"><input type="checkbox" disabled="disabled"><span class="todo-list__label__description">${text}</span></label></li>`;
        const input = `${wrap("A")}\n   \n${wrap("B")}`;
        // Whitespace between the wrappers does not break the run, so both items merge into one list.
        expect(convertNotionHtml(input)).toContain(`<ul class="todo-list">${item("A")}${item("B")}</ul>`);
    });

    it("defaults to unchecked and an empty label when the checkbox and label spans are missing", () => {
        const input = `<ul class="to-do-list"><li></li></ul>`;
        expect(convertNotionHtml(input)).toBe(
            `<ul class="todo-list"><li><label class="todo-list__label"><input type="checkbox" disabled="disabled"><span class="todo-list__label__description"></span></label></li></ul>`
        );
    });

    it("builds an item without a checkbox div but with a label span", () => {
        const input = `<ul class="to-do-list"><li><span class="to-do-children-unchecked">No checkbox</span></li></ul>`;
        expect(convertNotionHtml(input)).toBe(
            `<ul class="todo-list"><li><label class="todo-list__label"><input type="checkbox" disabled="disabled"><span class="todo-list__label__description">No checkbox</span></label></li></ul>`
        );
    });
});

describe("convertNotionHtml — images edge cases", () => {
    it("leaves an image figure with no <img> inside untouched", () => {
        const input = `<figure class="image"><figcaption>No image here</figcaption></figure>`;
        expect(convertNotionHtml(input)).toBe(input);
    });
});

describe("convertNotionHtml — code block edge cases", () => {
    it("leaves a <pre> with no <code> inside untouched (apart from id/class)", () => {
        const input = `<pre class="code">plain text, no code element</pre>`;
        expect(convertNotionHtml(input)).toBe(input);
    });
});

describe("convertNotionHtml — callout edge cases", () => {
    it("falls back to the last div for content when no width:100% div is present and there is no icon div", () => {
        // With no icon div the emoji is empty, which is not the default light-bulb, so it maps to a note;
        // an empty emoji means nothing is prepended to the content.
        const input = `<figure class="callout"><div>Just the body, no icon div.</div></figure>`;
        expect(convertNotionHtml(input)).toBe(`<aside class="admonition note">Just the body, no icon div.</aside>`);
    });

    it("produces an empty admonition when the callout has no div children at all", () => {
        const input = `<figure class="callout"><span class="icon">💡</span></figure>`;
        expect(convertNotionHtml(input)).toBe(`<aside class="admonition note"></aside>`);
    });

    it("maps a callout with an empty icon to a tip (empty emoji is not the default light-bulb but nothing is prepended)", () => {
        const input = `<figure class="callout"><div style="font-size:1.5em"><span class="icon"></span></div><div style="width:100%"><p>Body</p></div></figure>`;
        expect(convertNotionHtml(input)).toBe(`<aside class="admonition note"><p>Body</p></aside>`);
    });
});

describe("convertNotionHtml — color edge cases", () => {
    it("unwraps a default highlight mark to plain inner HTML", () => {
        expect(convertNotionHtml(`<p><mark class="highlight-default">Plain <strong>text</strong></mark></p>`)).toBe(
            `<p>Plain <strong>text</strong></p>`
        );
    });

    it("unwraps a mark whose class is not a recognized highlight class", () => {
        expect(convertNotionHtml(`<p><mark class="something-else">Body</mark></p>`)).toBe(`<p>Body</p>`);
    });

    it("unwraps a mark with no class attribute at all", () => {
        expect(convertNotionHtml(`<p><mark>Body</mark></p>`)).toBe(`<p>Body</p>`);
    });

    it("unwraps a mark with an unknown color name not in the palette", () => {
        expect(convertNotionHtml(`<p><mark class="highlight-chartreuse">Body</mark></p>`)).toBe(`<p>Body</p>`);
    });
});

describe("convertNotionHtml — link-to-page edge cases", () => {
    it("leaves a link-to-page figure with no anchor untouched", () => {
        const input = `<figure class="link-to-page"><span>No link here</span></figure>`;
        expect(convertNotionHtml(input)).toBe(input);
    });
});
