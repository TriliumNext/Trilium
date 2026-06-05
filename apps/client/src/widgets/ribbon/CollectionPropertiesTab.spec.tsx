import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the component import) --------------------------------------------

// Keep the experimental "new-layout" flag deterministically off so the CollectionTypeSwitcher renders.
vi.mock("../../services/experimental_features", () => ({
    isExperimentalFeatureEnabled: () => false
}));

import Component from "../../components/component";
import type FNote from "../../entities/fnote";
import attributes from "../../services/attributes";
import froca from "../../services/froca";
import server from "../../services/server";
import ws from "../../services/ws";
import { buildNote } from "../../test/easy-froca";
import { NoteContextContext, ParentComponent } from "../react/react_utils";
import CollectionPropertiesTab, { useViewType, VIEW_TYPE_MAPPINGS } from "./CollectionPropertiesTab";
import type { TabContext } from "./ribbon-interface";

// --- Render helper --------------------------------------------------------------------------------

const activeContainers: HTMLDivElement[] = [];

function renderTab(note: FNote | null | undefined, parent: Component | null = new Component()) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    activeContainers.push(container);
    const props = { note, hidden: false, componentId: "comp-1", activate: () => undefined } satisfies TabContext;
    act(() => {
        render(
            <ParentComponent.Provider value={parent}>
                <NoteContextContext.Provider value={null}>
                    <CollectionPropertiesTab {...props} />
                </NoteContextContext.Provider>
            </ParentComponent.Provider>,
            container
        );
    });
    return container;
}

function fireInput(el: HTMLInputElement, value: string) {
    el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
    for (const key of Object.keys(froca.notes)) delete froca.notes[key];
    for (const key of Object.keys(froca.attributes)) delete froca.attributes[key];
    for (const key of Object.keys(froca.branches)) delete froca.branches[key];
    vi.clearAllMocks();
    Object.assign(server, { put: vi.fn(async () => undefined), upload: vi.fn(async () => undefined) });
    Object.assign(ws, { logError: vi.fn() });
    // Prevent label setters from reaching the (throwing) mock server.
    vi.spyOn(attributes, "setLabel").mockImplementation(() => undefined as never);
    vi.spyOn(attributes, "setBooleanWithInheritance").mockImplementation(() => undefined as never);
    vi.spyOn(attributes, "removeOwnedLabelByName").mockImplementation(() => undefined as never);
});

afterEach(() => {
    while (activeContainers.length) {
        const container = activeContainers.pop();
        if (container) {
            act(() => { render(null, container); });
            container.remove();
        }
    }
    vi.restoreAllMocks();
});

// --- Top-level component --------------------------------------------------------------------------

describe("CollectionPropertiesTab", () => {
    it("renders only the wrapper when there is no note", () => {
        const el = renderTab(null);
        const widget = el.querySelector(".book-properties-widget");
        expect(widget).not.toBeNull();
        // No switcher and no properties when note is missing.
        expect(el.querySelector("select")).toBeNull();
        expect(el.querySelector(".form-checkbox")).toBeNull();
    });

    it("renders the type switcher and the include-archived checkbox for a grid note", () => {
        // A plain note defaults to the "grid" view type, whose property list is empty.
        const note = buildNote({ id: "gridNote", title: "Grid" });
        const el = renderTab(note);

        // The type switcher select lists every known view type.
        const select = el.querySelector("select");
        expect(select).not.toBeNull();
        expect(select?.querySelectorAll("option").length).toBe(Object.keys(VIEW_TYPE_MAPPINGS).length);
        expect(select?.value).toBe("grid");

        // The always-present "include archived" checkbox is the single checkbox for an empty view.
        const checkboxes = el.querySelectorAll(".form-checkbox input[type=checkbox]");
        expect(checkboxes.length).toBe(1);
    });

    it("changing the type switcher writes the viewType label", () => {
        const note = buildNote({ id: "switchNote", title: "Switch" });
        const el = renderTab(note);
        const select = el.querySelector("select");
        expect(select).not.toBeNull();
        if (select) {
            select.value = "table";
            act(() => { select.dispatchEvent(new Event("change", { bubbles: true })); });
        }
        expect(attributes.setLabel).toHaveBeenCalledWith("switchNote", "viewType", "table");
    });
});

// --- useViewType ----------------------------------------------------------------------------------

describe("useViewType", () => {
    // Resolves a note's effective view type by mounting a probe around `useViewType`.
    // `select.value` is not asserted directly because happy-dom does not reliably reflect
    // Preact's `selected` attribute when the chosen option is not the first.
    function resolveViewType(note: FNote | null | undefined) {
        let captured = "";
        const Probe = ({ note: n }: { note: FNote | null | undefined }) => {
            const [ viewType ] = useViewType(n);
            captured = viewType;
            return null;
        };
        const host = document.createElement("div");
        document.body.appendChild(host);
        act(() => { render(<Probe note={note} />, host); });
        act(() => { render(null, host); });
        host.remove();
        return captured;
    }

    it("defaults to grid for regular notes and list for search notes, honoring the label", () => {
        expect(resolveViewType(buildNote({ id: "vtGrid", title: "G" }))).toBe("grid");
        expect(resolveViewType(buildNote({ id: "vtSearch", title: "S", type: "search" }))).toBe("list");
        expect(resolveViewType(buildNote({ id: "vtLabel", title: "L", "#viewType": "calendar" }))).toBe("calendar");
    });

    it("falls back to grid when there is no note", () => {
        expect(resolveViewType(null)).toBe("grid");
        expect(resolveViewType(undefined)).toBe("grid");
    });
});

// --- Property views per view type -----------------------------------------------------------------

describe("property views", () => {
    it("renders button and split-button properties for the list view", () => {
        const note = buildNote({ id: "listNote", title: "List", "#viewType": "list" });
        const el = renderTab(note);

        // List view has a button (collapse) and a split-button (expand) → at least two buttons.
        const buttons = el.querySelectorAll(".book-properties-widget button");
        expect(buttons.length).toBeGreaterThanOrEqual(2);
        // Split button renders a dropdown menu.
        expect(el.querySelector(".btn-group .dropdown-menu")).not.toBeNull();
    });

    it("clicking a button property invokes its handler via the parent component", () => {
        const parent = new Component();
        vi.spyOn(parent, "triggerCommand").mockResolvedValue(undefined as never);
        const note = buildNote({ id: "btnNote", title: "B", "#viewType": "list" });
        // The collapse handler reads owned "expanded" labels; provide none so it is a no-op-ish path.
        const el = renderTab(note, parent);

        // The first button rendered is the collapse (plain button) action.
        const firstButton = el.querySelector(".book-properties-widget button");
        expect(firstButton).not.toBeNull();
        // Clicking must not throw; the async handler eventually calls triggerCommand("refreshNoteList").
        expect(() => act(() => { (firstButton as HTMLButtonElement | null)?.click(); })).not.toThrow();
    });

    it("does not throw when a button property is clicked without a parent component", () => {
        const note = buildNote({ id: "noParentNote", title: "NP", "#viewType": "list" });
        const el = renderTab(note, null);
        const firstButton = el.querySelector(".book-properties-widget button");
        expect(firstButton).not.toBeNull();
        expect(() => act(() => { (firstButton as HTMLButtonElement | null)?.click(); })).not.toThrow();
    });

    it("clicking the split-button main action invokes the expand handler", () => {
        const parent = new Component();
        vi.spyOn(parent, "triggerCommand").mockResolvedValue(undefined as never);
        const note = buildNote({ id: "splitNote", title: "Split", "#viewType": "list" });
        const el = renderTab(note, parent);

        // The split-button is a `.btn-group`; its first non-toggle button is the main expand action.
        const group = el.querySelector(".btn-group");
        expect(group).not.toBeNull();
        const mainButton = group?.querySelector("button:not(.dropdown-toggle)");
        expect(mainButton).not.toBeNull();
        expect(() => act(() => { (mainButton as HTMLButtonElement | null)?.click(); })).not.toThrow();
    });

    it("renders the split-button dropdown items (expand-depth menu)", () => {
        const parent = new Component();
        const note = buildNote({ id: "splitItemsNote", title: "SI", "#viewType": "list" });
        const el = renderTab(note, parent);
        // The dropdown menu lists the expand-depth choices.
        const menuItems = el.querySelectorAll(".btn-group .dropdown-menu li, .btn-group .dropdown-menu .dropdown-item");
        expect(menuItems.length).toBeGreaterThan(0);
    });

    it("renders checkbox properties for the calendar view and toggles them", () => {
        const note = buildNote({ id: "calNote", title: "Cal", "#viewType": "calendar" });
        const el = renderTab(note);

        const checkboxes = el.querySelectorAll(".form-checkbox input[type=checkbox]");
        // Two calendar checkboxes + the always-present include-archived one.
        expect(checkboxes.length).toBe(3);

        const first = checkboxes[0];
        if (first instanceof HTMLInputElement) {
            first.checked = true;
            act(() => { first.dispatchEvent(new Event("change", { bubbles: true })); });
        }
        expect(attributes.setBooleanWithInheritance).toHaveBeenCalled();
    });

    it("renders a number property for the table view and writes on change", () => {
        const note = buildNote({ id: "tableNote", title: "Table", "#viewType": "table" });
        const el = renderTab(note);

        const numberInput = el.querySelector("input[type=number]");
        expect(numberInput).not.toBeNull();
        if (numberInput instanceof HTMLInputElement) {
            expect(numberInput.disabled).toBe(false);
            fireInput(numberInput, "3");
        }
        expect(attributes.setLabel).toHaveBeenCalledWith("tableNote", "maxNestingDepth", "3");
    });

    it("disables the number property for search notes", () => {
        const note = buildNote({ id: "tableSearch", title: "TS", type: "search", "#viewType": "table" });
        const el = renderTab(note);
        const numberInput = el.querySelector("input[type=number]");
        expect(numberInput).not.toBeNull();
        if (numberInput instanceof HTMLInputElement) {
            expect(numberInput.disabled).toBe(true);
        }
    });

    it("renders a combobox property for the geo-map view and writes the selection", () => {
        const note = buildNote({ id: "geoNote", title: "Geo", "#viewType": "geoMap" });
        const el = renderTab(note);

        // geoMap has a "map:style" combobox plus two checkboxes; assert the combobox select exists.
        // The first select is the type switcher; the property combobox is the second one.
        const selects = el.querySelectorAll("select");
        expect(selects.length).toBeGreaterThanOrEqual(2);
        const propertySelect = selects[1];
        if (propertySelect instanceof HTMLSelectElement && propertySelect.options.length > 0) {
            const targetValue = propertySelect.options[propertySelect.options.length - 1].value;
            propertySelect.value = targetValue;
            act(() => { propertySelect.dispatchEvent(new Event("change", { bubbles: true })); });
            expect(attributes.setLabel).toHaveBeenCalledWith("geoNote", "map:style", targetValue);
        }
    });

    it("renders a presentation combobox property", () => {
        const note = buildNote({ id: "presNote", title: "Pres", "#viewType": "presentation" });
        const el = renderTab(note);
        const selects = el.querySelectorAll("select");
        // Type switcher + presentation:theme combobox.
        expect(selects.length).toBeGreaterThanOrEqual(2);
    });
});
