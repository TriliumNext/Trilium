import { type ComponentChildren, render } from "preact";
import { describe, expect, it, vi } from "vitest";

// FormList instantiates a real Bootstrap dropdown in an effect; stub it so the
// component mounts without pulling in Bootstrap's layout-dependent machinery.
vi.mock("bootstrap", () => ({
    Dropdown: { getOrCreateInstance: () => ({ dispose() {} }) },
    Tooltip: class { static getInstance() { return null; } }
}));

import FormList, { FormListItem } from "./FormList";

describe("FormList keyboard activation", () => {
    it.each([ "Enter", " " ])("activates the focused item on %j like a click", (key) => {
        const { container, onSelect } = renderList();
        const item = getItem(container, "text");

        const event = press(item, key);

        expect(onSelect).toHaveBeenCalledExactlyOnceWith("text");
        expect(event.defaultPrevented).toBe(true);
    });

    it("ignores keys other than Enter/Space", () => {
        const { container, onSelect } = renderList();

        const event = press(getItem(container, "text"), "a");

        expect(onSelect).not.toHaveBeenCalled();
        expect(event.defaultPrevented).toBe(false);
    });

    it("does not activate a disabled item", () => {
        const { container, onSelect } = renderList();

        press(getItem(container, "code"), "Enter");

        expect(onSelect).not.toHaveBeenCalled();
    });

    it("leaves typing inside an embedded input alone", () => {
        const onSelect = vi.fn();
        const container = mount(
            <FormList onSelect={onSelect}>
                <input className="embedded-search" />
                <FormListItem value="text">Text</FormListItem>
            </FormList>
        );
        const input = container.querySelector<HTMLInputElement>(".embedded-search");
        expect(input).not.toBeNull();

        const event = press(input as HTMLInputElement, "Enter");

        expect(onSelect).not.toHaveBeenCalled();
        expect(event.defaultPrevented).toBe(false);
    });
});

function renderList() {
    const onSelect = vi.fn();
    const container = mount(
        <FormList onSelect={onSelect}>
            <FormListItem value="text">Text</FormListItem>
            <FormListItem value="code" disabled>Code</FormListItem>
        </FormList>
    );
    return { container, onSelect };
}

function mount(node: ComponentChildren) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    render(node, container);
    return container;
}

function getItem(container: HTMLElement, value: string) {
    const item = container.querySelector<HTMLElement>(`.dropdown-item[data-value="${value}"]`);
    if (!item) {
        throw new Error(`No dropdown item with value "${value}"`);
    }
    return item;
}

function press(el: Element, key: string) {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
    el.dispatchEvent(event);
    return event;
}
