import { Tooltip } from "bootstrap";
import { render } from "preact";
import { useState } from "preact/hooks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MenuHeaderAction, MenuHeaderActions, MenuItem } from "../../menus/context_menu";
import { formatShortcut, joinShortcut } from "../../services/keyboard_shortcut_display";
import { FormDropdownDivider, FormDropdownSubmenu, FormListHeader, FormListItem } from "./FormList";
import Menu, { bottomUpOrder, MenuItemRows, type MenuProps, MenuTile } from "./Menu";
import { shouldDropStart } from "./menu_context";

vi.mock("../../services/keyboard_actions", async (importOriginal) => {
    const original = await importOriginal<typeof import("../../services/keyboard_actions")>();
    return {
        ...original,
        default: {
            ...original.default,
            getAction: vi.fn(async (name: string) => {
                const shortcuts: Record<string, string[]> = {
                    cutNotesToClipboard: [ "CommandOrControl+X" ],
                    deleteNotes: [ "CommandOrControl+D" ]
                };
                return name in shortcuts ? { effectiveShortcuts: shortcuts[name] } : undefined;
            })
        }
    };
});

describe("shouldDropStart", () => {
    /** A level 200px wide at `left`, in a viewport 1000px wide. */
    const at = (left: number) => ({ left, right: left + 200, width: 200 });

    it("opens towards the end, and towards the start only when the start has more room", () => {
        expect(shouldDropStart(at(100), 1000, false, false)).toBe(false);
        expect(shouldDropStart(at(750), 1000, false, false)).toBe(true);
        // Short of room on both sides, it stays at the end unless the start has more.
        expect(shouldDropStart(at(50), 300, false, false)).toBe(false);
    });

    it("stays at the start once its level opened that way, until the room runs out", () => {
        expect(shouldDropStart(at(400), 1000, false, true)).toBe(true);
        expect(shouldDropStart(at(100), 1000, false, true)).toBe(false);
    });

    it("treats the left as the end in a right-to-left layout", () => {
        expect(shouldDropStart(at(750), 1000, true, false)).toBe(false);
        expect(shouldDropStart(at(50), 1000, true, false)).toBe(true);
    });
});

describe("Menu with declared rows", () => {
    const host = document.createElement("div");
    document.body.append(host);
    afterEach(() => render(null, host));

    /**
     * A menu written as components, with a submenu declared inside a component of its own, as the
     * global menu declares its "Advanced" submenu.
     */
    function renderMenu(props: Partial<MenuProps<unknown>> = {}) {
        const calls: string[] = [];
        const onClose = vi.fn(() => calls.push("close"));
        function Advanced() {
            return (
                <FormDropdownSubmenu title="Advanced" icon="bx bx-chip">
                    <FormListItem onClick={() => calls.push("log")}>Show log</FormListItem>
                    <FormListItem onClick={() => calls.push("reload")}>Reload</FormListItem>
                </FormDropdownSubmenu>
            );
        }
        render((
            <Menu anchor={{ x: 10, y: 10 }} onClose={onClose} {...props}>
                <FormListHeader text="Note" />
                <FormListItem onClick={() => calls.push("copy")}>Copy</FormListItem>
                <FormListItem disabled onClick={() => calls.push("delete")}>Delete</FormListItem>
                <FormDropdownDivider />
                <Advanced />
            </Menu>
        ), host);

        const menu = document.querySelector<HTMLElement>(".tn-popup.tn-menu");
        if (!menu) throw new Error("expected the menu to render");
        return { menu, calls, onClose };
    }

    function rowTitled(title: string) {
        const found = [ ...document.querySelectorAll<HTMLElement>("li.dropdown-item") ]
            .find((item) => item.querySelector(":scope > span")?.textContent === title);
        if (!found) throw new Error(`expected a row titled ${title}`);
        return found;
    }

    /** The open submenus' layers, each as the titles of its rows. */
    function layers(menu: HTMLElement) {
        return [ ...menu.querySelectorAll(":scope > div.dropdown-submenu > .dropdown-menu") ]
            .map((layer) => [ ...layer.querySelectorAll(":scope > .tn-menu-scroll > li") ].map((item) => item.textContent));
    }

    /** A press and its release, which runs a row. */
    const press = (element: HTMLElement) => {
        element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
        element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    };
    const key = (menu: HTMLElement, name: string, init: KeyboardEventInit = {}) =>
        menu.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init }));
    const activeTitle = (menu: HTMLElement) => menu.querySelector(".tn-menu-active > span")?.textContent;

    it("draws the rows it is given in order, and opens a declared submenu as a layer beside the scroller", async () => {
        const { menu, calls } = renderMenu();

        const rows = [ ...menu.querySelectorAll(":scope > .tn-menu-scroll > li") ]
            .map((item) => `${item.className || item.firstElementChild?.className} ${item.textContent}`);
        expect(rows).toEqual([
            "dropdown-header Note",
            "dropdown-item Copy",
            "dropdown-item disabled Delete",
            "dropdown-divider ",
            "dropdown-item dropdown-submenu Advanced"
        ]);

        rowTitled("Advanced").dispatchEvent(new PointerEvent("pointerenter"));
        await vi.waitFor(() => expect(layers(menu)).toEqual([ [ "Show log", "Reload" ] ]));
        expect(calls).toEqual([]);
    });

    it("draws a submenu row's icon and a description under its title", () => {
        render((
            <Menu anchor={{ x: 10, y: 10 }} onClose={vi.fn()}>
                <FormDropdownSubmenu title="Search" description="Tavily" icon="tn-brand tn-brand-tavily">
                    <FormListItem>Tavily</FormListItem>
                </FormDropdownSubmenu>
            </Menu>
        ), host);
        const toggle = document.querySelector(".dropdown-submenu > .dropdown-toggle");
        expect(toggle?.firstElementChild?.className).toBe("tn-brand tn-brand-tavily tn-icon");
        expect(toggle?.querySelector(".description")?.textContent).toBe("Tavily");
        expect(toggle?.querySelector(".description")?.previousElementSibling?.textContent).toBe("Search");
    });

    it("draws the description of an item under its title, and its trailing text at the end", () => {
        render(<Menu anchor={{ x: 10, y: 10 }} onClose={vi.fn()} items={[
            { title: "Auto", description: "Follow the global setting", checked: true },
            { title: "Plan", trailingText: "Work › R&D" }
        ]} />, host);
        const description = document.querySelector(".dropdown-item .description");
        expect(description?.textContent).toBe("Follow the global setting");
        expect(description?.previousElementSibling?.textContent).toBe("Auto");

        const trailingText = document.querySelector(".dropdown-item .menu-trailing-text");
        expect(trailingText?.textContent).toBe("Work › R&D");
        expect(trailingText?.previousElementSibling?.textContent).toBe("Plan");
    });

    it("closes the menu after running a row, but not for a row that opens a submenu or is disabled", async () => {
        const { menu, calls } = renderMenu();

        press(rowTitled("Delete"));
        press(rowTitled("Advanced"));
        await vi.waitFor(() => expect(layers(menu)).toHaveLength(1));
        expect(calls).toEqual([]);

        // The row runs first, as in Bootstrap's dropdowns, so a row that stops its click stays up.
        press(rowTitled("Show log"));
        expect(calls).toEqual([ "log", "close" ]);
    });

    it("walks the rows as they are drawn, into a declared submenu and back, skipping what cannot run", async () => {
        const { menu, calls } = renderMenu();
        const active = () => menu.querySelector(".tn-menu-active > span")?.textContent;

        key(menu, "ArrowDown");
        await vi.waitFor(() => expect(active()).toBe("Copy"));
        // "Delete" is disabled, and the header and the separator are not rows to stand on.
        key(menu, "ArrowDown");
        await vi.waitFor(() => expect(active()).toBe("Advanced"));

        key(menu, "ArrowRight");
        await vi.waitFor(() => expect(layers(menu)).toEqual([ [ "Show log", "Reload" ] ]));
        await vi.waitFor(() => expect(active()).toBe("Show log"));
        key(menu, "ArrowDown");
        await vi.waitFor(() => expect(active()).toBe("Reload"));

        key(menu, "ArrowLeft");
        await vi.waitFor(() => expect(layers(menu)).toEqual([]));
        expect(active()).toBe("Advanced");

        key(menu, "ArrowRight");
        await vi.waitFor(() => expect(active()).toBe("Show log"));
        key(menu, "Enter");
        expect(calls).toEqual([ "log", "close" ]);
    });

    it("does nothing with the keys that have nothing to act on", async () => {
        const { menu, calls, onClose } = renderMenu();

        // No row is active yet, so Enter runs nothing.
        key(menu, "Enter");
        // A letter with a modifier is a shortcut, not typeahead, and is left to the page.
        expect(key(menu, "c", { ctrlKey: true })).toBe(true);
        expect(activeTitle(menu)).toBeUndefined();

        // Up with no active row goes to the last row that can run.
        key(menu, "ArrowUp");
        await vi.waitFor(() => expect(activeTitle(menu)).toBe("Advanced"));
        // Left at the top level has no submenu to leave.
        key(menu, "ArrowLeft");
        // Tab keeps focus in the menu.
        expect(key(menu, "Tab")).toBe(false);
        expect(activeTitle(menu)).toBe("Advanced");
        expect(layers(menu)).toEqual([]);
        expect(calls).toEqual([]);
        expect(onClose).not.toHaveBeenCalled();
    });

    it("unmarks the pointer's row as the pointer leaves, but not an open submenu's row or the keys' row", async () => {
        const { menu } = renderMenu();
        const leave = () => menu.dispatchEvent(new PointerEvent("pointerleave"));

        rowTitled("Copy").dispatchEvent(new PointerEvent("pointerenter"));
        await vi.waitFor(() => expect(activeTitle(menu)).toBe("Copy"));
        leave();
        await vi.waitFor(() => expect(activeTitle(menu)).toBeUndefined());

        rowTitled("Advanced").dispatchEvent(new PointerEvent("pointerenter"));
        await vi.waitFor(() => expect(layers(menu)).toHaveLength(1));
        rowTitled("Reload").dispatchEvent(new PointerEvent("pointerenter"));
        await vi.waitFor(() => expect(activeTitle(menu)).toBe("Reload"));
        leave();
        // The keys go on from the row the open submenu stands beside.
        await vi.waitFor(() => expect(activeTitle(menu)).toBe("Advanced"));
        expect(layers(menu)).toEqual([ [ "Show log", "Reload" ] ]);
        expect(rowTitled("Advanced").classList).toContain("submenu-open");

        key(menu, "ArrowUp");
        await vi.waitFor(() => expect(activeTitle(menu)).toBe("Copy"));
        leave();
        await new Promise((resolve) => setTimeout(resolve));
        expect(activeTitle(menu)).toBe("Copy");
    });

    it("starts at the last row when asked to, and takes no focus once it is no longer wanted", async () => {
        const { menu } = renderMenu({ startAt: "last" });
        await vi.waitFor(() => expect(activeTitle(menu)).toBe("Advanced"));
        expect(document.activeElement).toBe(menu);
        render(null, host);

        const { menu: unwanted } = renderMenu({ startAt: "first", isWanted: () => false });
        await vi.waitFor(() => expect(unwanted.style.visibility).toBe("visible"));
        expect(document.activeElement).not.toBe(unwanted);
        expect(activeTitle(unwanted)).toBeUndefined();
    });

    it("splits a submenu row that runs an action of its own: the row runs it, its arrow only opens", async () => {
        const toggled = vi.fn();
        render((
            <Menu anchor={{ x: 10, y: 10 }} onClose={vi.fn()}>
                <FormDropdownSubmenu title="Duplicate" icon="bx bx-outline" onDropdownToggleClicked={toggled}>
                    <FormListItem>This note only</FormListItem>
                </FormDropdownSubmenu>
                <FormDropdownSubmenu title="Advanced" icon="bx bx-chip">
                    <FormListItem>Reload</FormListItem>
                </FormDropdownSubmenu>
            </Menu>
        ), host);
        const menu = document.querySelector<HTMLElement>(".tn-popup.tn-menu");
        if (!menu) throw new Error("expected the menu to render");

        expect(rowTitled("Advanced").querySelector(".tn-menu-split-toggle")).toBeNull();
        const duplicateRow = rowTitled("Duplicate");
        expect(duplicateRow.classList.contains("tn-menu-split")).toBe(true);
        const arrow = duplicateRow.querySelector<HTMLElement>(".tn-menu-split-toggle");
        if (!arrow) throw new Error("expected the split row to draw its arrow as a target");

        press(arrow);
        await vi.waitFor(() => expect(layers(menu)).toEqual([ [ "This note only" ] ]));
        expect(toggled).not.toHaveBeenCalled();

        press(duplicateRow);
        expect(toggled).toHaveBeenCalledOnce();
    });

    it("closes the menu after a split row's own action only when asked to", async () => {
        const onClose = vi.fn();
        render((
            <Menu anchor={{ x: 10, y: 10 }} onClose={onClose}>
                <FormDropdownSubmenu
                    title="Duplicate" icon="bx bx-outline" onDropdownToggleClicked={vi.fn()}
                >
                    <FormListItem>This note only</FormListItem>
                </FormDropdownSubmenu>
                <FormDropdownSubmenu
                    title="Open" icon="bx bx-folder" onDropdownToggleClicked={vi.fn()} closeOnSelect
                >
                    <FormListItem>Child</FormListItem>
                </FormDropdownSubmenu>
            </Menu>
        ), host);
        const menu = document.querySelector<HTMLElement>(".tn-popup.tn-menu");
        if (!menu) throw new Error("expected the menu to render");

        key(menu, "ArrowUp");
        await vi.waitFor(() => expect(activeTitle(menu)).toBe("Open"));
        key(menu, "Enter");
        expect(onClose).toHaveBeenCalledOnce();

        press(rowTitled("Duplicate"));
        const arrow = rowTitled("Open").querySelector<HTMLElement>(".tn-menu-split-toggle");
        if (!arrow) throw new Error("expected the split row to draw its arrow as a target");
        press(arrow);
        await vi.waitFor(() => expect(layers(menu)).toEqual([ [ "Child" ] ]));
        expect(onClose).toHaveBeenCalledOnce();

        press(rowTitled("Open"));
        expect(onClose).toHaveBeenCalledTimes(2);
    });

    it("neither opens nor runs a disabled submenu row", async () => {
        const toggled = vi.fn();
        render((
            <Menu anchor={{ x: 10, y: 10 }} onClose={vi.fn()}>
                <FormListItem>Copy</FormListItem>
                <FormDropdownSubmenu title="Export" icon="bx bx-export" disabled onDropdownToggleClicked={toggled}>
                    <FormListItem>As PDF</FormListItem>
                </FormDropdownSubmenu>
            </Menu>
        ), host);
        const menu = document.querySelector<HTMLElement>(".tn-popup.tn-menu");
        if (!menu) throw new Error("expected the menu to render");
        const exportRow = rowTitled("Export");
        expect(exportRow.getAttribute("aria-disabled")).toBe("true");

        exportRow.dispatchEvent(new PointerEvent("pointerenter"));
        press(exportRow);
        // Anything opened is rendered after the fact, so the layers are checked a turn later.
        await new Promise((resolve) => setTimeout(resolve));
        expect(layers(menu)).toEqual([]);
        expect(toggled).not.toHaveBeenCalled();

        // The keys pass over it.
        key(menu, "ArrowDown");
        await vi.waitFor(() => expect(activeTitle(menu)).toBe("Copy"));
        key(menu, "ArrowDown");
        expect(activeTitle(menu)).toBe("Copy");
    });

    it("opens submenus towards the start when the end has no room, arrows still at the end", async () => {
        // The menus and their rows are 120px wide, at the right edge of a 1024px viewport.
        vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(1024);
        vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(768);
        const measure = HTMLElement.prototype.getBoundingClientRect;
        vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
            return this.matches(".tn-menu, .dropdown-item")
                ? DOMRect.fromRect({ x: 900, y: 10, width: 120, height: 20 })
                : measure.call(this);
        });
        try {
            const { menu } = renderMenu();
            const advanced = rowTitled("Advanced");

            advanced.dispatchEvent(new PointerEvent("pointerenter"));
            await vi.waitFor(() => expect(layers(menu)).toHaveLength(1));
            const layer = menu.querySelector<HTMLElement>(":scope > div.dropdown-submenu > .dropdown-menu");
            // Next to the row's left edge (900px), not its right edge (1020px). happy-dom gives the
            // layer no width.
            await vi.waitFor(() => expect(parseFloat(layer?.style.left ?? "")).toBeLessThan(910));
            // The arrow marks a submenu, as in the operating system's menus, wherever it opens.
            expect(advanced.classList).not.toContain("dropstart");
        } finally {
            vi.restoreAllMocks();
        }
    });
});

describe("Menu with an action row", () => {
    const host = document.createElement("div");
    document.body.append(host);
    afterEach(() => {
        render(null, host);
        window.glob.isRtl = false;
        window.glob.device = "desktop";
    });

    function renderMenu() {
        const onSelect = vi.fn();
        const items: MenuItem<string>[] = [
            {
                kind: "actions",
                items: [
                    { title: "Cut", command: "cut", uiIcon: "bx bx-cut", keyboardShortcut: "cutNotesToClipboard" },
                    { title: "Copy", command: "copy", uiIcon: "bx bx-copy", enabled: false },
                    {
                        title: "Delete", command: "delete",
                        uiIcon: "bx bx-trash", uiIconBadge: "bx bx-x",
                        keyboardShortcut: "deleteNotes", tooltip: "Delete\nAsks first"
                    }
                ]
            },
            { kind: "separator" },
            { title: "Rename", command: "rename" },
            { title: "More", items: [ { title: "Inner", command: "inner" } ] }
        ];
        render(<Menu anchor={{ x: 10, y: 10 }} items={items} onSelect={onSelect} onClose={vi.fn()} />, host);

        const menu = document.querySelector<HTMLElement>(".tn-popup.tn-menu");
        if (!menu) throw new Error("expected the menu to render");
        return { menu, onSelect };
    }

    const key = (menu: HTMLElement, name: string) =>
        menu.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
    const active = (menu: HTMLElement) =>
        menu.querySelector(".tn-menu-active .tn-menu-action-title, li.tn-menu-active > span")?.textContent;

    it("steps through the actions as rows, the arrow towards the end moving on as Down does", async () => {
        const { menu, onSelect } = renderMenu();

        key(menu, "ArrowDown");
        await vi.waitFor(() => expect(active(menu)).toBe("Cut"));
        // The disabled "Copy" is passed over, and the last action leads on to the rows below.
        key(menu, "ArrowRight");
        await vi.waitFor(() => expect(active(menu)).toBe("Delete"));
        key(menu, "ArrowRight");
        await vi.waitFor(() => expect(active(menu)).toBe("Rename"));
        key(menu, "ArrowUp");
        await vi.waitFor(() => expect(active(menu)).toBe("Delete"));
        key(menu, "ArrowLeft");
        await vi.waitFor(() => expect(active(menu)).toBe("Cut"));

        key(menu, "Enter");
        expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ command: "cut" }), expect.any(KeyboardEvent));
    });

    it("closes a row's submenu once the pointer turns to the actions, a disabled one included", async () => {
        const { menu } = renderMenu();
        const layers = () => menu.querySelectorAll(":scope > div.dropdown-submenu > .dropdown-menu").length;
        const [ cut, copy ] = menu.querySelectorAll<HTMLElement>(".tn-menu-action");
        const more = [ ...menu.querySelectorAll<HTMLElement>("li.dropdown-item") ]
            .find((row) => row.querySelector(":scope > span")?.textContent === "More");
        if (!cut || !copy || !more) throw new Error("expected the actions and the More row to render");
        const point = (element: HTMLElement) =>
            element.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, movementX: 3 }));

        for (const action of [ cut, copy ]) {
            more.dispatchEvent(new PointerEvent("pointerenter"));
            await vi.waitFor(() => expect(layers()).toBe(1));
            point(action);
            await vi.waitFor(() => expect(layers()).toBe(0));
        }
        expect(more.classList).not.toContain("submenu-open");
    });

    it("goes on from a submenu's row once the pointer leaves for what is not a row", async () => {
        render((
            <Menu anchor={{ x: 10, y: 10 }} onClose={vi.fn()}>
                <FormListHeader
                    text="Group"
                    actions={[ { icon: "bx bx-plus", caption: "Add", callback: vi.fn() } ]}
                />
                <li className="tn-menu-actions" role="group">
                    <MenuTile
                        icon="bx bx-copy" title="Copy" tooltip="Copy" disabled onSelect={vi.fn()}
                    />
                    <FormDropdownSubmenu tile disabled icon="bx bx-grid" title="Tiles">
                        <FormListItem>Tile</FormListItem>
                    </FormDropdownSubmenu>
                </li>
                <FormListItem onClick={vi.fn()}>Rename</FormListItem>
                <FormDropdownSubmenu icon="bx bx-dots-horizontal" title="More">
                    <FormListItem onClick={vi.fn()}>Inner</FormListItem>
                </FormDropdownSubmenu>
            </Menu>
        ), host);
        const menu = document.querySelector<HTMLElement>(".tn-popup.tn-menu");
        const more = menu?.querySelector<HTMLElement>("li.dropdown-submenu");
        const targets = [
            ...menu?.querySelectorAll<HTMLElement>(".tn-menu-action") ?? [],
            menu?.querySelector<HTMLElement>(".tn-menu-header-actions")
        ];
        if (!menu || !more || targets.length !== 3) throw new Error("expected the menu to render");
        const layer = () => menu.querySelector(":scope > div.dropdown-submenu > .dropdown-menu");
        const point = (element: Element) =>
            element.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, movementX: 3 }));

        // A disabled action, a disabled submenu tile and a heading's actions.
        for (const target of targets) {
            if (!target) throw new Error("expected the target to render");
            point(more);
            const inner = await vi.waitFor(() => {
                const row = layer()?.querySelector("li.dropdown-item");
                if (!row) throw new Error("expected the submenu to open");
                return row;
            });
            point(inner);
            await vi.waitFor(() => expect(active(menu)).toBe("Inner"));
            point(target);
            await vi.waitFor(() => expect(layer()).toBeNull());

            key(menu, "ArrowUp");
            await vi.waitFor(() => expect(active(menu)).toBe("Rename"));
        }
    });

    it("sets an action's badge over the corner of its icon, which gives way around it", () => {
        const { menu } = renderMenu();
        const icons = [ ...menu.querySelectorAll(".tn-menu-action-icon") ].map((icon) =>
            [ ...icon.children ].map((child) => child.className).join(" + "));
        expect(icons).toEqual([
            "tn-icon bx bx-cut",
            "tn-icon bx bx-copy",
            "tn-icon bx bx-trash tn-menu-action-badged + tn-menu-action-badge bx bx-x"
        ]);
    });

    it("names or describes each action in its tooltip, with the shortcut on line 1", async () => {
        const { menu } = renderMenu();
        const [ cut, , remove ] = menu.querySelectorAll<HTMLElement>(".tn-menu-action");
        const tooltipText = (button: HTMLElement | undefined) => {
            const tooltip = button && Tooltip.getInstance(button);
            if (!tooltip) return undefined;
            tooltip.show();
            const text = document.querySelector(".tooltip:last-of-type .tooltip-inner")?.textContent;
            tooltip.hide();
            return text;
        };

        // Formatted for display, as a row's shortcut is, rather than the raw `CommandOrControl+X`.
        const shortcut = joinShortcut(formatShortcut("CommandOrControl+X"));
        await vi.waitFor(() => expect(tooltipText(cut)).toBe(`Cut (${shortcut})`));
        expect(shortcut).not.toContain("CommandOrControl");
        const deleteKey = joinShortcut(formatShortcut("CommandOrControl+D"));
        await vi.waitFor(() =>
            expect(tooltipText(remove)).toBe(`Delete (${deleteKey})\nAsks first`));
    });

    it("gives the actions no tooltip on a phone, which has no pointer to hover with", async () => {
        window.glob.device = "mobile";
        const { menu } = renderMenu();
        const [ cut, , remove ] = menu.querySelectorAll<HTMLElement>(".tn-menu-action");
        if (!cut || !remove) throw new Error("expected the actions to render");

        await new Promise((resolve) => setTimeout(resolve));
        expect(Tooltip.getInstance(cut)).toBeNull();
        expect(Tooltip.getInstance(remove)).toBeNull();
    });

    it("keeps Right and Left for the submenus on the other rows, mirrored right to left", async () => {
        const { menu } = renderMenu();

        key(menu, "ArrowUp");
        await vi.waitFor(() => expect(active(menu)).toBe("More"));
        key(menu, "ArrowRight");
        await vi.waitFor(() => expect(active(menu)).toBe("Inner"));
        key(menu, "ArrowLeft");
        await vi.waitFor(() => expect(active(menu)).toBe("More"));

        window.glob.isRtl = true;
        key(menu, "Home");
        await vi.waitFor(() => expect(active(menu)).toBe("Cut"));
        key(menu, "ArrowLeft");
        await vi.waitFor(() => expect(active(menu)).toBe("Delete"));
        key(menu, "ArrowRight");
        await vi.waitFor(() => expect(active(menu)).toBe("Cut"));
    });
});

describe("Menu with heading actions", () => {
    const host = document.createElement("div");
    document.body.append(host);
    afterEach(() => render(null, host));

    function renderMenu() {
        const calls: string[] = [];
        const onSelect = vi.fn();
        const action = (caption: string, icon: string): MenuHeaderAction =>
            ({ caption, icon, callback: (e) => calls.push(`${caption} ${e.type}`) });
        // Four, as a script can pass, past the three the type allows.
        const actions = [ action("Help", "bx bx-help-circle"), action("Options", "bx bx-cog"),
            action("Reset", "bx bx-reset"), action("Extra", "bx bx-plus") ];
        const items: MenuItem<string>[] = [
            { kind: "header", title: "Sort", actions: actions as MenuHeaderActions },
            { title: "By title", command: "title" },
            { title: "More", items: [ { title: "Inner", command: "inner" } ] }
        ];
        render(<Menu
            anchor={{ x: 10, y: 10 }} items={items} onSelect={onSelect}
            onClose={() => calls.push("close")}
        />, host);

        const menu = document.querySelector<HTMLElement>(".tn-popup.tn-menu");
        const buttons = [ ...menu?.querySelectorAll<HTMLButtonElement>(
            "h6.dropdown-header > .tn-menu-header-actions > button") ?? [] ];
        if (!menu || !buttons.length) throw new Error("expected the menu and the heading's actions");
        return { menu, buttons, calls, onSelect };
    }

    const key = (menu: HTMLElement, name: string) =>
        menu.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));

    it("draws at most three icon buttons after the title, named by tooltips and skipped by the keys", async () => {
        const { menu, buttons } = renderMenu();
        const tooltipText = (button: HTMLElement) => {
            const tooltip = Tooltip.getInstance(button);
            if (!tooltip) return undefined;
            tooltip.show();
            const text = document.querySelector(".tooltip:last-of-type .tooltip-inner")?.textContent;
            tooltip.hide();
            return text;
        };

        expect(menu.querySelector("h6.dropdown-header")?.textContent).toBe("Sort");
        expect(buttons.map((button) => [ ...button.classList ].join(" "))).toEqual([
            "icon-action bx bx-help-circle",
            "icon-action bx bx-cog",
            "icon-action bx bx-reset"
        ]);
        await vi.waitFor(() => expect(buttons.map(tooltipText)).toEqual([ "Help", "Options", "Reset" ]));

        key(menu, "ArrowDown");
        await vi.waitFor(() => expect(menu.querySelector("li.tn-menu-active > span")?.textContent).toBe("By title"));
    });

    it("closes the menu, then runs the action, keeping the focus and running no row", () => {
        const { buttons, calls, onSelect } = renderMenu();
        const [ , options ] = buttons;
        if (!options) throw new Error("expected the Options action");

        const press = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
        options.dispatchEvent(press);
        options.click();

        expect(press.defaultPrevented).toBe(true);
        expect(calls).toEqual([ "close", "Options click" ]);
        expect(onSelect).not.toHaveBeenCalled();
    });

    it("closes a row's submenu once the pointer turns to the heading's actions", async () => {
        const { menu, buttons: [ help ] } = renderMenu();
        const layers = () => menu.querySelectorAll(":scope > div.dropdown-submenu > .dropdown-menu").length;
        const more = [ ...menu.querySelectorAll<HTMLElement>("li.dropdown-item") ]
            .find((row) => row.querySelector(":scope > span")?.textContent === "More");
        if (!help || !more) throw new Error("expected the Help action and the More row");

        more.dispatchEvent(new PointerEvent("pointerenter"));
        await vi.waitFor(() => expect(layers()).toBe(1));
        help.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, movementX: 3 }));
        await vi.waitFor(() => expect(layers()).toBe(0));
    });
});

describe("bottomUpOrder", () => {
    const header = (title: string): MenuItem<unknown> => ({ kind: "header", title });
    const separator: MenuItem<unknown> = { kind: "separator" };
    const row = (title: string): MenuItem<unknown> => ({ title });
    /** The titles of `items` in the order a bottom-up menu draws them, top to bottom. */
    const drawn = (items: MenuItem<unknown>[]) => bottomUpOrder(items)
        .map((index) => items[index])
        .map((item) => (item && "title" in item ? item.title : "---"));

    it("reverses the rows, keeping headers above their rows and separators between groups", () => {
        expect(drawn([ row("a"), row("b"), separator, row("Configure") ]))
            .toEqual([ "Configure", "---", "b", "a" ]);
        expect(drawn([ header("H1"), row("a"), row("b"), separator, header("H2"), row("c") ]))
            .toEqual([ "H2", "c", "---", "H1", "b", "a" ]);
        expect(drawn([ row("a"), separator, header("H1"), row("b") ]))
            .toEqual([ "H1", "b", "---", "a" ]);
        expect(drawn([ header("H1"), row("a"), separator, row("b") ]))
            .toEqual([ "H1", "b", "---", "a" ]);
        expect(drawn([])).toEqual([]);
    });
});

describe("Menu of items above its anchor", () => {
    const host = document.createElement("div");
    const toggle = document.createElement("button");
    document.body.append(host, toggle);
    /** How tall happy-dom, which lays nothing out, is made to draw each row. */
    const ROW_HEIGHT = 30;

    beforeEach(() => {
        vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(1000);
        vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(800);
        vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(200);
        // As tall as its rows, so filtering shrinks it.
        const height = function (this: HTMLElement) {
            return this.matches(".tn-popup") ? ROW_HEIGHT * this.querySelectorAll("li").length : 0;
        };
        vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(height);
    });

    afterEach(() => {
        render(null, host);
        vi.restoreAllMocks();
    });

    /** Opens a menu from a toggle at `y`, as the status bar's are at the bottom of the window. */
    async function openAt(y: number, props: Partial<MenuProps<unknown>>) {
        const rect = DOMRect.fromRect({ x: 100, y, width: 80, height: 30 });
        vi.spyOn(toggle, "getBoundingClientRect").mockReturnValue(rect);
        render(<Menu anchor={toggle} onClose={vi.fn()} {...props} />, host);
        const menu = document.querySelector<HTMLElement>(".tn-popup.tn-menu");
        if (!menu) throw new Error("expected the menu to render");
        await vi.waitFor(() => expect(menu.style.visibility).toBe("visible"));
        return menu;
    }

    /** The rows of `list` top to bottom, a separator as `---`. */
    const rowsOf = (list: Element | null | undefined) =>
        [ ...list?.querySelectorAll(":scope > li") ?? [] ].map((item) => item.textContent || "---");
    const classesOf = (element: Element | null | undefined) =>
        [ ...element?.children ?? [] ].map((child) => child.className);
    const activeRow = (menu: HTMLElement) => menu.querySelector("li.tn-menu-active")?.textContent;
    const key = (menu: HTMLElement, name: string) => menu.dispatchEvent(
        new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true })
    );

    it("draws a filterable menu bottom-up, first row lowest and active as it opens", async () => {
        const menu = await openAt(700, { filterable: true, items: [
            { kind: "header", title: "Recent" }, { title: "Python" }, { title: "JavaScript" },
            { kind: "separator" },
            { kind: "header", title: "All" }, { title: "Plain text" }, { title: "Markdown" }
        ] });
        const box = menu.querySelector(":scope > .tn-menu-filterable");
        const list = () => box?.querySelector(":scope > .tn-menu-scroll");
        // The input next to the toggle, and the rows reversed, each header still above its rows.
        expect(classesOf(box)).toEqual([ "tn-menu-scroll", "tn-menu-filter" ]);
        expect(rowsOf(list()))
            .toEqual([ "All", "Markdown", "Plain text", "---", "Recent", "JavaScript", "Python" ]);
        expect(activeRow(menu)).toBe("Python");
        // The keys move as the rows are drawn.
        key(menu, "ArrowUp");
        await vi.waitFor(() => expect(activeRow(menu)).toBe("JavaScript"));

        // The best match goes lowest, and is the one Enter runs.
        key(menu, "p");
        await vi.waitFor(() => expect(rowsOf(list()))
            .toEqual([ "JavaScript", "Plain text", "Python" ]));
        expect(activeRow(menu)).toBe("Python");
        expect(menu.style.minWidth).toBe("200px");
        key(menu, "ArrowUp");
        await vi.waitFor(() => expect(activeRow(menu)).toBe("Plain text"));
    });

    it("keeps its submenus top-down, as it does a menu with no filter", async () => {
        const menu = await openAt(760, { filterable: true, items: [
            { title: "Python" },
            { title: "More", filterable: true, items: [ { title: "Ruby" }, { title: "Rust" } ] }
        ] });
        const topLevel = menu.querySelector(":scope > .tn-menu-filterable > .tn-menu-scroll");
        expect(rowsOf(topLevel)).toEqual([ "More", "Python" ]);
        key(menu, "ArrowUp");
        await vi.waitFor(() => expect(activeRow(menu)).toBe("More"));
        key(menu, "ArrowRight");
        await vi.waitFor(() => expect(activeRow(menu)).toBe("Ruby"));
        const layer = menu.querySelector(".dropdown-submenu .tn-menu-filterable");
        expect(classesOf(layer)).toEqual([ "tn-menu-filter", "tn-menu-scroll" ]);
        const layerRows = rowsOf(layer?.querySelector(":scope > .tn-menu-scroll"));
        expect(layerRows).toEqual([ "Ruby", "Rust" ]);

        render(null, host);
        const plain = await openAt(760, { items: [ { title: "Python" }, { title: "Ruby" } ] });
        const plainRows = rowsOf(plain.querySelector(":scope > .tn-menu-scroll"));
        expect(plainRows).toEqual([ "Python", "Ruby" ]);
        expect(activeRow(plain)).toBeUndefined();
    });

    it("stays above its toggle while filtering shrinks it enough to fit below", async () => {
        const menu = await openAt(640, { filterable: true, items: [
            { title: "Python" }, { title: "JavaScript" }, { title: "Plain text" },
            { title: "Markdown" }, { title: "Ruby" }
        ] });
        // Five rows, too tall for the room below the toggle: 640 - 5 × 30.
        expect(menu.style.top).toBe("490px");

        key(menu, "p");
        key(menu, "y");
        await vi.waitFor(() => expect(menu.querySelectorAll("li")).toHaveLength(1));
        window.dispatchEvent(new Event("resize"));
        await vi.waitFor(() => expect(menu.style.top).toBe("610px"));
    });

    it("filters the rows MenuItemRows draws, bottom-up, once they load", async () => {
        const items: MenuItem<unknown>[] = [
            { title: "Python" }, { title: "JavaScript" }, { kind: "separator" }, { title: "New" }
        ];
        let load = () => {};
        function LoadedRows() {
            const [ isLoaded, setIsLoaded ] = useState(false);
            load = () => setIsLoaded(true);
            return isLoaded ? <MenuItemRows items={items} /> : null;
        }
        const menu = await openAt(700, {
            filterable: true, placement: "top", children: <LoadedRows />
        });
        const box = menu.querySelector(":scope > .tn-menu-filterable");
        const list = () => box?.querySelector(":scope > .tn-menu-scroll");
        expect(classesOf(box)).toEqual([ "tn-menu-scroll", "tn-menu-filter" ]);
        expect(activeRow(menu)).toBeUndefined();

        load();
        await vi.waitFor(() => expect(rowsOf(list()))
            .toEqual([ "New", "---", "JavaScript", "Python" ]));
        await vi.waitFor(() => expect(activeRow(menu)).toBe("Python"));

        key(menu, "j");
        await vi.waitFor(() => expect(rowsOf(list())).toEqual([ "JavaScript" ]));
        expect(activeRow(menu)).toBe("JavaScript");
    });

    it("keeps the order of its rows with keepOrder, the best match first", async () => {
        const menu = await openAt(700, { filterable: true, keepOrder: true, items: [
            { title: "Python" }, { title: "JavaScript" }, { title: "Plain text" },
            { kind: "separator" }, { title: "Markdown" }
        ] });
        const box = menu.querySelector(":scope > .tn-menu-filterable");
        const list = () => box?.querySelector(":scope > .tn-menu-scroll");
        // The input stays next to the toggle.
        expect(classesOf(box)).toEqual([ "tn-menu-scroll", "tn-menu-filter" ]);
        expect(rowsOf(list())).toEqual([ "Python", "JavaScript", "Plain text", "---", "Markdown" ]);
        expect(activeRow(menu)).toBeUndefined();

        key(menu, "p");
        await vi.waitFor(() => expect(rowsOf(list()))
            .toEqual([ "Python", "Plain text", "JavaScript" ]));
        expect(activeRow(menu)).toBe("Python");
        key(menu, "ArrowDown");
        await vi.waitFor(() => expect(activeRow(menu)).toBe("Plain text"));
    });
});
