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
            > |     |     |
            > | --- | --- |
            > | 1   | 2   |
            > | 3   | 4   |

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

        const expected = trimIndentation`\
            <table><tbody><tr><td>Row 1</td><td><p>Allows displaying the value of one or more attributes in the calendar like this:&nbsp;</p><p><img src="13_Calendar View_image.png" alt=""></p><pre><code class="language-text-x-trilium-auto">#weight="70"
                        #Mood="Good"
                        #calendar:displayedAttributes="weight,Mood"</code></pre><p>It can also be used with relations, case in which it will display the title of the target note:</p><pre><code class="language-text-x-trilium-auto">~assignee=@My assignee
                        #calendar:displayedAttributes="assignee"</code></pre></td></tr></tbody></table>`;
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

    it("exports unformatted table", () => {
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
        const expected = trimIndentation`\
            |     |     |
            | --- | --- |
            | Hi  | there |
            | Hi  | there |`;
        expect(markdownExportService.toMarkdown(html)).toBe(expected);
    });

    it("preserves superscript and subscript", () => {
        const html = /*html*/`<p>Hello <sup><strong>superscript</strong></sup> <sub><strong>subscript</strong></sub></p>`;
        const expected = `Hello <sup><strong>superscript</strong></sup> <sub><strong>subscript</strong></sub>`;
        expect(markdownExportService.toMarkdown(html)).toBe(expected);
    });

});
