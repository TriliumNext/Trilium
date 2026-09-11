/**
 * The menu over an element that has the screen to itself.
 *
 * A browser showing an element fullscreen draws that element and nothing else, and this menu lives at
 * the end of the page: over a map given the screen (see the geo map's and the mind map's toolbars) a
 * right-click laid the menu out, positioned it, and painted none of it — nothing appeared to happen
 * at all. It goes wherever the screen is instead.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/note_tooltip", () => ({ default: { dismissAllTooltips: vi.fn() } }));
vi.mock("../services/keyboard_actions", () => ({ default: { updateDisplayedShortcuts: vi.fn() } }));

/** The page as the shell leaves it: the menu's own element, at the end of the body. */
function buildPage() {
    document.body.innerHTML = `<div id="app"></div><div id="context-menu-container"></div>`;
    return document.getElementById("context-menu-container");
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
    it("stands at the end of the page while nothing has the screen", async () => {
        const menu = buildPage();
        const contextMenu = await buildContextMenu();

        await contextMenu.show({ x: 10, y: 10, items, selectMenuItemHandler: () => {} });

        expect(menu?.parentElement).toBe(document.body);
    });

    it("moves inside whatever has the screen, and back once nothing does", async () => {
        const menu = buildPage();
        const contextMenu = await buildContextMenu();
        const map = document.getElementById("app");

        setFullscreenElement(map);
        await contextMenu.show({ x: 10, y: 10, items, selectMenuItemHandler: () => {} });
        // Anywhere else it would be laid out and left unpainted, which reads as a menu that never opened.
        expect(menu?.parentElement).toBe(map);

        setFullscreenElement(null);
        await contextMenu.show({ x: 10, y: 10, items, selectMenuItemHandler: () => {} });

        expect(menu?.parentElement).toBe(document.body);
    });

    /**
     * A submenu opens towards the trailing edge, and a menu raised near that edge would draw it off
     * the screen. It goes on the other side of its parent instead, which is what the page already
     * does for the launcher bar lying on its side.
     */
    it("opens a submenu on the other side of a menu standing at the edge", async () => {
        buildPage();
        const contextMenu = await buildContextMenu();
        Object.defineProperty(document.documentElement, "clientWidth",
            { value: 1000, configurable: true });
        Object.defineProperty(document.documentElement, "clientHeight",
            { value: 800, configurable: true });

        await contextMenu.show({
            x: 900, y: 10,
            items: [ { title: "More states", items } ],
            selectMenuItemHandler: () => {}
        });

        const parent = document.querySelector<HTMLElement>(".dropdown-submenu");
        const submenu = parent?.querySelector<HTMLElement>(".dropdown-menu");
        if (!parent || !submenu) throw new Error("expected a submenu");

        // jQuery binds `mouseenter` as a native `mouseover`, which is what the hover has to be.
        const hover = () =>
            parent.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));

        // happy-dom measures nothing, so the submenu is told where it stands.
        const place = (left: number, width: number) =>
            Object.defineProperty(submenu, "getBoundingClientRect", {
                value: () => ({
                    left, right: left + width, width,
                    top: 10, bottom: 110, height: 100
                }),
                configurable: true
            });

        place(910, 300);
        hover();
        expect(submenu.classList.contains("submenu-flip-start")).toBe(true);

        // Where it fits as it is, it is left where it opens.
        place(500, 300);
        hover();
        expect(submenu.classList.contains("submenu-flip-start")).toBe(false);

        // And where it fits on neither side, since flipping would only clip the other end.
        place(910, 950);
        hover();
        expect(submenu.classList.contains("submenu-flip-start")).toBe(false);
    });

    it("tints an item's icon with the colour class it carries, and only the icon", async () => {
        const menu = buildPage();
        const contextMenu = await buildContextMenu();

        await contextMenu.show({
            x: 10,
            y: 10,
            selectMenuItemHandler: () => {},
            items: [
                { title: "To Do", uiIcon: "bx bx-list-ul", iconColorClass: "use-note-color color-e64d4d" },
                { title: "Done", uiIcon: "bx bx-check" }
            ]
        });

        const icons = [ ...menu?.querySelectorAll(".dropdown-item .tn-icon") ?? [] ];
        expect(icons.map(icon => icon.classList.contains("use-note-color"))).toEqual([ true, false ]);
        // The label sits beside the icon rather than inside it, so it keeps the menu's own colour.
        expect(menu?.querySelectorAll(".dropdown-item .use-note-color")).toHaveLength(1);
    });

    it("puts itself away once a submenu's parent acts, and stays up for one that only folds", async () => {
        const menu = buildPage();
        const contextMenu = await buildContextMenu();
        const picked: string[] = [];

        const show = () => contextMenu.show({
            x: 10,
            y: 10,
            selectMenuItemHandler: (item) => { picked.push(String(item.title)); },
            items: [
                { title: "Open note", command: "openNoteInNewTab", items: [ { title: "New tab" } ] },
                { title: "More", items: [ { title: "Archived" } ] }
            ]
        });
        const pressRow = (title: string) => {
            // Read off the row's own line: its text also holds whatever its submenu lists.
            const row = [ ...menu?.querySelectorAll("li.dropdown-item") ?? [] ]
                .find((item) => item.querySelector(":scope > span")?.textContent?.trim() === title);
            expect(row, title).toBeTruthy();
            const press = new MouseEvent("mousedown", { bubbles: true, button: 0 });
            // happy-dom leaves the legacy `which` unset, which is what the menu reads for the
            // primary button.
            Object.defineProperty(press, "which", { value: 1 });
            row?.dispatchEvent(press);
        };

        await show();
        pressRow("Open note");
        expect(picked).toEqual([ "Open note" ]);
        expect(contextMenu.isShown()).toBe(false);

        await show();
        pressRow("More");
        expect(picked).toEqual([ "Open note", "More" ]);
        // Nothing ran, so the menu is left standing for the submenu to be reached from.
        expect(contextMenu.isShown()).toBe(true);
    });

    it("says whether it is up, for a host whose own press would otherwise not know", async () => {
        buildPage();
        const contextMenu = await buildContextMenu();

        // A host that answers a press itself keeps it from the document, whose click is what puts
        // the menu away — so it has to ask, rather than let a standing menu outlive the press.
        expect(contextMenu.isShown()).toBe(false);

        await contextMenu.show({ x: 10, y: 10, items, selectMenuItemHandler: () => {} });
        expect(contextMenu.isShown()).toBe(true);

        await contextMenu.hide();
        expect(contextMenu.isShown()).toBe(false);
    });
});
