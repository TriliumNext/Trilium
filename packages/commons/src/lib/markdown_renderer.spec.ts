import { describe, expect, it } from "vitest";

import { CustomMarkdownRenderer, demoteHeadings, extractCodeBlocks, renderToHtml } from "./markdown_renderer.js";
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

    it("should extract a fenced code block nested in a blockquote, prefixes and all (#10268)", () => {
        const input = [ "> ```", "> echo ${VAR} ${VAR2}", "> ```" ].join("\n");
        const { processedText, placeholderMap } = extractCodeBlocks(input);

        expect(placeholderMap.size).toBe(1);
        expect(processedText).not.toContain("```");
        // The whole block, including the `> ` prefixes, is captured verbatim so the
        // blockquote still renders after restoration.
        expect([...placeholderMap.values()][0]).toBe(input);
    });

    it("should extract a fenced code block in a doubly-nested blockquote", () => {
        const input = [ "> > ```", "> > $ $", "> > ```" ].join("\n");
        const { processedText, placeholderMap } = extractCodeBlocks(input);

        expect(placeholderMap.size).toBe(1);
        expect(processedText).not.toContain("```");
        expect([...placeholderMap.values()][0]).toBe(input);
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

        it("shifts the whole hierarchy down one level when a content <h1> remains (#8383)", () => {
            // A leading <h1> demoted to <h2> while leaving a sibling <h2> as <h2> would
            // collapse two distinct levels; instead the hierarchy shifts down so nesting
            // is preserved (and clamps at <h6>).
            expect(render("# A\n\n## B\n\n### C", "X")).toBe("<h2>A</h2><h3>B</h3><h4>C</h4>");
            expect(render("# A\n\n###### Deep", "X")).toBe("<h2>A</h2><h6>Deep</h6>");
        });

        it("does not shift when the title is stripped and the content already starts at <h2>", () => {
            // The common case: the leading <h1> equals the title and is removed, leaving
            // content that already begins at <h2> — nothing else should move.
            expect(render("# Title\n\n## A\n\n### B", "Title")).toBe("<h2>A</h2><h3>B</h3>");
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

    describe("tables (CustomMarkdownRenderer.table)", () => {
        it("wraps a table in <figure class=\"table\"> to match CKEditor's structure (#10270)", () => {
            const html = render("| a | b |\n|---|---|\n| c | d |");
            expect(html).toContain('<figure class="table">');
            expect(html).toContain("</figure>");
            // The wrapper hugs the table with no stray whitespace between them.
            expect(html).toContain('<figure class="table"><table>');
            expect(html).toContain("</table></figure>");
            expect(html).toContain("<th>a</th>");
            expect(html).toContain("<td>c</td>");
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

        it("matches the admonition type case-insensitively (Obsidian uses lowercase)", () => {
            expect(render("> [!note]\n> body")).toBe('<aside class="admonition note"><p>body</p></aside>');
        });

        describe("Obsidian callouts (obsidian: true)", () => {
            it("maps extended callout types to the nearest Trilium admonition type", () => {
                const obsidian = { obsidian: true };
                expect(render("> [!success]\n> done", "", obsidian))
                    .toBe('<aside class="admonition tip"><p>done</p></aside>');
                expect(render("> [!question]\n> q", "", obsidian))
                    .toBe('<aside class="admonition tip"><p>q</p></aside>');
                expect(render("> [!danger]\n> bad", "", obsidian))
                    .toBe('<aside class="admonition caution"><p>bad</p></aside>');
                expect(render("> [!info]\n> i", "", obsidian))
                    .toBe('<aside class="admonition note"><p>i</p></aside>');
                expect(render("> [!example]\n> e", "", obsidian))
                    .toBe('<aside class="admonition important"><p>e</p></aside>');
            });

            it("renders an inline custom title as a bold lead paragraph", () => {
                expect(render("> [!note] Custom Title\n> body", "", { obsidian: true }))
                    .toBe('<aside class="admonition note"><p><strong>Custom Title</strong></p><p>body</p></aside>');
            });

            it("supports a title separated from the body by a blank line", () => {
                expect(render("> [!tip] Heads up\n>\n> body", "", { obsidian: true }))
                    .toBe('<aside class="admonition tip"><p><strong>Heads up</strong></p><p>body</p></aside>');
            });

            it("drops the fold marker (+/-) while keeping the title", () => {
                expect(render("> [!note]- Folded\n> body", "", { obsidian: true }))
                    .toBe('<aside class="admonition note"><p><strong>Folded</strong></p><p>body</p></aside>');
                expect(render("> [!note]+\n> body", "", { obsidian: true }))
                    .toBe('<aside class="admonition note"><p>body</p></aside>');
            });

            it("keeps an unknown callout type as a plain blockquote", () => {
                const html = render("> [!frobnicate]\n> body", "", { obsidian: true });
                expect(html).toContain("<blockquote>");
                expect(html).not.toContain("admonition");
            });
        });

        it("does not treat extended Obsidian callout types as admonitions without the obsidian flag", () => {
            const html = render("> [!success]\n> x");
            expect(html).toContain("<blockquote>");
            expect(html).not.toContain("admonition");
            expect(html).toContain("[!success]");
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

        it("renders an escaped dollar as a single literal dollar without adding backslashes (#10179)", () => {
            // Markdown `\$` is an escaped dollar; the backslash must be consumed, leaving
            // just `$`. It must not gain extra backslashes (the reported `\\$` output).
            expect(render("\\$")).toBe("<p>$</p>");
            expect(render("price is \\$5 today")).toBe("<p>price is $5 today</p>");
        });

        it("leaves mismatched dollar runs as literal text instead of a malformed formula", () => {
            // Asymmetric delimiters (e.g. `$$…$`) must not be parsed as math — otherwise a
            // stray `$` ends up inside the formula body and crashes KaTeX. GitHub renders
            // these as plain text, and so should we.
            expect(render("$$e=mc^2$")).toBe("<p>$$e=mc^2$</p>");
            expect(render("$e=mc^2$$")).toBe("<p>$e=mc^2$$</p>");
            expect(render("$$$x$$")).toBe("<p>$$$x$$</p>");
            expect(render("$$e=mc^2$")).not.toContain("math-tex");
        });

        it("does not treat dollars in a blockquoted code block as formulas (#10268)", () => {
            // The fence lines carry a `> ` prefix, so the code block must still be shielded
            // from formula extraction — otherwise `${VAR} ${VAR2}` is mangled into a math span.
            const html = render([ "> ```", "> echo ${VAR} ${VAR2}", "> ```" ].join("\n"));
            expect(html).toContain("echo ${VAR} ${VAR2}");
            expect(html).not.toContain("math-tex");
            expect(html).not.toContain("FORMULA");
            expect(html).toContain("<blockquote>");
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

    describe("Obsidian syntax (obsidian option)", () => {
        it("renders ==text== as a background-coloured span only when the obsidian flag is set", () => {
            expect(render("==hi==", "", { obsidian: true }))
                .toBe('<p><span style="background-color:hsl(60, 75%, 60%);">hi</span></p>');
            // Off by default so generic Markdown is untouched.
            expect(render("==hi==")).toBe("<p>==hi==</p>");
        });

        it("parses inner markdown inside a highlight", () => {
            expect(render("==**bold**==", "", { obsidian: true }))
                .toBe('<p><span style="background-color:hsl(60, 75%, 60%);"><strong>bold</strong></span></p>');
        });

        it("leaves ==== and spaced == as literal text", () => {
            expect(render("====", "", { obsidian: true })).toBe("<p>====</p>");
            expect(render("a == b", "", { obsidian: true })).toBe("<p>a == b</p>");
        });

        it("does not highlight == inside inline code", () => {
            expect(render("`==x==`", "", { obsidian: true }))
                .toBe('<p><code spellcheck="false">==x==</code></p>');
        });

        it("turns %% comment %% into an HTML comment only when the obsidian flag is set", () => {
            expect(render("a %%secret%% b", "", { obsidian: true })).toBe("<p>a <!-- secret --> b</p>");
            // Off by default so generic Markdown is untouched.
            expect(render("a %%secret%% b")).toBe("<p>a %%secret%% b</p>");
        });

        it("handles a single-block comment spanning lines", () => {
            expect(render("%%\nhidden\nnote\n%%", "", { obsidian: true })).toBe("<p><!-- hidden\nnote --></p>");
        });

        it("neutralises a comment terminator in the body so it cannot break out", () => {
            expect(render("%%a-->b%%", "", { obsidian: true })).toBe("<p><!-- a-- >b --></p>");
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

describe("demoteHeadings", () => {
    /** Identity decoder — keeps the heading text verbatim. */
    const verbatim = (s: string) => s;

    it("leaves content untouched when there is no <h1>", () => {
        expect(demoteHeadings("<h2>A</h2><h3>B</h3>", "Title", verbatim)).toBe("<h2>A</h2><h3>B</h3>");
    });

    it("strips the leading <h1> that duplicates the title without shifting the rest", () => {
        // The common case: title removed, content already starts at <h2>.
        expect(demoteHeadings("<h1>Title</h1><h2>A</h2><h3>B</h3>", "Title", verbatim))
            .toBe("<h2>A</h2><h3>B</h3>");
    });

    it("shifts the whole hierarchy down one level when a content <h1> remains", () => {
        // Top-level <h1> and nested <h2> stay distinct instead of both becoming <h2>.
        expect(demoteHeadings("<h1>A</h1><h2>B</h2><h3>C</h3>", "Title", verbatim))
            .toBe("<h2>A</h2><h3>B</h3><h4>C</h4>");
        // Title stripped, but a remaining content <h1> still triggers the shift.
        expect(demoteHeadings("<h1>Title</h1><h1>Chapter</h1><h2>Section</h2>", "Title", verbatim))
            .toBe("<h2>Chapter</h2><h3>Section</h3>");
    });

    it("clamps at <h6> since there is no <h7>", () => {
        expect(demoteHeadings("<h1>A</h1><h5>E</h5><h6>F</h6>", "Title", verbatim))
            .toBe("<h2>A</h2><h6>E</h6><h6>F</h6>");
    });

    it("matches headings with inline markup and carries attributes onto the demoted <h2>", () => {
        expect(demoteHeadings("<h1>Chapter <em>One</em></h1><h2>Intro</h2>", "Title", verbatim))
            .toBe("<h2>Chapter <em>One</em></h2><h3>Intro</h3>");
        expect(demoteHeadings(`<h1 id="top">Main</h1><h2>Sub</h2>`, "Title", verbatim))
            .toBe(`<h2 id="top">Main</h2><h3>Sub</h3>`);
    });

    it("applies the injected decoder to the demoted <h1> text and the title comparison only", () => {
        const upper = (s: string) => s.toUpperCase();
        // The decoder runs on the <h1> text but not on shifted sub-headings.
        expect(demoteHeadings("<h1>a</h1><h2>b</h2>", "Title", upper)).toBe("<h2>A</h2><h3>b</h3>");
        // The decoder is also used when comparing the first <h1> against the title.
        expect(demoteHeadings("<h1>a</h1>", "A", upper)).toBe("");
    });
});
