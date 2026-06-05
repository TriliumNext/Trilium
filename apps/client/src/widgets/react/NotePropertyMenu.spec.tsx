import { render, VNode } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the component import) --------------------------------------------

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
    class Dropdown {
        static getOrCreateInstance() { return new Dropdown(); }
        dispose() {}
    }
    return { Tooltip, Dropdown, default: { Tooltip, Dropdown } };
});

import Component from "../../components/component";
import attributes from "../../services/attributes";
import froca from "../../services/froca";
import { buildNote } from "../../test/easy-froca";
import { ParentComponent } from "./react_utils";
import {
    BookProperty,
    ButtonProperty,
    CheckBoxProperty,
    ComboBoxProperty,
    NumberProperty,
    SplitButtonProperty,
    ViewProperty
} from "./NotePropertyMenu";

// --- Render helper --------------------------------------------------------------------------------

let container: HTMLDivElement | undefined;

function renderInto(vnode: VNode, parent: Component | null = new Component()) {
    container = document.createElement("div");
    document.body.appendChild(container);
    act(() => {
        render(
            <ParentComponent.Provider value={parent}>{vnode}</ParentComponent.Provider>,
            container as HTMLDivElement
        );
    });
    return container;
}

beforeEach(() => {
    for (const key of Object.keys(froca.notes)) delete froca.notes[key];
    for (const key of Object.keys(froca.attributes)) delete froca.attributes[key];
    for (const key of Object.keys(froca.branches)) delete froca.branches[key];
    vi.clearAllMocks();
    // A bootstrap-tooltip plugin and jquery `.on/.off` are exercised by FormList/FormListItem.
    Object.assign($.fn as unknown as Record<string, unknown>, { tooltip: vi.fn() });
});

afterEach(() => {
    if (container) {
        act(() => render(null, container as HTMLDivElement));
        container.remove();
        container = undefined;
    }
    vi.restoreAllMocks();
});

// --- Separator ------------------------------------------------------------------------------------

describe("ViewProperty - separator", () => {
    it("renders a dropdown divider", () => {
        const property: BookProperty = { type: "separator" };
        const note = buildNote({ id: "sepNote", title: "S" });
        const el = renderInto(<ViewProperty note={note} property={property} />);
        expect(el.querySelector(".dropdown-divider")).toBeTruthy();
    });
});

// --- Button ---------------------------------------------------------------------------------------

describe("ViewProperty - button", () => {
    it("renders an item, exposes icon/title and forwards a bound triggerCommand on click", () => {
        const note = buildNote({ id: "btnNote", title: "B" });
        const onClick = vi.fn();
        const property: ButtonProperty = {
            type: "button",
            label: "Do it",
            title: "A title",
            icon: "bx bx-cog",
            onClick
        };
        const parent = new Component();
        const triggerSpy = vi.spyOn(parent, "triggerCommand").mockResolvedValue(undefined as never);

        const el = renderInto(<ViewProperty note={note} property={property} />, parent);
        const item = el.querySelector(".dropdown-item");
        expect(item).toBeTruthy();
        expect(item?.getAttribute("title")).toBe("A title");
        expect(el.querySelector(".bx-cog")).toBeTruthy();

        (item as HTMLElement | null)?.click();
        expect(onClick).toHaveBeenCalledTimes(1);
        const ctx = onClick.mock.calls[0][0];
        expect(ctx.note).toBe(note);
        // The forwarded triggerCommand is bound to the parent component.
        ctx.triggerCommand("foo");
        expect(triggerSpy).toHaveBeenCalledWith("foo");
    });

    it("does nothing on click when there is no parent component", () => {
        const note = buildNote({ id: "btnNoParent", title: "B" });
        const onClick = vi.fn();
        const property: ButtonProperty = { type: "button", label: "X", onClick };

        const el = renderInto(<ViewProperty note={note} property={property} />, null);
        (el.querySelector(".dropdown-item") as HTMLElement | null)?.click();
        expect(onClick).not.toHaveBeenCalled();
    });
});

// --- Split button ---------------------------------------------------------------------------------

describe("ViewProperty - split-button", () => {
    it("renders the submenu, the inner items component, and fires onClick on toggle", () => {
        const note = buildNote({ id: "splitNote", title: "S" });
        const onClick = vi.fn();
        const items = vi.fn(({ note: innerNote }: { note: typeof note; parentComponent: Component }) => (
            <div className="inner-items">{innerNote.noteId}</div>
        ));
        const property: SplitButtonProperty = {
            type: "split-button",
            label: "Split",
            icon: "bx bx-list-ul",
            onClick,
            items
        };
        const parent = new Component();

        const el = renderInto(<ViewProperty note={note} property={property} />, parent);
        expect(el.querySelector(".dropdown-submenu")).toBeTruthy();
        expect(el.querySelector(".bx-list-ul")).toBeTruthy();
        // Inner items component received the note + parentComponent.
        expect(el.querySelector(".inner-items")?.textContent).toBe("splitNote");
        expect(items).toHaveBeenCalled();
        const itemsArgs = items.mock.calls[0][0];
        expect(itemsArgs.note).toBe(note);
        expect(itemsArgs.parentComponent).toBe(parent);

        const toggle = el.querySelector(".dropdown-toggle") as HTMLElement | null;
        toggle?.click();
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it("falls back to the empty icon and renders nothing without a parent", () => {
        const note = buildNote({ id: "splitNoParent", title: "S" });
        const items = vi.fn(() => <div className="inner-x" />);
        const property: SplitButtonProperty = {
            type: "split-button",
            label: "Split",
            onClick: vi.fn(),
            items
        };

        // Default icon branch (no icon supplied) with a parent present.
        const withParent = renderInto(<ViewProperty note={note} property={property} />, new Component());
        expect(withParent.querySelector(".bx-empty")).toBeTruthy();

        // No parent → the whole submenu renders nothing.
        const withoutParent = renderInto(<ViewProperty note={note} property={property} />, null);
        expect(withoutParent.querySelector(".dropdown-submenu")).toBeNull();
        expect(withoutParent.querySelector(".inner-x")).toBeNull();
    });
});

// --- Checkbox -------------------------------------------------------------------------------------

describe("ViewProperty - checkbox", () => {
    it("reflects the boolean label and writes the new value through the setter", () => {
        const note = buildNote({ id: "cbNote", title: "C", "#archived": "true" });
        const setBool = vi.spyOn(attributes, "setBooleanWithInheritance").mockImplementation(() => undefined as never);
        const property: CheckBoxProperty = {
            type: "checkbox",
            label: "Archived",
            bindToLabel: "archived",
            icon: "bx bx-archive"
        };

        const el = renderInto(<ViewProperty note={note} property={property} />);
        const toggle = el.querySelector("input[type=checkbox]") as HTMLInputElement | null;
        expect(toggle?.checked).toBe(true);

        // Click the list item (the toggle's onChange is a no-op; the item drives the change).
        const item = el.querySelector(".dropdown-item") as HTMLElement | null;
        act(() => item?.click());
        expect(setBool).toHaveBeenCalledWith(note, "archived", false);
    });

    it("inverts the displayed value and the written value when reverseValue is set", () => {
        // Label false → with reverseValue the checkbox shows checked.
        const note = buildNote({ id: "cbRev", title: "C", "#archived": "false" });
        const setBool = vi.spyOn(attributes, "setBooleanWithInheritance").mockImplementation(() => undefined as never);
        const property: CheckBoxProperty = {
            type: "checkbox",
            label: "Show",
            bindToLabel: "archived",
            reverseValue: true
        };

        const el = renderInto(<ViewProperty note={note} property={property} />);
        const toggle = el.querySelector("input[type=checkbox]") as HTMLInputElement | null;
        expect(toggle?.checked).toBe(true);

        const item = el.querySelector(".dropdown-item") as HTMLElement | null;
        act(() => item?.click());
        // newValue (from !currentValue=false) is inverted again before writing → true.
        expect(setBool).toHaveBeenCalledWith(note, "archived", true);
    });
});

// --- Number ---------------------------------------------------------------------------------------

describe("ViewProperty - number", () => {
    it("renders a number input seeded from the label and stops click propagation", () => {
        const note = buildNote({ id: "numNote", title: "N", "#tabWidth": "5" });
        const setLabel = vi.spyOn(attributes, "setLabel").mockImplementation(() => undefined as never);
        const property: NumberProperty = {
            type: "number",
            label: "Tab width",
            bindToLabel: "tabWidth",
            width: 80,
            min: 1,
            icon: "bx bx-tab"
        };

        const el = renderInto(<ViewProperty note={note} property={property} />);
        const input = el.querySelector("input[type=number]") as HTMLInputElement | null;
        expect(input?.value).toBe("5");
        expect(el.querySelector(".bx-tab")).toBeTruthy();

        // Clicking the list item must not bubble (onClick stops propagation).
        const item = el.querySelector(".dropdown-item") as HTMLElement | null;
        const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
        const stopSpy = vi.spyOn(ev, "stopPropagation");
        item?.dispatchEvent(ev);
        expect(stopSpy).toHaveBeenCalled();

        // Editing the value persists via setLabel.
        if (input) {
            input.value = "9";
            act(() => { input.dispatchEvent(new Event("input", { bubbles: true })); });
        }
        expect(setLabel).toHaveBeenCalledWith("numNote", "tabWidth", "9");
    });

    it("disables the input and item when disabled() returns true; defaults width/min when omitted", () => {
        const note = buildNote({ id: "numDisabled", title: "N" });
        const property: NumberProperty = {
            type: "number",
            label: "Depth",
            bindToLabel: "maxNestingDepth",
            disabled: () => true
        };

        const el = renderInto(<ViewProperty note={note} property={property} />);
        const input = el.querySelector("input[type=number]") as HTMLInputElement | null;
        expect(input?.disabled).toBe(true);
        // No label present → empty value with default min=0.
        expect(input?.value).toBe("");
        expect(input?.getAttribute("min")).toBe("0");
        expect(el.querySelector(".dropdown-item.disabled")).toBeTruthy();
    });
});

// --- Combobox -------------------------------------------------------------------------------------

describe("ViewProperty - combobox", () => {
    it("renders plain items, marks the active one, and writes on selection", () => {
        const note = buildNote({ id: "cmbNote", title: "C", "#displayMode": "b" });
        const setLabel = vi.spyOn(attributes, "setLabel").mockImplementation(() => undefined as never);
        const removeLabel = vi.spyOn(attributes, "removeOwnedLabelByName").mockImplementation(() => undefined as never);
        const property: ComboBoxProperty = {
            type: "combobox",
            label: "Mode",
            icon: "bx bx-cog",
            bindToLabel: "displayMode",
            options: [
                { value: "a", label: "Alpha" },
                { value: "b", label: "Beta" },
                { value: null, label: "None" }
            ]
        };

        const el = renderInto(<ViewProperty note={note} property={property} />);
        const items = Array.from(el.querySelectorAll(".dropdown-submenu .dropdown-item"));
        expect(items.length).toBe(3);
        // Active value "b" gets the check icon.
        expect(el.querySelector(".bx-check")).toBeTruthy();

        // Select first option → setValue("a") → setLabel.
        act(() => (items[0] as HTMLElement).click());
        expect(setLabel).toHaveBeenCalledWith("cmbNote", "displayMode", "a");

        // Select the null option → removeOwnedLabelByName.
        act(() => (items[2] as HTMLElement).click());
        expect(removeLabel).toHaveBeenCalledWith(note, "displayMode");
    });

    it("uses defaultValue when the label is missing and the empty icon when none is given", () => {
        const note = buildNote({ id: "cmbDefault", title: "C" });
        const property: ComboBoxProperty = {
            type: "combobox",
            label: "Mode",
            bindToLabel: "displayMode",
            defaultValue: "a",
            dropStart: true,
            options: [
                { value: "a", label: "Alpha" },
                { value: "b", label: "Beta" }
            ]
        };

        const el = renderInto(<ViewProperty note={note} property={property} />);
        // Default icon fallback.
        expect(el.querySelector(".bx-empty")).toBeTruthy();
        // dropStart class applied to the submenu.
        expect(el.querySelector(".dropdown-submenu.dropstart")).toBeTruthy();
        // defaultValue "a" → first option checked.
        expect(el.querySelector(".bx-check")).toBeTruthy();
    });

    it("falls back to null when neither a value nor a defaultValue is present", () => {
        const note = buildNote({ id: "cmbNull", title: "C" });
        const property: ComboBoxProperty = {
            type: "combobox",
            label: "Mode",
            bindToLabel: "displayMode",
            options: [
                { value: "a", label: "Alpha" },
                { value: null, label: "None" }
            ]
        };

        const el = renderInto(<ViewProperty note={note} property={property} />);
        // valueWithDefault resolves to null → the null-valued option is the checked one.
        const items = Array.from(el.querySelectorAll(".dropdown-submenu .dropdown-item"));
        expect(items.length).toBe(2);
        // Exactly one check icon, on the null option (index 1).
        expect(el.querySelectorAll(".bx-check").length).toBe(1);
        expect(items[1]?.querySelector(".bx-check")).toBeTruthy();
    });

    it("renders groups with headers and dividers as well as separators", () => {
        const note = buildNote({ id: "cmbGroups", title: "C", "#displayMode": "x1" });
        const property: ComboBoxProperty = {
            type: "combobox",
            label: "Grouped",
            bindToLabel: "displayMode",
            options: [
                { title: "Group A", items: [ { value: "x1", label: "X1" }, { value: "x2", label: "X2" } ] },
                { type: "separator" },
                { title: "Group B", items: [ { value: "y1", label: "Y1" } ] }
            ]
        };

        const el = renderInto(<ViewProperty note={note} property={property} />);
        // Group headers render as disabled items.
        const disabledHeaders = el.querySelectorAll(".dropdown-submenu .dropdown-item.disabled");
        expect(disabledHeaders.length).toBe(2);
        // Both group divider (after group A, not last) and the explicit separator render dividers.
        expect(el.querySelectorAll(".dropdown-divider").length).toBeGreaterThanOrEqual(2);
        // The active grouped item gets the check icon.
        expect(el.querySelector(".bx-check")).toBeTruthy();
    });
});
