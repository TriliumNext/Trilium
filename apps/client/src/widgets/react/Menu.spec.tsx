import { Tooltip } from "bootstrap";
import { render } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MenuItem } from "../../menus/context_menu";
import { formatShortcut, joinShortcut } from "../../services/keyboard_shortcut_display";
import { FormDropdownDivider, FormDropdownSubmenu, FormListHeader, FormListItem } from "./FormList";
import Menu, { type MenuProps } from "./Menu";
import { shouldDropStart } from "./menu_context";

vi.mock("../../services/keyboard_actions", async (importOriginal) => {
    const original = await importOriginal<typeof import("../../services/keyboard_actions")>();
    return {
        ...original,
        default: {
            ...original.default,
            getAction: vi.fn(async (name: string) => (name === "cutNotesToClipboard"
                ? { effectiveShortcuts: [ "CommandOrControl+X" ] }
                : undefined))
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
                    { title: "Delete", command: "delete", uiIcon: "bx bx-trash", uiIconBadge: "bx bx-x", tooltip: "Delete, asking first" }
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

    it("names each action, or describes it, with the shortcut a row would show in its tooltip", async () => {
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
        expect(tooltipText(remove)).toBe("Delete, asking first");
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
