import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CommandNames } from "../../../components/app_context";
import contextMenu, { ContextMenuEvent, MenuItem } from "../../../menus/context_menu";
import branches from "../../../services/branches";
import dialog from "../../../services/dialog";
import FNote from "../../../entities/fnote";
import type { PromotedAttribute } from "../promoted_attributes";
import { buildNote } from "../../../test/easy-froca";
import BoardApi from "./api";
import { DEFAULT_COLUMN_ICON } from "./columns";
import { openBoardContextMenu, openColumnContextMenu, openNoteContextMenu } from "./context_menu";

// The card menu opens with the shared link items, which reach for the active note context.
vi.mock("../../../menus/link_context_menu", () => ({
    default: {
        getQuickEditItem: () => ({ title: "Quick edit" }),
        getOpenNoteItem: () => ({ title: "Open note", items: [] }),
        handleLinkContextMenuItem: () => {}
    }
}));

// i18next is never initialised under test, so `t` echoes the key it is given. The promise is what
// the command registry awaits as `PromotedAttributesCard` is pulled in for the attribute icons.
vi.mock("../../../services/i18n", () => ({
    t: (key: string) => key,
    translationsInitializedPromise: Promise.resolve()
}));

describe("Board column context menu", () => {
    let container: HTMLElement | undefined;

    afterEach(() => {
        vi.restoreAllMocks();
        if (container) {
            render(null, container);
            container.remove();
            container = undefined;
        }
    });

    function openMenu(
        api: BoardApi,
        column: {
            value?: string, color?: string, archived?: boolean, collapsed?: boolean,
            keepCollapsed?: boolean, isCollapsed?: boolean, canRename?: boolean,
            columns?: string[], index?: number, nested?: boolean
        } = {},
        callbacks: {
            onEditTitle?: () => void,
            onNewItem?: () => void,
            onAddColumn?: (direction: "before" | "after") => void,
            onMoveColumn?: (toIndex: number) => void,
            onSetLimit?: () => void,
            onCollapse?: (collapsed: boolean) => void,
            onKeepCollapsed?: (keepCollapsed: boolean) => void
        } = {}
    ) {
        const show = vi.spyOn(contextMenu, "show").mockImplementation(async () => {});
        const event = {
            preventDefault: () => {},
            stopPropagation: () => {},
            pageX: 0,
            pageY: 0
        } as ContextMenuEvent;

        // Every column menu asks what a column is called, how it is sorted and what it can sort
        // by; a test answers only where that is what it is about.
        const withDefaults = Object.assign({
            getColumnTitle: (name: string) => name,
            getColumnSort: () => ({ orderBy: undefined, isDescending: false }),
            getEffectiveColumnSort: () => ({ orderBy: undefined, isDescending: false }),
            getPromotedAttributes: () => []
        }, api);
        openColumnContextMenu(withDefaults, event, {
            value: "To Do",
            columns: [ "To Do" ],
            index: 0,
            canRename: true,
            ...column,
            onEditTitle: callbacks.onEditTitle ?? (() => {}),
            onNewItem: callbacks.onNewItem ?? (() => {}),
            onAddColumn: callbacks.onAddColumn ?? (() => {}),
            onMoveColumn: callbacks.onMoveColumn ?? (() => {}),
            onSetLimit: callbacks.onSetLimit ?? (() => {}),
            onCollapse: callbacks.onCollapse ?? (() => {}),
            onKeepCollapsed: callbacks.onKeepCollapsed ?? (() => {})
        });

        // The spy outlives one call, so it is the menu just opened that is read back.
        return show.mock.calls.at(-1)?.[0].items ?? [];
    }

    /** Renders the colour picker the menu offers for a column already carrying `color`. */
    async function openPicker(api: BoardApi, color?: string) {
        const items = openMenu(api, { color });
        const custom = items.find(item => item && "kind" in item && item.kind === "custom");
        if (!custom || !("componentFn" in custom)) {
            throw new Error("expected a colour picker in the menu");
        }

        const element = document.createElement("div");
        container = element;
        document.body.appendChild(element);
        // Rendered as a component, the way the menu itself does it, so its hooks have a context.
        await act(async () => {
            render(h(custom.componentFn, {}), element);
        });

        return element;
    }

    it("offers the title editor, which the retired header button used to open", () => {
        const onEditTitle = vi.fn();
        const items = openMenu({} as BoardApi, {}, { onEditTitle });

        // Found by its icon: i18next is never initialised under test, so every title is undefined.
        const entry = items.find(item =>
            item && "uiIcon" in item && item.uiIcon === "bx bx-edit-alt");
        if (!entry || !("handler" in entry)) throw new Error("expected an edit-title entry");

        entry.handler?.(entry, {} as never);
        expect(onEditTitle).toHaveBeenCalled();
    });

    it("offers to archive a column, and to bring back one already archived", () => {
        const api = { setColumnArchived: vi.fn() } as unknown as BoardApi;

        const archive = openMenu(api).find(item =>
            item && "uiIcon" in item && item.uiIcon === "bx bx-archive");
        if (!archive || !("handler" in archive)) throw new Error("expected an archive entry");
        archive.handler?.(archive, {} as never);
        expect(api.setColumnArchived).toHaveBeenLastCalledWith("To Do", true);

        const unarchive = openMenu(api, { archived: true }).find(item =>
            item && "uiIcon" in item && item.uiIcon === "bx bx-archive-out");
        if (!unarchive || !("handler" in unarchive)) throw new Error("expected an unarchive entry");
        unarchive.handler?.(unarchive, {} as never);
        expect(api.setColumnArchived).toHaveBeenLastCalledWith("To Do", false);
    });

    /** Collapsing is what the entry does; whether the column stays collapsed is the other one. */
    it("collapses the column, and offers nothing to collapse while it is a strip", () => {
        const onCollapse = vi.fn();
        const entry = openMenu({} as BoardApi, {}, { onCollapse }).find(item =>
            item && "uiIcon" in item && item.uiIcon === "bx bx-collapse-horizontal");
        if (!entry || !("handler" in entry)) throw new Error("expected a collapse entry");

        entry.handler?.(entry, {} as never);
        expect(onCollapse).toHaveBeenLastCalledWith(true);

        expect(openMenu({} as BoardApi, { isCollapsed: true }).some(item =>
            item && "uiIcon" in item && item.uiIcon === "bx bx-collapse-horizontal")).toBe(false);
    });

    it("carries the keep-collapsed state, and reports the entry as checked", () => {
        const onKeepCollapsed = vi.fn();
        const entryOf = (keepCollapsed: boolean) => {
            const found = openMenu({} as BoardApi, { keepCollapsed }, { onKeepCollapsed })
                .find(item => item && "uiIcon" in item && item.uiIcon === "bx bx-lock-alt");
            if (!found || !("handler" in found)) throw new Error("expected a keep entry");
            return found;
        };

        // The check sits after the title, the entry keeping its own icon ahead of it.
        const unchecked = entryOf(false);
        expect("trailingIcon" in unchecked && unchecked.trailingIcon).toBeUndefined();
        unchecked.handler?.(unchecked, {} as never);
        expect(onKeepCollapsed).toHaveBeenLastCalledWith(true);

        const checked = entryOf(true);
        expect("trailingIcon" in checked && checked.trailingIcon).toBe("bx bx-check");
        checked.handler?.(checked, {} as never);
        expect(onKeepCollapsed).toHaveBeenLastCalledWith(false);
    });

    /** The strip has no title to edit, so the menu does not offer to edit one either. */
    it("offers no rename while the column is drawn as a strip", () => {
        // A column offers no rename only while it is drawn as a strip, which is a stored collapse.
        const icons = (canRename: boolean) =>
            openMenu({} as BoardApi, { canRename, collapsed: !canRename })
            .filter(item => item && "uiIcon" in item)
            .map(item => item && "uiIcon" in item ? item.uiIcon : undefined);

        expect(icons(true)).toContain("bx bx-edit-alt");
        expect(icons(false)).not.toContain("bx bx-edit-alt");
        // Everything else the menu offers is still there.
        expect(icons(false)).toContain("bx bx-lock-alt");
        expect(icons(false)).toContain("bx bx-trash");
    });

    /**
     * The inbox holds a name of its own, so it is renamed like any other column; what it has not is
     * anything to archive, and it is put away by the board's own setting instead.
     */
    it("offers the inbox no archive, and puts it away instead", () => {
        const api = {
            getColumnIcon: () => DEFAULT_COLUMN_ICON,
            getColumnColorClass: () => "",
            isColumnArchived: () => false,
            disableInbox: vi.fn(async () => {}),
            setInboxNested: vi.fn(async () => {})
        } as unknown as BoardApi;

        const items = openMenu(api, { value: "", columns: [ "", "To Do" ], index: 0 });
        const icons = items.filter(item => item && "uiIcon" in item)
            .map(item => "uiIcon" in item ? item.uiIcon : undefined);

        expect(icons).toContain("bx bx-edit-alt");
        expect(icons).not.toContain("bx bx-archive");

        const remove = items.find(item =>
            item && "uiIcon" in item && item.uiIcon === "bx bx-trash");
        if (!remove || !("handler" in remove)) throw new Error("expected a remove entry");
        remove.handler?.(remove, {} as never);
        expect(api.disableInbox).toHaveBeenCalled();
    });

    it("offers the inbox nesting as a state it shows, and writes the other one", () => {
        const api = {
            getColumnIcon: () => DEFAULT_COLUMN_ICON,
            getColumnColorClass: () => "",
            isColumnArchived: () => false,
            setInboxNested: vi.fn(async () => {})
        } as unknown as BoardApi;

        const items = openMenu(api, { value: "", columns: [ "", "To Do" ], index: 0 });
        const nesting = items.find(item =>
            item && "uiIcon" in item && item.uiIcon === "bx bx-subdirectory-right");
        if (!nesting || !("handler" in nesting)) throw new Error("expected a nesting entry");

        expect(nesting).toMatchObject({ checked: false });
        nesting.handler?.(nesting, {} as never);
        expect(api.setInboxNested).toHaveBeenCalledWith(true);
    });

    it("orders the entries, keeping the safe way out ahead of deleting", () => {
        const titled = openMenu({} as BoardApi).filter(item => item && "uiIcon" in item);
        expect(titled.map(item => "uiIcon" in item ? item.uiIcon : undefined))
            .toEqual([
                "bx bx-edit-alt",
                "bx bx-plus", "bx bx-link", "bx bx-columns",
                "bx bx-collapse-horizontal", "bx bx-lock-alt", "bx bx-sort-alt-2",
                "bx bx-tachometer",
                "bx bx-horizontal-left",
                "bx bx-archive", "bx bx-trash"
            ]);
    });

    /** A collapsed column offers no rename, so the group above the first divider is empty. */
    it("opens on an entry rather than a divider when it has nothing to rename", () => {
        const items = openMenu({} as BoardApi, { canRename: false, isCollapsed: true });

        expect(items[0]).not.toMatchObject({ kind: "separator" });
        expect(items[0]).toMatchObject({ uiIcon: "bx bx-plus" });
    });

    /** Every place offered has to actually move the column, or the menu promises nothing. */
    it("offers only the places that would move the column", () => {
        const api = {
            getColumnIcon: () => DEFAULT_COLUMN_ICON,
            getColumnColorClass: () => "",
            isColumnArchived: () => false
        } as unknown as BoardApi;

        /** Where each entry would send the column, in the order the submenu offers them. */
        const places = (index: number) => {
            const moved: number[] = [];
            const menu = openMenu(api, { columns: [ "To Do", "Doing", "Done" ], index }, {
                onMoveColumn: (toIndex) => moved.push(toIndex)
            });
            const entry = menu.find(item =>
                item && "uiIcon" in item && item.uiIcon === "bx bx-horizontal-left");
            if (!entry || !("items" in entry)) throw new Error("expected a move-column entry");

            for (const item of entry.items ?? []) {
                if (item && "handler" in item) item.handler?.(item, {} as never);
            }
            return moved;
        };

        // A column is placed before a position, so following the one at an index means past it.
        // From the head: no head to move to, and nothing for itself or the column it already leads.
        expect(places(0)).toEqual([ 2, 3 ]);
        // From the middle: the head, and past the tail. Following "To Do" is where it already is.
        expect(places(1)).toEqual([ 0, 3 ]);
        // From the tail: the head, and following "To Do".
        expect(places(2)).toEqual([ 0, 1 ]);
    });

    it("boxes the column names it offers to move past, as the status list does", () => {
        const api = {
            getColumnIcon: () => DEFAULT_COLUMN_ICON,
            getColumnColorClass: () => "",
            isColumnArchived: () => false
        } as unknown as BoardApi;

        const menu = openMenu(api, { columns: [ "To Do", "Doing", "Done" ], index: 2 });
        const entry = menu.find(item =>
            item && "uiIcon" in item && item.uiIcon === "bx bx-horizontal-left");
        if (!entry || !("items" in entry)) throw new Error("expected a move-column entry");

        // The head of the board carries no name, so only the ones naming a column are boxed.
        const after = (entry.items ?? []).slice(1);
        expect(after).toHaveLength(1);

        // i18next is never initialised under test, so what it interpolates comes back undefined;
        // the box around it is what this is about.
        for (const item of after) {
            expect(item && "title" in item ? item.title : "")
                .toMatch(/^<span class="tn-menu-name">.*<\/span>$/);
        }
    });

    it("offers both sides to put a new column on", () => {
        const onAddColumn = vi.fn();
        const parent = openMenu({} as BoardApi, {}, { onAddColumn })
            .find(item => item && "uiIcon" in item && item.uiIcon === "bx bx-columns");
        if (!parent || !("items" in parent)) throw new Error("expected an add-column entry");

        const sides = parent.items ?? [];
        expect(sides).toHaveLength(2);
        for (const side of sides) {
            if (side && "handler" in side) side.handler?.(side, {} as never);
        }
        expect(onAddColumn.mock.calls.flat()).toEqual([ "before", "after" ]);
    });

    it("opens the column's new-item editor, the same one its button opens", () => {
        const onNewItem = vi.fn();
        const entry = openMenu({} as BoardApi, {}, { onNewItem })
            .find(item => item && "uiIcon" in item && item.uiIcon === "bx bx-plus");
        if (!entry || !("handler" in entry)) throw new Error("expected a new-item entry");

        entry.handler?.(entry, {} as never);
        expect(onNewItem).toHaveBeenCalled();
    });

    it("asks for a note, then adds the one chosen to the column", async () => {
        const api = { addExistingItem: vi.fn(async () => true) } as unknown as BoardApi;
        vi.spyOn(dialog, "chooseNote").mockResolvedValue("pickedNote");

        const entry = openMenu(api)
            .find(item => item && "uiIcon" in item && item.uiIcon === "bx bx-link");
        if (!entry || !("handler" in entry)) throw new Error("expected an add-existing entry");

        await entry.handler?.(entry, {} as never);
        expect(api.addExistingItem).toHaveBeenCalledWith("To Do", "pickedNote");
    });

    it("adds nothing when no note is chosen", async () => {
        const api = { addExistingItem: vi.fn(async () => true) } as unknown as BoardApi;
        vi.spyOn(dialog, "chooseNote").mockResolvedValue(null);

        const entry = openMenu(api)
            .find(item => item && "uiIcon" in item && item.uiIcon === "bx bx-link");
        if (!entry || !("handler" in entry)) throw new Error("expected an add-existing entry");

        await entry.handler?.(entry, {} as never);
        expect(api.addExistingItem).not.toHaveBeenCalled();
    });

    /** The keys are the board's own, so they are written out rather than looked up as actions. */
    it("names the key beside each column entry that has one", () => {
        const items = openMenu({} as unknown as BoardApi);
        const byIcon = (icon: string) =>
            items.find(item => item && "uiIcon" in item && item.uiIcon === icon);

        expect(byIcon("bx bx-edit-alt")).toMatchObject({ shortcut: "F2" });
        expect(byIcon("bx bx-trash")).toMatchObject({ shortcut: "Delete" });
        // Nothing claims a key it does not answer for.
        expect(byIcon("bx bx-link")).not.toHaveProperty("shortcut");

        const submenu = byIcon("bx bx-columns");
        const children = submenu && "items" in submenu ? submenu.items ?? [] : [];

        // Before then after, the order the menu offers them in.
        expect(children[0]).toMatchObject({ shortcut: "Ctrl+Shift+Enter" });
        expect(children[1]).toMatchObject({ shortcut: "Ctrl+Enter" });
    });

    /** The asking lives on the api, so the Delete key puts the same question the same way. */
    it("hands a column deletion to the api, which is what asks", async () => {
        const api = { confirmAndRemoveColumn: vi.fn(async () => true) } as unknown as BoardApi;

        const entry = openMenu(api)
            .find(item => item && "uiIcon" in item && item.uiIcon === "bx bx-trash");
        if (!entry || !("handler" in entry)) throw new Error("expected a delete entry");

        await entry.handler?.(entry, {} as never);

        expect(api.confirmAndRemoveColumn).toHaveBeenCalledWith("To Do");
    });

    it("shows the column's own colour as the selected one", async () => {
        const api = { setColumnColor: vi.fn() } as unknown as BoardApi;
        const picker = await openPicker(api, "#4d99e6");

        const selected = picker.querySelector<HTMLElement>(".color-cell.selected");
        expect(selected?.style.getPropertyValue("--color")).toBe("#4d99e6");
    });

    it("writes a pick to the column, and a clear back to no colour", async () => {
        const api = { setColumnColor: vi.fn() } as unknown as BoardApi;
        const picker = await openPicker(api);

        // The reset cell leads the row, so the first plain cell after it is a preset.
        const preset = picker
            .querySelectorAll<HTMLElement>(".color-cell:not(.color-cell-reset)")[0];
        await act(async () => preset.click());
        expect(api.setColumnColor)
            .toHaveBeenLastCalledWith("To Do", preset.style.getPropertyValue("--color"));

        await act(async () => picker.querySelector<HTMLElement>(".color-cell-reset")?.click());
        expect(api.setColumnColor).toHaveBeenLastCalledWith("To Do", null);
    });

    /**
     * The entries themselves are the shared builder's, tested in `collections/sort_menu.spec.ts`.
     * What the board answers for is the column it names and what it calls the manual order.
     */
    describe("the sort submenu", () => {
        function sortApi() {
            return {
                getColumnSort: () => ({ orderBy: undefined, isDescending: false }),
                getEffectiveColumnSort: () => ({ orderBy: undefined, isDescending: false }),
                getPromotedAttributes: () => [],
                setColumnSort: vi.fn(),
                setColumnSortDirection: vi.fn()
            } as unknown as BoardApi;
        }

        function sortItems(api: BoardApi, value = "To Do") {
            const entry = openMenu(api, { value, columns: [ value ] })
                .find(item => item && "uiIcon" in item && item.uiIcon === "bx bx-sort-alt-2");
            if (!entry || !("items" in entry)) throw new Error("expected a sort entry");
            return entry.items ?? [];
        }

        it("leads with the board's own order, and calls the unsorted one Manually", () => {
            const items = sortItems(sortApi());

            expect(items.slice(0, 2).map(item => item && "title" in item ? item.title : ""))
                .toEqual([ "board_view.sort-board-default", "board_view.sort-manually" ]);
        });

        it("writes what is picked against the column the menu was opened on", () => {
            const api = sortApi();
            const items = sortItems(api, "Done");

            pick(items[0]);
            expect(api.setColumnSort).toHaveBeenCalledWith("Done", "default");

            pick(items[2]);
            expect(api.setColumnSort).toHaveBeenLastCalledWith("Done", "title");

            pick(items.at(-1));
            expect(api.setColumnSortDirection).toHaveBeenCalledWith("Done", true);
        });

        function pick(item: MenuItem<unknown> | undefined) {
            if (!item || !("handler" in item)) throw new Error("expected a menu entry");
            item.handler?.(item, {} as never);
        }
    });
});

describe("Board item context menu", () => {
    afterEach(() => vi.restoreAllMocks());

    /**
     * The two entries a card is worked on with come first; the other ways of opening it fold into
     * one submenu behind them.
     */
    it("leads with quick edit, the title editor and the open submenu", () => {
        const api = {
            columns: [],
            isColumnArchived: () => false,
            getColumnIcon: () => DEFAULT_COLUMN_ICON,
            getColumnColorClass: () => ""
        } as unknown as BoardApi;

        const leading = openItemMenu(api).slice(0, 3);

        expect(leading.map(item => item && "title" in item ? item.title : "")).toEqual([
            "Quick edit", "board_view.edit-title", "Open note"
        ]);
        // The key that opens the same popup for the card the cursor stands on.
        expect(leading[0]).toMatchObject({ shortcut: "Space" });
    });

    /** The same editor F2 opens, for a reader who came to the card with the mouse. */
    it("opens the card's title editor", () => {
        const api = {
            columns: [],
            isColumnArchived: () => false,
            getColumnIcon: () => DEFAULT_COLUMN_ICON,
            getColumnColorClass: () => "",
            startEditing: vi.fn()
        } as unknown as BoardApi;

        const entry = openItemMenu(api).find(item =>
            item && "uiIcon" in item && item.uiIcon === "bx bx-rename");
        if (!entry || !("handler" in entry)) throw new Error("expected an edit-title entry");
        expect("shortcut" in entry && entry.shortcut).toBe("F2");

        entry.handler?.(entry, {} as never);
        expect(api.startEditing).toHaveBeenCalledWith("branchId");
    });

    /** The card is named in a field opened where it goes, so the menu only says where that is. */
    it("opens the field for a card on either side of the one it was opened on", () => {
        const api = {
            columns: [],
            isColumnArchived: () => false,
            getColumnIcon: () => DEFAULT_COLUMN_ICON,
            getColumnColorClass: () => ""
        } as unknown as BoardApi;
        const insert = vi.fn();
        const items = openItemMenu(api, "To Do", vi.fn(), insert, 2);

        for (const icon of [ "bx bx-list-plus", "bx bx-empty" ]) {
            const entry = items.find(item => item && "uiIcon" in item && item.uiIcon === icon);
            if (!entry || !("handler" in entry)) throw new Error(`expected a ${icon} entry`);
            entry.handler?.(entry, {} as never);
        }

        // The field stands where the card it makes goes: in this card's place, or after it.
        expect(insert.mock.calls.map(call => call[0])).toEqual([ 2, 3 ]);
    });

    /** Where Ctrl+Home sends it, for a reader who reached the card with the mouse. */
    it("sends a card to the head of its column, and keeps the focus on it", () => {
        const api = {
            columns: [],
            isColumnArchived: () => false,
            getColumnIcon: () => DEFAULT_COLUMN_ICON,
            getColumnColorClass: () => "",
            moveToColumnStart: vi.fn(async () => {})
        } as unknown as BoardApi;
        const focusCard = vi.fn();

        const entry = openItemMenu(api, "To Do", focusCard).find(item =>
            item && "uiIcon" in item && item.uiIcon === "bx bx-vertical-top");
        if (!entry || !("handler" in entry)) throw new Error("expected a move-to-top entry");
        expect("shortcut" in entry && entry.shortcut).toBe("Ctrl+Home");

        entry.handler?.(entry, {} as never);
        expect(api.moveToColumnStart).toHaveBeenCalledWith(
            expect.any(String), "branchId", "To Do");
        expect(focusCard).toHaveBeenCalled();
    });

    /** The two inserts and the copy made below them, under the divider that heads the group. */
    it("lists the places a card is put, and the copy of it, in one group", () => {
        const items = openItemMenu({
            columns: [],
            isColumnArchived: () => false,
            getColumnIcon: () => DEFAULT_COLUMN_ICON,
            getColumnColorClass: () => "",
            isFirstInColumn: () => true
        } as unknown as BoardApi);

        const at = lastOfLeadingGroup(items);
        expect(items[at + 1]).toMatchObject({ kind: "separator" });
        expect(items.slice(at + 2, at + 5).map(item =>
            item && "uiIcon" in item ? item.uiIcon : undefined))
            .toEqual([ "bx bx-list-plus", "bx bx-empty", "bx bx-outline" ]);
    });

    it("says nothing about moving up the card already at the head", () => {
        const api = {
            columns: [],
            isColumnArchived: () => false,
            getColumnIcon: () => DEFAULT_COLUMN_ICON,
            getColumnColorClass: () => "",
            isFirstInColumn: () => true
        } as unknown as BoardApi;

        expect(openItemMenu(api).some(item =>
            item && "uiIcon" in item && item.uiIcon === "bx bx-vertical-top")).toBe(false);
    });

    /**
     * A sorted column decides where its cards go, so the entries that name a place would promise
     * something the column would not do.
     */
    it("offers no place to insert at, and no move to the head, in a sorted column", () => {
        const api = {
            columns: [],
            isColumnArchived: () => false,
            getColumnIcon: () => DEFAULT_COLUMN_ICON,
            getColumnColorClass: () => "",
            isColumnSorted: () => true,
            isFirstInColumn: () => false
        } as unknown as BoardApi;

        const items = openItemMenu(api);
        const icons = items.map(item => (item && "uiIcon" in item ? item.uiIcon : undefined));

        expect(icons).not.toContain("bx bx-list-plus");
        expect(icons).not.toContain("bx bx-vertical-top");
        // What the menu still offers, so the gate is about the places alone.
        expect(icons).toContain("bx bx-rename");
        expect(icons).toContain("bx bx-outline");

        // The field at the foot of the column and the copy are what the group has left.
        const at = lastOfLeadingGroup(items);
        expect(items[at + 1]).toMatchObject({ kind: "separator" });
        expect(items[at + 2]).toMatchObject({ title: "board_view.insert-new" });
        expect(items[at + 3]).toMatchObject({ uiIcon: "bx bx-outline" });
        expect(items[at + 4]).toMatchObject({ kind: "header" });
    });

    /** The column names its own cards at the foot, so that is where the menu sends the reader. */
    it("opens the field at the foot of a sorted column", () => {
        const api = {
            columns: [],
            isColumnArchived: () => false,
            getColumnIcon: () => DEFAULT_COLUMN_ICON,
            getColumnColorClass: () => "",
            isColumnSorted: () => true
        } as unknown as BoardApi;
        const newItem = vi.fn();

        const entry = openItemMenu(api, "To Do", vi.fn(), vi.fn(), 2, newItem)
            .find(item => item && "title" in item && item.title === "board_view.insert-new");
        if (!entry || !("handler" in entry)) throw new Error("expected an insert-new entry");

        entry.handler?.(entry, {} as never);
        expect(newItem).toHaveBeenCalled();
    });

    /** Where the entries a card is opened and named with end, which the next group follows. */
    function lastOfLeadingGroup(items: MenuItem<unknown>[]) {
        return items.findIndex(item => item && "title" in item && item.title === "Open note");
    }

    it("copies a card into the board, after the one it was made from", async () => {
        const api = {
            columns: [ "To Do" ],
            isColumnArchived: () => false,
            getColumnIcon: () => DEFAULT_COLUMN_ICON,
            getColumnColorClass: () => "",
            duplicateItem: vi.fn(async () => {})
        } as unknown as BoardApi;

        const entry = openItemMenu(api).find(item =>
            item && "uiIcon" in item && item.uiIcon === "bx bx-outline");
        if (!entry || !("handler" in entry)) throw new Error("expected a duplicate entry");

        await entry.handler?.(entry, {} as never);

        expect(api.duplicateItem).toHaveBeenCalledWith(expect.any(String), "branchId");
    });

    it("takes the card off the board, and deletes it outright", () => {
        const api = {
            columns: [],
            isColumnArchived: () => false,
            getColumnIcon: () => DEFAULT_COLUMN_ICON,
            getColumnColorClass: () => "",
            removeFromBoard: vi.fn()
        } as unknown as BoardApi;
        const deleteNotes = vi.spyOn(branches, "deleteNotes").mockResolvedValue(false);

        for (const icon of [ "bx bx-task-x", "bx bx-trash" ]) {
            const entry = openItemMenu(api)
                .find(item => item && "uiIcon" in item && item.uiIcon === icon);
            if (!entry || !("handler" in entry)) throw new Error(`expected a ${icon} entry`);
            entry.handler?.(entry, {} as never);
        }

        expect(api.removeFromBoard).toHaveBeenCalled();
        expect(deleteNotes).toHaveBeenCalledWith([ "branchId" ], false, false);
    });

    /**
     * The inbox is the column a card with no grouping value stands in, so taking that value away
     * leaves the card there instead of off the board. Deleting the note is what removes it.
     */
    it("offers no way off the board while the inbox column is drawn", () => {
        const api = {
            columns: [],
            isColumnArchived: () => false,
            getColumnIcon: () => DEFAULT_COLUMN_ICON,
            getColumnColorClass: () => "",
            isInboxEnabled: true,
            removeFromBoard: vi.fn()
        } as unknown as BoardApi;

        const items = openItemMenu(api);

        expect(items.find(item => item && "uiIcon" in item && item.uiIcon === "bx bx-task-x"))
            .toBeUndefined();
        // Deleting the note is still offered, since that does take it off the board.
        expect(items.find(item => item && "uiIcon" in item && item.uiIcon === "bx bx-trash"))
            .toBeTruthy();
    });

    /**
     * A board can hold more columns than a menu has screen to stand in, so what does not fit goes
     * behind one entry. The card's own column is listed whatever its place, since the check beside
     * it is what says where the card stands.
     */
    it("lists seven columns and puts the rest behind an entry of their own", () => {
        const columns = [ "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine" ];
        const api = {
            columns,
            isColumnArchived: () => false,
            getColumnIcon: () => DEFAULT_COLUMN_ICON,
            getColumnColorClass: () => "",
            changeColumn: vi.fn()
        } as unknown as BoardApi;

        const listed = statusItems(api, "One");
        expect(names(listed.slice(0, -1))).toEqual(columns.slice(0, 7).map(boxed));

        // Named by its icon: `t()` answers with nothing here, i18next never being initialised.
        const more = listed.at(-1);
        if (!more || !("items" in more) || !more.items) throw new Error("expected a more entry");
        expect("uiIcon" in more && more.uiIcon).toBe("bx bx-dots-horizontal-rounded");
        expect(names(more.items)).toEqual([ "Eight", "Nine" ].map(boxed));

        // The card is in the ninth column, which stands in the menu itself along with the first
        // seven, and is gone from what the entry holds.
        const withNinth = statusItems(api, "Nine");
        expect(names(withNinth.slice(0, -1)))
            .toEqual([ ...columns.slice(0, 7), "Nine" ].map(boxed));
        const rest = withNinth.at(-1);
        if (!rest || !("items" in rest) || !rest.items) throw new Error("expected a more entry");
        expect(names(rest.items)).toEqual([ "Eight" ].map(boxed));

        // Seven of them fit as they are.
        expect(names(statusItems({ ...api, columns: columns.slice(0, 7) } as BoardApi, "One")))
            .toEqual(columns.slice(0, 7).map(boxed));
    });

    /** The titles the menu shows, each name boxed in the span the stylesheet sizes. */
    function names(items: MenuItem<unknown>[]) {
        return items.flatMap(item =>
            item && "title" in item && item.title ? [ item.title ] : []);
    }

    /** A name as the menu writes it, which is what `names` reads back. */
    function boxed(name: string) {
        return `<span class="tn-menu-name">${name}</span>`;
    }

    /**
     * Opens the menu a card offers, and hands back what it was given to show.
     *
     * @param notes the selection the menu writes to, the card the menu was opened on standing
     * first. One note unless a test is about what a selection changes.
     */
    function openItemMenu(
        api: BoardApi, column = "To Do", focusCard = vi.fn(), insert = vi.fn(), index = 2,
        newItem = vi.fn(), notes?: FNote[]) {
        const show = vi.spyOn(contextMenu, "show").mockImplementation(async () => {});
        const event = {
            preventDefault: () => {},
            stopPropagation: () => {},
            pageX: 0,
            pageY: 0
        } as ContextMenuEvent;

        // Every item menu asks what the board calls its grouping field, which attributes the cards
        // show and whether the column sorts itself; a test answers only where that is what it is
        // about.
        const withDefaults = Object.assign(
            {
                getStatusLabel: () => "Status",
                getColumnTitle: (name: string) => name,
                getPromotedAttributes: () => [],
                isFirstInColumn: () => false,
                isColumnSorted: () => false,
                getCardColumn: () => column
            },
            api);
        const selected = notes ?? [ buildNote({ title: "Card" }) as FNote ];
        openNoteContextMenu(withDefaults, event, {
            note: selected[0],
            branchId: "branchId",
            column,
            index,
            notes: selected,
            branchIds: selected.map((_, at) => `branchId${at || ""}`),
            onFocusCard: focusCard,
            onInsert: insert,
            onNewItem: newItem
        });

        return show.mock.calls.at(-1)?.[0].items ?? [];
    }

    /**
     * The values a card shows are set from its own menu, under the columns rather than among them:
     * one heading says which column the card is in, the next what it holds.
     */
    it("offers the attributes the cards show, in a section of their own after the columns", () => {
        const api = {
            columns: [ "To Do" ],
            isColumnArchived: () => false,
            getColumnIcon: () => DEFAULT_COLUMN_ICON,
            getColumnColorClass: () => "",
            getPromotedAttributes: () => [ {
                name: "done",
                definitionName: "label:done",
                type: "label",
                title: "Done",
                labelType: "boolean",
                hidden: false,
                definitionValue: "",
                isOwned: true,
                isInheritable: true
            } ]
        } as unknown as BoardApi;

        const items = openItemMenu(api);
        const at = items.findIndex(item => item && "kind" in item && item.kind === "header"
            && item.title === "attribute_menu.attributes");

        expect(items[at + 1]).toMatchObject({ uiIcon: "bx bx-toggle-left" });
        expect(items.slice(0, at).some(item => item && "title" in item
            && typeof item.title === "string" && item.title.includes("tn-menu-name"))).toBe(true);
    });

    /** Reads the run of column entries the menu puts under its Status header. */
    function statusItems(api: BoardApi, column = "To Do") {
        const items = openItemMenu(api, column);
        const header = items.findIndex(item => item && "kind" in item && item.kind === "header");
        if (header < 0) throw new Error("expected a Status header");

        const rest = items.slice(header + 1);
        const end = rest.findIndex(item => item && "kind" in item && item.kind === "separator");
        return rest.slice(0, end < 0 ? rest.length : end);
    }

    /**
     * The columns stand in the menu itself rather than behind a submenu, so a card is filed in one
     * press. The one it is already under is shown too, ticked, so the list reads as the whole set.
     */
    it("offers every column under a Status header, ticking the one the card is under", () => {
        const api = {
            columns: [ "To Do", "Done" ],
            isColumnArchived: () => false,
            getColumnIcon: () => DEFAULT_COLUMN_ICON,
            getColumnColorClass: () => "",
            changeColumn: vi.fn(async () => {})
        } as unknown as BoardApi;

        const columns = statusItems(api);

        // Each name sits in a box of its own, which is what the stylesheet sizes.
        expect(columns.map(item => item && "title" in item ? item.title : undefined)).toEqual([
            '<span class="tn-menu-name">To Do</span>',
            '<span class="tn-menu-name">Done</span>'
        ]);
        // The tick goes at the trailing edge, leaving each column's own icon where it stands.
        expect(columns.map(item => item && "trailingIcon" in item ? item.trailingIcon : undefined))
            .toEqual([ "bx bx-check", undefined ]);
        // And the one the card is under carries the class the stylesheet weights it by.
        expect(columns.map(item => item && "className" in item ? item.className : undefined))
            .toEqual([ "board-current-column", undefined ]);

        const done = columns[1];
        if (done && "handler" in done) done.handler?.(done, {} as never);
        expect(api.changeColumn).toHaveBeenCalledWith(expect.any(String), "Done");
    });

    /** The card is drawn afresh under the column it lands in, so focus is asked for by name. */
    it("keeps focus on the card it files, as a move by keyboard does", () => {
        const api = {
            columns: [ "To Do", "Done" ],
            isColumnArchived: () => false,
            getColumnIcon: () => DEFAULT_COLUMN_ICON,
            getColumnColorClass: () => "",
            changeColumn: vi.fn(async () => {})
        } as unknown as BoardApi;
        const focusCard = vi.fn();

        const items = openItemMenu(api, "To Do", focusCard);
        const header = items.findIndex(item => item && "kind" in item && item.kind === "header");
        const done = items[header + 2];
        if (done && "handler" in done) done.handler?.(done, {} as never);

        expect(focusCard).toHaveBeenCalledWith(expect.any(String));
    });

    /**
     * A column is named by the reader, and the menu reads a title as markup, so a crafted name
     * would otherwise plant whatever it liked in the menu.
     */
    it("escapes a column name rather than letting it stand as markup", () => {
        const api = {
            columns: [ "Done <button id=\"planted\">press</button>" ],
            isColumnArchived: () => false,
            getColumnIcon: () => DEFAULT_COLUMN_ICON,
            getColumnColorClass: () => ""
        } as unknown as BoardApi;

        const [ column ] = statusItems(api);
        const title = column && "title" in column ? column.title : "";

        // The name sits in a box of its own, which is what the width is set on, and nothing of the
        // name itself is left as markup.
        expect(title).toBe('<span class="tn-menu-name">'
            + "Done &lt;button id&#x3D;&quot;planted&quot;&gt;press&lt;&#x2F;button&gt;</span>");
    });

    /** The one the card is under is set apart, which is all the entries are classed for. */
    it("marks the column the card is under", () => {
        const api = {
            columns: [ "To Do", "Done" ],
            isColumnArchived: () => false,
            getColumnIcon: () => DEFAULT_COLUMN_ICON,
            getColumnColorClass: () => ""
        } as unknown as BoardApi;

        expect(statusItems(api)
            .map(item => item && "className" in item ? item.className : undefined))
            .toEqual([ "board-current-column", undefined ]);
    });

    it("shows each column with the icon and colour it carries", () => {
        const api = {
            columns: [ "To Do", "Done" ],
            isColumnArchived: () => false,
            getColumnIcon: (column: string) =>
                column === "Done" ? "bx bx-check-circle" : DEFAULT_COLUMN_ICON,
            getColumnColorClass: (column: string) => column === "Done" ? "use-note-color" : ""
        } as unknown as BoardApi;

        const columns = statusItems(api);

        expect(columns.map(item => item && "uiIcon" in item ? item.uiIcon : undefined))
            .toEqual([ DEFAULT_COLUMN_ICON, "bx bx-check-circle" ]);
        expect(columns
            .map(item => item && "iconColorClass" in item ? item.iconColorClass : undefined))
            .toEqual([ "", "use-note-color" ]);
    });

    it("marks the archived columns among them", () => {
        const api = {
            columns: [ "To Do", "Done" ],
            isColumnArchived: (column: string) => column === "Done",
            getColumnIcon: () => DEFAULT_COLUMN_ICON,
            getColumnColorClass: () => ""
        } as unknown as BoardApi;

        expect(statusItems(api)
            .map(item => !!(item && "badges" in item && item.badges?.length)))
            .toEqual([ false, true ]);
    });

    describe("opened on a selection", () => {
        const columnApi = {
            columns: [ "To Do", "Done" ],
            isColumnArchived: () => false,
            getColumnIcon: () => DEFAULT_COLUMN_ICON,
            getColumnColorClass: () => ""
        } as unknown as BoardApi;

        it("leaves out the entries about one card, and leads with the columns", () => {
            const items = openSelectionMenu(columnApi, [
                buildNote({ title: "One" }), buildNote({ title: "Two" })
            ]);

            // No entries of its own above them, and no divider left standing where they were.
            expect(items[0]).toEqual({ kind: "header", title: "Status" });
            expect(titlesOf(items)).not.toContain("board_view.edit-title");
            expect(titlesOf(items)).not.toContain("board_view.duplicate-item");
            expect(titlesOf(items)).not.toContain("board_view.insert-above");
        });

        it("ticks a column only while every card stands in it", () => {
            const notes = [ buildNote({ title: "One" }), buildNote({ title: "Two" }) ];
            const together = {
                ...columnApi, getCardColumn: () => "Done"
            } as unknown as BoardApi;
            const apart = {
                ...columnApi,
                getCardColumn: (noteId: string) => noteId === notes[0].noteId ? "To Do" : "Done"
            } as unknown as BoardApi;

            expect(marksOf(openSelectionMenu(together, notes)))
                .toEqual([ undefined, "bx bx-check" ]);
            expect(marksOf(openSelectionMenu(apart, notes))).toEqual([ undefined, undefined ]);
        });

        it("files every card under the column picked", async () => {
            const changeColumn = vi.fn();
            const notes = [ buildNote({ title: "One" }), buildNote({ title: "Two" }) ];
            const api = { ...columnApi, changeColumn } as unknown as BoardApi;

            const entry = openSelectionMenu(api, notes)
                .find(item => item && "title" in item && item.title === boxed("Done"));
            if (!entry || !("handler" in entry)) throw new Error("expected the Done entry");
            await entry.handler?.(entry, {} as never);

            expect(changeColumn).toHaveBeenCalledWith(notes[0].noteId, "Done");
            expect(changeColumn).toHaveBeenCalledWith(notes[1].noteId, "Done");
        });

        it("deletes every branch the selection names in one call", () => {
            const deleteNotes = vi.spyOn(branches, "deleteNotes").mockResolvedValue(false);
            const notes = [ buildNote({ title: "One" }), buildNote({ title: "Two" }) ];

            const entry = openSelectionMenu(columnApi, notes)
                .find(item => item && "uiIcon" in item && item.uiIcon === "bx bx-trash");
            if (!entry || !("handler" in entry)) throw new Error("expected the delete entry");
            entry.handler?.(entry, {} as never);

            expect(deleteNotes).toHaveBeenCalledWith([ "branchId", "branchId1" ], false, false);
        });

        /**
         * One entry cannot say what picking it would do while the cards are in different states,
         * and both entries at once would read as two states the same cards are in.
         */
        it("offers archiving only while the cards agree on what they are", () => {
            const plain = buildNote({ title: "One" });
            const archived = buildNote({ title: "Two", "#archived": "" });

            expect(titlesOf(openSelectionMenu(columnApi, [ plain, plain ])))
                .toContain("board_view.archive-note");
            expect(titlesOf(openSelectionMenu(columnApi, [ archived, archived ])))
                .toContain("board_view.unarchive-note");

            const mixed = titlesOf(openSelectionMenu(columnApi, [ plain, archived ]));
            expect(mixed).not.toContain("board_view.archive-note");
            expect(mixed).not.toContain("board_view.unarchive-note");
        });

        /** The menu a selection opens, which is the card menu given more than one note. */
        function openSelectionMenu(api: BoardApi, notes: FNote[]) {
            return openItemMenu(api, "To Do", vi.fn(), vi.fn(), 2, vi.fn(), notes);
        }

        /** The column entries alone, which stand between the Status header and the separator. */
        function columnEntries(items: MenuItem<unknown>[]) {
            const header = items.findIndex(item =>
                item && "kind" in item && item.kind === "header" && item.title === "Status");
            const rest = items.slice(header + 1);
            const end = rest.findIndex(item => item && "kind" in item && item.kind === "separator");
            return rest.slice(0, end < 0 ? rest.length : end);
        }

        function marksOf(items: MenuItem<unknown>[]) {
            return columnEntries(items)
                .map(item => item && "trailingIcon" in item ? item.trailingIcon : undefined);
        }

        function titlesOf(items: MenuItem<unknown>[]) {
            return items.flatMap(item =>
                item && "title" in item && item.title ? [ item.title ] : []);
        }
    });
});

describe("Board context menu", () => {
    afterEach(() => vi.restoreAllMocks());

    /**
     * What the board itself offers, for a press on the ground the columns stand on. The last entry
     * opens what the board is set up with, which the pill inside the field a card is named in
     * opens as well.
     */
    it("offers what the board holds, and a way to how it is set up", () => {
        const show = vi.spyOn(contextMenu, "show").mockImplementation(async () => {});
        const board = {
            archivedShown: false,
            onAddColumn: vi.fn(),
            onCollapseAll: vi.fn(),
            onExpandAll: vi.fn(),
            onShowArchived: vi.fn(),
            onOpenProperties: vi.fn()
        };

        openBoardContextMenu({
            preventDefault: () => {},
            stopPropagation: () => {},
            pageX: 0,
            pageY: 0
        } as ContextMenuEvent, board);

        const items = show.mock.calls.at(-1)?.[0].items ?? [];
        // A separator stands between what the board shows and how it is set up. The inbox column
        // is turned on in the properties dialog, which the last entry opens.
        expect(items.map(item => item && "uiIcon" in item ? item.uiIcon : "---")).toEqual([
            "bx bx-columns", "---",
            "bx bx-collapse-alt", "bx bx-expand-alt", "---",
            "bx bx-archive", "---",
            "bx bx-cog"
        ]);

        const entry = items.at(-1);
        if (!entry || !("handler" in entry)) throw new Error("expected an entry for the properties");
        entry.handler?.(entry, {} as never);
        expect(board.onOpenProperties).toHaveBeenCalled();
    });
});
