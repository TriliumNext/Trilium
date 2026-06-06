import { OptionNames } from "@triliumnext/commons";
import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the component import) -------------------------------------------
// The CSS imports + the heavy CKEditor bundle are stubbed; the transform services are mocked so we
// can assert the layout-effect pipeline runs without executing real (mermaid/math/highlight) work.

vi.mock("./ReadOnlyText.css", () => ({}));
vi.mock("@triliumnext/ckeditor5", () => ({}));

vi.mock("../../../services/content_renderer_text", () => ({
    applyInlineMermaid: vi.fn(),
    rewriteMermaidDiagramsInContainer: vi.fn()
}));
vi.mock("../../../services/link_embed", () => ({
    applyLinkEmbeds: vi.fn()
}));
vi.mock("../../../services/math", () => ({
    renderMathInElement: vi.fn()
}));
vi.mock("../../../services/syntax_highlight", () => ({
    formatCodeBlocks: vi.fn()
}));
vi.mock("./read_only_helper", () => ({
    applyReferenceLinks: vi.fn()
}));
vi.mock("./utils", () => ({
    loadIncludedNote: vi.fn(),
    refreshIncludedNote: vi.fn(),
    setupImageOpening: vi.fn()
}));

import appContext from "../../../components/app_context";
import Component from "../../../components/component";
import type NoteContext from "../../../components/note_context";
import { applyInlineMermaid, rewriteMermaidDiagramsInContainer } from "../../../services/content_renderer_text";
import { applyLinkEmbeds } from "../../../services/link_embed";
import { renderMathInElement } from "../../../services/math";
import options from "../../../services/options";
import { formatCodeBlocks } from "../../../services/syntax_highlight";
import { buildNote } from "../../../test/easy-froca";
import { fakeNoteContext, flush, renderComponent } from "../../../test/render";
import { applyReferenceLinks } from "./read_only_helper";
import ReadOnlyText, { ReadOnlyTextContent } from "./ReadOnlyText";
import { loadIncludedNote, refreshIncludedNote, setupImageOpening } from "./utils";

// --- Render harness ------------------------------------------------------------------------------

// A module-level `parent` is shared between the renders and `fireEvent` so that events dispatched
// after a render reach the component's `useTriliumEvent` handlers. The shared `renderComponent`
// auto-tears-down the mounted container in its own `afterEach`.
let parent: Component;

function renderInto(vnode: preact.ComponentChild, noteContext: NoteContext | null = null) {
    return renderComponent(vnode, { parent, noteContext }).container;
}

function fireEvent(name: string, data: unknown) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    act(() => { (parent.handleEventInChildren as any)(name, data); });
}

beforeEach(() => {
    parent = new Component();
    options.load({ codeBlockWordWrap: "false", codeBlockTabWidth: "4" } as Record<OptionNames, string>);
    vi.clearAllMocks(); // reset call counts on the hoisted module mocks between tests
});

// --- ReadOnlyTextContent: the transform pipeline -------------------------------------------------

describe("ReadOnlyTextContent", () => {
    it("renders the html into a content div with the expected classes", () => {
        const el = renderInto(<ReadOnlyTextContent html="<p>hello</p>" dir="ltr" />);
        const content = el.querySelector("div.note-detail-readonly-text-content");
        expect(content).not.toBeNull();
        expect(content?.className).toContain("ck-content");
        expect(content?.className).toContain("use-tn-links");
        expect(content?.className).toContain("selectable-text");
        expect(content?.innerHTML).toContain("hello");
    });

    it("runs the full transform pipeline in the layout effect", () => {
        renderInto(<ReadOnlyTextContent html="<p>x</p>" />);
        expect(rewriteMermaidDiagramsInContainer).toHaveBeenCalledTimes(1);
        expect(applyInlineMermaid).toHaveBeenCalledTimes(1);
        expect(applyLinkEmbeds).toHaveBeenCalledTimes(1);
        expect(applyReferenceLinks).toHaveBeenCalledTimes(1);
        expect(formatCodeBlocks).toHaveBeenCalledTimes(1);
        expect(setupImageOpening).toHaveBeenCalledTimes(1);
        // setupImageOpening is called with the container element and singleClickOpens = true.
        const lastCall = (setupImageOpening as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(lastCall?.[1]).toBe(true);
    });

    it("expands included-note sections by calling loadIncludedNote per valid noteId", () => {
        const html = `
            <section class="include-note" data-note-id="incl1"></section>
            <section class="include-note"></section>
        `;
        renderInto(<ReadOnlyTextContent html={html} />);
        // Only the section with a data-note-id is loaded; the one without is skipped.
        expect(loadIncludedNote).toHaveBeenCalledTimes(1);
        expect((loadIncludedNote as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toBe("incl1");
    });

    it("renders inline math for each .math-tex element", () => {
        const html = `<span class="math-tex">a</span><span class="math-tex">b</span>`;
        renderInto(<ReadOnlyTextContent html={html} />);
        expect(renderMathInElement).toHaveBeenCalledTimes(2);
        expect((renderMathInElement as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]).toEqual({ trust: true });
    });

    it("triggers contentElRefreshed only when an ntxId is provided", () => {
        const triggerEvent = vi.spyOn(appContext, "triggerEvent").mockReturnValue(undefined as never);

        renderInto(<ReadOnlyTextContent html="<p>a</p>" />);
        expect(triggerEvent).not.toHaveBeenCalled();

        renderInto(<ReadOnlyTextContent html="<p>b</p>" ntxId="ntxA" />);
        expect(triggerEvent).toHaveBeenCalledWith("contentElRefreshed", expect.objectContaining({ ntxId: "ntxA" }));
    });

    it("sets the --code-block-tab-width css var from the option", () => {
        options.load({ codeBlockWordWrap: "false", codeBlockTabWidth: "8" } as Record<OptionNames, string>);
        renderInto(<ReadOnlyTextContent html="" />);
        expect(document.body.style.getPropertyValue("--code-block-tab-width")).toBe("8");
    });

    it("falls back to a tab-width of 4 when the option is empty", () => {
        options.load({ codeBlockWordWrap: "false", codeBlockTabWidth: "" } as Record<OptionNames, string>);
        renderInto(<ReadOnlyTextContent html="" />);
        expect(document.body.style.getPropertyValue("--code-block-tab-width")).toBe("4");
    });

    it("adds the word-wrap class and a custom className when configured", () => {
        options.load({ codeBlockWordWrap: "true", codeBlockTabWidth: "4" } as Record<OptionNames, string>);
        const el = renderInto(<ReadOnlyTextContent html="" className="extra-class" />);
        const content = el.querySelector("div.note-detail-readonly-text-content");
        expect(content?.className).toContain("word-wrap");
        expect(content?.className).toContain("extra-class");
    });

    it("refreshes included notes when the matching ntxId-agnostic refreshIncludedNote event fires", () => {
        renderInto(<ReadOnlyTextContent html="<p>x</p>" ntxId="ntxRefresh" />);
        fireEvent("refreshIncludedNote", { noteId: "n123" });
        expect(refreshIncludedNote).toHaveBeenCalledTimes(1);
        expect((refreshIncludedNote as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]).toBe("n123");
    });

    it("resolves executeWithContentElement for the matching ntxId and ignores others", () => {
        renderInto(<ReadOnlyTextContent html="<p>x</p>" ntxId="ntxExec" />);

        const resolveMatch = vi.fn();
        fireEvent("executeWithContentElement", { resolve: resolveMatch, ntxId: "ntxExec" });
        expect(resolveMatch).toHaveBeenCalledTimes(1);

        const resolveOther = vi.fn();
        fireEvent("executeWithContentElement", { resolve: resolveOther, ntxId: "other" });
        expect(resolveOther).not.toHaveBeenCalled();
    });

    it("ignores executeWithContentElement entirely when the component has no ntxId", () => {
        renderInto(<ReadOnlyTextContent html="<p>x</p>" />);
        const resolve = vi.fn();
        fireEvent("executeWithContentElement", { resolve, ntxId: "anything" });
        expect(resolve).not.toHaveBeenCalled();
    });

    it("re-runs the pipeline when the html prop changes", () => {
        const { container: el, rerender } = renderComponent(<ReadOnlyTextContent html="<p>one</p>" />, { parent });
        expect(formatCodeBlocks).toHaveBeenCalledTimes(1);

        rerender(<ReadOnlyTextContent html="<p>two</p>" />);
        expect(formatCodeBlocks).toHaveBeenCalledTimes(2);
        expect(el.querySelector("div.note-detail-readonly-text-content")?.innerHTML).toContain("two");
    });
});

// --- ReadOnlyText (top-level widget) -------------------------------------------------------------

describe("ReadOnlyText", () => {
    function renderWidget(noteId: string, opts: { language?: string; content?: string; ntxId?: string; noteContext?: NoteContext | null } = {}) {
        const note = buildNote({
            id: noteId,
            title: "T",
            content: opts.content ?? "<p>body</p>",
            ...(opts.language ? { "#language": opts.language } : {})
        });
        const el = renderInto(
            <ReadOnlyText note={note} noteContext={opts.noteContext ?? undefined} ntxId={opts.ntxId} viewScope={undefined} parentComponent={undefined} />,
            opts.noteContext ?? null
        );
        return { note, el };
    }

    it("renders the resolved blob content for a non-RTL language", async () => {
        const { el } = renderWidget("roNote1", { language: "en", content: "<p>english</p>" });
        await flush();
        const content = el.querySelector("div.note-detail-readonly-text-content");
        expect(content?.innerHTML).toContain("english");
    });

    it("resolves an RTL language label without errors (exercises the rtl branch)", async () => {
        // `ar` is a known RTL locale; this drives useNoteLanguage's rtl=true path.
        const { el } = renderWidget("roNote2", { language: "ar", content: "<p>arabic</p>" });
        await flush();
        const content = el.querySelector("div.note-detail-readonly-text-content");
        expect(content?.innerHTML).toContain("arabic");
    });

    it("renders empty content (no blob yet) as an empty content div", () => {
        const note = buildNote({ id: "roNote3", title: "T", content: "<p>x</p>" });
        // Render synchronously before flush(): blob hasn't resolved, so html falls back to "".
        const el = renderInto(
            <ReadOnlyText note={note} noteContext={undefined} ntxId={undefined} viewScope={undefined} parentComponent={undefined} />
        );
        const content = el.querySelector("div.note-detail-readonly-text-content");
        expect(content).not.toBeNull();
        expect(content?.innerHTML).toBe("");
    });

    it("consumes the bookmark from the view scope when one is set", async () => {
        const viewScope = { viewMode: "default", bookmark: "anchor-1" } as Record<string, unknown>;
        const noteContext = fakeNoteContext({ viewScope });
        const scrollIntoView = vi.fn();
        // happy-dom elements lack scrollIntoView; stub it on the prototype so the path never throws.
        const original = (HTMLElement.prototype as unknown as { scrollIntoView?: () => void }).scrollIntoView;
        (HTMLElement.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = scrollIntoView;
        try {
            renderWidget("roNote4", { content: `<p id="anchor-1">target</p>`, noteContext });
            await flush();
            // The bookmark-handling effect ran (guard passed) and the bookmark is consumed once.
            expect(viewScope.bookmark).toBeUndefined();
        } finally {
            if (original) {
                (HTMLElement.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = original;
            } else {
                delete (HTMLElement.prototype as unknown as { scrollIntoView?: () => void }).scrollIntoView;
            }
        }
    });

    it("skips bookmark handling when no bookmark is set on the view scope", async () => {
        const noteContext = fakeNoteContext({ viewScope: { viewMode: "default" } });
        const scrollIntoView = vi.fn();
        const original = (HTMLElement.prototype as unknown as { scrollIntoView?: () => void }).scrollIntoView;
        (HTMLElement.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = scrollIntoView;
        try {
            renderWidget("roNote6", { content: "<p>x</p>", noteContext });
            await flush();
            expect(scrollIntoView).not.toHaveBeenCalled();
        } finally {
            if (original) {
                (HTMLElement.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = original;
            } else {
                delete (HTMLElement.prototype as unknown as { scrollIntoView?: () => void }).scrollIntoView;
            }
        }
    });
});
