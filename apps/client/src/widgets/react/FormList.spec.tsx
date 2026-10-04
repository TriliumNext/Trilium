import { type ComponentChildren, render } from "preact";
import { describe, expect, it, vi } from "vitest";

// Rows with a tooltip use Bootstrap's `Tooltip`, stubbed so they mount without its layout code.
vi.mock("bootstrap", () => ({
    Tooltip: class { static getInstance() { return null; } }
}));

const help = vi.hoisted(() => ({ open: vi.fn() }));
const layout = vi.hoisted(() => ({ onMobile: false }));
vi.mock("../../services/utils", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../services/utils")>()),
    isMobile: () => layout.onMobile,
    openInAppHelpFromUrl: help.open
}));
vi.mock("../../services/keyboard_actions", () => ({
    getActionSync: () => ({ effectiveShortcuts: [ "CommandOrControl+Q" ] })
}));

import FormList, { focusListItem, FormDropdownDivider, FormDropdownSubmenu, FormListCustomItem, FormListHeader, FormListItem, FormListToggleableItem } from "./FormList";

describe("FormDropdownDivider", () => {
    it("draws a separator among the rows, whose click closes no menu", () => {
        const host = document.createElement("div");
        render(<menu><FormDropdownDivider /></menu>, host);
        const divider = host.querySelector(".dropdown-divider");
        const pageHeard = vi.fn();
        host.addEventListener("click", pageHeard);

        // A list item, as the menu's rows are, and a separator to assistive technology.
        expect(divider?.tagName).toBe("LI");
        expect(divider?.getAttribute("role")).toBe("separator");
        divider?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        expect(pageHeard).not.toHaveBeenCalled();
    });
});

describe("FormListHeader", () => {
    it("heads the rows after it as text, out of the list's own roles", () => {
        const host = document.createElement("div");
        // A name the user wrote, such as a board column's status.
        render(<menu><FormListHeader text="<b>Doing</b>" /></menu>, host);
        const row = host.querySelector("menu > li");

        // Its heading speaks for it, so the row reads as no list item of the menu's.
        expect(row?.getAttribute("role")).toBe("none");
        expect(row?.querySelector("h6.dropdown-header")?.textContent).toBe("<b>Doing</b>");
    });
});

describe("FormListItem", () => {
    it("lays its row out as one span of icon, gap and content, as a menu's rows are", () => {
        const host = document.createElement("div");
        render((
            <menu>
                <FormListItem icon="bx bx-copy" iconClassName="use-note-color" badges={[ { text: "new" } ]}>Copy</FormListItem>
            </menu>
        ), host);
        const row = host.querySelector("li.dropdown-item");

        const [ span, ...others ] = [ ...row?.children ?? [] ];
        expect(others).toEqual([]);
        expect(span?.tagName).toBe("SPAN");
        expect(span?.className).toBe("");
        expect([ ...span?.children ?? [] ].map((child) => child.className)).toEqual([
            "bx bx-copy use-note-color tn-icon", "tn-menu-gap", "badge"
        ]);
        expect(span?.textContent).toBe("Copynew");
    });

    it("ends its row with a shortcut, then a trailing icon, leaving its own icon standing", () => {
        const host = document.createElement("div");
        render((
            <menu>
                <FormListItem icon="bx bx-sort" shortcut="Ctrl+S" trailingIcon="bx bx-check">By title</FormListItem>
            </menu>
        ), host);
        const span = host.querySelector("li.dropdown-item > span");

        expect([ ...span?.children ?? [] ].map((child) => `${child.tagName.toLowerCase()}.${child.className}`)).toEqual([
            "span.bx bx-sort tn-icon", "span.tn-menu-gap", "kbd.", "span.bx bx-check tn-icon menu-trailing-icon"
        ]);
        expect(span?.textContent).toBe("By titleCtrl+S");
    });

    it("shows no shortcuts on a phone, which has no keyboard to press them on", () => {
        const host = document.createElement("div");
        const rows = () => render((
            <menu>
                <FormListItem shortcut="Ctrl+S">Save</FormListItem>
                <FormListItem keyboardShortcut="copyNotesToClipboard">Copy</FormListItem>
            </menu>
        ), host);
        rows();
        expect(host.querySelectorAll("kbd").length).toBeGreaterThan(1);
        expect(host.querySelector(".keyboard-shortcut")).not.toBeNull();

        layout.onMobile = true;
        try {
            rows();
            expect(host.querySelector("kbd")).toBeNull();
            expect(host.querySelector(".keyboard-shortcut")).toBeNull();
            expect(host.textContent).toBe("SaveCopy");
        } finally {
            layout.onMobile = false;
        }
    });
});

describe("FormListItem presses", () => {
    function renderRow(props: { disabled?: boolean } = {}) {
        const host = document.createElement("div");
        const onClick = vi.fn();
        render((
            <menu>
                <FormListItem {...props} onClick={onClick}>Size <input className="size" /><input type="checkbox" /></FormListItem>
            </menu>
        ), host);
        const row = host.querySelector<HTMLElement>("li.dropdown-item");
        if (!row) throw new Error("expected the row");
        return { row, onClick };
    }
    const mousedown = (target: Element, button = 0) => {
        const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button });
        target.dispatchEvent(event);
        return event;
    };

    it("keeps focus where it was on a press, and runs on its release", () => {
        const { row, onClick } = renderRow();

        expect(mousedown(row).defaultPrevented).toBe(true);
        // As a switch, which works by its click.
        const checkbox = row.querySelector("input[type=checkbox]");
        if (!checkbox) throw new Error("expected the checkbox");
        expect(mousedown(checkbox).defaultPrevented).toBe(true);
        expect(onClick).not.toHaveBeenCalled();

        row.click();
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it("lets a field in the row take focus, and a button other than the primary one be", () => {
        const { row } = renderRow();
        const field = row.querySelector(".size");
        if (!field) throw new Error("expected the field");

        expect(mousedown(field).defaultPrevented).toBe(false);
        expect(mousedown(row, 2).defaultPrevented).toBe(false);
    });

    it("runs nothing when disabled, though a click reaches it", () => {
        const { row, onClick } = renderRow({ disabled: true });

        row.click();
        expect(onClick).not.toHaveBeenCalled();
    });
});

describe("FormListCustomItem", () => {
    it("holds a control of its own in a row outside any menu too, where there is none to join", () => {
        const host = document.createElement("div");
        render(<menu><FormListCustomItem><button className="swatch" /></FormListCustomItem></menu>, host);
        const row = host.querySelector("menu > li");

        expect(row?.className).toBe("dropdown-custom-item");
        // Its content carries the roles of what it acts with.
        expect(row?.getAttribute("role")).toBe("none");
        expect(row?.querySelector("button.swatch")).not.toBeNull();
    });
});

describe("FormDropdownSubmenu", () => {
    it("renders its title as a header above its rows outside a menu", () => {
        const host = document.createElement("div");
        render(<menu><FormDropdownSubmenu icon="bx bx-chip" title="Advanced">
            <FormListItem>Reload</FormListItem>
        </FormDropdownSubmenu></menu>, host);
        const rows = [ ...host.querySelectorAll("menu > li") ];

        expect(rows.map((row) => row.textContent)).toEqual([ "Advanced", "Reload" ]);
        expect(rows[0]?.querySelector("h6.dropdown-header")).not.toBeNull();
        expect(host.querySelector(".dropdown-submenu")).toBeNull();
    });
});

describe("focusListItem", () => {
    /** A list of three items, the middle one disabled, the last holding a nested list of its own. */
    function list() {
        const root = document.createElement("ul");
        root.className = "dropdown-menu";
        root.innerHTML = `
            <li class="dropdown-item" tabindex="0">A</li>
            <li class="dropdown-item disabled" tabindex="0">B</li>
            <li class="dropdown-item" tabindex="0">C<ul class="dropdown-menu"><li class="dropdown-item" tabindex="0">Nested</li></ul></li>`;
        document.body.append(root);
        return root;
    }
    const focused = () => document.activeElement?.firstChild?.textContent;

    it("focuses the list's own enabled items, from either end when none is current", () => {
        const root = list();
        focusListItem(root, "last");
        expect(focused()).toBe("C");
        focusListItem(root, "first");
        expect(focused()).toBe("A");
        focusListItem(root, "previous");
        expect(focused()).toBe("C");
        focusListItem(root, "next");
        expect(focused()).toBe("A");
        root.remove();
    });

    it("leaves focus alone in a list with no enabled item", () => {
        const root = document.createElement("ul");
        root.innerHTML = `<li class="dropdown-item disabled" tabindex="0">B</li>`;
        document.body.append(root);
        const before = document.activeElement;
        focusListItem(root, "first");
        expect(document.activeElement).toBe(before);
        root.remove();
    });
});

describe("FormListToggleableItem", () => {
    function mountToggle(props: { onChange(value: boolean): void | Promise<void>, disabled?: boolean }) {
        const pageHeard = vi.fn();
        const container = mount(
            <menu onClick={pageHeard}>
                <FormListToggleableItem title="Shared" currentValue={false} helpPage="R9pX4DGra2Vt" {...props} />
            </menu>
        );
        const row = container.querySelector<HTMLElement>("li.dropdown-item");
        if (!row) throw new Error("expected the row");
        return { row, pageHeard };
    }

    it("flips its value once per click, ignoring clicks while the change is still running", async () => {
        let finish = () => {};
        const onChange = vi.fn(() => new Promise<void>((resolve) => finish = resolve));
        const { row, pageHeard } = mountToggle({ onChange });

        row.click();
        row.click();
        expect(onChange).toHaveBeenCalledExactlyOnceWith(true);
        // A menu around it stays open.
        expect(pageHeard).not.toHaveBeenCalled();

        finish();
        await vi.waitFor(() => {
            row.click();
            expect(onChange).toHaveBeenCalledTimes(2);
        });
    });

    it("does not change when disabled, and opens its help page without changing", () => {
        const onChange = vi.fn();
        const { row } = mountToggle({ onChange, disabled: true });
        row.click();
        expect(onChange).not.toHaveBeenCalled();

        const { row: enabled } = mountToggle({ onChange });
        const helpIcon = enabled.querySelector<HTMLElement>(".contextual-help");
        if (!helpIcon) throw new Error("expected the help icon");
        helpIcon.click();
        expect(help.open).toHaveBeenCalledExactlyOnceWith("R9pX4DGra2Vt");
        expect(onChange).not.toHaveBeenCalled();
    });
});

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

    it("leaves Enter on a control inside an item to that control", () => {
        const onSelect = vi.fn();
        const container = mount(
            <FormList onSelect={onSelect}>
                <FormListItem value="text"><button className="inner-action">Edit</button> Text</FormListItem>
            </FormList>
        );
        const button = container.querySelector<HTMLButtonElement>(".inner-action");
        if (!button) throw new Error("expected the inner button");

        const event = press(button, "Enter");

        expect(onSelect).not.toHaveBeenCalled();
        expect(event.defaultPrevented).toBe(false);
    });

    it("moves focus over enabled items with Up and Down, stopping the keys", () => {
        const container = mount(
            <FormList>
                <input className="embedded-search" />
                <FormListItem value="text">Text</FormListItem>
                <FormListItem value="code" disabled>Code</FormListItem>
                <FormListItem value="book">Book</FormListItem>
            </FormList>
        );
        // Bootstrap's dropdown handler listens there, and throws for a list with no toggle.
        const documentHeard = vi.fn();
        document.addEventListener("keydown", documentHeard, true);
        expect(container.querySelector("[data-bs-toggle]")).toBeNull();

        press(getItem(container, "text"), "ArrowDown");
        expect(document.activeElement).toBe(getItem(container, "book"));
        // Wraps from the last item to the first.
        press(getItem(container, "book"), "ArrowDown");
        expect(document.activeElement).toBe(getItem(container, "text"));
        press(getItem(container, "text"), "ArrowUp");
        expect(document.activeElement).toBe(getItem(container, "book"));
        expect(documentHeard).not.toHaveBeenCalled();

        // Arrow keys in a field are left to the field.
        const input = container.querySelector<HTMLInputElement>(".embedded-search");
        expect(input).not.toBeNull();
        const event = press(input as HTMLInputElement, "ArrowDown");
        expect(event.defaultPrevented).toBe(false);
        document.removeEventListener("keydown", documentHeard, true);
    });

    it("stops Escape before Bootstrap's handler and a dialog around the list", () => {
        const container = mount(<FormList><FormListItem value="text">Text</FormListItem></FormList>);
        const dialogHeard = vi.fn();
        container.addEventListener("keydown", dialogHeard);

        expect(() => press(getItem(container, "text"), "Escape")).not.toThrow();
        expect(dialogHeard).not.toHaveBeenCalled();
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
