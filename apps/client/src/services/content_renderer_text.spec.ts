// @vitest-environment jsdom
// DOMPurify relies on browser-faithful DOM traversal (NodeIterator); happy-dom
// mishandles it and strips valid markup (surfaced by dompurify 3.4.8). Run the
// sanitization-dependent specs under jsdom, which matches real-browser behavior.
import { trimIndentation } from "@triliumnext/commons";
import { beforeEach, describe, expect, it, vi } from "vitest";

import FAttachment from "../entities/fattachment";
import froca from "./froca";
import server from "./server";
import { buildNote } from "../test/easy-froca";

// `applyInlineMermaid` dynamically imports "mermaid"; provide a controllable
// stub whose behavior we tune per-test via the shared `mermaidRunImpl` hook.
let mermaidRunImpl: (args: { nodes: HTMLElement[] }) => void | Promise<void> = () => {};
const mermaidInitialize = vi.fn();
vi.mock("mermaid", () => ({
    default: {
        initialize: (...args: unknown[]) => mermaidInitialize(...args),
        run: (args: { nodes: HTMLElement[] }) => mermaidRunImpl(args)
    }
}));

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
    rewriteMermaidDiagramsInContainer
} from "./content_renderer_text";

describe("Text content renderer", () => {
    it("renders included note", async () => {
        const contentEl = document.createElement("div");
        const includedNote = buildNote({
            title: "Included note",
            content: "<p>This is the included note.</p>"
        });
        const note = buildNote({
            title: "New note",
            content: trimIndentation`
                <p>
                    Hi there
                </p>
                <section class="include-note" data-note-id="${includedNote.noteId}" data-box-size="medium">
                    &nbsp;
                </section>
            `
        });
        await renderText(note, $(contentEl));
        expect(contentEl.querySelectorAll("section.include-note").length).toBe(1);
        expect(contentEl.querySelectorAll("section.include-note p").length).toBe(1);
    });

    it("skips rendering included note", async () => {
        const contentEl = document.createElement("div");
        const includedNote = buildNote({
            title: "Included note",
            content: "<p>This is the included note.</p>"
        });
        const note = buildNote({
            title: "New note",
            content: trimIndentation`
                <p>
                    Hi there
                </p>
                <section class="include-note" data-note-id="${includedNote.noteId}" data-box-size="medium">
                    &nbsp;
                </section>
            `
        });
        await renderText(note, $(contentEl), { noIncludedNotes: true });
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
        // with the rendered content element ($renderedContent[0]) and the trust flag.
        expect(renderMathInElementSpy).toHaveBeenCalledTimes(1);
        expect(renderMathInElementSpy).toHaveBeenCalledWith(contentEl, { trust: true });
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
});

describe("renderIncludedNotes via postProcessRichContent", () => {
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
        expect(div?.innerHTML).toContain("graph TD;");
        expect(container.querySelector("pre")).toBeNull();
    });

    it("uses an empty body when the code element is missing", async () => {
        const container = document.createElement("div");
        // A <pre> matched by :has(code[...]) but where querySelector("code") returns
        // the matched code (with no inner content) -> innerHTML falls back to "".
        container.innerHTML = `<pre><code class="language-mermaid"></code></pre>`;
        await rewriteMermaidDiagramsInContainer(container);
        const div = container.querySelector("div.mermaid-diagram");
        expect(div).not.toBeNull();
        expect(div?.innerHTML).toBe("");
    });
});

describe("applyInlineMermaid", () => {
    beforeEach(() => {
        mermaidRunImpl = () => {};
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
        mermaidRunImpl = ({ nodes }) => {
            for (const node of nodes) {
                node.innerHTML = "<svg>A</svg>";
                node.setAttribute("data-processed", "true");
            }
        };
        await applyInlineMermaid(container);
        expect(mermaidInitialize).toHaveBeenCalledTimes(1);
        const visible = container.querySelector("div.mermaid-diagram") as HTMLElement;
        expect(visible.innerHTML).toBe("<svg>A</svg>");
        expect(visible.getAttribute("data-processed")).toBe("true");
        // Offscreen render container is cleaned up.
        expect(document.body.querySelectorAll("div").length).toBe(0);
    });

    it("paints cached SVG without re-running mermaid on a second pass", async () => {
        const container = makeContainer(["graph CACHE"]);
        let runCount = 0;
        mermaidRunImpl = ({ nodes }) => {
            runCount++;
            for (const node of nodes) {
                node.innerHTML = "<svg>CACHE</svg>";
                node.setAttribute("data-processed", "true");
            }
        };
        await applyInlineMermaid(container);
        expect(runCount).toBe(1);

        // Reset the visible node so we can observe the cached repaint.
        const node = container.querySelector("div.mermaid-diagram") as HTMLElement;
        node.removeAttribute("data-processed");
        node.innerHTML = "graph CACHE";
        mermaidInitialize.mockClear();

        await applyInlineMermaid(container);
        // No new render: cache hit short-circuits and pending stays empty.
        expect(runCount).toBe(1);
        expect(mermaidInitialize).not.toHaveBeenCalled();
        expect(node.innerHTML).toBe("<svg>CACHE</svg>");
        expect(node.getAttribute("data-processed")).toBe("true");
    });

    it("shows the previous SVG as a placeholder while the new diagram renders", async () => {
        const container = makeContainer(["graph V1"]);
        mermaidRunImpl = ({ nodes }) => {
            for (const node of nodes) {
                node.innerHTML = `<svg>${node.textContent}</svg>`;
                node.setAttribute("data-processed", "true");
            }
        };
        await applyInlineMermaid(container);

        // Edit the diagram source in place; the old SVG should be used as the
        // positional placeholder for the new (uncached) source.
        const node = container.querySelector("div.mermaid-diagram") as HTMLElement;
        const previousSvg = node.innerHTML;
        node.textContent = "graph V2";

        let placeholderDuringRun = "";
        mermaidRunImpl = ({ nodes }) => {
            placeholderDuringRun = node.innerHTML;
            for (const clone of nodes) {
                clone.innerHTML = `<svg>${clone.textContent}</svg>`;
                clone.setAttribute("data-processed", "true");
            }
        };
        await applyInlineMermaid(container);
        expect(placeholderDuringRun).toBe(previousSvg);
        expect(node.innerHTML).toBe("<svg>graph V2</svg>");
    });

    it("evicts cache entries whose source is no longer present", async () => {
        const container = makeContainer(["graph KEEP", "graph DROP"]);
        mermaidRunImpl = ({ nodes }) => {
            for (const node of nodes) {
                node.innerHTML = `<svg>${node.textContent}</svg>`;
                node.setAttribute("data-processed", "true");
            }
        };
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

    it("logs but does not throw when mermaid.run rejects", async () => {
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        const container = makeContainer(["graph BOOM"]);
        mermaidRunImpl = () => {
            throw new Error("mermaid failed");
        };
        await applyInlineMermaid(container);
        expect(error).toHaveBeenCalled();
        error.mockRestore();
    });

    it("leaves the visible node untouched when the offscreen clone was not processed", async () => {
        const container = makeContainer(["graph SKIP"]);
        mermaidRunImpl = () => {
            // Render succeeds but never marks the clone as processed.
        };
        await applyInlineMermaid(container);
        const node = container.querySelector("div.mermaid-diagram") as HTMLElement;
        // Visible node keeps its original source text; no SVG was applied.
        expect(node.getAttribute("data-processed")).toBeNull();
        expect(node.innerHTML).toBe("graph SKIP");
    });
});
