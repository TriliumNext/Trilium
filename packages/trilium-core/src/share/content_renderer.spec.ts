import { trimIndentation } from "@triliumnext/commons";
import {
    getChildLinks, getHtmlSnippets, getPageHead, getPrevNextLinks, getSiteLogo
} from "@triliumnext/share-theme/model/page";
import ejs from "ejs";
import { parse } from "node-html-parser";
import { describe, expect, it, vi } from "vitest";

import options from "../services/options.js";
import * as sanitize from "../services/sanitizer.js";
import * as utils from "../services/utils/index.js";
import { buildShareNote, buildShareNotes } from "../test/shaca_mocking.js";
import {
    ensureShareHighlighting, getContent, preparePageContent, readShareTemplate, renderCode,
    renderNoteContent, type Result
} from "./content_renderer.js";
import type SNote from "./shaca/entities/snote.js";
import shaca from "./shaca/shaca.js";
import shareRoot from "./share_root.js";

vi.mock("../becca/becca_loader.js", () => ({
    default: {
        load: vi.fn(),
        loaded: Promise.resolve()
    }
}));

describe("content_renderer", () => {
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

        it("renders embedded notes", () => {
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
                <section class="include-note" data-note-id="subnote1" data-box-size="small"><p>Foo</p><div>Bar</div></section>
                <section class="include-note" data-note-id="subnote2" data-box-size="small"><strong>Baz</strong></section>
                <p>After</p>
            `);
        });

        it("keeps the caption of an embed under its content", () => {
            buildShareNotes([ { id: "subnote1", content: `<p>Foo</p>` } ]);
            const note = buildShareNote({
                id: "note1",
                content: `<figure class="include-note" data-note-id="subnote1"`
                    + ` data-box-size="medium"><figcaption>A <strong>caption</strong></figcaption>`
                    + `</figure>`
            });

            expect(getContent(note).content).toStrictEqual(
                `<figure class="include-note" data-note-id="subnote1" data-box-size="medium">`
                + `<p>Foo</p><figcaption>A <strong>caption</strong></figcaption></figure>`
            );
        });

        it("renders a Tiny embed as a link, without the content it shows", () => {
            buildShareNotes([
                { id: "tinyNote1", title: "Tiny note", content: "<p>Not rendered</p>" }
            ]);
            const note = buildShareNote({
                content: `<figure class="include-note" data-note-id="tinyNote1"`
                    + ` data-box-size="tiny"><figcaption>Tiny caption</figcaption></figure>`
                    + `<figure class="include-note" data-attachment-id="tinyPic1"`
                    + ` data-box-size="tiny"></figure>`,
                attachments: [
                    { id: "tinyPic1", role: "image", mime: "image/png", title: "my photo.png" }
                ]
            });
            const tinyNote = shaca.getNote("tinyNote1");
            if (!tinyNote) throw new Error("Expected the embedded note.");
            const getNoteContent = vi.spyOn(tinyNote, "getContent");

            const content = getContent(note).content as string;

            expect(getNoteContent).not.toHaveBeenCalled();
            expect(content).not.toContain("include-note");
            expect(content).not.toContain("Not rendered");
            expect(content).not.toContain("Tiny caption");
            expect(content).not.toContain("<img");
            expect(content).toContain("reference-link");
            expect(content).toContain("Tiny note");
            expect(content).toContain(`href="api/attachments/tinyPic1/download"`);
        });

        it("renders only the first level of nested embeds on the share view (nested embed becomes a reference link)", () => {
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

        it("expands nested embeds recursively when exporting (expandNestedEmbeds)", () => {
            buildShareNote({ id: "expC", title: "Note C", content: "<p>C body</p>" });
            buildShareNote({
                id: "expB",
                content: `<p>B body</p><section class="include-note" data-note-id="expC" data-box-size="medium">&nbsp;</section>`
            });
            const noteA = buildShareNote({
                id: "expA",
                content: `<p>A body</p><section class="include-note" data-note-id="expB" data-box-size="medium">&nbsp;</section>`
            });
            const result = getContent(noteA, { expandNestedEmbeds: true });
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
            const result = getContent(noteA, { expandNestedEmbeds: true });
            if (typeof result.content !== "string") throw new Error("expected string content");
            // Diamond A→{B,C}→D: D is not a cycle, so it expands in both branches.
            expect((result.content.match(/D body/g) ?? []).length).toBe(2);
            expect(result.content).not.toContain("reference-link");
        });

        it("does not loop on a circular embed chain when expanding recursively", () => {
            buildShareNote({
                id: "cycB",
                content: `<p>B body</p><section class="include-note" data-note-id="cycA" data-box-size="medium">&nbsp;</section>`
            });
            const noteA = buildShareNote({
                id: "cycA",
                content: `<p>A body</p><section class="include-note" data-note-id="cycB" data-box-size="medium">&nbsp;</section>`
            });
            const result = getContent(noteA, { expandNestedEmbeds: true });
            if (typeof result.content !== "string") throw new Error("expected string content");
            // A expands B; B's re-embed of A is broken by the cycle guard (reference link), no hang.
            expect(result.content).toContain("A body");
            expect(result.content).toContain("B body");
            expect(result.content).toContain("reference-link");
        });

        it("renders only the referenced blocks of an embedded note, or a broken reference", () => {
            const blockEmbed = (block: string) => `<figure class="include-note"`
                + ` data-note-id="blkSrc" data-block="${block}" data-box-size="medium"></figure>`;
            buildShareNote({
                id: "blkSrc",
                content: `<p>Intro</p><ol><li>One</li><li data-trilium-block-id="b1">Two</li>`
                    + `<li data-trilium-block-id="b2">Three</li><li>Four</li></ol><p>Outro</p>`
            });
            const note = buildShareNote({ content: blockEmbed("b2:b1") + blockEmbed("b1:gone") });

            const content = getContent(note).content as string;

            expect(content).toContain(`<ol start="2"><li data-trilium-block-id="b1">Two</li>`
                + `<li data-trilium-block-id="b2">Three</li></ol>`);
            expect(content).not.toMatch(/Intro|One|Four|Outro/);
            expect(content).toContain(`<p class="block-reference-broken">`);
        });

        it("embeds blocks of the note itself, and links to blocks one level down", () => {
            const note = buildShareNote({
                id: "blkSelf",
                title: "Self",
                content: `<p data-trilium-block-id="top">Top</p>`
                    + `<figure class="include-note" data-note-id="blkSelf" data-block="top"`
                    + ` data-box-size="medium"></figure>`
            });

            const content = getContent(note).content as string;
            const nested = getContent(note, { embedsAsReferenceLinks: true }).content as string;

            expect(content.match(/Top/g)).toHaveLength(2);
            expect(nested).toContain(`href="./blkSelf"`);
            expect(nested).not.toContain("include-note");
        });

        it("replaces an embed of a shareCredentials-protected note with a placeholder when the caller lacks access", () => {
            buildShareNote({
                id: "credSecret",
                title: "Quarterly figures",
                content: "<p>secret body</p>",
                "#shareCredentials": "viewer:secretpass"
            });
            const host = buildShareNote({
                id: "credHost",
                content: `<p>public</p><section class="include-note" data-note-id="credSecret" data-box-size="medium">&nbsp;</section>`
            });

            const denied = getContent(host, { canAccessEmbed: (note) => note.getCredentials().length === 0 });
            if (typeof denied.content !== "string") throw new Error("expected string content");
            expect(denied.content).toContain("public");
            expect(denied.content).not.toContain("secret body");
            // The title is withheld as well: an embedded note need not be visible in the share tree.
            expect(denied.content).not.toContain("Quarterly figures");
            expect(denied.content).toContain("include-note-forbidden");

            const allowed = getContent(host, { canAccessEmbed: () => true });
            if (typeof allowed.content !== "string") throw new Error("expected string content");
            expect(allowed.content).toContain("secret body");
        });

        it("applies the embed access check at every nesting level and to the reference-link fallback", () => {
            buildShareNote({
                id: "credDeep",
                title: "Deep secret",
                content: "<p>deep body</p>",
                "#shareCredentials": "viewer:secretpass"
            });
            buildShareNote({
                id: "credMiddle",
                content: `<p>middle body</p><section class="include-note" data-note-id="credDeep" data-box-size="medium">&nbsp;</section>`
            });
            const host = buildShareNote({
                id: "credOuter",
                content: `<section class="include-note" data-note-id="credMiddle" data-box-size="medium">&nbsp;</section>`
            });
            const canAccessEmbed = (note: SNote) => note.getCredentials().length === 0;

            // Live share view: the second level would degrade to a reference link, which must not
            // leak the protected note's title either.
            const shareView = getContent(host, { canAccessEmbed });
            if (typeof shareView.content !== "string") throw new Error("expected string content");
            expect(shareView.content).toContain("middle body");
            expect(shareView.content).not.toContain("deep body");
            expect(shareView.content).not.toContain("Deep secret");
            expect(shareView.content).not.toContain("reference-link");

            // Recursive expansion carries the check down with it.
            const expanded = getContent(host, { expandNestedEmbeds: true, canAccessEmbed });
            if (typeof expanded.content !== "string") throw new Error("expected string content");
            expect(expanded.content).toContain("middle body");
            expect(expanded.content).not.toContain("deep body");
        });

        it("carries the share route's credential check into the rendered page (renderNoteContent)", () => {
            buildShareNote({
                id: "credPageSecret",
                title: "Page secret",
                content: "<p>page secret body</p>",
                "#shareCredentials": "viewer:secretpass"
            });
            const shareRootNote = buildShareNote({
                id: shareRoot.SHARE_ROOT_NOTE_ID,
                children: [{
                    id: "credPageHost",
                    content: `<p>page host body</p><section class="include-note" data-note-id="credPageSecret" data-box-size="medium">&nbsp;</section>`
                }]
            });
            const host = shareRootNote.getChildNotes()[0];

            const page = renderNoteContent(host, (note) => note.getCredentials().length === 0);
            if (typeof page !== "string") throw new Error("expected string content");
            expect(page).toContain("page host body");
            expect(page).not.toContain("page secret body");
        });

        it("gives a referenced heading a table of contents anchor, as any other heading", () => {
            const shareRootNote = buildShareNote({
                id: shareRoot.SHARE_ROOT_NOTE_ID,
                children: [{
                    id: "tocBlockHost",
                    content: `<h2>Plain</h2><p>a</p>`
                        + `<h3 data-trilium-block-id="b1">Referenced</h3><p>b</p>`
                }]
            });

            const page = renderNoteContent(shareRootNote.getChildNotes()[0]);

            expect(page).toContain(`<h3 data-trilium-block-id="b1">Referenced`
                + `<a id="referenced" class="toc-anchor"`);
            expect(page).toContain(`href="#referenced"`);

            const toc = parse(String(page)).querySelector("#toc");
            expect(toc?.querySelectorAll(":scope > li > a").map((link) => link.text.trim()))
                .toStrictEqual([ "Plain" ]);
            expect(toc?.querySelector("li li a")?.getAttribute("href")).toBe("#referenced");
        });

        it("links a page to the pages before and after it in the site", () => {
            const shareRootNote = buildShareNote({
                id: shareRoot.SHARE_ROOT_NOTE_ID,
                children: [{
                    id: "navSite",
                    title: "Site",
                    children: [
                        { id: "navFirst", title: "First", content: "<p>1</p>" },
                        { id: "navSecond", title: "Second", content: "<p>2</p>" }
                    ]
                }]
            });

            const page = parse(String(renderNoteContent(
                shareRootNote.getChildNotes()[0].getChildNotes()[0])));

            expect(page.querySelector(".navigation .previous")?.getAttribute("href")).toBe("./navSite");
            expect(page.querySelector(".navigation .next")?.text).toBe("Second");
        });

        it("anchors a heading spanning lines and lists it in the table of contents", () => {
            const shareRootNote = buildShareNote({
                id: shareRoot.SHARE_ROOT_NOTE_ID,
                children: [{
                    id: "multilineHeadings",
                    content: `<h2>First</h2><p>a</p><h2>Spans\n    two lines</h2><p>b</p>`
                }]
            });

            const page = parse(String(renderNoteContent(shareRootNote.getChildNotes()[0])));

            expect(page.querySelector("#content h2:last-of-type .toc-anchor")?.id)
                .toBe("spans-two-lines");
            expect(page.querySelectorAll("#toc a").map((link) => [
                link.getAttribute("href"), link.text.trim()
            ])).toStrictEqual([
                [ "#first", "First" ],
                [ "#spans-two-lines", "Spans two lines" ]
            ]);
        });

        it("prints only the OpenGraph tags that have a value, with an absolute image", () => {
            const shareRootNote = buildShareNote({
                id: shareRoot.SHARE_ROOT_NOTE_ID,
                children: [
                    { id: "plainSite", title: "Plain", content: "<p>a</p>" },
                    {
                        "id": "previewSite",
                        "title": "Preview",
                        "content": "<p>b</p>",
                        "#shareOpenGraphURL": "https://example.com/share/previewSite",
                        "~shareOpenGraphImage": "plainSite"
                    }
                ]
            });
            const [ plainSite, previewSite ] = shareRootNote.getChildNotes();
            const metaTags = (note: SNote) => parse(String(renderNoteContent(note)))
                .querySelectorAll("head meta[content]")
                .map((meta) => [ meta.getAttribute("property") ?? meta.getAttribute("name"),
                    meta.getAttribute("content") ])
                .filter(([ name ]) => name !== "viewport");

            expect(metaTags(plainSite).filter(([ , content ]) => !content)).toStrictEqual([]);
            expect(metaTags(plainSite)).toStrictEqual([
                [ "og:type", "website" ],
                [ "og:title", "Plain" ],
                [ "twitter:card", "summary" ],
                [ "twitter:title", "Plain" ]
            ]);
            expect(metaTags(previewSite)).toEqual(expect.arrayContaining([
                [ "og:url", "https://example.com/share/previewSite" ],
                [ "og:image", "https://example.com/share/api/images/plainSite/image.png" ],
                [ "twitter:card", "summary_large_image" ]
            ]));
        });

        it("keeps the alt text of an image on the page", () => {
            const shareRootNote = buildShareNote({
                id: shareRoot.SHARE_ROOT_NOTE_ID,
                children: [{
                    id: "altPage",
                    content: `<p><img src="chart.png" alt="Chart"></p><p><img src="plain.png"></p>`
                }]
            });

            const page = String(renderNoteContent(shareRootNote.getChildNotes()[0]));

            expect(page).not.toMatch(/<img[^>]*\salt=[^>]*\salt=/);
            expect(page).toContain(`<img src="chart.png" alt="Chart" loading="lazy">`);
            expect(page).toMatch(/<img src="plain.png" alt="[^"]+" loading="lazy">/);
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

        it("renders an embedded large code note without hanging or re-parsing it as HTML (#9717)", () => {
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

            // Generous budget: the pre-fix path was effectively unbounded, and CI runs this
            // under V8 coverage with several forked workers, where 2s was at the noise floor.
            expect(elapsed).toBeLessThan(15_000);
            if (typeof result.content !== "string") throw new Error("expected string content");
            // The code is escaped, not re-parsed into markup, and not highlighted (over the limit).
            expect(result.content).toContain("&lt;Map&lt;string");
            expect(result.content).not.toContain("hljs");
            expect(result.content).toContain("<p>Before</p>");
            expect(result.content).toContain("<p>After</p>");
        });

        it("handles syntax highlight for code blocks with escaped syntax", async () => {
            await ensureShareHighlighting();
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

        it("highlights a code block in the language it declares", async () => {
            await ensureShareHighlighting();
            const xml = "&lt;t t-name=&quot;x&quot;&gt;&lt;/t&gt;";
            // text-x-cobol is not enabled by default, so it is never registered.
            const languages = [
                "text-x-python", "text-plain", "text-x-cobol", "text-x-trilium-auto"
            ];
            const note = buildShareNote({
                content: languages
                    .map((lang) => `<pre><code class="language-${lang}">${xml}</code></pre>`)
                    .join("")
            });

            const result = getContent(note);
            if (typeof result.content !== "string") throw new Error("expected string content");
            const [ python, plain, cobol, auto ] = parse(result.content, { blockTextElements: {} })
                .querySelectorAll("code");
            expect(python.classList.contains("hljs")).toBe(true);
            expect(python.innerHTML).toContain("hljs-string");
            expect(python.innerHTML).not.toContain("hljs-tag");
            expect(plain.innerHTML).toBe(xml);
            expect(cobol.innerHTML).toBe(xml);
            expect(auto.innerHTML).toContain("hljs-tag");
        });

        it("highlights an embedded code note in its own language", async () => {
            await ensureShareHighlighting();
            buildShareNotes([
                { id: "pycode", type: "code", mime: "text/x-python", content: `<t t-name="x"></t>` }
            ]);
            const note = buildShareNote({
                content: '<section class="include-note" data-note-id="pycode" '
                    + 'data-box-size="medium">&nbsp;</section>'
            });

            const result = getContent(note);
            if (typeof result.content !== "string") throw new Error("expected string content");
            const code = parse(result.content, { blockTextElements: {} }).querySelector("code");
            expect(code?.classList.contains("language-text-x-python")).toBe(true);
            expect(code?.innerHTML).toContain("hljs-string");
            expect(code?.innerHTML).not.toContain("hljs-tag");
        });

        it("renders an embedded picture as an image, any other attachment as a download", () => {
            const embed = (id: string) =>
                `<section class="include-note" data-attachment-id="${id}">&nbsp;</section>`;
            const note = buildShareNote({
                content: embed("embedPic1") + embed("embedPdf1") + embed("embedGone"),
                attachments: [
                    { id: "embedPic1", role: "image", mime: "image/png", title: "my photo.png" },
                    { id: "embedPdf1", role: "file", mime: "application/pdf", title: "report.pdf" }
                ]
            });

            const content = getContent(note).content as string;

            const src = "api/attachments/embedPic1/image/my%20photo.png";
            expect(content).toContain(`<section class="include-note" data-attachment-id="embedPic1">`
                + `<img src="${src}" alt="my photo.png"></section>`);
            expect(content).toContain(`<section class="include-note" data-attachment-id="embedPdf1">`
                + `<a class="reference-link attachment-link role-file"`);
            expect(content).toContain(`href="api/attachments/embedPdf1/download"`);
            expect(content).toContain("report.pdf");
            expect(content).not.toContain("embedGone");
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

            it("does not treat an external URL's query string as a note ID", () => {
                const target = buildShareNote({ id: "extIdTarget1", title: "Target" });
                const href = `https://example.com/${target.noteId}?x=1`;
                const note = buildShareNote({
                    id: "note",
                    content: `<p><a class="reference-link" href="${href}">text</a></p>`
                });
                const result = getContent(note);
                expect(result.content).toStrictEqual("<p>text</p>");
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

            it("keeps a reference link whose target has a shareAlias or shareExternalLink", () => {
                buildShareNote({ id: "aliasTarget01", title: "Linux", "#shareAlias": "linux" });
                buildShareNote({
                    id: "extTarget0001",
                    title: "Ext",
                    "#shareExternalLink": "https://example.com/some/page"
                });
                const note = buildShareNote({
                    id: "note",
                    content: trimIndentation`\
                        <p>
                            <a class="reference-link" href="#root/zaIItd4TM5Ly/aliasTarget01">
                                Old title
                            </a>
                            <a class="reference-link" href="#root/extTarget0001?viewMode=source">
                                Old
                            </a>
                        </p>
                    `
                });
                const result = getContent(note);
                const links = parse(String(result.content)).querySelectorAll("a.reference-link");
                expect(links).toHaveLength(2);

                const [ aliasLink, externalLink ] = links;
                expect(aliasLink.getAttribute("href")).toBe("./linux");
                expect(aliasLink.classList.contains("type-text")).toBe(true);
                expect(aliasLink.querySelector("span.tn-icon")).not.toBeNull();
                expect(aliasLink.text).toBe("Linux");

                expect(externalLink.getAttribute("href")).toBe("https://example.com/some/page");
                expect(externalLink.getAttribute("target")).toBe("_blank");
                expect(externalLink.getAttribute("rel")).toBe("noopener noreferrer");
                expect(externalLink.text).toBe("Ext");
            });

            it("replaces a reference link to a missing attachment with its text", () => {
                buildShareNote({ id: "attachOwner01", title: "Owner" });
                const href = "#root/attachOwner01?viewMode=attachments&amp;attachmentId=missing01";
                const note = buildShareNote({
                    id: "note",
                    content: `<p><a class="reference-link" href="${href}">clip.mp4</a></p>`
                });
                const result = getContent(note);
                expect(result.content).toStrictEqual("<p>clip.mp4</p>");
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
                + `<img class="link-embed-mention-favicon" src="${FAVICON}" alt="" loading="lazy" draggable="false" width="16" height="16">`
                + `<span>Example</span></div>`);
        });

        it("shows the site name alone when the site has no favicon", () => {
            const note = buildShareNote({
                content: `<section class="link-embed" data-url="https://example.com/page" data-embed-type="opengraph" data-title="A title"></section>`
            });

            const content = String(getContent(note).content);
            expect(content).toContain(`<div class="link-embed-card-url"><span>example.com</span></div>`);
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

        it("keeps a stored attachment reference, which is served from this instance", () => {
            const note = buildShareNote({
                content: `<section class="link-embed" data-url="https://example.com/page" data-embed-type="opengraph"`
                    + ` data-title="A title" data-image="api/attachments/abc123/image/preview.png"></section>`
            });

            const content = String(getContent(note).content);
            expect(content).toContain(`<img class="link-embed-card-image" src="api/attachments/abc123/image/preview.png"`);
        });

        it("drops a remote favicon/image rather than have every visitor fetch it", () => {
            // Same route in as the hostile `data-url` above: `data-*` survives the sanitizer, so a
            // note from import, ETAPI or sync can name any URL here. An <img> needs no click, so
            // leaving it in place would announce every visitor to whoever it points at — and the
            // metadata pipeline only ever stores an inline image or an attachment, so a remote URL
            // is illegitimate by construction.
            const note = buildShareNote({
                content: `<section class="link-embed" data-url="https://example.com/page" data-embed-type="opengraph"`
                    + ` data-title="A title" data-favicon="http://169.254.169.254/latest/meta-data/"`
                    + ` data-image="https://tracker.test/pixel.gif"></section>`
                    + `<section class="link-embed" data-url="https://www.youtube.com/watch?v=dQw4w9WgXcQ"`
                    + ` data-embed-type="youtube" data-image="https://tracker.test/thumb.jpg"></section>`
                    + `<p><span class="link-mention" data-url="https://example.com/page" data-title="A title"`
                    + ` data-favicon="https://tracker.test/favicon.ico"></span></p>`
            });

            const content = String(getContent(note).content);
            // As with the hostile data-url above, the element keeps its inert attribute — no browser
            // fetches a `data-favicon` — but nothing reaches an `src`, which is what would be fetched.
            expect(content).not.toContain(`src="http://169.254.169.254`);
            expect(content).not.toContain(`src="https://tracker.test`);
            // Each sink degrades to what it already shows for a preview that has no such picture:
            // the card keeps a placeholder in the hole its cover would fill, the favicon simply goes.
            expect(content).not.toContain(`class="link-embed-mention-favicon"`);
            expect(content).toContain(`<a class="link-embed-mention" href="https://example.com/page" target="_blank" rel="noopener noreferrer">`
                + `<span class="link-embed-mention-title">A title</span></a>`);
            expect(content).toContain(`<div class="link-embed-card-image-placeholder">`);
            expect(content).not.toContain(`class="link-embed-video-thumbnail"`);
        });

        it("renders an inline mention with the same favicon markup", () => {
            const note = buildShareNote({
                content: `<p><span class="link-mention" data-url="https://example.com/page" data-title="A title" data-favicon="${FAVICON}"></span></p>`
            });

            const content = String(getContent(note).content);
            expect(content).toContain(`<img class="link-embed-mention-favicon" src="${FAVICON}" alt="" loading="lazy" draggable="false" width="16" height="16">`);
            expect(content).toContain(`<span class="link-embed-mention-title">A title</span>`);
        });
    });

    describe("Mermaid note", () => {
        it("shows the saved image and keeps the source for the share theme to draw", () => {
            const note = buildShareNote({
                id: "mermaidNote",
                type: "mermaid",
                mime: "text/vnd.mermaid",
                content: "graph TD; A-->B[<script>]"
            });
            const root = parse(String(getContent(note).content));
            const container = root.querySelector("div.mermaid-note");

            expect(container?.querySelector("img.mermaid-note-image")?.getAttribute("src"))
                .toMatch(/^api\/images\/mermaidNote\//);
            expect(container?.querySelector("details pre.mermaid-note-source")?.textContent)
                .toBe("graph TD; A-->B[<script>]");
            expect(root.querySelector("script")).toBeNull();
        });
    });

    describe("Web view note", () => {
        const SANDBOX = "allow-same-origin allow-scripts allow-popups";

        /**
         * Renders a web view note and reads back the element the share page ends up with, so a test
         * can assert the whole of it — every attribute the browser sees, and nothing besides.
         */
        function renderWebViewNote(src?: string) {
            const note = buildShareNote({
                type: "webView",
                content: "",
                ...(src !== undefined ? { "#webViewSrc": src } : {})
            });
            const root = parse(String(getContent(note).content));
            return { root, frame: root.querySelector("iframe") };
        }

        it("renders a frame carrying the source URL, and nothing else", () => {
            const { root, frame } = renderWebViewNote("https://example.com/page");
            expect(root.childNodes.length).toBe(1);
            expect(frame?.rawTagName).toBe("iframe");
            expect(frame?.attributes).toStrictEqual({
                class: "webview",
                src: "https://example.com/page",
                sandbox: SANDBOX
            });
            expect(frame?.innerHTML).toBe("");
        });

        it("renders nothing at all when the note carries no source", () => {
            const { root, frame } = renderWebViewNote();
            expect(frame).toBeNull();
            expect(root.childNodes.length).toBe(0);
        });

        it("loads an absolute http(s) source URL, normalising only its scheme and host", () => {
            for (const [src, expected] of [
                ["https://example.com/page", "https://example.com/page"],
                ["http://example.com/a?b=1&c=2", "http://example.com/a?b=1&c=2"],
                ["HTTPS://Example.com/Page", "https://example.com/Page"]
            ]) {
                expect(renderWebViewNote(src).frame?.getAttribute("src")).toBe(expected);
            }
        });

        it("loads a source rooted at the site serving the page, unchanged", () => {
            // The user guide points its API reference pages at the Redoc and TypeDoc output the
            // docs build writes beside them, which is only ever reachable as a rooted path.
            for (const src of [
                "/rest-api/etapi/",
                "/script-api/frontend/interfaces/FNote.html"
            ]) {
                expect(renderWebViewNote(src).frame?.getAttribute("src")).toBe(src);
            }
        });

        it("renders nothing for a source URL a frame has no business loading", () => {
            // A web view frames a website or a page of this site, and the setup form only ever
            // writes an absolute URL. Anything else reaches the label by another route — a
            // hand-edited attribute, an import, ETAPI, a sync — and either cannot be framed at all
            // or leaves the site while looking rooted at it: the URL parser folds a backslash, and
            // strips a tab, into the second slash that starts an authority.
            for (const src of [
                "//example.com/protocol-relative",
                "/\\example.com/backslash",
                "/\t/example.com",
                "./a",
                "relative/path",
                "mailto:a@b.com",
                "ftp://example.com/file",
                "javascript:alert(1)",
                "JaVaScRiPt:alert(1)",
                "data:text/html,<script>alert(1)</script>",
                "vbscript:msgbox",
                "not a url at all"
            ]) {
                const { root, frame } = renderWebViewNote(src);
                expect(frame).toBeNull();
                expect(root.childNodes.length).toBe(0);
            }
        });

        it("never lets a source URL add attributes of its own to the frame", () => {
            // Whatever the URL carries, it can only ever be read back as the frame's source: an
            // attribute value cannot end early and leave the rest of itself to be read as markup.
            for (const src of [
                `https://example.com/?a=" onload="alert(1)" data-x="`,
                `https://example.com/#" onload="alert(1)" data-x="`
            ]) {
                expect(Object.keys(renderWebViewNote(src).frame?.attributes ?? {})).toStrictEqual([
                    "class", "src", "sandbox"
                ]);
            }
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

    describe("ensureShareHighlighting", () => {
        it("registers once per option value and drops a disabled language", async () => {
            const getOption = vi.spyOn(options, "getOptionOrNull");
            const pythonBlock = () => buildShareNote({
                content: `<pre><code class="language-text-x-python">def x(): pass</code></pre>`
            });

            getOption.mockReturnValue(JSON.stringify([ "text/x-python" ]));
            const first = ensureShareHighlighting();
            expect(ensureShareHighlighting()).toBe(first);
            await first;
            expect(getContent(pythonBlock()).content).toContain("hljs-keyword");

            getOption.mockReturnValue(JSON.stringify([ "text/x-go" ]));
            const second = ensureShareHighlighting();
            expect(second).not.toBe(first);
            await second;
            expect(getContent(pythonBlock()).content).not.toContain("hljs");

            getOption.mockRestore();
            await ensureShareHighlighting();
        });
    });

    describe("Share index", () => {
        it("points each index entry at the child's shareId, whatever characters it carries", () => {
            buildShareNote({
                id: shareRoot.SHARE_ROOT_NOTE_ID,
                children: [
                    { "id": "child1", "title": "Child", "#shareAlias": `my alias"x` }
                ]
            });
            const note = buildShareNote({
                "id": "indexNote",
                "content": "<p>Index</p>",
                "#shareIndex": ""
            });

            const result = getContent(note);
            const anchor = parse(String(result.content)).querySelector("#index a");

            expect(anchor?.getAttribute("href")).toBe(`./my alias"x`);
            expect(Object.keys(anchor?.attributes ?? {}).sort()).toEqual([ "class", "href" ]);
        });

        it("points an entry with either external link label at that link, in a new tab", () => {
            buildShareNote({
                id: shareRoot.SHARE_ROOT_NOTE_ID,
                children: [
                    { "id": "legacyExternal", "#shareExternal": "https://example.com/legacy" },
                    { "id": "documentedExternal", "#shareExternalLink": " https://example.com/doc " }
                ]
            });
            const note = buildShareNote({ "id": "indexNote2", "content": "<p>Index</p>", "#shareIndex": "" });

            const anchors = parse(String(getContent(note).content)).querySelectorAll("#index a");

            expect(anchors.map((anchor) => anchor.getAttribute("href")))
                .toStrictEqual([ "https://example.com/legacy", "https://example.com/doc" ]);
            for (const anchor of anchors) {
                expect(anchor.getAttribute("target")).toBe("_blank");
                expect(anchor.getAttribute("rel")).toBe("noopener noreferrer");
            }
        });
    });
    describe("preparePageContent", () => {
        it("anchors every heading and lists it with its level, text and unique slug", () => {
            const { content, headings } = prepare(trimIndentation`
                <h1>Intro</h1>
                <p>Text</p>
                <h2 class="x">Q&amp;A <strong>now</strong></h2>
                <h3>Spans
                two lines</h3>
                <h2>Intro</h2>
            `);

            expect(headings).toStrictEqual([
                { level: 1, text: "Intro", slug: "intro" },
                { level: 2, text: "Q&A now", slug: "q-amp-a-now" },
                { level: 3, text: "Spans two lines", slug: "spans-two-lines" },
                { level: 2, text: "Intro", slug: "intro-1" }
            ]);
            expect(content).toContain(
                `<h2 class="x">Q&amp;A <strong>now</strong>`
                + `<a id="q-amp-a-now" class="toc-anchor" name="q-amp-a-now" href="#q-amp-a-now">#</a></h2>`);
            expect(content).toContain(`<p>Text</p>`);
            expect(parse(content).querySelectorAll(".toc-anchor")).toHaveLength(4);
        });

        it("gives an image without alt text the generic one and lazy loading, keeping its own", () => {
            const { content } = prepare(trimIndentation`
                <p><img src="a.png"></p>
                <p><img src="b.png" alt="Chart" loading="eager"></p>
                <p><img src="c.png" alt=""></p>
            `);

            expect(content).toContain(`<img src="a.png" alt="Image" loading="lazy">`);
            expect(content).toContain(`<img src="b.png" alt="Chart" loading="eager">`);
            const decorative = parse(content).querySelector(`img[src="c.png"]`);
            expect(decorative?.getAttribute("alt")).toBe("");
            expect(decorative?.getAttribute("loading")).toBe("lazy");
        });

        it("returns content without headings or images as it is", () => {
            const html = `<p>No <b>headings</b> here &amp; there</p>`;
            expect(prepare(html)).toStrictEqual({ content: html, headings: [] });
        });

        function prepare(html: string) {
            return preparePageContent(html, { imageAlt: "Image" });
        }
    });

    describe("Navigation tree", () => {
        it("links each page of the site, expanding the way to the page shown", () => {
            const shareRootNote = buildShareNote({
                id: shareRoot.SHARE_ROOT_NOTE_ID,
                children: [{
                    id: "treeSite",
                    title: "Site",
                    children: [
                        {
                            id: "treeSection",
                            title: "Section",
                            children: [ { id: "treeShown", title: "Shown", content: "<p>x</p>" } ]
                        },
                        { "id": "treeExternal", "title": "External", "#shareExternal": "https://example.com/page" }
                    ]
                }]
            });
            const shown = shareRootNote.getChildNotes()[0].getChildNotes()[0].getChildNotes()[0];

            const menu = parse(String(renderNoteContent(shown))).querySelector("#menu");
            const anchors = menu?.querySelectorAll("a") ?? [];

            expect(anchors.map((anchor) => anchor.getAttribute("href")))
                .toStrictEqual([ "./treeSection", "./treeShown", "https://example.com/page" ]);
            expect(Object.keys(anchors[0].attributes).sort()).toEqual([ "class", "href" ]);
            expect(anchors[1].classList.contains("active")).toBe(true);
            expect(anchors[2].getAttribute("target")).toBe("_blank");
            expect(anchors[2].getAttribute("rel")).toBe("noopener noreferrer");
            expect(menu?.querySelectorAll("li.expanded").map((item) => item.querySelector("a")?.text.trim()))
                .toStrictEqual([ "Section", "Shown" ]);
        });
    });
    describe("Subpage list template", () => {
        it("sets a working target and rel on external subpage links only", () => {
            buildShareNote({
                id: "pageParent",
                content: "<p>Parent</p>",
                children: [
                    {
                        "id": "pageExternal",
                        "title": "External",
                        "#shareExternal": "https://example.com/page"
                    },
                    {
                        "id": "pageBothLabels",
                        "title": "Both labels",
                        "#shareExternal": "",
                        "#shareExternalLink": "https://example.com/other"
                    },
                    { id: "pageInternal", title: "Internal" },
                    {
                        "id": "pageTwoUrls",
                        "title": "Two URLs",
                        "#shareExternal": "https://example.com/legacy",
                        "#shareExternalLink": "https://example.com/documented"
                    },
                    {
                        "id": "pageWhitespaceWithLegacy",
                        "title": "Whitespace with legacy",
                        "#shareExternal": "https://example.com/legacy2",
                        "#shareExternalLink": "   "
                    },
                    {
                        "id": "pageWhitespaceOnly",
                        "title": "Whitespace only",
                        "#shareExternalLink": "   "
                    }
                ]
            });
            const anchors = renderPageAnchors("pageParent");

            const bothLabels = anchors.find((a) => a.textContent === "Both labels");
            expect(bothLabels?.getAttribute("href")).toBe("https://example.com/other");
            expect(bothLabels?.getAttribute("target")).toBe("_blank");

            const external = anchors.find((a) => a.textContent === "External");
            expect(external?.getAttribute("href")).toBe("https://example.com/page");
            expect(external?.getAttribute("target")).toBe("_blank");
            expect(external?.getAttribute("rel")).toBe("noopener noreferrer");
            expect(Object.keys(external?.attributes ?? {}).sort())
                .toEqual([ "class", "href", "rel", "target" ]);

            const internal = anchors.find((a) => a.textContent === "Internal");
            expect(internal?.getAttribute("href")).toBe("./pageInternal");
            expect(Object.keys(internal?.attributes ?? {}).sort()).toEqual([ "class", "href" ]);

            const twoUrls = anchors.find((a) => a.textContent === "Two URLs");
            expect(twoUrls?.getAttribute("href")).toBe("https://example.com/documented");

            const whitespaceWithLegacy = anchors
                .find((a) => a.textContent === "Whitespace with legacy");
            expect(whitespaceWithLegacy?.getAttribute("href")).toBe("https://example.com/legacy2");

            const whitespaceOnly = anchors.find((a) => a.textContent === "Whitespace only");
            expect(whitespaceOnly?.getAttribute("href")).toBe("./pageWhitespaceOnly");
            expect(Object.keys(whitespaceOnly?.attributes ?? {}).sort())
                .toEqual([ "class", "href" ]);
        });

        it("leaves notes hidden from the tree out of a book's subpage list", () => {
            buildShareNote({
                id: "bookParent",
                type: "book",
                content: "",
                children: [
                    { id: "bookVisible", title: "Visible" },
                    { "id": "bookHidden", "title": "Hidden", "#shareHiddenFromTree": "" }
                ]
            });

            const titles = renderPageAnchors("bookParent").map((a) => a.textContent);
            expect(titles).toEqual([ "Visible" ]);
        });

        function renderPageAnchors(noteId: string) {
            const note = shaca.getNote(noteId);
            const { header, content, isEmpty } = getContent(note);

            const html = ejs.render(readShareTemplate("page"), {
                note,
                header,
                content,
                isEmpty,
                assetPath: "assets",
                assetUrlFragment: "assets",
                showLoginInShareTheme: false,
                t: (key: string) => key,
                isDev: false,
                utils,
                sanitizeUrl: sanitize.sanitizeUrl,
                subRoot: { note },
                rootNoteId: noteId,
                cssToLoad: [],
                jsToLoad: [],
                logoUrl: "",
                ancestors: [],
                isStatic: false,
                faviconUrl: "",
                iconPackCss: "",
                iconPackSupportedPrefixes: [],
                head: getPageHead(note, note),
                snippets: getHtmlSnippets(note),
                logo: getSiteLogo(note, sanitize.sanitizeUrl),
                prevNext: getPrevNextLinks(note, note),
                navigation: [],
                childLinks: getChildLinks(note, sanitize.sanitizeUrl),
                headings: [],
                toc: []
            }, {
                includer: (path: string) => ({
                    template: readShareTemplate(path)
                })
            });

            return parse(html).querySelectorAll("#childLinks a");
        }
    });
});
