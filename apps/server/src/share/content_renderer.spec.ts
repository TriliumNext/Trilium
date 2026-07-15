import { trimIndentation } from "@triliumnext/commons";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { buildShareNote, buildShareNotes } from "../test/shaca_mocking.js";
import { getContent, renderCode, type Result, shouldSyntaxHighlight } from "./content_renderer.js";

describe("content_renderer", () => {
    beforeAll(() => {
        vi.mock("../becca/becca_loader.js", () => ({
            default: {
                load: vi.fn(),
                loaded: Promise.resolve()
            }
        }));
    });

    it("Reports protected notes not being renderable", () => {
        const note = buildShareNote({ isProtected: true });
        const result = getContent(note);
        expect(result.content).toStrictEqual("<p>Protected note cannot be displayed</p>");
    });

    describe("Text note", () => {
        it("parses simple note", () => {
            const content = trimIndentation`\
                <figure class="image image-style-align-right image_resized" style="width:29.84%;">
                    <img style="aspect-ratio:150/150;" src="api/attachments/TnyuBzEXJZln/image/Trilium Demo_icon-color.svg" width="150" height="150">
                </figure>
                <p>
                    <strong>
                        Welcome to Trilium Notes!
                    </strong>
                </p>`;
            const note = buildShareNote({ content });
            const result = getContent(note);
            expect(result.content).toStrictEqual(content);
        });

        it("renders included notes", () => {
            buildShareNotes([
                { id: "subnote1", content: `<p>Foo</p><div>Bar</div>` },
                { id: "subnote2", content: `<strong>Baz</strong>` }
            ]);
            const note = buildShareNote({
                id: "note1",
                content: trimIndentation`\
                    <p>Before</p>
                    <section class="include-note" data-note-id="subnote1" data-box-size="small">&nbsp;</section>
                    <section class="include-note" data-note-id="subnote2" data-box-size="small">&nbsp;</section>
                    <p>After</p>
                `
            });
            const result = getContent(note);
            expect(result.content).toStrictEqual(trimIndentation`\
                <p>Before</p>
                <p>Foo</p><div>Bar</div>
                <strong>Baz</strong>
                <p>After</p>
            `);
        });

        it("renders only the first level of nested includes on the share view (nested include becomes a reference link)", () => {
            buildShareNote({ id: "nestC2", title: "Note C", content: "<p>C body</p>" });
            buildShareNote({
                id: "nestB2",
                title: "Note B",
                content: `<p>B body</p><section class="include-note" data-note-id="nestC2" data-box-size="medium">&nbsp;</section>`
            });
            const noteA = buildShareNote({
                id: "nestA2",
                content: `<p>A body</p><section class="include-note" data-note-id="nestB2" data-box-size="medium">&nbsp;</section>`
            });
            const result = getContent(noteA);
            if (typeof result.content !== "string") throw new Error("expected string content");
            // First level (B) expanded; second level (C) replaced with a reference link, not expanded.
            expect(result.content).toContain("B body");
            expect(result.content).not.toContain("C body");
            expect(result.content).toContain("reference-link");
            expect(result.content).toContain("Note C");
        });

        it("expands nested includes recursively when exporting (expandNestedIncludes)", () => {
            buildShareNote({ id: "expC", title: "Note C", content: "<p>C body</p>" });
            buildShareNote({
                id: "expB",
                content: `<p>B body</p><section class="include-note" data-note-id="expC" data-box-size="medium">&nbsp;</section>`
            });
            const noteA = buildShareNote({
                id: "expA",
                content: `<p>A body</p><section class="include-note" data-note-id="expB" data-box-size="medium">&nbsp;</section>`
            });
            const result = getContent(noteA, { expandNestedIncludes: true });
            if (typeof result.content !== "string") throw new Error("expected string content");
            expect(result.content).toContain("B body");
            expect(result.content).toContain("C body");
            expect(result.content).not.toContain("reference-link");
        });

        it("expands a note shared across sibling branches in each branch when exporting (not a false cycle)", () => {
            buildShareNote({ id: "dagD", title: "Note D", content: "<p>D body</p>" });
            buildShareNote({ id: "dagB", content: `<p>B body</p><section class="include-note" data-note-id="dagD" data-box-size="medium">&nbsp;</section>` });
            buildShareNote({ id: "dagC", content: `<p>C body</p><section class="include-note" data-note-id="dagD" data-box-size="medium">&nbsp;</section>` });
            const noteA = buildShareNote({
                id: "dagA",
                content: `<section class="include-note" data-note-id="dagB" data-box-size="medium">&nbsp;</section><section class="include-note" data-note-id="dagC" data-box-size="medium">&nbsp;</section>`
            });
            const result = getContent(noteA, { expandNestedIncludes: true });
            if (typeof result.content !== "string") throw new Error("expected string content");
            // Diamond A→{B,C}→D: D is not a cycle, so it expands in both branches.
            expect((result.content.match(/D body/g) ?? []).length).toBe(2);
            expect(result.content).not.toContain("reference-link");
        });

        it("does not loop on a circular include chain when expanding recursively", () => {
            buildShareNote({
                id: "cycB",
                content: `<p>B body</p><section class="include-note" data-note-id="cycA" data-box-size="medium">&nbsp;</section>`
            });
            const noteA = buildShareNote({
                id: "cycA",
                content: `<p>A body</p><section class="include-note" data-note-id="cycB" data-box-size="medium">&nbsp;</section>`
            });
            const result = getContent(noteA, { expandNestedIncludes: true });
            if (typeof result.content !== "string") throw new Error("expected string content");
            // A expands B; B's re-include of A is broken by the cycle guard (reference link), no hang.
            expect(result.content).toContain("A body");
            expect(result.content).toContain("B body");
            expect(result.content).toContain("reference-link");
        });

        it("leaves an include-note section untouched when the referenced note is missing", () => {
            const note = buildShareNote({
                id: "missingRefHost",
                content: `<p>host</p><section class="include-note" data-note-id="ghostNote" data-box-size="medium">&nbsp;</section>`
            });
            const result = getContent(note);
            if (typeof result.content !== "string") throw new Error("expected string content");
            // The missing note is skipped: the section stays, nothing is expanded or reference-linked.
            expect(result.content).toContain("host");
            expect(result.content).toContain(`data-note-id="ghostNote"`);
            expect(result.content).not.toContain("reference-link");
        });

        it("renders an included large code note without hanging or re-parsing it as HTML (#9717)", () => {
            // ~2 MiB of angle-bracket-heavy code that previously exploded node-html-parser.
            const codeLine = `const x: Array<Map<string, List<number>>> = a < b && c > d; // <div>\n`;
            const bigCode = codeLine.repeat(Math.ceil((2 * 1024 * 1024) / codeLine.length));
            buildShareNote({ id: "bigcode", type: "code", mime: "application/javascript", content: bigCode });
            const note = buildShareNote({
                id: "host",
                content: `<p>Before</p><section class="include-note" data-note-id="bigcode" data-box-size="medium">&nbsp;</section><p>After</p>`
            });

            const start = Date.now();
            const result = getContent(note);
            const elapsed = Date.now() - start;

            expect(elapsed).toBeLessThan(2000);
            if (typeof result.content !== "string") throw new Error("expected string content");
            // The code is escaped, not re-parsed into markup, and not highlighted (over the limit).
            expect(result.content).toContain("&lt;Map&lt;string");
            expect(result.content).not.toContain("hljs");
            expect(result.content).toContain("<p>Before</p>");
            expect(result.content).toContain("<p>After</p>");
        });

        it("handles syntax highlight for code blocks with escaped syntax", () => {
            const note = buildShareNote({
                id: "note",
                content: trimIndentation`\
                    <h2>
                        Defining the options
                    </h2>
                    <pre>
                    <code class="language-text-x-trilium-auto">&lt;t t-name="module.SectionWidthOption"&gt;
                    &lt;BuilderRow label.translate="Section Width"&gt;
                    &lt;/BuilderRow&gt;
                    &lt;/t&gt;</code>
                    </pre>
                `
            });
            const result = getContent(note);
            expect(result.content).toStrictEqual(trimIndentation`\
                <h2>
                    Defining the options
                </h2>
                <pre>
                <code class="language-text-x-trilium-auto hljs"><span class="hljs-tag">&lt;<span class="hljs-name">t</span> <span class="hljs-attr">t-name</span>=<span class="hljs-string">&quot;module.SectionWidthOption&quot;</span>&gt;</span>
                <span class="hljs-tag">&lt;<span class="hljs-name">BuilderRow</span> <span class="hljs-attr">label.translate</span>=<span class="hljs-string">&quot;Section Width&quot;</span>&gt;</span>
                <span class="hljs-tag">&lt;/<span class="hljs-name">BuilderRow</span>&gt;</span>
                <span class="hljs-tag">&lt;/<span class="hljs-name">t</span>&gt;</span></code>
                </pre>
            `);
        });

        describe("Reference links", () => {
            it("handles attachment link", () => {
                const content = trimIndentation`\
                    <h1>Test</h1>
                    <p>
                        <a class="reference-link" href="#root/iwTmeWnqBG5Q?viewMode=attachments&amp;attachmentId=q14s2Id7V6pp">
                            5863845791835102555.mp4
                        </a>
                        &nbsp;
                    </p>
                `;
                const note = buildShareNote({
                    content,
                    attachments: [ { id: "q14s2Id7V6pp", title: "5863845791835102555.mp4" } ]
                });
                const result = getContent(note);
                expect(result.content).toStrictEqual(trimIndentation`\
                    <h1>Test</h1>
                    <p>
                        <a class="reference-link attachment-link role-file" href="api/attachments/q14s2Id7V6pp/download"><span><span class="tn-icon bx bx-download"></span>5863845791835102555.mp4</span></a>
                        &nbsp;
                    </p>
                `);
            });

            it("handles protected notes", () => {
                buildShareNote({
                    id: "MSkxxCFbBsYP",
                    title: "Foo",
                    isProtected: true
                });
                const note = buildShareNote({
                    id: "note",
                    content: trimIndentation`\
                        <p>
                            <a class="reference-link" href="#root/zaIItd4TM5Ly/MSkxxCFbBsYP">
                                Foo
                            </a>
                        </p>
                    `
                });
                const result = getContent(note);
                expect(result.content).toStrictEqual(trimIndentation`\
                    <p>
                        <a class="reference-link type-text" href="./MSkxxCFbBsYP">[protected]</a>
                    </p>
                `);
            });

            it("handles missing notes", () => {
                const note = buildShareNote({
                    id: "note",
                    content: trimIndentation`\
                        <p>
                            <a class="reference-link" href="#root/zaIItd4TM5Ly/AsKxyCFbBsYp">
                                Foo
                            </a>
                        </p>
                    `
                });
                const result = getContent(note);
                const content = (result.content as string).replaceAll(/\s/g, "");
                expect(content).toStrictEqual("<p>Foo</p>");
            });

            it("properly escapes note title", () => {
                buildShareNote({
                    id: "MSkxxCFbBsYP",
                    title: "The quick <strong>brown</strong> fox"
                });
                const note = buildShareNote({
                    id: "note",
                    content: trimIndentation`\
                        <p>
                            <a class="reference-link" href="#root/zaIItd4TM5Ly/MSkxxCFbBsYP">
                            Hi
                            </a>
                        </p>
                    `
                });
                const result = getContent(note);
                expect(result.content).toStrictEqual(trimIndentation`\
                    <p>
                        <a class="reference-link type-text" href="./MSkxxCFbBsYP"><span><span class="tn-icon bx bx-note"></span>The quick &lt;strong&gt;brown&lt;/strong&gt; fox</span></a>
                    </p>
                `);
            });
        });
    });

    describe("Link previews", () => {
        const FAVICON = "data:image/png;base64,AAA";

        it("renders a card, showing the stored favicon beside the site name", () => {
            const note = buildShareNote({
                content: `<section class="link-embed" data-url="https://example.com/page" data-embed-type="opengraph"`
                    + ` data-title="A title" data-description="A description" data-site-name="Example"`
                    + ` data-favicon="${FAVICON}" data-image="data:image/jpeg;base64,BBB"></section>`
            });

            const content = String(getContent(note).content);
            expect(content).toContain(`<div class="link-embed-card-url">`
                + `<img class="link-embed-mention-favicon" src="${FAVICON}" width="16" height="16">`
                + `<span>Example</span></div>`);
        });

        it("falls back to a dot when the site has no favicon", () => {
            const note = buildShareNote({
                content: `<section class="link-embed" data-url="https://example.com/page" data-embed-type="opengraph" data-title="A title"></section>`
            });

            const content = String(getContent(note).content);
            expect(content).toContain(`<div class="link-embed-card-url"><span class="link-embed-mention-dot"></span><span>example.com</span></div>`);
        });

        it("renders a video as a click-to-play facade, without contacting YouTube", () => {
            const note = buildShareNote({
                content: `<section class="link-embed" data-url="https://www.youtube.com/watch?v=dQw4w9WgXcQ"`
                    + ` data-embed-type="youtube" data-title="A video" data-image="data:image/jpeg;base64,BBB"></section>`
            });

            const content = String(getContent(note).content);
            // A visitor who merely reads the page sends nothing to YouTube: no iframe, just the
            // thumbnail already stored in the note. The theme's script swaps in the player on click.
            expect(content).not.toContain("<iframe");
            expect(content).not.toContain("youtube-nocookie.com");
            expect(content).toContain(`<button type="button" class="link-embed-video-facade" data-video-id="dQw4w9WgXcQ"`);
            expect(content).toContain(`<img class="link-embed-video-thumbnail" src="data:image/jpeg;base64,BBB"`);
        });

        it("neuters a hostile scheme in the stored URL, on a page served to anyone", () => {
            // `data-*` values pass through the save-time sanitizer verbatim, so a note that arrives
            // by import, ETAPI or sync can carry `data-url="javascript:…"`. It must not become a
            // live link on the public share page.
            const note = buildShareNote({
                content: `<section class="link-embed" data-url="javascript:alert(document.cookie)" data-embed-type="opengraph" data-title="Evil"></section>`
                    + `<p><span class="link-mention" data-url="javascript:alert(1)" data-title="Evil"></span></p>`
            });

            const content = String(getContent(note).content);
            // The element keeps its inert data-url attribute — nothing reads it on the shared page —
            // but no href points at the payload.
            expect(content).not.toContain(`href="javascript:`);
            expect(content).toContain(`<a class="link-embed-card" href="about:blank"`);
            expect(content).toContain(`<a class="link-embed-mention" href="about:blank"`);
        });

        it("renders an inline mention with the same favicon markup", () => {
            const note = buildShareNote({
                content: `<p><span class="link-mention" data-url="https://example.com/page" data-title="A title" data-favicon="${FAVICON}"></span></p>`
            });

            const content = String(getContent(note).content);
            expect(content).toContain(`<img class="link-embed-mention-favicon" src="${FAVICON}" width="16" height="16">`);
            expect(content).toContain(`<span class="link-embed-mention-title">A title</span>`);
        });
    });

    describe("renderCode", () => {
        it("identifies empty content", () => {
            const emptyResult: Result = {
                header: "",
                content: "   "
            };
            renderCode(emptyResult);
            expect(emptyResult.isEmpty).toBeTruthy();
        });

        it("identifies unsupported content type", () => {
            const emptyResult: Result = {
                header: "",
                content: Buffer.from("Hello world")
            };
            renderCode(emptyResult);
            expect(emptyResult.isEmpty).toBeTruthy();
        });

        it("wraps code in <pre><code>", () => {
            const result: Result = {
                header: "",
                content: "\tHello\nworld"
            };
            renderCode(result);
            expect(result.isEmpty).toBeFalsy();
            expect(result.content).toBe("<pre><code>\tHello\nworld</code></pre>");
        });

        it("escapes HTML-significant characters so the content cannot be re-parsed as markup", () => {
            const result: Result = {
                header: "",
                content: `const x: Array<Map<string, number>> = a < b && c > d; // <div>`
            };
            renderCode(result);
            expect(result.content).toBe(`<pre><code>const x: Array&lt;Map&lt;string, number&gt;&gt; = a &lt; b &amp;&amp; c &gt; d; // &lt;div&gt;</code></pre>`);
        });
    });

    describe("shouldSyntaxHighlight", () => {
        it("allows small code blocks", () => {
            expect(shouldSyntaxHighlight("a\nb\nc")).toBe(true);
            expect(shouldSyntaxHighlight("")).toBe(true);
        });

        it("rejects code blocks beyond the line limit", () => {
            expect(shouldSyntaxHighlight(Array(500).fill("x").join("\n"))).toBe(true);
            expect(shouldSyntaxHighlight(Array(501).fill("x").join("\n"))).toBe(false);
        });

        it("rejects a single huge line that stays under the line limit", () => {
            // No newlines, so the line check never trips — the character ceiling must catch it.
            expect(shouldSyntaxHighlight("x".repeat(50_000))).toBe(true);
            expect(shouldSyntaxHighlight("x".repeat(50_001))).toBe(false);
        });
    });
});
