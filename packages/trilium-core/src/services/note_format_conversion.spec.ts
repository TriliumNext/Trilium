import {
    collectBlocks, compareBlockIds, HIGHLIGHT_STYLE, sliceToBlockReference, trimIndentation
} from "@triliumnext/commons";
import { parse as parseHtml } from "node-html-parser";
import { describe, expect, it, vi } from "vitest";

import { getContext } from "./context.js";
import { getLog } from "./log.js";
import { convertNoteByConversionId, convertNoteContent, convertNoteFormat } from "./note_format_conversion.js";
import noteService from "./notes.js";

describe("note format conversion", () => {
    it("converts an HTML text note to a Markdown code note", () => {
        const { content, type, mime } = convertNoteContent(
            "html",
            "<h1>Title</h1><p>Some <strong>bold</strong> text.</p><ul><li>one</li><li>two</li></ul>",
            "My note"
        );

        expect(type).toBe("code");
        expect(mime).toBe("text/x-markdown");
        expect(content).toBe(trimIndentation`\
            # Title

            Some **bold** text.

            *   one
            *   two`);
    });

    it("converts a Markdown code note to an HTML text note", () => {
        const { content, type, mime } = convertNoteContent(
            "markdown",
            trimIndentation`\
                # Title

                Some **bold** text.`,
            "My note"
        );

        expect(type).toBe("text");
        expect(mime).toBe("text/html");
        // Trilium reserves H1 for the note title, so top-level Markdown headings render as <h2>.
        expect(content).toContain("<h2>Title</h2>");
        expect(content).toContain("<strong>bold</strong>");
    });

    it("preserves structure across an HTML -> Markdown -> HTML round-trip", () => {
        const original = "<h2>Heading</h2><p>Paragraph with a <a href=\"https://example.com\">link</a>.</p>";

        const { content: markdown } = convertNoteContent("html", original, "title");
        const { content: html } = convertNoteContent("markdown", markdown, "title");

        expect(html).toContain("<h2>Heading</h2>");
        expect(html).toContain("<a href=\"https://example.com\">link</a>");
    });

    it("preserves a highlight across a Markdown -> HTML -> Markdown round-trip", () => {
        const original = "Some ==highlighted== text.";

        const { content: html } = convertNoteContent("markdown", original, "title");
        expect(html).toContain(`<span style="${HIGHLIGHT_STYLE}">highlighted</span>`);

        expect(convertNoteContent("html", html, "title").content).toBe(original);
    });

    it("preserves a default-yellow highlight applied in the editor across an HTML -> Markdown -> HTML round-trip", () => {
        const original = `<p>Some <span style="${HIGHLIGHT_STYLE}">highlighted</span> text.</p>`;

        const { content: markdown } = convertNoteContent("html", original, "title");
        expect(markdown).toBe("Some ==highlighted== text.");

        expect(convertNoteContent("markdown", markdown, "title").content).toBe(original);
    });

    it("preserves a non-default colour exactly, rather than repainting it the highlight yellow", () => {
        // `==…==` carries no colour, so these keep their own markup in the Markdown form.
        for (const original of [
            '<p>Some <span style="background-color:rgb(0, 255, 0);">green</span> text.</p>',
            '<p>Some <span style="color:#ff0000;">red</span> text.</p>',
            '<p>Some <span style="color:#ffffff;background-color:#000000;">inverted</span> text.</p>'
        ]) {
            const { content: markdown } = convertNoteContent("html", original, "title");
            expect(convertNoteContent("markdown", markdown, "title").content).toBe(original);
        }
    });
});

describe("block ids across a conversion", () => {
    /** A text note with a block id on every kind of block, as the text editor saves it. */
    const FIXTURE = [
        `<h2 data-trilium-block-id="h1">Intro</h2>`,
        `<p data-trilium-block-id="p1">First paragraph with <a id="bm"></a>a bookmark.</p>`,
        `<p data-trilium-block-id="empty">&nbsp;</p>`,
        `<ul><li><p data-trilium-block-id="par">parent</p><ul><li>child one</li>`
            + `<li><p data-trilium-block-id="ch2">child two</p></li></ul></li></ul>`,
        `<ol><li>one</li><li><p data-trilium-block-id="i2">two</p></li>`
            + `<li><p data-trilium-block-id="i3">three</p></li></ol>`,
        `<pre><code class="language-application-javascript-env-frontend" `
            + `data-trilium-block-id="code1">if (a &lt; b &amp;&amp; c) {\n    go();\n}</code></pre>`,
        `<figure class="table" data-trilium-block-id="tab1"><table><thead><tr><th>A</th><th>B</th>`
            + `</tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table></figure>`,
        `<figure class="table" data-trilium-block-id="raw1"><table><tbody><tr><td>no</td>`
            + `<td>header</td></tr></tbody></table></figure>`,
        `<figure class="table" data-trilium-block-id="raw2"><table><thead><tr><th>Code</th></tr>`
            + `</thead><tbody><tr><td><pre><code class="language-text-plain">x</code></pre></td></tr>`
            + `</tbody></table></figure>`,
        `<blockquote data-trilium-block-id="q1"><p>quoted one</p>`
            + `<p data-trilium-block-id="q2">quoted two</p></blockquote>`,
        `<aside class="admonition note" data-trilium-block-id="adm1">`
            + `<p data-trilium-block-id="admp">Body</p></aside>`,
        `<hr data-trilium-block-id="hr1">`,
        `<p data-trilium-block-id="math"><span class="math-tex">\\[x^2\\]</span></p>`,
        `<ul class="todo-list"><li><label class="todo-list__label `
            + `todo-list__label_without-description"><input type="checkbox" disabled="disabled">`
            + `</label><p data-trilium-block-id="todo">task</p></li></ul>`,
        `<details class="trilium-collapsible" data-trilium-block-id="det">`
            + `<summary data-trilium-block-id="sum">More</summary>`
            + `<p data-trilium-block-id="inner">Inside</p></details>`,
        `<div class="trilium-tabs" data-trilium-block-id="tabs"><section class="trilium-tab" `
            + `data-trilium-block-id="tab"><p class="trilium-tab-title">One</p>`
            + `<div class="trilium-tab-panel"><p data-trilium-block-id="intab">In tab</p></div>`
            + `</section></div>`,
        `<aside data-position="wrap-right" style="--tn-background:#555555;background-color:#555555;" `
            + `data-trilium-block-id="aside"><p data-trilium-block-id="inaside">Beside</p></aside>`,
        `<div class="trilium-multicolumn-layout"><div class="trilium-multicolumn-column">`
            + `<p data-trilium-block-id="col1">Left</p></div><div class="trilium-multicolumn-column">`
            + `<p>Right</p></div></div>`,
        `<p data-trilium-block-id="img"><img src="api/images/abc123/x.png"></p>`,
        `<figure class="include-note" data-note-id="target1" data-block="h1" `
            + `data-box-size="full" data-trilium-block-id="embed"></figure>`,
        `<pre><code class="language-text-plain" data-trilium-block-id="emptycode"></code></pre>`,
        `<figure class="table" data-trilium-block-id="onecell"><table><tbody><tr><td>single</td>`
            + `</tr></tbody></table></figure>`,
        `<p data-trilium-block-id="last">Last paragraph.</p>`
    ].join("");

    const parse = (html: string) => parseHtml(html, { blockTextElements: {} });

    it("keeps every id on the same block from text to Markdown and back, but two shapes", () => {
        const toMarkdown = convertNoteContent("html", FIXTURE, "Title");
        expect({ lost: toMarkdown.lostBlockIds, moved: toMarkdown.movedBlockIds })
            .toEqual({ lost: [ "emptycode", "onecell" ], moved: [] });

        const back = convertNoteContent("markdown", toMarkdown.content, "Title");
        expect({ lost: back.lostBlockIds, moved: back.movedBlockIds }).toEqual({ lost: [], moved: [] });
        const report = compareBlockIds(collectBlocks(parse(FIXTURE)), collectBlocks(parse(back.content)));
        expect(report).toEqual({ lostBlockIds: [ "emptycode", "onecell" ], movedBlockIds: [] });

        // A second export of the result is the first one.
        expect(convertNoteContent("html", back.content, "Title").content).toBe(toMarkdown.content);
    });

    it("slices the same blocks for a range before and after the conversion", () => {
        const back = convertNoteContent("markdown",
            convertNoteContent("html", FIXTURE, "Title").content, "Title").content;
        const ranges = [
            "h1:p1", "empty", "par", "ch2", "i2:i3", "code1:tab1", "raw1:raw2", "q1", "q2", "adm1",
            "admp", "hr1:math", "todo", "det", "sum", "inner", "tabs", "tab", "intab", "aside",
            "inaside", "col1", "img:embed", "last"
        ];
        for (const range of ranges) {
            const before = parse(FIXTURE);
            const after = parse(back);
            expect(sliceToBlockReference(before, range), range).toBe(true);
            expect(sliceToBlockReference(after, range), range).toBe(true);
            const keys = (root: ReturnType<typeof parse>) =>
                collectBlocks(root).map(({ key }) => [ key.kind, key.ancestry, key.text ]);
            expect(keys(after), range).toEqual(keys(before));
        }
    });

    it("writes Wikilinks as links into the tree, with their query", () => {
        const { content } = convertNoteContent("markdown", "[[abc123?block=x1:y2]] and [[def456]]", "T");
        expect(content).toContain(`href="#root/abc123?block=x1:y2"`);
        expect(content).toContain(`href="#root/def456"`);
    });

    it("demotes an H1 equal to the title that has an id, and writes it back with the id", () => {
        const { content } = convertNoteContent("markdown",
            `# Title <a data-trilium-block-id="t"></a>\n\nText`, "Title");
        expect(content).toBe(`<h2 data-trilium-block-id="t">Title</h2><p>Text</p>`);
    });
});

describe("note format conversion (real DB)", () => {
    let counter = 0;

    function createTextNote() {
        counter++;
        return getContext().init(() =>
            noteService.createNewNote({
                parentNoteId: "root",
                title: `convert-spec-${counter}`,
                content: "<h2>Heading</h2><p>Some <strong>bold</strong> text.</p>",
                type: "text"
            }).note
        );
    }

    it("flips a text note to Markdown, saves a named revision, and converts back", () => {
        const note = createTextNote();
        const revisionsBefore = note.getRevisions().length;

        getContext().init(() => convertNoteFormat(note));

        expect(note.type).toBe("code");
        expect(note.mime).toBe("text/x-markdown");
        expect(note.getContent()).toContain("## Heading");

        const revisions = note.getRevisions();
        expect(revisions.length).toBe(revisionsBefore + 1);
        const toMarkdownRevision = revisions.at(-1);
        expect(toMarkdownRevision?.source).toBe("manual");
        expect(toMarkdownRevision?.type).toBe("text"); // captured the pre-conversion state
        const markdownDescription = toMarkdownRevision?.description;

        // Convert back to a text note.
        getContext().init(() => convertNoteFormat(note));

        expect(note.type).toBe("text");
        expect(note.mime).toBe("text/html");
        expect(note.getContent()).toContain("<h2>Heading</h2>");

        // The two directions save distinctly-named revisions.
        const textDescription = note.getRevisions().at(-1)?.description;
        expect(markdownDescription).toBeTruthy();
        expect(textDescription).toBeTruthy();
        expect(textDescription).not.toBe(markdownDescription);
    });

    it("logs the block references that a bulk conversion loses", () => {
        const note = getContext().init(() => noteService.createNewNote({
            parentNoteId: "root", title: "convert-spec-lost", type: "text",
            content: `<p data-trilium-block-id="kept">Kept</p>`
                + `<pre><code class="language-text-plain" data-trilium-block-id="lost"></code></pre>`
        }).note);
        const info = vi.spyOn(getLog(), "info");

        expect(getContext().init(() => convertNoteByConversionId(note, "htmlToMarkdown")))
            .toBe(true);
        expect(info).toHaveBeenCalledWith(
            `Converting note '${note.noteId}' lost 1 and moved 0 block references.`);
        info.mockRestore();
    });

    it("rejects a note of another type, unavailable content and binary content", () => {
        const codeNote = getContext().init(() => noteService.createNewNote({
            parentNoteId: "root", title: "convert-spec-code", content: "x", type: "code", mime: "application/javascript"
        }).note);
        expect(() => convertNoteFormat(codeNote)).toThrow("cannot be converted");

        const unavailable = createTextNote();
        vi.spyOn(unavailable, "isContentAvailable").mockReturnValue(false);
        expect(() => convertNoteFormat(unavailable)).toThrow("not available");
        expect(convertNoteByConversionId(unavailable, "htmlToMarkdown")).toBe(false);

        const binary = createTextNote();
        vi.spyOn(binary, "getContent").mockReturnValue(new Uint8Array([ 1, 2 ]));
        expect(() => convertNoteFormat(binary)).toThrow("textual content");
        expect(binary.type).toBe("text");
    });
});
