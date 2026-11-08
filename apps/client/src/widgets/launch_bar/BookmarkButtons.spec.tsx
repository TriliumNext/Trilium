import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import appContext from "../../components/app_context";
import type FNote from "../../entities/fnote";
import { buildNote } from "../../test/easy-froca";
import { renderInto } from "../../test/render";
import { BookmarkFolder } from "./BookmarkButtons";
import { launchCustomNoteLauncher } from "./GenericButtons";

const h = vi.hoisted(() => ({
    isMobile: false,
    opened: [] as string[],
    openModes: [] as (string | null)[],
    openContextMenu: vi.fn()
}));

vi.mock("../../services/utils", async (importOriginal) => ({
    ...await importOriginal<typeof import("../../services/utils")>(),
    isMobile: () => h.isMobile
}));
vi.mock("../../menus/link_context_menu", async (importOriginal) => {
    const original = await importOriginal<typeof import("../../menus/link_context_menu")>();
    return { default: { ...original.default, openContextMenu: h.openContextMenu } };
});
vi.mock("./GenericButtons", async (importOriginal) => ({
    ...await importOriginal<typeof import("./GenericButtons")>(),
    launchCustomNoteLauncher: vi.fn(async (_e: MouseEvent, options: {
        launcherNote: FNote,
        getTargetNoteId: (launcherNote: FNote) => string,
        getOpenMode?: (launcherNote: FNote) => string | null
    }) => {
        const { launcherNote, getTargetNoteId, getOpenMode } = options;
        h.opened.push(getTargetNoteId(launcherNote));
        h.openModes.push(getOpenMode?.(launcherNote) ?? null);
    })
}));

afterEach(() => {
    h.isMobile = false;
    h.opened.length = 0;
    h.openModes.length = 0;
    vi.clearAllMocks();
    document.body.classList.remove("motion-disabled");
});

describe("BookmarkFolder", () => {
    /** A folder whose `branch` child has children, and whose `hidden` child hides its own. */
    function buildFolder() {
        return buildNote({
            id: "folder",
            title: "Folder",
            "#bookmarkFolder": "",
            children: [
                { id: "first", title: "First" },
                { id: "branch", title: "Branch", children: [ { id: "leaf", title: "Leaf" } ] },
                {
                    id: "hidden",
                    title: "Hidden",
                    "#subtreeHidden": "",
                    children: [ { id: "secret", title: "Secret" } ]
                }
            ]
        });
    }

    /** Opens the folder's menu, once its `rowCount` rows are drawn. */
    async function openMenu(note: FNote, rowCount: number) {
        const container = renderInto(<BookmarkFolder note={note} />);
        const toggle = container.querySelector<HTMLElement>(".right-dropdown-button");
        if (!toggle) throw new Error("expected the folder's button to render");
        await act(async () => {
            toggle.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
            toggle.click();
            await Promise.resolve();
        });
        return await vi.waitFor(() => {
            const menu = popup();
            expect(rowsOf(menu)).toHaveLength(rowCount);
            if (!menu) throw new Error("expected the folder's menu to open");
            return menu;
        });
    }

    const popup = () => document.querySelector<HTMLElement>(".tn-popup.tn-menu");
    const rowsOf = (level: Element | null | undefined) => [ ...level?.querySelectorAll<HTMLElement>(
        ":scope > .tn-menu-scroll > li, :scope > .tn-menu-filterable > .tn-menu-scroll > li"
    ) ?? [] ];
    const filterInputOf = (level: Element | undefined) => level?.querySelector<HTMLInputElement>(
        ":scope > .tn-menu-filterable input.tn-menu-filter-input"
    ) ?? null;
    const layerElements = (menu: HTMLElement) =>
        [ ...menu.querySelectorAll<HTMLElement>(":scope > div.dropdown-submenu > .dropdown-menu") ];
    /** The open submenus' layers, each as its rows. */
    const layers = (menu: HTMLElement) => layerElements(menu).map(rowsOf);
    const titles = (rows: HTMLElement[]) => rows.map((row) => row.textContent);
    /** Whether a row is the folder's note or one of its children, and whether it is a split row. */
    const kindOf = (row: HTMLElement) => [
        row.classList.contains("bookmark-folder-note") && "note",
        row.classList.contains("bookmark-folder-child") && "child",
        row.classList.contains("dropdown-submenu") && row.classList.contains("tn-menu-split")
            && "submenu"
    ].filter(Boolean).join(" ");

    function rowTitled(rows: HTMLElement[], title: string) {
        const row = rows.find((candidate) => candidate.textContent === title);
        if (!row) throw new Error(`expected a row titled ${title}`);
        return row;
    }

    const press = (element: HTMLElement, modifiers: MouseEventInit = {}) => {
        const init = { bubbles: true, cancelable: true, button: 0, ...modifiers };
        element.dispatchEvent(new MouseEvent("mousedown", init));
        element.dispatchEvent(new MouseEvent("click", init));
    };

    /** Presses the middle button on `element`, returning whether the press was canceled. */
    const middleClick = (element: HTMLElement) => {
        const init = { bubbles: true, cancelable: true, button: 1 };
        const down = new MouseEvent("mousedown", init);
        element.dispatchEvent(down);
        element.dispatchEvent(new MouseEvent("auxclick", init));
        return down.defaultPrevented;
    };
    const rightClick = (element: HTMLElement) => {
        const init = { bubbles: true, cancelable: true, button: 2 };
        // Browsers fire `auxclick` for the right button as well as the middle one.
        element.dispatchEvent(new MouseEvent("auxclick", init));
        element.dispatchEvent(new MouseEvent("contextmenu", init));
    };

    async function type(input: HTMLInputElement, text: string) {
        await act(async () => {
            input.value = text;
            input.dispatchEvent(new Event("input", { bubbles: true }));
        });
    }

    it("lists the folder note, then its children, with submenus for those shown", async () => {
        const menu = await openMenu(buildFolder(), 4);
        const rows = rowsOf(menu);

        expect(titles(rows)).toEqual([ "Folder", "First", "Branch", "Hidden" ]);
        expect(rows.map(kindOf)).toEqual([ "note", "child", "child submenu", "child" ]);
        // The submenu's rows are drawn only once it opens.
        expect(document.body.textContent).not.toContain("Leaf");

        const arrow = rowTitled(rows, "Branch").querySelector<HTMLElement>(".tn-menu-split-toggle");
        if (!arrow) throw new Error("expected the split row to draw its arrow");
        press(arrow);
        await vi.waitFor(() => expect(layers(menu).map(titles)).toEqual([ [ "Leaf" ] ]));
        expect(layers(menu)[0].map(kindOf)).toEqual([ "" ]);
        expect(h.opened).toEqual([]);
    });

    it("opens the note of the row picked and closes the menu, a split row's too", async () => {
        const folder = buildFolder();
        let menu = await openMenu(folder, 4);
        press(rowTitled(rowsOf(menu), "Branch"));
        expect(h.opened).toEqual([ "branch" ]);
        await vi.waitFor(() => expect(popup()).toBeNull());

        menu = await openMenu(folder, 4);
        press(rowTitled(rowsOf(menu), "Folder"));
        expect(h.opened).toEqual([ "branch", "folder" ]);
        await vi.waitFor(() => expect(popup()).toBeNull());
    });

    it("opens a row's note in its #bookmarkOpenMode, which the folder can pass on", async () => {
        const folder = buildNote({
            id: "folder",
            title: "Folder",
            "#bookmarkOpenMode(inheritable)": "newSplit",
            children: [
                { id: "first", title: "First" },
                { id: "own", title: "Own", "#bookmarkOpenMode": "currentTab" }
            ]
        });

        for (const title of [ "Folder", "First", "Own" ]) {
            const menu = await openMenu(folder, 3);
            press(rowTitled(rowsOf(menu), title));
            await vi.waitFor(() => expect(popup()).toBeNull());
        }
        expect(h.opened).toEqual([ "folder", "first", "own" ]);
        expect(h.openModes).toEqual([ "newSplit", "newSplit", "currentTab" ]);
    });

    it("nests submenus four levels deep, listing the notes below as plain rows", async () => {
        const deep = buildNote({
            title: "Deep",
            children: [ { id: "l1", title: "L1", children: [ { id: "l2", title: "L2", children: [
                { id: "l3", title: "L3", children: [ { id: "l4", title: "L4", children: [
                    { id: "l5", title: "L5", children: [ { id: "l6", title: "L6" } ] }
                ] } ] }
            ] } ] } ]
        });
        const menu = await openMenu(deep, 2);

        let rows = rowsOf(menu);
        for (const [ depth, title ] of [ "L1", "L2", "L3", "L4" ].entries()) {
            const row = rowTitled(rows, title);
            expect(row.classList).toContain("tn-menu-split");
            row.dispatchEvent(new PointerEvent("pointerenter"));
            rows = await vi.waitFor(() => {
                const opened = layers(menu);
                expect(opened).toHaveLength(depth + 1);
                expect(opened[depth].length).toBeGreaterThan(0);
                return opened[depth];
            });
        }

        expect(titles(rows)).toEqual([ "L5" ]);
        expect(rows.map(kindOf)).toEqual([ "" ]);
        expect(rows[0].classList).not.toContain("dropdown-submenu");
    });

    it("offers a filter on a level of more than 15 children, which lists the matches", async () => {
        const numbered = (title: string, count: number) =>
            Array.from({ length: count }, (_, index) => ({
                id: `${title.toLowerCase()}${index + 1}`, title: `${title} ${index + 1}`
            }));
        const folder = buildNote({
            title: "Folder",
            children: [
                ...numbered("Note", 14),
                { id: "many", title: "Many", children: numbered("Item", 16) },
                { id: "few", title: "Few", children: numbered("Leaf", 15) }
            ]
        });
        let menu = await openMenu(folder, 17);
        expect(filterInputOf(menu)).not.toBeNull();

        rowTitled(rowsOf(menu), "Few").dispatchEvent(new PointerEvent("pointerenter"));
        await vi.waitFor(() => expect(layers(menu)[0]).toHaveLength(15));
        expect(filterInputOf(layerElements(menu)[0])).toBeNull();

        rowTitled(rowsOf(menu), "Many").dispatchEvent(new PointerEvent("pointerenter"));
        await vi.waitFor(() => expect(layers(menu)[0]).toHaveLength(16));
        const submenuInput = filterInputOf(layerElements(menu)[0]);
        if (!submenuInput) throw new Error("expected the submenu to offer a filter");
        await type(submenuInput, "16");
        const matches = await vi.waitFor(() => {
            const found = layers(menu)[0];
            expect(titles(found)).toEqual([ "Item 16" ]);
            return found;
        });
        press(matches[0]);
        expect(h.opened).toEqual([ "item16" ]);
        await vi.waitFor(() => expect(popup()).toBeNull());

        // The folder's own note is filtered along with its children.
        menu = await openMenu(folder, 17);
        const input = filterInputOf(menu);
        if (!input) throw new Error("expected the folder's menu to offer a filter");
        await type(input, "f");
        await vi.waitFor(() => expect(titles(rowsOf(menu))).toEqual([ "Folder", "Few" ]));
        // The titles keep the box that caps their width, as the rows' do.
        expect(rowsOf(menu).map((row) => row.querySelector(".tn-menu-name")?.textContent))
            .toEqual([ "Folder", "Few" ]);
        press(rowTitled(rowsOf(menu), "Few"));
        expect(h.opened).toEqual([ "item16", "few" ]);
    });

    it("opens a note as a link to it does: middle click, right-click and Shift", async () => {
        const triggerCommand = vi.spyOn(appContext, "triggerCommand")
            .mockReturnValue(undefined as never);
        const folder = buildNote({
            title: "Links",
            children: [
                ...Array.from({ length: 15 }, (_, index) => ({
                    id: `link${index + 1}`, title: `Link ${index + 1}`
                })),
                { id: "branch", title: "Branch", children: [ { id: "leaf", title: "Leaf" } ] }
            ]
        });
        const menu = await openMenu(folder, 17);

        // A plain row, a split row and a filtered match: the middle button opens a new tab and
        // leaves the menu open, the right one opens the link menu.
        const rows = [ rowTitled(rowsOf(menu), "Link 1"), rowTitled(rowsOf(menu), "Branch") ];
        for (const row of rows) {
            expect(middleClick(row)).toBe(true);
            rightClick(row);
        }
        const input = filterInputOf(menu);
        if (!input) throw new Error("expected the folder's menu to offer a filter");
        await type(input, "Link 15");
        const match = await vi.waitFor(() => rowTitled(rowsOf(menu), "Link 15"));
        expect(middleClick(match)).toBe(true);
        rightClick(match);

        expect(h.opened).toEqual([ "link1", "branch", "link15" ]);
        expect(vi.mocked(launchCustomNoteLauncher).mock.calls.map(([ e ]) => e.type))
            .toEqual([ "auxclick", "auxclick", "auxclick" ]);
        expect(h.openContextMenu.mock.calls.map(([ notePath ]) => notePath))
            .toEqual([ "link1", "branch", "link15" ]);
        expect(popup()).not.toBeNull();

        // Shift opens a new window, and the menu closes.
        press(match, { shiftKey: true });
        expect(triggerCommand).toHaveBeenCalledWith("openInWindow", { notePath: "link15" });
        expect(h.opened).toHaveLength(3);
        await vi.waitFor(() => expect(popup()).toBeNull());
        triggerCommand.mockRestore();
    });

    it("lists a submenu's note above its children on a phone, without split rows", async () => {
        h.isMobile = true;
        // Without slides, a page opens as soon as its row is tapped.
        document.body.classList.add("motion-disabled");
        const menu = await openMenu(buildFolder(), 4);

        const branch = rowTitled(rowsOf(menu), "Branch");
        expect(branch.querySelector(".tn-menu-split-toggle")).toBeNull();
        press(branch);

        const pageRows = await vi.waitFor(() => {
            const found = [
                ...menu.querySelectorAll<HTMLElement>(":scope > .tn-menu-page .tn-menu-scroll > li")
            ];
            expect(titles(found)).toEqual([ "Branch", "Leaf" ]);
            return found;
        });
        expect(h.opened).toEqual([]);
        expect(pageRows.map(kindOf)).toEqual([ "note", "child" ]);
        // A long press opens no link menu.
        rightClick(pageRows[1]);
        expect(h.openContextMenu).not.toHaveBeenCalled();

        press(pageRows[0]);
        expect(h.opened).toEqual([ "branch" ]);
    });
});
