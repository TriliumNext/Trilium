import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import contextMenu, { ContextMenuEvent } from "../../../menus/context_menu";
import branches from "../../../services/branches";
import dialog from "../../../services/dialog";
import FNote from "../../../entities/fnote";
import { buildNote } from "../../../test/easy-froca";
import BoardApi from "./api";
import { openColumnContextMenu, openNoteContextMenu } from "./context_menu";

// The card menu opens with the shared link items, which reach for the active note context.
vi.mock("../../../menus/link_context_menu", () => ({
    default: { getItems: () => [], handleLinkContextMenuItem: () => {} }
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
        column: { color?: string, archived?: boolean } = {},
        callbacks: {
            onEditTitle?: () => void,
            onNewItem?: () => void,
            onAddColumn?: (direction: "before" | "after") => void
        } = {}
    ) {
        const show = vi.spyOn(contextMenu, "show").mockImplementation(async () => {});
        const event = {
            preventDefault: () => {},
            stopPropagation: () => {},
            pageX: 0,
            pageY: 0
        } as ContextMenuEvent;

        openColumnContextMenu(api, event, {
            value: "To Do",
            ...column,
            onEditTitle: callbacks.onEditTitle ?? (() => {}),
            onNewItem: callbacks.onNewItem ?? (() => {}),
            onAddColumn: callbacks.onAddColumn ?? (() => {})
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

    it("orders the entries, keeping the safe way out ahead of deleting", () => {
        const titled = openMenu({} as BoardApi).filter(item => item && "uiIcon" in item);
        expect(titled.map(item => "uiIcon" in item ? item.uiIcon : undefined))
            .toEqual([
                "bx bx-edit-alt", "bx bx-plus", "bx bx-link", "bx bx-columns",
                "bx bx-archive", "bx bx-trash"
            ]);
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

    it("asks before deleting a column, and drops it only once agreed", async () => {
        const api = { removeColumn: vi.fn(async () => {}) } as unknown as BoardApi;
        const confirm = vi.spyOn(dialog, "confirm").mockResolvedValue(false);

        const entry = openMenu(api)
            .find(item => item && "uiIcon" in item && item.uiIcon === "bx bx-trash");
        if (!entry || !("handler" in entry)) throw new Error("expected a delete entry");

        await entry.handler?.(entry, {} as never);
        expect(confirm).toHaveBeenCalled();
        expect(api.removeColumn).not.toHaveBeenCalled();

        confirm.mockResolvedValue(true);
        await entry.handler?.(entry, {} as never);
        expect(api.removeColumn).toHaveBeenCalledWith("To Do");
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
});

describe("Board item context menu", () => {
    afterEach(() => vi.restoreAllMocks());


    it("inserts a card on either side of the one it was opened on", () => {
        const api = {
            columns: [],
            isColumnArchived: () => false,
            insertRowAtPosition: vi.fn(async () => {})
        } as unknown as BoardApi;
        const items = openItemMenu(api);

        for (const icon of [ "bx bx-list-plus", "bx bx-empty" ]) {
            const entry = items.find(item => item && "uiIcon" in item && item.uiIcon === icon);
            if (!entry || !("handler" in entry)) throw new Error(`expected a ${icon} entry`);
            entry.handler?.(entry, {} as never);
        }

        expect(vi.mocked(api.insertRowAtPosition).mock.calls.map(call => call[2]))
            .toEqual([ "before", "after" ]);
    });

    it("moves the card to the column picked, leaving the one it is in unselectable", () => {
        const api = {
            columns: [ "To Do", "Done" ],
            isColumnArchived: () => false,
            changeColumn: vi.fn(async () => {})
        } as unknown as BoardApi;

        const moveTo = openItemMenu(api)
            .find(item => item && "uiIcon" in item && item.uiIcon === "bx bx-transfer");
        if (!moveTo || !("items" in moveTo)) throw new Error("expected a move-to entry");

        const sides = moveTo.items ?? [];
        expect(sides.map(item => item && "enabled" in item ? item.enabled : undefined))
            .toEqual([ false, true ]);

        const done = sides[1];
        if (done && "handler" in done) done.handler?.(done, {} as never);
        expect(api.changeColumn).toHaveBeenCalledWith(expect.any(String), "Done");
    });

    it("takes the card off the board, and deletes it outright", () => {
        const api = {
            columns: [],
            isColumnArchived: () => false,
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

    /** Opens the menu a card offers, and hands back what it was given to show. */
    function openItemMenu(api: BoardApi) {
        const show = vi.spyOn(contextMenu, "show").mockImplementation(async () => {});
        const event = {
            preventDefault: () => {},
            stopPropagation: () => {},
            pageX: 0,
            pageY: 0
        } as ContextMenuEvent;

        openNoteContextMenu(api, event, buildNote({ title: "Card" }) as FNote, "branchId", "To Do");

        return show.mock.calls.at(-1)?.[0].items ?? [];
    }

    it("marks the archived columns it offers to move a card to", () => {
        const api = {
            columns: [ "To Do", "Done" ],
            isColumnArchived: (column: string) => column === "Done"
        } as unknown as BoardApi;

        const moveTo = openItemMenu(api).find(item =>
            item && "uiIcon" in item && item.uiIcon === "bx bx-transfer");
        if (!moveTo || !("items" in moveTo)) throw new Error("expected a move-to entry");

        // Presence rather than wording: i18next is never initialised under test, so every title is
        // undefined and asserting the text would prove nothing.
        expect((moveTo.items ?? [])
            .map(item => !!(item && "badges" in item && item.badges?.length)))
            .toEqual([ false, true ]);
    });
});
