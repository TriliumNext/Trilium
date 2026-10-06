import { h } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/note_tooltip", () => ({ default: { dismissAllTooltips: vi.fn() } }));
vi.mock("../services/keyboard_actions", () => ({
    getActionSync: (name: string) => ({
        effectiveShortcuts: name === "copyNotesToClipboard" ? [ "Ctrl+C", "Ctrl+Insert" ] : []
    })
}));
const layout = vi.hoisted(() => ({
    onMobile: false,
    narrow: true,
    onChange: new Set<() => void>()
}));
vi.mock("../services/utils", async (importOriginal) => {
    const original = await importOriginal<typeof import("../services/utils")>();
    // `Menu` imports `isMobile()` by name, `contextMenu` through the default export.
    const overrides = {
        isMobile: () => layout.onMobile,
        isNarrowLayout: () => layout.narrow,
        onNarrowLayoutChange: (listener: () => void) => {
            layout.onChange.add(listener);
            return () => layout.onChange.delete(listener);
        }
    };
    return { ...original, ...overrides, default: { ...original.default, ...overrides } };
});
const focusTraps = vi.hoisted(() => ({ restore: vi.fn(), suspend: vi.fn() }));
vi.mock("../widgets/react/modal_focustrap", () => ({
    suspendModalFocusTraps: () => {
        focusTraps.suspend();
        return focusTraps.restore;
    }
}));
// Key names are translated; the formatting has specs of its own.
vi.mock("../services/keyboard_shortcut_display", () => ({
    formatShortcut: (shortcut: string) => shortcut.split("+"),
    joinShortcut: (tokens: string[]) => tokens.join("+")
}));

/** The page as the shell leaves it. */
function buildPage() {
    document.body.innerHTML = `<div id="app"></div>`;
}

/** The open menu, under the id the stylesheets and the app's floating layers know it by. */
function menuElement() {
    return document.getElementById("context-menu-container");
}

/** The top level's rows, which scroll inside the menu. */
function menuRows() {
    return [ ...menuElement()?.querySelector(":scope > .tn-menu-scroll")?.children ?? [] ];
}

/** Puts an element on a screen of its own, as the browser reports one. */
function setFullscreenElement(element: Element | null) {
    Object.defineProperty(document, "fullscreenElement", { value: element, configurable: true });
}

/** A fresh menu service, built against the page as it now stands. */
async function buildContextMenu() {
    vi.resetModules();
    return (await import("./context_menu")).default;
}

const items = [ { title: "Add a marker at this location", handler: () => {} } ];

beforeEach(() => {
    setFullscreenElement(null);
});

describe("contextMenu", () => {
    it("mounts the menu while it is up, and leaves nothing behind once hidden", async () => {
        buildPage();
        const contextMenu = await buildContextMenu();
        const onHide = vi.fn();
        // What the container holds when `onShow` gets it, before the menu takes focus inside it.
        let shownContainer: { element: HTMLElement; isConnected: boolean; isEmpty: boolean } | null
            = null;
        const onShow = (element: HTMLElement) => {
            shownContainer = {
                element,
                isConnected: element.isConnected,
                isEmpty: !element.hasChildNodes()
            };
        };

        await contextMenu.show({
            x: 10, y: 20, items, selectMenuItemHandler: () => {}, onShow, onHide
        });

        const menu = menuElement();
        expect(menu?.parentElement?.parentElement).toBe(document.body);
        expect(shownContainer).toEqual({
            element: menu?.parentElement,
            isConnected: true,
            isEmpty: true
        });
        expect(menu?.getAttribute("role")).toBe("menu");
        // The classes the old menu carried, which the stylesheets and themes style it by.
        expect([ ...menu?.classList ?? [] ]).toEqual(expect.arrayContaining([
            "dropdown-menu", "dropdown-menu-sm", "dropend", "show"
        ]));
        expect(document.body.classList.contains("context-menu-shown")).toBe(true);

        await contextMenu.hide();
        expect(menuElement()).toBeNull();
        expect(document.body.innerHTML).toBe(`<div id="app"></div>`);
        expect(document.body.classList.contains("context-menu-shown")).toBe(false);
        expect(onHide).toHaveBeenCalledTimes(1);

        // A later click on the page hides nothing, so `onHide` does not run again.
        await contextMenu.hide();
        expect(onHide).toHaveBeenCalledTimes(1);
    });

    it("shows only the last of two menus asked for while `Menu` still loads, and hides it", async () => {
        buildPage();
        const contextMenu = await buildContextMenu();

        await Promise.all([
            contextMenu.show({ x: 10, y: 20, items: [ { title: "First" } ], selectMenuItemHandler: () => {} }),
            contextMenu.show({ x: 30, y: 40, items: [ { title: "Second" } ], selectMenuItemHandler: () => {} })
        ]);

        const menus = document.querySelectorAll("#context-menu-container");
        expect(menus).toHaveLength(1);
        expect(menus[0].textContent).toContain("Second");

        await contextMenu.hide();
        expect(document.body.innerHTML).toBe(`<div id="app"></div>`);
    });

    describe("items", () => {
        it("lists the items and separators in order, without repeating a separator", async () => {
            buildPage();
            const contextMenu = await buildContextMenu();

            await contextMenu.show({
                x: 10, y: 10, selectMenuItemHandler: () => {},
                items: [
                    { title: "Cut" },
                    { title: "Copy", className: "destructive-action" },
                    { kind: "separator" },
                    { kind: "separator" },
                    { title: "Paste" }
                ]
            });

            const rows = menuRows()
                .map(row => `${row.tagName.toLowerCase()}.${row.className} ${row.textContent}`);
            expect(rows).toEqual([
                "li.dropdown-item Cut",
                "li.dropdown-item destructive-action Copy",
                "li.dropdown-divider ",
                "li.dropdown-item Paste"
            ]);
        });

        it("renders a title as HTML, as callers escape and mark it up", async () => {
            buildPage();
            const contextMenu = await buildContextMenu();

            await contextMenu.show({
                x: 10, y: 10, selectMenuItemHandler: () => {},
                items: [ { title: `Tolkien &amp; &lt;sons&gt; <span class="tn-menu-name">Not set</span>` } ]
            });

            const row = menuElement()?.querySelector("[role=menuitem]");
            expect(row?.textContent).toBe("Tolkien & <sons> Not set");
            expect(row?.querySelector(".tn-menu-name")).not.toBeNull();
        });

        it("shows an item's icon, a check mark after a checked item with one and in its place without, and a slot for none", async () => {
            buildPage();
            const contextMenu = await buildContextMenu();

            await contextMenu.show({
                x: 10, y: 10, selectMenuItemHandler: () => {},
                items: [
                    { title: "To Do", uiIcon: "bx bx-list-ul", iconColorClass: "use-note-color color-e64d4d" },
                    { title: "Done", uiIcon: "bx bx-list-ul", checked: true },
                    { title: "Wrap", checked: true },
                    { title: "Blank", uiIcon: "bx bx-empty", checked: true },
                    { title: "Aligned", uiIcon: undefined },
                    { title: "Plain" }
                ]
            });

            // Each row is a span of icon slot, gap and title, which `.dropdown-item > span` lays out.
            const slots = [ ...menuElement()?.querySelectorAll("li.dropdown-item") ?? [] ].map(row => {
                const [ icon, gap ] = row.querySelector(":scope > span")?.children ?? [];
                expect(gap?.className).toBe("tn-menu-gap");
                return icon?.className || icon?.textContent;
            });
            expect(slots).toEqual([
                "bx bx-list-ul use-note-color color-e64d4d tn-icon",
                // The item's own icon tells it from the others, so the check goes to the trailing edge.
                "bx bx-list-ul tn-icon",
                "bx bx-check tn-icon",
                "bx bx-check tn-icon",
                // A blank icon of an icon's width, which lines the title up with the others.
                "bx bx-empty tn-icon",
                ""
            ]);
            // Only the icon is tinted, so the title keeps the menu's own colour.
            expect(menuElement()?.querySelectorAll(".use-note-color")).toHaveLength(1);
            const trailing = [ ...menuElement()?.querySelectorAll("li.dropdown-item") ?? [] ]
                .map((row) => row.querySelector(".menu-trailing-icon")?.className ?? null);
            expect(trailing).toEqual([ null, "bx bx-check tn-icon menu-trailing-icon", null, null, null, null ]);
        });

        it("shows a keyboard action's shortcuts, or a literal shortcut, after the title", async () => {
            buildPage();
            const contextMenu = await buildContextMenu();

            await contextMenu.show({
                x: 10, y: 10, selectMenuItemHandler: () => {},
                items: [
                    { title: "Copy", keyboardShortcut: "copyNotesToClipboard" },
                    { title: "Paste", shortcut: "Ctrl+V" },
                    { title: "Cut", keyboardShortcut: "cutNotesToClipboard" }
                ]
            });

            const shortcuts = [ ...menuElement()?.querySelectorAll("li.dropdown-item > span") ?? [] ]
                .map(row => row.lastElementChild)
                .map(last => last?.id.endsWith("-title") ? `title ${last.textContent}` : last?.outerHTML);
            expect(shortcuts).toEqual([
                `<span class="keyboard-shortcut"><kbd>Ctrl</kbd>+<kbd>C</kbd>,<kbd>Ctrl</kbd>+<kbd>Insert</kbd></span>`,
                "<kbd>Ctrl+V</kbd>",
                // An action with no shortcut assigned shows none: the row ends with its title.
                "<span>Cut</span>"
            ]);
        });

        it("renders a custom item's component in its place, and hides on a click on what it acts with", async () => {
            buildPage();
            const contextMenu = await buildContextMenu();
            const { h } = await import("preact");
            const { useState } = await import("preact/hooks");
            // A component with state of its own, as the colour pickers are.
            function Swatches() {
                const [ picked ] = useState("red");
                return h("div", { className: "swatches" }, h("button", { type: "button" }, picked));
            }

            await contextMenu.show({
                x: 10, y: 10, selectMenuItemHandler: () => {},
                items: [
                    { title: "Delete" },
                    { kind: "separator" },
                    { kind: "custom", componentFn: Swatches },
                    { kind: "separator" },
                    { title: "Export" }
                ]
            });

            const rows = menuRows().map(row => `${row.tagName.toLowerCase()}.${row.className}`);
            expect(rows).toEqual([
                "li.dropdown-item", "li.dropdown-divider", "li.dropdown-custom-item", "li.dropdown-divider", "li.dropdown-item"
            ]);
            const custom = menuElement()?.querySelector<HTMLElement>(".dropdown-custom-item");
            expect(custom?.innerHTML).toBe(`<div class="swatches"><button type="button">red</button></div>`);

            // A click that misses what the component acts with, such as one in the gaps between
            // the color picker's cells, picks nothing and leaves the menu up.
            const click = (target: Element | null | undefined) =>
                target?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
            click(custom?.querySelector(".swatches"));
            click(custom);
            expect(contextMenu.isShown).toBe(true);

            // One that acts closes the menu of itself, without the page's listener: on mobile only
            // the cover has one.
            custom?.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
            expect(contextMenu.isShown).toBe(false);
        });

        it("marks an item that is not enabled as disabled, and does not run it", async () => {
            buildPage();
            const contextMenu = await buildContextMenu();
            const handler = vi.fn();
            const selectMenuItemHandler = vi.fn();

            await contextMenu.show({
                x: 10, y: 10, selectMenuItemHandler,
                items: [
                    { title: "Delete", enabled: false, handler },
                    { title: "Export", enabled: true },
                    { title: "Import" }
                ]
            });

            const rows = [ ...menuElement()?.querySelectorAll<HTMLElement>("li.dropdown-item") ?? [] ];
            expect(rows.map(row => [ row.classList.contains("disabled"), row.getAttribute("aria-disabled") ]))
                .toEqual([ [ true, "true" ], [ false, null ], [ false, null ] ]);

            // The stylesheets keep the pointer off it; a click that still arrives does nothing.
            rows[0].dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
            rows[0].dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
            expect(handler).not.toHaveBeenCalled();
            expect(selectMenuItemHandler).not.toHaveBeenCalled();
            expect(contextMenu.isShown).toBe(true);
        });

        it("shows a header as text above the items it introduces", async () => {
            buildPage();
            const contextMenu = await buildContextMenu();

            await contextMenu.show({
                x: 10, y: 10, selectMenuItemHandler: () => {},
                items: [
                    // A name the user wrote, such as a board column's status.
                    { kind: "header", title: "<b>Doing</b>" },
                    { title: "Move left" },
                    { kind: "separator" },
                    { kind: "header", title: "Colour" },
                    { title: "Red" }
                ]
            });

            const rows = menuRows().map((row) => {
                // A header is a list item holding the heading, as `FormListHeader` draws one.
                const shown = row.querySelector(":scope > h6.dropdown-header") ?? row;
                const tag = shown === row ? `li.${row.className}` : "h6.dropdown-header";
                return `${tag} ${shown.innerHTML.includes("<b>") ? "(markup)" : shown.textContent}`;
            });
            expect(rows).toEqual([
                "h6.dropdown-header <b>Doing</b>",
                "li.dropdown-item Move left",
                "li.dropdown-divider ",
                "h6.dropdown-header Colour",
                "li.dropdown-item Red"
            ]);
        });

        it("shows badges after the title, and a trailing icon at the end of the row", async () => {
            buildPage();
            const contextMenu = await buildContextMenu();

            await contextMenu.show({
                x: 10, y: 10, selectMenuItemHandler: () => {},
                items: [
                    {
                        title: "Done", uiIcon: "bx bx-columns",
                        badges: [ { title: "<i>archived</i>", className: "archived" }, { title: "new" } ],
                        shortcut: "Ctrl+D",
                        trailingIcon: "bx bx-check"
                    },
                    { title: "Doing", uiIcon: "bx bx-columns", trailingIcon: undefined }
                ]
            });

            const [ done, doing ] = [ ...menuElement()?.querySelectorAll("li.dropdown-item > span") ?? [] ]
                .map(row => [ ...row.children ].map(child => `${child.tagName.toLowerCase()}.${child.className} ${child.textContent}`));
            expect(done).toEqual([
                "span.bx bx-columns tn-icon ",
                "span.tn-menu-gap ",
                "span. Done",
                // A badge's title is text, as a column's status is a name the user wrote.
                "span.badge archived <i>archived</i>",
                "span.badge new",
                "kbd. Ctrl+D",
                // The item's own icon stands, unlike with `checked`.
                "span.bx bx-check tn-icon menu-trailing-icon "
            ]);
            expect(doing).toHaveLength(3);
        });

        it("draws its rows as the list items of <menu> elements, at every level", async () => {
            buildPage();
            const contextMenu = await buildContextMenu();
            await contextMenu.show({
                x: 10, y: 10, selectMenuItemHandler: () => {},
                items: [
                    { kind: "header", title: "Colour" },
                    { kind: "custom", componentFn: () => null },
                    { kind: "separator" },
                    { title: "Insert child note", items: [
                        { title: "Text" }, { kind: "separator" }, { title: "Code" }, { title: "Weekly" }
                    ] }
                ]
            });
            const list = menuElement()?.querySelector(":scope > .tn-menu-scroll");
            expect(list?.tagName).toBe("MENU");
            // Out of the accessibility tree, so the rows are the menu's own.
            expect(list?.getAttribute("role")).toBe("none");
            expect(menuRows().map((row) => `${row.tagName} ${row.getAttribute("role")}`)).toEqual([
                "LI none", "LI none", "LI separator", "LI menuitem"
            ]);

            const parent = menuRows().at(-1);
            parent?.dispatchEvent(new PointerEvent("pointerenter"));
            const submenuList = () => menuElement()?.querySelector("div.dropdown-submenu .tn-menu-scroll");
            await vi.waitFor(() => expect(submenuList()).not.toBeNull());
            expect([ submenuList()?.tagName, submenuList()?.getAttribute("role") ]).toEqual([ "MENU", "none" ]);
            expect(submenuList()?.children).toHaveLength(4);
            for (const element of menuElement()?.querySelectorAll("menu") ?? []) {
                expect([ ...element.children ].every((child) => child.tagName === "LI")).toBe(true);
            }
        });

        it("tells assistive technology which rows are checked and what each submenu belongs to", async () => {
            buildPage();
            const contextMenu = await buildContextMenu();
            await contextMenu.show({
                x: 10, y: 10, selectMenuItemHandler: () => {},
                items: [
                    { title: "Bold", checked: true },
                    { title: "Italic", checked: false },
                    { title: "Templates", items: [ { title: "Meeting" } ] }
                ]
            });
            expect(menuRows().map((row) => [ row.getAttribute("role"), row.getAttribute("aria-checked") ])).toEqual([
                [ "menuitemcheckbox", "true" ], [ "menuitemcheckbox", "false" ], [ "menuitem", null ]
            ]);

            menuRows()[2]?.dispatchEvent(new PointerEvent("pointerenter"));
            await vi.waitFor(() => expect(menuElement()?.querySelector("div.dropdown-submenu > .dropdown-menu")).not.toBeNull());
            const layer = menuElement()?.querySelector("div.dropdown-submenu > .dropdown-menu");
            expect(layer?.getAttribute("role")).toBe("menu");
            const label = document.getElementById(layer?.getAttribute("aria-labelledby") ?? "");
            expect(label?.textContent).toBe("Templates");
        });

        it("stays up while the color picker's custom cell has the browser's picker open", async () => {
            buildPage();
            const contextMenu = await buildContextMenu();
            const { default: ColorPicker } = await import("../widgets/react/ColorPicker");
            // The browser's picker opens outside the page; happy-dom would bubble the click back.
            const openPicker = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
            await contextMenu.show({
                x: 10, y: 10, selectMenuItemHandler: () => {},
                items: [ { kind: "custom", componentFn: () => h(ColorPicker, { currentValue: null, onChange: () => {} }) } ]
            });

            const cell = menuElement()?.querySelector<HTMLElement>(".custom-color-cell");
            if (!cell) throw new Error("expected the custom color cell");
            cell.dispatchEvent(new MouseEvent("click", { bubbles: true }));
            expect(openPicker).toHaveBeenCalled();
            // Hiding would unmount the input, and the color picked in it would go nowhere.
            expect(contextMenu.isShown).toBe(true);
            expect(menuElement()?.querySelector("input[type=color]")).not.toBeNull();
            openPicker.mockRestore();
        });

        it("runs an item pressed with the primary button, then hides", async () => {
            buildPage();
            const contextMenu = await buildContextMenu();
            const calls: string[] = [];
            const item = { title: "Copy", handler: () => { calls.push("handler"); } };

            await contextMenu.show({
                x: 10, y: 10, items: [ item ],
                selectMenuItemHandler: (selected) => { calls.push(`select ${selected.title}`); }
            });
            const row = menuElement()?.querySelector<HTMLElement>("[role=menuitem]");
            if (!row) throw new Error("expected a menu item");

            // Other buttons do nothing.
            row.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 2 }));
            expect(calls).toEqual([]);
            expect(contextMenu.isShown).toBe(true);

            // The press does not move focus, so a text editor keeps its selection for the command,
            // and runs nothing: the row runs on its release, as in a native menu.
            const press = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 });
            row.dispatchEvent(press);
            expect(press.defaultPrevented).toBe(true);
            expect(calls).toEqual([]);
            expect(contextMenu.isShown).toBe(true);

            row.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
            expect(calls).toEqual([ "handler", "select Copy" ]);
            expect(contextMenu.isShown).toBe(false);
        });
    });

    describe("submenus", () => {
        const noteTypes = [ { title: "Text" }, { title: "Code" } ];
        const templates = [ { title: "Meeting", items: [ { title: "Weekly" } ] } ];
        const submenuItems = [
            { title: "Copy" },
            { title: "Insert child note", command: "insertChildNote", items: noteTypes },
            { title: "Templates", items: templates }
        ];

        async function openMenu(onSelect: (title: string) => void = () => {}) {
            buildPage();
            const contextMenu = await buildContextMenu();
            await contextMenu.show({
                x: 10, y: 10, items: submenuItems,
                selectMenuItemHandler: (item) => onSelect(String(item.title))
            });
            return contextMenu;
        }

        /** The row titled `title`, read off its own line: a row's text also holds its submenu's. */
        function row(title: string) {
            const found = [ ...document.querySelectorAll<HTMLElement>("li.dropdown-item") ]
                .find((item) => item.querySelector(":scope > span")?.textContent === title);
            if (!found) throw new Error(`expected a row titled ${title}`);
            return found;
        }

        /** The submenu layers standing open, each as the titles of its rows. */
        function layers() {
            return [ ...menuElement()?.querySelectorAll(":scope > div.dropdown-submenu > .dropdown-menu") ?? [] ]
                .map((layer) => [ ...layer.querySelectorAll(":scope > .tn-menu-scroll > li") ].map((item) => item.textContent));
        }

        const hover = (element: HTMLElement) => element.dispatchEvent(new PointerEvent("pointerenter"));
        /** A press and its release, which runs a row. */
        const press = (element: HTMLElement) => {
            element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
            element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
        };

        afterEach(() => {
            layout.onMobile = false;
            vi.restoreAllMocks();
        });

        it("opens a layer of its own for each level, beside the row it opens from", async () => {
            await openMenu();
            const parent = row("Templates");
            // The arrow the theme draws, and the markup its submenu rules expect.
            expect(parent.classList.contains("dropdown-submenu")).toBe(true);
            expect(parent.querySelector(":scope > span")?.classList.contains("dropdown-toggle")).toBe(true);
            expect(layers()).toEqual([]);

            hover(parent);
            await vi.waitFor(() => expect(layers()).toEqual([ [ "Meeting" ] ]));
            expect(parent.classList.contains("submenu-open")).toBe(true);

            hover(row("Meeting"));
            // Each level stands beside the others, none nested in another's scrolling box.
            await vi.waitFor(() => expect(layers()).toEqual([ [ "Meeting" ], [ "Weekly" ] ]));

            // Pointing at another row of the root closes both.
            hover(row("Copy"));
            await vi.waitFor(() => expect(layers()).toEqual([]));
            expect(parent.classList.contains("submenu-open")).toBe(false);
        });

        it("scrolls the top level's rows inside the menu, and keeps its submenus out of that scroller", async () => {
            await openMenu();
            const menu = menuElement();
            const [ scroller, ...others ] = [ ...menu?.children ?? [] ];
            // The menu itself does not scroll, so the blur on its `::before` stays behind every row.
            expect(scroller?.className).toBe("tn-menu-scroll");
            expect(others).toEqual([]);
            expect(scroller?.querySelector("li.dropdown-item")).not.toBeNull();

            hover(row("Templates"));
            await vi.waitFor(() => expect(layers()).toEqual([ [ "Meeting" ] ]));
            expect(scroller?.querySelector("div.dropdown-submenu")).toBeNull();
            // A layer scrolls its rows the same way, so its own blur stays behind them too.
            const layer = menuElement()?.querySelector("div.dropdown-submenu > .dropdown-menu");
            expect([ ...layer?.children ?? [] ].map((child) => child.className)).toEqual([ "tn-menu-scroll" ]);
        });

        it("places a layer beside its row, flipped where it does not fit, and hides it while its row is scrolled away", async () => {
            vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(1000);
            vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(800);
            // Only the layer: a size unlike its rect would read to Floating UI as a CSS scale.
            const layerSize = { width: 150, height: 100 };
            const isLayer = (element: HTMLElement) => element.matches("div.dropdown-submenu > .dropdown-menu");
            vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
                return isLayer(this) ? layerSize.width : 0;
            });
            vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
                return isLayer(this) ? layerSize.height : 0;
            });
            await openMenu();
            const root = menuElement()?.querySelector<HTMLElement>(":scope > .tn-menu-scroll");
            if (!root) throw new Error("expected the menu to render");
            // happy-dom loads no stylesheet, so the rows are made to scroll as `Menu.css` makes them.
            root.style.overflowY = "auto";
            vi.spyOn(root, "getBoundingClientRect").mockReturnValue(DOMRect.fromRect({ x: 0, y: 0, width: 1000, height: 300 }));
            // Floating UI clips to a scrolling ancestor's client box, which happy-dom leaves at 0.
            vi.spyOn(root, "clientWidth", "get").mockReturnValue(1000);
            vi.spyOn(root, "clientHeight", "get").mockReturnValue(300);
            const parent = row("Templates");
            let rowRect = DOMRect.fromRect({ x: 10, y: 100, width: 200, height: 24 });
            vi.spyOn(parent, "getBoundingClientRect").mockImplementation(() => rowRect);

            hover(parent);
            const layer = () => menuElement()?.querySelector<HTMLElement>("div.dropdown-submenu > .dropdown-menu");
            // Overlapping the row by 2px, its top at the row's.
            await vi.waitFor(() => expect([ layer()?.style.left, layer()?.style.top ]).toEqual([ "208px", "100px" ]));
            expect(layer()?.style.visibility).toBe("visible");

            // Scrolled out of the menu's view, the row takes its submenu out of sight with it.
            rowRect = DOMRect.fromRect({ x: 10, y: 400, width: 200, height: 24 });
            root.dispatchEvent(new Event("scroll"));
            await vi.waitFor(() => expect(layer()?.style.visibility).toBe("hidden"));

            // Near the right edge, it opens to the row's left.
            rowRect = DOMRect.fromRect({ x: 850, y: 100, width: 100, height: 24 });
            root.dispatchEvent(new Event("scroll"));
            await vi.waitFor(() => expect([ layer()?.style.left, layer()?.style.visibility ]).toEqual([ "702px", "visible" ]));

            // Too wide for either side of its row, it is shifted inside the viewport rather than
            // left clipped where it opens.
            layerSize.width = 900;
            rowRect = DOMRect.fromRect({ x: 400, y: 100, width: 200, height: 24 });
            root.dispatchEvent(new Event("scroll"));
            await vi.waitFor(() => {
                const left = parseFloat(layer()?.style.left ?? "");
                expect(left).toBeGreaterThanOrEqual(5);
                expect(left + 900).toBeLessThanOrEqual(995);
            });
        });

        it("waits before the first submenu it opens under the pointer, and not before one that replaces it", async () => {
            /** Whether the open layer skips the stylesheet's opening delay and fade. */
            const immediate = () => menuElement()?.querySelector("div.dropdown-submenu > .dropdown-menu")?.classList.contains("tn-menu-immediate");
            await openMenu();

            // The pointer might only be passing over the row.
            hover(row("Insert child note"));
            await vi.waitFor(() => expect(layers()).toHaveLength(1));
            expect(immediate()).toBe(false);

            // One submenu is open, so the user is going through them: its sibling shows at once.
            hover(row("Templates"));
            await vi.waitFor(() => expect(layers()).toEqual([ [ "Meeting" ] ]));
            expect(immediate()).toBe(true);

            // So does one a press opens, which is a choice rather than a pass.
            await openMenu();
            press(row("Templates"));
            await vi.waitFor(() => expect(layers()).toEqual([ [ "Meeting" ] ]));
            expect(immediate()).toBe(true);
        });

        it("runs a submenu's row and closes everything, and keeps a submenu's row that only opens it", async () => {
            const picked: string[] = [];
            const contextMenu = await openMenu((title) => picked.push(title));

            // Nothing to run, so the menu stays up with its submenu open.
            press(row("Templates"));
            await vi.waitFor(() => expect(layers()).toEqual([ [ "Meeting" ] ]));
            expect(contextMenu.isShown).toBe(true);

            press(row("Meeting"));
            await vi.waitFor(() => expect(layers()).toEqual([ [ "Meeting" ], [ "Weekly" ] ]));
            press(row("Weekly"));
            expect(picked).toEqual([ "Templates", "Meeting", "Weekly" ]);
            expect(contextMenu.isShown).toBe(false);

            // A row with a command of its own is split, unlike a row that only opens its submenu,
            // and runs the command and closes the menu like any other.
            const again = await openMenu((title) => picked.push(title));
            expect(row("Templates").classList.contains("tn-menu-split")).toBe(false);
            expect(row("Insert child note").classList.contains("tn-menu-split")).toBe(true);
            press(row("Insert child note"));
            expect(picked.at(-1)).toBe("Insert child note");
            expect(again.isShown).toBe(false);
        });

        it("opens a submenu on a phone as a page in the menu's place, and goes back from its header", async () => {
            layout.onMobile = true;
            const picked: string[] = [];
            const contextMenu = await openMenu((title) => picked.push(title));
            const parent = row("Templates");
            /** The pages standing open, each as its title followed by the titles of its rows. */
            const pages = () => [ ...menuElement()?.querySelectorAll(":scope > .tn-menu-page") ?? [] ].map((page) => [
                page.querySelector(".tn-master-detail-title")?.textContent,
                ...[ ...page.querySelectorAll(":scope > .tn-menu-scroll > li") ]
                    .map((item) => item.querySelector(":scope > span")?.textContent)
            ]);
            const back = () => {
                const button = [ ...menuElement()?.querySelectorAll<HTMLElement>(".tn-menu-page-header button") ?? [] ].at(-1);
                if (!button) throw new Error("expected a back button");
                press(button);
            };
            /** How each page is moving, as its slide class names it. */
            const slides = () => [ ...menuElement()?.querySelectorAll(":scope > .tn-menu-page") ?? [] ]
                .map((page) => page.classList.contains("tn-menu-page-entering") ? "entering"
                    : page.classList.contains("tn-menu-page-leaving") ? "leaving" : "shown");
            /** Ends every page's slide, as the browser does once the animation has run. */
            const endSlides = () => {
                for (const page of menuElement()?.querySelectorAll(":scope > .tn-menu-page") ?? []) {
                    page.dispatchEvent(Object.assign(new Event("animationend", { bubbles: true }),
                        { animationName: "tn-slide-in-from-right" }));
                }
            };

            hover(parent);
            expect(pages()).toEqual([]);

            press(parent);
            await vi.waitFor(() => expect(pages()).toEqual([ [ "Templates", "Meeting" ] ]));
            expect(slides()).toEqual([ "entering" ]);
            endSlides();
            await vi.waitFor(() => expect(slides()).toEqual([ "shown" ]));
            // Opening runs nothing, and neither unfolds rows in the row nor draws a layer beside it.
            expect(picked).toEqual([]);
            expect(parent.querySelector(".dropdown-menu")).toBeNull();
            expect(layers()).toEqual([]);

            press(row("Meeting"));
            await vi.waitFor(() => expect(pages()).toEqual([ [ "Templates", "Meeting" ], [ "Meeting", "Weekly" ] ]));
            endSlides();

            // Back goes up one level at a time, running nothing and keeping the menu up. The page
            // left is drawn until it has slid out.
            back();
            await vi.waitFor(() => expect(slides()).toEqual([ "shown", "leaving" ]));
            endSlides();
            await vi.waitFor(() => expect(pages()).toEqual([ [ "Templates", "Meeting" ] ]));
            back();
            await vi.waitFor(() => expect(slides()).toEqual([ "leaving" ]));
            endSlides();
            await vi.waitFor(() => expect(pages()).toEqual([]));
            expect(picked).toEqual([]);
            expect(contextMenu.isShown).toBe(true);

            // A row on a page runs and closes the menu, like any other.
            press(row("Templates"));
            press(await vi.waitFor(() => row("Meeting")));
            press(await vi.waitFor(() => row("Weekly")));
            expect(picked).toEqual([ "Weekly" ]);
            expect(contextMenu.isShown).toBe(false);
        });
    });

    it("keeps a right-click or a long press inside it to itself, at every level", async () => {
        buildPage();
        const contextMenu = await buildContextMenu();
        // Such as a host that would open a menu of its own, or Electron's for the editor.
        const heard = vi.fn();
        document.addEventListener("contextmenu", heard);

        await contextMenu.show({
            x: 10, y: 10, selectMenuItemHandler: () => {},
            items: [ { title: "Copy" }, { title: "Templates", items: [ { title: "Meeting" } ] } ]
        });
        const rows = [ ...menuElement()?.querySelectorAll<HTMLElement>("li.dropdown-item") ?? [] ];
        rows[1]?.dispatchEvent(new PointerEvent("pointerenter"));
        await vi.waitFor(() => expect(menuElement()?.querySelector("div.dropdown-submenu li")).not.toBeNull());
        const targets = [ rows[0], menuElement(), menuElement()?.querySelector("div.dropdown-submenu li") ];
        expect(targets.every(Boolean)).toBe(true);

        for (const target of targets) {
            const rightClick = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 });
            target?.dispatchEvent(rightClick);
            // The browser's own menu does not open over it.
            expect(rightClick.defaultPrevented).toBe(true);
        }
        expect(heard).not.toHaveBeenCalled();
        expect(contextMenu.isShown).toBe(true);
        document.removeEventListener("contextmenu", heard);
    });

    describe("keyboard", () => {
        const keyboardItems = [
            { title: "Cut" },
            { kind: "separator" as const },
            { title: "Copy", enabled: false },
            { title: "Paste" },
            { title: "Templates", items: [ { title: "Meeting" }, { title: "Weekly" } ] }
        ];

        async function openMenu(onSelect: (title: string) => void = () => {}) {
            buildPage();
            const editor = document.createElement("textarea");
            document.body.append(editor);
            editor.focus();
            const contextMenu = await buildContextMenu();
            await contextMenu.show({
                x: 10, y: 10, items: keyboardItems,
                selectMenuItemHandler: (item) => onSelect(String(item.title))
            });
            // The menu takes focus once it is placed, before which no key can reach it.
            await vi.waitFor(() => expect(document.activeElement).toBe(menuElement()));
            return { contextMenu, editor };
        }

        function key(name: string) {
            const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true });
            (document.activeElement ?? document.body).dispatchEvent(event);
            return event;
        }

        /** The active row's title, as `aria-activedescendant` names it. */
        function activeRow() {
            const id = menuElement()?.getAttribute("aria-activedescendant");
            const row = id ? document.getElementById(id) : null;
            if (id && !row?.classList.contains("tn-menu-active")) throw new Error("the active row is not marked");
            return row?.querySelector(":scope > span")?.textContent ?? null;
        }

        afterEach(() => {
            focusTraps.suspend.mockClear();
            focusTraps.restore.mockClear();
        });

        it("starts at its first row when a key opened it, as the Menu key or Shift+F10 does", async () => {
            buildPage();
            const contextMenu = await buildContextMenu();
            const show = () => contextMenu.show({ x: 10, y: 10, items: keyboardItems, selectMenuItemHandler: () => {} });

            // The key that opens it comes first, then the `contextmenu` event its caller answers.
            document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "ContextMenu", bubbles: true }));
            await show();
            await vi.waitFor(() => expect(activeRow()).toBe("Cut"));
            // Keyed from the start, so a pointer resting on another row does not mark it too.
            expect(menuElement()?.classList.contains("tn-menu-keyboard")).toBe(true);

            // A menu appearing under a pointer at rest has the browser enter the row there, and
            // Chromium follow with a move that goes nowhere. Neither takes the active row.
            const paste = [ ...menuElement()?.querySelectorAll<HTMLElement>("li.dropdown-item") ?? [] ]
                .find((row) => row.textContent === "Paste");
            paste?.dispatchEvent(new PointerEvent("pointerenter"));
            paste?.dispatchEvent(new PointerEvent("pointermove", { bubbles: true }));
            await new Promise((resolve) => setTimeout(resolve));
            expect(activeRow()).toBe("Cut");
            expect(menuElement()?.classList.contains("tn-menu-keyboard")).toBe(true);
            // A move that goes somewhere hands the menu to the pointer.
            paste?.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, movementX: 3 }));
            await vi.waitFor(() => expect(activeRow()).toBe("Paste"));
            expect(menuElement()?.classList.contains("tn-menu-keyboard")).toBe(false);

            // A press opens it with nothing active, for the pointer to choose.
            document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 2 }));
            await show();
            await vi.waitFor(() => expect(document.activeElement).toBe(menuElement()));
            expect(activeRow()).toBeNull();
        });

        it("takes focus while it is up, gives it back once hidden, and holds off the modals' focus traps meanwhile", async () => {
            // A browser does not focus an element under `visibility: hidden`, which `Menu.css`
            // keeps the menu under until it is placed. happy-dom loads no stylesheet and focuses it
            // regardless, so the spec records what the menu showed when it was asked to take focus.
            const visibilityOnFocus: string[] = [];
            const focus = HTMLElement.prototype.focus;
            vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(function (this: HTMLElement, options) {
                if (this.id === "context-menu-container") visibilityOnFocus.push(this.style.visibility);
                focus.call(this, options);
            });
            const { contextMenu, editor } = await openMenu();

            await vi.waitFor(() => expect(document.activeElement).toBe(menuElement()));
            expect(visibilityOnFocus).toEqual([ "visible" ]);
            expect(focusTraps.suspend).toHaveBeenCalledTimes(1);
            expect(focusTraps.restore).not.toHaveBeenCalled();

            await contextMenu.hide();
            // A spelling fix acts on the editor's selection, so the editor has focus back by then.
            expect(document.activeElement).toBe(editor);
            expect(focusTraps.restore).toHaveBeenCalledTimes(1);
        });

        it("moves between the rows it can run, around from either end", async () => {
            await openMenu();
            expect(activeRow()).toBeNull();

            key("ArrowDown");
            await vi.waitFor(() => expect(activeRow()).toBe("Cut"));
            // Past the separator and the disabled row.
            key("ArrowDown");
            await vi.waitFor(() => expect(activeRow()).toBe("Paste"));
            key("ArrowDown");
            await vi.waitFor(() => expect(activeRow()).toBe("Templates"));
            key("ArrowDown");
            await vi.waitFor(() => expect(activeRow()).toBe("Cut"));
            key("ArrowUp");
            await vi.waitFor(() => expect(activeRow()).toBe("Templates"));
            key("Home");
            await vi.waitFor(() => expect(activeRow()).toBe("Cut"));
            key("End");
            await vi.waitFor(() => expect(activeRow()).toBe("Templates"));
            // Typing a row's first letters goes to it.
            key("p");
            await vi.waitFor(() => expect(activeRow()).toBe("Paste"));
        });

        describe("filtering a filterable submenu", () => {
            const filterableItems = [
                { title: "Cut" },
                {
                    title: "Insert child note", filterable: true, items: [
                        { title: "Text" },
                        { title: "Code", items: [ { title: "Plain text" }, { title: "Python" }, { title: "JavaScript" } ] },
                        { kind: "separator" as const },
                        { title: "Collection", items: [ { title: "Table" }, { title: "Board", badges: [ { title: "New" } ] } ] },
                        { kind: "header" as const, title: "Templates" },
                        { title: "Meeting &amp; <b>notes</b>" }
                    ]
                }
            ];
            const unfiltered = [ "Text|", "Code|", "Collection|", "Meeting & notes|" ];

            async function openFilterable(picked: string[] = []) {
                buildPage();
                const contextMenu = await buildContextMenu();
                await contextMenu.show({
                    x: 10, y: 10, items: filterableItems,
                    selectMenuItemHandler: (item) => picked.push(String(item.title))
                });
                await vi.waitFor(() => expect(document.activeElement).toBe(menuElement()));
                return contextMenu;
            }

            /** Goes down to the filterable row and into its submenu, a key at a time. */
            async function openSubmenuByKeys() {
                key("ArrowDown");
                await vi.waitFor(() => expect(activeRow()).toBe("Cut"));
                key("ArrowDown");
                await vi.waitFor(() => expect(activeRow()).toBe("Insert child note"));
                key("ArrowRight");
                await vi.waitFor(() => expect(activeRow()).toBe("Text"));
            }

            function filterInput() {
                return menuElement()?.querySelector<HTMLInputElement>("div.dropdown-submenu input.tn-menu-filter-input") ?? null;
            }

            /** Sets what the input holds, as typing, deleting or pasting into it does. */
            function edit(value: string) {
                const input = filterInput();
                if (!input) throw new Error("no filter input");
                input.value = value;
                input.dispatchEvent(new Event("input", { bubbles: true }));
            }

            /**
             * Types without waiting, as fast typing does: a key while the menu has focus, the
             * input's own editing once it has.
             */
            function type(text: string) {
                for (const character of text) {
                    const input = filterInput();
                    if (input && document.activeElement === input) edit(input.value + character);
                    else key(character);
                }
            }

            /** The open layer: what the input holds, and each row as its title and the path it came from. */
            function layer() {
                const list = menuElement()?.querySelector("div.dropdown-submenu .tn-menu-scroll");
                const rows = [ ...list?.querySelectorAll<HTMLElement>("li.dropdown-item") ?? [] ];
                return {
                    filter: filterInput()?.value ?? null,
                    rows: rows.map((row) => [
                        row.querySelector(".tn-menu-filter-title")?.textContent ?? row.textContent,
                        row.querySelector(".tn-menu-filter-path")?.textContent ?? ""
                    ].join("|")),
                    empty: !!list?.querySelector(".tn-menu-filter-empty")
                };
            }

            it("offers an input to filter with, which typing from the menu moves into", async () => {
                await openFilterable();
                await openSubmenuByKeys();
                // There before anything is typed, empty, and with the keys still on the rows.
                expect(layer()).toEqual({ filter: "", rows: unfiltered, empty: false });
                expect(document.activeElement).toBe(menuElement());

                type("p");
                await vi.waitFor(() => expect(document.activeElement).toBe(filterInput()));
                expect(filterInput()?.selectionStart).toBe(1);
                expect(layer().filter).toBe("p");
                // Those starting with it first, then those holding it, each group in menu order.
                expect(layer().rows).toEqual([ "Plain text|Code", "Python|Code", "JavaScript|Code" ]);
                expect(activeRow()).toMatch(/^Plain text/);

                type("y");
                await vi.waitFor(() => expect(layer().rows).toEqual([ "Python|Code" ]));
                expect(menuElement()?.querySelector(".tn-menu-filter-title mark")?.textContent).toBe("Py");
                expect(activeRow()).toMatch(/^Python/);

                edit("p");
                await vi.waitFor(() => expect(layer().rows).toHaveLength(3));
                // Emptied, it lists the submenu as it was, and keeps focus for more typing.
                edit("");
                await vi.waitFor(() => expect(layer().rows).toEqual(unfiltered));
                expect(document.activeElement).toBe(filterInput());
                expect(activeRow()).toBe("Text");
            });

            it("leaves editing to the input, and keeps the keys that pick a match", async () => {
                const picked: string[] = [];
                const contextMenu = await openFilterable(picked);
                await openSubmenuByKeys();
                type("p");
                await vi.waitFor(() => expect(document.activeElement).toBe(filterInput()));

                // The caret's keys are the input's: nothing moves in the menu, and the submenu stays.
                // From the start of the text, as Right at its end is the menu's.
                filterInput()?.setSelectionRange(0, 0);
                for (const name of [ "Home", "End", "ArrowLeft", "ArrowRight", "Backspace", " " ]) {
                    expect(key(name).defaultPrevented).toBe(false);
                }
                expect(activeRow()).toMatch(/^Plain text/);
                expect(filterInput()).not.toBeNull();

                // Up and Down go through the matches, with focus kept in the input.
                expect(key("ArrowDown").defaultPrevented).toBe(true);
                await vi.waitFor(() => expect(activeRow()).toMatch(/^Python/));
                expect(document.activeElement).toBe(filterInput());
                key("ArrowUp");
                await vi.waitFor(() => expect(activeRow()).toMatch(/^Plain text/));
                expect(key("Tab").defaultPrevented).toBe(true);

                key("Enter");
                expect(picked).toEqual([ "Plain text" ]);
                expect(contextMenu.isShown).toBe(false);
            });

            it("matches the submenus a row stands in, every word apart, and the text a title shows", async () => {
                await openFilterable();
                await openSubmenuByKeys();

                type("collection");
                await vi.waitFor(() => expect(layer().rows).toEqual([ "Table|Collection", "Board|Collection" ]));
                // A badge stays with its row.
                expect(menuElement()?.querySelector(".tn-menu-scroll .badge")?.textContent).toBe("New");

                edit("code java");
                await vi.waitFor(() => expect(layer().rows).toEqual([ "JavaScript|Code" ]));

                edit("& n");
                // The title is HTML; what is matched and shown is its text, and none of its markup.
                await vi.waitFor(() => expect(layer().rows).toEqual([ "Meeting & notes|" ]));
                expect(menuElement()?.querySelector(".tn-menu-filter-title b")).toBeNull();

                edit("& nzz");
                await vi.waitFor(() => expect(layer().empty).toBe(true));
                expect(layer().rows).toEqual([]);
            });

            it("filters right after the pointer opened the submenu, and runs the match on Enter", async () => {
                const picked: string[] = [];
                const contextMenu = await openFilterable(picked);
                const parent = [ ...menuElement()?.querySelectorAll<HTMLElement>("li.dropdown-submenu") ?? [] ]
                    .find((row) => row.textContent?.includes("Insert child note"));
                parent?.dispatchEvent(new PointerEvent("pointerenter"));
                await vi.waitFor(() => expect(filterInput()).not.toBeNull());

                type("boa");
                await vi.waitFor(() => expect(layer().rows).toEqual([ "Board|Collection" ]));
                expect(activeRow()).toMatch(/^Board/);
                key("Enter");
                expect(picked).toEqual([ "Board" ]);
                expect(contextMenu.isShown).toBe(false);
            });

            it("gives Right and Left to the menu where the caret has nowhere to go", async () => {
                await openFilterable();
                await openSubmenuByKeys();
                key("ArrowDown");
                await vi.waitFor(() => expect(activeRow()).toBe("Code"));
                filterInput()?.focus();

                // Right in an empty input opens the active row's submenu, whose rows take the keys.
                expect(key("ArrowRight").defaultPrevented).toBe(true);
                await vi.waitFor(() => expect(activeRow()).toBe("Plain text"));
                expect(document.activeElement).toBe(menuElement());
                key("ArrowLeft");
                await vi.waitFor(() => expect(activeRow()).toBe("Code"));

                // With text, the caret moves until it reaches the end.
                filterInput()?.focus();
                edit("tex");
                await vi.waitFor(() => expect(layer().rows).toEqual([ "Text|", "Plain text|Code" ]));
                filterInput()?.setSelectionRange(1, 1);
                expect(key("ArrowRight").defaultPrevented).toBe(false);
                expect(key("ArrowLeft").defaultPrevented).toBe(false);
                filterInput()?.setSelectionRange(0, 3);
                expect(key("ArrowRight").defaultPrevented).toBe(false);
                // At the end, Right is the menu's, and a match has no submenu to open.
                filterInput()?.setSelectionRange(3, 3);
                expect(key("ArrowRight").defaultPrevented).toBe(true);
                expect(document.activeElement).toBe(filterInput());

                // Left in an empty input closes the submenu, as it does from its rows.
                edit("");
                await vi.waitFor(() => expect(layer().rows).toEqual(unfiltered));
                expect(key("ArrowLeft").defaultPrevented).toBe(true);
                await vi.waitFor(() => expect(activeRow()).toBe("Insert child note"));
                expect(filterInput()).toBeNull();
                expect(document.activeElement).toBe(menuElement());
            });

            it("keeps its top while filtered, as its height follows the matches", async () => {
                // A submenu taller than the room beside its row, low in the viewport, which moves it
                // up to fit.
                let height = 400;
                vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(1000);
                vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(800);
                vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(200);
                vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(() => height);
                const submenuLayer = () => menuElement()?.querySelector<HTMLElement>("div.dropdown-submenu > .dropdown-menu");
                /** Lets Floating UI place the layer again, as it does when the layer resizes. */
                const relayout = () => new Promise((resolve) => {
                    window.dispatchEvent(new Event("resize"));
                    setTimeout(resolve, 20);
                });
                try {
                    await openFilterable();
                    const parent = [ ...menuElement()?.querySelectorAll<HTMLElement>("li.dropdown-submenu") ?? [] ]
                        .find((row) => row.textContent?.includes("Insert child note"));
                    if (!parent) throw new Error("no submenu row");
                    vi.spyOn(parent, "getBoundingClientRect").mockReturnValue(DOMRect.fromRect({ x: 10, y: 600, width: 200, height: 30 }));
                    await openSubmenuByKeys();
                    await vi.waitFor(() => expect(submenuLayer()?.style.visibility).toBe("visible"));
                    const top = submenuLayer()?.style.top;
                    expect(parseFloat(top ?? "")).toBeLessThan(600);

                    type("p");
                    await vi.waitFor(() => expect(layer().rows).toHaveLength(3));
                    height = 100;
                    await relayout();
                    // Short enough to stand beside its row, it stays where the reader was looking.
                    expect(submenuLayer()?.style.top).toBe(top);
                    expect(submenuLayer()?.style.maxHeight).toBe(`${800 - parseFloat(top ?? "") - 5}px`);

                    // Emptied, it is placed as it opened, which is where it already stands.
                    edit("");
                    height = 400;
                    await relayout();
                    expect(submenuLayer()?.style.top).toBe(top);
                } finally {
                    vi.restoreAllMocks();
                }
            });

            it("scrolls back to the input when the keys come round to the first row", async () => {
                await openFilterable();
                await openSubmenuByKeys();
                const list = menuElement()?.querySelector<HTMLElement>("div.dropdown-submenu .tn-menu-scroll");
                if (!list) throw new Error("no submenu");
                const scrollTo = vi.spyOn(list, "scrollTo");

                key("ArrowDown");
                await vi.waitFor(() => expect(activeRow()).toBe("Code"));
                expect(scrollTo).not.toHaveBeenCalled();
                key("End");
                await vi.waitFor(() => expect(activeRow()).toBe("Meeting & notes"));
                key("ArrowDown");
                await vi.waitFor(() => expect(activeRow()).toBe("Text"));
                // As far up as the list goes, so the input above the first row shows again.
                expect(scrollTo).toHaveBeenLastCalledWith({ top: 0 });

                // From the input, as Up and Down go through the rows from there too.
                filterInput()?.focus();
                key("ArrowUp");
                await vi.waitFor(() => expect(activeRow()).toBe("Meeting & notes"));
                scrollTo.mockClear();
                key("ArrowDown");
                await vi.waitFor(() => expect(activeRow()).toBe("Text"));
                expect(scrollTo).toHaveBeenCalledWith({ top: 0 });
                vi.restoreAllMocks();
            });

            it("takes a press into the input, as a phone needs to bring up its keyboard", async () => {
                await openFilterable();
                const parent = [ ...menuElement()?.querySelectorAll<HTMLElement>("li.dropdown-submenu") ?? [] ]
                    .find((row) => row.textContent?.includes("Insert child note"));
                parent?.dispatchEvent(new PointerEvent("pointerenter"));
                await vi.waitFor(() => expect(filterInput()).not.toBeNull());

                const press = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 });
                filterInput()?.dispatchEvent(press);
                expect(press.defaultPrevented).toBe(false);
                filterInput()?.focus();
                edit("tab");
                await vi.waitFor(() => expect(layer().rows).toEqual([ "Table|Collection" ]));
                expect(activeRow()).toMatch(/^Table/);
            });

            it("lets Escape empty the input before it closes anything, and gives the menu its keys back", async () => {
                const contextMenu = await openFilterable();
                // Not a filterable level: the first letters go to a row, and no input is offered.
                type("c");
                await vi.waitFor(() => expect(activeRow()).toBe("Cut"));
                expect(menuElement()?.querySelector("input.tn-menu-filter-input")).toBeNull();

                key("ArrowDown");
                await vi.waitFor(() => expect(activeRow()).toBe("Insert child note"));
                key("ArrowRight");
                await vi.waitFor(() => expect(activeRow()).toBe("Text"));
                type("ta");
                await vi.waitFor(() => expect(layer().rows).toEqual([ "Table|Collection" ]));

                key("Escape");
                await vi.waitFor(() => expect(layer()).toEqual({ filter: "", rows: unfiltered, empty: false }));
                expect(document.activeElement).toBe(filterInput());
                expect(contextMenu.isShown).toBe(true);

                // Empty, Escape closes the submenu, and the menu has the keys again.
                key("Escape");
                await vi.waitFor(() => expect(activeRow()).toBe("Insert child note"));
                expect(filterInput()).toBeNull();
                expect(document.activeElement).toBe(menuElement());

                // The submenu closing under a filled input, as the pointer moving on does, ends the
                // filter and gives the menu its keys too.
                key("ArrowRight");
                await vi.waitFor(() => expect(activeRow()).toBe("Text"));
                type("ta");
                await vi.waitFor(() => expect(document.activeElement).toBe(filterInput()));
                const cut = [ ...menuElement()?.querySelectorAll<HTMLElement>("li.dropdown-item") ?? [] ]
                    .find((row) => row.textContent === "Cut");
                cut?.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, movementX: 3 }));
                await vi.waitFor(() => expect(filterInput()).toBeNull());
                expect(document.activeElement).toBe(menuElement());
                key("ArrowRight");
                key("ArrowDown");
                await vi.waitFor(() => expect(activeRow()).toBe("Insert child note"));
                key("ArrowRight");
                await vi.waitFor(() => expect(layer().filter).toBe(""));
                expect(layer().rows).toEqual(unfiltered);
            });
        });

        it("opens a submenu towards it and closes it back, one level at a time", async () => {
            const dialogHeard = vi.fn();
            document.addEventListener("keydown", dialogHeard);
            const { contextMenu } = await openMenu();

            // Each key waits for the one before it to render, as a key press arrives in a task of its own.
            key("End");
            await vi.waitFor(() => expect(activeRow()).toBe("Templates"));
            key("ArrowRight");
            await vi.waitFor(() => expect(activeRow()).toBe("Meeting"));
            // A key is a choice, so the submenu shows without the stylesheet's opening delay.
            expect(menuElement()?.querySelector("div.dropdown-submenu > .dropdown-menu")?.classList.contains("tn-menu-immediate")).toBe(true);

            key("ArrowLeft");
            await vi.waitFor(() => expect(activeRow()).toBe("Templates"));
            expect(menuElement()?.querySelector("div.dropdown-submenu")).toBeNull();

            key("ArrowRight");
            await vi.waitFor(() => expect(activeRow()).toBe("Meeting"));
            // Escape closes the submenu, then the menu, and a dialog under it hears neither.
            key("Escape");
            await vi.waitFor(() => expect(activeRow()).toBe("Templates"));
            expect(contextMenu.isShown).toBe(true);
            key("Escape");
            expect(contextMenu.isShown).toBe(false);
            expect(dialogHeard).not.toHaveBeenCalled();
            document.removeEventListener("keydown", dialogHeard);
        });

        it("opens a submenu's page on a phone as Right and Enter open one, and goes back on Escape", async () => {
            layout.onMobile = true;
            // Without slides, a page goes as soon as it closes.
            document.body.classList.add("motion-disabled");
            try {
                await openMenu();
                key("End");
                await vi.waitFor(() => expect(activeRow()).toBe("Templates"));

                key("Enter");
                await vi.waitFor(() => expect(activeRow()).toBe("Meeting"));
                const page = menuElement()?.querySelector(":scope > .tn-menu-page");
                expect(page?.querySelector(".tn-menu-scroll")?.textContent).toBe("MeetingWeekly");
                // A page in the menu's place, not a layer beside it.
                expect(menuElement()?.querySelector("div.dropdown-submenu")).toBeNull();

                key("ArrowDown");
                await vi.waitFor(() => expect(activeRow()).toBe("Weekly"));
                key("Escape");
                await vi.waitFor(() => expect(activeRow()).toBe("Templates"));
                expect(menuElement()?.querySelector(".tn-menu-page")).toBeNull();

                key("ArrowRight");
                await vi.waitFor(() => expect(activeRow()).toBe("Meeting"));
            } finally {
                layout.onMobile = false;
                document.body.classList.remove("motion-disabled");
            }
        });

        it("moves the keys onto the page a tap opened, and back to its row from the header", async () => {
            layout.onMobile = true;
            document.body.classList.add("motion-disabled");
            try {
                const picked: string[] = [];
                await openMenu((title) => picked.push(title));
                const press = (target: Element | null | undefined) => {
                    target?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
                    target?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
                };
                const parent = menuElement()?.querySelector<HTMLElement>("li.dropdown-submenu");
                expect(parent).toBeTruthy();

                press(parent);
                await vi.waitFor(() => expect(menuElement()?.querySelector(".tn-menu-page")).not.toBeNull());
                // No row of the page is active yet, and the first key lands on its first row
                // rather than on the hidden level under it.
                key("ArrowDown");
                await vi.waitFor(() => expect(activeRow()).toBe("Meeting"));

                const back = menuElement()?.querySelector(".tn-menu-page-header button");
                expect(back).toBeTruthy();
                press(back);
                await vi.waitFor(() => expect(menuElement()?.querySelector(".tn-menu-page")).toBeNull());
                expect(activeRow()).toBe("Templates");

                key("ArrowUp");
                await vi.waitFor(() => expect(activeRow()).toBe("Paste"));
                key("Enter");
                expect(picked).toEqual([ "Paste" ]);
            } finally {
                layout.onMobile = false;
                document.body.classList.remove("motion-disabled");
            }
        });

        it("runs the active row on Enter, with focus back where it was", async () => {
            const picked: string[] = [];
            const { contextMenu, editor } = await openMenu((title) => {
                picked.push(title);
                expect(document.activeElement).toBe(editor);
            });

            key("ArrowDown");
            await vi.waitFor(() => expect(activeRow()).toBe("Cut"));
            key("ArrowDown");
            await vi.waitFor(() => expect(activeRow()).toBe("Paste"));
            key("Enter");

            expect(picked).toEqual([ "Paste" ]);
            expect(contextMenu.isShown).toBe(false);
        });

        it("steps into a custom row that has something to focus, and leaves it the keys it answers", async () => {
            buildPage();
            const contextMenu = await buildContextMenu();
            const widgetHeard = vi.fn();
            await contextMenu.show({
                x: 10, y: 10, selectMenuItemHandler: () => {},
                items: [
                    { title: "Cut" },
                    // Nothing to focus, so the keys pass it by.
                    { kind: "custom", componentFn: () => h("span", {}, "A note") },
                    // Such as the color picker, whose way in is its selected cell.
                    { kind: "custom", componentFn: () => h("div", { class: "widget", tabIndex: 0, onKeyDown: (e: KeyboardEvent) => widgetHeard(e.key) }) },
                    { title: "Paste" }
                ]
            });
            await vi.waitFor(() => expect(document.activeElement).toBe(menuElement()));
            const widget = menuElement()?.querySelector(".widget");

            key("ArrowDown");
            await vi.waitFor(() => expect(activeRow()).toBe("Cut"));
            key("ArrowDown");
            await vi.waitFor(() => expect(document.activeElement).toBe(widget));

            // Its own keys reach it; the menu keeps Up, Down, Escape and Tab.
            key("ArrowRight");
            key("Enter");
            expect(widgetHeard.mock.calls.map(([ name ]) => name)).toEqual([ "ArrowRight", "Enter" ]);

            key("ArrowDown");
            await vi.waitFor(() => expect(activeRow()).toBe("Paste"));
            expect(document.activeElement).toBe(menuElement());
            key("ArrowUp");
            await vi.waitFor(() => expect(document.activeElement).toBe(widget));
            expect(widgetHeard).toHaveBeenCalledTimes(2);

            key("Escape");
            expect(contextMenu.isShown).toBe(false);
        });

        it("closes a submenu the pointer opened once the keys move off its row", async () => {
            await openMenu();
            const templates = [ ...menuElement()?.querySelectorAll<HTMLElement>("li.dropdown-item") ?? [] ]
                .find((row) => row.querySelector(":scope > span")?.textContent === "Templates");
            templates?.dispatchEvent(new PointerEvent("pointerenter"));
            await vi.waitFor(() => expect(menuElement()?.querySelector("div.dropdown-submenu")).not.toBeNull());

            key("ArrowUp");
            await vi.waitFor(() => expect(activeRow()).toBe("Paste"));
            // As a native menu: the submenu goes with its row's highlight, until Right opens it again.
            expect(menuElement()?.querySelector("div.dropdown-submenu")).toBeNull();
            expect(templates?.classList.contains("submenu-open")).toBe(false);
        });

        it("goes on from the row the pointer last pointed at", async () => {
            await openMenu();
            const paste = [ ...menuElement()?.querySelectorAll<HTMLElement>("li.dropdown-item") ?? [] ]
                .find((row) => row.textContent === "Paste");
            paste?.dispatchEvent(new PointerEvent("pointerenter"));
            await vi.waitFor(() => expect(activeRow()).toBe("Paste"));

            key("ArrowDown");
            await vi.waitFor(() => expect(activeRow()).toBe("Templates"));
            // The pointer still rests on "Paste", whose `:hover` would mark a second row: while the
            // keys drive the menu, `Menu.css` takes the hover look off every row but the active one.
            expect(menuElement()?.classList.contains("tn-menu-keyboard")).toBe(true);

            // The slightest move makes the row under the pointer the active one again.
            paste?.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, movementY: 1 }));
            await vi.waitFor(() => expect(activeRow()).toBe("Paste"));
            expect(menuElement()?.classList.contains("tn-menu-keyboard")).toBe(false);
        });
    });

    describe("on a phone", () => {
        afterEach(() => {
            layout.onMobile = false;
            layout.narrow = true;
        });

        it("rises from the bottom as a sheet, which the stylesheet places and caps", async () => {
            layout.onMobile = true;
            buildPage();
            const contextMenu = await buildContextMenu();

            await contextMenu.show({ x: 10, y: 20, items, selectMenuItemHandler: () => {} });

            const menu = menuElement();
            expect(menu?.classList.contains("mobile-bottom-menu")).toBe(true);
            await vi.waitFor(() => expect(menu?.style.visibility).toBe("visible"));
            // Nothing inline for the sheet's rules to contend with: its `max-height` is not `!important`.
            expect([ menu?.style.left, menu?.style.top, menu?.style.maxHeight ]).toEqual([ "", "", "" ]);
        });

        it("opens at the press on a tablet's wider mobile layout, capped", async () => {
            layout.onMobile = true;
            layout.narrow = false;
            buildPage();
            const contextMenu = await buildContextMenu();

            await contextMenu.show({ x: 10, y: 20, items, selectMenuItemHandler: () => {} });

            const menu = menuElement();
            expect(menu?.classList.contains("mobile-bottom-menu")).toBe(false);
            await vi.waitFor(() => expect(menu?.style.visibility).toBe("visible"));
            expect([ menu?.style.left, menu?.style.top ]).not.toEqual([ "", "" ]);
            expect(menu?.style.maxHeight).not.toBe("");
        });

        it("closes as a tablet turns past the phone layout's width", async () => {
            layout.onMobile = true;
            buildPage();
            const contextMenu = await buildContextMenu();
            await contextMenu.show({ x: 10, y: 20, items, selectMenuItemHandler: () => {} });
            expect(menuElement()).not.toBeNull();

            layout.narrow = false;
            for (const listener of [ ...layout.onChange ]) listener();
            await vi.waitFor(() => expect(menuElement()).toBeNull());
            expect(contextMenu.isShown).toBe(false);
            expect(layout.onChange.size).toBe(0);
        });

        it("opens at the pointer instead when the caller asks", async () => {
            layout.onMobile = true;
            buildPage();
            const contextMenu = await buildContextMenu();

            await contextMenu.show({ x: 10, y: 20, items, selectMenuItemHandler: () => {}, forcePositionOnMobile: true });

            const menu = menuElement();
            expect(menu?.classList.contains("mobile-bottom-menu")).toBe(false);
            await vi.waitFor(() => expect(menu?.style.visibility).toBe("visible"));
            expect(menu?.style.left).not.toBe("");
        });
    });

    describe("placement", () => {
        /** Opens the menu with the size a browser would lay it out at; happy-dom lays out nothing. */
        async function place(options: { x: number, y: number, width: number, height: number, orientation?: "left" }) {
            buildPage();
            const contextMenu = await buildContextMenu();
            // Floating UI reads the viewport from the root element's client size.
            vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(1000);
            vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(800);
            vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(options.width);
            vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(options.height);

            await contextMenu.show({ ...options, items, selectMenuItemHandler: () => {} });
            const menu = menuElement();
            if (!menu) throw new Error("expected the menu to render");
            await vi.waitFor(() => expect(menu.style.visibility).toBe("visible"));
            return menu;
        }

        afterEach(() => {
            vi.restoreAllMocks();
        });

        it("opens at the pointer, towards the bottom right", async () => {
            const menu = await place({ x: 10, y: 20, width: 200, height: 300 });
            expect([ menu.style.left, menu.style.top ]).toEqual([ "10px", "20px" ]);
        });

        it("opens towards the left when asked to", async () => {
            const menu = await place({ x: 500, y: 20, width: 200, height: 300, orientation: "left" });
            expect([ menu.style.left, menu.style.top ]).toEqual([ "300px", "20px" ]);
        });

        it("flips to the other side of the pointer where it does not fit", async () => {
            const menu = await place({ x: 900, y: 700, width: 200, height: 300 });
            // Its bottom right corner is at the pointer, as a native menu opened in that corner.
            expect([ menu.style.left, menu.style.top ]).toEqual([ "700px", "400px" ]);
        });

        it("shifts inside the viewport where it fits on neither side", async () => {
            // 600px overflows by 155px to the right of the pointer and by 55px to its left.
            const menu = await place({ x: 550, y: 20, width: 600, height: 300 });
            expect([ menu.style.left, menu.style.top ]).toEqual([ "5px", "20px" ]);
        });

        it("caps its height to the viewport so that it scrolls", async () => {
            const menu = await place({ x: 10, y: 20, width: 200, height: 2000 });
            expect(menu.style.maxHeight).toBe("790px");
        });

        it("places itself again when the viewport changes size", async () => {
            const menu = await place({ x: 700, y: 20, width: 200, height: 300 });
            expect([ menu.style.left, menu.style.maxHeight ]).toEqual([ "700px", "790px" ]);

            vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(800);
            vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(600);
            window.dispatchEvent(new Event("resize"));

            // It no longer fits right of the pointer, so it flips to its left, and its cap shrinks.
            await vi.waitFor(() => expect([ menu.style.left, menu.style.maxHeight ]).toEqual([ "500px", "590px" ]));
        });
    });

    describe("dismissal", () => {
        function pressOn(target: Element | null | undefined, init: PointerEventInit = {}) {
            target?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, ...init }));
        }

        it("hides on a press outside it, with any button, even one its target stops", async () => {
            buildPage();
            const app = document.getElementById("app");
            // As the note tree and the calendar stop their own presses and clicks.
            app?.addEventListener("pointerdown", (e) => e.stopPropagation());
            app?.addEventListener("click", (e) => e.stopPropagation());
            const contextMenu = await buildContextMenu();

            await contextMenu.show({ x: 10, y: 10, items, selectMenuItemHandler: () => {} });
            pressOn(app);
            expect(contextMenu.isShown).toBe(false);

            // Ctrl+right-click, which opens a note in a popup instead of a menu, and fires no click.
            await contextMenu.show({ x: 10, y: 10, items, selectMenuItemHandler: () => {} });
            pressOn(app, { button: 2, ctrlKey: true });
            expect(contextMenu.isShown).toBe(false);
        });

        it("stays up on a press or a click inside it that runs nothing", async () => {
            buildPage();
            const contextMenu = await buildContextMenu();

            await contextMenu.show({
                x: 10, y: 10, selectMenuItemHandler: () => {},
                items: [ { kind: "header", title: "Colour" }, { title: "Red" } ]
            });
            const header = menuElement()?.querySelector(".dropdown-header");
            if (!header) throw new Error("expected a header");
            pressOn(header);
            header.dispatchEvent(new MouseEvent("click", { bubbles: true }));

            expect(contextMenu.isShown).toBe(true);
        });

        it("hides on Escape, which goes no further", async () => {
            buildPage();
            const contextMenu = await buildContextMenu();
            // A dialog under the menu, which Escape would otherwise close too.
            const dialogHeard = vi.fn();
            document.addEventListener("keydown", dialogHeard);

            await contextMenu.show({ x: 10, y: 10, items, selectMenuItemHandler: () => {} });
            document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
            expect(contextMenu.isShown).toBe(false);
            expect(dialogHeard).not.toHaveBeenCalled();

            // With no menu up, Escape is left to whatever else listens.
            document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
            expect(dialogHeard).toHaveBeenCalledTimes(1);
            document.removeEventListener("keydown", dialogHeard);
        });

        it("says whether the press behind a click put a menu away, for a host that acts on neither", async () => {
            buildPage();
            const app = document.getElementById("app");
            const contextMenu = await buildContextMenu();
            const click = () => app?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

            await contextMenu.show({ x: 10, y: 10, items, selectMenuItemHandler: () => {} });
            pressOn(app);
            expect(contextMenu.dismissedByLastPress).toBe(true);

            // Only until the click that press makes has been handled.
            click();
            await vi.waitFor(() => expect(contextMenu.dismissedByLastPress).toBe(false));

            // A press with no menu up put nothing away.
            pressOn(app);
            expect(contextMenu.dismissedByLastPress).toBe(false);
        });
    });

    it("opens inside whatever has the screen, and in the body once nothing does", async () => {
        buildPage();
        const contextMenu = await buildContextMenu();
        const map = document.getElementById("app");
        const show = () => contextMenu.show({ x: 10, y: 10, items, selectMenuItemHandler: () => {} });

        setFullscreenElement(map);
        await show();
        // A browser paints only the fullscreen element, so a menu outside it never shows.
        expect(menuElement()?.parentElement?.parentElement).toBe(map);

        setFullscreenElement(null);
        await show();
        expect(menuElement()?.parentElement?.parentElement).toBe(document.body);
        // The host the fullscreen menu was mounted into went with it.
        expect(map?.childElementCount).toBe(0);
    });

    it("hides a Bootstrap tooltip that is up when the menu opens", async () => {
        buildPage();
        const contextMenu = await buildContextMenu();
        // Imported after `vi.resetModules()` so that the spec and `context_menu` share one
        // Bootstrap instance registry.
        const { Tooltip } = await import("bootstrap");

        const button = document.createElement("button");
        document.body.append(button);
        const tooltip = new Tooltip(button, {
            title: "Calendar",
            animation: false,
            trigger: "hover focus"
        });
        // A field that points `aria-describedby` at its help text has no Bootstrap tooltip.
        const field = document.createElement("input");
        field.setAttribute("aria-describedby", "field-help");
        document.body.append(field);
        const showMenu = () =>
            contextMenu.show({ x: 10, y: 10, items, selectMenuItemHandler: () => {} });

        tooltip.show();
        expect(document.querySelector(".tooltip")).not.toBeNull();
        expect(button.hasAttribute("aria-describedby")).toBe(true);

        await showMenu();
        expect(document.querySelector(".tooltip")).toBeNull();
        expect(button.hasAttribute("aria-describedby")).toBe(false);
        expect(field.getAttribute("aria-describedby")).toBe("field-help");

        // A right-click also focuses the trigger, which keeps the focus trigger active. Bootstrap
        // shows the tooltip from a timer, so the spec waits for it.
        button.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
        await vi.waitFor(() => expect(document.querySelector(".tooltip")).not.toBeNull());

        await showMenu();
        expect(document.querySelector(".tooltip")).toBeNull();
        expect(button.hasAttribute("aria-describedby")).toBe(false);

        tooltip.dispose();
        button.remove();
        field.remove();
    });

    it("says whether it is up, for a host whose own press would otherwise not know", async () => {
        buildPage();
        const contextMenu = await buildContextMenu();

        expect(contextMenu.isShown).toBe(false);

        await contextMenu.show({ x: 10, y: 10, items, selectMenuItemHandler: () => {} });
        expect(contextMenu.isShown).toBe(true);

        await contextMenu.hide();
        expect(contextMenu.isShown).toBe(false);
    });
});
