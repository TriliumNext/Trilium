import { type ComponentChildren, render } from "preact";
import { useRef } from "preact/hooks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Dropdown, { type DropdownHandle, DropdownPanel, type DropdownPanelProps } from "./Dropdown";
import { FormDropdownSubmenu, FormListItem } from "./FormList";
import { MenuItemRows } from "./Menu";

// A dialog's focus trap would pull focus out of a menu portaled over it.
const focusTraps = vi.hoisted(() => ({ suspend: vi.fn(() => () => {}) }));
vi.mock("./modal_focustrap", () => ({ suspendModalFocusTraps: focusTraps.suspend }));

const layout = vi.hoisted(() => ({
    onMobile: false,
    narrow: true,
    onChange: new Set<() => void>()
}));
vi.mock("../../services/utils", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../services/utils")>()),
    isMobile: () => layout.onMobile
}));

describe("Dropdown", () => {
    const host = document.createElement("div");
    document.body.append(host);

    beforeEach(() => {
        vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(1000);
        vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(800);
        vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(200);
        vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(100);
        // A phone's width unless a spec says otherwise; happy-dom's window is 1024px wide.
        vi.spyOn(window, "matchMedia").mockImplementation((media) => ({
            matches: layout.narrow,
            media,
            addEventListener: (_: string, listener: () => void) => layout.onChange.add(listener),
            removeEventListener: (_: string, listener: () => void) => {
                layout.onChange.delete(listener);
            }
        }) as unknown as MediaQueryList);
    });

    afterEach(() => {
        render(null, host);
        vi.restoreAllMocks();
        layout.onMobile = false;
        layout.narrow = true;
        layout.onChange.clear();
        document.body.classList.remove("motion-disabled");
    });

    /** Renders a `Dropdown`, or a `DropdownPanel` for `panel`. */
    function renderDropdown({ panel, ...props }: Partial<DropdownPanelProps> & { panel?: boolean } = {}, content: ComponentChildren = <li className="dropdown-item">By title</li>) {
        let handle: { current: DropdownHandle | null } = { current: null };
        const Component = panel ? DropdownPanel : Dropdown;
        function Harness() {
            const dropdownRef = useRef<DropdownHandle | null>(null);
            handle = dropdownRef;
            return (
                <Component text="Sort" dropdownRef={dropdownRef} dropdownContainerClassName="sort-menu" {...props}>
                    {content}
                </Component>
            );
        }
        render(<Harness />, host);
        const toggle = host.querySelector<HTMLButtonElement>("button");
        if (!toggle) throw new Error("expected the toggle to render");
        vi.spyOn(toggle, "getBoundingClientRect").mockReturnValue(DOMRect.fromRect({ x: 100, y: 50, width: 80, height: 30 }));
        return { toggle, handle: () => handle.current };
    }

    const popup = () => document.querySelector<HTMLElement>(".tn-popup");
    const click = (element: HTMLElement) => {
        // A press comes before its click, and would reach the popup's dismissal first.
        element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
        element.click();
    };

    it("draws its rows from data, filters them from an input at its top, and runs the one chosen", async () => {
        const picked: string[] = [];
        const row = (title: string) => ({ title, handler: () => picked.push(title) });
        const { toggle } = renderDropdown({
            filterable: true,
            items: [ row("Python"), row("JavaScript"), row("Plain text"), { kind: "separator" }, { ...row("Configure"), uiIcon: "bx bx-cog" } ]
        }, null);
        const key = (name: string) => {
            const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true });
            (document.activeElement ?? document.body).dispatchEvent(event);
        };
        const input = () => popup()?.querySelector<HTMLInputElement>("input.tn-menu-filter-input") ?? null;
        const titles = () => [ ...popup()?.querySelectorAll("li.dropdown-item") ?? [] ]
            .map((item) => item.querySelector(".tn-menu-filter-title")?.textContent ?? item.textContent);

        click(toggle);
        await vi.waitFor(() => expect(document.activeElement).toBe(popup()));
        expect(input()?.value).toBe("");
        expect(titles()).toEqual([ "Python", "JavaScript", "Plain text", "Configure" ]);

        // Typing in the menu goes on in the input, and Enter runs the first match.
        key("j");
        await vi.waitFor(() => expect(document.activeElement).toBe(input()));
        expect(titles()).toEqual([ "JavaScript" ]);
        key("Enter");
        expect(picked).toEqual([ "JavaScript" ]);
        await vi.waitFor(() => expect(popup()).toBeNull());

        // Escape empties the input, then, with nothing to go back to, closes the menu.
        click(toggle);
        await vi.waitFor(() => expect(document.activeElement).toBe(popup()));
        key("x");
        await vi.waitFor(() => expect(input()?.value).toBe("x"));
        key("Escape");
        await vi.waitFor(() => expect(input()?.value).toBe(""));
        expect(popup()).not.toBeNull();
        key("Escape");
        await vi.waitFor(() => expect(popup()).toBeNull());
        expect(picked).toEqual([ "JavaScript" ]);
    });

    it("filters the rows a filterable submenu of components draws from data, on a desktop and on a phone", async () => {
        for (const onMobile of [ false, true ]) {
            layout.onMobile = onMobile;
            const picked: string[] = [];
            const row = (title: string) => ({ title, handler: () => picked.push(title) });
            const { toggle } = renderDropdown({}, (
                <FormDropdownSubmenu title="Language" filterable>
                    <MenuItemRows items={[ row("Python"), row("JavaScript") ]} />
                </FormDropdownSubmenu>
            ));
            const key = (name: string) => {
                const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true });
                (document.activeElement ?? document.body).dispatchEvent(event);
            };
            const input = () => popup()?.querySelector<HTMLInputElement>("input.tn-menu-filter-input") ?? null;
            const titles = () => [ ...popup()?.querySelectorAll("li.dropdown-item:not(.dropdown-submenu)") ?? [] ]
                .map((item) => item.querySelector(".tn-menu-filter-title")?.textContent ?? item.textContent);

            click(toggle);
            await vi.waitFor(() => expect(document.activeElement).toBe(popup()));
            key("ArrowDown");
            // Each key waits for the one before it to render, as a key press arrives in a task of its own.
            await vi.waitFor(() => expect(popup()?.getAttribute("aria-activedescendant")).toBeTruthy());
            key(onMobile ? "Enter" : "ArrowRight");
            await vi.waitFor(() => expect(input()).not.toBeNull());
            expect(titles()).toEqual([ "Python", "JavaScript" ]);

            key("j");
            await vi.waitFor(() => expect(document.activeElement).toBe(input()));
            expect(titles()).toEqual([ "JavaScript" ]);
            key("Enter");
            expect(picked).toEqual([ "JavaScript" ]);
            await vi.waitFor(() => expect(popup()).toBeNull());
            render(null, host);
        }
    });

    it("opens a popup below its toggle on a click, and closes it on another", async () => {
        const onShown = vi.fn();
        const onHidden = vi.fn();
        const { toggle } = renderDropdown({ onShown, onHidden, className: "sort-dropdown" });
        expect(popup()).toBeNull();
        expect(toggle.getAttribute("aria-expanded")).toBe("false");

        click(toggle);
        await vi.waitFor(() => expect(popup()?.style.visibility).toBe("visible"));
        const opened = popup();
        // A menu, which lays its rows out in a scroller of its own.
        expect([ ...opened?.classList ?? [] ]).toEqual([ "tn-popup", "dropdown-menu", "show", "tn-menu", "tn-dropdown-menu", "sort-menu" ]);
        expect(opened?.getAttribute("role")).toBe("menu");
        expect(opened?.querySelector(":scope > .tn-menu-scroll")?.textContent).toBe("By title");
        // In the page's body, in a wrapper with the dropdown's class, so CSS scoped under it applies.
        expect(opened?.parentElement?.className).toBe("tn-dropdown-portal sort-dropdown");
        expect(opened?.getAttribute("aria-labelledby")).toBe(toggle.id);
        // 2px below the toggle, as Bootstrap's dropdowns stood.
        expect([ opened?.style.left, opened?.style.top ]).toEqual([ "100px", "82px" ]);
        expect(toggle.getAttribute("aria-expanded")).toBe("true");
        expect(toggle.classList.contains("show")).toBe(true);
        expect(onShown).toHaveBeenCalledTimes(1);

        // The toggle's own press is not a press outside, so its click closes rather than reopens.
        click(toggle);
        await vi.waitFor(() => expect(popup()).toBeNull());
        expect(toggle.getAttribute("aria-expanded")).toBe("false");
        expect(onHidden).toHaveBeenCalledTimes(1);
    });

    it("closes on a press outside, and on Escape, which hands focus back to the toggle", async () => {
        const { toggle } = renderDropdown();

        click(toggle);
        await vi.waitFor(() => expect(popup()).not.toBeNull());
        document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
        await vi.waitFor(() => expect(popup()).toBeNull());

        // The menu takes focus as it shows, and gives it back to the toggle as Escape closes it.
        click(toggle);
        await vi.waitFor(() => expect(document.activeElement).toBe(popup()));
        popup()?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        await vi.waitFor(() => expect(popup()).toBeNull());
        expect(document.activeElement).toBe(toggle);
    });

    it("opens, closes and toggles through its handle, for a caller that decides when", async () => {
        const { handle } = renderDropdown();
        await vi.waitFor(() => expect(handle()).not.toBeNull());

        handle()?.show();
        await vi.waitFor(() => expect(popup()).not.toBeNull());
        handle()?.hide();
        await vi.waitFor(() => expect(popup()).toBeNull());
        handle()?.toggle();
        await vi.waitFor(() => expect(popup()).not.toBeNull());
        handle()?.toggle();
        await vi.waitFor(() => expect(popup()).toBeNull());
    });

    it("closes an open popup once it is disabled, and does not open while it is", async () => {
        const { toggle } = renderDropdown();
        click(toggle);
        await vi.waitFor(() => expect(popup()).not.toBeNull());

        renderDropdown({ disabled: true });
        await vi.waitFor(() => expect(popup()).toBeNull());
        const disabledToggle = host.querySelector<HTMLButtonElement>("button");
        expect(disabledToggle?.disabled).toBe(true);
    });

    describe("content", () => {
        const items = <>
            <li className="dropdown-item" tabIndex={0}>By title</li>
            <li className="dropdown-item disabled" tabIndex={0}>By size</li>
            {/* As `FormListToggleableItem`, which stops its click so the menu stays up. */}
            <li className="dropdown-item" tabIndex={0} onClick={(e) => e.stopPropagation()}>Descending</li>
            <li><input className="filter" /></li>
            <li className="dropdown-item" tabIndex={0}>By date</li>
        </>;
        const item = (title: string) => {
            const found = [ ...popup()?.querySelectorAll<HTMLElement>("li") ?? [] ].find((li) => li.textContent === title);
            if (!found) throw new Error(`expected an item titled ${title}`);
            return found;
        };

        it("closes on a click on an item, but not on one the item stops, in a field, or on the menu itself", async () => {
            const { toggle } = renderDropdown({}, items);
            click(toggle);
            await vi.waitFor(() => expect(popup()).not.toBeNull());

            item("Descending").click();
            popup()?.querySelector<HTMLElement>("input")?.click();
            popup()?.click();
            expect(popup()).not.toBeNull();

            item("By title").click();
            await vi.waitFor(() => expect(popup()).toBeNull());
        });

        it("stays up for a click inside when it closes only on one outside", async () => {
            const { toggle } = renderDropdown({ autoClose: "outside" }, items);
            click(toggle);
            await vi.waitFor(() => expect(popup()).not.toBeNull());

            item("By title").click();
            expect(popup()).not.toBeNull();
            document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
            await vi.waitFor(() => expect(popup()).toBeNull());
        });

        it("closes only on a click inside, or on neither, when asked to", async () => {
            const outside = () => document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
            // A close is rendered after the fact, so a popup still there is checked a turn later.
            const settle = () => new Promise((resolve) => setTimeout(resolve));
            const { toggle } = renderDropdown({ autoClose: "inside" }, items);
            click(toggle);
            await vi.waitFor(() => expect(popup()).not.toBeNull());
            outside();
            await settle();
            expect(popup()).not.toBeNull();
            item("By title").click();
            await vi.waitFor(() => expect(popup()).toBeNull());
            render(null, host);

            const { toggle: manual } = renderDropdown({ autoClose: false }, items);
            click(manual);
            await vi.waitFor(() => expect(popup()).not.toBeNull());
            outside();
            item("By title").click();
            await settle();
            expect(popup()).not.toBeNull();
            // Escape and the toggle still close it.
            popup()?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
            await vi.waitFor(() => expect(popup()).toBeNull());
        });

        it("opens at its last item on Up from the toggle, and moves in from the toggle while open", async () => {
            const { toggle } = renderDropdown({ panel: true }, items);
            const key = (name: string) =>
                toggle.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));

            // Other keys are the toggle's own.
            expect(key("a")).toBe(true);
            expect(popup()).toBeNull();

            toggle.focus();
            key("ArrowUp");
            await vi.waitFor(() => expect(document.activeElement?.textContent).toBe("By date"));

            toggle.focus();
            key("ArrowDown");
            expect(document.activeElement?.textContent).toBe("By title");
        });

        it("opens above its toggle when asked to", async () => {
            const { toggle } = renderDropdown({ placement: "top" });
            vi.spyOn(toggle, "getBoundingClientRect").mockReturnValue(DOMRect.fromRect({ x: 100, y: 500, width: 80, height: 30 }));
            click(toggle);
            // Centered over the toggle, and ending 2px above it: 500 - 100 - 2.
            await vi.waitFor(() => expect([ popup()?.style.left, popup()?.style.top ]).toEqual([ "40px", "398px" ]));
        });

        it("moves focus over the items with Up and Down, keeping them from Bootstrap, and opens from the toggle", async () => {
            const bootstrapHeard = vi.fn();
            document.addEventListener("keydown", bootstrapHeard, true);
            // A panel, whose items are no rows of a menu, moves focus over them as Bootstrap's did.
            const { toggle } = renderDropdown({ panel: true }, items);
            const key = (target: Element, name: string) =>
                target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));

            toggle.focus();
            key(toggle, "ArrowDown");
            await vi.waitFor(() => expect(document.activeElement?.textContent).toBe("By title"));
            // A plain popup, which assistive technology is not told is a menu.
            expect(toggle.getAttribute("aria-haspopup")).toBe("true");
            expect(popup()?.getAttribute("role")).toBeNull();
            // Its frame does not scroll, so the theme's blur stays on its `::before`.
            expect(popup()?.classList.contains("tn-dropdown-list")).toBe(false);
            // Bootstrap reacts on a toggle only with `data-bs-toggle`, which this one does not carry.
            bootstrapHeard.mockClear();

            // Past the disabled item, round from the last to the first, and back.
            key(item("By title"), "ArrowDown");
            expect(document.activeElement?.textContent).toBe("Descending");
            key(item("Descending"), "ArrowDown");
            expect(document.activeElement?.textContent).toBe("By date");
            key(item("By date"), "ArrowDown");
            expect(document.activeElement?.textContent).toBe("By title");
            key(item("By title"), "ArrowUp");
            expect(document.activeElement?.textContent).toBe("By date");
            expect(bootstrapHeard).not.toHaveBeenCalled();

            // A field keeps its own arrows.
            const field = popup()?.querySelector("input");
            if (!field) throw new Error("expected the field");
            key(field, "ArrowDown");
            expect(bootstrapHeard).toHaveBeenCalledTimes(1);
            document.removeEventListener("keydown", bootstrapHeard, true);
        });

        it("scrolls a scrollable panel's content inside it, in the room the viewport leaves", async () => {
            // Content taller than the room: 100px each, in a viewport of 800.
            const { toggle } = renderDropdown({ panel: true, scrollable: true });
            click(toggle);
            await vi.waitFor(() => expect(popup()?.style.visibility).toBe("visible"));
            expect(popup()?.querySelector(":scope > .tn-panel-scroll")?.textContent).toBe("By title");
            expect(popup()?.style.maxHeight).not.toBe("");
            render(null, host);

            // Otherwise the content stands in the panel, which grows with it.
            const { toggle: plain } = renderDropdown({ panel: true });
            click(plain);
            await vi.waitFor(() => expect(popup()?.style.visibility).toBe("visible"));
            expect(popup()?.querySelector(".tn-panel-scroll")).toBeNull();
            expect(popup()?.style.maxHeight).toBe("");
        });

        it("suspends the focus traps of the dialogs under it while it is up, and restores them after", async () => {
            const restore = vi.fn();
            focusTraps.suspend.mockReturnValue(restore);
            const { toggle } = renderDropdown();

            click(toggle);
            await vi.waitFor(() => expect(popup()).not.toBeNull());
            expect(focusTraps.suspend).toHaveBeenCalledTimes(1);
            expect(restore).not.toHaveBeenCalled();

            click(toggle);
            await vi.waitFor(() => expect(popup()).toBeNull());
            expect(restore).toHaveBeenCalledTimes(1);
        });
    });

    describe("as a menu", () => {
        it("caps its height to the room below its toggle, its rows scrolling inside, as the context menu does", async () => {
            vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(1000);
            const { toggle } = renderDropdown();

            click(toggle);
            await vi.waitFor(() => expect(popup()?.style.visibility).toBe("visible"));
            // Below the toggle's bottom (80) and its 2px gap, less the 5px kept from the viewport's edge.
            expect(popup()?.style.maxHeight).toBe(`${800 - 82 - 5}px`);
            expect(popup()?.querySelector(":scope > .tn-menu-scroll")).not.toBeNull();
        });

        it("closes on a row's click, but not on one the row stopped, as a toggle does to stay up", async () => {
            const picked: string[] = [];
            const { toggle } = renderDropdown({}, <>
                <FormListItem onClick={(e) => { picked.push("wrap"); e.stopPropagation(); }}>Wrap lines</FormListItem>
                <FormListItem onClick={() => picked.push("title")}>By title</FormListItem>
            </>);
            const row = (title: string) => [ ...document.querySelectorAll<HTMLElement>(".tn-popup li.dropdown-item") ]
                .find((item) => item.textContent === title);

            click(toggle);
            await vi.waitFor(() => expect(row("Wrap lines")).toBeTruthy());
            row("Wrap lines")?.click();
            expect(popup()).not.toBeNull();

            row("By title")?.click();
            await vi.waitFor(() => expect(popup()).toBeNull());
            expect(picked).toEqual([ "wrap", "title" ]);
        });

        it("stays open on a click on a submenu's row, or on the header of the page it opens on a phone", async () => {
            const toggled = vi.fn();
            const content = (
                <FormDropdownSubmenu icon="bx bx-chip" title="Advanced" onDropdownToggleClicked={toggled}>
                    <FormListItem>Show log</FormListItem>
                </FormDropdownSubmenu>
            );
            const submenuRow = () => popup()?.querySelector<HTMLElement>("li.dropdown-submenu");

            const { toggle } = renderDropdown({}, content);
            click(toggle);
            await vi.waitFor(() => expect(submenuRow()).toBeTruthy());
            submenuRow()?.click();
            expect(toggled).toHaveBeenCalledOnce();
            await new Promise((resolve) => setTimeout(resolve, 20));
            expect(popup()).not.toBeNull();

            render(null, host);
            layout.onMobile = true;
            // Without slides, a page goes as soon as it closes.
            document.body.classList.add("motion-disabled");
            const { toggle: phoneToggle } = renderDropdown({}, content);
            click(phoneToggle);
            await vi.waitFor(() => expect(submenuRow()).toBeTruthy());
            submenuRow()?.click();
            const page = () => popup()?.querySelector<HTMLElement>(":scope > .tn-menu-page");
            await vi.waitFor(() => expect(page()?.querySelector(".tn-menu-scroll")?.textContent).toBe("Show log"));
            await new Promise((resolve) => setTimeout(resolve, 20));
            expect(popup()).not.toBeNull();

            // Neither does its header, the way back included.
            page()?.querySelector<HTMLElement>(".tn-master-detail-title")?.click();
            page()?.querySelector<HTMLElement>(".tn-menu-page-header button")?.click();
            await vi.waitFor(() => expect(page()).toBeNull());
            await new Promise((resolve) => setTimeout(resolve, 20));
            expect(popup()).not.toBeNull();

            // A row on the page still closes the menu.
            submenuRow()?.click();
            await vi.waitFor(() => expect(page()).not.toBeNull());
            page()?.querySelector<HTMLElement>("li.dropdown-item")?.click();
            await vi.waitFor(() => expect(popup()).toBeNull());
        });

        it("opens a nested submenu as a layer of its own, beside the scroller rather than in it", async () => {
            const { toggle } = renderDropdown({}, (
                <FormDropdownSubmenu icon="bx bx-chip" title="Advanced">
                    <FormListItem>Show log</FormListItem>
                </FormDropdownSubmenu>
            ));

            click(toggle);
            await vi.waitFor(() => expect(popup()?.querySelector("li.dropdown-submenu")).not.toBeNull());
            popup()?.querySelector("li.dropdown-submenu")?.dispatchEvent(new PointerEvent("pointerenter"));
            await vi.waitFor(() => expect(popup()?.querySelector(":scope > div.dropdown-submenu > .dropdown-menu")?.textContent)
                .toBe("Show log"));
        });
    });

    describe("as a sheet or over a backdrop", () => {
        /** The dimmed cover the shell keeps for menus on a phone. */
        function addCover() {
            const cover = document.createElement("div");
            cover.id = "context-menu-cover";
            document.body.append(cover);
            return cover;
        }

        it("rises from the bottom of a phone's screen, where the stylesheet places it, over the cover", async () => {
            layout.onMobile = true;
            const cover = addCover();
            const { toggle } = renderDropdown({ mobileBottomSheet: true });

            click(toggle);
            await vi.waitFor(() => expect(popup()?.style.visibility).toBe("visible"));
            expect(popup()?.classList.contains("mobile-bottom-menu")).toBe(true);
            // Nothing placed it beside the toggle; the `.mobile-bottom-menu` rules do.
            expect([ popup()?.style.left, popup()?.style.top ]).toEqual([ "", "" ]);
            expect([ ...cover.classList ]).toEqual([ "show", "global-menu-cover" ]);

            // A tap on the cover is one outside the menu.
            cover.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
            await vi.waitFor(() => expect(popup()).toBeNull());
            expect(cover.classList.contains("show")).toBe(false);
            cover.remove();
        });

        it("opens beside its toggle, capped, on a tablet's wider mobile layout", async () => {
            layout.onMobile = true;
            layout.narrow = false;
            const cover = addCover();
            const { toggle } = renderDropdown({ mobileBottomSheet: true });

            click(toggle);
            await vi.waitFor(() => expect(popup()?.style.visibility).toBe("visible"));
            expect(popup()?.classList.contains("mobile-bottom-menu")).toBe(false);
            expect(popup()?.style.top).toBe("82px");
            expect(popup()?.style.maxHeight).not.toBe("");
            expect([ ...cover.classList ]).toEqual([ "show", "global-menu-cover" ]);
            cover.remove();
        });

        it("turns into a placed menu and back as a tablet turns while it is open", async () => {
            layout.onMobile = true;
            const turn = (narrow: boolean) => {
                layout.narrow = narrow;
                for (const listener of layout.onChange) listener();
            };
            const { toggle } = renderDropdown({ mobileBottomSheet: true });
            click(toggle);
            await vi.waitFor(() => expect(popup()?.classList).toContain("mobile-bottom-menu"));

            turn(false);
            await vi.waitFor(() => expect(popup()?.style.top).toBe("82px"));
            expect(popup()?.classList.contains("mobile-bottom-menu")).toBe(false);
            expect(popup()?.style.maxHeight).not.toBe("");

            // Back to the sheet, with nothing inline left for its rules to contend with.
            turn(true);
            await vi.waitFor(() => expect(popup()?.classList).toContain("mobile-bottom-menu"));
            const { left, top, maxHeight } = popup()?.style ?? {};
            expect([ left, top, maxHeight ]).toEqual([ "", "", "" ]);
        });

        it("is an ordinary menu beside its toggle on a desktop, with no cover", async () => {
            const cover = addCover();
            const { toggle } = renderDropdown({ mobileBottomSheet: true, mobileBackdrop: true });

            click(toggle);
            await vi.waitFor(() => expect(popup()?.style.visibility).toBe("visible"));
            expect(popup()?.classList.contains("mobile-bottom-menu")).toBe(false);
            expect(popup()?.style.top).toBe("82px");
            expect(cover.classList.contains("show")).toBe(false);
            cover.remove();
        });

        it("dims the page under it when asked to, drawn just before it", async () => {
            const { toggle } = renderDropdown({ backdrop: true, className: "icon-picker-dropdown" });

            click(toggle);
            await vi.waitFor(() => expect(popup()).not.toBeNull());
            const drawn = [ ...popup()?.parentElement?.children ?? [] ].map((child) => child.classList[0]);
            expect(drawn).toEqual([ "tn-dropdown-backdrop", "tn-popup" ]);
        });
    });
});
