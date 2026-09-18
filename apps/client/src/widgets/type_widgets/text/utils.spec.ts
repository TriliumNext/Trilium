import { beforeEach, describe, expect, it, vi } from "vitest";

import type FNote from "../../../entities/fnote";

vi.mock("../../../components/app_context", () => ({
    default: {
        triggerCommand: vi.fn(),
        tabManager: { getActiveContext: vi.fn(), openTabWithNoteWithHoisting: vi.fn() }
    }
}));
vi.mock("../../../services/froca", () => ({
    default: { getNote: vi.fn(), getAttachment: vi.fn() }
}));
vi.mock("../../../services/link", () => ({
    default: { createLink: vi.fn() }
}));
vi.mock("../../../services/content_renderer", () => ({
    default: { getRenderedContent: vi.fn(), disposeInteractiveContent: vi.fn() }
}));

import appContext from "../../../components/app_context";
import content_renderer from "../../../services/content_renderer";
import froca from "../../../services/froca";
import link from "../../../services/link";
import type { ExpansionTarget } from "./utils";
import { loadIncludedNote, resolveExpansionTarget, setupContentExpansion, setupImageOpening } from "./utils";

const note = { noteId: "noteY" } as unknown as FNote;

describe("loadIncludedNote", () => {
    beforeEach(() => {
        vi.mocked(froca.getNote).mockResolvedValue(note);
        vi.mocked(link.createLink).mockResolvedValue($('<span class="link"><a href="#">noteY</a></span>'));
        vi.mocked(content_renderer.getRenderedContent).mockResolvedValue({ $renderedContent: $("<p>body</p>"), type: "text" } as never);
        vi.mocked(content_renderer.disposeInteractiveContent).mockReset();
    });

    it("reuses the wrapper element without nesting a second one (editing-view path)", async () => {
        // The editing-view downcast hands us the `.include-note-wrapper` element itself.
        const $el = $('<div class="include-note-wrapper">');

        await loadIncludedNote("noteY", $el, "small");

        const wrappers = $el.find(".include-note-wrapper");
        expect(wrappers.length).toBe(0);
        expect($el.children(".include-note-title").length).toBe(1);
        expect($el.children(".include-note-content").length).toBe(1);
    });

    it("builds a single wrapper inside the section (read-only / refresh path)", async () => {
        // The read-only and refresh paths hand us the outer `section.include-note`.
        const $el = $('<section class="include-note" data-note-id="noteY">');

        await loadIncludedNote("noteY", $el, "small");

        const wrappers = $el.find(".include-note-wrapper");
        expect(wrappers.length).toBe(1);
        expect(wrappers.children(".include-note-title").length).toBe(1);
        expect(wrappers.children(".include-note-content").length).toBe(1);
    });

    it("builds an expandable include (toggle) and degrades the note's own includes to reference links", async () => {
        const $el = $('<div class="include-note-wrapper">');

        await loadIncludedNote("noteY", $el, "expandable");

        // The expandable branch adds a title row with a toggle button.
        expect($el.children(".include-note-title-row").length).toBe(1);
        expect($el.find("button.include-note-toggle").length).toBe(1);
        // The included note is rendered with its own includes reduced to reference links.
        expect(content_renderer.getRenderedContent).toHaveBeenCalledWith(note, { interactive: true, includesAsReferenceLinks: true, mediaEnvironment: "embedded" });
    });

    it("disposes interactive content of a previous render before replacing it", async () => {
        const $el = $('<div class="include-note-wrapper">');

        await loadIncludedNote("noteY", $el, "small");

        expect(content_renderer.disposeInteractiveContent).toHaveBeenCalledWith($el);
    });
});

const MERMAID_ID = "mermaid-inline-0";

describe("resolveExpansionTarget", () => {
    it("serializes a read-only mermaid diagram, retargeting every reference to the svg id", () => {
        const container = buildContainer(`
            <div class="mermaid-diagram" data-processed="true">
                <svg id="${MERMAID_ID}" viewBox="0 0 640 320" width="100%" style="max-width: 640px;">
                    <marker id="${MERMAID_ID}_marker"></marker>
                    <g class="node" marker-end="url(#${MERMAID_ID}_marker)"></g>
                </svg>
            </div>`);
        addSvgStyle(requireEl(container, "svg"), `#${MERMAID_ID} .node { fill: red; }`);

        const svg = expectSvgPayload(resolveExpansionTarget(requireEl(container, "g.node"), { codeBlocks: true }));

        expect(svg).toContain(`id="${MERMAID_ID}-lightbox"`);
        expect(svg).not.toContain(`id="${MERMAID_ID}"`);
        expect(svg).toContain(`#${MERMAID_ID}-lightbox .node`);
        expect(svg).toContain(`url(#${MERMAID_ID}-lightbox_marker)`);
        // The viewBox gives the natural size a `fit-content` lightbox box can lay out.
        expect(svg).toContain('width="640"');
        expect(svg).toContain('height="320"');
        expect(svg).not.toContain("max-width");
    });

    it("leaves an svg without a viewBox or an id untouched", () => {
        const noViewBox = buildContainer(`
            <div class="mermaid-diagram" data-processed="true">
                <svg id="s2" width="100%" style="max-width: 300px;"><g class="node"></g></svg>
            </div>`);
        const kept = expectSvgPayload(resolveExpansionTarget(requireEl(noViewBox, "g.node"), { codeBlocks: true }));
        expect(kept).toContain('width="100%"');
        expect(kept).toContain("max-width: 300px");
        expect(kept).toContain('id="s2-lightbox"');

        const noId = buildContainer(`
            <div class="mermaid-diagram" data-processed="true">
                <svg viewBox="0 0 10 20"><g class="node"></g></svg>
            </div>`);
        const asIs = expectSvgPayload(resolveExpansionTarget(requireEl(noId, "g.node"), { codeBlocks: true }));
        expect(asIs).toContain('width="10"');
        expect(asIs).not.toContain("lightbox");
    });

    it("sizes from a viewBox that carries surrounding whitespace", () => {
        const container = buildContainer(`
            <div class="mermaid-diagram" data-processed="true">
                <svg id="pad0" viewBox=" 0 0 640 320" width="100%" style="max-width: 640px;"><g class="node"></g></svg>
            </div>`);

        const svg = expectSvgPayload(resolveExpansionTarget(requireEl(container, "g.node"), { codeBlocks: true }));
        expect(svg).toContain('width="640"');
        expect(svg).toContain('height="320"');
    });

    it("resolves the edit-mode mermaid preview", () => {
        const container = buildContainer(`
            <div class="ck-mermaid__wrapper">
                <textarea class="ck-mermaid__editing-view">graph TD;</textarea>
                <div class="ck-mermaid__preview"><svg id="edit0" viewBox="0 0 100 50"><g class="node"></g></svg></div>
            </div>`);

        const svg = expectSvgPayload(resolveExpansionTarget(requireEl(container, "g.node"), { codeBlocks: false }));
        expect(svg).toContain('id="edit0-lightbox"');
    });

    it("navigates to an included mermaid note, even when nested inside another include", () => {
        const container = buildContainer(`
            <section class="include-note" data-note-id="outer">
                <div class="include-note-wrapper">
                    <div class="include-note-content type-text">
                        <section class="include-note" data-note-id="n1">
                            <div class="include-note-wrapper">
                                <div class="include-note-content type-mermaid">
                                    <div class="rendered-content"><svg id="inc0"><g class="node"></g></svg></div>
                                </div>
                            </div>
                        </section>
                    </div>
                </div>
            </section>`);

        expect(resolveExpansionTarget(requireEl(container, "g.node"), { codeBlocks: true })).toEqual({ type: "navigate", noteId: "n1" });
    });

    it("resolves read-only math to the widest KaTeX wrapper available", () => {
        const display = buildContainer(`<span class="math-tex"><span class="katex-display"><span class="katex">E</span></span></span>`);
        expect(expectHtmlPayload(resolveExpansionTarget(requireEl(display, ".katex"), { codeBlocks: true })))
            .toBe(requireEl(display, ".katex-display").outerHTML);

        const inline = buildContainer(`<span class="math-tex"><span class="katex">E</span></span>`);
        expect(expectHtmlPayload(resolveExpansionTarget(requireEl(inline, ".katex"), { codeBlocks: true })))
            .toBe(requireEl(inline, ".katex").outerHTML);
    });

    it("resolves edit-mode math", () => {
        const container = buildContainer(`<span class="ck-math-tex ck-math-tex-inline"><div><span class="katex">E</span></div></span>`);
        expect(expectHtmlPayload(resolveExpansionTarget(requireEl(container, ".katex"), { codeBlocks: false })))
            .toBe(requireEl(container, ".katex").outerHTML);
    });

    it("resolves a code block with its language token", () => {
        const css = buildContainer(`<pre class="hljs"><code class="language-text-css">body { color: red; }</code><button class="copy-button"></button></pre>`);
        expect(resolveExpansionTarget(requireEl(css, "code"), { codeBlocks: true }))
            .toEqual({ type: "lightbox", data: { kind: "code", code: "body { color: red; }", language: "text-css" } });

        const auto = buildContainer(`<pre><code class="language-text-x-trilium-auto">hi</code></pre>`);
        expect(resolveExpansionTarget(requireEl(auto, "code"), { codeBlocks: true }))
            .toEqual({ type: "lightbox", data: { kind: "code", code: "hi", language: "text-x-trilium-auto" } });

        const plain = buildContainer(`<pre><code>hi</code></pre>`);
        expect(resolveExpansionTarget(requireEl(plain, "code"), { codeBlocks: true }))
            .toEqual({ type: "lightbox", data: { kind: "code", code: "hi", language: null } });
    });

    it("ignores targets that own the gesture or are not ready", () => {
        const link = buildContainer(`<a href="#"><span class="math-tex"><span class="katex">E</span></span></a>`);
        expect(resolveExpansionTarget(requireEl(link, ".katex"), { codeBlocks: true })).toBeNull();

        const copyButton = buildContainer(`<pre><code class="language-text-css">a</code><button class="copy-button"></button></pre>`);
        expect(resolveExpansionTarget(requireEl(copyButton, "button.copy-button"), { codeBlocks: true })).toBeNull();

        const textarea = buildContainer(`<div class="ck-mermaid__wrapper"><textarea class="ck-mermaid__editing-view">graph TD;</textarea></div>`);
        expect(resolveExpansionTarget(requireEl(textarea, "textarea"), { codeBlocks: false })).toBeNull();

        const unprocessed = buildContainer(`<div class="mermaid-diagram"><svg id="p0"><g class="node"></g></svg></div>`);
        expect(resolveExpansionTarget(requireEl(unprocessed, "g.node"), { codeBlocks: true })).toBeNull();

        const unrendered = buildContainer(`<span class="ck-math-tex ck-math-tex-inline"><div>\\(E\\)</div></span>`);
        expect(resolveExpansionTarget(requireEl(unrendered, "div"), { codeBlocks: true })).toBeNull();
    });

    it("skips code blocks when they are disabled, without affecting the other shapes", () => {
        const code = buildContainer(`<pre><code class="language-text-css">a</code></pre>`);
        expect(resolveExpansionTarget(requireEl(code, "code"), { codeBlocks: false })).toBeNull();

        const math = buildContainer(`<span class="math-tex"><span class="katex">E</span></span>`);
        expect(resolveExpansionTarget(requireEl(math, ".katex"), { codeBlocks: false })).not.toBeNull();
    });
});

describe("setupContentExpansion", () => {
    const activeContext = { setNote: vi.fn() };

    beforeEach(() => {
        vi.mocked(appContext.triggerCommand).mockReset();
        vi.mocked(appContext.tabManager.openTabWithNoteWithHoisting).mockReset();
        activeContext.setNote.mockReset();
        vi.mocked(appContext.tabManager.getActiveContext).mockReturnValue(activeContext as never);
    });

    it("opens the lightbox once on a double click, however many times it is installed", () => {
        const container = buildContainer(`
            <div class="mermaid-diagram" data-processed="true">
                <svg id="${MERMAID_ID}" viewBox="0 0 640 320"><g class="node"></g></svg>
            </div>`);

        setupContentExpansion(container, { codeBlocks: true });
        setupContentExpansion(container, { codeBlocks: true });
        requireEl(container, "g.node").dispatchEvent(mouseEvent("dblclick"));

        expect(appContext.triggerCommand).toHaveBeenCalledTimes(1);
        expect(appContext.triggerCommand).toHaveBeenCalledWith("showContentLightbox", { kind: "svg", svg: expect.stringContaining(`id="${MERMAID_ID}-lightbox"`) });
    });

    it("navigates to an included note like an image does", () => {
        const container = includedMermaidContainer();
        setupContentExpansion(container, { codeBlocks: true });
        const svg = requireEl(container, "g.node");

        svg.dispatchEvent(mouseEvent("click", { ctrlKey: true }));
        expect(appContext.tabManager.openTabWithNoteWithHoisting).toHaveBeenCalledWith("n1", { activate: false });

        // Browsers deliver a non-primary button as `auxclick`, so this covers the contract mirrored
        // from `setupImageOpening` rather than a gesture reachable in the app.
        svg.dispatchEvent(mouseEvent("click", { which: 2, shiftKey: true }));
        expect(appContext.tabManager.openTabWithNoteWithHoisting).toHaveBeenLastCalledWith("n1", { activate: true });

        svg.dispatchEvent(mouseEvent("click"));
        expect(appContext.tabManager.openTabWithNoteWithHoisting).toHaveBeenCalledTimes(2);
        expect(activeContext.setNote).not.toHaveBeenCalled();

        svg.dispatchEvent(mouseEvent("dblclick"));
        expect(activeContext.setNote).toHaveBeenCalledWith("n1");
    });

    it("resolves only the navigate case on a modifier click, leaving a diagram unserialized", () => {
        const container = buildContainer(`
            <div class="mermaid-diagram" data-processed="true">
                <svg id="${MERMAID_ID}" viewBox="0 0 640 320"><g class="node"></g></svg>
            </div>`);
        setupContentExpansion(container, { codeBlocks: true });
        const node = requireEl(container, "g.node");
        // `serializeSvgForLightbox` clones the svg before it serializes, so an uncalled `cloneNode`
        // proves no payload was built. Spying the element keeps this off the prototype.
        const cloneNode = vi.spyOn(requireEl(container, "svg"), "cloneNode");

        node.dispatchEvent(mouseEvent("click", { ctrlKey: true }));
        node.dispatchEvent(mouseEvent("click", { which: 2 }));

        expect(cloneNode).not.toHaveBeenCalled();
        expect(appContext.triggerCommand).not.toHaveBeenCalled();
        expect(appContext.tabManager.openTabWithNoteWithHoisting).not.toHaveBeenCalled();
        expect(activeContext.setNote).not.toHaveBeenCalled();

        // A double click still opens the lightbox, so the spy watches a call that does happen.
        node.dispatchEvent(mouseEvent("dblclick"));
        expect(cloneNode).toHaveBeenCalled();
        expect(appContext.triggerCommand).toHaveBeenCalledTimes(1);
    });

    it("installs nothing for the print renderer", () => {
        const original = window.glob.device;
        window.glob.device = "print";
        try {
            const container = includedMermaidContainer();
            setupContentExpansion(container, { codeBlocks: true });
            requireEl(container, "g.node").dispatchEvent(mouseEvent("dblclick"));
        } finally {
            window.glob.device = original;
        }

        expect(activeContext.setNote).not.toHaveBeenCalled();
        expect(appContext.triggerCommand).not.toHaveBeenCalled();
    });
});

describe("setupImageOpening", () => {
    it("opens an image once however many times it is installed", async () => {
        const activeContext = { setNote: vi.fn() };
        vi.mocked(appContext.tabManager.getActiveContext).mockReturnValue(activeContext as never);
        const container = buildContainer(`<img src="http://localhost/api/images/n1/pic.png">`);

        setupImageOpening(container, true);
        setupImageOpening(container, true);
        requireEl(container, "img").dispatchEvent(mouseEvent("dblclick"));
        await vi.waitFor(() => expect(activeContext.setNote).toHaveBeenCalled());

        expect(activeContext.setNote).toHaveBeenCalledTimes(1);
        expect(activeContext.setNote).toHaveBeenCalledWith("n1", { viewScope: {} });
    });
});

function buildContainer(html: string) {
    const container = document.createElement("div");
    container.innerHTML = html;
    return container;
}

function includedMermaidContainer() {
    return buildContainer(`
        <section class="include-note" data-note-id="n1">
            <div class="include-note-wrapper">
                <div class="include-note-content type-mermaid">
                    <div class="rendered-content"><svg id="inc0"><g class="node"></g></svg></div>
                </div>
            </div>
        </section>`);
}

/** happy-dom drops the text of a `<style>` parsed inside an `<svg>`, so mermaid's scoped rules are added as a node. */
function addSvgStyle(svg: Element, css: string) {
    const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
    style.textContent = css;
    svg.prepend(style);
}

function requireEl<T extends Element>(root: ParentNode, selector: string): T {
    const el = root.querySelector<T>(selector);
    if (!el) throw new Error(`Fixture is missing "${selector}"`);
    return el;
}

/** happy-dom's `MouseEvent` has no legacy `which`, which is how jQuery tells a left click from a middle one. */
function mouseEvent(type: string, { which = 1, ...init }: MouseEventInit & { which?: number } = {}) {
    const event = new MouseEvent(type, { bubbles: true, ...init });
    Object.defineProperty(event, "which", { value: which });
    return event;
}

function expectSvgPayload(result: ExpansionTarget | null) {
    if (result?.type !== "lightbox" || result.data.kind !== "svg") {
        throw new Error(`Expected an svg lightbox payload, got ${JSON.stringify(result)}`);
    }
    return result.data.svg;
}

function expectHtmlPayload(result: ExpansionTarget | null) {
    if (result?.type !== "lightbox" || result.data.kind !== "html") {
        throw new Error(`Expected an html lightbox payload, got ${JSON.stringify(result)}`);
    }
    return result.data.html;
}
