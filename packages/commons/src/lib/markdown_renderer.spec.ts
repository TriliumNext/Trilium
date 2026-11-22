import { describe, expect, it, onTestFinished, vi } from "vitest";

import { CustomMarkdownRenderer, demoteHeadings, extractCodeBlocks, renderToHtml } from "./markdown_renderer.js";
import { HIGHLIGHT_STYLE } from "./marked_extensions.js";
import { DEFAULT_TASK_STATES, DONE_TASK_STATE, NONE_TASK_STATE, type TaskStateDef } from "./task_states.js";

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

    it("follows the fence rules of CommonMark", () => {
        const blocks = [
            [ "````md", "```js", "a", "```", "$$x$$", "````" ].join("\n"),
            [ "~~~", "$a$", "```", "~~~~" ].join("\n"),
            [ "- ```js", "  $a$", "  ```" ].join("\n")
        ];
        for (const block of blocks) {
            const { processedText, placeholderMap } = extractCodeBlocks(`${block}\n\n$b$`);
            expect([ ...placeholderMap.values() ], block).toStrictEqual([ block ]);
            expect(processedText, block).toMatch(/^<!--CODE_BLOCK_[^>]+-->\n\n\$b\$$/);
        }

        const unclosed = "```\n$a$\n\n$b$";
        expect([ ...extractCodeBlocks(unclosed).placeholderMap.values() ])
            .toStrictEqual([ unclosed ]);
        expect(extractCodeBlocks("> ```\n> $a$\n\n$b$").placeholderMap.size).toBe(0);
    });

    it("looks for the closing fence only in the list item or quote of the opening one", () => {
        const block = "```\ncode\n```";
        const containers = [
            "- ```\n  $a$", "1. ```js\n   $a$", "> ```\n> $a$", "> - ```\n>   $a$"
        ];
        for (const container of containers) {
            const source = `${container}\n$x$\n\n${block}`;
            const { processedText, placeholderMap } = extractCodeBlocks(source);
            expect([ ...placeholderMap.values() ], container).toStrictEqual([ block ]);
            expect(processedText, container).toContain("\n$x$\n");
        }

        const samples = "- ```js\n  a\n".repeat(8_000);
        const start = performance.now();
        expect(extractCodeBlocks(samples).placeholderMap.size).toBe(0);
        expect(performance.now() - start).toBeLessThan(500);
    });

    it("never takes a placeholder that the text holds", () => {
        const input = "<!--CODE_BLOCK_0_1-->\n```\n$a$\n```";
        const { processedText, placeholderMap } = extractCodeBlocks(input);

        expect([ ...placeholderMap.keys() ]).toStrictEqual([ "<!--CODE_BLOCK_1_0-->" ]);
        expect(processedText).toBe("<!--CODE_BLOCK_0_1-->\n<!--CODE_BLOCK_1_0-->");
    });

    it("should shield a 4-backtick block containing a 3-backtick inner fence and $-delimited text", () => {
        const input = "````markdown\nExample:\n\n```js\nfoo()\n```\n$x$\n````";
        const { processedText, placeholderMap } = extractCodeBlocks(input);

        expect(placeholderMap.size).toBe(1);
        expect(processedText).not.toContain("$x$");
        expect([...placeholderMap.values()][0]).toBe(input);
    });

    it("should handle a long run of backticks without backtracking", () => {
        const input = "`".repeat(50_000);
        const start = performance.now();
        const { placeholderMap } = extractCodeBlocks(input);

        expect([ ...placeholderMap.values() ]).toStrictEqual([ input ]);
        expect(performance.now() - start).toBeLessThan(100);
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
        it("renders inline code with escaped content", () => {
            const html = render("use `foo > bar` here");
            expect(html).toBe('<p>use <code>foo &gt; bar</code> here</p>');
        });
    });

    describe("strikethrough (literal tilde)", () => {
        it("strikes through only doubled tildes, leaving lone ones literal", () => {
            expect(render("this is ~~gone~~ now")).toBe("<p>this is <del>gone</del> now</p>");
            // Two approximations in one paragraph must not pair up into a strikethrough.
            expect(render("a ~07:50 departure, supplement (~€11)"))
                .toBe("<p>a ~07:50 departure, supplement (~€11)</p>");
            // A lone tilde inside a real strikethrough stays part of the struck text.
            expect(render("~~strike with ~5 min inside~~"))
                .toBe("<p><del>strike with ~5 min inside</del></p>");
        });
    });

    describe("lists", () => {
        it("renders a task list with checkbox inputs and labels", () => {
            const html = render("- [ ] a\n- [x] b");
            expect(html).toContain('<ul class="todo-list">');
            expect(html).toContain('<input type="checkbox" disabled="disabled">');
            expect(html).toContain('<input type="checkbox" checked="checked" disabled="disabled">');
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

        it("starts a new todo list at a blank line between two task items", () => {
            // A blank line makes the list loose, which wraps each item in <p> — a form
            // CKEditor cannot upcast. It is also what the Markdown export writes for two
            // todo lists separated by an empty paragraph, so the import rebuilds those.
            expect(render("- [ ] Truc\n\n- [x] Machin")).toBe(
                '<ul class="todo-list"><li><label class="todo-list__label">' +
                '<input type="checkbox" disabled="disabled">' +
                '<span class="todo-list__label__description">Truc</span></label></li></ul>' +
                "<p>&nbsp;</p>" +
                '<ul class="todo-list"><li><label class="todo-list__label">' +
                '<input type="checkbox" checked="checked" disabled="disabled">' +
                '<span class="todo-list__label__description">Machin</span></label></li></ul>'
            );
        });

        it("splits only where the blank line falls, keeping adjacent items in one list", () => {
            const html = render("- [ ] A\n- [ ] B\n\n- [ ] C");
            expect(html.match(/<ul class="todo-list">/g)).toHaveLength(2);
            expect(html).toContain(
                '<span class="todo-list__label__description">A</span></label></li>' +
                '<li><label class="todo-list__label">'
            );
            expect(html).toContain('</ul><p>&nbsp;</p><ul class="todo-list">');
        });

        it("keeps a loose item's inline markup in the description", () => {
            expect(render("- [ ] **bold** and [link](http://x)\n\n- [ ] b")).toContain(
                '<span class="todo-list__label__description">' +
                '<strong>bold</strong> and <a href="http://x">link</a></span>'
            );
        });

        it("unwraps a loose item whose paragraph opens with a non-text token", () => {
            expect(render("- [ ] ![](http://x/y.png)\n\n- [x] b")).toContain(
                '<span class="todo-list__label__description"><img src="http://x/y.png"></span>'
            );
        });

        it("keeps a task item's later blocks after the label, not inside the description", () => {
            // CKEditor's multi-block todo item: the first block is the label's
            // description, every later one is a sibling of </label>.
            expect(render("- [ ] text\n\n  more")).toBe(
                '<ul class="todo-list"><li><label class="todo-list__label">' +
                '<input type="checkbox" disabled="disabled">' +
                '<span class="todo-list__label__description">text</span></label>' +
                "<p>more</p></li></ul>"
            );
            expect(render("- [x] done\n\n  more body")).toContain(
                '<input type="checkbox" checked="checked" disabled="disabled">' +
                '<span class="todo-list__label__description">done</span></label><p>more body</p>'
            );
        });

        it("keeps a nested task list after the label of its parent item", () => {
            expect(render("- [ ] a\n    - [ ] b")).toBe(
                '<ul class="todo-list"><li><label class="todo-list__label">' +
                '<input type="checkbox" disabled="disabled">' +
                '<span class="todo-list__label__description">a</span></label>' +
                '<ul class="todo-list"><li><label class="todo-list__label">' +
                '<input type="checkbox" disabled="disabled">' +
                '<span class="todo-list__label__description">b</span></label></li></ul></li></ul>'
            );
        });

        it("drops the todo-list class from a split group holding no task item", () => {
            expect(render("- [ ] a\n\n- plain")).toBe(
                '<ul class="todo-list"><li><label class="todo-list__label">' +
                '<input type="checkbox" disabled="disabled">' +
                '<span class="todo-list__label__description">a</span></label></li></ul>' +
                "<p>&nbsp;</p><ul><li><p>plain</p></li></ul>"
            );
        });

        it("leaves an ordered task list as a single <ol> so its numbering survives", () => {
            const html = render("1. [ ] a\n\n2. [ ] b");
            expect(html).toContain("<ol>");
            expect(html).not.toContain("<p>&nbsp;</p>");
        });

        it("renders an empty task marker as literal text, not a task item", () => {
            // marked's task rule needs a space after `]`, so `- [ ]` alone is not a task.
            expect(render("- [ ]")).toBe("<ul><li>[ ]</li></ul>");
        });

        it("prepends the checkbox directly to a tight task item body", () => {
            const html = render("- [ ] one");
            expect(html).toBe(
                '<ul class="todo-list"><li><label class="todo-list__label">' +
                '<input type="checkbox" disabled="disabled">' +
                '<span class="todo-list__label__description">one</span></label></li></ul>'
            );
        });
    });

    describe("custom task states", () => {
        it("recognizes a custom [/] marker as a 'doing' task and titles the <li> with the state's human name", () => {
            const html = render("- [/] x", "", { taskStates: DEFAULT_TASK_STATES });
            expect(html).toContain('data-trilium-task-state="doing"');
            expect(html).toContain('title="Doing"');
            expect(html).toContain('<input type="checkbox" disabled="disabled">');
            expect(html).toContain('<span class="todo-list__label__description">x</span>');
            // The `[/]` marker must be stripped from the visible text.
            expect(html).not.toContain("[/]");
        });

        it("recognizes a custom [?] (maybe) marker", () => {
            const html = render("- [?] m", "", { taskStates: DEFAULT_TASK_STATES });
            expect(html).toContain('data-trilium-task-state="maybe"');
            expect(html).toContain('title="Maybe"');
            expect(html).toContain('<span class="todo-list__label__description">m</span>');
        });

        it("recognizes a custom [-] (cancelled) marker", () => {
            const html = render("- [-] c", "", { taskStates: DEFAULT_TASK_STATES });
            expect(html).toContain('data-trilium-task-state="cancelled"');
            expect(html).toContain('title="Cancelled"');
            expect(html).toContain('<span class="todo-list__label__description">c</span>');
        });

        it("emits no title attribute for the anchor states (native unchecked and checked)", () => {
            // Native `[ ]` and `[x]` never carry `data-trilium-task-state` and must not
            // carry a `title` either — the checkbox alone explains them.
            const unchecked = render("- [ ] u", "", { taskStates: DEFAULT_TASK_STATES });
            expect(unchecked).not.toContain(" title=");
            const checked = render("- [x] c", "", { taskStates: DEFAULT_TASK_STATES });
            expect(checked).not.toContain(" title=");
        });

        it("emits no title attribute for a state name the config doesn't define", () => {
            // "shipped" is unreachable from the default markdown symbols, but a
            // caller can still ask for it through an alternative `taskStates` list
            // that doesn't include it. Ensure the renderer skips the title lookup
            // rather than emitting `title="undefined"` or crashing.
            const customStates: TaskStateDef[] = [
                { id: "_shipped", name: "shipped", title: "Shipped", markdownSymbol: "!", isCompleted: true, icon: "bx bx-rocket" }
            ];
            const html = render("- [!] x", "", { taskStates: customStates });
            expect(html).toContain('title="Shipped"'); // sanity: known state IS titled
            // But re-rendering the same markdown against a config that doesn't
            // include `shipped` yields no title:
            const bareHtml = render(
                '<ul class="todo-list"><li data-trilium-task-state="shipped">…</li></ul>',
                "",
                { taskStates: [] }
            );
            expect(bareHtml).not.toContain("title=");
        });

        it("falls back to state.name when the state's title is empty", () => {
            const noTitleStates: TaskStateDef[] = [
                { id: "_bare", name: "bare", title: "", markdownSymbol: "b", isCompleted: false, icon: "bx bx-x" }
            ];
            const html = render("- [b] x", "", { taskStates: noTitleStates });
            expect(html).toContain('data-trilium-task-state="bare"');
            expect(html).toContain('title="bare"'); // fell back to name
        });

        it("HTML-escapes the state title (no XSS from a malicious config)", () => {
            const evilStates: TaskStateDef[] = [
                { id: "_x", name: "xss", title: '<script>alert(1)</script>', markdownSymbol: "!", isCompleted: false, icon: "bx bx-x" }
            ];
            const html = render("- [!] x", "", { taskStates: evilStates });
            expect(html).not.toContain("<script>");
            expect(html).toContain('title="&lt;script&gt;alert(1)&lt;/script&gt;"');
        });

        it("strips the custom marker across nested tokens for a loose item", () => {
            const html = render("- [/] x\n\n  more text\n\n- [x] b", "", { taskStates: DEFAULT_TASK_STATES });
            expect(html).toContain('data-trilium-task-state="doing"');
            expect(html).toContain(
                '<span class="todo-list__label__description">x</span></label><p>more text</p>'
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

        it("treats the whole marker paragraph as the title when it is raw, unterminated HTML", () => {
            // A callout authored as a raw HTML paragraph reaches the renderer verbatim, so the
            // marker paragraph carries neither a closing `</p>` nor a soft line break to split on.
            // Everything after the marker is then the title, with no body.
            expect(render("> <p>[!NOTE] raw html para"))
                .toBe('<aside class="admonition note"><p><strong>raw html para</strong></p></aside>');
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

    describe("asides (CustomMarkdownRenderer.html)", () => {
        it("places and colors a bare aside as a new one, and a centered one in the flow", () => {
            const wrapped = '<aside style="--tn-background:#555555;background-color:#555555;" '
                + 'data-position="wrap-right">';
            expect(render("<aside>\n\nSide **note**\n\n</aside>"))
                .toBe(`${wrapped}<p>Side <strong>note</strong></p></aside>`);
            expect(render("<aside>\n</aside>")).toBe(`${wrapped}\n</aside>`);
            expect(render('<aside data-position="center">\n\nIn the flow\n\n</aside>'))
                .toBe("<aside><p>In the flow</p></aside>");
            expect(render('<aside data-position="center">\n</aside>')).toBe("<aside>\n</aside>");
        });

        it("leaves an aside of raw text, one with attributes and an inline tag as written", () => {
            expect(render("<aside>\n💡 A Notion callout\n\n</aside>"))
                .toBe("<aside>\n💡 A Notion callout</aside>");
            expect(render('<aside class="note">\n\nBody\n\n</aside>'))
                .toBe('<aside class="note"><p>Body</p></aside>');
            expect(render("Inline <aside>x</aside> tag"))
                .toBe("<p>Inline <aside>x</aside> tag</p>");
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
            expect(html).toContain('<code>$x$</code>');
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

        it("leaves dollar amounts as literal text (#5682)", () => {
            expect(render("An Avg cost of $15. Components cost $6 and $4 each."))
                .toBe("<p>An Avg cost of $15. Components cost $6 and $4 each.</p>");
            expect(render("Split $5,$10 between them")).toBe("<p>Split $5,$10 between them</p>");

            const html = render("The $4,000 grows to $7,414.40 by the formula $FV = PV (1 + i)$.");
            expect(html).toContain("The $4,000 grows to $7,414.40 by the formula ");
            expect(html).toContain('<span class="math-tex">\\(FV = PV (1 + i)\\)</span>');
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

        it("keeps the dollars of a code block with a longer fence or a tilde fence", () => {
            const html = render([
                "````md", "```js", "a", "```", "$$x$$", "````", "", "~~~", "$a$", "~~~", "", "$b$"
            ].join("\n"));
            expect(html).toContain(">```js\na\n```\n$$x$$</code></pre>");
            expect(html).toContain(">$a$</code></pre>");
            expect(html).toContain('<span class="math-tex">\\(b\\)</span>');
            expect(html).not.toContain("FORMULA");
        });

        it("renders the same source the same way every time", () => {
            useTickingClock();
            // Indented code is not shielded, so the placeholder of its formula is rendered.
            const source = "$a$\n\n    $b$";
            expect(render(source)).toBe(render(source));
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

    describe("highlights (==text==)", () => {
        const HL = `<span style="${HIGHLIGHT_STYLE}">`;

        it("renders ==text== as a background-coloured span without any flag", () => {
            expect(render("==hi==")).toBe(`<p>${HL}hi</span></p>`);
            expect(render("==hi==", "", { obsidian: true })).toBe(`<p>${HL}hi</span></p>`);
        });

        it("parses inner markdown inside a highlight", () => {
            expect(render("==**bold**==")).toBe(`<p>${HL}<strong>bold</strong></span></p>`);
        });

        it("leaves ==== and spaced == as literal text", () => {
            expect(render("====")).toBe("<p>====</p>");
            expect(render("a == b")).toBe("<p>a == b</p>");
        });

        it("does not highlight == inside code", () => {
            expect(render("`==x==`")).toBe('<p><code>==x==</code></p>');
            expect(render("```\na ==x== b\n```")).toContain("a ==x== b");
        });

        it("leaves a setext heading underline alone", () => {
            expect(render("Title\n===", "", { demoteH1: false })).toBe("<h1>Title</h1>");
        });
    });

    describe("tabs blocks (MkDocs content tabs)", () => {
        const tab = (title: string, panel: string) =>
            `<section class="trilium-tab"><p class="trilium-tab-title">${title}</p>` +
            `<div class="trilium-tab-panel">${panel}</div></section>`;
        const tabs = (...items: string[]) => `<div class="trilium-tabs">${items.join("")}</div>`;

        it("groups consecutive tabs into one block and starts a new block at ===!", () => {
            const input = [
                "Before.",
                "=== \"Windows\"",
                "",
                "    Run the **installer**.",
                "",
                "=== \"**Linux** <span class=\"tn-icon bx bxl-tux\"></span>\"",
                "\t- One",
                "\t- Two",
                "===! \"Other\"",
                "    x",
                "",
                "After."
            ].join("\n");
            expect(render(input)).toBe(
                "<p>Before.</p>" +
                tabs(
                    tab("Windows", "<p>Run the <strong>installer</strong>.</p>"),
                    tab(
                        "<strong>Linux</strong> <span class=\"tn-icon bx bxl-tux\"></span>",
                        "<ul><li>One</li><li>Two</li></ul>"
                    )
                ) +
                tabs(tab("Other", "<p>x</p>")) +
                "<p>After.</p>"
            );
        });

        it("fills an empty title and an empty panel at the end of the input", () => {
            expect(render("=== \"\"")).toBe(tabs(tab("&nbsp;", "<p>&nbsp;</p>")));
        });

        it("leaves === without a quoted title to the other tokenizers", () => {
            expect(render("=== Title")).toBe("<p>=== Title</p>");
        });
    });

    describe("Obsidian syntax (obsidian option)", () => {
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

    it("reads quoted attribute values that hold < or >", () => {
        for (const h1 of [ `<h1 title="a<b">Title</h1>`, `<h1 title='a>b'>Title</h1>` ]) {
            expect(demoteHeadings(`${h1}<h2>A</h2>`, "Title", verbatim), h1).toBe("<h2>A</h2>");
        }
        expect(demoteHeadings(`<h1 title="a<b>c">Main</h1><h2>A</h2>`, "Title", verbatim))
            .toBe(`<h2 title="a<b>c">Main</h2><h3>A</h3>`);
    });

    it("applies the injected decoder to the demoted <h1> text and the title comparison only", () => {
        const upper = (s: string) => s.toUpperCase();
        // The decoder runs on the <h1> text but not on shifted sub-headings.
        expect(demoteHeadings("<h1>a</h1><h2>b</h2>", "Title", upper)).toBe("<h2>A</h2><h3>b</h3>");
        // The decoder is also used when comparing the first <h1> against the title.
        expect(demoteHeadings("<h1>a</h1>", "A", upper)).toBe("");
    });

    it("keeps an <h1> with a block id, to demote it with the rest", () => {
        const content = `<h1 data-trilium-block-id="t">Title</h1><h2>A</h2>`;
        expect(demoteHeadings(content, "Title", verbatim))
            .toBe(`<h2 data-trilium-block-id="t">Title</h2><h3>A</h3>`);
    });

    it("reads each unclosed <h1> only up to the next heading", () => {
        const unclosed = [ "<h1=", "<h1>a", `<h1 title="a`, `<h1 title='a` ];
        for (const content of unclosed.map((start) => start.repeat(40_000))) {
            const start = performance.now();
            expect(demoteHeadings(content, "Title", verbatim)).toBe(content);
            expect(performance.now() - start).toBeLessThan(500);
        }
    });
});

describe("block markers", () => {
    const marker = (id: string) => `<a data-trilium-block-id="${id}"></a>`;
    const preview = (content: string) => render(content, "", { demoteH1: false });

    it("puts the id of an inline marker on the block that holds it, as the editor saves it", () => {
        expect(preview(`A paragraph ${marker("p")}`))
            .toBe(`<p data-trilium-block-id="p">A paragraph</p>`);
        expect(preview(`## Heading ${marker("h")}`))
            .toBe(`<h2 data-trilium-block-id="h">Heading</h2>`);
        expect(preview(`&nbsp;${marker("e")}`)).toBe(`<p data-trilium-block-id="e">&nbsp;</p>`);
        expect(preview(`- parent ${marker("par")}\n    - child`)).toBe(
            `<ul><li><p data-trilium-block-id="par">parent</p><ul><li>child</li></ul></li></ul>`);
        expect(preview(`1. one\n2. two${marker("i2")}`))
            .toBe(`<ol><li>one</li><li><p data-trilium-block-id="i2">two</p></li></ol>`);
        const table = preview(`| A${marker("t")} | B |\n| --- | --- |\n| 1 | 2 |`);
        expect(table).toMatch(/^<figure class="table" data-trilium-block-id="t"><table>/);
        expect(table).toMatch(/<th>A<\/th>/);
        expect(preview(`${marker("f")}$$x^2$$`))
            .toBe(`<p data-trilium-block-id="f"><span class="math-tex">\\[x^2\\]</span></p>`);
        expect(preview(`*emphasis ${marker("em")}* and [link ${marker("l2")}](https://x)`)).toBe(
            `<p data-trilium-block-id="em"><em>emphasis </em> and `
            + `<a href="https://x">link </a></p>`);
    });

    it("writes the id of a to-do item on a paragraph after a label of its own", () => {
        expect(preview(`- [ ] open\n- [x] done ${marker("d")}`)).toBe(
            `<ul class="todo-list"><li><label class="todo-list__label">`
            + `<input type="checkbox" disabled="disabled">`
            + `<span class="todo-list__label__description">open</span></label></li>`
            + `<li><label class="todo-list__label todo-list__label_without-description">`
            + `<input type="checkbox" checked="checked" disabled="disabled"></label>`
            + `<p data-trilium-block-id="d">done</p></li></ul>`);
    });

    it("marks the next block of the same container with a marker alone on its line", () => {
        expect(preview(`${marker("c")}\n\n\`\`\`js\ncode();\n\`\`\``)).toBe(
            `<pre><code class="language-text-javascript" data-trilium-block-id="c">`
            + `code();</code></pre>`);
        expect(preview(`${marker("q")}\n\n> quoted\n> line${marker("ql")}`)).toBe(
            `<blockquote data-trilium-block-id="q">`
            + `<p data-trilium-block-id="ql">quoted\nline</p></blockquote>`);
        expect(preview(`${marker("r")}\n\n---`)).toBe(`<hr data-trilium-block-id="r">\n`);
        expect(preview(`${marker("l")}\n\n- first\n- second`))
            .toBe(`<ul><li><p data-trilium-block-id="l">first</p></li><li>second</li></ul>`);
        expect(preview(`> quote\n>\n> ${marker("in")}\n> after`))
            .toBe(`<blockquote><p>quote</p><p data-trilium-block-id="in">after</p></blockquote>`);
        expect(preview(`${marker("tabs")}\n\n=== "One${marker("t1")}"\n\n    Body`)).toBe(
            `<div class="trilium-tabs" data-trilium-block-id="tabs"><section class="trilium-tab" `
            + `data-trilium-block-id="t1"><p class="trilium-tab-title">One</p>`
            + `<div class="trilium-tab-panel"><p>Body</p></div></section></div>`);
    });

    it("cuts a paragraph before a marker line, which marks the block after it", () => {
        expect(preview(`Text\n${marker("next")}\n## Heading`))
            .toBe(`<p>Text</p><h2 data-trilium-block-id="next">Heading</h2>`);
        // A marker that only follows other text on its line is inline.
        expect(preview(`&nbsp;${marker("x")}\n\nafter`))
            .toBe(`<p data-trilium-block-id="x">&nbsp;</p><p>after</p>`);
    });

    it("takes the first valid marker line of several, and none before an empty item", () => {
        expect(preview(`${marker("a:b")}\n${marker("one")}\n${marker("two")}\n## Heading`))
            .toBe(`<h2 data-trilium-block-id="one">Heading</h2>`);
        expect(preview(`${marker("empty")}\n-\n- second`)).not.toContain("data-trilium-block-id");
    });

    it("uses up the id of a marker line before raw HTML and before an empty fence", () => {
        expect(preview(`${marker("raw")}\n<div>raw</div>\n\nafter`))
            .toBe("<div>raw</div><p>after</p>");
        expect(preview(`${marker("fence")}\n\n\`\`\`\n\`\`\`\n\nafter`)).toBe("<p>after</p>");
    });

    it("keeps the first marker of a block and drops the rest", () => {
        expect(preview(`${marker("line")}\n## Heading ${marker("inline")}`))
            .toBe(`<h2 data-trilium-block-id="line">Heading</h2>`);
        expect(preview(`Two ${marker("a")} markers ${marker("b")}`))
            .toBe(`<p data-trilium-block-id="a">Two  markers</p>`);
        expect(preview(`| A${marker("first")} | B${marker("second")} |\n| --- | --- |`))
            .toContain(`data-trilium-block-id="first"`);
    });

    it("reads the self-closed form, an opening tag alone and single quotes", () => {
        expect(preview(`<a data-trilium-block-id='s' />\n## Heading`))
            .toBe(`<h2 data-trilium-block-id="s">Heading</h2>`);
        expect(preview(`Open <a data-trilium-block-id="o"> tag https://example.com`)).toBe(
            `<p data-trilium-block-id="o">Open  tag `
            + `<a href="https://example.com">https://example.com</a></p>`);
        expect(preview(`<A DATA-TRILIUM-BLOCK-ID="u"></A> upper`))
            .toBe(`<p data-trilium-block-id="u"> upper</p>`);
    });

    it("decodes an id, validates it once decoded and escapes it for the attribute", () => {
        expect(preview(`Quote ${marker("a&#34;b")}`))
            .toBe(`<p data-trilium-block-id="a&quot;b">Quote</p>`);
        expect(preview(`Amp ${marker("a&#38;b")}`))
            .toBe(`<p data-trilium-block-id="a&amp;b">Amp</p>`);
        expect(preview(`Astral ${marker("&#128512;")}`))
            .toBe(`<p data-trilium-block-id="\u{1F600}">Astral</p>`);
        expect(preview(`Colon ${marker("a&#58;b")} rest`)).toBe("<p>Colon  rest</p>");
        expect(preview(`Range ${marker("a:b")} rest`)).toBe("<p>Range  rest</p>");
        expect(preview(`Huge ${marker("&#x110000;")} rest`)).toBe("<p>Huge  rest</p>");
        expect(preview(`Empty ${marker("")} rest`)).toBe("<p>Empty  rest</p>");
        // An invalid marker does not stop a later one.
        expect(preview(`${marker("a:b")} ${marker("ok")} text`))
            .toBe(`<p data-trilium-block-id="ok">  text</p>`);
    });

    it("leaves code alone and removes the markers that no block took", () => {
        expect(preview(`\`${marker("x")}\``))
            .toBe(`<p><code>&lt;a data-trilium-block-id=&quot;x&quot;&gt;&lt;/a&gt;</code></p>`);
        const split = `<a\n  data-trilium-block-id="split"\n></a>`;
        expect(preview(`<div>\n${marker("in")} raw\n${split}</div>`)).toBe("<div>\n raw\n</div>");
        const details = `<details data-trilium-block-id="d">\n<summary>More</summary>`;
        expect(preview(`${details}\n\nInside ${marker("i")}\n\n</details>`))
            .toBe(`${details}<p data-trilium-block-id="i">Inside</p></details>`);
    });

    it("keeps the callout of an admonition whose first paragraph has an id", () => {
        expect(preview(`> [!NOTE]\n> Body${marker("b")}`))
            .toBe(`<aside class="admonition note"><p data-trilium-block-id="b">Body</p></aside>`);
        expect(preview(`${marker("a")}\n\n> [!TIP]\n> Body`))
            .toBe(`<aside class="admonition tip" data-trilium-block-id="a"><p>Body</p></aside>`);
        expect(render(`> [!NOTE] Title ${marker("t")}\n>\n> Body`, "", { obsidian: true })).toBe(
            `<aside class="admonition note"><p data-trilium-block-id="t"><strong>Title</strong></p>`
            + `<p>Body</p></aside>`);
        expect(preview(`> [!NOTE] ${marker("gone")}\n>\n> Body`))
            .toBe(`<aside class="admonition note"><p>Body</p></aside>`);
    });

    it("takes the marker out of the raw text of an <h1>, which stays when it has an id", () => {
        expect(render(`# My note ${marker("t")}\n\nbody`, "My note"))
            .toBe(`<h2 data-trilium-block-id="t">My note</h2><p>body</p>`);
        expect(preview(`# Title ${marker("t")}`)).toBe(`<h1 data-trilium-block-id="t">Title</h1>`);
    });

    it("renders a note whose first heading holds a reference to no character", () => {
        expect(render("# &#x110000; &#xD800; &#0;\n\nbody", "Title"))
            .toBe("<h2>&#x110000; &#xD800; &#0;</h2><p>body</p>");
    });

    it("drops a marker after the last cell of a row, as marked drops the cell", () => {
        const table = preview(`| A | B |\n| --- | --- |\n| 1 | 2 | ${marker("x")}`);
        expect(table).toContain(`<figure class="table">`);
        expect(table).not.toContain("data-trilium-block-id");
    });

    it("renders footnotes in a note that starts with a marker line, as after a tabs block", () => {
        const footnotes = "\n\nText[^1]\n\n[^1]: Note";
        const marked = preview(`${marker("line")}\n## Heading ${marker("inline")}${footnotes}`);
        expect(marked).toContain(`<h2 data-trilium-block-id="line">Heading</h2>`);
        expect(marked).toContain("data-footnotes");
        expect(preview(`=== "Tab"\n\n    Body${footnotes}`)).toContain("data-footnotes");
    });
});

/** Makes each `Date.now()` of the test answer a later time than the one before. */
function useTickingClock() {
    let now = 0;
    const spy = vi.spyOn(Date, "now").mockImplementation(() => now++);
    onTestFinished(() => spy.mockRestore());
}
