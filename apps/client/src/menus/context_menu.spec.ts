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
});
