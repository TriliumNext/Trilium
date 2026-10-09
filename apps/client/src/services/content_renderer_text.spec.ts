// @vitest-environment jsdom
// DOMPurify relies on browser-faithful DOM traversal (NodeIterator); happy-dom
// mishandles it and strips valid markup (surfaced by dompurify 3.4.8). Run the
// sanitization-dependent specs under jsdom, which matches real-browser behavior.
import { KATEX_MACROS, trimIndentation } from "@triliumnext/commons";
import DOMPurify from "dompurify";
import { beforeEach, describe, expect, it, vi } from "vitest";

import FAttachment from "../entities/fattachment";
import content_renderer from "./content_renderer";
import froca from "./froca";
import server from "./server";
import { buildNote } from "../test/easy-froca";

// `applyInlineMermaid` dynamically imports "mermaid"; provide a controllable
// stub whose behavior we tune per-test via the shared `mermaidRenderImpl` hook.
let mermaidRenderImpl: (id: string, source: string) => { svg: string } | Promise<{ svg: string }>
    = (_id, source) => ({ svg: `<svg>${source}</svg>` });
const mermaidInitialize = vi.fn();
vi.mock("mermaid", () => ({
    default: {
        initialize: (...args: unknown[]) => mermaidInitialize(...args),
        render: (id: string, source: string) => mermaidRenderImpl(id, source)
    }
}));

// i18n isn't initialized with resources in tests, so `t` returns an empty
// string. Stub the one key this suite asserts on so the surfaced error text is
// real; other keys fall through to the bare key (irrelevant to these tests).
vi.mock("./i18n.js", async (importOriginal) => {
    const actual = await importOriginal<typeof import("./i18n.js")>();
    return {
        ...actual,
        t: (key: string, opts?: { error?: string }) =>
            key === "content_renderer.mermaid_diagram_error"
                ? `Mermaid diagram failed to render: ${opts?.error}`
                : key
    };
});

// Spy on the KaTeX auto-render entry point so we can assert that
// `postProcessRichContent` only invokes it when a `span.math-tex` is present.
// The original module is kept intact (default export, CSS side-effects) so the
// rest of the render pipeline behaves normally.
const renderMathInElementSpy = vi.hoisted(() => vi.fn());
vi.mock("./math.js", async (importOriginal) => {
    const original = await importOriginal<typeof import("./math.js")>();
    return {
        ...original,
        renderMathInElement: renderMathInElementSpy
    };
});

import renderText, {
    applyInlineMermaid,
    postProcessRichContent,
    renderChildrenList,
    renderTextContent,
    rewriteMermaidDiagramsInContainer
} from "./content_renderer_text";

describe("Text content renderer", () => {
    it("renders embedded note", async () => {
        const contentEl = document.createElement("div");
        const embeddedNote = buildNote({
            title: "Included note",
            content: "<p>This is the included note.</p>"
        });
        const note = buildNote({
            title: "New note",
            content: trimIndentation`
                <p>
                    Hi there
                </p>
                <section class="include-note" data-note-id="${embeddedNote.noteId}" data-box-size="medium">
                    &nbsp;
                </section>
            `
        });
        await renderText(note, $(contentEl));
        expect(contentEl.querySelectorAll("section.include-note").length).toBe(1);
        expect(contentEl.querySelectorAll("section.include-note p").length).toBe(1);
    });

    it("renders the caption of an embed after its content, unless nested", async () => {
        const contentEl = document.createElement("div");
        const figure = (noteId: string, boxSize: string, caption: string) =>
            `<figure class="include-note" data-note-id="${noteId}" data-box-size="${boxSize}">`
            + `<figcaption>${caption}</figcaption></figure>`;
        const nestedNote = buildNote({ title: "Nested note", content: "<p>Nested.</p>" });
        const embeddedNote = buildNote({
            title: "Included note",
            content: `<p>Included.</p>${figure(nestedNote.noteId, "medium", "Nested caption")}`
        });
        const note = buildNote({
            title: "New note",
            content: figure(embeddedNote.noteId, "medium", "A <strong>caption</strong>")
        });

        await renderText(note, $(contentEl));

        const [ embed ] = contentEl.querySelectorAll(".ck-content > .include-note");
        expect(embed.querySelector("p")?.textContent).toBe("Included.");
        expect(embed.lastElementChild?.outerHTML)
            .toBe("<figcaption>A <strong>caption</strong></figcaption>");
        expect(embed.querySelectorAll("figcaption")).toHaveLength(1);
    });

    it("renders a Tiny embed as a link, without rendering what it shows", async () => {
        const embeddedNote = buildNote({ title: "Tiny note", content: "<p>Not rendered.</p>" });
        const owner = buildNote({
            title: "Tiny owner",
            content: `<figure class="include-note" data-note-id="${embeddedNote.noteId}"`
                + ` data-box-size="tiny"><figcaption>Tiny caption</figcaption></figure>`
                + `<figure class="include-note" data-attachment-id="tinyPic" data-box-size="tiny">`
                + "</figure>"
        });
        new FAttachment(froca, {
            attachmentId: "tinyPic",
            ownerId: owner.noteId,
            role: "image",
            mime: "image/png",
            title: "photo.png",
            dateModified: "",
            utcDateModified: "",
            utcDateScheduledForErasureSince: "",
            contentLength: 0
        });
        const getRenderedContent = vi.spyOn(content_renderer, "getRenderedContent");

        try {
            const contentEl = document.createElement("div");
            await renderText(owner, $(contentEl));

            expect(getRenderedContent).not.toHaveBeenCalled();
            expect(contentEl.querySelector(".include-note")).toBeNull();
            expect(contentEl.querySelector("img")).toBeNull();
            expect(contentEl.textContent).not.toContain("Not rendered.");
            expect(contentEl.textContent).not.toContain("Tiny caption");
            const links = Array.from(contentEl.querySelectorAll("a.reference-link"));
            expect(links.map((link) => link.getAttribute("href"))).toEqual([
                `#root/${embeddedNote.noteId}`,
                `#root/${owner.noteId}?viewMode=attachments&attachmentId=tinyPic`
            ]);
        } finally {
            getRenderedContent.mockRestore();
        }
    });

    it("skips rendering embedded note", async () => {
        const contentEl = document.createElement("div");
        const embeddedNote = buildNote({
            title: "Included note",
            content: "<p>This is the included note.</p>"
        });
        const note = buildNote({
            title: "New note",
            content: trimIndentation`
                <p>
                    Hi there
                </p>
                <section class="include-note" data-note-id="${embeddedNote.noteId}" data-box-size="medium">
                    &nbsp;
                </section>
            `
        });
        await renderText(note, $(contentEl), { noContentEmbeds: true });
        expect(contentEl.querySelectorAll("section.include-note").length).toBe(0);
    });

    it("doesn't enter infinite loop on direct recursion", async () => {
        const contentEl = document.createElement("div");
        const note = buildNote({
            title: "New note",
            id: "Y7mBwmRjQyb4",
            content: trimIndentation`
                <p>
                    Hi there
                </p>
                <section class="include-note" data-note-id="Y7mBwmRjQyb4" data-box-size="medium">
                    &nbsp;
                </section>
                <section class="include-note" data-note-id="Y7mBwmRjQyb4" data-box-size="medium">
                    &nbsp;
                </section>
            `
        });
        await renderText(note, $(contentEl));
        expect(contentEl.querySelectorAll("section.include-note").length).toBe(0);
    });

    it("doesn't enter infinite loop on indirect recursion", async () => {
        const contentEl = document.createElement("div");
        buildNote({
            id: "first",
            title: "Included note",
            content: trimIndentation`\
                <p>This is the included note.</p>
                <section class="include-note" data-note-id="second" data-box-size="medium">
                    &nbsp;
                </section>
            `
        });
        const note = buildNote({
            id: "second",
            title: "New note",
            content: trimIndentation`
                <p>
                    Hi there
                </p>
                <section class="include-note" data-note-id="first" data-box-size="medium">
                    &nbsp;
                </section>
            `
        });
        await renderText(note, $(contentEl));
        expect(contentEl.querySelectorAll("section.include-note").length).toBe(1);
    });

    it("renders children list when note is empty", async () => {
        const contentEl = document.createElement("div");
        const parentNote = buildNote({
            title: "Parent note",
            children: [
                { title: "Child note 1" },
                { title: "Child note 2" }
            ]
        });
        await renderText(parentNote, $(contentEl));
        const items = contentEl.querySelectorAll("a");
        expect(items.length).toBe(2);
        expect(items[0].textContent).toBe("Child note 1");
        expect(items[1].textContent).toBe("Child note 2");
    });

    it("skips archived notes in children list", async () => {
        const contentEl = document.createElement("div");
        const parentNote = buildNote({
            title: "Parent note",
            children: [
                { title: "Child note 1" },
                { title: "Child note 2", "#archived": "" },
                { title: "Child note 3" }
            ]
        });
        await renderText(parentNote, $(contentEl));
        const items = contentEl.querySelectorAll("a");
        expect(items.length).toBe(2);
        expect(items[0].textContent).toBe("Child note 1");
        expect(items[1].textContent).toBe("Child note 3");
    });

    it("renders given content in place of the saved one, and the children list when empty", async () => {
        const note = buildNote({
            title: "Edited note",
            content: "<p>Saved</p>",
            children: [ { title: "Child note" } ]
        });

        const edited = document.createElement("div");
        await renderTextContent(note, "<p>Edited</p>", $(edited));
        expect(edited.querySelector(".ck-content")?.innerHTML).toBe("<p>Edited</p>");

        const emptied = document.createElement("div");
        await renderTextContent(note, "<p>&nbsp;</p>", $(emptied));
        expect(emptied.querySelector("a")?.textContent).toBe("Child note");
    });

    it("renders nothing for an empty note with no children when noChildrenList is set", async () => {
        const contentEl = document.createElement("div");
        const note = buildNote({ title: "Empty note" });
        await renderText(note, $(contentEl), { noChildrenList: true });
        expect(contentEl.innerHTML).toBe("");
    });

    it("invokes KaTeX inline rendering when math-tex spans are present", async () => {
        renderMathInElementSpy.mockClear();
        const contentEl = document.createElement("div");
        const note = buildNote({
            title: "Math note",
            content: `<p>Formula: <span class="math-tex">\\(a^2 + b^2\\)</span></p>`
        });
        await expect(renderText(note, $(contentEl))).resolves.toBeUndefined();
        // The math span is preserved through the rendering pass.
        expect(contentEl.querySelector("span.math-tex")).not.toBeNull();
        // The conditional KaTeX auto-render branch ran: it was invoked exactly once
        // with the rendered content element ($renderedContent[0]), the trust flag, and the
        // shared MathLive→KaTeX macros (spread into a fresh object KaTeX may mutate).
        expect(renderMathInElementSpy).toHaveBeenCalledTimes(1);
        expect(renderMathInElementSpy).toHaveBeenCalledWith(contentEl, { trust: true, throwOnError: false, macros: { ...KATEX_MACROS } });
    });

    it("does not invoke KaTeX inline rendering when no math-tex spans are present", async () => {
        renderMathInElementSpy.mockClear();
        const contentEl = document.createElement("div");
        const note = buildNote({
            title: "Plain note",
            content: `<p>No formulas here.</p>`
        });
        await expect(renderText(note, $(contentEl))).resolves.toBeUndefined();
        // The math branch is gated on the presence of a span.math-tex; with none
        // present the auto-render entry point must be left untouched.
        expect(renderMathInElementSpy).not.toHaveBeenCalled();
    });

    it("rewrites reference-link titles using the note title", async () => {
        const contentEl = document.createElement("div");
        const target = buildNote({ id: "refTarget1", title: "Referenced Title" });
        const note = buildNote({
            title: "Note with reference",
            content: `<p><a class="reference-link" href="#root/${target.noteId}">stale</a></p>`
        });
        await renderText(note, $(contentEl));
        const refLink = contentEl.querySelector("a.reference-link");
        expect(refLink).not.toBeNull();
        // The original "stale" child text was replaced with a span carrying the live title.
        expect(refLink?.textContent).toContain("Referenced Title");
    });

    it("labels a reference to a block of the rendered note by the text of the block", async () => {
        const contentEl = document.createElement("div");
        const note = buildNote({
            id: "selfRef1",
            title: "Self",
            content: "<p data-trilium-block-id=\"b1\">Opening words</p>"
                + "<p><a class=\"reference-link\" href=\"#root/selfRef1?block=b1\">stale</a></p>"
        });
        await renderText(note, $(contentEl));
        const refLink = contentEl.querySelector("a.reference-link");
        expect(refLink).not.toBeNull();
        expect(refLink?.textContent).toBe("Opening words");
    });

    it("tolerates reference links without an href", async () => {
        const contentEl = document.createElement("div");
        const note = buildNote({
            title: "Note with bad reference",
            content: `<p><a class="reference-link">no href</a></p>`
        });
        // Should resolve without throwing even though there is no href to resolve.
        await expect(renderText(note, $(contentEl))).resolves.toBeUndefined();
        expect(contentEl.querySelector("a.reference-link")).not.toBeNull();
    });

    it("removes non-leading style tags from trimmed markdown previews", async () => {
        const note = buildNote({ title: "Imported Markdown note" });
        const markdownHtml = DOMPurify.sanitize(`
            <p>Preview text</p>
            <style>li { margin-bottom: 8pt; }</style>
        `);
        const $renderedContent = $("<div>").append(
            $("<div class=\"ck-content\">").html(markdownHtml)
        );
        expect($renderedContent[0].querySelector("style")).not.toBeNull();

        await postProcessRichContent(note, $renderedContent, { trim: true });

        expect($renderedContent[0].querySelector("style")).toBeNull();
        expect($renderedContent[0].textContent).toContain("Preview text");
    });
});

describe("Nested embeds (single-level display vs recursive print)", () => {
    function buildEmbedChain() {
        // C (leaf) ← embedded by B ← embedded by A. Distinctive bodies so we can
        // assert which levels were expanded vs. replaced with a reference link.
        const noteC = buildNote({ id: "nestC", title: "Note C", content: "<p>C body</p>" });
        const noteB = buildNote({
            id: "nestB",
            title: "Note B",
            content: trimIndentation`
                <p>B body</p>
                <section class="include-note" data-note-id="nestC" data-box-size="medium">&nbsp;</section>
            `
        });
        const noteA = buildNote({
            id: "nestA",
            title: "Note A",
            content: trimIndentation`
                <p>A body</p>
                <section class="include-note" data-note-id="nestB" data-box-size="medium">&nbsp;</section>
            `
        });
        return { noteA, noteB, noteC };
    }

    it("on display, renders only the first level and replaces the nested embed with a reference link", async () => {
        const { noteA } = buildEmbedChain();
        const contentEl = document.createElement("div");
        await renderText(noteA, $(contentEl));

        // First level (B) is expanded — its body is present.
        expect(contentEl.textContent).toContain("B body");
        // Second level (C) is NOT expanded — its body must be absent.
        expect(contentEl.textContent).not.toContain("C body");
        // The nested embed section for C is gone, replaced by a reference link to C.
        expect(contentEl.querySelector('section.include-note[data-note-id="nestC"]')).toBeNull();
        const refLink = contentEl.querySelector("a.reference-link");
        expect(refLink).not.toBeNull();
        expect(refLink?.getAttribute("href")).toContain("nestC");
    });

    it("on print (expandNestedEmbeds), keeps expanding nested embeds recursively", async () => {
        const { noteA } = buildEmbedChain();
        const contentEl = document.createElement("div");
        await renderText(noteA, $(contentEl), { expandNestedEmbeds: true });

        // Both levels expanded, all bodies present, no reference-link placeholder.
        expect(contentEl.textContent).toContain("B body");
        expect(contentEl.textContent).toContain("C body");
        expect(contentEl.querySelector("a.reference-link")).toBeNull();
    });

    it("on print, links back to a note already expanded on the path instead of looping", async () => {
        buildNote({
            id: "cycB",
            title: "Note B",
            content: `<p>B body</p><section class="include-note" data-note-id="cycA" data-box-size="medium">&nbsp;</section>`
        });
        const noteA = buildNote({
            id: "cycA",
            title: "Note A",
            content: `<p>A body</p><section class="include-note" data-note-id="cycB" data-box-size="medium">&nbsp;</section>`
        });
        const contentEl = document.createElement("div");
        await renderText(noteA, $(contentEl), { expandNestedEmbeds: true });

        expect(contentEl.textContent).toContain("B body");
        expect(contentEl.querySelector('section.include-note[data-note-id="cycA"]')).toBeNull();
        expect(contentEl.querySelector("a.reference-link")?.getAttribute("href")).toBe("#root/cycA");
    });

    it("on print, expands a note shared across sibling branches in each branch (not a false cycle)", async () => {
        // Diamond: A embeds B and C; both B and C embed D. D is not a cycle, so under recursive
        // expansion it must render in both branches (the ancestor path is tracked per-branch).
        buildNote({ id: "dagD", title: "Note D", content: "<p>D body</p>" });
        buildNote({ id: "dagB", title: "Note B", content: `<p>B body</p><section class="include-note" data-note-id="dagD" data-box-size="medium">&nbsp;</section>` });
        buildNote({ id: "dagC", title: "Note C", content: `<p>C body</p><section class="include-note" data-note-id="dagD" data-box-size="medium">&nbsp;</section>` });
        const noteA = buildNote({
            id: "dagA",
            title: "Note A",
            content: trimIndentation`
                <section class="include-note" data-note-id="dagB" data-box-size="medium">&nbsp;</section>
                <section class="include-note" data-note-id="dagC" data-box-size="medium">&nbsp;</section>
            `
        });
        const contentEl = document.createElement("div");
        await renderText(noteA, $(contentEl), { expandNestedEmbeds: true });

        expect((contentEl.textContent?.match(/D body/g) ?? []).length).toBe(2);
        expect(contentEl.querySelector("a.reference-link")).toBeNull();
    });

    it("renders a note's own embeds as reference links when embedsAsReferenceLinks is set", async () => {
        // This mirrors how an already-embedded note (e.g. the editor embed widget) is rendered:
        // its content shows, but its own embeds degrade to reference links.
        const { noteB } = buildEmbedChain();
        const contentEl = document.createElement("div");
        await renderText(noteB, $(contentEl), { embedsAsReferenceLinks: true });

        expect(contentEl.textContent).toContain("B body");
        expect(contentEl.textContent).not.toContain("C body");
        expect(contentEl.querySelector('section.include-note[data-note-id="nestC"]')).toBeNull();
        expect(contentEl.querySelector("a.reference-link")?.getAttribute("href")).toContain("nestC");
    });

    it("leaves include-note sections with a missing or invalid note ID untouched when degrading to reference links", async () => {
        const note = buildNote({
            id: "badRefHost",
            title: "Host",
            content: trimIndentation`
                <p>host</p>
                <section class="include-note" data-box-size="medium">&nbsp;</section>
                <section class="include-note" data-note-id="bad id!" data-box-size="medium">&nbsp;</section>
            `
        });
        const contentEl = document.createElement("div");
        await renderText(note, $(contentEl), { embedsAsReferenceLinks: true });

        // Neither the missing-id nor the invalid-id section is converted to a reference link;
        // both are left in place.
        expect(contentEl.querySelector("a.reference-link")).toBeNull();
        expect(contentEl.querySelectorAll("section.include-note").length).toBe(2);
    });
});

describe("renderContentEmbeds via postProcessRichContent", () => {
    it("warns and skips an include-note section whose note cannot be found", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        // Make the froca reload a no-op so the missing note stays absent from the
        // cache (instead of the default throwing tree/load stub).
        const originalPost = server.post;
        server.post = vi.fn(async () => ({ notes: [], branches: [], attributes: [] })) as typeof server.post;
        try {
            const $rendered = $('<div>').append($('<div class="ck-content">').html(
                `<section class="include-note" data-note-id="doesNotExist999">&nbsp;</section>`
            ));
            const host = buildNote({ title: "Host note" });
            await postProcessRichContent(host, $rendered);
            // Section is left in place (not removed) because the note was missing.
            expect($rendered.find("section.include-note").length).toBe(1);
            expect(warn).toHaveBeenCalledWith(expect.stringContaining("doesNotExist999"));
        } finally {
            server.post = originalPost;
            warn.mockRestore();
        }
    });

    it("ignores include-note sections without a data-note-id", async () => {
        const $rendered = $('<div>').append($('<div class="ck-content">').html(
            `<section class="include-note">&nbsp;</section>`
        ));
        const host = buildNote({ title: "Host note 2" });
        await postProcessRichContent(host, $rendered);
        // No data-note-id means it is skipped in both gather and render loops.
        expect($rendered.find("section.include-note").length).toBe(1);
    });
});

describe("Attachment embeds", () => {
    it("renders an embedded attachment in place, and links to it one level down", async () => {
        const owner = buildNote({
            title: "Embed owner",
            content: `<section class="include-note" data-attachment-id="embedPic">&nbsp;</section>`
        });
        new FAttachment(froca, {
            attachmentId: "embedPic",
            ownerId: owner.noteId,
            role: "image",
            mime: "image/png",
            title: "photo.png",
            dateModified: "",
            utcDateModified: "",
            utcDateScheduledForErasureSince: "",
            contentLength: 0
        });

        const contentEl = document.createElement("div");
        await renderText(owner, $(contentEl));
        expect(contentEl.querySelector("section.include-note img")?.getAttribute("src"))
            .toContain("api/attachments/embedPic/image/");

        const nestedEl = document.createElement("div");
        await renderText(owner, $(nestedEl), { embedsAsReferenceLinks: true });
        expect(nestedEl.querySelector("section.include-note")).toBeNull();
        expect(nestedEl.querySelector("a.reference-link")?.getAttribute("href"))
            .toBe(`#root/${owner.noteId}?viewMode=attachments&attachmentId=embedPic`);
    });
});

describe("postProcessRichContent with FAttachment", () => {
    it("adds the attachmentId to seenNoteIds for an attachment owner", async () => {
        const owner = buildNote({ title: "Owner" });
        const attachment = new FAttachment(froca, {
            attachmentId: "att-pp-1",
            ownerId: owner.noteId,
            role: "file",
            mime: "text/html",
            title: "Attachment",
            dateModified: "",
            utcDateModified: "",
            utcDateScheduledForErasureSince: "",
            contentLength: 0
        });
        const seenNoteIds = new Set<string>();
        const $rendered = $('<div>').append($('<div class="ck-content">').html("<p>hi</p>"));
        await postProcessRichContent(attachment, $rendered, { seenNoteIds });
        expect(seenNoteIds.has("att-pp-1")).toBe(true);
    });
});

describe("renderText with FAttachment", () => {
    it("does not render a children list for an empty attachment blob", async () => {
        const owner = buildNote({ title: "Owner 2" });
        const attachment = new FAttachment(froca, {
            attachmentId: "att-rt-1",
            ownerId: owner.noteId,
            role: "file",
            mime: "text/html",
            title: "Empty attachment",
            dateModified: "",
            utcDateModified: "",
            utcDateScheduledForErasureSince: "",
            contentLength: 0
        });
        // Empty blob, and an attachment is not an FNote, so neither branch runs.
        attachment.getBlob = (async () => ({ content: "" })) as typeof attachment.getBlob;
        const contentEl = document.createElement("div");
        await renderText(attachment, $(contentEl));
        expect(contentEl.innerHTML).toBe("");
    });
});

describe("renderChildrenList", () => {
    it("returns immediately when the note has no children", async () => {
        const note = buildNote({ title: "Childless" });
        const contentEl = document.createElement("div");
        await renderChildrenList($(contentEl), note, false);
        expect(contentEl.innerHTML).toBe("");
        expect(contentEl.classList.contains("text-with-ellipsis")).toBe(false);
    });

    it("renders at most the first 10 children", async () => {
        const children = Array.from({ length: 12 }, (_, i) => ({ title: `C${i}` }));
        const note = buildNote({ title: "Big parent", children });
        const contentEl = document.createElement("div");
        await renderChildrenList($(contentEl), note, false);
        expect(contentEl.querySelectorAll("a").length).toBe(10);
        expect(contentEl.classList.contains("text-with-ellipsis")).toBe(true);
    });
});

describe("rewriteMermaidDiagramsInContainer", () => {
    it("does nothing when there are no mermaid code blocks", async () => {
        const container = document.createElement("div");
        container.innerHTML = `<pre><code class="language-js">x</code></pre>`;
        await rewriteMermaidDiagramsInContainer(container);
        expect(container.querySelector("div.mermaid-diagram")).toBeNull();
        expect(container.querySelector("pre")).not.toBeNull();
    });

    it("converts mermaid pre/code blocks into mermaid-diagram divs", async () => {
        const container = document.createElement("div");
        container.innerHTML = `<pre><code class="language-mermaid">graph TD;A--&gt;B;</code></pre>`;
        await rewriteMermaidDiagramsInContainer(container);
        const div = container.querySelector("div.mermaid-diagram");
        expect(div).not.toBeNull();
        expect(div?.textContent).toContain("graph TD;");
        expect(container.querySelector("pre")).toBeNull();
    });

    it("uses an empty body when the code element is missing", async () => {
        const container = document.createElement("div");
        // A <pre> matched by :has(code) whose <code> has no inner content, so the
        // rewritten div ends up with an empty body.
        container.innerHTML = `<pre><code class="language-mermaid"></code></pre>`;
        await rewriteMermaidDiagramsInContainer(container);
        const div = container.querySelector("div.mermaid-diagram");
        expect(div).not.toBeNull();
        expect(div?.innerHTML).toBe("");
    });
});

describe("applyInlineMermaid", () => {
    beforeEach(() => {
        mermaidRenderImpl = (_id, source) => ({ svg: `<svg>${source}</svg>` });
        mermaidInitialize.mockClear();
    });

    function makeContainer(sources: string[]) {
        const container = document.createElement("div");
        for (const source of sources) {
            const div = document.createElement("div");
            div.className = "mermaid-diagram";
            div.textContent = source;
            container.appendChild(div);
        }
        return container;
    }

    it("clears stored position state and returns when there are no diagrams", async () => {
        const container = document.createElement("div");
        // Should not throw and should not import/initialize mermaid.
        await applyInlineMermaid(container);
        expect(mermaidInitialize).not.toHaveBeenCalled();
    });

    it("renders a pending diagram and caches the produced SVG", async () => {
        const container = makeContainer(["graph A"]);
        await applyInlineMermaid(container);
        expect(mermaidInitialize).toHaveBeenCalledTimes(1);
        const visible = container.querySelector("div.mermaid-diagram") as HTMLElement;
        expect(visible.innerHTML).toBe("<svg>graph A</svg>");
        expect(visible.getAttribute("data-processed")).toBe("true");
    });

    it("paints cached SVG without re-rendering mermaid on a second pass", async () => {
        const container = makeContainer(["graph CACHE"]);
        let renderCount = 0;
        mermaidRenderImpl = (_id, source) => {
            renderCount++;
            return { svg: `<svg>${source}</svg>` };
        };
        await applyInlineMermaid(container);
        expect(renderCount).toBe(1);

        // Reset the visible node so we can observe the cached repaint.
        const node = container.querySelector("div.mermaid-diagram") as HTMLElement;
        node.removeAttribute("data-processed");
        node.innerHTML = "graph CACHE";
        mermaidInitialize.mockClear();

        await applyInlineMermaid(container);
        // No new render: cache hit short-circuits and pending stays empty.
        expect(renderCount).toBe(1);
        expect(mermaidInitialize).not.toHaveBeenCalled();
        expect(node.innerHTML).toBe("<svg>graph CACHE</svg>");
        expect(node.getAttribute("data-processed")).toBe("true");
    });

    it("shows the previous SVG as a placeholder while the new diagram renders", async () => {
        const container = makeContainer(["graph V1"]);
        await applyInlineMermaid(container);

        // Edit the diagram source in place; the old SVG should be used as the
        // positional placeholder for the new (uncached) source.
        const node = container.querySelector("div.mermaid-diagram") as HTMLElement;
        const previousSvg = node.innerHTML;
        node.textContent = "graph V2";

        let placeholderDuringRender = "";
        mermaidRenderImpl = (_id, source) => {
            placeholderDuringRender = node.innerHTML;
            return { svg: `<svg>${source}</svg>` };
        };
        await applyInlineMermaid(container);
        expect(placeholderDuringRender).toBe(previousSvg);
        expect(node.innerHTML).toBe("<svg>graph V2</svg>");
    });

    it("evicts cache entries whose source is no longer present", async () => {
        const container = makeContainer(["graph KEEP", "graph DROP"]);
        await applyInlineMermaid(container);

        // Remove the second diagram so its cached source must be evicted.
        container.querySelectorAll("div.mermaid-diagram")[1].remove();
        // First node is now a cache hit (its source is unchanged); reset to verify.
        const remaining = container.querySelector("div.mermaid-diagram") as HTMLElement;
        remaining.removeAttribute("data-processed");
        remaining.innerHTML = "graph KEEP";

        await applyInlineMermaid(container);
        expect(remaining.innerHTML).toBe("<svg>graph KEEP</svg>");
    });

    it("logs and surfaces the error in place when mermaid.render rejects", async () => {
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        const container = makeContainer(["graph BOOM"]);
        mermaidRenderImpl = () => {
            throw new Error("mermaid failed");
        };
        await applyInlineMermaid(container);
        expect(error).toHaveBeenCalled();
        const node = container.querySelector("div.mermaid-diagram") as HTMLElement;
        // The failure is rendered into the node (not left as raw source), so it's
        // visible in the UI instead of swallowed to the console.
        expect(node.classList.contains("mermaid-error")).toBe(true);
        expect(node.textContent).toContain("mermaid failed");
        expect(node.getAttribute("data-processed")).toBeNull();
        error.mockRestore();
    });

    it("renders the valid diagram even when a sibling diagram fails", async () => {
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        const container = makeContainer(["graph OK", "graph BAD"]);
        mermaidRenderImpl = (_id, source) => {
            if (source === "graph BAD") throw new Error("bad diagram");
            return { svg: `<svg>${source}</svg>` };
        };
        await applyInlineMermaid(container);
        const [ ok, bad ] = container.querySelectorAll<HTMLElement>("div.mermaid-diagram");
        // The good diagram still renders; only the failing one shows the error.
        expect(ok.innerHTML).toBe("<svg>graph OK</svg>");
        expect(bad.classList.contains("mermaid-error")).toBe(true);
        expect(bad.textContent).toContain("bad diagram");
        error.mockRestore();
    });

    it("surfaces the error on a failed re-render even when a previous render exists", async () => {
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        const container = makeContainer(["graph V1"]);
        await applyInlineMermaid(container);

        // Break the source: the stale render must not mask the failure — otherwise
        // the diagram looks fine until a full refresh.
        const node = container.querySelector("div.mermaid-diagram") as HTMLElement;
        node.textContent = "graph BROKEN";
        mermaidRenderImpl = () => {
            throw new Error("still broken");
        };
        await applyInlineMermaid(container);
        expect(node.classList.contains("mermaid-error")).toBe(true);
        expect(node.textContent).toContain("still broken");

        // Recovery: fixing the source clears the error state and renders cleanly.
        node.textContent = "graph FIXED";
        mermaidRenderImpl = (_id, source) => ({ svg: `<svg>${source}</svg>` });
        await applyInlineMermaid(container);
        expect(node.classList.contains("mermaid-error")).toBe(false);
        expect(node.innerHTML).toBe("<svg>graph FIXED</svg>");
        error.mockRestore();
    });
});

describe("Block embeds", () => {
    const blockEmbed = (noteId: string, block: string, boxSize = "medium", blockId?: string) =>
        `<figure class="include-note"${blockId ? ` data-trilium-block-id="${blockId}"` : ""}`
        + ` data-note-id="${noteId}" data-block="${block}" data-box-size="${boxSize}"></figure>`;

    it("renders only the referenced blocks, or a broken reference for a missing one", async () => {
        buildNote({
            id: "blkSource",
            title: "Source",
            content: "<p>Intro</p><blockquote><p>Skipped</p>"
                + "<p data-trilium-block-id=\"b1\">Quoted</p></blockquote>"
                + "<p data-trilium-block-id=\"b2\">Last</p><p>Outro</p>"
        });
        const host = buildNote({
            title: "Host",
            content: blockEmbed("blkSource", "b1:b2") + blockEmbed("blkSource", "b1:gone")
        });
        const contentEl = document.createElement("div");

        await renderText(host, $(contentEl));

        const [ embed, brokenEmbed ] = contentEl.querySelectorAll(".ck-content > .include-note");
        expect(embed.querySelector("blockquote")?.textContent).toBe("Quoted");
        expect(embed.textContent).toContain("Last");
        expect(embed.textContent).not.toMatch(/Intro|Skipped|Outro/);
        expect(brokenEmbed.querySelector(".block-reference-broken")?.textContent)
            .toBe("block_reference.broken");
    });

    it("renders a broken reference for the blocks of an empty note", async () => {
        const note = buildNote({ title: "Empty", content: "" });
        const contentEl = document.createElement("div");

        await renderTextContent(note, "", $(contentEl), { block: "b1" });

        expect(contentEl.querySelector(".block-reference-broken")).not.toBeNull();
    });

    it("embeds blocks of the note itself, and stops at a block that embeds itself", async () => {
        const note = buildNote({
            id: "blkSelf",
            title: "Self",
            content: "<p data-trilium-block-id=\"top\">Top</p>"
                + blockEmbed("blkSelf", "top")
                + blockEmbed("blkSelf", "loop", "medium", "loop")
        });
        const contentEl = document.createElement("div");

        await renderText(note, $(contentEl), { expandNestedEmbeds: true });

        expect(contentEl.textContent?.match(/Top/g)).toHaveLength(2);
        expect(contentEl.querySelectorAll(".include-note[data-block='loop']")).toHaveLength(1);
    });

    it("highlights the referenced blocks of the note, not those of its embeds", async () => {
        buildNote({
            id: "hlSource",
            title: "Source",
            content: "<p data-trilium-block-id=\"b1\">Embedded</p>"
        });
        const note = buildNote({
            title: "Host",
            content: blockEmbed("hlSource", "b1")
                + "<p data-trilium-block-id=\"b1\">Own</p><p data-trilium-block-id=\"b2\">Next</p>"
                + "<p>Outro</p>"
        });
        const contentEl = document.createElement("div");

        await renderText(note, $(contentEl), { highlightBlock: "b1:b2" });

        expect([ ...contentEl.querySelectorAll(".block-reference-highlight") ]
            .map((element) => element.textContent)).toEqual([ "Own", "Next" ]);
    });

    it("links to the blocks of an embed one level down", async () => {
        const note = buildNote({ title: "Host", content: blockEmbed("blkSource", "b1:b 2") });
        const contentEl = document.createElement("div");

        await renderText(note, $(contentEl), { embedsAsReferenceLinks: true });

        expect(contentEl.querySelector("a.reference-link")?.getAttribute("href"))
            .toBe("#root/blkSource?block=b1:b%202");
    });
});
