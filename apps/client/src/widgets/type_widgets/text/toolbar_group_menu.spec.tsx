import type { ToolbarGroupMenuItem, ToolbarGroupMenuRequest } from "@triliumnext/ckeditor5";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createToolbarGroupMenuHost } from "./toolbar_group_menu";

const ICON = `<svg viewBox="0 0 20 20"><path d="M0 0h20v20H0z"/></svg>`;

describe("createToolbarGroupMenuHost", () => {
    const anchor = document.createElement("button");
    anchor.setAttribute("aria-labelledby", "insert-label");
    document.body.append(anchor);
    let host = createToolbarGroupMenuHost();
    afterEach(() => {
        host.destroy();
        host = createToolbarGroupMenuHost();
    });

    function show() {
        const runs: string[] = [];
        // The plugin hides the menu before it runs an entry.
        const run = (name: string) => () => {
            host.hide();
            runs.push(name);
        };
        const items: ToolbarGroupMenuItem[] = [
            { kind: "entry", label: "Link", icon: ICON, isEnabled: true, run: run("link") },
            { kind: "separator" },
            { kind: "entry", label: "Math", isEnabled: false, run: run("math") },
            {
                kind: "entry", label: "Date/time", icon: ICON, isEnabled: true, run: run("date"),
                children: [ { kind: "entry", label: "2026-10-05", isEnabled: true, run: run("iso") } ]
            }
        ];
        const setElement = vi.fn<ToolbarGroupMenuRequest["setElement"]>();
        const onClose = vi.fn<ToolbarGroupMenuRequest["onClose"]>();
        host.show({ anchor, items, setElement, onClose });

        const menu = document.querySelector<HTMLElement>(".tn-popup.tn-menu");
        if (!menu) throw new Error("expected the menu to render");
        return { menu, runs, setElement, onClose };
    }

    function rowTitled(title: string) {
        const found = [ ...document.querySelectorAll<HTMLElement>("li.dropdown-item") ]
            .find((item) => item.textContent === title);
        if (!found) throw new Error(`expected a row titled ${title}`);
        return found;
    }

    const press = (element: HTMLElement) => {
        element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
        element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    };

    it("takes a place of its own height under the toolbar on a phone with no keyboard", async () => {
        window.glob.device = "mobile";
        const narrow = vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
            matches: true, media: query, onchange: null, dispatchEvent: () => true,
            addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}
        }));
        const height = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(320);
        try {
            const { menu, setElement } = show();
            expect(setElement).toHaveBeenCalledWith(menu);
            expect([ ...menu.classList ]).toEqual(expect.arrayContaining([
                "mobile-bottom-menu", "keyboard-panel", "keyboard-panel-own-height"
            ]));
            await vi.waitFor(() => {
                expect(document.body.style.getPropertyValue("--tn-keyboard-place-height")).toBe("320px");
            });
            expect(document.body.classList).toContain("keyboard-panel-open");
        } finally {
            host.hide();
            window.glob.device = "desktop";
            narrow.mockRestore();
            height.mockRestore();
        }
    });

    it("draws the entries as the app's menu, with their SVG icons, and hands the editor its element", () => {
        const { menu, setElement } = show();

        expect(setElement).toHaveBeenCalledWith(menu);
        expect(menu.classList).toContain("tn-dropdown-menu");
        expect(menu.getAttribute("aria-labelledby")).toBe("insert-label");
        const rows = [ ...menu.querySelectorAll(":scope > .tn-menu-scroll > li") ]
            .map((item) => `${item.className} ${item.textContent}`);
        expect(rows).toEqual([
            "dropdown-item Link",
            "dropdown-divider ",
            "dropdown-item disabled Math",
            "dropdown-item dropdown-submenu tn-menu-split Date/time"
        ]);
        expect(rowTitled("Link").querySelector(".tn-svg-icon > svg")).not.toBeNull();
        expect(rowTitled("Date/time").querySelector(".tn-svg-icon > svg")).not.toBeNull();
    });

    it("draws a heading over the rows it opens, and an entry's icon-pack glyph", async () => {
        const items: ToolbarGroupMenuItem[] = [
            { kind: "entry", label: "Ask AI…", iconClass: "bx bx-message", isEnabled: true },
            {
                kind: "entry", label: "Model", iconClass: "bx bx-chip", isEnabled: true,
                children: [ { kind: "heading", label: "OpenAI" }, { kind: "entry", label: "Fast", isEnabled: true } ]
            }
        ];
        host.show({ anchor, items, setElement: vi.fn(), onClose: vi.fn() });

        expect(rowTitled("Ask AI…").querySelector(".bx.bx-message")).not.toBeNull();
        const model = [ ...document.querySelectorAll<HTMLElement>("li.dropdown-submenu") ]
            .find((row) => row.textContent?.includes("Model"));
        expect(model?.querySelector(".bx.bx-chip")).not.toBeNull();

        model?.dispatchEvent(new PointerEvent("pointerenter"));
        const submenu = () => document.querySelector(".tn-popup.tn-menu > .dropdown-submenu > .dropdown-menu");
        await vi.waitFor(() => expect(submenu()).not.toBeNull());
        const rows = [ ...submenu()?.querySelectorAll(".tn-menu-scroll > li") ?? [] ];
        expect(rows.map((row) => row.textContent)).toEqual([ "OpenAI", "Fast" ]);
        expect(rows[0]?.querySelector(".dropdown-header")).not.toBeNull();
        expect(rows[1]?.classList).toContain("dropdown-item");
    });

    it("checks the entry that is on, and marks only those that can be on as checkable", () => {
        const items: ToolbarGroupMenuItem[] = [
            { kind: "entry", label: "Paragraph", icon: ICON, isEnabled: true, isOn: false },
            { kind: "entry", label: "Heading 2", icon: ICON, isEnabled: true, isOn: true, className: "ck-heading_heading2" },
            { kind: "entry", label: "Link", icon: ICON, isEnabled: true }
        ];
        host.show({ anchor, items, setElement: vi.fn(), onClose: vi.fn() });

        const paragraph = rowTitled("Paragraph");
        const heading = rowTitled("Heading 2");
        const link = rowTitled("Link");
        expect([ paragraph, heading, link ].map((row) => [ row.role, row.getAttribute("aria-checked") ])).toEqual([
            [ "menuitemcheckbox", "false" ],
            [ "menuitemcheckbox", "true" ],
            [ "menuitem", null ]
        ]);
        expect(heading.querySelector(".bx-check")).not.toBeNull();
        expect(heading.classList).toContain("ck-heading_heading2");
        // A class sizing the label, as the font size rows do, leaves the check and the gap as they are.
        expect(heading.querySelector(".toolbar-group-menu-label")?.textContent).toBe("Heading 2");
        expect(paragraph.querySelector(".bx-check")).toBeNull();
    });

    it("draws a switch as a toggle, which runs its entry", () => {
        const run = vi.fn(() => host.hide());
        const items: ToolbarGroupMenuItem[] = [
            { kind: "entry", label: "Header row", isEnabled: true, isOn: true, isSwitch: true, run },
            { kind: "entry", label: "Insert row", icon: ICON, isEnabled: true }
        ];
        host.show({ anchor, items, setElement: vi.fn(), onClose: vi.fn() });

        const header = [ ...document.querySelectorAll<HTMLElement>("li.dropdown-item") ]
            .find((item) => item.textContent?.includes("Header row"));
        expect(header?.classList).toContain("tn-menu-toggle");
        expect(header?.querySelector<HTMLInputElement>("input.switch-toggle")?.checked).toBe(true);
        expect(header?.querySelector(".bx-check")).toBeNull();
        expect(rowTitled("Insert row").classList).not.toContain("tn-menu-toggle");

        header?.click();
        expect(run).toHaveBeenCalledTimes(1);
    });

    it("draws the tiles layout as a grid of tiles per group, the one on checked", () => {
        const runs: string[] = [];
        const run = (name: string) => () => {
            host.hide();
            runs.push(name);
        };
        const items: ToolbarGroupMenuItem[] = [
            { kind: "entry", label: "Paragraph", icon: ICON, isEnabled: true, isOn: false, run: run("paragraph") },
            { kind: "entry", label: "Heading 2", icon: ICON, isEnabled: true, isOn: true, run: run("heading") },
            { kind: "separator" },
            { kind: "entry", label: "Bulleted List", icon: ICON, isEnabled: false, isOn: false, run: run("list") }
        ];
        host.show({ anchor, items, layout: "tiles", setElement: vi.fn(), onClose: vi.fn() });

        const menu = document.querySelector<HTMLElement>(".tn-popup.tn-menu");
        const groups = [ ...menu?.querySelectorAll(".toolbar-group-menu-tiles") ?? [] ];
        expect(groups.map((group) => [ ...group.querySelectorAll(".tn-menu-action") ].map((tile) => tile.textContent)))
            .toEqual([ [ "Paragraph", "Heading 2" ], [ "Bulleted List" ] ]);

        const tiles = [ ...menu?.querySelectorAll<HTMLButtonElement>(".tn-menu-action") ?? [] ];
        expect(tiles.map((tile) => [ tile.role, tile.getAttribute("aria-checked"), tile.disabled ])).toEqual([
            [ "menuitemcheckbox", "false", false ],
            [ "menuitemcheckbox", "true", false ],
            [ "menuitemcheckbox", "false", true ]
        ]);
        expect(tiles[0]?.querySelector(".tn-svg-icon > svg")).not.toBeNull();

        tiles[0]?.click();
        expect(runs).toEqual([ "paragraph" ]);
        expect(menu?.isConnected).toBe(false);
    });

    it("draws a heading over the tiles it starts, in the tiles layout", () => {
        const items: ToolbarGroupMenuItem[] = [
            { kind: "entry", label: "In line", icon: ICON, isEnabled: true },
            { kind: "heading", label: "Break text" },
            { kind: "entry", label: "Align left", icon: ICON, isEnabled: true },
            { kind: "entry", label: "Align center", icon: ICON, isEnabled: true },
            { kind: "heading", label: "Wrap text" },
            { kind: "entry", label: "Align left", icon: ICON, isEnabled: true }
        ];
        host.show({ anchor, items, layout: "tiles", setElement: vi.fn(), onClose: vi.fn() });

        const menu = document.querySelector<HTMLElement>(".tn-popup.tn-menu");
        const rows = [ ...menu?.querySelectorAll(":scope > .tn-menu-scroll > li") ?? [] ].map((row) =>
            (row.classList.contains("toolbar-group-menu-tiles")
                ? [ ...row.querySelectorAll(".tn-menu-action") ].map((tile) => tile.textContent).join(", ")
                : `# ${row.textContent}`));
        expect(rows).toEqual([ "In line", "# Break text", "Align left, Align center", "# Wrap text", "Align left" ]);
    });

    describe("an entry with a submenu, in the tiles layout", () => {
        afterEach(() => {
            window.glob.device = "desktop";
        });

        function showTiles() {
            const runs: string[] = [];
            const run = (name: string) => () => {
                host.hide();
                runs.push(name);
            };
            const items: ToolbarGroupMenuItem[] = [
                { kind: "entry", label: "Math", icon: ICON, isEnabled: true, run: run("math") },
                {
                    kind: "entry", label: "Date/time", icon: ICON, isEnabled: true, run: run("date"),
                    children: [ { kind: "entry", label: "2026-10-05", isEnabled: true, run: run("iso") } ]
                },
                { kind: "entry", label: "Emoji", icon: ICON, isEnabled: true, run: run("emoji") },
                {
                    kind: "entry", label: "Columns", isEnabled: false,
                    children: [ { kind: "entry", label: "3 columns", isEnabled: true, run: run("three") } ]
                }
            ];
            host.show({ anchor, items, layout: "tiles", setElement: vi.fn(), onClose: vi.fn() });

            const menu = document.querySelector<HTMLElement>(".tn-popup.tn-menu");
            const tile = [ ...menu?.querySelectorAll<HTMLElement>(".tn-menu-action") ?? [] ]
                .find((action) => action.textContent === "Date/time");
            if (!menu || !tile) throw new Error("expected the menu and its Date/time tile to render");
            return { menu, tile, runs };
        }

        it("is a tile among the others, marked as opening a submenu", () => {
            const { menu, tile } = showTiles();

            const groups = [ ...menu.querySelectorAll(".toolbar-group-menu-tiles") ];
            expect(groups.map((group) => [ ...group.querySelectorAll(".tn-menu-action") ].map((action) => action.textContent)))
                .toEqual([ [ "Math", "Date/time", "Emoji", "Columns" ] ]);
            expect(tile.getAttribute("aria-haspopup")).toBe("menu");
            expect(tile.getAttribute("aria-expanded")).toBe("false");
            expect(tile.querySelector(".tn-svg-icon > svg")).not.toBeNull();
            expect(tile.querySelector(".tn-menu-action-more")).not.toBeNull();

            const columns = [ ...menu.querySelectorAll<HTMLButtonElement>(".tn-menu-action") ].at(-1);
            expect(columns?.disabled).toBe(true);
            expect(columns?.querySelector(".tn-menu-action-icon > .tn-icon")).not.toBeNull();
        });

        it("becomes the active row as the pointer moves over it, and keeps the focus on a press", async () => {
            const { menu, tile } = showTiles();

            tile.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, movementX: 5 }));
            await vi.waitFor(() => expect(menu.querySelector(".tn-menu-active")?.textContent).toBe("Date/time"));
            const pressed = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 });
            tile.dispatchEvent(pressed);
            expect(pressed.defaultPrevented).toBe(true);
        });

        it("opens its submenu beside it, without running its own action, and runs a row of it", async () => {
            const { menu, tile, runs } = showTiles();

            tile.click();
            await vi.waitFor(() => expect(menu.querySelector(":scope > div.dropdown-submenu > .dropdown-menu")?.textContent)
                .toBe("2026-10-05"));
            expect(tile.getAttribute("aria-expanded")).toBe("true");
            expect(tile.classList).toContain("submenu-open");
            expect(runs).toEqual([]);

            press(rowTitled("2026-10-05"));
            expect(runs).toEqual([ "iso" ]);
        });

        it("keeps its submenu open under the pointer, until the pointer turns to another tile", async () => {
            const { menu, tile } = showTiles();
            const layer = () => menu.querySelector(":scope > div.dropdown-submenu > .dropdown-menu");
            const point = (element: Element | undefined) =>
                element?.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, movementX: 5 }));

            tile.click();
            await vi.waitFor(() => expect(layer()).not.toBeNull());
            point(tile);
            await new Promise((resolve) => setTimeout(resolve));
            expect(layer()).not.toBeNull();

            point([ ...menu.querySelectorAll(".tn-menu-action") ].find((action) => action.textContent === "Math"));
            await vi.waitFor(() => expect(layer()).toBeNull());
            expect(tile.getAttribute("aria-expanded")).toBe("false");
        });

        it("opens its submenu from the keys with Enter, Right moving on to the next tile", async () => {
            const { menu, runs } = showTiles();
            const key = (name: string) =>
                menu.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
            const active = () => menu.querySelector(".tn-menu-active")?.textContent;

            key("ArrowDown");
            await vi.waitFor(() => expect(active()).toBe("Math"));
            key("ArrowRight");
            await vi.waitFor(() => expect(active()).toBe("Date/time"));
            key("Enter");
            await vi.waitFor(() => expect(active()).toBe("2026-10-05"));
            expect(runs).toEqual([]);
        });

        it("opens its submenu as a page on a phone", async () => {
            window.glob.device = "mobile";
            const { menu, tile } = showTiles();

            tile.click();
            const page = () => menu.querySelector<HTMLElement>(":scope > .tn-menu-page");
            await vi.waitFor(() => expect(page()?.querySelector(".tn-menu-scroll")?.textContent).toBe("2026-10-05"));
            expect(page()?.querySelector(".tn-menu-page-header")?.textContent).toContain("Date/time");
        });
    });

    it("runs an entry without closing a second time, and leaves a disabled one alone", () => {
        const { menu, runs, setElement, onClose } = show();

        press(rowTitled("Math"));
        expect(runs).toEqual([]);

        press(rowTitled("Link"));
        expect(runs).toEqual([ "link" ]);
        expect(onClose).not.toHaveBeenCalled();
        expect(setElement).toHaveBeenLastCalledWith(null);
        expect(menu.isConnected).toBe(false);
    });

    it("runs a submenu's opener and its rows", async () => {
        const opened = show();
        press(rowTitled("Date/time"));
        expect(opened.runs).toEqual([ "date" ]);

        const { menu, runs } = show();
        rowTitled("Date/time").dispatchEvent(new PointerEvent("pointerenter"));
        await vi.waitFor(() => expect(menu.querySelector(".dropdown-submenu > .dropdown-menu")).not.toBeNull());
        press(rowTitled("2026-10-05"));
        expect(runs).toEqual([ "iso" ]);
    });

    it("stays open as the phone toolbar is dragged, and closes as a tap on another item clicks", () => {
        const island = document.createElement("div");
        island.className = "classic-toolbar-island";
        const row = document.createElement("div");
        row.className = "classic-toolbar-widget";
        const bold = document.createElement("button");
        const boldClicked = vi.fn();
        bold.addEventListener("click", boldClicked);
        row.append(bold);
        island.append(row);
        document.body.append(island);

        const { menu, onClose } = show();
        bold.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
        expect(menu.isConnected).toBe(true);
        expect(onClose).not.toHaveBeenCalled();

        bold.click();
        expect(onClose).toHaveBeenCalledExactlyOnceWith(false);
        expect(menu.isConnected).toBe(false);
        expect(boldClicked).toHaveBeenCalledTimes(1);

        // The menu's own button, which toggles it, is left to the editor.
        row.append(anchor);
        const toggled = show();
        anchor.click();
        expect(toggled.onClose).not.toHaveBeenCalled();
        document.body.append(anchor);
        island.remove();
    });

    it("returns focus to the group's button on Escape, and not on a press elsewhere", () => {
        const escaped = show();
        escaped.menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
        expect(escaped.onClose).toHaveBeenCalledExactlyOnceWith(true);
        expect(escaped.menu.isConnected).toBe(false);

        const dismissed = show();
        document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
        expect(dismissed.onClose).toHaveBeenCalledExactlyOnceWith(false);
        expect(dismissed.setElement).toHaveBeenLastCalledWith(null);
    });
});
