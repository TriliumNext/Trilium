import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the component import) ---------------------------------------------

vi.mock("bootstrap", () => {
    class Tooltip {
        static instances = new Map<Element, Tooltip>();
        static getInstance(el: Element) { return Tooltip.instances.get(el) ?? null; }
        element: Element;
        config: unknown;
        constructor(el: Element, config?: unknown) { this.element = el; this.config = config; Tooltip.instances.set(el, this); }
        dispose() { Tooltip.instances.delete(this.element); }
        show() {}
        hide() {}
    }
    return { Tooltip, default: { Tooltip } };
});
vi.mock("../../services/keyboard_actions", () => ({
    default: {
        getAction: vi.fn(async () => ({ effectiveShortcuts: [] })),
        setupActionsForElement: vi.fn(async () => [])
    }
}));

import froca from "../../services/froca";
import { buildNote } from "../../test/easy-froca";
import { flush, renderHook } from "../../test/render-hook";
import { Pager, usePagination } from "./Pagination";

// --- renderInto recipe (inline; see client-components.md) ------------------------------------------

let container: HTMLDivElement | undefined;
function renderInto(vnode: unknown) {
    container = document.createElement("div");
    document.body.appendChild(container);
    render(vnode as never, container);
    return container;
}

beforeEach(() => {
    for (const key of Object.keys(froca.notes)) delete froca.notes[key];
    for (const key of Object.keys(froca.attributes)) delete froca.attributes[key];
    for (const key of Object.keys(froca.branches)) delete froca.branches[key];
    vi.clearAllMocks();
});

afterEach(() => {
    if (container) {
        render(null, container);
        container.remove();
        container = undefined;
    }
    vi.restoreAllMocks();
});

function noop() { /* setPage stub */ }

// --- Pager -------------------------------------------------------------------------------------

describe("Pager", () => {
    it("renders nothing when there is less than two pages", () => {
        const el = renderInto(<Pager page={1} pageSize={20} setPage={noop} pageCount={1} totalNotes={5} />);
        expect(el.querySelector(".note-list-pager-container")).toBeNull();
        expect(el.children.length).toBe(0);
    });

    it("renders the pager container, narrow counter and total count for multiple pages", () => {
        const el = renderInto(<Pager page={1} pageSize={20} setPage={noop} pageCount={3} totalNotes={50} />);
        expect(el.querySelector(".note-list-pager-container")).not.toBeNull();
        expect(el.querySelector(".note-list-pager")).not.toBeNull();
        expect(el.querySelector(".note-list-pager-total-count")).not.toBeNull();

        const narrow = el.querySelector(".note-list-pager-narrow-counter");
        expect(narrow).not.toBeNull();
        const strongs = narrow?.querySelectorAll("strong");
        expect(strongs?.length).toBe(2);
        expect(strongs?.[0].textContent).toBe("1");
        expect(strongs?.[1].textContent).toBe("3");
    });

    it("applies an extra className on the container when provided", () => {
        const el = renderInto(<Pager className="extra-class" page={2} pageSize={20} setPage={noop} pageCount={3} totalNotes={50} />);
        const cont = el.querySelector(".note-list-pager-container");
        expect(cont?.className).toContain("extra-class");
    });

    it("disables the prev nav button on the first page and enables next", () => {
        const el = renderInto(<Pager page={1} pageSize={20} setPage={noop} pageCount={5} totalNotes={100} />);
        const navButtons = el.querySelectorAll<HTMLButtonElement>(".note-list-pager-nav-button");
        expect(navButtons.length).toBe(2);
        // First nav button (prev) is disabled, second (next) is not.
        expect(navButtons[0].disabled).toBe(true);
        expect(navButtons[1].disabled).toBe(false);
    });

    it("disables the next nav button on the last page and enables prev", () => {
        const el = renderInto(<Pager page={5} pageSize={20} setPage={noop} pageCount={5} totalNotes={100} />);
        const navButtons = el.querySelectorAll<HTMLButtonElement>(".note-list-pager-nav-button");
        expect(navButtons[0].disabled).toBe(false);
        expect(navButtons[1].disabled).toBe(true);
    });

    it("fires setPage with page-1 / page+1 when clicking prev / next", () => {
        const setPage = vi.fn();
        const el = renderInto(<Pager page={3} pageSize={20} setPage={setPage} pageCount={5} totalNotes={100} />);
        const navButtons = el.querySelectorAll<HTMLButtonElement>(".note-list-pager-nav-button");
        navButtons[0].click(); // prev
        navButtons[1].click(); // next
        expect(setPage).toHaveBeenNthCalledWith(1, 2);
        expect(setPage).toHaveBeenNthCalledWith(2, 4);
    });
});

// --- PageButtons / createSegment (rendered via Pager) ------------------------------------------

describe("PageButtons / createSegment", () => {
    function pageButtons(el: HTMLElement) {
        return el.querySelectorAll<HTMLButtonElement>(".note-list-pager-page-button");
    }

    it("renders one button per page when the count is small (no ellipsis)", () => {
        const el = renderInto(<Pager page={2} pageSize={20} setPage={noop} pageCount={3} totalNotes={50} />);
        const buttons = pageButtons(el);
        expect(buttons.length).toBe(3);
        expect(Array.from(buttons).map(b => b.textContent?.trim())).toEqual([ "1", "2", "3" ]);
        // No ellipsis for a short range.
        expect(el.querySelector(".note-list-pager-ellipsis")).toBeNull();
        // Container does not have the ellipsis-present marker (totalButtonCount < maxButtonCount).
        const buttonContainer = el.querySelector(".note-list-pager-page-button-container");
        expect(buttonContainer?.className).not.toContain("note-list-pager-ellipsis-present");
    });

    it("marks the current page button as current and disabled", () => {
        const el = renderInto(<Pager page={2} pageSize={20} setPage={noop} pageCount={3} totalNotes={50} />);
        const current = el.querySelector<HTMLButtonElement>(".note-list-pager-page-button-current");
        expect(current).not.toBeNull();
        expect(current?.textContent?.trim()).toBe("2");
        expect(current?.disabled).toBe(true);
    });

    it("calls setPage with the page number when a non-current button is clicked", () => {
        const setPage = vi.fn();
        const el = renderInto(<Pager page={2} pageSize={20} setPage={setPage} pageCount={3} totalNotes={50} />);
        const buttons = pageButtons(el);
        buttons[0].click(); // page 1
        expect(setPage).toHaveBeenCalledWith(1);
    });

    it("renders leading and trailing ellipses for a large page count with the page in the middle", () => {
        const el = renderInto(<Pager page={50} pageSize={20} setPage={noop} pageCount={100} totalNotes={2000} />);
        const ellipses = el.querySelectorAll(".note-list-pager-ellipsis");
        // Both leading and trailing ellipsis are present.
        expect(ellipses.length).toBe(2);
        expect(Array.from(ellipses).every(e => e.textContent === "...")).toBe(true);

        const buttonContainer = el.querySelector(".note-list-pager-page-button-container");
        expect(buttonContainer?.className).toContain("note-list-pager-ellipsis-present");

        // First and last page are always shown (left/right segments).
        const labels = Array.from(pageButtons(el)).map(b => b.textContent?.trim());
        expect(labels).toContain("1");
        expect(labels).toContain("100");
        expect(labels).toContain("50");
    });

    it("sets the CSS custom property for the total button count", () => {
        const el = renderInto(<Pager page={50} pageSize={20} setPage={noop} pageCount={100} totalNotes={2000} />);
        const buttonContainer = el.querySelector<HTMLElement>(".note-list-pager-page-button-container");
        // 9 buttons at most when full ellipsis layout is used.
        expect(buttonContainer?.style.getPropertyValue("--note-list-pager-page-button-count")).toBe("9");
    });

    it("renders only a leading ellipsis when the page is near the end", () => {
        const el = renderInto(<Pager page={99} pageSize={20} setPage={noop} pageCount={100} totalNotes={2000} />);
        const ellipses = el.querySelectorAll(".note-list-pager-ellipsis");
        // Near the end: the trailing segment merges with the middle, leaving a single leading ellipsis.
        expect(ellipses.length).toBe(1);
        const labels = Array.from(pageButtons(el)).map(b => b.textContent?.trim());
        expect(labels).toContain("1");
        expect(labels).toContain("100");
    });

    it("renders only a trailing ellipsis when the page is near the start", () => {
        const el = renderInto(<Pager page={2} pageSize={20} setPage={noop} pageCount={100} totalNotes={2000} />);
        const ellipses = el.querySelectorAll(".note-list-pager-ellipsis");
        expect(ellipses.length).toBe(1);
        const labels = Array.from(pageButtons(el)).map(b => b.textContent?.trim());
        expect(labels).toContain("1");
        expect(labels).toContain("100");
    });

    it("renders without ellipsis when the count exactly fits the visible buttons", () => {
        const el = renderInto(<Pager page={4} pageSize={20} setPage={noop} pageCount={9} totalNotes={180} />);
        expect(el.querySelector(".note-list-pager-ellipsis")).toBeNull();
        expect(pageButtons(el).length).toBe(9);
    });
});

// --- usePagination -----------------------------------------------------------------------------

describe("usePagination", () => {
    function makeIds(count: number) {
        return Array.from({ length: count }, (_, i) => `n${i}`);
    }

    it("defaults to page size 20 when no pageSize label is set", async () => {
        const note = buildNote({ id: "host", title: "Host" });
        const ids = makeIds(45);
        ids.forEach(id => buildNote({ id, title: id }));

        const h = renderHook(() => usePagination(note, ids));
        await flush();
        const ctx = h.result.current;
        expect(ctx.pageSize).toBe(20);
        expect(ctx.page).toBe(1);
        expect(ctx.totalNotes).toBe(45);
        expect(ctx.pageCount).toBe(3); // ceil(45 / 20)
        expect(ctx.pageNotes?.map(n => n.noteId)).toEqual(ids.slice(0, 20));
    });

    it("honours a positive pageSize label", async () => {
        const note = buildNote({ id: "host2", title: "Host2", "#pageSize": "10" });
        const ids = makeIds(25);
        ids.forEach(id => buildNote({ id, title: id }));

        const h = renderHook(() => usePagination(note, ids));
        await flush();
        const ctx = h.result.current;
        expect(ctx.pageSize).toBe(10);
        expect(ctx.pageCount).toBe(3); // ceil(25 / 10)
        expect(ctx.pageNotes?.length).toBe(10);
    });

    it("falls back to the default page size when the label is zero or negative", async () => {
        const note = buildNote({ id: "host3", title: "Host3", "#pageSize": "0" });
        const ids = makeIds(5);
        ids.forEach(id => buildNote({ id, title: id }));

        const h = renderHook(() => usePagination(note, ids));
        await flush();
        expect(h.result.current.pageSize).toBe(20);
    });

    it("returns the slice for the selected page after setPage", async () => {
        const note = buildNote({ id: "host4", title: "Host4", "#pageSize": "10" });
        const ids = makeIds(25);
        ids.forEach(id => buildNote({ id, title: id }));

        const h = renderHook(() => usePagination(note, ids));
        await flush();
        act(() => h.result.current.setPage(2));
        await flush();
        const ctx = h.result.current;
        expect(ctx.page).toBe(2);
        expect(ctx.pageNotes?.map(n => n.noteId)).toEqual(ids.slice(10, 20));
    });

    it("clamps the end index to the available notes for the final partial page", async () => {
        const note = buildNote({ id: "host5", title: "Host5", "#pageSize": "10" });
        const ids = makeIds(25);
        ids.forEach(id => buildNote({ id, title: id }));

        const h = renderHook(() => usePagination(note, ids));
        await flush();
        act(() => h.result.current.setPage(3));
        await flush();
        const ctx = h.result.current;
        expect(ctx.pageNotes?.map(n => n.noteId)).toEqual(ids.slice(20, 25)); // only 5 left
    });

    it("reports a single page when there are fewer notes than the page size", async () => {
        const note = buildNote({ id: "host6", title: "Host6" });
        const ids = makeIds(3);
        ids.forEach(id => buildNote({ id, title: id }));

        const h = renderHook(() => usePagination(note, ids));
        await flush();
        const ctx = h.result.current;
        expect(ctx.pageCount).toBe(1);
        expect(ctx.totalNotes).toBe(3);
    });
});
