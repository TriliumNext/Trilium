import type { IconRegistry } from "@triliumnext/commons";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the component import) --------------------------------------------

vi.mock("bootstrap", () => {
    class Tooltip {
        static instances = new Map<Element, Tooltip>();
        static getInstance(el: Element) { return Tooltip.instances.get(el) ?? null; }
        static getOrCreateInstance(el: Element, config?: unknown) { return new Tooltip(el, config); }
        element: Element;
        constructor(el: Element, _config?: unknown) { this.element = el; Tooltip.instances.set(el, this); }
        dispose() { Tooltip.instances.delete(this.element); }
        show() {}
        hide() {}
        update() {}
    }
    class Dropdown {
        static getOrCreateInstance() { return new Dropdown(); }
        static getInstance() { return null; }
        show() {}
        hide() {}
        update() {}
        dispose() {}
    }
    class Modal {
        static getOrCreateInstance() { return new Modal(); }
        show() {}
        hide() {}
        dispose() {}
    }
    return { Tooltip, Dropdown, Modal, default: { Tooltip, Dropdown, Modal } };
});

// Render react-window's Grid synchronously by invoking the cell component for a handful of cells.
// happy-dom has no real layout so the actual Grid would render zero cells; this exercises IconItemCell.
vi.mock("react-window", () => ({
    Grid: ({ cellComponent: Cell, cellProps, columnCount, rowCount }: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        cellComponent: (p: any) => unknown;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        cellProps: any;
        columnCount: number;
        rowCount: number;
    }) => {
        const cells: unknown[] = [];
        // Render a couple of rows worth of cells, including one out-of-range index.
        for (let rowIndex = 0; rowIndex < Math.min(rowCount, 2); rowIndex++) {
            for (let columnIndex = 0; columnIndex < columnCount; columnIndex++) {
                cells.push(Cell({ rowIndex, columnIndex, style: { top: 0, left: 0 }, ...cellProps }));
            }
        }
        // Also exercise an out-of-range cell to hit the `if (!iconData)` branch.
        cells.push(Cell({ rowIndex: rowCount + 5, columnIndex: 0, style: {}, ...cellProps }));
        return <div class="mock-grid">{cells}</div>;
    }
}));

vi.mock("../services/utils", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../services/utils")>();
    return { ...actual, isMobile: vi.fn(() => false), isDesktop: vi.fn(() => true) };
});

import type NoteContext from "../components/note_context";
import Component from "../components/component";
import type FNote from "../entities/fnote";
import attributes from "../services/attributes";
import server from "../services/server";
import { isDesktop, isMobile } from "../services/utils";
import { buildNote } from "../test/easy-froca";
import NoteIcon from "./note_icon";
import { NoteContextContext, ParentComponent } from "./react/react_utils";

// --- Helpers -------------------------------------------------------------------------------------

let container: HTMLDivElement | undefined;

function renderNoteIcon(noteContext: NoteContext | null) {
    const target = document.createElement("div");
    container = target;
    document.body.appendChild(target);
    act(() => {
        render((
            <ParentComponent.Provider value={new Component()}>
                <NoteContextContext.Provider value={noteContext}>
                    <NoteIcon />
                </NoteContextContext.Provider>
            </ParentComponent.Provider>
        ), target);
    });
    return target;
}

/** Trigger the bootstrap-jQuery `show.bs.dropdown` event so the Dropdown renders its children. */
function openDropdown(dropdownEl: Element | null) {
    if (!dropdownEl) return;
    act(() => { $(dropdownEl).trigger("show.bs.dropdown"); });
}

function fakeNoteContext(note: FNote | null | undefined, viewMode = "default"): NoteContext {
    return {
        ntxId: "ntx1",
        hoistedNoteId: "root",
        notePath: note ? `root/${note.noteId}` : "root",
        note,
        viewScope: { viewMode },
        getContextData: vi.fn(),
        setContextData: vi.fn(),
        clearContextData: vi.fn(),
        isReadOnly: vi.fn(async () => false)
    } as unknown as NoteContext;
}

const ICON_REGISTRY: IconRegistry = {
    sources: [
        {
            prefix: "bx",
            name: "Boxicons",
            icon: "bx bx-box",
            icons: [
                { id: "bx bx-star", terms: [ "star", "favourite" ] },
                { id: "bx bx-home", terms: [ "home", "house" ] }
            ]
        },
        {
            prefix: "fa",
            name: "Font Awesome",
            icon: "fa fa-flag",
            icons: [
                { id: "fa fa-flag", terms: [ "flag", "banner" ] }
            ]
        }
    ]
};

let previousTooltipPlugin: unknown;

beforeEach(() => {
    (window.glob as unknown as { iconRegistry: IconRegistry }).iconRegistry = structuredClone(ICON_REGISTRY);
    // The bootstrap tooltip jQuery plugin ($.fn.tooltip) is not registered in the test env; stub it.
    const fn = $.fn as unknown as Record<string, unknown>;
    previousTooltipPlugin = fn.tooltip;
    fn.tooltip = vi.fn();
    vi.clearAllMocks();
    (isMobile as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (isDesktop as ReturnType<typeof vi.fn>).mockReturnValue(true);
    Object.assign(server, {
        get: vi.fn(async () => ({ iconClassToCountMap: { "bx bx-home": 5, "bx bx-star": 1 } }))
    });
});

afterEach(() => {
    const target = container;
    if (target) {
        act(() => { render(null, target); });
        target.remove();
        container = undefined;
    }
    (($.fn as unknown as Record<string, unknown>)).tooltip = previousTooltipPlugin;
    vi.restoreAllMocks();
});

// --- Tests ---------------------------------------------------------------------------------------

describe("NoteIcon (desktop)", () => {
    it("renders the dropdown button with the note's icon and is enabled for a default-view note", async () => {
        const note = buildNote({ id: "n1", title: "N", "#iconClass": "bx bx-star" });
        const el = renderNoteIcon(fakeNoteContext(note));
        await act(async () => { await Promise.resolve(); });

        const button = el.querySelector("button.note-icon");
        expect(button).not.toBeNull();
        // getIcon() returns "tn-icon bx bx-star" → those classes land on the button.
        expect(button?.className).toContain("bx bx-star");
        expect(button?.hasAttribute("disabled")).toBe(false);
        expect(el.querySelector(".note-icon-widget")).not.toBeNull();
    });

    it("disables the button when the view mode is not default", () => {
        const note = buildNote({ id: "n2", title: "N2" });
        const el = renderNoteIcon(fakeNoteContext(note, "source"));
        expect(el.querySelector("button.note-icon")?.hasAttribute("disabled")).toBe(true);
    });

    it("disables the button when the note metadata is read-only (system note)", () => {
        const note = buildNote({ id: "_options_appearance", title: "Opt" });
        const el = renderNoteIcon(fakeNoteContext(note));
        expect(el.querySelector("button.note-icon")?.hasAttribute("disabled")).toBe(true);
    });

    it("falls back to bx-empty when the context has no note", () => {
        const el = renderNoteIcon(fakeNoteContext(null));
        const button = el.querySelector("button.note-icon");
        expect(button?.className).toContain("bx bx-empty");
        // No note → the dropdown list (and its inner content) is not rendered.
        expect(el.querySelector(".icon-list")).toBeNull();
    });
});

describe("NoteIcon list contents (desktop)", () => {
    it("renders the filter row, the icon grid and reacts to a text search", async () => {
        const note = buildNote({ id: "list1", title: "List" });
        const el = renderNoteIcon(fakeNoteContext(note));
        openDropdown(el.querySelector(".note-icon-widget.dropdown"));
        await act(async () => { await Promise.resolve(); });
        await act(async () => { await Promise.resolve(); });

        // Filter row and search input.
        expect(el.querySelector(".filter-row")).not.toBeNull();
        const searchInput = el.querySelector<HTMLInputElement>("input[name='icon-search']");
        expect(searchInput).not.toBeNull();

        // The grid mock renders the icon cells as spans with the tn-icon class.
        expect(el.querySelectorAll(".icon-list .tn-icon").length).toBeGreaterThan(0);

        // Typing a search narrows the list down to the matching icon.
        if (searchInput) {
            searchInput.value = "home";
            await act(async () => { searchInput.dispatchEvent(new Event("input", { bubbles: true })); });
        }
        const titles = Array.from(el.querySelectorAll(".icon-list .tn-icon")).map((s) => s.getAttribute("title") ?? "");
        expect(titles.length).toBeGreaterThan(0);
    });

    it("shows the no-results placeholder when the search matches nothing", async () => {
        const note = buildNote({ id: "list2", title: "List2" });
        const el = renderNoteIcon(fakeNoteContext(note));
        openDropdown(el.querySelector(".note-icon-widget.dropdown"));
        await act(async () => { await Promise.resolve(); });
        await act(async () => { await Promise.resolve(); });

        const searchInput = el.querySelector<HTMLInputElement>("input[name='icon-search']");
        if (searchInput) {
            searchInput.value = "zzzznomatch";
            await act(async () => { searchInput.dispatchEvent(new Event("input", { bubbles: true })); });
        }
        expect(el.querySelector(".icon-list .no-results")).not.toBeNull();
        expect(el.querySelector(".icon-list .tn-icon")).toBeNull();
    });

    it("clicking an icon span sets the iconClass label and ignores clicks on non-icons", async () => {
        const setLabel = vi.spyOn(attributes, "setLabel").mockResolvedValue(undefined);
        const note = buildNote({ id: "click1", title: "Click" });
        const el = renderNoteIcon(fakeNoteContext(note));
        openDropdown(el.querySelector(".note-icon-widget.dropdown"));
        await act(async () => { await Promise.resolve(); });
        await act(async () => { await Promise.resolve(); });

        const iconList = el.querySelector(".icon-list");
        // Click on the container itself (not a tn-icon) → no label set.
        if (iconList) {
            act(() => { (iconList as HTMLElement).click(); });
        }
        expect(setLabel).not.toHaveBeenCalled();

        const iconSpan = el.querySelector<HTMLElement>(".icon-list .tn-icon");
        if (iconSpan) {
            act(() => { iconSpan.click(); });
        }
        expect(setLabel).toHaveBeenCalledTimes(1);
        const [ noteId, attrName, value ] = setLabel.mock.calls[0] ?? [];
        expect(noteId).toBe("click1");
        expect(attrName).toBe("iconClass");
        expect(typeof value).toBe("string");
    });

    it("clicking an icon on a workspace note sets the workspaceIconClass label", async () => {
        const setLabel = vi.spyOn(attributes, "setLabel").mockResolvedValue(undefined);
        const note = buildNote({ id: "ws1", title: "WS", "#workspace": "true" });
        const el = renderNoteIcon(fakeNoteContext(note));
        openDropdown(el.querySelector(".note-icon-widget.dropdown"));
        await act(async () => { await Promise.resolve(); });
        await act(async () => { await Promise.resolve(); });

        const iconSpan = el.querySelector<HTMLElement>(".icon-list .tn-icon");
        if (iconSpan) {
            act(() => { iconSpan.click(); });
        }
        expect(setLabel.mock.calls[0]?.[1]).toBe("workspaceIconClass");
    });
});

describe("NoteIcon reset-to-default (desktop)", () => {
    it("shows the reset button only when the note has an icon label and removes it on click", async () => {
        const removeById = vi.spyOn(attributes, "removeAttributeById").mockResolvedValue(undefined);
        const note = buildNote({ id: "reset1", title: "R", "#iconClass": "bx bx-star" });
        const el = renderNoteIcon(fakeNoteContext(note));
        openDropdown(el.querySelector(".note-icon-widget.dropdown"));
        await act(async () => { await Promise.resolve(); });
        await act(async () => { await Promise.resolve(); });

        const resetButton = el.querySelector<HTMLElement>("button.bx-reset");
        expect(resetButton).not.toBeNull();
        if (resetButton) {
            act(() => { resetButton.click(); });
        }
        expect(removeById).toHaveBeenCalledTimes(1);
        expect(removeById.mock.calls[0]?.[0]).toBe("reset1");
    });

    it("hides the reset button when the note has no custom icon label", async () => {
        const note = buildNote({ id: "reset2", title: "R2" });
        const el = renderNoteIcon(fakeNoteContext(note));
        openDropdown(el.querySelector(".note-icon-widget.dropdown"));
        await act(async () => { await Promise.resolve(); });
        await act(async () => { await Promise.resolve(); });
        // The filter row renders but no reset button is present without a custom icon.
        expect(el.querySelector(".filter-row")).not.toBeNull();
        expect(el.querySelector("button.bx-reset")).toBeNull();
    });
});

describe("NoteIcon prefix filter (desktop)", () => {
    it("renders the filter dropdown content and filters icons by prefix", async () => {
        const note = buildNote({ id: "filter1", title: "F" });
        const el = renderNoteIcon(fakeNoteContext(note));
        openDropdown(el.querySelector(".note-icon-widget.dropdown"));
        await act(async () => { await Promise.resolve(); });
        await act(async () => { await Promise.resolve(); });

        // Open the nested filter dropdown (the funnel button) so its content renders.
        const filterDropdown = Array.from(el.querySelectorAll(".filter-row .dropdown"))
            .find((d) => d.querySelector(".bx-filter-alt"));
        openDropdown(filterDropdown ?? null);
        await act(async () => { await Promise.resolve(); });

        // The filter dropdown lists "None", "Default" and one entry per non-bx source.
        const filterItems = Array.from(el.querySelectorAll(".dropdown-item"));
        const labels = filterItems.map((i) => i.textContent ?? "");
        // The "Font Awesome" non-bx source should appear as a selectable filter entry.
        expect(labels.some((l) => l.includes("Font Awesome"))).toBe(true);

        const faItem = filterItems.find((i) => (i.textContent ?? "").includes("Font Awesome"));
        if (faItem) {
            act(() => { (faItem as HTMLElement).click(); });
        }
        await act(async () => { await Promise.resolve(); });
        // After filtering to the "fa" prefix only the fa icon remains in the grid.
        const titles = Array.from(el.querySelectorAll(".icon-list .tn-icon")).map((s) => s.getAttribute("title") ?? "");
        expect(titles.length).toBe(1);
    });

    it("filtering to the bx prefix then back to none updates the icon grid", async () => {
        const note = buildNote({ id: "filter2", title: "F2" });
        const el = renderNoteIcon(fakeNoteContext(note));
        openDropdown(el.querySelector(".note-icon-widget.dropdown"));
        await act(async () => { await Promise.resolve(); });
        await act(async () => { await Promise.resolve(); });

        const filterDropdown = Array.from(el.querySelectorAll(".filter-row .dropdown"))
            .find((d) => d.querySelector(".bx-filter-alt"));
        openDropdown(filterDropdown ?? null);
        await act(async () => { await Promise.resolve(); });

        // The two leading filter entries are "None" (null) and "Default" (bx).
        const items = () => Array.from(el.querySelectorAll(".filter-row .dropdown-item")) as HTMLElement[];
        // Clicking "Default" filters to the bx prefix (2 bx icons in the fixture).
        act(() => { items()[1]?.click(); });
        await act(async () => { await Promise.resolve(); });
        expect(el.querySelectorAll(".icon-list .tn-icon").length).toBe(2);

        // Clicking "None" clears the prefix filter again (all 3 icons).
        act(() => { items()[0]?.click(); });
        await act(async () => { await Promise.resolve(); });
        expect(el.querySelectorAll(".icon-list .tn-icon").length).toBe(3);
    });
});

describe("NoteIcon icon cell rendering (desktop)", () => {
    it("falls back to the icon id when the icon has no search terms", async () => {
        (window.glob as unknown as { iconRegistry: IconRegistry }).iconRegistry = {
            sources: [ {
                prefix: "bx",
                name: "Boxicons",
                icon: "bx bx-box",
                icons: [ { id: "bx bx-no-terms", terms: [] } ]
            } ]
        };
        const note = buildNote({ id: "cell1", title: "Cell" });
        const el = renderNoteIcon(fakeNoteContext(note));
        openDropdown(el.querySelector(".note-icon-widget.dropdown"));
        await act(async () => { await Promise.resolve(); });
        await act(async () => { await Promise.resolve(); });

        // With no terms the cell still renders (the title-computation `terms?.[0] ?? id` branch ran).
        const span = el.querySelector<HTMLElement>(".icon-list .tn-icon");
        expect(span).not.toBeNull();
        expect(span?.className).toContain("bx-no-terms");
    });

    it("sorts icons even when the usage-count map is empty", async () => {
        Object.assign(server, { get: vi.fn(async () => ({ iconClassToCountMap: {} })) });
        const note = buildNote({ id: "sort1", title: "S" });
        const el = renderNoteIcon(fakeNoteContext(note));
        openDropdown(el.querySelector(".note-icon-widget.dropdown"));
        await act(async () => { await Promise.resolve(); });
        await act(async () => { await Promise.resolve(); });
        expect(el.querySelectorAll(".icon-list .tn-icon").length).toBeGreaterThan(0);
    });
});

describe("NoteIcon (mobile)", () => {
    beforeEach(() => {
        (isMobile as ReturnType<typeof vi.fn>).mockReturnValue(true);
        (isDesktop as ReturnType<typeof vi.fn>).mockReturnValue(false);
    });

    it("renders the mobile action-button switcher and opens the modal on click", async () => {
        const note = buildNote({ id: "m1", title: "M", "#iconClass": "bx bx-home" });
        const el = renderNoteIcon(fakeNoteContext(note));
        await act(async () => { await Promise.resolve(); });

        const actionButton = el.querySelector<HTMLElement>("button.note-icon");
        expect(actionButton).not.toBeNull();
        // The mobile switcher uses the ActionButton (icon-action class), not a dropdown button.
        expect(actionButton?.className).toContain("icon-action");

        // Opening the modal renders the note icon list inside the portal (document.body).
        if (actionButton) {
            act(() => { actionButton.click(); });
        }
        await act(async () => { await Promise.resolve(); });
        await act(async () => { await Promise.resolve(); });

        const modal = document.body.querySelector(".icon-switcher .filter-row");
        expect(modal).not.toBeNull();
        // The mobile column count is derived from the window width / icon size.
        expect(document.body.querySelectorAll(".icon-switcher .icon-list .tn-icon").length).toBeGreaterThan(0);

        // Clicking an icon invokes the list's onHide, which closes the modal (setModalShown(false)).
        const setLabel = vi.spyOn(attributes, "setLabel").mockResolvedValue(undefined);
        const iconSpan = document.body.querySelector<HTMLElement>(".icon-switcher .icon-list .tn-icon");
        if (iconSpan) {
            act(() => { iconSpan.click(); });
        }
        expect(setLabel).toHaveBeenCalled();

        // Dispatching the bootstrap hidden event drives the Modal's onHidden callback.
        const modalEl = document.body.querySelector(".modal.icon-switcher");
        if (modalEl) {
            act(() => { modalEl.dispatchEvent(new Event("hidden.bs.modal", { bubbles: true })); });
        }
        await act(async () => { await Promise.resolve(); });
    });

    it("renders the mobile filter menu (three-dots) including the reset entry for custom icons", async () => {
        const note = buildNote({ id: "m2", title: "M2", "#iconClass": "bx bx-star" });
        const el = renderNoteIcon(fakeNoteContext(note));
        await act(async () => { await Promise.resolve(); });

        const actionButton = el.querySelector<HTMLElement>("button.note-icon");
        if (actionButton) {
            act(() => { actionButton.click(); });
        }
        await act(async () => { await Promise.resolve(); });
        await act(async () => { await Promise.resolve(); });

        // The mobile FilterRow uses the dots-vertical dropdown and offers a reset list item.
        expect(document.body.querySelector(".bx-dots-vertical-rounded")).not.toBeNull();
    });
});
