import { trimIndentation } from "@triliumnext/commons";
import { describe, expect,it } from "vitest";

import markdownExportService from "./markdown.js";

describe("Markdown export", () => {

    it("exports correct language tag for known languages", () => {
        const conversionTable = {
            "language-text-x-nginx-conf": "nginx",
            "language-text-x-diff": "diff",
            "language-application-javascript-env-frontend": "javascript",
            "language-application-javascript-env-backend": "javascript",
            "language-text-x-asm-mips": "mips",
            "language-text-jsx": "jsx",
            "language-text-html": "html"
        };

        for (const [ input, output ] of Object.entries(conversionTable)) {
            const html = trimIndentation`\
                <p>A diff:</p>
                <pre><code class="${input}">Hello
                -world
                +worldy
                </code></pre>`;
            const expected = trimIndentation`\
                A diff:

                \`\`\`${output}
                Hello
                -world
                +worldy

                \`\`\``;

            expect(markdownExportService.toMarkdown(html)).toBe(expected);
        }
    });

    it("removes auto tag for code blocks", () => {
        const html = trimIndentation`\
            <pre><code class="language-text-x-trilium-auto">Hello
            -world
            +worldy
            </code></pre>`;
        const expected = trimIndentation`\
            \`\`\`
            Hello
            -world
            +worldy

            \`\`\``;

        expect(markdownExportService.toMarkdown(html)).toBe(expected);
    });

    it("supports code block with no language tag", () => {
        const html = trimIndentation`\
            <pre><code>Hello</code></pre>`;
        const expected = trimIndentation`\
            \`\`\`
            Hello
            \`\`\``;

        expect(markdownExportService.toMarkdown(html)).toBe(expected);
    });

    it("exports link previews as raw HTML with a fallback anchor", () => {
        // Block card/embed: kept as a section (the importer + editor upcast round-trip it), with a
        // fallback link inside so external Markdown renderers show something instead of nothing.
        expect(markdownExportService.toMarkdown(
            '<p>before</p>' +
            '<section class="link-embed" data-url="https://e.com/" data-embed-type="opengraph" data-title="Example"></section>' +
            '<p>after</p>'
        )).toBe(
            'before\n\n' +
            '<section class="link-embed" data-url="https://e.com/" data-embed-type="opengraph" data-title="Example"><a href="https://e.com/">Example</a></section>' +
            '\n\nafter'
        );

        // Video embeds share the same element; without a title the URL doubles as the link text.
        expect(markdownExportService.toMarkdown(
            '<section class="link-embed" data-url="https://www.youtube.com/watch?v=abc" data-embed-type="youtube"></section>'
        )).toBe(
            '<section class="link-embed" data-url="https://www.youtube.com/watch?v=abc" data-embed-type="youtube">' +
            '<a href="https://www.youtube.com/watch?v=abc">https://www.youtube.com/watch?v=abc</a></section>'
        );

        // Inline mention: stays inline within the sentence.
        expect(markdownExportService.toMarkdown(
            '<p>See <span class="link-mention" data-url="https://e.com/" data-title="Example"></span> for details.</p>'
        )).toBe(
            'See <span class="link-mention" data-url="https://e.com/" data-title="Example"><a href="https://e.com/">Example</a></span> for details.'
        );
    });

    it("replaces an existing link preview fallback anchor instead of accumulating it", () => {
        // Content imported from Markdown (and never re-saved by the editor) already carries the
        // fallback anchor, so the element is non-blank and goes through the rule instead of
        // blankReplacement. The anchor is regenerated from the (possibly edited) data attributes.
        const exported = markdownExportService.toMarkdown(
            '<section class="link-embed" data-url="https://e.com/" data-embed-type="opengraph" data-title="New title">' +
            '<a href="https://e.com/">Stale title</a></section>'
        );

        expect(exported).toBe(
            '<section class="link-embed" data-url="https://e.com/" data-embed-type="opengraph" data-title="New title">' +
            '<a href="https://e.com/">New title</a></section>'
        );
    });

    it("escapes HTML in link preview fallback anchors", () => {
        const exported = markdownExportService.toMarkdown(
            '<section class="link-embed" data-url="https://e.com/?a=1&amp;b=2" data-embed-type="opengraph" data-title="A &amp; B &lt;x&gt;"></section>'
        );

        // The fallback anchor is generated from the data attributes, so its href and title must be
        // HTML-escaped or a title like `A & B <x>` would break the exported markup. This escaping is
        // done deterministically with escape-html, so it holds under both test environments.
        expect(exported).toContain('<a href="https://e.com/?a=1&amp;b=2">A &amp; B &lt;x&gt;</a>');

        // The section wrapper and its data attributes survive so the preview re-imports losslessly.
        // The escaping of `<`/`>` inside data-title is left to turndown's serializer, which differs by
        // environment (server/node uses domino and escapes them; standalone/happy-dom uses the browser
        // serializer and leaves them raw). It is not asserted because both forms decode to the same value.
        expect(exported).toContain('<section class="link-embed" data-url="https://e.com/?a=1&amp;b=2" data-embed-type="opengraph"');
    });

    it("renders a hostile-scheme link preview URL inert in the fallback anchor", () => {
        // `data-url` reaches export unsanitized (the sanitizers pass `data-*` through untouched), so a
        // stored `javascript:` scheme must not become a live anchor in the exported Markdown.
        // `safeLinkPreviewHref` maps it to `about:blank`; the escaping asserted in the test above still
        // guards a valid http(s) URL that happens to contain a quote.
        const exported = markdownExportService.toMarkdown(
            '<section class="link-embed" data-url="javascript:alert(1)" data-embed-type="opengraph" data-title="Evil"></section>'
        );

        // The live fallback href is neutralised. The original scheme survives only in the inert
        // `data-url` attribute (which round-trips losslessly on reimport), never as a linkable href.
        expect(exported).toContain('<a href="about:blank">Evil</a>');
        expect(exported).not.toContain('href="javascript:');
    });

    it("exports strikethrough text correctly", () => {
        const html = "<s>hello</s>Hello <s>world</s>";
        const expected = "~~hello~~Hello ~~world~~";
        expect(markdownExportService.toMarkdown(html)).toBe(expected);
    });

    it("exports headings properly", () => {
        const html = trimIndentation`\
            <h1>Heading 1</h1>
            <h2>Heading 2</h2>
            <h3>Heading 3</h3>
            <h4>Heading 4</h4>
            <h5>Heading 5</h5>
            <h6>Heading 6</h6>
        `;
        const expected = trimIndentation`\
            # Heading 1

            ## Heading 2

            ### Heading 3

            #### Heading 4

            ##### Heading 5

            ###### Heading 6`;
        expect(markdownExportService.toMarkdown(html)).toBe(expected);
    });

    it("rewrites image URL with spaces", () => {
        const html = `<img src="Hello world  .png"/>`;
        const expected = `![](Hello%20world%20%20.png)`;
        expect(markdownExportService.toMarkdown(html)).toBe(expected);
    });

    it("supports keyboard shortcuts", () => {
        const html = "<kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>Delete</kbd>";
        expect(markdownExportService.toMarkdown(html)).toBe(html);
    });

    it("exports admonitions properly", () => {
        const html = trimIndentation`\
            <p>
                Before
            </p>
            <aside class="admonition note">
                <p>
                    This is a note.
                </p>
            </aside>
            <aside class="admonition tip">
                <p>
                    This is a tip.
                </p>
            </aside>
            <aside class="admonition important">
                <p>
                    This is a very important information.
                </p>
                <figure class="table">
                    <table>
                        <tbody>
                            <tr>
                                <td>
                                    1
                                </td>
                                <td>
                                    2
                                </td>
                            </tr>
                            <tr>
                                <td>
                                    3
                                </td>
                                <td>
                                    4
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </figure>
            </aside>
            <aside class="admonition caution">
                <p>
                    This is a caution.
                </p>
            </aside>
            <aside class="admonition warning">
                <h2>
                    Title goes here
                </h2>
                <p>
                    This is a warning.
                </p>
            </aside>
            <p>
                After
            </p>
        `;

        const space = " ";  // editor config trimming space.
        const expected = trimIndentation`\
            Before

            > [!NOTE]
            > This is a note.

            > [!TIP]
            > This is a tip.

            > [!IMPORTANT]
            > This is a very important information.
            >${space}
            > <table>
            >     <tbody>
            >         <tr>
            >             <td>1</td>
            >             <td>2</td>
            >         </tr>
            >         <tr>
            >             <td>3</td>
            >             <td>4</td>
            >         </tr>
            >     </tbody>
            > </table>

            > [!CAUTION]
            > This is a caution.

            > [!WARNING]
            > ## Title goes here
            >${space}
            > This is a warning.

            After`;
        expect(markdownExportService.toMarkdown(html)).toBe(expected);
    });

    it("exports code in tables properly", () => {
        const html = trimIndentation`\
        <table>
            <tr>
                <td>
                    Row 1
                </td>
                <td>
                    <p>Allows displaying the value of one or more attributes in the calendar
                        like this:&nbsp;</p>
                    <p>
                        <img src="13_Calendar View_image.png" alt="">
                    </p>

                    <pre><code class="language-text-x-trilium-auto">#weight="70"
                    #Mood="Good"
                    #calendar:displayedAttributes="weight,Mood"</code></pre>
                    <p>It can also be used with relations, case in which it will display the
                        title of the target note:</p><pre><code class="language-text-x-trilium-auto">~assignee=@My assignee
                    #calendar:displayedAttributes="assignee"</code></pre>
                </td>
            </tr>
        </table>
        `;

        // Structural tags are indented for readability; cell contents (including the
        // <pre> code with its own newlines and indentation) are emitted verbatim.
        const expected = `<table>
    <tbody>
        <tr>
            <td>Row 1</td>
            <td><p>Allows displaying the value of one or more attributes in the calendar like this:&nbsp;</p><p><img src="13_Calendar View_image.png" alt=""></p><pre><code class="language-text-x-trilium-auto">#weight="70"
            #Mood="Good"
            #calendar:displayedAttributes="weight,Mood"</code></pre><p>It can also be used with relations, case in which it will display the title of the target note:</p><pre><code class="language-text-x-trilium-auto">~assignee=@My assignee
            #calendar:displayedAttributes="assignee"</code></pre></td>
        </tr>
    </tbody>
</table>`;
        expect(markdownExportService.toMarkdown(html)).toBe(expected);
    });

    it("converts &nbsp; to character", () => {
        const html = /*html*/`<p>Hello&nbsp;world.</p>`;
        const expected = `Hello\u00a0world.`;
        expect(markdownExportService.toMarkdown(html)).toBe(expected);
    });

    it("preserves non-breaking space character", () => {
        const html = /*html*/`<p>Hello\u00adworld.</p>`;
        const expected = `Hello\u00adworld.`;
        expect(markdownExportService.toMarkdown(html)).toBe(expected);
    });

    it("exports normal links verbatim", () => {
        const html = /*html*/`<p><a href="https://www.google.com">Google</a></p>`;
        const expected = `[Google](https://www.google.com)`;
        expect(markdownExportService.toMarkdown(html)).toBe(expected);
    });

    it("exports reference links verbatim", () => {
        const html = /*html*/`<p><a class="reference-link" href="../../Canvas.html">Canvas</a></p>`;
        const expected = `<a class="reference-link" href="../../Canvas.html">Canvas</a>`;
        expect(markdownExportService.toMarkdown(html)).toBe(expected);
    });

    it("converts image if it has no custom properties", () => {
        const html = /*html*/`<p><img src="Include Note_image.png"></p>`;
        const expected = `![](Include%20Note_image.png)`;
        expect(markdownExportService.toMarkdown(html)).toBe(expected);
    });

    it("preserves image verbatim if it has a width or height attribute", () => {
        const scenarios = [
            /*html*/`<img src="Include Note_image.png" width="16" height="16">`,
            /*html*/`<img src="Include Note_image.png" width="16">`,
            /*html*/`<img src="Include Note_image.png" height="16">`,
            /*html*/`<img class="image_resized" style="aspect-ratio:853/315;width:50%;" src="6_File_image.png" width="853" height="315">`
        ];
        for (const expected of scenarios) {
            const html = /*html*/`<p>${expected}</p>`;
            expect(markdownExportService.toMarkdown(html)).toBe(expected);
        }
    });

    it("preserves figures", () => {
        const html = /*html*/trimIndentation`\
              <figure class="image" style="width:53.44%;">
                <img style="aspect-ratio:991/403;" src="Jump to Note_image.png" width="991"
                height="403">
              </figure>
        `;
        const expected = `<figure class="image" style="width:53.44%;"><img style="aspect-ratio:991/403;" src="Jump to Note_image.png" width="991" height="403"></figure>`;
        expect(markdownExportService.toMarkdown(html)).toBe(expected);
    });

    it("preserves collapsible details blocks as pretty-printed raw HTML, dropping the trilium-collapsible class", () => {
        const html = /*html*/`<details class="trilium-collapsible"><summary>Click to expand</summary><p>Body content</p></details>`;
        // Kept as raw HTML (Markdown has no disclosure syntax) but pretty-printed one
        // child per line, mirroring how raw-HTML tables are serialized. The Trilium-only
        // styling hook is stripped; it still round-trips through the markdown importer.
        const expected = trimIndentation`\
            <details>
                <summary>Click to expand</summary>
                <p>Body content</p>
            </details>`;
        expect(markdownExportService.toMarkdown(html)).toBe(expected);
    });

    it("keeps user-added classes on a details block while dropping trilium-collapsible", () => {
        const html = /*html*/`<details class="custom trilium-collapsible"><summary>S</summary><p>B</p></details>`;
        const expected = trimIndentation`\
            <details class="custom">
                <summary>S</summary>
                <p>B</p>
            </details>`;
        expect(markdownExportService.toMarkdown(html)).toBe(expected);
    });

    it("keeps a text-only details block verbatim so its content is not dropped", () => {
        const html = /*html*/`<details>Just some text</details>`;
        expect(markdownExportService.toMarkdown(html)).toBe(html);
    });

    it("indents nested lists inside a details block", () => {
        const html = /*html*/`<details><summary>Sum</summary><ol><li><span>First</span></li><li><span>Second</span><ul><li><span>Nested</span></li></ul></li></ol></details>`;
        const expected = trimIndentation`\
            <details>
                <summary>Sum</summary>
                <ol>
                    <li>
                        <span>First</span>
                    </li>
                    <li>
                        <span>Second</span>
                        <ul>
                            <li>
                                <span>Nested</span>
                            </li>
                        </ul>
                    </li>
                </ol>
            </details>`;
        expect(markdownExportService.toMarkdown(html)).toBe(expected);
    });

    it("converts inline math expressions into proper Markdown syntax", () => {
        const html = /*html*/String.raw`<span class="math-tex">\(H(X, Y) = \sum_{i=1}^{M} \sum_{j=1}^{L} p(x_i, y_j) \log_2 \frac{1}{p(x_i, y_j)} = - \sum_{i=1}^{M} \sum_{j=1}^{L} p(x_i, y_j) \log_2 p(x_i, y_j) \frac{\text{bits}}{\text{symbol}}\)</span></span>`;
        const expected = String.raw`$H(X, Y) = \sum_{i=1}^{M} \sum_{j=1}^{L} p(x_i, y_j) \log_2 \frac{1}{p(x_i, y_j)} = - \sum_{i=1}^{M} \sum_{j=1}^{L} p(x_i, y_j) \log_2 p(x_i, y_j) \frac{\text{bits}}{\text{symbol}}$`;
        expect(markdownExportService.toMarkdown(html)).toBe(expected);
    });

    it("converts display math expressions into proper Markdown syntax", () => {
        const html = /*html*/String.raw`<span class="math-tex">\[H(X, Y) = \sum_{i=1}^{M} \sum_{j=1}^{L} p(x_i, y_j) \log_2 \frac{1}{p(x_i, y_j)} = - \sum_{i=1}^{M} \sum_{j=1}^{L} p(x_i, y_j) \log_2 p(x_i, y_j) \frac{\text{bits}}{\text{symbol}}\]</span></span>`;
        const expected = String.raw`$$H(X, Y) = \sum_{i=1}^{M} \sum_{j=1}^{L} p(x_i, y_j) \log_2 \frac{1}{p(x_i, y_j)} = - \sum_{i=1}^{M} \sum_{j=1}^{L} p(x_i, y_j) \log_2 p(x_i, y_j) \frac{\text{bits}}{\text{symbol}}$$`;
        expect(markdownExportService.toMarkdown(html)).toBe(expected);
    });

    it("does not generate additional spacing when exporting lists with paragraph", () => {
        const html = trimIndentation`\
            <ul>
                <li><a href="https://github.com/JYC333">@JYC333</a> made their first contribution
                            in <a href="https://github.com/TriliumNext/Trilium/pull/294">#294</a>

                </li>
                <li>
                <p><a href="https://github.com/TriliumNext/Trilium/issues/375">Note Tooltip isn't removed when clicking on internal trilium link in read-only mode</a>

                </p>
                </li>
                <li>
                <p><a href="https://github.com/TriliumNext/Trilium/issues/384">Calendar dropdown won't close if click/right-click other button that open notes from launcher bar</a>

                </p>
                </li>
            </ul>
        `;
        const expected = trimIndentation`\
            *   [@JYC333](https://github.com/JYC333) made their first contribution in [#294](https://github.com/TriliumNext/Trilium/pull/294)
            *   [Note Tooltip isn't removed when clicking on internal trilium link in read-only mode](https://github.com/TriliumNext/Trilium/issues/375)
            *   [Calendar dropdown won't close if click/right-click other button that open notes from launcher bar](https://github.com/TriliumNext/Trilium/issues/384)`;
        expect(markdownExportService.toMarkdown(html)).toBe(expected);
    });

    it("preserves include note", () => {
        const html = /*html*/`<section class="include-note" data-note-id="i4A5g9iOg9I0" data-box-size="full"> </section>`;
        const expected = /*markdown*/`<section class="include-note" data-note-id="i4A5g9iOg9I0" data-box-size="full">&nbsp;</section>`;
        expect(markdownExportService.toMarkdown(html)).toBe(expected);
    });

    it("exports todo lists properly", () => {
        const html = trimIndentation/*html*/`\
            <ul class="todo-list">
                <li>
                    <label class="todo-list__label">
                        <input type="checkbox" checked="checked" disabled="disabled"><span class="todo-list__label__description">Hello</span>
                    </label>
                </li>
                <li>
                    <label class="todo-list__label">
                        <input type="checkbox" disabled="disabled"><span class="todo-list__label__description">World</span>
                    </label>
                </li>
            </ul>
        `;
        const expected = trimIndentation`\
            - [x] Hello
            - [ ] World`;
        expect(markdownExportService.toMarkdown(html)).toBe(expected);
    });

    it("exports todo list multistate markers from data-trilium-task-state", () => {
        const html = trimIndentation/*html*/`\
            <ul class="todo-list">
                <li data-trilium-task-state="doing">
                    <label class="todo-list__label">
                        <input type="checkbox" disabled="disabled"><span class="todo-list__label__description">Doing</span>
                    </label>
                </li>
                <li data-trilium-task-state="done">
                    <label class="todo-list__label">
                        <input type="checkbox" checked="checked" disabled="disabled"><span class="todo-list__label__description">Done</span>
                    </label>
                </li>
                <li data-trilium-task-state="cancelled">
                    <label class="todo-list__label">
                        <input type="checkbox" disabled="disabled"><span class="todo-list__label__description">Cancelled</span>
                    </label>
                </li>
                <li data-trilium-task-state="maybe">
                    <label class="todo-list__label">
                        <input type="checkbox" disabled="disabled"><span class="todo-list__label__description">Maybe</span>
                    </label>
                </li>
            </ul>
        `;
        const expected = trimIndentation`\
            - [/] Doing
            - [x] Done
            - [-] Cancelled
            - [?] Maybe`;
        expect(markdownExportService.toMarkdown(html)).toBe(expected);
    });

    // A table with no heading row can't be expressed as a GFM table without
    // inventing a phantom empty header (which would reimport as a blank row), so
    // it is kept as raw HTML to round-trip faithfully.
    it("keeps a table with no heading row as HTML", () => {
        const html = trimIndentation/*html*/`\
            <figure class="table">
                <table>
                    <tbody>
                        <tr>
                            <td>
                                Hi
                            </td>
                            <td>
                                there
                            </td>
                        </tr>
                        <tr>
                            <td>
                                Hi
                            </td>
                            <td>
                                there
                            </td>
                        </tr>
                    </tbody>
                </table>
            </figure>
        `;
        const expected = `<table>
    <tbody>
        <tr>
            <td>Hi</td>
            <td>there</td>
        </tr>
        <tr>
            <td>Hi</td>
            <td>there</td>
        </tr>
    </tbody>
</table>`;
        expect(markdownExportService.toMarkdown(html)).toBe(expected);
    });

    // Admonitions are block content, and GFM table cells can only hold inline
    // content. Flattening the admonition into a cell produces unrenderable
    // `> [!NOTE]<br>...` noise, so a table containing one is kept as raw HTML to
    // degrade gracefully and round-trip faithfully.
    it("keeps a table containing an admonition as HTML", () => {
        const html = trimIndentation/*html*/`\
            <figure class="table">
                <table>
                    <thead>
                        <tr>
                            <th>Hello</th>
                            <th>world</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td>This is a table</td>
                            <td></td>
                        </tr>
                        <tr>
                            <td><aside class="admonition note"><p>With an admonition inside it</p></aside></td>
                            <td></td>
                        </tr>
                    </tbody>
                </table>
            </figure>
        `;
        const expected = `<table>
    <thead>
        <tr>
            <th>Hello</th>
            <th>world</th>
        </tr>
    </thead>
    <tbody>
        <tr>
            <td>This is a table</td>
            <td></td>
        </tr>
        <tr>
            <td><aside class="admonition note"><p>With an admonition inside it</p></aside></td>
            <td></td>
        </tr>
    </tbody>
</table>`;
        expect(markdownExportService.toMarkdown(html)).toBe(expected);
    });

    it("preserves superscript and subscript", () => {
        const html = /*html*/`<p>Hello <sup><strong>superscript</strong></sup> <sub><strong>subscript</strong></sub></p>`;
        const expected = `Hello <sup><strong>superscript</strong></sup> <sub><strong>subscript</strong></sub>`;
        expect(markdownExportService.toMarkdown(html)).toBe(expected);
    });

    it("maintains escaped HTML tags", () => {
        const html = /*html*/`<p>&lt;div&gt;Hello World&lt;/div&gt;</p>`;
        const expected = `\\<div\\>Hello World\\</div\\>`;
        expect(markdownExportService.toMarkdown(html)).toBe(expected);
    });

    it("escapes HTML tags inside list", () => {
        const html = trimIndentation/*html*/`\
            <ul>
                <li data-list-item-id="e07fda078f7dd7103a3b9017f49eb1589">
                    &lt;note&gt; is note.
                </li>
            </ul>
        `;
        const expected = trimIndentation`\
            *   \\<note\\> is note.`;
        expect(markdownExportService.toMarkdown(html)).toBe(expected);
    });

    it("drops data-trilium-collapsed but keeps the collapsed item's children as bullets", () => {
        // Collapsing is editor-only UI state (the nested items live in the content, hidden via
        // CSS), and Markdown has no syntax for it — so the attribute is dropped on export while
        // the nested structure still round-trips as ordinary bullets.
        const html = trimIndentation/*html*/`\
            <ul>
                <li data-trilium-collapsed="true">
                    Parent
                    <ul>
                        <li>
                            Child
                        </li>
                    </ul>
                </li>
                <li>
                    Sibling
                </li>
            </ul>
        `;
        const expected = trimIndentation`\
            *   Parent
                *   Child
            *   Sibling`;
        expect(markdownExportService.toMarkdown(html)).toBe(expected);
    });

    it("exports jQuery code in table properly", () => {
        const html = trimIndentation`\
            <figure class="table">
                <table>
                    <thead>
                        <tr>
                            <th>
                                Code
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td>
                                <pre>
            <code class="language-text-x-trilium-auto">this.$widget = $("&lt;div&gt;");</code>
                                </pre>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </figure>
        `;
        const expected = `<table>
    <thead>
        <tr>
            <th>Code</th>
        </tr>
    </thead>
    <tbody>
        <tr>
            <td><pre><code class="language-text-x-trilium-auto">this.$widget = $("&lt;div&gt;");</code>
                    </pre></td>
        </tr>
    </tbody>
</table>`;
        expect(markdownExportService.toMarkdown(html)).toBe(expected);
    });

    it("renders emphasis with underscore", () => {
        const html = /*html*/`<p>This is <em>underlined</em> text.</p>`;
        const expected = `This is _underlined_ text.`;
        expect(markdownExportService.toMarkdown(html)).toBe(expected);
    });

});
