import { ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { bootstrapMock } from "../../../test/mocks";
import { flush, renderComponent, resetFroca } from "../../../test/render";

// --- Hoisted fakes ---------------------------------------------------------------------------------

// The module installs a module-level `new ResizeObserver(onContentResized)` at import time.
// Replace the global with a capturing fake BEFORE the target module is imported so we can drive it.
const resizeState = vi.hoisted(() => {
    const callbacks: ((entries: unknown[], observer: unknown) => void)[] = [];
    class FakeResizeObserver {
        cb: (entries: unknown[], observer: unknown) => void;
        constructor(cb: (entries: unknown[], observer: unknown) => void) {
            this.cb = cb;
            callbacks.push(cb);
        }
        observe() {}
        unobserve() {}
        disconnect() {}
    }
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = FakeResizeObserver;
    return { callbacks };
});

// --- Module mocks (hoisted above the imports) ------------------------------------------------------

vi.mock("bootstrap", () => bootstrapMock());

const contentRendererMock = vi.hoisted(() => ({
    getRenderedContent: vi.fn()
}));
vi.mock("../../../services/content_renderer", () => ({
    default: contentRendererMock,
    getRenderedContent: contentRendererMock.getRenderedContent
}));

const attributeRendererMock = vi.hoisted(() => ({
    renderNormalAttributes: vi.fn(async () => ({ $renderedAttributes: [] as Element[] }))
}));
vi.mock("../../../services/attribute_renderer", () => ({ default: attributeRendererMock }));

const linkMock = vi.hoisted(() => ({ goToLink: vi.fn(), createLink: vi.fn() }));
vi.mock("../../../services/link", () => ({ default: linkMock, goToLink: linkMock.goToLink }));

const linkContextMenuMock = vi.hoisted(() => ({ openContextMenu: vi.fn() }));
vi.mock("../../../menus/link_context_menu", () => ({ default: linkContextMenuMock }));

// Replace the heavy CollectionProperties tree with a stub that still renders centerChildren so the
// pager wrapping logic is exercised.
vi.mock("../../note_bars/CollectionProperties", () => ({
    default: ({ centerChildren }: { centerChildren?: ComponentChildren }) =>
        <div className="collection-properties-stub">{centerChildren}</div>
}));

// Replace NoteLink (which depends on link.createLink + Mark) with a simple span carrying the path.
vi.mock("../../react/NoteLink", () => ({
    default: ({ notePath, className, showNotePath }: { notePath: string | string[]; className?: string; showNotePath?: boolean }) =>
        <span
            className={className}
            data-note-path={Array.isArray(notePath) ? notePath.join("/") : notePath}
            data-show-note-path={showNotePath ? "true" : "false"}
        />
}));

import attribute_renderer from "../../../services/attribute_renderer";
import content_renderer from "../../../services/content_renderer";
import link from "../../../services/link";
import linkContextMenuService from "../../../menus/link_context_menu";
import { buildNote } from "../../../test/easy-froca";
import { GridView, ListView, NoteContent } from "./ListOrGridView";
import { ViewModeProps } from "../interface";

// --- Render helper ---------------------------------------------------------------------------------

const renderInProviders = (vnode: unknown) => renderComponent(vnode).container;

function viewProps(overrides: Partial<ViewModeProps<{}>> & { note: ViewModeProps<{}>["note"] }): ViewModeProps<{}> {
    return {
        notePath: overrides.note.noteId,
        noteIds: [],
        highlightedTokens: null,
        viewConfig: undefined,
        saveConfig: vi.fn(),
        media: "screen",
        onReady: vi.fn(),
        ...overrides
    };
}

function renderedContent(html: string, type = "text") {
    const $renderedContent = $(`<div class="rendered-content">${html}</div>`);
    return { $renderedContent, type };
}

// --- Lifecycle -------------------------------------------------------------------------------------

beforeEach(() => {
    resetFroca();
    vi.clearAllMocks();
    (content_renderer.getRenderedContent as ReturnType<typeof vi.fn>).mockResolvedValue(renderedContent("<p>content</p>"));
    (attribute_renderer.renderNormalAttributes as ReturnType<typeof vi.fn>).mockResolvedValue({ $renderedAttributes: [ $("<span>#a</span>")[0] ] });
});

// --- ListView --------------------------------------------------------------------------------------

describe("ListView", () => {
    it("renders nested cards for each page note with list-view structure", async () => {
        const note = buildNote({
            id: "book1", title: "Book", type: "book",
            children: [ { id: "c1", title: "C1" }, { id: "c2", title: "C2" } ]
        });
        const el = renderInProviders(<ListView {...viewProps({ note, noteIds: [ "c1", "c2" ] })} />);
        await flush();

        expect(el.querySelector(".note-list.list-view")).toBeTruthy();
        const cards = el.querySelectorAll(".nested-note-list-item");
        expect(cards.length).toBe(2);
        const paths = Array.from(el.querySelectorAll(".note-book-title")).map((s) => s.getAttribute("data-note-path"));
        expect(paths).toContain("book1/c1");
        // book is a collection-properties type → no extra top Pager outside collection props, but the wrapper exists.
        expect(el.querySelector(".note-list-wrapper")).toBeTruthy();
    });

    it("does not render the wrapper when there are no notes", () => {
        const note = buildNote({ id: "emptyBook", title: "Empty", type: "book" });
        const el = renderInProviders(<ListView {...viewProps({ note, noteIds: [] })} />);
        expect(el.querySelector(".note-list-wrapper")).toBeFalsy();
        expect(el.querySelector(".note-list.list-view")).toBeTruthy();
    });

    it("adds search-results class and uses non-search path for search-note parents", async () => {
        const note = buildNote({ id: "search1", title: "Search", type: "search", children: [ { id: "s1", title: "S1" } ] });
        const el = renderInProviders(<ListView {...viewProps({ note, noteIds: [ "s1" ] })} />);
        await flush();
        expect(el.querySelector(".nested-note-list.search-results")).toBeTruthy();
        // For search parent, getNotePath returns just the child id and showNotePath is true.
        const titleSpan = el.querySelector(".note-book-title");
        expect(titleSpan?.getAttribute("data-note-path")).toBe("s1");
        expect(titleSpan?.getAttribute("data-show-note-path")).toBe("true");
    });
});

// --- Expansion / sub-sections ----------------------------------------------------------------------

describe("ListNoteCard expansion", () => {
    it("expands children when the expanded label is 'all' and toggles on click", async () => {
        const note = buildNote({
            id: "expBook", title: "Exp", type: "book", "#expanded": "all",
            children: [ { id: "p1", title: "P1", children: [ { id: "gc1", title: "GC1" } ] } ]
        });
        const el = renderInProviders(<ListView {...viewProps({ note, noteIds: [ "p1" ] })} />);
        await flush();

        // Expanded → content preview + chevron-down present.
        expect(el.querySelector(".note-content-preview")).toBeTruthy();
        const expander = el.querySelector(".note-expander");
        expect(expander?.className).toContain("bx-chevron-down");

        // Collapse it.
        act(() => (expander as HTMLElement).click());
        expect(el.querySelector(".note-expander")?.className).toContain("bx-chevron-right");
    });

    it("treats an empty 'expanded' label as depth 1 (first level expanded)", async () => {
        const note = buildNote({
            id: "emptyExp", title: "EmptyExp", type: "book", "#expanded": "",
            children: [ { id: "ee1", title: "EE1", children: [ { id: "ee1c", title: "EE1C" } ] } ]
        });
        const el = renderInProviders(<ListView {...viewProps({ note, noteIds: [ "ee1" ] })} />);
        await flush();
        // Top level (currentLevel 1 <= depth 1) is expanded.
        expect(el.querySelector(".note-content-preview")).toBeTruthy();
        expect(el.querySelector(".note-expander")?.className).toContain("bx-chevron-down");
    });

    it("parses a numeric 'expanded' label as the expansion depth", async () => {
        const note = buildNote({
            id: "numExp", title: "NumExp", type: "book", "#expanded": "2",
            children: [ { id: "ne1", title: "NE1" } ]
        });
        const el = renderInProviders(<ListView {...viewProps({ note, noteIds: [ "ne1" ] })} />);
        await flush();
        // depth 2 >= currentLevel 1 → expanded.
        expect(el.querySelector(".note-content-preview")).toBeTruthy();
    });

    it("does not expand by default (expandDepth 0) and expands on click", async () => {
        const note = buildNote({
            id: "noExp", title: "NoExp", type: "book",
            children: [ { id: "n1", title: "N1" } ]
        });
        const el = renderInProviders(<ListView {...viewProps({ note, noteIds: [ "n1" ] })} />);
        await flush();

        expect(el.querySelector(".note-content-preview")).toBeFalsy();
        const expander = el.querySelector(".note-expander");
        expect(expander?.className).toContain("bx-chevron-right");
        act(() => (expander as HTMLElement).click());
        await flush();
        expect(el.querySelector(".note-content-preview")).toBeTruthy();
    });
});

// --- GridView --------------------------------------------------------------------------------------

describe("GridView", () => {
    it("renders grid cards with note-book-card frames and content", async () => {
        const note = buildNote({
            id: "gridBook", title: "Grid", type: "book",
            children: [ { id: "g1", title: "G1" }, { id: "g2", title: "G2" } ]
        });
        const el = renderInProviders(<GridView {...viewProps({ note, noteIds: [ "g1", "g2" ] })} />);
        await flush();

        expect(el.querySelector(".note-list.grid-view")).toBeTruthy();
        expect(el.querySelector(".note-list-container.use-tn-links")).toBeTruthy();
        const cards = el.querySelectorAll(".note-book-card");
        expect(cards.length).toBe(2);
        expect(el.querySelector("[data-note-id='g1']")).toBeTruthy();
        expect(el.querySelector(".note-book-content")).toBeTruthy();
    });

    it("invokes link.goToLink when a grid card is clicked", async () => {
        const note = buildNote({ id: "clkBook", title: "Click", type: "book", children: [ { id: "ck1", title: "CK1" } ] });
        const el = renderInProviders(<GridView {...viewProps({ note, noteIds: [ "ck1" ] })} />);
        await flush();
        const card = el.querySelector(".note-book-card");
        act(() => (card as HTMLElement).click());
        expect(link.goToLink).toHaveBeenCalled();
    });

    it("hides the menu button for options notes", async () => {
        const note = buildNote({ id: "optBook", title: "Opt", type: "book", children: [ { id: "_optionsX", title: "OptChild" } ] });
        const el = renderInProviders(<GridView {...viewProps({ note, noteIds: [ "_optionsX" ] })} />);
        await flush();
        // _options notes => isOptions() true => no menu button.
        expect(el.querySelector(".note-book-item-menu")).toBeFalsy();
    });
});

// --- NoteMenuButton --------------------------------------------------------------------------------

describe("NoteMenuButton", () => {
    it("opens the context menu and stops propagation when clicked", async () => {
        const note = buildNote({ id: "menuBook", title: "Menu", type: "book", children: [ { id: "m1", title: "M1" } ] });
        const el = renderInProviders(<GridView {...viewProps({ note, noteIds: [ "m1" ] })} />);
        await flush();
        const menuBtn = el.querySelector(".note-book-item-menu");
        expect(menuBtn).toBeTruthy();
        act(() => (menuBtn as HTMLElement).click());
        expect(linkContextMenuService.openContextMenu).toHaveBeenCalled();
        // Click on the menu button should not bubble to trigger the card's goToLink.
        expect(link.goToLink).not.toHaveBeenCalled();
    });
});

// --- NoteAttributes --------------------------------------------------------------------------------

describe("NoteAttributes", () => {
    it("renders attributes returned by the attribute renderer", async () => {
        const note = buildNote({ id: "attrBook", title: "Attr", type: "book", "#expanded": "all", children: [ { id: "a1", title: "A1" } ] });
        const el = renderInProviders(<ListView {...viewProps({ note, noteIds: [ "a1" ] })} />);
        await flush();
        expect(attribute_renderer.renderNormalAttributes).toHaveBeenCalled();
        const attrs = el.querySelector(".note-list-attributes");
        expect(attrs?.textContent).toContain("#a");
    });
});

// --- NoteContent (direct) --------------------------------------------------------------------------

describe("NoteContent", () => {
    it("replaces rendered content and marks ready, calling onReady", async () => {
        const note = buildNote({ id: "ncReady", title: "NC", content: "hi" });
        const onReady = vi.fn();
        const el = renderInProviders(
            <NoteContent note={note} highlightedTokens={null} includeArchivedNotes={false} onReady={onReady} />
        );
        await flush();
        const contentEl = el.querySelector(".note-book-content");
        expect(contentEl?.classList.contains("note-book-content-ready")).toBe(true);
        expect(contentEl?.innerHTML).toContain("content");
        expect(onReady).toHaveBeenCalled();
    });

    it("clears content when the rendered element is empty", async () => {
        (content_renderer.getRenderedContent as ReturnType<typeof vi.fn>).mockResolvedValue(renderedContent("", "text"));
        const note = buildNote({ id: "ncEmpty", title: "Empty", content: "" });
        const el = renderInProviders(
            <NoteContent note={note} highlightedTokens={null} includeArchivedNotes={false} />
        );
        await flush();
        const contentEl = el.querySelector(".note-book-content");
        expect(contentEl?.classList.contains("note-book-content-ready")).toBe(true);
        expect(contentEl?.children.length).toBe(0);
    });

    it("renders an error placeholder when content rendering rejects", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        (content_renderer.getRenderedContent as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("boom"));
        const onReady = vi.fn();
        const note = buildNote({ id: "ncErr", title: "Err" });
        const el = renderInProviders(
            <NoteContent note={note} highlightedTokens={null} includeArchivedNotes={false} onReady={onReady} />
        );
        await flush();
        const contentEl = el.querySelector(".note-book-content");
        expect(contentEl?.classList.contains("note-book-content-ready")).toBe(true);
        expect(contentEl?.textContent?.length).toBeGreaterThan(0);
        expect(onReady).toHaveBeenCalled();
        expect(warn).toHaveBeenCalled();
        expect(error).toHaveBeenCalled();
    });

    it("toggles the overflow class via the ResizeObserver callback", async () => {
        const note = buildNote({ id: "ncResize", title: "R", content: "hi" });
        const el = renderInProviders(
            <NoteContent note={note} trim highlightedTokens={[ "hi" ]} includeArchivedNotes={false} showTextRepresentation />
        );
        await flush();
        const contentEl = el.querySelector(".note-book-content") as HTMLElement;
        expect(contentEl).toBeTruthy();
        expect(resizeState.callbacks.length).toBeGreaterThan(0);

        // onContentResized only reads scrollHeight/clientHeight/classList off the entry target;
        // supply a fake entry whose target reuses the real element's classList.
        const overflowingEntry = { target: { scrollHeight: 100, clientHeight: 10, classList: contentEl.classList } };
        act(() => resizeState.callbacks.forEach((cb) => cb([ overflowingEntry ], undefined)));
        expect(contentEl.classList.contains("note-book-content-overflowing")).toBe(true);

        // Non-overflowing → class removed.
        const fittingEntry = { target: { scrollHeight: 10, clientHeight: 100, classList: contentEl.classList } };
        act(() => resizeState.callbacks.forEach((cb) => cb([ fittingEntry ], undefined)));
        expect(contentEl.classList.contains("note-book-content-overflowing")).toBe(false);
    });
});

// --- Filtering / archived --------------------------------------------------------------------------

describe("filtering", () => {
    it("filters out included image-link children from the note list", async () => {
        const note = buildNote({
            id: "filterBook", title: "Filter", type: "book", "~imageLink": "img1",
            children: [ { id: "img1", title: "Image" }, { id: "real1", title: "Real" } ]
        });
        const el = renderInProviders(<ListView {...viewProps({ note, noteIds: [ "img1", "real1" ] })} />);
        await flush();
        // img1 is referenced via imageLink relation → filtered out.
        const paths = Array.from(el.querySelectorAll(".note-book-title")).map((s) => s.getAttribute("data-note-path"));
        expect(paths).not.toContain("filterBook/img1");
        expect(paths).toContain("filterBook/real1");
        expect(el.querySelectorAll(".nested-note-list-item").length).toBe(1);
    });
});
