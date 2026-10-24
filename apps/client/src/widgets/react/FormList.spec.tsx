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

import FormList, { focusListItem, FormDropdownDivider, FormDropdownSubmenu, FormListCustomItem, FormListHeader, FormListItem, FormListToggleableItem, menuItemTooltipSide } from "./FormList";

describe("FormDropdownDivider", () => {
    it("draws a separator among the rows, whose click closes no menu", () => {
        const host = document.createElement("div");
        render(<menu role="none"><FormDropdownDivider /></menu>, host);
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
        render(<menu role="none"><FormListHeader text="<b>Doing</b>" /></menu>, host);
        const row = host.querySelector("menu > li");

        // Its heading speaks for it, so the row reads as no list item of the menu's.
        expect(row?.getAttribute("role")).toBe("none");
        expect(row?.querySelector("h6.dropdown-header")?.textContent).toBe("<b>Doing</b>");
    });

    it("runs its actions outside a menu too", () => {
        const host = document.createElement("div");
        const callback = vi.fn();
        render((
            <menu role="none">
                <FormListHeader text="Fonts" actions={[ { icon: "bx bx-cog", caption: "Options", callback } ]} />
            </menu>
        ), host);
        const button = host.querySelector<HTMLButtonElement>("h6 > .tn-menu-header-actions > button");
        if (!button) throw new Error("expected the action's button");

        button.click();
        expect(callback).toHaveBeenCalledWith(expect.any(MouseEvent));
    });
});

describe("FormListItem", () => {
    it("lays its row out as one span of icon, gap and content, as a menu's rows are", () => {
        const host = document.createElement("div");
        render((
            <menu role="none">
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

    it("ends its row with a shortcut, a trailing text, then a trailing icon, leaving its own icon standing", () => {
        const host = document.createElement("div");
        render((
            <menu role="none">
                <FormListItem icon="bx bx-sort" shortcut="Ctrl+S" trailingText="Sorting" trailingIcon="bx bx-check">By title</FormListItem>
            </menu>
        ), host);
        const span = host.querySelector("li.dropdown-item > span");

        expect([ ...span?.children ?? [] ].map((child) => `${child.tagName.toLowerCase()}.${child.className}`)).toEqual([
            "span.bx bx-sort tn-icon", "span.tn-menu-gap", "kbd.", "span.menu-trailing-text",
            "span.bx bx-check tn-icon menu-trailing-icon"
        ]);
        expect(span?.textContent).toBe("By titleCtrl+SSorting");
    });

    it("shows no shortcuts on a phone, which has no keyboard to press them on, but keeps a trailing text", () => {
        const host = document.createElement("div");
        const rows = () => render((
            <menu role="none">
                <FormListItem shortcut="Ctrl+S">Save</FormListItem>
                <FormListItem keyboardShortcut="copyNotesToClipboard">Copy</FormListItem>
                <FormListItem trailingText="Work">Plan</FormListItem>
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
            expect(host.textContent).toBe("SaveCopyPlanWork");
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
            <menu role="none">
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
        render(<menu role="none"><FormListCustomItem><button className="swatch" /></FormListCustomItem></menu>, host);
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
        render(<menu role="none"><FormDropdownSubmenu icon="bx bx-chip" title="Advanced">
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
            <menu role="none" onClick={pageHeard}>
                <FormListToggleableItem title="Shared" currentValue={false} helpPage="R9pX4DGra2Vt" {...props} />
            </menu>
        );
        const row = container.querySelector<HTMLElement>("li.dropdown-item");
        if (!row) throw new Error("expected the row");
        return { row, pageHeard };
    }

    it("marks its row as a switch row, alongside a class it is given", () => {
        const container = mount(
            <menu role="none">
                <FormListToggleableItem title="Shared" currentValue={false} onChange={() => {}} className="share-row" />
            </menu>
        );
        const row = container.querySelector<HTMLElement>("li.dropdown-item");
        expect([ row?.classList.contains("tn-menu-toggle"), row?.classList.contains("share-row") ]).toEqual([ true, true ]);
    });

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

describe("menuItemTooltipSide", () => {
    /** A row spanning `left`–`right`, and a tooltip laid out at `width` but capped by its inner. */
    function sideFor(left: number, right: number, width: number) {
        const row = document.createElement("li");
        row.getBoundingClientRect = () => ({ left, right } as DOMRect);
        const tip = document.createElement("div");
        tip.style.width = `${width}px`;
        const inner = document.createElement("div");
        inner.className = "tooltip-inner";
        inner.style.maxWidth = "500px";
        tip.append(inner);
        // Attached, as Bootstrap shows it, so the inner's computed cap can be read.
        document.body.append(tip);
        try {
            return menuItemTooltipSide(tip, row);
        } finally {
            tip.remove();
        }
    }

    it("keeps every row of a menu on one side, whatever its tooltip's width", () => {
        const { innerWidth } = window;
        window.innerWidth = 1000;
        try {
            window.glob.isRtl = false;
            // Room for a tooltip at its widest on the right.
            expect([ 100, 400 ].map((width) => sideFor(100, 480, width))).toStrictEqual([ "right", "right" ]);
            // Not enough of it: both go left, the narrow one included.
            expect([ 100, 400 ].map((width) => sideFor(400, 780, width))).toStrictEqual([ "left", "left" ]);

            window.glob.isRtl = true;
            expect(sideFor(700, 990, 100)).toBe("left");
            expect(sideFor(300, 600, 100)).toBe("right");
        } finally {
            window.glob.isRtl = false;
            window.innerWidth = innerWidth;
        }
    });

    it("wraps a tooltip into the room its side has when the window is too narrow for it", () => {
        const { innerWidth } = window;
        window.innerWidth = 700;
        try {
            const row = document.createElement("li");
            row.getBoundingClientRect = () => ({ left: 300, right: 500 } as DOMRect);
            const tip = document.createElement("div");
            const inner = document.createElement("div");
            inner.className = "tooltip-inner";
            inner.style.maxWidth = "500px";
            tip.append(inner);
            document.body.append(tip);

            try {
                // 194px to the right against 294 to the left: the roomier side, narrowed to fit it.
                expect(menuItemTooltipSide(tip, row)).toBe("left");
                expect(tip.style.maxWidth).toBe("294px");

                // A later show with room to spare is not held to the width of the one before.
                window.innerWidth = 1000;
                row.getBoundingClientRect = () => ({ left: 0, right: 200 } as DOMRect);
                expect(menuItemTooltipSide(tip, row)).toBe("right");
                expect(tip.style.maxWidth).toBe("");
            } finally {
                tip.remove();
            }
        } finally {
            window.innerWidth = innerWidth;
        }
    });
});
