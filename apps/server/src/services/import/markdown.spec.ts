import { trimIndentation } from "@triliumnext/commons";
import { describe, expect, it } from "vitest";

import markdownService from "./markdown.js";

describe("markdown", () => {
    it("rewrites language of known language tags", () => {
        const conversionTable = {
            "nginx": "language-text-x-nginx-conf",
            "diff": "language-text-x-diff",
            "javascript": "language-application-javascript-env-backend",
            "css": "language-text-css",
            "mips": "language-text-x-asm-mips",
            "jsx": "language-text-jsx",
            "html": "language-text-html"
        };

        for (const [ input, output ] of Object.entries(conversionTable)) {
            const result = markdownService.renderToHtml(trimIndentation`\
                \`\`\`${input}
                Hi
                \`\`\`
            `, "title");
            expect(result).toBe(trimIndentation`\
                <pre><code class="${output}">Hi</code></pre>`);
        }
    });

    it("rewrites language of unknown language tags", () => {
        const result = markdownService.renderToHtml(trimIndentation`\
            \`\`\`unknownlanguage
            Hi
            \`\`\`
        `, "title");
        expect(result).toBe(trimIndentation`\
            <pre><code class="language-text-x-trilium-auto">Hi</code></pre>`);
    });

    it("converts h1 heading", () => {
        const result = markdownService.renderToHtml(trimIndentation`\
            # Hello
            ## world
            # another one
            Hello, world
        `, "title");
        expect(result).toBe(`<h2>Hello</h2><h2>world</h2><h2>another one</h2><p>Hello, world</p>`);
    });

    it("parses duplicate title with escape correctly", () => {
        const titles = [
            "What's new",
            "Node.js, Electron and `better-sqlite3`"
        ];

        for (const title of titles) {
            const result = markdownService.renderToHtml(trimIndentation`\
                # ${title}
                Hi there
            `, title);
            expect(result).toBe(`<p>Hi there</p>`);
        }
    });

    it("trims unnecessary whitespace", () => {
        const input = `\
## Heading 1

Title

\`\`\`
code block 1
second line 2
\`\`\`

* Hello
* world

1. Hello
2. World
`;
        const expected = `\
<h2>Heading 1</h2><p>Title</p><pre><code class="language-text-x-trilium-auto">code block 1
second line 2</code></pre><ul><li>Hello</li><li>world</li></ul><ol><li>Hello</li><li>World</li></ol>`;
        expect(markdownService.renderToHtml(input, "Troubleshooting")).toBe(expected);
    });

    it("imports admonitions properly", () => {
        const space = " ";  // editor config trimming space.
        const input = trimIndentation`\
            Before

            > [!NOTE]
            > This is a note.

            > [!TIP]
            > This is a tip.

            > [!IMPORTANT]
            > This is a very important information.

            > [!CAUTION]
            > This is a caution.

            > [!WARNING]
            > ## Title goes here
            >${space}
            > This is a warning.

            After`;
        const expected = `<p>Before</p><aside class="admonition note"><p>This is a note.</p></aside><aside class="admonition tip"><p>This is a tip.</p></aside><aside class="admonition important"><p>This is a very important information.</p></aside><aside class="admonition caution"><p>This is a caution.</p></aside><aside class="admonition warning"><h2>Title goes here</h2><p>This is a warning.</p></aside><p>After</p>`;
        expect(markdownService.renderToHtml(input, "Title")).toStrictEqual(expected);
    });

    it("imports images with same outcome as if inserted from CKEditor", () => {
        const input = "![](api/attachments/YbkR3wt2zMcA/image/image)";
        const expected = `<p><img src="api/attachments/YbkR3wt2zMcA/image/image"></p>`;
        expect(markdownService.renderToHtml(input, "Title")).toStrictEqual(expected);
    });

    it("maintains code blocks with XML/HTML", () => {
        const input = trimIndentation`\
            Before
            \`\`\`
            <application
                ...
                android:testOnly="false">
                ...
            </application>
            \`\`\`
            After`;
        const expected = trimIndentation`\
            <p>Before</p><pre><code class="language-text-x-trilium-auto">&lt;application
                ...
                android:testOnly="false"&gt;
                ...
            &lt;/application&gt;</code></pre><p>After</p>`;
        expect(markdownService.renderToHtml(input, "Title")).toStrictEqual(expected);
    });

    it("does not escape unneeded characters", () => {
        const input = `It's important to note that these examples are not natively supported by Trilium out of the box; instead, they demonstrate what you can build within Trilium.`;
        const expected = `<p>It's important to note that these examples are not natively supported by Trilium out of the box; instead, they demonstrate what you can build within Trilium.</p>`;
        expect(markdownService.renderToHtml(input, "Title")).toStrictEqual(expected);
    });

    it("preserves &nbsp;", () => {
        const input = `Hello&nbsp;world.`;
        const expected = /*html*/`<p>Hello&nbsp;world.</p>`;
        expect(markdownService.renderToHtml(input, "Title")).toStrictEqual(expected);
    });

    it("converts non-breaking space character to &nbsp;", () => {
        const input = `Hello\u00a0world.`;
        const expected = /*html*/`<p>Hello&nbsp;world.</p>`;
        expect(markdownService.renderToHtml(input, "Title")).toStrictEqual(expected);
    });

    it("supports normal links", () => {
        const input = `[Google](https://www.google.com)`;
        const expected = /*html*/`<p><a href="https://www.google.com">Google</a></p>`;
        expect(markdownService.renderToHtml(input, "Title")).toStrictEqual(expected);
    });

    it("does not touch relative links", () => {
        const input = `[Canvas](../../Canvas.html)`;
        const expected = /*html*/`<p><a href="../../Canvas.html">Canvas</a></p>`;
        expect(markdownService.renderToHtml(input, "Title")).toStrictEqual(expected);
    });

    it("imports back to reference links", () => {
        const input = `<a class="reference-link" href="../../Canvas.html">Canvas</a>`;
        const expected = /*html*/`<p><a class="reference-link" href="../../Canvas.html">Canvas</a></p>`;
        expect(markdownService.renderToHtml(input, "Title")).toStrictEqual(expected);
    });

    it("preserves figures and images with sizes", () => {
        const scenarios = [
            /*html*/`<figure class="image image-style-align-center image_resized" style="width:53.44%;"><img style="aspect-ratio:991/403;" src="Jump to Note_image.png" width="991" height="403"></figure>`,
            /*html*/`<figure class="image image-style-align-center image_resized" style="width:53.44%;"><img style="aspect-ratio:991/403;" src="Jump to Note_image.png" width="991" height="403"></figure>`,
            /*html*/`<img class="image_resized" style="aspect-ratio:853/315;width:50%;" src="6_File_image.png" width="853" height="315">`
        ];

        for (const scenario of scenarios) {
            expect(markdownService.renderToHtml(scenario, "Title")).toStrictEqual(scenario);
        }
    });

    it("converts inline math expressions into Mathtex format", () => {
        const input = `The equation is\u00a0$e=mc^{2}$.`;
        const expected = /*html*/`<p>The equation is&nbsp;<span class="math-tex">\\(e=mc^{2}\\)</span>.</p>`;
        expect(markdownService.renderToHtml(input, "Title")).toStrictEqual(expected);
    });

    it("converts multiple inline math expressions into Mathtex format", () => {
        const input = `Energy: $e=mc^{2}$, Force: $F=ma$.`;
        const expected = /*html*/`<p>Energy: <span class="math-tex">\\(e=mc^{2}\\)</span>, Force: <span class="math-tex">\\(F=ma\\)</span>.</p>`;
        expect(markdownService.renderToHtml(input, "Title")).toStrictEqual(expected);
    });

    it("converts multi-line display math expressions into Mathtex format", () => {
        const input = `$$
\\sqrt{x^{2}+1} \\
+ \\frac{1}{2}
$$`;
        const expected = /*html*/`<span class="math-tex">\\[
\\sqrt{x^{2}+1} \\
+ \\frac{1}{2}
\\]</span>`;
        expect(markdownService.renderToHtml(input, "Title")).toStrictEqual(expected);
    });

    it("ignores math formulas inside code blocks and converts inline math expressions correctly", () => {
        const result = markdownService.renderToHtml(trimIndentation`\
            \`\`\`unknownlanguage
            $$a+b$$
            \`\`\`
        `, "title");
        expect(result).toBe(trimIndentation`\
            <pre><code class="language-text-x-trilium-auto">$$a+b$$</code></pre>`);
    });

    it("converts specific inline math expression into Mathtex format", () => {
        const input = `This is a formula: $\\mathcal{L}_{task} + \\mathcal{L}_{od}$ inside a sentence.`;
        const expected = /*html*/`<p>This is a formula: <span class="math-tex">\\(\\mathcal{L}_{task} + \\mathcal{L}_{od}\\)</span> inside a sentence.</p>`;
        expect(markdownService.renderToHtml(input, "Title")).toStrictEqual(expected);
    });

    it("converts math expressions inside list items into Mathtex format", () => {
        const input = `- First item with formula: $E = mc^2$`;
        const expected = /*html*/`<ul><li>First item with formula: <span class="math-tex">\\(E = mc^2\\)</span></li></ul>`;
        expect(markdownService.renderToHtml(input, "Title")).toStrictEqual(expected);
    });

    it("converts display math expressions into Mathtex format", () => {
        const input = `$$\sqrt{x^{2}+1}$$`;
        const expected = /*html*/`<span class="math-tex">\\[\sqrt{x^{2}+1}\\]</span>`;
        expect(markdownService.renderToHtml(input, "Title")).toStrictEqual(expected);
    });

    it("preserves escaped math expressions", () => {
        const scenarios = [
            "\\$\\$\sqrt{x^{2}+1}\\$\\$",
            "The equation is \\$e=mc^{2}\\$."
        ];
        for (const scenario of scenarios) {
            expect(markdownService.renderToHtml(scenario, "Title")).toStrictEqual(`<p>${scenario}</p>`);
        }
    });

    it("preserves table with column widths", () => {
        const html = /*html*/`<figure class="table" style="width:100%;"><table class="ck-table-resized"><colgroup><col style="width:2.77%;"><col style="width:33.42%;"><col style="width:63.81%;"></colgroup><thead><tr><th>&nbsp;</th><th>&nbsp;</th><th>&nbsp;</th></tr></thead><tbody><tr><td>1</td><td><img class="image_resized" style="aspect-ratio:562/454;width:100%;" src="1_Geo Map_image.png" width="562" height="454"></td><td>Go to any location on openstreetmap.org and right click to bring up the context menu. Select the “Show address” item.</td></tr><tr><td>2</td><td><img class="image_resized" style="aspect-ratio:696/480;width:100%;" src="Geo Map_image.png" width="696" height="480"></td><td>The address will be visible in the top-left of the screen, in the place of the search bar.&nbsp;&nbsp;&nbsp;&nbsp;<br><br>Select the coordinates and copy them into the clipboard.</td></tr><tr><td>3</td><td><img class="image_resized" style="aspect-ratio:640/276;width:100%;" src="5_Geo Map_image.png" width="640" height="276"></td><td>Simply paste the value inside the text box into the <code>#geolocation</code> attribute of a child note of the map and then it should be displayed on the map.</td></tr></tbody></table></figure>`;
        expect(markdownService.renderToHtml(html, "Title")).toStrictEqual(html);
    });

    it("generates strike-through text", () => {
        const input = `~~Hello~~ world.`;
        const expected = /*html*/`<p><del>Hello</del> world.</p>`;
        expect(markdownService.renderToHtml(input, "Title")).toStrictEqual(expected);
    });

    it("does not generate additional spacing when importing lists", () => {
        const input = trimIndentation`\
            ### 🐞 Bugfixes

            *   [v0.90.4 docker does not read USER\_UID and USER\_GID from environment](https://github.com/TriliumNext/Trilium/issues/331)
            *   [Invalid CSRF token on Android phone](https://github.com/TriliumNext/Trilium/issues/318)
            *   [Excess spacing in lists](https://github.com/TriliumNext/Trilium/issues/341)`;
        const expected = [
            /*html*/`<h3>🐞 Bugfixes</h3>`,
            /*html*/`<ul>`,
            /*html*/`<li><a href="https://github.com/TriliumNext/Trilium/issues/331">v0.90.4 docker does not read USER_UID and USER_GID from environment</a></li>`,
            /*html*/`<li><a href="https://github.com/TriliumNext/Trilium/issues/318">Invalid CSRF token on Android phone</a></li>`,
            /*html*/`<li><a href="https://github.com/TriliumNext/Trilium/issues/341">Excess spacing in lists</a></li>`,
            /*html*/`</ul>`
        ].join("");
        expect(markdownService.renderToHtml(input, "Title")).toStrictEqual(expected);
    });

    it("imports todo lists properly", () => {
        const input = trimIndentation`\
            - [x] Hello
            - [ ] World`;
        const expected = `<ul class="todo-list"><li><label class="todo-list__label"><input type="checkbox" checked="checked" disabled="disabled"><span class="todo-list__label__description">Hello</span></label></li><li><label class="todo-list__label"><input type="checkbox" disabled="disabled"><span class="todo-list__label__description">World</span></label></li></ul>`;
        expect(markdownService.renderToHtml(input, "Title")).toStrictEqual(expected);
    });

    it("supports wikilink with root-relative path", () => {
        const input = `oh no my banana I bought on [[journal/monday]] has gone off! I’m taking it back to the [[other/shop]] for a refund`;
        const expected = `<p>oh no my banana I bought on <a class="reference-link" href="/journal/monday">journal/monday</a> has gone off! I’m taking it back to the <a class="reference-link" href="/other/shop">other/shop</a> for a refund</p>`;
        expect(markdownService.renderToHtml(input, "Title")).toStrictEqual(expected);
    });

    it("supports wikilink in lists", () => {
        const input = `- oh no my banana I bought on [[journal/monday]] has gone off! I’m taking it back to the [[other/shop]] for a refund`;
        const expected = `<ul><li>oh no my banana I bought on <a class="reference-link" href="/journal/monday">journal/monday</a> has gone off! I’m taking it back to the <a class="reference-link" href="/other/shop">other/shop</a> for a refund</li></ul>`;
        expect(markdownService.renderToHtml(input, "Title")).toStrictEqual(expected);
    });

    it("supports wikilink with image (transclusion)", () => {
        const input = `heres the handsome boy ![[assets/2025-06-20_14-05-20.jpeg]]`;
        const expected = `<p>heres the handsome boy <img src="/assets/2025-06-20_14-05-20.jpeg"></p>`;
        expect(markdownService.renderToHtml(input, "Title")).toStrictEqual(expected);
    });

    it("preserves superscript and subscript", () => {
        const input = `Hello <sup>superscript</sup> <sub>subscript</sub>`;
        const expected = /*html*/`<p>Hello <sup>superscript</sup> <sub>subscript</sub></p>`;
        expect(markdownService.renderToHtml(input, "Title")).toStrictEqual(expected);
    });

    it("adds spellcheck=false to inline code", () => {
        const input = `This is some inline code: \`const x = 10;\``;
        const expected = /*html*/`<p>This is some inline code: <code spellcheck="false">const x = 10;</code></p>`;
        expect(markdownService.renderToHtml(input, "Title")).toStrictEqual(expected);
    });

});
