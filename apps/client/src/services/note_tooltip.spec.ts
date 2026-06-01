import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import $ from "jquery";

// --- Mocks (hoisted above imports) ---

const { parseNavigationStateFromUrl, renderNormalAttributes, getRenderedContent, getNoteTitleWithPathAsSuffix, getActiveContext } = vi.hoisted(() => ({
    parseNavigationStateFromUrl: vi.fn(),
    renderNormalAttributes: vi.fn(),
    getRenderedContent: vi.fn(),
    getNoteTitleWithPathAsSuffix: vi.fn(),
    getActiveContext: vi.fn()
}));

vi.mock("./link.js", () => ({
    default: { parseNavigationStateFromUrl }
}));

vi.mock("./attribute_renderer.js", () => ({
    default: { renderNormalAttributes }
}));

vi.mock("./content_renderer.js", () => ({
    default: { getRenderedContent }
}));

vi.mock("./tree.js", () => ({
    default: { getNoteTitleWithPathAsSuffix }
}));

vi.mock("../components/app_context.js", () => ({
    default: { tabManager: { getActiveContext } }
}));

vi.mock("./i18n.js", () => ({
    t: (key: string) => key
}));

// Imports AFTER vi.mock calls.
import froca from "./froca.js";
import noteTooltipService, { mouseEnterHandler, renderFootnoteOrAnchor, renderTooltip } from "./note_tooltip.js";

const { setupGlobalTooltip, setupElementTooltip, dismissAllTooltips } = noteTooltipService;

/** Build a fake FNote-like object with the methods note_tooltip calls. */
function fakeNote(opts: { noteId?: string; bestPath?: string | undefined; colorClass?: string } = {}) {
    return {
        noteId: opts.noteId ?? "abc",
        getBestNotePathString: vi.fn(() => opts.bestPath),
        getColorClass: vi.fn(() => opts.colorClass ?? "")
    } as any;
}

/** A jQuery element that mimics "hovered" / "visible" for the duration of a test. */
let origFilter: typeof $.fn.filter;
let origIs: typeof $.fn.is;
let hoverActive = false;
let visibleActive = false;

beforeEach(() => {
    vi.clearAllMocks();
    hoverActive = false;
    visibleActive = false;

    origFilter = $.fn.filter;
    origIs = $.fn.is;

    // happy-dom has no layout / no real pointer, so :hover and :visible never match.
    // Override the two selectors used by note_tooltip so we can drive the hover/visible branches.
    ($.fn as any).filter = function (sel: any) {
        if (sel === ":hover") {
            return hoverActive ? this : (origFilter as any).call(this, () => false);
        }
        return origFilter.apply(this, arguments as any);
    };
    ($.fn as any).is = function (sel: any) {
        if (sel === ":visible") {
            return visibleActive;
        }
        return origIs.apply(this, arguments as any);
    };

    // Bootstrap's .tooltip() plugin is not loaded under happy-dom; stub it.
    ($.fn as any).tooltip = vi.fn(function (this: unknown) {
        return this;
    });

    // Sensible defaults for the renderTooltip dependency chain.
    renderNormalAttributes.mockResolvedValue({ $renderedAttributes: $("<div class='attrs'></div>") });
    getRenderedContent.mockResolvedValue({ $renderedContent: $("<div class='content'>body</div>") });
    getNoteTitleWithPathAsSuffix.mockResolvedValue($("<span class='note-title-with-path'>Title</span>"));
    getActiveContext.mockReturnValue({ hoistedNoteId: "root" });
});

afterEach(() => {
    // Clear any tracked tooltip elements while the .tooltip stub is still installed.
    dismissAllTooltips();
    $.fn.filter = origFilter;
    $.fn.is = origIs;
    delete ($.fn as any).tooltip;
    vi.useRealTimers();
});

describe("renderFootnoteOrAnchor", () => {
    it("extracts a footnote's content for a #fn reference", () => {
        const $root = $(`
            <div class="ck-content">
                <a class="link" href="#fn1">^</a>
                <div class="footnote-section">
                    <div class="footnote-item">
                        <a href="#fnref1">back</a>
                        <div class="footnote-content">the footnote text</div>
                    </div>
                </div>
            </div>`);
        $("body").append($root);
        const $link = $root.find("a.link");

        const result = renderFootnoteOrAnchor($link, "#fn1");
        expect(result).toContain("the footnote text");
        expect(result).toMatch(/^<div class="ck-content">/);
    });

    it("resolves an in-document anchor to its enclosing paragraph", () => {
        const $root = $(`
            <div class="ck-content">
                <a class="link" href="#sec">jump</a>
                <p id="sec">target paragraph</p>
            </div>`);
        $("body").append($root);
        const $link = $root.find("a.link");

        const result = renderFootnoteOrAnchor($link, "#sec");
        expect(result).toContain("target paragraph");
    });

    it("returns empty string when the target content is missing", () => {
        const $root = $(`<div class="ck-content"><a class="link" href="#fnX">^</a></div>`);
        $("body").append($root);
        const $link = $root.find("a.link");

        expect(renderFootnoteOrAnchor($link, "#fnX")).toBe("");
    });

    it("strips CKEditor widget buttons and rewrites inline math in editable notes", () => {
        const $root = $(`
            <div class="ck-content note-detail-editable-text-editor">
                <a class="link" href="#fn1">^</a>
                <div class="footnote-section">
                    <div class="footnote-item">
                        <a href="#fnref1">back</a>
                        <div class="footnote-content">
                            <span class="ck-widget__selection-handle">x</span>
                            <span class="ck-widget__type-around">y</span>
                            <span class="ck-widget__resizer">z</span>
                            <span class="ck-math-tex ck-math-tex-inline ck-widget">
                                <span class="katex">E=mc^2</span>
                            </span>
                        </div>
                    </div>
                </div>
            </div>`);
        $("body").append($root);
        const $link = $root.find("a.link");

        const result = renderFootnoteOrAnchor($link, "#fn1");
        // widget chrome removed
        expect(result).not.toContain("ck-widget__selection-handle");
        expect(result).not.toContain("ck-widget__type-around");
        expect(result).not.toContain("ck-widget__resizer");
        // inline math rewritten into a span.math-tex wrapper, preserving the katex node
        expect(result).toContain("math-tex");
        expect(result).toContain("E=mc^2");
    });

    it("leaves an inline math widget untouched in editable notes when it has no .katex child", () => {
        const $root = $(`
            <div class="ck-content note-detail-editable-text-editor">
                <a class="link" href="#fn2">^</a>
                <div class="footnote-section">
                    <div class="footnote-item">
                        <a href="#fnref2">back</a>
                        <div class="footnote-content">
                            <span class="ck-math-tex ck-math-tex-inline ck-widget">no katex here</span>
                        </div>
                    </div>
                </div>
            </div>`);
        $("body").append($root);
        const $link = $root.find("a.link");

        const result = renderFootnoteOrAnchor($link, "#fn2");
        expect(result).toContain("no katex here");
        // the original widget markup is preserved (no rewrite into a <span class="math-tex">)
        expect(result).toContain("ck-math-tex-inline");
        expect(result).not.toContain('class="math-tex"');
    });
});

describe("renderTooltip", () => {
    it("returns the deleted-note placeholder when the note is null", async () => {
        const html = await renderTooltip(null);
        expect(html).toBe("<div>note_tooltip.note-has-been-deleted</div>");
    });

    it("returns undefined when there is no best note path", async () => {
        const note = fakeNote({ bestPath: undefined });
        expect(await renderTooltip(note)).toBeUndefined();
        // hoistedNoteId resolved from the active context
        expect(note.getBestNotePathString).toHaveBeenCalledWith("root");
    });

    it("falls back to undefined hoistedNoteId when there is no active context", async () => {
        getActiveContext.mockReturnValue(undefined);
        const note = fakeNote({ bestPath: undefined });
        await renderTooltip(note);
        expect(note.getBestNotePathString).toHaveBeenCalledWith(undefined);
    });

    it("renders title, attributes, content and the quick-edit button when content is present", async () => {
        const note = fakeNote({ noteId: "n1", bestPath: "root/n1" });
        const html = (await renderTooltip(note)) as string;

        expect(html).toContain('class="note-tooltip-title"');
        expect(html).not.toContain("note-no-content");
        expect(html).toContain('href="#n1"');
        expect(html).toContain('class="note-tooltip-attributes"');
        // non-empty content is appended
        expect(html).toContain("body");
        // quick-edit popup button always appended
        expect(html).toContain('href="#n1?popup"');
        expect(html).toContain("note_tooltip.quick-edit");
    });

    it("marks the title as having no content and omits the content block when content is empty", async () => {
        getRenderedContent.mockResolvedValue({ $renderedContent: $("<div class='content'></div>") });
        const note = fakeNote({ noteId: "n2", bestPath: "root/n2" });
        const html = (await renderTooltip(note)) as string;

        expect(html).toContain("note-no-content");
        // empty content div should not be appended
        expect(html).not.toContain('class="content"');
        expect(html).toContain('class="note-tooltip-attributes"');
    });

    it("omits the title heading when the path suffix resolves to empty", async () => {
        getNoteTitleWithPathAsSuffix.mockResolvedValue("");
        const note = fakeNote({ noteId: "n3", bestPath: "root/n3" });
        const html = (await renderTooltip(note)) as string;

        expect(html).not.toContain("note-tooltip-title");
        expect(html.startsWith('<div class="note-tooltip-attributes">')).toBe(true);
    });
});

describe("mouseEnterHandler", () => {
    function makeLink(html: string) {
        const $el = $(html);
        $("body").append($el);
        return $el;
    }

    function eventFor($el: JQuery<HTMLElement>, pointerType = "mouse") {
        return { pointerType } as any;
    }

    it("ignores non-mouse pointer events", async () => {
        const $link = makeLink('<a href="#root/abc">x</a>');
        await mouseEnterHandler.call($link[0], eventFor($link, "touch"));
        expect(parseNavigationStateFromUrl).not.toHaveBeenCalled();
    });

    it("ignores links opted out via class, CK link actions, or inside a tooltip", async () => {
        const $a = makeLink('<a class="no-tooltip-preview" href="#root/a">a</a>');
        const $b = makeLink('<div class="ck-link-actions"><a href="#root/b">b</a></div>').find("a");
        const $c = makeLink('<div class="note-tooltip"><a href="#root/c">c</a></div>').find("a");

        await mouseEnterHandler.call($a[0], eventFor($a));
        await mouseEnterHandler.call($b[0], eventFor($b));
        await mouseEnterHandler.call($c[0], eventFor($c));

        expect(parseNavigationStateFromUrl).not.toHaveBeenCalled();
    });

    it("ignores footnote back-reference links (#fnref...)", async () => {
        const $link = makeLink('<a href="#fnref1">^</a>');
        parseNavigationStateFromUrl.mockReturnValue({ notePath: "p", noteId: "x", viewScope: { viewMode: "default" } });
        await mouseEnterHandler.call($link[0], eventFor($link));
        // returns before reading froca / showing a tooltip
        expect(($.fn as any).tooltip).not.toHaveBeenCalled();
    });

    it("bails out when navigation state is incomplete or not the default view", async () => {
        const $link = makeLink('<a data-href="#root/abc">x</a>');
        parseNavigationStateFromUrl.mockReturnValue({ notePath: "p", noteId: "x", viewScope: { viewMode: "source" } });
        await mouseEnterHandler.call($link[0], eventFor($link));
        expect(($.fn as any).tooltip).not.toHaveBeenCalled();
    });

    it("short-circuits when a tooltip for this link is already visible", async () => {
        const $link = makeLink('<a data-link-id="existing" href="#root/abc">x</a>');
        parseNavigationStateFromUrl.mockReturnValue({ notePath: "root/abc", noteId: "abc", viewScope: { viewMode: "default" } });
        visibleActive = true;

        await mouseEnterHandler.call($link[0], eventFor($link));
        expect(($.fn as any).tooltip).not.toHaveBeenCalled();
        // existing id is preserved
        expect($link.attr("data-link-id")).toBe("existing");
    });

    it("assigns a fresh random link id and skips the tooltip on the not-hovering branch", async () => {
        vi.useFakeTimers();
        const $link = makeLink('<a href="#root/abc">x</a>');
        parseNavigationStateFromUrl.mockReturnValue({ notePath: "root/abc", noteId: "abc", viewScope: { viewMode: "default" } });
        // null note renders the deleted placeholder which isHtmlEmpty treats as non-empty,
        // so the suppression here comes from the not-hovering branch (hoverActive is false),
        // NOT the empty-content guard (which is covered separately below while hovering).
        froca.getNote = vi.fn(async () => null) as any;

        const promise = mouseEnterHandler.call($link[0], eventFor($link));
        await vi.advanceTimersByTimeAsync(600);
        await promise;

        // not hovering -> no tooltip is created.
        expect(($.fn as any).tooltip).not.toHaveBeenCalled();
        // a fresh random link id was assigned
        expect($link.attr("data-link-id")).toMatch(/^link-\d+$/);
    });

    it("returns without showing a tooltip when the rendered note content is empty while hovering", async () => {
        vi.useFakeTimers();
        const $link = makeLink('<a href="#root/abc">x</a>');
        parseNavigationStateFromUrl.mockReturnValue({ notePath: "root/abc", noteId: "abc", viewScope: { viewMode: "default" } });
        // A note with no best note path makes renderTooltip resolve to `undefined`,
        // so the empty-content guard (`!content`) fires even though we ARE hovering.
        const note = fakeNote({ noteId: "abc", bestPath: undefined });
        froca.getNote = vi.fn(async () => note) as any;
        hoverActive = true;

        const promise = mouseEnterHandler.call($link[0], eventFor($link));
        await vi.advanceTimersByTimeAsync(600);
        await promise;

        // hovering, but empty content -> early return before the tooltip is created.
        expect(($.fn as any).tooltip).not.toHaveBeenCalled();
    });

    it("returns without showing a tooltip when the footnote target yields empty content", async () => {
        vi.useFakeTimers();
        // anchor with no matching target -> renderFootnoteOrAnchor returns ""
        const $root = makeLink(`<div class="ck-content"><a class="link" href="#missingfn">^</a></div>`);
        const $link = $root.find("a.link");
        parseNavigationStateFromUrl.mockReturnValue({ notePath: "missingfn", noteId: "missingfn", viewScope: { viewMode: "default" } });
        froca.getNote = vi.fn() as any;
        hoverActive = true;

        const promise = mouseEnterHandler.call($link[0], eventFor($link));
        await vi.advanceTimersByTimeAsync(600);
        await promise;

        // empty content -> early return before the tooltip is created
        expect(($.fn as any).tooltip).not.toHaveBeenCalled();
    });

    it("dismisses all tooltips when a link inside the freshly-shown tooltip is clicked", async () => {
        vi.useFakeTimers();
        // Deterministic ids/classes so we can target the in-tooltip anchor selector.
        const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
        // The handler binds click to `.tooltip-0 a`; pre-create a matching element so the
        // delegated-at-bind-time selector resolves to a real anchor.
        const $tooltipDom = $('<div class="tooltip-0"><a class="inner-link" href="#x">link</a></div>');
        $("body").append($tooltipDom);

        const $root = makeLink(`
            <div class="ck-content">
                <a class="link" href="#fn7">^</a>
                <div class="footnote-section">
                    <div class="footnote-item">
                        <a href="#fnref7">back</a>
                        <div class="footnote-content">fn body</div>
                    </div>
                </div>
            </div>`);
        const $link = $root.find("a.link");
        parseNavigationStateFromUrl.mockReturnValue({ notePath: "fn7", noteId: "fn7", viewScope: { viewMode: "default" } });
        hoverActive = true;

        const promise = mouseEnterHandler.call($link[0], eventFor($link));
        await vi.advanceTimersByTimeAsync(600);
        await promise;

        // tooltip was created & shown, and the link was tracked
        expect(($.fn as any).tooltip).toHaveBeenCalledWith("show");
        const tooltipMock = ($.fn as any).tooltip as ReturnType<typeof vi.fn>;
        const disposeBefore = tooltipMock.mock.calls.filter((c) => c[0] === "dispose").length;

        // Click the anchor inside the tooltip -> dismissAllTooltips runs (disposes tracked link).
        $tooltipDom.find("a.inner-link").trigger("click");

        const disposeAfter = tooltipMock.mock.calls.filter((c) => c[0] === "dispose").length;
        expect(disposeAfter).toBeGreaterThan(disposeBefore);

        randomSpy.mockRestore();
    });

    it("renders an in-text footnote tooltip without touching froca", async () => {
        vi.useFakeTimers();
        const $root = makeLink(`
            <div class="ck-content">
                <a class="link" href="#fn9">^</a>
                <div class="footnote-section">
                    <div class="footnote-item">
                        <a href="#fnref9">back</a>
                        <div class="footnote-content">footnote body</div>
                    </div>
                </div>
            </div>`);
        const $link = $root.find("a.link");
        parseNavigationStateFromUrl.mockReturnValue({ notePath: "fn9", noteId: "fn9", viewScope: { viewMode: "default" } });
        froca.getNote = vi.fn() as any;
        hoverActive = true;

        const promise = mouseEnterHandler.call($link[0], eventFor($link));
        await vi.advanceTimersByTimeAsync(600);
        await promise;

        expect(froca.getNote).not.toHaveBeenCalled();
        // hovered -> tooltip was both initialised and explicitly shown.
        const tooltipMock = ($.fn as any).tooltip as ReturnType<typeof vi.fn>;
        expect(tooltipMock).toHaveBeenCalledWith("show");

        // The init call carries the rendered footnote body in its title and the
        // note-tooltip class in its template.
        const initCall = tooltipMock.mock.calls.find((c) => typeof c[0] === "object");
        expect(initCall?.[0].title).toContain("footnote body");
        expect(initCall?.[0].template).toContain("note-tooltip");
        // note is null on the footnote path, so the template carries only the random
        // tooltip-<n> class with no trailing color class.
        expect(initCall?.[0].template).toMatch(/tooltip note-tooltip tooltip-\d+"/);
        expect(initCall?.[0].template).not.toContain("color-");
    });

    it("creates, shows and tracks a tooltip while hovering, then dismisses on click and via the watchdog", async () => {
        vi.useFakeTimers();
        const $link = makeLink('<a href="#root/abc">x</a>');
        parseNavigationStateFromUrl.mockReturnValue({ notePath: "root/abc", noteId: "abc", viewScope: { viewMode: "default" } });
        const note = fakeNote({ noteId: "abc", bestPath: "root/abc", colorClass: "color-blue" });
        froca.getNote = vi.fn(async () => note) as any;
        hoverActive = true;

        const promise = mouseEnterHandler.call($link[0], eventFor($link));
        await vi.advanceTimersByTimeAsync(600);
        await promise;

        const tooltipMock = ($.fn as any).tooltip as ReturnType<typeof vi.fn>;
        // initialised with options then explicitly shown
        const initCall = tooltipMock.mock.calls.find((c) => typeof c[0] === "object");
        expect(initCall?.[0]).toMatchObject({ container: "body", placement: "bottom", html: true, sanitize: false });
        // color class folded into the tooltip template
        expect(initCall?.[0].template).toContain("color-blue");
        expect(tooltipMock).toHaveBeenCalledWith("show");

        // the watchdog re-arms while still hovering...
        await vi.advanceTimersByTimeAsync(1000);
        // ...and dismisses (dispose) once hover ends
        hoverActive = false;
        const disposeBefore = tooltipMock.mock.calls.filter((c) => c[0] === "dispose").length;
        await vi.advanceTimersByTimeAsync(1000);
        const disposeAfter = tooltipMock.mock.calls.filter((c) => c[0] === "dispose").length;
        expect(disposeAfter).toBeGreaterThan(disposeBefore);
    });
});

/**
 * Drives mouseEnterHandler through a successful "hovering" render so the link is
 * pushed onto the module-private openTooltipElements list, then clears the hover/timers.
 * Returns the tracked $link whose .tooltip is the shared vi.fn() stub.
 */
async function trackOneTooltip() {
    vi.useFakeTimers();
    const $link = $('<a href="#root/abc">tracked</a>');
    $("body").append($link);
    parseNavigationStateFromUrl.mockReturnValue({ notePath: "root/abc", noteId: "abc", viewScope: { viewMode: "default" } });
    froca.getNote = vi.fn(async () => fakeNote({ noteId: "abc", bestPath: "root/abc" })) as any;
    hoverActive = true;

    const promise = mouseEnterHandler.call($link[0], { pointerType: "mouse" } as any);
    await vi.advanceTimersByTimeAsync(600);
    await promise;

    // Stop the watchdog from interfering, but keep the element tracked.
    hoverActive = false;
    vi.useRealTimers();
    const tooltipMock = ($link as any).tooltip as ReturnType<typeof vi.fn>;
    tooltipMock.mockClear();
    return $link;
}

describe("setup helpers and dismissAllTooltips", () => {
    it("setupElementTooltip wires the pointerenter handler to the element", () => {
        const $el = $('<a href="#root/abc">x</a>');
        const onSpy = vi.spyOn($el, "on");
        setupElementTooltip($el);
        expect(onSpy).toHaveBeenCalledWith("pointerenter", expect.any(Function));
    });

    it("setupGlobalTooltip delegates pointerenter for anchors and [data-href]", () => {
        const onSpy = vi.spyOn($.fn, "on");
        setupGlobalTooltip();

        const calls = onSpy.mock.calls as unknown as [string, string?][];
        const pointerSelectors = calls.filter((c) => c[0] === "pointerenter").map((c) => c[1]);
        expect(pointerSelectors).toContain("a:not(.no-tooltip-preview)");
        expect(pointerSelectors).toContain("[data-href]:not(.no-tooltip-preview)");
        // a global click handler is also registered (no delegation selector)
        expect(calls.some((c) => c[0] === "click")).toBe(true);
        onSpy.mockRestore();
    });

    it("setupGlobalTooltip's click handler dismisses tooltips only for clicks outside .note-tooltip", async () => {
        setupGlobalTooltip();

        // Track an open tooltip element so we can observe whether it gets disposed.
        const $tracked = await trackOneTooltip();

        // Click inside a .note-tooltip -> handler returns early, no dispose.
        const $inside = $('<div class="note-tooltip"><span class="target">hi</span></div>');
        $("body").append($inside);
        $(document).trigger($.Event("click", { target: $inside.find(".target")[0] }));
        expect(($tracked as any).tooltip).not.toHaveBeenCalledWith("dispose");

        // Click outside -> dismissAllTooltips disposes the tracked element.
        $(document).trigger($.Event("click", { target: document.body }));
        expect(($tracked as any).tooltip).toHaveBeenCalledWith("dispose");
    });

    it("dismissAllTooltips disposes every tracked element and clears aria-describedby", async () => {
        // Nothing tracked yet -> safe no-op.
        expect(() => dismissAllTooltips()).not.toThrow();

        // Register a tracked element and assert it is cleaned up.
        const $tracked = await trackOneTooltip();
        $tracked.attr("aria-describedby", "tooltip-id");
        dismissAllTooltips();
        expect(($tracked as any).tooltip).toHaveBeenCalledWith("dispose");
        expect($tracked.attr("aria-describedby")).toBeUndefined();
    });
});
