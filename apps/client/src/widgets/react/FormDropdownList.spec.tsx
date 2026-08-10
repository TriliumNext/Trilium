import $ from "jquery";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Bootstrap places the menu and its tooltips against a real layout, which happy-dom has none of; what
// the list decides is which items exist, how the current one is marked, and what a press reports.
vi.mock("bootstrap", () => ({
    Dropdown: { getOrCreateInstance: () => ({ show() {}, hide() {}, update() {}, dispose() {} }) },
    Tooltip: class { static getInstance() { return null; } }
}));
vi.mock("./hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./hooks")>()),
    useStaticTooltip: vi.fn(),
    useTooltip: () => ({ showTooltip: vi.fn(), hideTooltip: vi.fn() })
}));

import FormDropdownList from "./FormDropdownList";

// happy-dom has no ResizeObserver; the dropdown only needs observe/disconnect to exist.
class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
}
globalThis.ResizeObserver = globalThis.ResizeObserver ?? (ResizeObserverStub as unknown as typeof ResizeObserver);

interface Entry {
    value: string;
    title: string;
    shortcut?: string;
    icon?: string;
    hint?: string;
    startsGroup?: boolean;
}

const ENTRIES: Entry[] = [
    { value: "text", title: "Text", shortcut: "abc", hint: "Any text", icon: "bx bx-text" },
    { value: "number", title: "Number", icon: "bx bx-hash" },
    { value: "relation", title: "Relation", icon: "bx bx-transfer", startsGroup: true }
];

describe("FormDropdownList", () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        render(null, container);
        container.remove();
    });

    it("labels the button with the current item, and marks that item rather than checking it when the items carry icons", () => {
        const onChange = vi.fn();
        renderOpened(
            <FormDropdownList
                values={ENTRIES}
                keyProperty="value"
                titleProperty="title"
                titleSuffixProperty="shortcut"
                descriptionProperty="hint"
                iconProperty="icon"
                dividerBeforeProperty="startsGroup"
                currentValue="text"
                onChange={onChange}
            />);

        const button = container.querySelector("button");
        expect(button?.textContent).toContain("Text");
        // The suffix is shown beside the title rather than as part of it.
        expect(button?.querySelector("small")?.textContent).toBe("abc");
        expect(button?.querySelector(".bx-text")).not.toBeNull();

        const items = [ ...container.querySelectorAll(".dropdown-item") ];
        expect(items.map((item) => item.textContent?.replace(/\s+/g, " ").trim()))
            .toEqual([ "Text abcAny text", "Number", "Relation" ]);
        // A check mark would take the icon's slot, so the current item is highlighted instead.
        expect(items[0].className).toContain("active");
        expect(items[0].querySelector(".bx-check")).toBeNull();
        expect(items[0].querySelector(".bx-text")).not.toBeNull();

        // Only the item that starts a group is preceded by a rule.
        expect(container.querySelectorAll(".dropdown-divider")).toHaveLength(1);
        expect(items[2].previousElementSibling?.className).toContain("dropdown-divider");

        act(() => (items[1] as HTMLElement).click());
        expect(onChange).toHaveBeenCalledExactlyOnceWith("number");
    });

    it("checks the current item where there are no icons, and labels nothing for a value it does not hold", () => {
        renderOpened(
            <FormDropdownList
                values={ENTRIES}
                keyProperty="value"
                titleProperty="title"
                dividerBeforeProperty="startsGroup"
                currentValue="nonexistent"
                onChange={vi.fn()}
            />);

        expect(container.querySelector("button")?.textContent).toBe("");
        expect([ ...container.querySelectorAll(".dropdown-item") ].some((item) => item.className.includes("active")))
            .toBe(false);

        renderOpened(
            <FormDropdownList
                values={ENTRIES}
                keyProperty="value"
                titleProperty="title"
                currentValue="number"
                onChange={vi.fn()}
            />);

        const items = [ ...container.querySelectorAll(".dropdown-item") ];
        expect(items[1].querySelector(".bx-check")).not.toBeNull();
        expect(items[1].className).not.toContain("active");
        // Without a property to read it from, no item starts a group of its own.
        expect(container.querySelectorAll(".dropdown-divider")).toHaveLength(0);
    });

    /** The menu only renders its items once Bootstrap reports it open, which nothing does here. */
    function renderOpened(vnode: preact.ComponentChild) {
        act(() => render(vnode, container));
        const dropdown = container.querySelector(".dropdown");
        act(() => {
            if (dropdown) $(dropdown).trigger("show.bs.dropdown");
        });
    }
});
