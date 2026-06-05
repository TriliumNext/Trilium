import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the component import) --------------------------------------------

vi.mock("bootstrap", () => {
    class Tooltip {
        static instances = new Map<Element, Tooltip>();
        static getInstance(el: Element) { return Tooltip.instances.get(el) ?? null; }
        element: Element;
        constructor(el: Element) { this.element = el; Tooltip.instances.set(el, this); }
        dispose() { Tooltip.instances.delete(this.element); }
        show() {}
        hide() {}
        update() {}
    }
    class Dropdown {
        static getOrCreateInstance() { return new Dropdown(); }
        show() {}
        hide() {}
        update() {}
        dispose() {}
    }
    return { Tooltip, Dropdown, default: { Tooltip, Dropdown } };
});

vi.mock("../../services/dialog", () => ({
    default: {
        info: vi.fn(async () => undefined),
        confirm: vi.fn(async () => true)
    }
}));

vi.mock("../../services/keyboard_actions", () => ({
    default: {
        getAction: vi.fn(async () => ({ effectiveShortcuts: [] })),
        setupActionsForElement: vi.fn(async () => [])
    }
}));

import appContext from "../../components/app_context";
import Component from "../../components/component";
import attributes from "../../services/attributes";
import dialogService from "../../services/dialog";
import { buildNote } from "../../test/easy-froca";
import froca from "../../services/froca";
import { ParentComponent } from "../react/react_utils";
import CollectionProperties from "./CollectionProperties";

// --- Render helper --------------------------------------------------------------------------------

let container: HTMLDivElement | undefined;
let parent: Component;

function renderProps(vnode: preact.ComponentChild) {
    const target = document.createElement("div");
    container = target;
    document.body.appendChild(target);
    act(() => {
        render(
            <ParentComponent.Provider value={parent}>{vnode}</ParentComponent.Provider>,
            target
        );
    });
    return target;
}

function fireEvent(name: string, data: unknown) {
    act(() => {
        (parent.handleEventInChildren as unknown as (n: string, d: unknown) => void)(name, data);
    });
}

/** Open a Bootstrap-style dropdown by triggering the jQuery event its handler listens for. */
function showDropdown(dropdown: Element | null | undefined) {
    act(() => { if (dropdown) $(dropdown).trigger("show.bs.dropdown"); });
}

/** Settle pending async microtasks (dialog promises, the open-all loop) and the resulting re-render. */
async function flush() {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

beforeEach(() => {
    parent = new Component();
    for (const key of Object.keys(froca.notes)) delete froca.notes[key];
    for (const key of Object.keys(froca.attributes)) delete froca.attributes[key];
    for (const key of Object.keys(froca.branches)) delete froca.branches[key];
    vi.clearAllMocks();
    // The Bootstrap tooltip jQuery plugin isn't loaded under happy-dom; provide a no-op so useTooltip works.
    Object.assign(($.fn as unknown as Record<string, unknown>), { tooltip: vi.fn() });
    (dialogService.info as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (dialogService.confirm as ReturnType<typeof vi.fn>).mockResolvedValue(true);
});

afterEach(() => {
    if (container) {
        const target = container;
        act(() => render(null, target));
        target.remove();
        container = undefined;
    }
    vi.restoreAllMocks();
});

// --- Top-level visibility -------------------------------------------------------------------------

describe("CollectionProperties top-level", () => {
    it("renders nothing for note types other than book/search", () => {
        const note = buildNote({ id: "txt", title: "Text", type: "text" });
        const root = renderProps(<CollectionProperties note={note} />);
        expect(root.querySelector(".collection-properties")).toBeNull();
    });

    it("renders the three containers for a book note without an open-all button", () => {
        const note = buildNote({ id: "book1", title: "Book", type: "book" });
        const root = renderProps(
            <CollectionProperties note={note} centerChildren={<span class="center-marker" />} rightChildren={<span class="right-marker" />} />
        );
        expect(root.querySelector(".collection-properties")).not.toBeNull();
        expect(root.querySelector(".left-container")).not.toBeNull();
        expect(root.querySelector(".center-container .center-marker")).not.toBeNull();
        expect(root.querySelector(".right-container .right-marker")).not.toBeNull();
        // Open-all button only exists for "search" notes.
        expect(root.querySelector(".right-container button.bx-window-open")).toBeNull();
    });

    it("renders the open-all button for a search note", () => {
        const note = buildNote({ id: "search1", title: "Search", type: "search" });
        const root = renderProps(<CollectionProperties note={note} />);
        expect(root.querySelector(".collection-properties")).not.toBeNull();
        expect(root.querySelector(".right-container button")).not.toBeNull();
    });
});

// --- ViewTypeSwitcher -----------------------------------------------------------------------------

describe("ViewTypeSwitcher", () => {
    it("defaults to grid for a book and list for a search, and lists all view types", () => {
        const book = buildNote({ id: "vb", title: "B", type: "book" });
        const bookRoot = renderProps(<CollectionProperties note={book} />);
        // The first dropdown is the view-type switcher; the selected icon reflects the default view type.
        expect(bookRoot.querySelector(".left-container .dropdown .bxs-grid")).not.toBeNull();

        // The menu only renders its children once shown; force a show event to populate it.
        const switcherContainer = bookRoot.querySelector(".left-container .dropdown");
        showDropdown(switcherContainer);
        // 7 view types map to 7 list items.
        expect(switcherContainer?.querySelectorAll(".dropdown-item").length).toBeGreaterThanOrEqual(7);
    });

    it("uses the explicit viewType label when present", () => {
        const note = buildNote({ id: "vt", title: "T", type: "book", "#viewType": "table" });
        const root = renderProps(<CollectionProperties note={note} />);
        expect(root.querySelector(".left-container .dropdown .bx-table")).not.toBeNull();
    });

    it("writes the chosen view type when a non-selected item is clicked", () => {
        const note = buildNote({ id: "switchNote", title: "S", type: "book" });
        const setLabel = vi.spyOn(attributes, "setLabel").mockImplementation(() => undefined as never);
        const root = renderProps(<CollectionProperties note={note} />);
        const switcherContainer = root.querySelector(".left-container .dropdown");
        showDropdown(switcherContainer);

        // The default view type for a book is "grid", so the grid item is disabled/selected.
        // Pick a non-selected item (one that does not carry the selected marker) and click it.
        const items = Array.from(switcherContainer?.querySelectorAll(".dropdown-item") ?? []);
        const nonSelected = items.find((item) => !item.classList.contains("selected") && !item.classList.contains("disabled"));
        expect(nonSelected).toBeDefined();
        act(() => (nonSelected as HTMLElement | undefined)?.click());
        expect(setLabel).toHaveBeenCalledWith("switchNote", "viewType", expect.any(String));
    });

    it("focuses the switcher button when the toggle event fires", () => {
        const note = buildNote({ id: "focusNote", title: "F", type: "book" });
        const root = renderProps(<CollectionProperties note={note} />);
        const button = root.querySelector(".left-container .dropdown button");
        const focusSpy = button ? vi.spyOn(button as HTMLElement, "focus") : null;
        fireEvent("toggleRibbonTabBookProperties", {});
        expect(focusSpy).not.toBeNull();
        expect(focusSpy?.mock.calls.length ?? 0).toBeGreaterThanOrEqual(1);
    });
});

// --- ViewOptions ----------------------------------------------------------------------------------

describe("ViewOptions", () => {
    it("renders config properties plus the divider and the two fixed checkboxes for a populated view type", () => {
        const note = buildNote({ id: "geo", title: "G", type: "book", "#viewType": "geoMap" });
        const root = renderProps(<CollectionProperties note={note} />);
        // The second dropdown in the left container is the cog/options menu.
        const dropdowns = root.querySelectorAll(".left-container .dropdown");
        const optionsDropdown = dropdowns[dropdowns.length - 1];
        showDropdown(optionsDropdown);
        // geoMap has 3 properties + divider + 2 fixed checkboxes; ensure at least the fixed items render.
        expect(optionsDropdown?.querySelector(".dropdown-divider")).not.toBeNull();
        expect(optionsDropdown?.querySelectorAll(".dropdown-item").length).toBeGreaterThan(0);
    });

    it("renders only the two fixed checkboxes (no divider) for an empty view type", () => {
        const note = buildNote({ id: "grid", title: "Grid", type: "book", "#viewType": "grid" });
        const root = renderProps(<CollectionProperties note={note} />);
        const dropdowns = root.querySelectorAll(".left-container .dropdown");
        const optionsDropdown = dropdowns[dropdowns.length - 1];
        showDropdown(optionsDropdown);
        // grid has no config properties, so there should be no divider from the properties section.
        expect(optionsDropdown?.querySelector(".dropdown-divider")).toBeNull();
        expect(optionsDropdown?.querySelectorAll(".dropdown-item").length).toBeGreaterThan(0);
    });
});

// --- OpenAllButton --------------------------------------------------------------------------------

describe("OpenAllButton", () => {
    function getOpenButton(root: HTMLElement) {
        return root.querySelector(".right-container button") as HTMLButtonElement | null;
    }

    it("is disabled when the search note has no children", () => {
        const note = buildNote({ id: "noChildren", title: "Empty", type: "search" });
        const root = renderProps(<CollectionProperties note={note} />);
        const button = getOpenButton(root);
        expect(button?.disabled).toBe(true);
    });

    it("does nothing when clicked with zero children", async () => {
        const note = buildNote({ id: "noChildren2", title: "Empty", type: "search" });
        const root = renderProps(<CollectionProperties note={note} />);
        const button = getOpenButton(root);
        const openTab = vi.fn(async () => undefined);
        Object.assign(appContext, { tabManager: { openTabWithNoteWithHoisting: openTab } });
        // Even though disabled, exercise the handler directly via dispatch (no-op due to count === 0).
        await act(async () => { button?.click(); });
        await flush();
        expect(openTab).not.toHaveBeenCalled();
        expect(dialogService.info).not.toHaveBeenCalled();
    });

    it("opens each child in a tab, activating only the last one", async () => {
        const note = buildNote({
            id: "withChildren",
            title: "S",
            type: "search",
            children: [
                { id: "child-a", title: "A" },
                { id: "child-b", title: "B" }
            ]
        });
        const openTab = vi.fn(async () => undefined);
        Object.assign(appContext, { tabManager: { openTabWithNoteWithHoisting: openTab } });
        const root = renderProps(<CollectionProperties note={note} />);
        const button = getOpenButton(root);
        await act(async () => { button?.click(); });
        await flush();

        expect(openTab).toHaveBeenCalledTimes(2);
        expect(openTab).toHaveBeenNthCalledWith(1, "child-a", { activate: false });
        expect(openTab).toHaveBeenNthCalledWith(2, "child-b", { activate: true });
        expect(dialogService.confirm).not.toHaveBeenCalled();
    });

    it("asks for confirmation past 10 children and aborts when declined", async () => {
        const children = Array.from({ length: 11 }, (_, i) => ({ id: `c11-${i}`, title: `C${i}` }));
        const note = buildNote({ id: "eleven", title: "S", type: "search", children });
        (dialogService.confirm as ReturnType<typeof vi.fn>).mockResolvedValue(false);
        const openTab = vi.fn(async () => undefined);
        Object.assign(appContext, { tabManager: { openTabWithNoteWithHoisting: openTab } });
        const root = renderProps(<CollectionProperties note={note} />);
        const button = getOpenButton(root);
        await act(async () => { button?.click(); });
        await flush();

        expect(dialogService.confirm).toHaveBeenCalledTimes(1);
        expect(openTab).not.toHaveBeenCalled();
    });

    it("proceeds past 10 children when the confirmation is accepted", async () => {
        const children = Array.from({ length: 11 }, (_, i) => ({ id: `c11ok-${i}`, title: `C${i}` }));
        const note = buildNote({ id: "elevenOk", title: "S", type: "search", children });
        (dialogService.confirm as ReturnType<typeof vi.fn>).mockResolvedValue(true);
        const openTab = vi.fn(async () => undefined);
        Object.assign(appContext, { tabManager: { openTabWithNoteWithHoisting: openTab } });
        const root = renderProps(<CollectionProperties note={note} />);
        const button = getOpenButton(root);
        await act(async () => { button?.click(); });
        await flush();

        expect(dialogService.confirm).toHaveBeenCalledTimes(1);
        expect(openTab).toHaveBeenCalledTimes(11);
    });

    it("shows an info dialog and aborts when more than the maximum tabs would be opened", async () => {
        const children = Array.from({ length: 51 }, (_, i) => ({ id: `c51-${i}`, title: `C${i}` }));
        const note = buildNote({ id: "fiftyOne", title: "S", type: "search", children });
        const openTab = vi.fn(async () => undefined);
        Object.assign(appContext, { tabManager: { openTabWithNoteWithHoisting: openTab } });
        const root = renderProps(<CollectionProperties note={note} />);
        const button = getOpenButton(root);
        await act(async () => { button?.click(); });
        await flush();

        expect(dialogService.info).toHaveBeenCalledTimes(1);
        expect(dialogService.confirm).not.toHaveBeenCalled();
        expect(openTab).not.toHaveBeenCalled();
    });
});
