import { describe, expect, it } from "vitest";

import { CustomMarkdownRenderer, extractCodeBlocks, renderToHtml } from "./markdown_renderer.js";
import { DEFAULT_TASK_STATES, DONE_TASK_STATE, NONE_TASK_STATE } from "./task_states.js";

/** Identity sanitizer so we can assert the raw rendered HTML. */
const identity = (html: string) => html;

function render(content: string, title = "", options: Partial<Parameters<typeof renderToHtml>[2]> = {}): string {
    return renderToHtml(content, title, { sanitize: identity, ...options });
}

describe("extractCodeBlocks", () => {
    it("should extract a fenced code block", () => {
        const input = "before\n```js\nconsole.log('hi');\n```\nafter";
        const { processedText, placeholderMap } = extractCodeBlocks(input);

        expect(placeholderMap.size).toBe(1);
        expect(processedText).toContain("before\n");
        expect(processedText).toContain("\nafter");
        expect(processedText).not.toContain("```");

        const placeholder = [...placeholderMap.keys()][0];
        expect(placeholderMap.get(placeholder)).toBe("```js\nconsole.log('hi');\n```");
    });

    it("should extract inline code", () => {
        const input = "use `console.log` here";
        const { processedText, placeholderMap } = extractCodeBlocks(input);

        expect(placeholderMap.size).toBe(1);
        expect(processedText).not.toContain("`console.log`");

        const placeholder = [...placeholderMap.keys()][0];
        expect(placeholderMap.get(placeholder)).toBe("`console.log`");
    });

    it("should extract multiple fenced code blocks independently", () => {
        const input = "```js\na\n```\ntext\n```py\nb\n```";
        const { processedText, placeholderMap } = extractCodeBlocks(input);

        expect(placeholderMap.size).toBe(2);
        expect(processedText).toContain("text");
    });

    it("should not treat inline backtick-escaped triple backticks as a fenced code block", () => {
        const input = [
            "*   Code blocks with syntax highlight (e.g. ` ```js `) and automatic syntax highlight",
            "*   Block quotes & admonitions",
            "*   Math Equations",
            "*   Mermaid Diagrams using ` ```mermaid `"
        ].join("\n");

        const { processedText, placeholderMap } = extractCodeBlocks(input);

        // All four bullet points must survive
        expect(processedText).toContain("Block quotes & admonitions");
        expect(processedText).toContain("Math Equations");
        expect(processedText).toContain("Mermaid Diagrams");
        expect(processedText).toContain("automatic syntax highlight");

        // The inline code spans should be extracted, not fenced code blocks
        for (const value of placeholderMap.values()) {
            expect(value).not.toMatch(/^```[\s\S]*```$/);
        }
    });

    it("should not swallow content between two inline triple-backtick mentions", () => {
        const input = "Use ` ```js ` for JS and ` ```py ` for Python";
        const { processedText } = extractCodeBlocks(input);

        expect(processedText).toContain("for JS and");
        expect(processedText).toContain("for Python");
    });

    it("should handle a real fenced code block after inline triple backticks", () => {
        const input = [
            "Use ` ```js ` for JavaScript.",
            "",
            "```py",
            "print('hello')",
            "```"
        ].join("\n");

        const { processedText, placeholderMap } = extractCodeBlocks(input);

        expect(processedText).toContain("for JavaScript.");

        // Should have the inline code and the fenced block as separate entries
        const values = [...placeholderMap.values()];
        const hasFencedBlock = values.some((v) => v.includes("print('hello')"));
        expect(hasFencedBlock).toBe(true);
    });
});

describe("renderToHtml", () => {
    describe("headings / handleH1", () => {
        it("removes the first <h1> when its text equals the title", () => {
            const html = render("# My Title\n\nbody", "My Title");
            expect(html).not.toContain("<h1");
            expect(html).not.toContain("<h2");
            expect(html).toBe("<p>body</p>");
        });

        it("demotes a first <h1> whose text differs from the title to <h2>", () => {
            const html = render("# Other\n\nbody", "My Title");
            expect(html).toBe("<h2>Other</h2><p>body</p>");
        });

        it("demotes a second <h1> to <h2> as well", () => {
            const html = render("# A\n\n# B", "A");
            // First h1 ("A") equals title -> removed; second h1 ("B") -> demoted.
            expect(html).toBe("<h2>B</h2>");
        });

        it("keeps the first <h1> as-is when demoteH1 is false", () => {
            const html = render("# A\n\nbody", "X", { demoteH1: false });
            expect(html).toBe("<h1>A</h1><p>body</p>");
        });

        it("decodes named/decimal/hex entities and preserves unknown ones in demoted headings", () => {
            const html = render("# A &amp; B &#65; &#x41; &unknownent;", "X");
            expect(html).toBe("<h2>A & B A A &unknownent;</h2>");
        });

        it("renders a non-h1 heading via the renderer (depth >= 2)", () => {
            // CustomMarkdownRenderer.heading delegates depth>=2 to the base renderer.
            const html = render("## sub heading", "irrelevant");
            expect(html).toBe("<h2>sub heading</h2>");
        });
    });

    describe("paragraphs", () => {
        it("renders a paragraph trimmed of trailing whitespace", () => {
            expect(render("hello world")).toBe("<p>hello world</p>");
        });
    });

    describe("code fences (CustomMarkdownRenderer.code)", () => {
        it("maps a known fence language to its CKEditor MIME class", () => {
            const html = render("```javascript\nconst x = 1;\n```");
            // A markdown code fence is not a Trilium script, so `javascript` maps to plain
            // JavaScript (`text/javascript`) rather than the frontend/backend script variants.
            expect(html).toBe(
                '<pre><code class="language-text-javascript">const x = 1;</code></pre>'
            );
        });

        it("falls back to the auto MIME for an unlabeled fence", () => {
            const html = render("```\nplain\n```");
            expect(html).toBe('<pre><code class="language-text-x-trilium-auto">plain</code></pre>');
        });

        it("falls back to the auto MIME for an unknown fence language", () => {
            const html = render("```nonsenselang\nfoo\n```");
            expect(html).toBe('<pre><code class="language-text-x-trilium-auto">foo</code></pre>');
        });

        it("preserves the mermaid fence language verbatim", () => {
            const html = render("```mermaid\ngraph TD\n```");
            expect(html).toBe('<pre><code class="language-mermaid">graph TD</code></pre>');
        });

        it("renders nothing (no <pre>) for an empty code block", () => {
            const html = render("```js\n```");
            expect(html).toBe("");
            expect(html).not.toContain("<pre>");
        });

        it("restores double quotes after escaping inside a code block", () => {
            const html = render("```javascript\nconst s = \"x\";\n```");
            expect(html).toContain('const s = "x";');
            expect(html).not.toContain("&quot;");
        });
    });

    describe("inline code (codespan)", () => {
        it("renders inline code with spellcheck disabled and escaped content", () => {
            const html = render("use `foo > bar` here");
            expect(html).toBe('<p>use <code spellcheck="false">foo &gt; bar</code> here</p>');
        });
    });

    describe("lists", () => {
        it("renders a task list with checkbox inputs and labels", () => {
            const html = render("- [ ] a\n- [x] b");
            expect(html).toContain('<ul class="todo-list">');
            expect(html).toContain('<input type="checkbox"disabled="disabled">');
            expect(html).toContain('<input type="checkbox"checked="checked" disabled="disabled">');
            expect(html).toContain('<label class="todo-list__label">');
            expect(html).toContain('<span class="todo-list__label__description">a</span>');
            expect(html).toContain('<span class="todo-list__label__description">b</span>');
        });

        it("renders a non-task unordered list as a plain <ul>", () => {
            const html = render("- one\n- two");
            expect(html).toBe("<ul><li>one</li><li>two</li></ul>");
            expect(html).not.toContain("todo-list");
        });

        it("renders an ordered list as a plain <ol>", () => {
            const html = render("1. one\n2. two");
            expect(html).toBe("<ol><li>one</li><li>two</li></ol>");
        });

        it("prepends the checkbox into the paragraph of a loose task item (text first token)", () => {
            const html = render("- [ ] first\n\n- [x] second");
            // Loose items wrap content in <p>; the checkbox is injected before the text.
            expect(html).toContain(
                '<span class="todo-list__label__description"><p><input type="checkbox"disabled="disabled">first</p></span>'
            );
            expect(html).toContain(
                '<span class="todo-list__label__description"><p><input type="checkbox"checked="checked" disabled="disabled">second</p></span>'
            );
        });

        it("prepends the checkbox to a loose task whose paragraph first inner token is not text", () => {
            const html = render("- [ ] ![](http://x/y.png)\n\n- [x] b");
            // The paragraph's first inner token is an image (not text), so only the
            // paragraph-level text receives the checkbox prefix.
            expect(html).toContain(
                '<span class="todo-list__label__description"><p><input type="checkbox"disabled="disabled"><img src="http://x/y.png"></p></span>'
            );
        });

        it("unshifts the checkbox as a text token for a loose task whose first token is a checkbox", () => {
            // marked emits a `checkbox` token (not a paragraph) as the first token of a
            // loose native task item — the checkbox HTML is unshifted before the body.
            const html = render("- [ ] text\n\n  more");
            expect(html).toBe(
                '<ul class="todo-list"><li><label class="todo-list__label">' +
                '<span class="todo-list__label__description">' +
                '<input type="checkbox"disabled="disabled"><p>text</p><p>more</p>' +
                "</span></label></li></ul>"
            );
        });

        it("unshifts a checked checkbox for a loose, checked native task item", () => {
            const html = render("- [x] done\n\n  more body");
            expect(html).toContain(
                '<span class="todo-list__label__description">' +
                '<input type="checkbox"checked="checked" disabled="disabled"><p>done</p><p>more body</p></span>'
            );
        });

        it("prepends the checkbox directly to a tight task item body", () => {
            const html = render("- [ ] one");
            expect(html).toBe(
                '<ul class="todo-list"><li><label class="todo-list__label">' +
                '<input type="checkbox"disabled="disabled">' +
                '<span class="todo-list__label__description">one</span></label></li></ul>'
            );
        });
    });

    describe("custom task states", () => {
        it("recognizes a custom [/] marker as a 'doing' task", () => {
            const html = render("- [/] x", "", { taskStates: DEFAULT_TASK_STATES });
            expect(html).toContain('data-trilium-task-state="doing"');
            expect(html).toContain('<input type="checkbox"disabled="disabled">');
            expect(html).toContain('<span class="todo-list__label__description">x</span>');
            // The `[/]` marker must be stripped from the visible text.
            expect(html).not.toContain("[/]");
        });

        it("recognizes a custom [?] (maybe) marker", () => {
            const html = render("- [?] m", "", { taskStates: DEFAULT_TASK_STATES });
            expect(html).toContain('data-trilium-task-state="maybe"');
            expect(html).toContain('<span class="todo-list__label__description">m</span>');
        });

        it("recognizes a custom [-] (cancelled) marker", () => {
            const html = render("- [-] c", "", { taskStates: DEFAULT_TASK_STATES });
            expect(html).toContain('data-trilium-task-state="cancelled"');
            expect(html).toContain('<span class="todo-list__label__description">c</span>');
        });

        it("strips the custom marker across nested tokens for a loose item", () => {
            const html = render("- [/] x\n\n  more text\n\n- [x] b", "", { taskStates: DEFAULT_TASK_STATES });
            expect(html).toContain('data-trilium-task-state="doing"');
            expect(html).toContain(
                '<p><input type="checkbox"disabled="disabled">x</p><p>more text</p>'
            );
            expect(html).not.toContain("[/]");
        });

        it("uses the no-op detector when only anchor states are supplied (no custom symbols)", () => {
            // Anchors use symbols " " and "x" which are filtered out, leaving an empty
            // symbol map -> detector returns a no-op, so `- [/]` stays literal text.
            const html = render("- [/] x", "", { taskStates: [NONE_TASK_STATE, DONE_TASK_STATE] });
            expect(html).toBe("<ul><li>[/] x</li></ul>");
            expect(html).not.toContain("todo-list");
            expect(html).not.toContain("data-trilium-task-state");
        });
    });

    describe("images (CustomMarkdownRenderer.image)", () => {
        it("removes an empty alt attribute", () => {
            const html = render("![](http://x/y.png)");
            expect(html).toBe('<p><img src="http://x/y.png"></p>');
            expect(html).not.toContain("alt");
        });

        it("keeps a non-empty alt attribute", () => {
            const html = render("![cat](http://x/y.png)");
            expect(html).toBe('<p><img src="http://x/y.png" alt="cat"></p>');
        });
    });

    describe("blockquotes / admonitions (CustomMarkdownRenderer.blockquote)", () => {
        it("renders a [!NOTE] admonition", () => {
            expect(render("> [!NOTE]\n> body")).toBe('<aside class="admonition note"><p>body</p></aside>');
        });

        it("renders all of TIP/IMPORTANT/CAUTION/WARNING admonitions", () => {
            expect(render("> [!TIP]\n> x")).toBe('<aside class="admonition tip"><p>x</p></aside>');
            expect(render("> [!IMPORTANT]\n> x")).toBe('<aside class="admonition important"><p>x</p></aside>');
            expect(render("> [!CAUTION]\n> x")).toBe('<aside class="admonition caution"><p>x</p></aside>');
            expect(render("> [!WARNING]\n> x")).toBe('<aside class="admonition warning"><p>x</p></aside>');
        });

        it("renders an empty admonition with a non-breaking space inside", () => {
            const html = render("> [!NOTE]");
            expect(html).toBe('<aside class="admonition note">&nbsp;</aside>');
        });

        it("keeps an unknown admonition type as a normal blockquote", () => {
            const html = render("> [!FOO]\n> body");
            expect(html).toContain("<blockquote>");
            expect(html).not.toContain("admonition");
            expect(html).toContain("[!FOO]");
        });

        it("renders a plain blockquote", () => {
            expect(render("> just quote")).toBe("<blockquote><p>just quote</p></blockquote>");
        });
    });

    describe("formulas", () => {
        it("renders an inline formula", () => {
            expect(render("$x^2$")).toBe('<span class="math-tex">\\(x^2\\)</span>');
        });

        it("renders a block formula", () => {
            expect(render("$$x$$")).toBe('<span class="math-tex">\\[x\\]</span>');
        });

        it("does not convert an escaped dollar to a formula", () => {
            const html = render("price is \\$5 today");
            expect(html).toContain("$5");
            expect(html).not.toContain("math-tex");
        });

        it("does not convert a formula-like sequence inside inline code (codeMap path)", () => {
            const html = render("use `$x$` and real $y$");
            // The `$x$` inside the codespan stays literal; only the bare $y$ becomes a formula.
            expect(html).toContain('<code spellcheck="false">$x$</code>');
            expect(html).toContain('<span class="math-tex">\\(y\\)</span>');
        });
    });

    describe("wiki links and transclusions", () => {
        it("renders a wiki link with the default href format", () => {
            const html = render("[[abc123]]");
            expect(html).toBe('<p><a class="reference-link" href="/abc123">abc123</a></p>');
        });

        it("renders a wiki link with a custom href format", () => {
            const html = render("[[abc123]]", "", { wikiLink: { formatHref: (id) => `#root/${id}` } });
            expect(html).toBe('<p><a class="reference-link" href="#root/abc123">abc123</a></p>');
        });

        it("renders a transclusion with the default src format", () => {
            const html = render("![[abc123]]");
            expect(html).toBe('<p><img src="/abc123"></p>');
        });

        it("renders a transclusion with a custom src format", () => {
            const html = render("![[abc123]]", "", { transclusion: { formatSrc: (id) => `/api/images/${id}` } });
            expect(html).toBe('<p><img src="/api/images/abc123"></p>');
        });
    });

    describe("footnotes", () => {
        it("renders footnotes without throwing", () => {
            const html = render("text[^1]\n\n[^1]: note");
            expect(html).toContain("data-footnote-ref");
            expect(html).toContain('id="footnote-1"');
            expect(html).toContain("note");
        });
    });

    describe("trailing transforms", () => {
        it("adds a trailing semicolon to a style attribute on an <img>", () => {
            const injectStyle = (html: string) => html.replace("<img ", '<img style="width:10px" ');
            const html = renderToHtml("![cat](http://x/y.png)", "", { sanitize: injectStyle });
            expect(html).toContain('style="width:10px;"');
        });

        it("removes the slash from a self-closing tag", () => {
            const injectSelfClose = (html: string) => `${html}<hr custom="1" />`;
            const html = renderToHtml("text", "", { sanitize: injectSelfClose });
            expect(html).toContain('<hr custom="1">');
            expect(html).not.toContain("/>");
        });

        it("normalizes a non-breaking space in the output to the &nbsp; entity", () => {
            const nbsp = String.fromCharCode(0x00a0);
            const injectNbsp = (html: string) => `${html}${nbsp}END`;
            const out = renderToHtml("text", "", { sanitize: injectNbsp });
            expect(out).toBe("<p>text</p>&nbsp;END");
            expect(out).not.toContain(nbsp);
        });
    });

    describe("custom renderer option", () => {
        it("uses a caller-provided CustomMarkdownRenderer instance", () => {
            const renderer = new CustomMarkdownRenderer({ async: false });
            const html = render("# heading\n\nbody", "X", { renderer });
            expect(html).toBe("<h2>heading</h2><p>body</p>");
        });
    });
});
