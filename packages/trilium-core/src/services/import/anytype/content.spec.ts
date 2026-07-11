import { describe, expect, it } from "vitest";

import { extractContent, renderCodeBlock, renderInlineText, renderLatexBlock, renderTable } from "./content.js";
import { parseObject } from "./importer.js";
import type { AnytypeBlock, AnytypeMark, AnytypeSnapshot, LinkResolver } from "./model.js";

/** Wraps blocks + details into the export's snapshot shape. */
function snapshot(
    blocks: AnytypeBlock[],
    details: { id?: string; name?: string; layout?: number; resolvedLayout?: number; createdDate?: number; lastModifiedDate?: number; links?: string[]; [key: string]: unknown },
    sbType = "Page"
): AnytypeSnapshot {
    return { sbType, snapshot: { data: { blocks, details } } };
}

/** An inline mark over a `[from, to)` range. */
function mark(from: number, to: number, type: string, param?: string): AnytypeMark {
    return { range: { from, to }, type, param };
}

/** A list item (Marked/Numbered/Checkbox) with optional nested children, checked state and marks. */
function listItem(id: string, style: string, text: string, childrenIds: string[] = [], checked = false, marks: AnytypeMark[] = []): AnytypeBlock {
    return { id, text: { text, style, marks: { marks }, checked }, childrenIds };
}

/** A page whose root's direct children are `rootChildIds`; `blocks` supplies those plus any nested blocks. */
function listDoc(rootChildIds: string[], blocks: AnytypeBlock[]): AnytypeSnapshot {
    return snapshot([{ id: "obj", childrenIds: rootChildIds }, ...blocks], { id: "obj", name: "List" });
}

describe("lists", () => {
    it("groups consecutive Marked items into one <ul>", () => {
        const doc = listDoc(["m1", "m2"], [listItem("m1", "Marked", "One"), listItem("m2", "Marked", "Two")]);
        expect(parseObject(doc).content).toBe("<ul><li>One</li><li>Two</li></ul>");
    });

    it("renders Numbered items as an <ol>", () => {
        const doc = listDoc(["n1", "n2"], [listItem("n1", "Numbered", "One"), listItem("n2", "Numbered", "Two")]);
        expect(parseObject(doc).content).toBe("<ol><li>One</li><li>Two</li></ol>");
    });

    it("renders Checkbox items as a CKEditor todo-list carrying the checked state", () => {
        const doc = listDoc(["c1", "c2"], [listItem("c1", "Checkbox", "Todo", [], false), listItem("c2", "Checkbox", "Done", [], true)]);
        expect(parseObject(doc).content).toBe(
            '<ul class="todo-list">' +
                '<li><label class="todo-list__label"><input type="checkbox"disabled="disabled"><span class="todo-list__label__description">Todo</span></label></li>' +
                '<li><label class="todo-list__label"><input type="checkbox"checked="checked" disabled="disabled"><span class="todo-list__label__description">Done</span></label></li>' +
                "</ul>"
        );
    });

    it("nests child list items inside the parent <li>", () => {
        const doc = listDoc(
            ["m1", "m2"],
            [listItem("m1", "Marked", "One", ["m1a"]), listItem("m1a", "Marked", "One-A"), listItem("m2", "Marked", "Two")]
        );
        expect(parseObject(doc).content).toBe("<ul><li>One<ul><li>One-A</li></ul></li><li>Two</li></ul>");
    });

    it("starts a new list when the type changes or a non-list block interrupts", () => {
        const doc = listDoc(
            ["m1", "n1", "p1", "m2"],
            [
                listItem("m1", "Marked", "Bullet"),
                listItem("n1", "Numbered", "Number"),
                { id: "p1", text: { text: "Para", style: "Paragraph", marks: { marks: [] } } },
                listItem("m2", "Marked", "Again")
            ]
        );
        expect(parseObject(doc).content).toBe("<ul><li>Bullet</li></ul><ol><li>Number</li></ol><p>Para</p><ul><li>Again</li></ul>");
    });

    it("applies inline marks inside list items", () => {
        const doc = listDoc(["m1"], [listItem("m1", "Marked", "Bold item", [], false, [mark(0, 4, "Bold")])]);
        expect(parseObject(doc).content).toBe("<ul><li><strong>Bold</strong> item</li></ul>");
    });
});

describe("quotes", () => {
    it("converts a Quote (Anytype's Highlight block) to a blockquote", () => {
        const doc = listDoc(["q1"], [{ id: "q1", text: { text: "A quote", style: "Quote", marks: { marks: [] } } }]);
        expect(parseObject(doc).content).toBe("<blockquote><p>A quote</p></blockquote>");
    });

    it("applies inline marks and renders child blocks inside the blockquote", () => {
        const doc = listDoc(
            ["q1"],
            [
                { id: "q1", text: { text: "Bold quote", style: "Quote", marks: { marks: [mark(0, 4, "Bold")] } }, childrenIds: ["q1a"] },
                { id: "q1a", text: { text: "More", style: "Paragraph", marks: { marks: [] } } }
            ]
        );
        expect(parseObject(doc).content).toBe("<blockquote><p><strong>Bold</strong> quote</p><p>More</p></blockquote>");
    });
});

describe("callouts", () => {
    it("converts a default-icon callout to a tip admonition (icon implied, dropped)", () => {
        const doc = listDoc(["c1"], [{ id: "c1", text: { text: "Heads up", style: "Callout", marks: { marks: [] }, iconEmoji: "" } }]);
        expect(parseObject(doc).content).toBe('<aside class="admonition tip"><p>Heads up</p></aside>');
    });

    it("converts a custom-emoji callout to a note admonition, keeping the emoji at the start", () => {
        const doc = listDoc(["c1"], [{ id: "c1", text: { text: "Foggy", style: "Callout", marks: { marks: [] }, iconEmoji: "😶‍🌫️" } }]);
        expect(parseObject(doc).content).toBe('<aside class="admonition note"><p>😶‍🌫️ Foggy</p></aside>');
    });

    it("escapes the callout icon so a crafted iconEmoji can't inject markup", () => {
        const doc = listDoc(["c1"], [{ id: "c1", text: { text: "Hi", style: "Callout", marks: { marks: [] }, iconEmoji: '<img src=x onerror="alert(1)">' } }]);
        expect(parseObject(doc).content).toBe('<aside class="admonition note"><p>&lt;img src=x onerror=&quot;alert(1)&quot;&gt; Hi</p></aside>');
    });

    it("applies inline marks in the callout body and renders child blocks inside the aside", () => {
        const doc = listDoc(
            ["c1"],
            [
                { id: "c1", text: { text: "Bold note", style: "Callout", marks: { marks: [mark(0, 4, "Bold")] }, iconEmoji: "" }, childrenIds: ["c1a"] },
                { id: "c1a", text: { text: "More", style: "Paragraph", marks: { marks: [] } } }
            ]
        );
        expect(parseObject(doc).content).toBe('<aside class="admonition tip"><p><strong>Bold</strong> note</p><p>More</p></aside>');
    });
});

describe("dividers", () => {
    it("converts Line and Dots divider blocks to <hr>", () => {
        const doc = listDoc(
            ["p1", "d1", "d2", "p2"],
            [
                { id: "p1", text: { text: "Above", style: "Paragraph", marks: { marks: [] } } },
                { id: "d1", div: { style: "Line" } },
                { id: "d2", div: { style: "Dots" } },
                { id: "p2", text: { text: "Below", style: "Paragraph", marks: { marks: [] } } }
            ]
        );
        expect(parseObject(doc).content).toBe("<p>Above</p><hr><hr><p>Below</p>");
    });
});

describe("toggles", () => {
    it("converts a Toggle to a collapsible block, nesting its children as the collapsed body", () => {
        const doc = listDoc(
            ["t1", "p1"],
            [
                { id: "t1", text: { text: "Summary", style: "Toggle", marks: { marks: [mark(0, 7, "Bold")] } }, childrenIds: ["t1a"] },
                { id: "t1a", text: { text: "Hidden", style: "Paragraph", marks: { marks: [] } } },
                { id: "p1", text: { text: "After", style: "Paragraph", marks: { marks: [] } } }
            ]
        );
        expect(parseObject(doc).content).toBe(
            '<details class="trilium-collapsible"><summary><strong>Summary</strong></summary><p>Hidden</p></details><p>After</p>'
        );
    });

    it("converts toggle headings to normal headings (h2/h3/h4), keeping their content", () => {
        const doc = listDoc(
            ["th1", "th2", "th3"],
            [
                { id: "th1", text: { text: "T1", style: "ToggleHeader1", marks: { marks: [] } }, childrenIds: ["th1a"] },
                { id: "th1a", text: { text: "Body", style: "Paragraph", marks: { marks: [] } } },
                { id: "th2", text: { text: "T2", style: "ToggleHeader2", marks: { marks: [] } } },
                { id: "th3", text: { text: "T3", style: "ToggleHeader3", marks: { marks: [] } } }
            ]
        );
        expect(parseObject(doc).content).toBe("<h2>T1</h2><p>Body</p><h3>T2</h3><h4>T3</h4>");
    });
});

describe("links", () => {
    /** A block-level "link to object" pointing at the target object's id (CID). */
    const linkBlock = (id: string, targetCid: string): AnytypeBlock => ({ id, link: { targetBlockId: targetCid, style: "Page" }, childrenIds: [] });

    it("renders a link to an imported page as a reference link and records the resolved target", () => {
        const doc = listDoc(["l1"], [linkBlock("l1", "target-cid")]);
        const resolve: LinkResolver = (cid) => (cid === "target-cid" ? { noteId: "noteB", title: "Target Page" } : undefined);

        const result = parseObject(doc, resolve);
        expect(result.content).toBe('<p><a class="reference-link" href="#root/noteB">Target Page</a></p>');
        // The resolved target id is surfaced so the importer can create the internalLink relation.
        expect(result.linkTargetIds).toEqual(["noteB"]);
    });

    it("drops a link whose target wasn't imported (a set, or an object missing from the export)", () => {
        const doc = listDoc(["l1"], [linkBlock("l1", "missing-cid")]);

        const result = parseObject(doc, () => undefined);
        expect(result.content).toBe("");
        expect(result.linkTargetIds).toEqual([]);
    });

    it("escapes the target title and de-duplicates repeated links to the same page", () => {
        const doc = listDoc(["l1", "l2"], [linkBlock("l1", "t"), linkBlock("l2", "t")]);
        const resolve: LinkResolver = () => ({ noteId: "n", title: "A & B <x>" });

        const result = parseObject(doc, resolve);
        expect(result.content).toBe(
            '<p><a class="reference-link" href="#root/n">A &amp; B &lt;x&gt;</a></p>' +
                '<p><a class="reference-link" href="#root/n">A &amp; B &lt;x&gt;</a></p>'
        );
        // Both links point at the same note, so only one relation should be recorded.
        expect(result.linkTargetIds).toEqual(["n"]);
    });

    it("ignores link blocks when no resolver is supplied (parsing a page in isolation)", () => {
        const doc = listDoc(["p1", "l1"], [{ id: "p1", text: { text: "Body", style: "Paragraph", marks: { marks: [] } } }, linkBlock("l1", "t")]);

        const result = parseObject(doc);
        expect(result.content).toBe("<p>Body</p>");
        expect(result.linkTargetIds).toEqual([]);
    });
});

describe("inline files", () => {
    /** A file/media block embedding a `FileObject` by its id. */
    const fileBlock = (id: string, file: AnytypeBlock["file"]): AnytypeBlock => ({ id, file, childrenIds: [] });

    it("renders an Image block as an image figure whose src is the target file id (resolved later by the importer)", () => {
        const doc = listDoc(["f1"], [fileBlock("f1", { type: "Image", name: "shot.png", targetObjectId: "file-cid", state: "Done", style: "Embed" })]);
        expect(parseObject(doc).content).toBe('<figure class="image"><img src="file-cid"></figure>');
    });

    it("renders a non-image file block as a marked anchor carrying the file name and target id", () => {
        const doc = listDoc(["f1"], [fileBlock("f1", { type: "PDF", name: "report.pdf", targetObjectId: "pdf-cid", state: "Done", style: "Link" })]);
        expect(parseObject(doc).content).toBe('<p><a class="anytype-file" href="pdf-cid">report.pdf</a></p>');
    });

    it("falls back to the target id as the link text when the file has no name", () => {
        const doc = listDoc(["f1"], [fileBlock("f1", { type: "File", targetObjectId: "bare-cid" })]);
        expect(parseObject(doc).content).toBe('<p><a class="anytype-file" href="bare-cid">bare-cid</a></p>');
    });

    it("escapes the file name in a non-image anchor", () => {
        const doc = listDoc(["f1"], [fileBlock("f1", { type: "File", name: "a & b <x>.txt", targetObjectId: "c" })]);
        expect(parseObject(doc).content).toBe('<p><a class="anytype-file" href="c">a &amp; b &lt;x&gt;.txt</a></p>');
    });

    it("drops a file block with no target (e.g. a still-uploading file)", () => {
        const doc = listDoc(["f1"], [fileBlock("f1", { type: "Image", name: "pending.png", state: "Uploading" })]);
        expect(parseObject(doc).content).toBe("");
    });

    it("surfaces the embedded file ids (so the importer knows which files a page references)", () => {
        const doc = listDoc(
            ["f1", "f2"],
            [
                fileBlock("f1", { type: "Image", name: "pic.png", targetObjectId: "img-cid" }),
                fileBlock("f2", { type: "PDF", name: "doc.pdf", targetObjectId: "pdf-cid" })
            ]
        );
        expect(parseObject(doc).inlineFileIds).toEqual(["img-cid", "pdf-cid"]);
    });
});

describe("bookmarks", () => {
    /** A bookmark block — Anytype's web-link card, carrying the target site's url/title/description inline. */
    const bookmarkBlock = (id: string, bookmark: AnytypeBlock["bookmark"]): AnytypeBlock => ({ id, bookmark, childrenIds: [] });

    it("renders a bookmark as a Trilium link-embed, keeping the title, description and favicon/preview file placeholders", () => {
        const doc = listDoc(["b1"], [
            bookmarkBlock("b1", {
                url: "https://triliumnotes.org/",
                title: "Trilium Notes",
                description: "An open-source note-taking app.",
                faviconHash: "favicon-cid",
                imageHash: "preview-cid",
                type: "Page",
                targetObjectId: "bookmark-obj-cid",
                state: "Done"
            })
        ]);
        const result = parseObject(doc);
        // The favicon/preview are emitted as raw file-id placeholders; the importer resolves them to data URIs.
        expect(result.content).toBe(
            '<section class="link-embed" data-url="https://triliumnotes.org/" data-embed-type="opengraph" data-title="Trilium Notes" data-description="An open-source note-taking app." data-favicon="favicon-cid" data-image="preview-cid"></section>'
        );
        // The favicon/preview file ids are surfaced so a collection-scoped export doesn't treat them as members.
        expect(result.inlineFileIds).toEqual(["favicon-cid", "preview-cid"]);
    });

    it("omits the optional fields when the bookmark doesn't provide them", () => {
        const doc = listDoc(["b1"], [bookmarkBlock("b1", { url: "https://example.com/", state: "Done" })]);
        const result = parseObject(doc);
        expect(result.content).toBe(
            '<section class="link-embed" data-url="https://example.com/" data-embed-type="opengraph"></section>'
        );
        expect(result.inlineFileIds).toEqual([]);
    });

    it("escapes the url, title and description", () => {
        const doc = listDoc(["b1"], [
            bookmarkBlock("b1", { url: 'https://example.com/?a="1"&b=2', title: 'A & "B" <x>', description: "<script>" })
        ]);
        expect(parseObject(doc).content).toBe(
            '<section class="link-embed" data-url="https://example.com/?a=&quot;1&quot;&amp;b=2" data-embed-type="opengraph" data-title="A &amp; &quot;B&quot; &lt;x&gt;" data-description="&lt;script&gt;"></section>'
        );
    });

    it("drops a bookmark with no url (still resolving, or a broken card)", () => {
        const doc = listDoc(["b1"], [bookmarkBlock("b1", { title: "No url yet", state: "Fetching" })]);
        expect(parseObject(doc).content).toBe("");
    });

    it("does not record an internalLink for a bookmark (it is an external web link, not an imported note)", () => {
        const doc = listDoc(["b1"], [bookmarkBlock("b1", { url: "https://example.com/", targetObjectId: "bookmark-obj-cid", state: "Done" })]);
        const resolve: LinkResolver = () => ({ noteId: "n", title: "unexpected" });

        const result = parseObject(doc, resolve);
        expect(result.linkTargetIds).toEqual([]);
    });
});

describe("extractContent", () => {
    it("returns empty output when the block tree has no resolvable root", () => {
        expect(extractContent([], "missing", () => undefined)).toEqual({ html: "", linkTargetIds: [], fileTargetIds: [] });
    });

    it("ignores an inline mark of an unrenderable type, leaving the text plain", () => {
        // Not a structural mark, a known colour, or a Mention — so it contributes no formatting.
        expect(renderInlineText("x", [mark(0, 1, "Emoji")])).toBe("x");
    });
});

describe("renderInlineText", () => {
    it("returns escaped plain text when there are no marks", () => {
        expect(renderInlineText("a < b & c > d", [])).toBe("a &lt; b &amp; c &gt; d");
    });

    it("wraps a single mark's range, leaving the rest untouched", () => {
        expect(renderInlineText("Bold text", [mark(0, 4, "Bold")])).toBe("<strong>Bold</strong> text");
    });

    it("maps the five supported marks to their tags ([from, to) range)", () => {
        expect(renderInlineText("x", [mark(0, 1, "Bold")])).toBe("<strong>x</strong>");
        expect(renderInlineText("x", [mark(0, 1, "Italic")])).toBe("<em>x</em>");
        expect(renderInlineText("x", [mark(0, 1, "Strikethrough")])).toBe("<s>x</s>");
        expect(renderInlineText("x", [mark(0, 1, "Underscored")])).toBe("<u>x</u>");
        expect(renderInlineText("x", [mark(0, 1, "Keyboard")])).toBe("<code>x</code>");
    });

    it("renders the real 'Formatting test' line, nesting coincident bold+italic+underline", () => {
        // Verbatim text and marks from the exported page (marks intentionally unsorted, as in the export).
        const text = "Bold Italic Strikethrough Underline Bold Italic Underline";
        const marks = [
            mark(12, 25, "Strikethrough"),
            mark(5, 11, "Italic"),
            mark(36, 57, "Italic"),
            mark(0, 4, "Bold"),
            mark(36, 57, "Bold"),
            mark(26, 35, "Underscored"),
            mark(36, 57, "Underscored")
        ];
        expect(renderInlineText(text, marks)).toBe(
            "<strong>Bold</strong> <em>Italic</em> <s>Strikethrough</s> <u>Underline</u> <strong><em><u>Bold Italic Underline</u></em></strong>"
        );
    });

    it("splits partially overlapping marks into properly nested segments", () => {
        // Bold [0,4) and Italic [2,6) overlap only on [2,4).
        expect(renderInlineText("abcdef", [mark(0, 4, "Bold"), mark(2, 6, "Italic")])).toBe(
            "<strong>ab</strong><strong><em>cd</em></strong><em>ef</em>"
        );
    });

    it("maps TextColor to a colour span and a BackgroundColor highlight to a colour + background span", () => {
        expect(renderInlineText("Red", [mark(0, 3, "TextColor", "red")])).toBe('<span style="color:#e2400c">Red</span>');
        // A highlight with no explicit text colour gets Anytype's default dark text (#252525) so it stays
        // readable on dark themes — otherwise the theme-default white text is invisible on the pale highlight.
        expect(renderInlineText("Red", [mark(0, 3, "BackgroundColor", "red")])).toBe(
            '<span style="color:#252525;background-color:#fcd1c3">Red</span>'
        );
    });

    it("combines co-occurring text + background colour into one span, nested inside structural marks", () => {
        // An explicit text colour wins over the highlight default, and both fold into a single span.
        expect(renderInlineText("Red", [mark(0, 3, "TextColor", "red"), mark(0, 3, "BackgroundColor", "red")])).toBe(
            '<span style="color:#e2400c;background-color:#fcd1c3">Red</span>'
        );
        // A structural mark stays outermost; the colour span nests inside it.
        expect(renderInlineText("Red", [mark(0, 3, "Bold"), mark(0, 3, "TextColor", "red")])).toBe(
            '<strong><span style="color:#e2400c">Red</span></strong>'
        );
    });

    it("colours each word independently across a palette line (as the page exports it)", () => {
        expect(renderInlineText("Grey Red", [mark(0, 4, "TextColor", "grey"), mark(5, 8, "TextColor", "red")])).toBe(
            '<span style="color:#8c9ea5">Grey</span> <span style="color:#e2400c">Red</span>'
        );
    });

    it("ignores an unknown colour name and genuinely unsupported mark types", () => {
        expect(renderInlineText("x", [mark(0, 1, "TextColor", "chartreuse")])).toBe("x");
        expect(renderInlineText("@bob", [mark(0, 4, "Mention", "someObjectId")])).toBe("@bob");
    });

    it("escapes HTML inside a marked range", () => {
        expect(renderInlineText("a<b", [mark(0, 3, "Bold")])).toBe("<strong>a&lt;b</strong>");
    });

    it("clamps out-of-range offsets and drops empty / reversed ranges", () => {
        expect(renderInlineText("hi", [mark(0, 100, "Bold")])).toBe("<strong>hi</strong>");
        expect(renderInlineText("hi", [mark(1, 1, "Bold")])).toBe("hi");
        expect(renderInlineText("hi", [mark(2, 0, "Bold")])).toBe("hi");
    });
});

describe("inline formulas", () => {
    it("converts an inline $…$ formula to a CKEditor inline math span (the real exported paragraph)", () => {
        // Verbatim from the sample page: Anytype stores an inline formula as literal `$…$` text, no marks.
        expect(renderInlineText("Inline formula: $e=mc^2$", [])).toBe('Inline formula: <span class="math-tex">\\( e=mc^2 \\)</span>');
    });

    it("renders the inline formula inside its paragraph through parseObject", () => {
        const doc = listDoc(["p1"], [{ id: "p1", text: { text: "Inline formula: $e=mc^2$", style: "Paragraph", marks: { marks: [] } } }]);
        expect(parseObject(doc).content).toBe('<p>Inline formula: <span class="math-tex">\\( e=mc^2 \\)</span></p>');
    });

    it("converts a $$…$$ run to a display math span", () => {
        expect(renderInlineText("see $$a+b$$ done", [])).toBe('see <span class="math-tex">\\[ a+b \\]</span> done');
    });

    it("renders several formulas in one line", () => {
        expect(renderInlineText("$x$ and $y$", [])).toBe('<span class="math-tex">\\( x \\)</span> and <span class="math-tex">\\( y \\)</span>');
    });

    it("escapes HTML inside the formula body so it can't inject markup", () => {
        expect(renderInlineText("$a<b & c$", [])).toBe('<span class="math-tex">\\( a&lt;b &amp; c \\)</span>');
    });

    it("still applies inline marks to the text surrounding a formula", () => {
        // Bold over "Mass" [0,4), formula follows untouched.
        expect(renderInlineText("Mass: $e=mc^2$", [mark(0, 4, "Bold")])).toBe('<strong>Mass</strong>: <span class="math-tex">\\( e=mc^2 \\)</span>');
    });

    it("leaves a lone or mismatched $ as literal text", () => {
        expect(renderInlineText("Costs $5 today", [])).toBe("Costs $5 today");
        expect(renderInlineText("$$e=mc^2$", [])).toBe("$$e=mc^2$");
    });
});

describe("inline mentions", () => {
    /** A resolver that maps any non-"missing" id to a note, so a Mention resolves unless it's "missing". */
    const resolve: LinkResolver = (cid) => (cid === "missing" ? undefined : { noteId: `note-${cid}`, title: `Title ${cid}` });

    it("wraps a resolved Mention span in a reference link and reports the target via onLink", () => {
        const linked: string[] = [];
        const html = renderInlineText("see X here", [mark(4, 5, "Mention", "abc")], resolve, (id) => linked.push(id));
        expect(html).toBe('see <a class="reference-link" href="#root/note-abc">X</a> here');
        expect(linked).toEqual(["note-abc"]);
    });

    it("leaves a Mention as plain text when its target wasn't imported, recording no link", () => {
        const linked: string[] = [];
        const html = renderInlineText("see X here", [mark(4, 5, "Mention", "missing")], resolve, (id) => linked.push(id));
        expect(html).toBe("see X here");
        expect(linked).toEqual([]);
    });

    it("leaves a Mention plain when no resolver is supplied (parsing in isolation)", () => {
        expect(renderInlineText("see X", [mark(4, 5, "Mention", "abc")])).toBe("see X");
    });

    it("nests structural marks inside the mention anchor (anchor outermost)", () => {
        const html = renderInlineText("bold link", [mark(5, 9, "Mention", "abc"), mark(5, 9, "Bold")], resolve);
        expect(html).toBe('bold <a class="reference-link" href="#root/note-abc"><strong>link</strong></a>');
    });

    it("renders two mentions in one line, each its own reference link", () => {
        // Mirrors the "Page with block and inline reference links" page: two mentions over one paragraph.
        const linked: string[] = [];
        const html = renderInlineText("Inline link: 2  Untitled ", [mark(13, 14, "Mention", "two"), mark(16, 24, "Mention", "one")], resolve, (id) => linked.push(id));
        expect(html).toBe(
            'Inline link: <a class="reference-link" href="#root/note-two">2</a>  <a class="reference-link" href="#root/note-one">Untitled</a> '
        );
        expect(linked).toEqual(["note-two", "note-one"]);
    });
});

describe("renderCodeBlock", () => {
    it("wraps code in <pre><code> with the resolved language class", () => {
        // Anytype tags C-family code as PrismJS "clike"; Trilium has no such code, so it's aliased to C.
        expect(renderCodeBlock("int x;", "clike")).toBe('<pre><code class="language-text-x-csrc">int x;</code></pre>');
    });

    it("resolves a language code that matches a Trilium markdown name directly", () => {
        expect(renderCodeBlock("print(1)", "python")).toBe('<pre><code class="language-text-x-python">print(1)</code></pre>');
    });

    it("falls back to auto-detect for an unknown or missing language", () => {
        expect(renderCodeBlock("plain", "nonsense")).toBe('<pre><code class="language-text-x-trilium-auto">plain</code></pre>');
        expect(renderCodeBlock("plain", undefined)).toBe('<pre><code class="language-text-x-trilium-auto">plain</code></pre>');
    });

    it("escapes HTML and keeps quotes literal, preserving newlines and tabs", () => {
        expect(renderCodeBlock('a<b & c>\n\t"q"', "clike")).toBe('<pre><code class="language-text-x-csrc">a&lt;b &amp; c&gt;\n\t"q"</code></pre>');
    });
});

describe("renderLatexBlock", () => {
    it("renders a Mermaid block as a language-mermaid code block, escaping the diagram (the browser decodes it back)", () => {
        // Verbatim Mermaid from the "More formatting" page; `-->` must be HTML-escaped to stay valid markup.
        expect(renderLatexBlock("stateDiagram-v2\n    [*] --> Still\n", "Mermaid")).toBe(
            '<pre><code class="language-mermaid">stateDiagram-v2\n    [*] --&gt; Still\n</code></pre>'
        );
    });

    it("renders any non-Mermaid latex as CKEditor display math, keeping quotes literal", () => {
        expect(renderLatexBlock("E = mc^2", undefined)).toBe('<span class="math-tex">\\[ E = mc^2 \\]</span>');
        expect(renderLatexBlock("a < b & c", "Latex")).toBe('<span class="math-tex">\\[ a &lt; b &amp; c \\]</span>');
    });

    it("drops an empty latex block", () => {
        expect(renderLatexBlock("   ", "Mermaid")).toBe("");
        expect(renderLatexBlock("", undefined)).toBe("");
    });
});

describe("tables", () => {
    /** A table-cell text block, addressed by `${rowId}-${columnId}`. */
    const cell = (rowId: string, columnId: string, text: string): AnytypeBlock => ({ id: `${rowId}-${columnId}`, text: { text, marks: { marks: [] } }, childrenIds: [] });

    /**
     * Builds a page whose only content is a table: a `table` block with a `TableColumns` and a `TableRows`
     * layout, `columns` column ids, and `rows` of `[rowId, isHeader, cellTextByColumn]`. A column omitted
     * from a row's map models an empty (un-exported) cell.
     */
    function tableDoc(columns: string[], rows: [string, boolean, Record<string, string>][]): AnytypeSnapshot {
        const blocks: AnytypeBlock[] = [
            { id: "obj", childrenIds: ["tbl"] },
            { id: "tbl", table: {}, childrenIds: ["cols", "rows"] },
            { id: "cols", childrenIds: columns },
            ...columns.map((id): AnytypeBlock => ({ id, childrenIds: [] })),
            { id: "rows", childrenIds: rows.map(([rowId]) => rowId) }
        ];
        for (const [rowId, isHeader, cellsByColumn] of rows) {
            const cellIds = Object.keys(cellsByColumn).map((columnId) => `${rowId}-${columnId}`);
            blocks.push({ id: rowId, tableRow: { isHeader }, childrenIds: cellIds });
            for (const [columnId, text] of Object.entries(cellsByColumn)) {
                blocks.push(cell(rowId, columnId, text));
            }
        }
        return snapshot(blocks, { id: "obj", name: "Tables" });
    }

    it("renders a header row in <thead> (th scope=col) and body rows in <tbody> (td), in column order", () => {
        const doc = tableDoc(
            ["c1", "c2"],
            [
                ["r1", true, { c1: "A", c2: "B" }],
                ["r2", false, { c1: "1", c2: "2" }]
            ]
        );
        expect(parseObject(doc).content).toBe(
            '<figure class="table"><table>' +
                '<thead><tr><th scope="col">A</th><th scope="col">B</th></tr></thead>' +
                "<tbody><tr><td>1</td><td>2</td></tr></tbody>" +
                "</table></figure>"
        );
    });

    it("renders a header-less table as all <td> rows (matching the real export), applying inline marks in cells", () => {
        const doc = tableDoc(["c1", "c2", "c3"], [["r1", false, { c1: "A", c2: "B", c3: "C" }]]);
        const result = parseObject(doc);
        expect(result.content).toBe('<figure class="table"><table><tbody><tr><td>A</td><td>B</td><td>C</td></tr></tbody></table></figure>');
    });

    it("fills an omitted (empty) cell with a blank td, keeping the grid aligned to the columns", () => {
        // r1 carries no cell for c2 — a row drops its empty cells, so column order must backfill it.
        const doc = tableDoc(["c1", "c2"], [["r1", false, { c1: "only" }]]);
        expect(parseObject(doc).content).toBe('<figure class="table"><table><tbody><tr><td>only</td><td></td></tr></tbody></table></figure>');
    });

    it("renderTable returns empty for a table with no columns or no rows", () => {
        const byId = new Map<string, AnytypeBlock>([
            ["tbl", { id: "tbl", table: {}, childrenIds: ["cols", "rows"] }],
            ["cols", { id: "cols", childrenIds: [] }],
            ["rows", { id: "rows", childrenIds: [] }]
        ]);
        expect(renderTable(byId.get("tbl") ?? { id: "x" }, byId)).toBe("");
    });

    it("skips a row whose block is missing from the export", () => {
        // The rows layout references "r-missing", for which no block exists — that row is dropped.
        const byId = new Map<string, AnytypeBlock>([
            ["tbl", { id: "tbl", table: {}, childrenIds: ["cols", "rows"] }],
            ["cols", { id: "cols", childrenIds: ["c1"] }],
            ["c1", { id: "c1", childrenIds: [] }],
            ["rows", { id: "rows", childrenIds: ["r-missing"] }]
        ]);
        expect(renderTable(byId.get("tbl") ?? { id: "x" }, byId)).toBe('<figure class="table"><table></table></figure>');
    });
});
