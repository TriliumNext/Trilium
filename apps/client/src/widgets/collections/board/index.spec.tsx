/**
 * Regression test for #10689: a newly added board column is persisted but not rendered until the
 * view is re-entered, and a subsequent column reorder then deletes it again.
 */
import $ from "jquery";
import { render } from "preact";
import { useCallback, useEffect, useState } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Modal as BootstrapModal } from "bootstrap";

import Component from "../../../components/component";
import contextMenu from "../../../menus/context_menu";
import dialog from "../../../services/dialog";
import server from "../../../services/server";
import toast from "../../../services/toast";
import FBranch from "../../../entities/fbranch";
import froca from "../../../services/froca";
import attributes from "../../../services/attributes";
import { executeBulkActions } from "../../../services/bulk_action";
import LoadResults from "../../../services/load_results";
import { buildNote } from "../../../test/easy-froca";
import { ParentComponent } from "../../react/react_utils";
import BoardView, { BoardViewData } from ".";
import { getNoteTypeOptions, type NoteTypeOption } from "../../../services/note_types";
import { collectShortcutHints } from "../../../services/shortcut_hints";
import BoardApi, { getPendingWrites } from "./api";
import { DEFAULT_COLUMN_ICON } from "./columns";

// Stands in for the server: by the time the bulk action resolves, the notes carry the new value,
// which is what makes the old column empty rather than merely renamed.
vi.mock("../../../services/i18n", () => ({
    // i18next is never initialised under test, so a stock name the board writes would be undefined.
    // What is interpolated is carried along, for the strings a test is about.
    t: (key: string, opts?: Record<string, unknown>) =>
        opts ? `${key}:${JSON.stringify(opts)}` : key,
    // Awaited by whatever waits for the catalogue; a mock without it rejects where it is read.
    translationsInitializedPromise: $.Deferred().resolve()
}));

// The picker is a Bootstrap dropdown portalled to the page, which happy-dom does not open. What the
// board answers for is the icon it shows and what it does with a pick, so the button stands in for
// the picker and hands one over when it is pressed.
// What a card can be made from. The listing itself is the app's and is tested there; the board is
// handed a short list of it, the four it offers by default and one it does not.
vi.mock("../../../services/note_types", () => ({
    getNoteTypeOptions: vi.fn(async () => {
        templateReads++;
        return NOTE_TYPE_OPTIONS;
    }),
    resolveNoteTypeOptions: (ids: string[], available: { id: string }[]) =>
        ids.flatMap(id => available.filter(option => option.id === id)),
    noteTypeOptionGroupTitle: (group: string) => `group:${group}`,
    default: {}
}));

/** How many times the board has asked what a card can be made from. */
let templateReads = 0;

const NOTE_TYPE_OPTIONS = [
    [ "type:text:text/html", "Text", "text", "text/html" ],
    [ "type:code:text/x-markdown", "Markdown", "code", "text/x-markdown" ],
    [ "type:canvas:application/json", "Canvas", "canvas", "application/json" ],
    [ "type:spreadsheet:application/json", "Spreadsheet", "spreadsheet", "application/json" ],
    [ "type:mermaid:text/mermaid", "Mermaid", "mermaid", "text/mermaid" ]
].map(([ id, title, type, mime ]) => ({
    id, title, icon: "bx bx-note", group: "type" as const, options: { type, mime }
})) as NoteTypeOption[];

vi.mock("../../react/IconPicker", () => ({
    IconPickerButton: ({ className, icon, onSelect, onOpened, onClosed }: {
        className?: string, icon: string, onSelect: (picked: string) => void,
        onOpened?: () => void, onClosed?: () => void
    }) => (
        <span className={className}>
            <button className={icon} onClick={() => {
                onOpened?.();
                onSelect(PICKED_ICON);
                onClosed?.();
            }} />
            {/* The picker opening and closing on their own, for what the editor does in between.
                Not buttons: a host counting the buttons its picker draws would count these too. */}
            <span className="picker-open" onClick={() => onOpened?.()} />
            <span className="picker-close" onClick={() => onClosed?.()} />
        </span>
    )
}));

/** What the picker hands over when it is pressed under test. */
const PICKED_ICON = "bx bx-star";

vi.mock("../../../services/bulk_action", () => ({
    executeBulkActions: vi.fn(async (
        noteIds: string[],
        actions: { name: string, labelName?: string, labelValue?: string }[]
    ) => {
        for (const noteId of noteIds) {
            for (const attribute of froca.getNoteFromCache(noteId)?.getAttributes() ?? []) {
                for (const action of actions) {
                    if (action.name === "updateLabelValue" && attribute.name === action.labelName) {
                        attribute.value = action.labelValue ?? "";
                    }
                }
            }
        }
    })
}));

/** What a card is made from until another template is picked: the first the board offers. */
function textTemplate() {
    return expect.objectContaining({ id: "type:text:text/html" });
}

/** Drains the async chain inside `refresh()` (getBoardData → setByColumn/setColumns). */
async function flush() {
    await new Promise((resolve) => setTimeout(resolve));
}

/** Fills a field the way typing does, so that what watches the field hears about it. */
async function type(field: HTMLInputElement | HTMLTextAreaElement, value: string) {
    await act(async () => {
        field.value = value;
        field.dispatchEvent(new Event("input", { bubbles: true }));
    });
}

const saved: BoardViewData[] = [];

/**
 * Mirrors how `useViewModeConfig` feeds the board: `saveConfig` publishes a *new wrapper* around the
 * config it was handed, so the `viewConfig` prop only changes identity if the caller passed a new
 * object. That is exactly the condition the board's refresh effect depends on.
 */
function Harness({ note, noteIds, initialConfig }: { note: ReturnType<typeof buildNote>, noteIds: string[], initialConfig: BoardViewData }) {
    const [ state, setState ] = useState<{ config: BoardViewData }>({ config: initialConfig });
    const saveConfig = useCallback((config: BoardViewData) => {
        saved.push(config);
        setState({ config });
    }, []);

    // `useViewModeConfig` restores the config of whichever note it is handed, so a board shown
    // after another starts from its own. The board itself is not remounted, which is the point.
    useEffect(() => {
        setState({ config: initialConfig });
    }, [ note ]);

    return (
        <BoardView
            note={note}
            notePath={`root/${note.noteId}`}
            noteIds={noteIds}
            highlightedTokens={null}
            viewConfig={state.config}
            saveConfig={saveConfig}
            media="screen"
            onReady={() => {}}
        />
    );
}

/** Files a fresh note under the board, the way an import or another client's write reaches it. */
function addCard(board: ReturnType<typeof buildNote>, status: string) {
    return fileCard(board, buildNote({ title: "Added", "#status": status }));
}

/** Takes a card off the board, the way carrying it to another one does. */
function unfileCard(board: ReturnType<typeof buildNote>, card: ReturnType<typeof buildNote>) {
    delete froca.branches[`${board.noteId}_${card.noteId}`];
    delete board.childToBranch[card.noteId];
    board.children = board.children.filter(noteId => noteId !== card.noteId);
}

/** Puts a note the test already holds under the board, for one made before it is filed. */
function fileCard(board: ReturnType<typeof buildNote>, card: ReturnType<typeof buildNote>) {
    const branchId = `${board.noteId}_${card.noteId}`;

    froca.branches[branchId] = new FBranch(froca, {
        branchId,
        notePosition: 100,
        fromSearchNote: false,
        noteId: card.noteId,
        parentNoteId: board.noteId
    });
    board.addChild(card.noteId, branchId, false);
    return card;
}

/** Opens the title editor the way the keyboard does, the menu entry needing a rendered menu. */
function startEditingTitle(column: HTMLElement) {
    column.querySelector("h3")
        ?.dispatchEvent(new KeyboardEvent("keydown", { key: "F2", bubbles: true }));
}

/** The icon class each column header wears, which is the class its picker button carries. */
function columnIcons(container: HTMLElement) {
    return [ ...container.querySelectorAll(".board-column h3 > .column-icon button") ]
        .map(el => [ ...el.classList ].filter(name => name.startsWith("bx")).join(" "));
}

function columnTitles(container: HTMLElement) {
    return [ ...container.querySelectorAll(".board-column h3 .title") ].map(el => el.textContent);
}

describe("Collapsed board columns", () => {
    let container: HTMLElement | undefined;

    afterEach(() => {
        vi.useRealTimers();
        saved.length = 0;
        if (container) {
            render(null, container);
            container.remove();
            container = undefined;
        }
    });

    /** A board whose first column is stored collapsed and holds two cards. */
    async function setup({ keepCollapsed = false } = {}) {
        const note = buildNote({
            title: "Board",
            "#collection": "",
            "#viewType": "board",
            children: [
                { id: "card1", title: "First", "#status": "To Do" },
                { id: "card2", title: "Second", "#status": "To Do" },
                { id: "card3", title: "Third", "#status": "Done" }
            ]
        });
        const host = new Component();
        const mountPoint = document.createElement("div");
        container = mountPoint;
        document.body.appendChild(mountPoint);

        await act(async () => {
            render(
                <ParentComponent.Provider value={host}>
                    <Harness
                        note={note}
                        noteIds={[ ...note.getChildNoteIds() ]}
                        initialConfig={{ columns: [
                            { value: "To Do", collapsed: true, ...(keepCollapsed
                                ? { keepCollapsed: true }
                                : {}) },
                            { value: "Done" }
                        ] }}
                    />
                </ParentComponent.Provider>,
                mountPoint
            );
        });
        await act(async () => { await flush(); });

        return { mountPoint };
    }

    const columnAt = (container: HTMLElement, index: number) =>
        [ ...container.querySelectorAll(".board-column") ][index] as HTMLElement;

    const isCollapsed = (container: HTMLElement, index: number) =>
        columnAt(container, index).classList.contains("collapsed");

    const cardCount = (container: HTMLElement, index: number) =>
        columnAt(container, index).querySelectorAll(".board-note").length;

    /** Selects a column the way a click on it does, press and release included. */
    async function select(container: HTMLElement, index: number) {
        const column = columnAt(container, index);
        await act(async () => {
            column.dispatchEvent(new Event("pointerdown", { bubbles: true }));
            document.dispatchEvent(new Event("pointerup", { bubbles: true }));
            column.dispatchEvent(new Event("click", { bubbles: true }));
        });
    }

    /** Takes hold of the header and drags it, which is how a column is moved. */
    async function dragHeader(container: HTMLElement, index: number) {
        const header = columnAt(container, index).querySelector("h3");
        await act(async () => {
            header?.dispatchEvent(new Event("pointerdown", { bubbles: true }));
            header?.dispatchEvent(new Event("focusin", { bubbles: true }));
            header?.dispatchEvent(new Event("dragstart", { bubbles: true }));
        });
    }

    it("draws a stored collapsed column as a strip without its cards", async () => {
        const { mountPoint } = await setup();

        expect(isCollapsed(mountPoint, 0)).toBe(true);
        expect(cardCount(mountPoint, 0)).toBe(0);
        // The count is what the strip reports in place of the cards.
        expect(columnAt(mountPoint, 0).querySelector(".counter-badge")?.textContent).toBe("2");

        // Every other column is untouched.
        expect(isCollapsed(mountPoint, 1)).toBe(false);
        expect(cardCount(mountPoint, 1)).toBe(1);
    });

    it("opens the column when it is selected and closes it when another one is", async () => {
        const { mountPoint } = await setup({ keepCollapsed: true });

        await select(mountPoint, 0);
        expect(isCollapsed(mountPoint, 0)).toBe(false);
        expect(cardCount(mountPoint, 0)).toBe(2);

        await select(mountPoint, 1);
        expect(isCollapsed(mountPoint, 0)).toBe(true);
        expect(cardCount(mountPoint, 0)).toBe(0);
    });

    /**
     * The strip is what the reader takes hold of to move the column, so opening it under the
     * pointer would both hide what is being dragged and drag the opened column instead.
     */
    it("stays closed while its header is dragged", async () => {
        const { mountPoint } = await setup();

        await dragHeader(mountPoint, 0);
        expect(isCollapsed(mountPoint, 0)).toBe(true);

        // The drag ends without a `pointerup`, and the column still opens on the next click.
        await act(async () => {
            columnAt(mountPoint, 0).querySelector("h3")
                ?.dispatchEvent(new Event("dragend", { bubbles: true }));
        });
        await select(mountPoint, 0);
        expect(isCollapsed(mountPoint, 0)).toBe(false);
    });

    /**
     * A collapsed column draws none of its cards, so nothing but the header is left to announce.
     * It says it opens something and what state that is in, rather than reading as a heading with
     * no way past it.
     */
    it("announces the strip as a control that opens the column", async () => {
        const { mountPoint } = await setup();
        const header = () => columnAt(mountPoint, 0).querySelector("h3");

        expect(header()?.getAttribute("role")).toBe("button");
        expect(header()?.getAttribute("aria-expanded")).toBe("false");

        // Open, it is a heading again: Space does nothing there, so no button is promised.
        await select(mountPoint, 0);
        expect(header()?.getAttribute("role")).toBeNull();
        expect(header()?.getAttribute("aria-expanded")).toBeNull();

        // A column that was never collapsed says nothing either way.
        expect(columnAt(mountPoint, 1).querySelector("h3")?.getAttribute("role")).toBeNull();
    });

    /** The header is walked onto without opening the column, which Space is for. */
    it("leaves the column closed when focus reaches its header", async () => {
        const { mountPoint } = await setup();

        await act(async () => {
            columnAt(mountPoint, 0).querySelector("h3")
                ?.dispatchEvent(new Event("focusin", { bubbles: true }));
        });

        expect(isCollapsed(mountPoint, 0)).toBe(true);
    });

    it("closes an open column when focus reaches another one", async () => {
        const { mountPoint } = await setup({ keepCollapsed: true });

        await select(mountPoint, 0);
        expect(isCollapsed(mountPoint, 0)).toBe(false);

        await act(async () => {
            columnAt(mountPoint, 1).querySelector("h3")
                ?.dispatchEvent(new Event("focusin", { bubbles: true }));
        });

        expect(isCollapsed(mountPoint, 0)).toBe(true);
    });

    /**
     * The limit dialog, the icon picker and the context menu all render outside the column, so
     * focus leaving it is not a reason to close it. Only another column being selected is.
     */
    it("stays open while a control rendered outside it is used", async () => {
        const { mountPoint } = await setup({ keepCollapsed: true });

        await select(mountPoint, 0);
        expect(isCollapsed(mountPoint, 0)).toBe(false);

        // What opening a portalled dialog does to the column: focus goes somewhere else entirely.
        const elsewhere = document.createElement("button");
        document.body.appendChild(elsewhere);
        await act(async () => {
            columnAt(mountPoint, 0)
                .dispatchEvent(new Event("focusout", { bubbles: true }));
            elsewhere.dispatchEvent(new Event("pointerdown", { bubbles: true }));
        });
        elsewhere.remove();

        expect(isCollapsed(mountPoint, 0)).toBe(false);
    });

    /**
     * A column collapsed by hand is opened by hand, the way it is in most boards: the stored flag
     * goes with the open, so the column does not shut again the moment another one is selected.
     */
    it("opens a collapsed column for good, clearing the stored flag", async () => {
        const { mountPoint } = await setup();

        await select(mountPoint, 0);
        expect(isCollapsed(mountPoint, 0)).toBe(false);
        expect(saved.at(-1)?.columns?.[0]).toEqual({ value: "To Do" });

        // Selecting another one no longer takes it back.
        await select(mountPoint, 1);
        expect(isCollapsed(mountPoint, 0)).toBe(false);
    });

    /**
     * The cards are laid out again on every frame of the widening, so they are held unpainted
     * until it is over. A column opened to take a dragged card shows them at once.
     */
    it("holds the cards unpainted while the column widens", async () => {
        const { mountPoint } = await setup();

        await select(mountPoint, 0);
        const column = columnAt(mountPoint, 0);
        expect(column.classList.contains("expanding")).toBe(true);
        // Drawn all the same, so the board can hand focus to one of them.
        expect(cardCount(mountPoint, 0)).toBe(2);

        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 350));
        });
        expect(columnAt(mountPoint, 0).classList.contains("expanding")).toBe(false);
    });

    /** The reverse of the collapse, for the open the reader asked for. */
    it("marks an open the reader asked for", async () => {
        const { mountPoint } = await setup();
        expect(columnAt(mountPoint, 0).classList.contains("quick-expand")).toBe(false);

        await select(mountPoint, 0);
        expect(columnAt(mountPoint, 0).classList.contains("quick-expand")).toBe(true);
    });

    /**
     * A peek closes behind the pointer, with the columns beside it shifting under it, so it eases
     * shut; a collapse the reader asked for surprises nobody and runs faster.
     */
    it("marks a collapse the reader asked for, and leaves a peek closing unmarked", async () => {
        const { mountPoint } = await setup({ keepCollapsed: true });

        await select(mountPoint, 0);
        await act(async () => {
            columnAt(mountPoint, 0).querySelector("h3")
                ?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, detail: 2 }));
            await flush();
        });
        expect(isCollapsed(mountPoint, 0)).toBe(true);
        expect(columnAt(mountPoint, 0).classList.contains("quick-collapse")).toBe(true);

        // Opened again, what closes it is the peek, which is not the reader asking for it.
        await select(mountPoint, 0);
        expect(columnAt(mountPoint, 0).classList.contains("quick-collapse")).toBe(false);

        await select(mountPoint, 1);
        expect(isCollapsed(mountPoint, 0)).toBe(true);
        expect(columnAt(mountPoint, 0).classList.contains("quick-collapse")).toBe(false);
    });

    /**
     * The reader is looking at the open column when the entry is unchecked, so the column stays
     * open: shutting it the moment another one is selected would read as the entry doing nothing.
     */
    it("keeps a peeked column open once it is no longer kept collapsed", async () => {
        const { mountPoint } = await setup({ keepCollapsed: true });

        await select(mountPoint, 0);
        expect(isCollapsed(mountPoint, 0)).toBe(false);

        const show = vi.spyOn(contextMenu, "show").mockImplementation(async () => {});
        columnAt(mountPoint, 0).querySelector("h3")
            ?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
        const entry = (show.mock.calls.at(-1)?.[0].items ?? []).find(item =>
            item && "uiIcon" in item && item.uiIcon === "bx bx-lock-alt");
        if (!entry || !("handler" in entry)) throw new Error("expected a keep-collapsed entry");

        await act(async () => {
            entry.handler?.(entry, {} as never);
            await flush();
        });
        show.mockRestore();

        expect(saved.at(-1)?.columns?.[0]).toEqual({ value: "To Do" });
        await select(mountPoint, 1);
        expect(isCollapsed(mountPoint, 0)).toBe(false);
    });

    /**
     * The board's own menu, for a press on the ground the columns stand on. Expanding shows every
     * column at once; a column that is kept collapsed is only peeked, and closes as the reader
     * settles on one column, which is what a single peek does.
     */
    it("collapses and expands every column from the board's menu", async () => {
        const { mountPoint } = await setup({ keepCollapsed: true });
        const board = mountPoint.querySelector<HTMLElement>(".board-view-container");
        const show = vi.spyOn(contextMenu, "show").mockImplementation(async () => {});

        // With a column open, which the collapse has to close along with the rest.
        await select(mountPoint, 1);
        board?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
        const entries = (show.mock.calls.at(-1)?.[0].items ?? []).flatMap(item =>
            item && "uiIcon" in item && "handler" in item
                ? [ { icon: item.uiIcon, handler: item.handler } ]
                : []);
        expect(entries.map(entry => entry.icon)).toEqual([
            "bx bx-columns", "bx bx-collapse-alt", "bx bx-expand-alt",
            "bx bx-archive", "bx bx-cog"
        ]);
        const entry = (icon: string) => entries.find(item => item.icon === icon)?.handler;

        await act(async () => {
            entry("bx bx-collapse-alt")?.({} as never, {} as never);
            await flush();
        });
        expect(isCollapsed(mountPoint, 0)).toBe(true);
        expect(isCollapsed(mountPoint, 1)).toBe(true);
        expect(saved.at(-1)?.columns?.map(column => column.collapsed)).toEqual([ true, true ]);

        await act(async () => {
            entry("bx bx-expand-alt")?.({} as never, {} as never);
            await flush();
        });
        expect(isCollapsed(mountPoint, 0)).toBe(false);
        expect(isCollapsed(mountPoint, 1)).toBe(false);
        // The one kept collapsed keeps the flag, and shuts again as soon as a column is selected.
        expect(saved.at(-1)?.columns?.map(column => column.collapsed))
            .toEqual([ true, undefined ]);

        await select(mountPoint, 1);
        expect(isCollapsed(mountPoint, 0)).toBe(true);
        expect(isCollapsed(mountPoint, 1)).toBe(false);

        show.mockRestore();
    });

    /**
     * A press on a card is focus arriving before it is a click, and while the whole board is peeked
     * every column reads as inactive. The column pressed in keeps its peek; the rest give theirs up.
     */
    it("settles a board-wide peek on the column pressed in", async () => {
        const { mountPoint } = await setup({ keepCollapsed: true });
        const board = mountPoint.querySelector<HTMLElement>(".board-view-container");
        const show = vi.spyOn(contextMenu, "show").mockImplementation(async () => {});

        board?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
        const expand = (show.mock.calls.at(-1)?.[0].items ?? []).find(item =>
            item && "uiIcon" in item && item.uiIcon === "bx bx-expand-alt");
        if (!expand || !("handler" in expand)) throw new Error("expected an expand entry");

        await act(async () => {
            expand.handler?.(expand, {} as never);
            await flush();
        });
        expect(isCollapsed(mountPoint, 0)).toBe(false);

        // Focus landing on one of its cards, which is what a press on a card does first.
        await act(async () => {
            columnAt(mountPoint, 0).querySelector(".board-note")
                ?.dispatchEvent(new Event("focusin", { bubbles: true }));
            await flush();
        });
        expect(isCollapsed(mountPoint, 0)).toBe(false);

        // And the peek is this column's alone: focus reaching another one closes it as usual.
        await act(async () => {
            columnAt(mountPoint, 1).querySelector("h3")
                ?.dispatchEvent(new Event("focusin", { bubbles: true }));
            await flush();
        });
        expect(isCollapsed(mountPoint, 0)).toBe(true);

        show.mockRestore();
    });

    /**
     * The board's own menu offers what the board is as well as what it does: an editor for a new
     * column, and the two settings that decide which columns and cards it draws at all.
     */
    it("opens the column editor and toggles what the board shows, from its menu", async () => {
        const { mountPoint } = await setup();
        const board = mountPoint.querySelector<HTMLElement>(".board-view-container");
        const archived = vi.spyOn(BoardApi.prototype, "setArchivedShown")
            .mockResolvedValue(undefined);
        const show = vi.spyOn(contextMenu, "show").mockImplementation(async () => {});

        board?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
        const items = show.mock.calls.at(-1)?.[0].items ?? [];
        const entry = (icon: string) => {
            const found = items.find(item => item && "uiIcon" in item && item.uiIcon === icon);
            if (!found || !("handler" in found)) throw new Error(`expected a ${icon} entry`);
            return found;
        };

        // Archived notes are not shown, so the entry is not ticked, and pressing it asks for them.
        // The inbox column is turned on in the properties dialog rather than here.
        expect("trailingIcon" in entry("bx bx-archive") && entry("bx bx-archive").trailingIcon)
            .toBeUndefined();
        entry("bx bx-archive").handler?.(entry("bx bx-archive"), {} as never);
        expect(archived).toHaveBeenCalledWith(true);

        // The same editor the slot at the end of the board opens.
        expect(mountPoint.querySelector(".board-add-column input")).toBeNull();
        await act(async () => {
            entry("bx bx-columns").handler?.(entry("bx bx-columns"), {} as never);
            await flush();
        });
        expect(mountPoint.querySelector(".board-add-column input")).toBeTruthy();

        show.mockRestore();
        archived.mockRestore();
    });

    /** A column and a card answer for their own presses, and the board does not speak over them. */
    it("leaves a press inside a column to the column", async () => {
        const { mountPoint } = await setup();
        const show = vi.spyOn(contextMenu, "show").mockImplementation(async () => {});

        columnAt(mountPoint, 1).querySelector(".board-column-content")
            ?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));

        expect(show).not.toHaveBeenCalled();
        show.mockRestore();
    });

    /** The first of the two clicks opens the strip; collapsing it again would undo that. */
    it("leaves a strip open when it is double clicked open", async () => {
        const { mountPoint } = await setup();
        const header = columnAt(mountPoint, 0).querySelector("h3");

        await act(async () => {
            header?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, detail: 1 }));
            header?.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
            await flush();
        });
        await act(async () => {
            header?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, detail: 2 }));
            header?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, detail: 2 }));
            await flush();
        });

        expect(isCollapsed(mountPoint, 0)).toBe(false);
    });

    it("keeps the flag through an open where the column is kept collapsed", async () => {
        const { mountPoint } = await setup({ keepCollapsed: true });

        await select(mountPoint, 0);
        expect(isCollapsed(mountPoint, 0)).toBe(false);
        expect(saved).toEqual([]);
    });

    /**
     * The menu is opened from the column, so that column is the open one. Storing the flag alone
     * would change nothing on screen and leave the reader with no sign the entry did anything.
     */
    it("closes the column as soon as the menu entry collapses it", async () => {
        const { mountPoint } = await setup();
        const column = columnAt(mountPoint, 1);
        expect(isCollapsed(mountPoint, 1)).toBe(false);

        await select(mountPoint, 1);
        const show = vi.spyOn(contextMenu, "show").mockImplementation(async () => {});
        column.querySelector("h3")
            ?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));

        const entry = (show.mock.calls.at(-1)?.[0].items ?? []).find(item =>
            item && "uiIcon" in item && item.uiIcon === "bx bx-collapse-horizontal");
        if (!entry || !("handler" in entry)) throw new Error("expected a collapse entry");

        await act(async () => {
            entry.handler?.(entry, {} as never);
            await flush();
        });
        show.mockRestore();

        expect(isCollapsed(mountPoint, 1)).toBe(true);
        expect(saved.at(-1)?.columns?.[1]).toEqual({ value: "Done", collapsed: true });
    });

    /**
     * The board is not drawn afresh for another note, so the column opened on one is still named
     * in its state when the next arrives. A board of its own storing a column under that name
     * would be drawn open, against what it stores.
     */
    it("does not carry an open column over to another board", async () => {
        const { mountPoint } = await setup();

        await select(mountPoint, 0);
        expect(isCollapsed(mountPoint, 0)).toBe(false);

        const other = buildNote({
            title: "Other board",
            "#collection": "",
            "#viewType": "board",
            children: [ { title: "Fourth", "#status": "To Do" } ]
        });
        await act(async () => {
            render(
                <ParentComponent.Provider value={new Component()}>
                    <Harness
                        note={other}
                        noteIds={[ ...other.getChildNoteIds() ]}
                        initialConfig={{ columns: [ { value: "To Do", collapsed: true } ] }}
                    />
                </ParentComponent.Provider>,
                mountPoint
            );
            await flush();
        });
        await act(async () => { await flush(); });

        expect(isCollapsed(mountPoint, 0)).toBe(true);
        expect(cardCount(mountPoint, 0)).toBe(0);
    });

    it("offers no icon picker or title editor while collapsed", async () => {
        const { mountPoint } = await setup();
        const collapsed = columnAt(mountPoint, 0);

        expect(collapsed.querySelector(".column-icon button")).toBeNull();

        startEditingTitle(collapsed);
        await act(async () => { await flush(); });
        expect(collapsed.querySelector("input")).toBeNull();

        // Both come back with the column.
        await select(mountPoint, 0);
        expect(columnAt(mountPoint, 0).querySelector(".column-icon button")).not.toBeNull();
    });
});

describe("A board in a tab the reader is not looking at", () => {
    let container: HTMLElement | undefined;

    afterEach(() => {
        saved.length = 0;
        if (container) {
            render(null, container);
            container.remove();
            container = undefined;
        }
    });

    /**
     * Every mounted board hears every change, so a card renamed once would redraw the board in each
     * tab it is open in. A board nobody is looking at remembers the change instead.
     */
    it("does not redraw for a change while its tab is in the background", async () => {
        const note = buildNote({
            title: "Board",
            "#collection": "",
            "#viewType": "board",
            children: [
                { id: "one", title: "First", "#status": "To Do" },
                { id: "two", title: "Second", "#status": "Done" }
            ]
        });

        // The context the board belongs to, reached the way `useNoteContext` reaches it: from the
        // nearest ancestor carrying one.
        let active = true;
        const host = new Component();
        Object.assign(host, { noteContext: { isActive: () => active } });

        const mountPoint = document.createElement("div");
        container = mountPoint;
        document.body.appendChild(mountPoint);

        const draw = async () => {
            await act(async () => {
                render(
                    <ParentComponent.Provider value={host}>
                        <Harness
                            note={note}
                            noteIds={[ ...note.getChildNoteIds() ]}
                            initialConfig={{ columns: [ { value: "To Do" }, { value: "Done" } ] }}
                        />
                    </ParentComponent.Provider>,
                    mountPoint
                );
            });
            await act(async () => { await flush(); });
        };

        const columnOf = (title: string) => [ ...mountPoint.querySelectorAll(".board-column") ]
            .find(column => [ ...column.querySelectorAll(".board-note") ]
                .some(card => card.textContent?.includes(title)))
            ?.getAttribute("data-column");

        await draw();
        expect(columnOf("First")).toBe("To Do");

        // The card moves column while the tab is in the background.
        active = false;
        for (const attribute of froca.getNoteFromCache("one")?.getAttributes() ?? []) {
            if (attribute.name === "status") attribute.value = "Done";
        }
        await draw();
        expect(columnOf("First")).toBe("To Do");

        // Looked at again, it catches up with what it missed.
        active = true;
        await draw();
        expect(columnOf("First")).toBe("Done");
    });
});

describe("Board column creation", () => {
    let container: HTMLElement | undefined;

    afterEach(() => {
        saved.length = 0;
        if (container) {
            render(null, container);
            container.remove();
            container = undefined;
        }
    });

    async function setup() {
        const note = buildNote({
            title: "Board",
            "#collection": "",
            "#viewType": "board",
            children: [
                { id: "card1", title: "First", "#status": "To Do" },
                { id: "card2", title: "Second", "#status": "Done" }
            ]
        });

        const mountPoint = document.createElement("div");
        container = mountPoint;
        document.body.appendChild(mountPoint);

        await act(async () => {
            render(
                <ParentComponent.Provider value={new Component()}>
                    <Harness note={note} noteIds={[ "card1", "card2" ]} initialConfig={{ columns: [ { value: "To Do" }, { value: "Done" } ] }} />
                </ParentComponent.Provider>,
                mountPoint
            );
        });
        await act(async () => {
            await flush();
        });

        return { note, container: mountPoint };
    }

    /** Clicks "Add column", types a name and commits it with Enter, as the user would. */
    async function addColumn(container: HTMLElement, name: string) {
        await act(async () => {
            container.querySelector<HTMLElement>(".board-add-column")?.click();
            await flush();
        });

        const input = container.querySelector<HTMLInputElement>(".board-add-column input");
        if (!input) throw new Error("expected an inline editor for the new column");

        await act(async () => {
            input.focus();
            input.value = name;
            input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
            await flush();
        });

        // The save re-publishes the config, which re-runs the (async) board refresh; that lands in a
        // later tick than the one `act` flushed above.
        await act(async () => {
            await flush();
        });
    }

    /**
     * A column is added at the right end of the board, past its edge on a board of any width, and
     * the editor waiting for the next one goes with it.
     */
    it("scrolls the board to its end as a column is added", async () => {
        const { container } = await setup();
        const board = container.querySelector<HTMLElement>(".board-view-container");
        const slot = container.querySelector<HTMLElement>(".board-add-column");
        if (!board || !slot) throw new Error("expected a board with an add-column button");

        // happy-dom lays nothing out, so the width the board scrolls within is stood in for.
        const widen = (width: number) => Object.defineProperty(board, "scrollWidth", {
            value: width, configurable: true, writable: true
        });

        widen(1200);
        await act(async () => {
            slot.click();
            await flush();
        });

        const input = slot.querySelector<HTMLInputElement>("input");
        if (!input) throw new Error("expected an inline editor for the new column");

        // The board grows by the column the write adds, and the scroll follows that rather than
        // the write, which returns before the column is drawn.
        board.scrollLeft = 0;
        widen(1450);
        await act(async () => {
            input.value = "In Progress";
            input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
            await flush();
        });
        await act(async () => { await flush(); });

        expect(columnTitles(container)).toEqual([ "To Do", "Done", "In Progress" ]);
        expect(board.scrollLeft).toBe(1450);

        // And it fades in where it landed, once: a redraw of the board must not play it again.
        const added = container.querySelectorAll<HTMLElement>(".board-column")[2];
        expect(added.classList.contains("appearing")).toBe(true);
        expect(container.querySelectorAll(".board-column.appearing")).toHaveLength(1);

        await act(async () => {
            added.dispatchEvent(new AnimationEvent("animationend", {
                animationName: "board-item-appear", bubbles: true
            }));
            await flush();
        });
        expect(added.classList.contains("appearing")).toBe(false);
    });

    it("renders a newly added column without leaving the view", async () => {
        const { container } = await setup();
        expect(columnTitles(container)).toEqual([ "To Do", "Done" ]);

        await addColumn(container, "In Progress");

        expect(saved.at(-1)?.columns?.map(c => c.value)).toEqual([ "To Do", "Done", "In Progress" ]);
        expect(columnTitles(container)).toEqual([ "To Do", "Done", "In Progress" ]);
    });
});

describe("Board column rename", () => {
    let container: HTMLElement | undefined;

    afterEach(() => {
        saved.length = 0;
        if (container) {
            render(null, container);
            container.remove();
            container = undefined;
        }
    });

    const DEFAULT_CONFIG: BoardViewData = {
        columns: [ { value: "To Do" }, { value: "Doing" }, { value: "Done" } ]
    };

    async function setup(config: BoardViewData = DEFAULT_CONFIG, includeArchived = false) {
        const note = buildNote({
            title: "Board",
            "#collection": "",
            "#viewType": "board",
            ...(includeArchived ? { "#includeArchived": "true" } : {}),
            "#label:status(inheritable)":
                "promoted,alias=Status,single,select,options=To Do;Doing;Done",
            children: [
                { title: "First", "#status": "To Do" },
                { title: "Second", "#status": "Doing" },
                { title: "Third", "#status": "Done" }
            ]
        });

        const mountPoint = document.createElement("div");
        container = mountPoint;
        document.body.appendChild(mountPoint);

        const host = new Component();
        await act(async () => {
            render(
                <ParentComponent.Provider value={host}>
                    <Harness
                        note={note}
                        noteIds={[ ...note.getChildNoteIds() ]}
                        initialConfig={config}
                    />
                </ParentComponent.Provider>,
                mountPoint
            );
        });
        await act(async () => { await flush(); });

        // The host is what the board's own event handlers hang off, for a test that sends one.
        return { note, container: mountPoint, host };
    }

    /**
     * What a second tab on the same board sees while the first is writing. The record is shared, so
     * the column being carried is resolved away here too; putting that on disk would commit an
     * answer the notes have not given, and the tab making the write persists it once it lands.
     */
    it("leaves the stored columns alone while a write on the board is running", async () => {
        const { note } = await setup();
        saved.length = 0;

        const writes = getPendingWrites(`${note.noteId}|status`);
        writes.renames.set("Done", undefined);
        writes.inFlight = 1;

        const second = document.createElement("div");
        document.body.appendChild(second);
        await act(async () => {
            render(
                <ParentComponent.Provider value={new Component()}>
                    <Harness
                        note={note}
                        noteIds={[ ...note.getChildNoteIds() ]}
                        initialConfig={DEFAULT_CONFIG}
                    />
                </ParentComponent.Provider>,
                second
            );
        });
        await act(async () => { await flush(); });

        expect(saved).toEqual([]);
        second.remove();
    });

    /**
     * A record outlasts the write that made it wherever the definition keeps naming the old value,
     * which a board that cannot write its own definition does for good. The board still has to
     * bring what it can reach into line, so only a running write holds persistence back.
     */
    /**
     * A board that keeps a column list is left to keep it: written on every refresh instead, a
     * client reading the board while another changes it resolves a name the change has already
     * taken away and writes it back as a column of its own.
     */
    it("leaves a stored column list alone, and writes one only for a board with none", async () => {
        const { note } = await setup();
        saved.length = 0;

        const draw = async (initialConfig: BoardViewData) => {
            const mountPoint = document.createElement("div");
            document.body.appendChild(mountPoint);
            await act(async () => {
                render(
                    <ParentComponent.Provider value={new Component()}>
                        <Harness
                            note={note}
                            noteIds={[ ...note.getChildNoteIds() ]}
                            initialConfig={initialConfig}
                        />
                    </ParentComponent.Provider>,
                    mountPoint
                );
            });
            await act(async () => { await flush(); });
            mountPoint.remove();
        };

        await draw(DEFAULT_CONFIG);
        expect(saved).toEqual([]);

        await draw({});
        expect(saved.at(-1)?.columns?.map(column => column.value))
            .toEqual([ "To Do", "Doing", "Done" ]);
    });

    it("offers its keys as contextual shortcut hints", async () => {
        const host = new Component();
        const note = buildNote({
            title: "Board",
            "#collection": "",
            "#viewType": "board",
            children: [ { title: "First", "#status": "To Do" } ]
        });

        const mountPoint = document.createElement("div");
        container = mountPoint;
        document.body.appendChild(mountPoint);
        await act(async () => {
            render(
                <ParentComponent.Provider value={host}>
                    <Harness
                        note={note}
                        noteIds={[ ...note.getChildNoteIds() ]}
                        initialConfig={DEFAULT_CONFIG}
                    />
                </ParentComponent.Provider>,
                mountPoint
            );
        });
        await act(async () => { await flush(); });

        const sections = collectShortcutHints(host);

        expect(sections.map(section => section.titleKey)).toEqual([
            "board_view.hints.navigation",
            "board_view.hints.editing",
            "board_view.hints.moving"
        ]);
        // Every key the board answers for is spoken for, and none it does not.
        expect(sections.flatMap(section => section.hints)).toEqual([
            { keys: [ "Up", "Down" ], labelKey: "board_view.hints.navigate_items" },
            { keys: [ "Left", "Right" ], labelKey: "board_view.hints.navigate_columns" },
            { keys: [ "Home", "End" ], labelKey: "board_view.hints.first_last_item" },
            { keys: [ "Enter", "Shift+Enter" ], labelKey: "board_view.hints.insert_item" },
            {
                keys: [ "Ctrl+Enter", "Ctrl+Shift+Enter" ],
                labelKey: "board_view.hints.insert_column"
            },
            { keys: [ "Space" ], labelKey: "board_view.hints.open_item" },
            { keys: [ "F2" ], labelKey: "board_view.hints.rename" },
            { keys: [ "Delete" ], labelKey: "board_view.hints.remove_item" },
            { keys: [ "Shift+Delete" ], labelKey: "board_view.hints.delete_item" },
            { keys: [ "Delete" ], labelKey: "board_view.hints.remove_column" },
            { keys: [ "Ctrl+Up", "Ctrl+Down" ], labelKey: "board_view.hints.move_item" },
            { keys: [ "Ctrl+Home", "Ctrl+End" ], labelKey: "board_view.hints.move_within" },
            { keys: [ "Ctrl+Left", "Ctrl+Right" ], labelKey: "board_view.hints.move_across" },
            {
                keys: [ "Ctrl+Shift+Left", "Ctrl+Shift+Right" ],
                labelKey: "board_view.hints.move_to_end_column"
            },
            {
                keys: [ "Ctrl+Alt+Left", "Ctrl+Alt+Right" ],
                labelKey: "board_view.hints.move_column"
            },
            {
                keys: [ "Ctrl+Alt+Home", "Ctrl+Alt+End" ],
                labelKey: "board_view.hints.move_column_to_edge"
            }
        ]);
    });

    /**
     * A view is handed its record when it first draws the board and holds it while it is mounted.
     * A record dropped for being empty would leave this view reading one nothing writes into, and
     * a column another tab is deleting would come back.
     */
    it("keeps a drawn view on the record later writes go into", async () => {
        const note = buildNote({
            title: "Board",
            "#collection": "",
            "#viewType": "board",
            "#label:status(inheritable)":
                "promoted,alias=Status,single,select,options=To Do;Doing;Done",
            children: [ { title: "First", "#status": "To Do" } ]
        });
        const host = new Component();
        const mountPoint = document.createElement("div");
        container = mountPoint;
        document.body.appendChild(mountPoint);

        // A fresh list each time, so the refresh the board hangs off runs again.
        const draw = async () => {
            await act(async () => {
                render(
                    <ParentComponent.Provider value={host}>
                        <Harness
                            note={note}
                            noteIds={[ ...note.getChildNoteIds() ]}
                            initialConfig={DEFAULT_CONFIG}
                        />
                    </ParentComponent.Provider>,
                    mountPoint
                );
            });
            await act(async () => { await flush(); });
        };

        await draw();
        expect(columnTitles(mountPoint)).toEqual([ "To Do", "Doing", "Done" ]);

        // What another tab deleting a column leaves behind, after this view has been drawing.
        getPendingWrites(`${note.noteId}|status`).renames.set("Done", undefined);
        await draw();

        expect(columnTitles(mountPoint)).toEqual([ "To Do", "Doing" ]);
    });

    it("collapses the column when its header is double clicked", async () => {
        const { container } = await setup();
        const [ first ] = [ ...container.querySelectorAll<HTMLElement>(".board-column") ];

        await act(async () => {
            first.querySelector("h3")
                ?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
            await flush();
        });

        expect(first.classList.contains("collapsed")).toBe(true);
        expect(saved.at(-1)?.columns?.[0]).toEqual({ value: "To Do", collapsed: true });
        // The title editor is left to F2 and to the menu.
        expect(first.querySelector("h3 input")).toBeNull();
    });

    /** The tooltip is set on the element, which is where `useStaticTooltip` reads it back from. */
    function badgeTooltip(container: HTMLElement, index: number) {
        const badge = [ ...container.querySelectorAll(".board-column .counter-badge") ][index];
        // Bootstrap moves the attribute aside once it takes the tooltip over.
        return badge?.getAttribute("title") ?? badge?.getAttribute("data-bs-original-title");
    }

    it("counts the cards a column holds, and says so when hovered", async () => {
        const { container } = await setup();

        expect([ ...container.querySelectorAll(".board-column .counter-badge") ]
            .map(el => el.textContent)).toEqual([ "1", "1", "1" ]);
        expect(badgeTooltip(container, 0)).toBe('board_view.card-count:{"count":1}');
    });

    /**
     * Archived cards are among a column's only while the board is showing them; where it is not,
     * there are none to count and the badge says how many cards there are and no more.
     */
    it("tells the archived cards apart from the rest where the board shows them", async () => {
        const note = buildNote({
            title: "Board",
            "#collection": "",
            "#viewType": "board",
            "#includeArchived": "true",
            "#label:status(inheritable)":
                "promoted,alias=Status,single,select,options=To Do",
            children: [
                { title: "First", "#status": "To Do" },
                { title: "Second", "#status": "To Do" },
                { title: "Old", "#status": "To Do", "#archived": "" }
            ]
        });

        const mountPoint = document.createElement("div");
        container = mountPoint;
        document.body.appendChild(mountPoint);
        await act(async () => {
            render(
                <ParentComponent.Provider value={new Component()}>
                    <Harness
                        note={note}
                        noteIds={[ ...note.getChildNoteIds() ]}
                        initialConfig={{ columns: [ { value: "To Do" } ] }}
                    />
                </ParentComponent.Provider>,
                mountPoint
            );
        });
        await act(async () => { await flush(); });

        expect(badgeTooltip(mountPoint, 0))
            .toBe('board_view.card-count-with-archived:{"count":2,"archived":1}');
    });

    /** A column told how much it should hold says so, and says when it is holding more. */
    it("shows the limit beside the count, and marks a column over it", async () => {
        const note = buildNote({
            title: "Board",
            "#collection": "",
            "#viewType": "board",
            "#label:status(inheritable)":
                "promoted,alias=Status,single,select,options=To Do;Done",
            children: [
                { title: "First", "#status": "To Do" },
                { title: "Second", "#status": "To Do" },
                { title: "Third", "#status": "Done" }
            ]
        });

        const mountPoint = document.createElement("div");
        container = mountPoint;
        document.body.appendChild(mountPoint);
        await act(async () => {
            render(
                <ParentComponent.Provider value={new Component()}>
                    <Harness
                        note={note}
                        noteIds={[ ...note.getChildNoteIds() ]}
                        initialConfig={{ columns: [
                            { value: "To Do", limit: 1 }, { value: "Done", limit: 4 }
                        ] }}
                    />
                </ParentComponent.Provider>,
                mountPoint
            );
        });
        await act(async () => { await flush(); });

        const badges = [ ...mountPoint.querySelectorAll(".board-column .counter-badge") ];
        expect(badges.map(el => el.textContent)).toEqual([ "2/1", "1/4" ]);
        // Only the one holding more than it should is marked, badge and body alike.
        expect(badges.map(el => el.classList.contains("over-limit"))).toEqual([ true, false ]);
        expect([ ...mountPoint.querySelectorAll(".board-column") ]
            .map(el => el.classList.contains("over-limit"))).toEqual([ true, false ]);

        // The one over its limit says so on hover, on a line of its own.
        expect(badgeTooltip(mountPoint, 0)).toContain("board_view.card-count-over-limit");
        expect(badgeTooltip(mountPoint, 1)).not.toContain("board_view.card-count-over-limit");
    });

    /**
     * The badge is what the reader sees; the tooltip follows it through the memoised config. The
     *  attribute is only the fallback before Bootstrap takes the tooltip over, and Bootstrap
     * restores its own copy of it on dispose, so it is not what this asserts.
     */
    it("follows the count when a card leaves the column", async () => {
        const note = buildNote({
            title: "Board",
            "#collection": "",
            "#viewType": "board",
            "#label:status(inheritable)":
                "promoted,alias=Status,single,select,options=To Do;Done",
            children: [
                { title: "First", "#status": "To Do" },
                { title: "Second", "#status": "To Do" }
            ]
        });
        const host = new Component();
        const mountPoint = document.createElement("div");
        container = mountPoint;
        document.body.appendChild(mountPoint);

        const draw = async () => {
            await act(async () => {
                render(
                    <ParentComponent.Provider value={host}>
                        <Harness
                            note={note}
                            noteIds={[ ...note.getChildNoteIds() ]}
                            initialConfig={{ columns: [ { value: "To Do" }, { value: "Done" } ] }}
                        />
                    </ParentComponent.Provider>,
                    mountPoint
                );
            });
            await act(async () => { await flush(); });
        };

        const counts = () =>
            [ ...mountPoint.querySelectorAll(".counter-badge") ].map(el => el.textContent);

        await draw();
        expect(counts()).toEqual([ "2", "0" ]);

        // What a move leaves behind: the card now carries the other column's value.
        const [ moved ] = [ ...note.getChildNoteIds() ];
        for (const attribute of froca.getNoteFromCache(moved)?.getAttributes() ?? []) {
            if (attribute.name === "status") attribute.value = "Done";
        }
        await draw();

        expect(counts()).toEqual([ "1", "1" ]);
    });

    /** Renames the middle column, so a slot that is not the last one has to survive. */
    async function renameSecondColumn(container: HTMLElement, newName: string) {
        return renameColumnAt(container, 1, newName);
    }

    async function renameColumnAt(container: HTMLElement, index: number, newName: string) {
        const column = container.querySelectorAll<HTMLElement>(".board-column")[index];
        await act(async () => {
            startEditingTitle(column);
            await flush();
        });

        const input = column.querySelector<HTMLInputElement>("h3 input");
        if (!input) throw new Error("expected an inline editor for the column title");

        await act(async () => {
            input.focus();
            input.value = newName;
            input.blur();
            await flush();
        });
        await act(async () => { await flush(); });
    }

    /**
     * The cards, the stored columns and the definition are renamed together by the server, so that
     * no client reads the board while they disagree and writes the old name back. What the board
     * does from here is ask for that, and write none of the three itself.
     */
    it("asks the server to rename the column, and writes nothing of its own", async () => {
        const { container } = await setup();
        const put = vi.spyOn(server, "put").mockResolvedValue(undefined);
        expect(columnTitles(container)).toEqual([ "To Do", "Doing", "Done" ]);

        await renameSecondColumn(container, "In Progress");

        expect(put).toHaveBeenCalledWith(expect.stringMatching(/board\/rename-column$/),
            expect.objectContaining({
                attribute: "status", oldValue: "Doing", newValue: "In Progress"
            }));
        expect(saved).toEqual([]);
    });

    /**
     * `NoteList` renders the view unkeyed, so the board the user moves to is the same component
     * instance. A rename still pending on the one they left must not rewrite a column here that
     * happens to carry the old name.
     */
    it("does not carry a pending rename over to the next board", async () => {
        const { container } = await setup();
        await renameSecondColumn(container, "In Progress");

        const other = buildNote({
            title: "Other board",
            "#collection": "",
            "#viewType": "board",
            "#label:status(inheritable)":
                "promoted,alias=Status,single,select,options=Doing;Shipped",
            children: [
                { title: "Fourth", "#status": "Doing" },
                { title: "Fifth", "#status": "Shipped" }
            ]
        });

        await act(async () => {
            render(
                <ParentComponent.Provider value={new Component()}>
                    <Harness
                        note={other}
                        noteIds={[ ...other.getChildNoteIds() ]}
                        initialConfig={{ columns: [ { value: "Doing" }, { value: "Shipped" } ] }}
                    />
                </ParentComponent.Provider>,
                container
            );
            await flush();
        });
        await act(async () => { await flush(); });

        expect(columnTitles(container)).toEqual([ "Doing", "Shipped" ]);
    });

    it("shows each column's icon, defaulting it, and keeps it while editing", async () => {
        const { container } = await setup({
            columns: [
                { value: "To Do" },
                { value: "Doing", icon: "bx bx-run" },
                { value: "Done" }
            ]
        });

        expect(columnIcons(container))
            .toEqual([ DEFAULT_COLUMN_ICON, "bx bx-run", DEFAULT_COLUMN_ICON ]);

        // The editor covers the title and its button, so the icon is still the one on the left.
        const column = container.querySelectorAll<HTMLElement>(".board-column")[1];
        await act(async () => {
            startEditingTitle(column);
            await flush();
        });

        expect(column.querySelector("h3 input")).toBeTruthy();
        expect(column.querySelector("h3 > .column-icon button")?.className).toContain("bx bx-run");
    });

    it("tints only the columns given a colour that has a hue", async () => {
        const { container } = await setup({
            columns: [
                { value: "To Do", color: "#4d99e6" },
                { value: "Doing", color: "#808080" },
                { value: "Done" }
            ]
        });

        const columns = [ ...container.querySelectorAll<HTMLElement>(".board-column") ];
        const hues = columns
            .map(column => column.style.getPropertyValue("--board-column-custom-hue"));

        expect(Math.round(Number(hues[0]))).toBe(210);
        // Grey has no hue of its own, leaving the column as plain as one with no colour.
        expect(hues.slice(1)).toEqual([ "", "" ]);
        expect(columns.map(column => column.classList.contains("with-hue")))
            .toEqual([ true, false, false ]);
    });

    it("hides an archived column, unless the board is set to show archived notes", async () => {
        const archivedConfig: BoardViewData = {
            columns: [ { value: "To Do" }, { value: "Doing", archived: true }, { value: "Done" } ]
        };

        const { container: hidden } = await setup(archivedConfig);
        expect(columnTitles(hidden)).toEqual([ "To Do", "Done" ]);

        // The column is only out of sight; nothing has been written out of the config.
        expect(saved.every(config => config.columns?.some(col => col.value === "Doing")))
            .toBe(true);

        render(null, hidden);
        hidden.remove();

        const { container: shown } = await setup(archivedConfig, true);
        expect(columnTitles(shown)).toEqual([ "To Do", "Doing", "Done" ]);
        expect([ ...shown.querySelectorAll(".board-column") ]
            .map(column => column.classList.contains("board-column-archived")))
            .toEqual([ false, true, false ]);
    });

    /**
     * The editor belongs to the column rather than to the button below it, so the header's menu
     * can raise the same one instead of a second way of making a card.
     */
    it("opens the new-item editor from the menu, as the button below the column does", async () => {
        const { container } = await setup();
        const column = container.querySelectorAll<HTMLElement>(".board-column")[1];
        expect(column.querySelector(".board-new-item textarea")).toBeNull();

        // Raised the way the header raises it, then the entry is invoked as the menu would.
        const show = vi.spyOn(contextMenu, "show").mockImplementation(async () => {});
        column.querySelector("h3")?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));

        const entry = (show.mock.calls.at(-1)?.[0].items ?? [])
            .find(item => item && "uiIcon" in item && item.uiIcon === "bx bx-plus");
        if (!entry || !("handler" in entry)) throw new Error("expected a new-item entry");

        await act(async () => {
            entry.handler?.(entry, {} as never);
            await flush();
        });
        expect(column.querySelector(".board-new-item.editing textarea")).toBeTruthy();

        show.mockRestore();
    });

    it("keeps the new-item slot out of the column's scrolling body", async () => {
        const { container } = await setup();
        const column = container.querySelectorAll<HTMLElement>(".board-column")[1];
        const slot = column.querySelector<HTMLElement>(".board-new-item");

        expect(slot).toBeTruthy();
        expect(slot?.closest(".board-column-content")).toBeNull();
        expect(slot?.parentElement).toBe(column);
    });

    /**
     * Cards are added in runs, so the editor stays where it is with an empty field rather than
     * closing and having to be opened again for the next one.
     */
    it("clears the new-item editor on Enter and leaves it open", async () => {
        const { container } = await setup();
        const created = vi.spyOn(BoardApi.prototype, "createNewItem")
            .mockResolvedValue(undefined);
        const slot = container.querySelectorAll<HTMLElement>(".board-column")[1]
            .querySelector<HTMLElement>(".board-new-item");

        await act(async () => {
            slot?.click();
            await flush();
        });

        const editor = slot?.querySelector<HTMLTextAreaElement>("textarea");
        if (!editor) throw new Error("expected the new-item editor to be open");

        editor.value = "First";
        await act(async () => {
            editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
            await flush();
        });

        expect(created).toHaveBeenCalledWith("Doing", "First", "bottom", undefined, textTemplate());
        expect(slot?.querySelector("textarea")).toBe(editor);
        expect(editor.value).toBe("");
        expect(document.activeElement).toBe(editor);

        // The one already saved is not written a second time by the one that follows it.
        editor.value = "Second";
        await act(async () => {
            editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
            await flush();
        });

        expect(created).toHaveBeenCalledTimes(2);
        expect(created).toHaveBeenLastCalledWith("Doing", "Second", "bottom", undefined, textTemplate());
    });

    /**
     * A card is added at the end of its column, which on a full column is out of sight, so it is
     * scrolled to and faded in rather than appearing wherever the reader is not looking.
     */
    it("reveals the card the editor just made", async () => {
        const { note, container } = await setup();
        const card = container.querySelector<HTMLElement>(".board-note");
        const noteId = card?.getAttribute("data-note-id");
        const column = card?.closest<HTMLElement>(".board-column");
        if (!card || !noteId || !column) throw new Error("expected a card to stand in for the new one");

        // happy-dom lays nothing out, so the scrollable height has to be stood in for.
        const content = column.querySelector<HTMLElement>(".board-column-content");
        if (!content) throw new Error("expected a scrollable column body");
        Object.defineProperty(content, "scrollHeight",
            { value: 500, configurable: true, writable: true });
        expect(content.scrollTop).toBe(0);

        vi.spyOn(BoardApi.prototype, "createNewItem").mockResolvedValue(noteId);

        const slot = column.querySelector<HTMLElement>(".board-new-item");
        await act(async () => {
            slot?.click();
            await flush();
        });

        const editor = slot?.querySelector<HTMLTextAreaElement>("textarea");
        if (!editor) throw new Error("expected the new-item editor to be open");
        editor.value = "Fresh";
        await act(async () => {
            editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
            await flush();
        });

        expect(card.classList.contains("appearing")).toBe(true);
        expect(content.scrollTop).toBe(500);

        // Shown once: the card stays the one just made, and a redraw of the column must not play
        // the reveal again.
        await act(async () => {
            card.dispatchEvent(new AnimationEvent("animationend", {
                animationName: "board-item-appear", bubbles: true
            }));
            await flush();
        });
        expect(card.classList.contains("appearing")).toBe(false);

        await act(async () => {
            render(
                <ParentComponent.Provider value={new Component()}>
                    <Harness
                        note={note}
                        noteIds={[ ...note.getChildNoteIds() ]}
                        initialConfig={DEFAULT_CONFIG}
                    />
                </ParentComponent.Provider>,
                container
            );
            await flush();
        });
        expect(card.classList.contains("appearing")).toBe(false);

        // The cards that were already there are left alone.
        const others = [ ...container.querySelectorAll(".board-note") ]
            .filter(other => other !== card);
        expect(others.some(other => other.classList.contains("appearing"))).toBe(false);
    });

    /**
     * The field a card is named in stands where the card goes and holds what it is called, so the
     * card is drawn into the place the field was keeping for it: it fades in there rather than
     * opening out of a gap the column makes after closing the one the field left.
     */
    it("keeps the field standing until the card it made takes its place", async () => {
        const { note, container } = await setup();
        const made = buildNote({ title: "Made", "#status": "Doing" });
        let answer: (noteId: string) => void = () => {};
        vi.spyOn(BoardApi.prototype, "createNewItemBefore")
            .mockReturnValue(new Promise((resolve) => { answer = resolve; }));

        const column = container.querySelectorAll<HTMLElement>(".board-column")[1];
        const standIn = column.querySelector<HTMLElement>(".board-note");
        if (!standIn) throw new Error("expected a card in the column");

        await act(async () => {
            standIn.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
            await flush();
        });

        const field = column
            .querySelector<HTMLTextAreaElement>(".board-new-item.inserting textarea");
        if (!field) throw new Error("expected the field for a new card to be open");
        field.value = "Made";
        await act(async () => {
            field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
            await flush();
        });

        // The write is still in flight, so the field stands, and holds what it is about to become.
        await act(async () => {
            answer(made.noteId);
            await flush();
        });
        expect(column.querySelector(".board-new-item.inserting")).toBeTruthy();
        expect(field.value).toBe("Made");

        fileCard(note, made);
        await redraw(note, container);

        expect(column.querySelector(".board-new-item.inserting")).toBeNull();
        // Faded in where the field stood, and not opened out of nothing.
        const card = drawn(container, made.noteId);
        expect(card.classList.contains("appearing")).toBe(true);
        expect(card.style.height).toBe("");
    });

    /** A read of the templates the test itself answers, in the order it chooses. */
    interface Answer {
        resolve: (options: NoteTypeOption[]) => void;
        reject: (error: Error) => void;
    }

    /** What the pill in the editor a card is named in reads, which is the board's own template. */
    async function pillNames(container: HTMLElement) {
        const slot = container.querySelectorAll<HTMLElement>(".board-column")[1]
            .querySelector<HTMLElement>(".board-new-item");
        await act(async () => {
            slot?.click();
            await flush();
        });

        return slot?.querySelector(".card-template-pill button")?.textContent ?? "";
    }

    /**
     * An attribute change as the server reports one: the row is tracked as well as carried.
     *
     * A label taken away is reported as a change like any other, the row read from the database
     * rather than from becca and so carrying what the label was.
     */
    function attributeChanged(name: string, noteId = "someNote", isDeleted = false) {
        const results = new LoadResults([ {
            entityName: "attributes",
            entityId: "attr1",
            entity: { attributeId: "attr1", noteId, type: "label", name, isDeleted }
        } as never ]);
        results.addAttribute("attr1", "other");
        return results;
    }

    /**
     * Names a card in the field a press of Enter opens below the given one, which is what makes it.
     *
     * Answers with the field, which is taken down as the card is made.
     */
    async function nameCardBeside(card: HTMLElement, title: string) {
        await act(async () => {
            card.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
            await flush();
        });

        const field = card.parentElement
            ?.querySelector<HTMLTextAreaElement>(".board-new-item.inserting textarea");
        if (!field) throw new Error("expected the field for a new card to be open");

        field.value = title;
        await act(async () => {
            field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
            await flush();
        });

        return field;
    }

    /**
     * Takes a dialog down as Bootstrap would.
     *
     * Its own teardown waits on a transition that happy-dom never runs, so a dialog left open keeps
     * the focus trap Bootstrap put on the page: every editor the tests after it open would lose the
     * focus the moment it was given.
     */
    async function dismiss(dialog?: HTMLElement) {
        await act(async () => {
            dialog?.dispatchEvent(new Event("hidden.bs.modal", { bubbles: true }));
            await flush();
        });

        BootstrapModal.getInstance(dialog as HTMLElement)?.dispose();
        dialog?.remove();
        document.querySelector(".modal-backdrop")?.remove();
        document.body.classList.remove("modal-open");
    }

    /** The element standing for a note, which a move draws afresh. */
    function drawn(container: HTMLElement, noteId: string) {
        const element = [ ...container.querySelectorAll<HTMLElement>(".board-note") ]
            .find(card => card.getAttribute("data-note-id") === noteId);
        if (!element) throw new Error(`expected ${noteId} to be drawn`);
        return element;
    }

    /**
     * A card that arrives from somewhere else, a move between columns above all, mounts as a new
     * element in the column that draws it. Only a card the column itself made is shown: the rest
     * are already where they were put.
     */
    it("shows only the card the column made, not one that merely arrived", async () => {
        const { note, container } = await setup();
        withBoxes();

        try {
            addCard(note, "Doing");
            await redraw(note, container);

            const arrived = [ ...container.querySelectorAll<HTMLElement>(".board-note") ]
                .find(card => card.textContent?.includes("Added"));
            if (!arrived) throw new Error("expected the card that arrived to be drawn");
            expect(arrived.classList.contains("appearing")).toBe(false);
            expect(arrived.style.height).toBe("");
            expect(arrived.style.overflow).toBe("");
        } finally {
            dropBoxes();
        }
    });

    /** happy-dom lays nothing out, and a child with no offset parent is one `useFlip` skips. */
    function withBoxes() {
        for (const [ property, read ] of Object.entries({
            offsetParent(this: HTMLElement) { return this.parentElement; },
            offsetHeight() { return 34; },
            offsetTop() { return 0; }
        })) {
            Object.defineProperty(HTMLElement.prototype, property,
                { configurable: true, get: read as () => unknown });
        }
    }

    function dropBoxes() {
        for (const property of [ "offsetParent", "offsetHeight", "offsetTop" ]) {
            delete (HTMLElement.prototype as unknown as Record<string, unknown>)[property];
        }
    }

    /** Draws the board again, which is how a card filed under it reaches the column. */
    async function redraw(note: ReturnType<typeof buildNote>, container: HTMLElement) {
        await act(async () => {
            render(
                <ParentComponent.Provider value={new Component()}>
                    <Harness
                        note={note}
                        noteIds={[ ...note.getChildNoteIds() ]}
                        initialConfig={DEFAULT_CONFIG}
                    />
                </ParentComponent.Provider>,
                container
            );
            await flush();
        });
        await act(async () => { await flush(); });
    }

    it("reveals a card inserted next to another one, without leaving its place", async () => {
        const { note, container } = await setup();

        // Two more cards in the same column, so the one standing in for the insert has a card on
        // either side and the column is brought to it rather than run to either end.
        addCard(note, "Doing");
        addCard(note, "Doing");
        await act(async () => {
            render(
                <ParentComponent.Provider value={new Component()}>
                    <Harness
                        note={note}
                        noteIds={[ ...note.getChildNoteIds() ]}
                        initialConfig={DEFAULT_CONFIG}
                    />
                </ParentComponent.Provider>,
                container
            );
            await flush();
        });
        await act(async () => { await flush(); });

        const column = container.querySelectorAll<HTMLElement>(".board-column")[1];
        const [ first, middle, last ] = column.querySelectorAll<HTMLElement>(".board-note");
        const noteId = middle?.getAttribute("data-note-id");
        if (!first || !middle || !last || !noteId) {
            throw new Error("expected a column of three cards");
        }

        const scrolled = vi.fn();
        Object.defineProperty(middle, "scrollIntoView",
            { value: scrolled, configurable: true, writable: true });
        const content = column.querySelector<HTMLElement>(".board-column-content");
        Object.defineProperty(content, "scrollHeight",
            { value: 500, configurable: true, writable: true });
        vi.spyOn(BoardApi.prototype, "createNewItemBefore").mockResolvedValue(noteId);

        await nameCardBeside(last, "Typed");

        expect(middle.classList.contains("appearing")).toBe(true);
        expect(scrolled).toHaveBeenCalled();
        expect(content?.scrollTop).toBe(0);
    });

    /**
     * The same field wherever it stands, so a card inserted between two others is named, iconed and
     * made from a template the way a card added below the column is.
     */
    it("inserts with the field the column's own footer uses", async () => {
        const { container } = await setup();
        const column = container.querySelectorAll<HTMLElement>(".board-column")[1];
        const card = column.querySelector<HTMLElement>(".board-note");
        if (!card) throw new Error("expected a card in the column");

        await act(async () => {
            card.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
            await flush();
        });

        const field = column.querySelector<HTMLElement>(".board-new-item.inserting");
        expect(field?.querySelector(".title-editor-icon button")).toBeTruthy();
        expect(field?.querySelector(".card-template-pill button")?.textContent).toContain("Text");
        expect(field?.querySelector("textarea")?.placeholder).toBeTruthy();

        // Escape takes it down again, having made nothing.
        const editor = field?.querySelector<HTMLTextAreaElement>("textarea");
        await act(async () => {
            editor?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
            await flush();
        });
        expect(column.querySelector(".board-new-item.inserting")).toBeNull();
    });

    /**
     * The field a card is named in among the others stands for the card being made, so it is taken
     * down as the card lands and the card is left focused: the arrow keys carry on from there.
     */
    it("leaves the card it made focused, and a card added in the footer unfocused", async () => {
        const { container } = await setup();
        const column = container.querySelectorAll<HTMLElement>(".board-column")[1];
        const card = column.querySelector<HTMLElement>(".board-note");
        const noteId = card?.getAttribute("data-note-id");
        if (!card || !noteId) throw new Error("expected a card in the column");

        // The stand-in for the card just made, which is what the board draws and focuses.
        vi.spyOn(BoardApi.prototype, "createNewItemBefore").mockResolvedValue(noteId);
        await nameCardBeside(card, "Typed");

        expect(column.querySelector(".board-new-item.inserting")).toBeNull();
        expect(document.activeElement).toBe(card);

        // The footer's own editor keeps focus instead, so a run of cards can be typed into it.
        vi.spyOn(BoardApi.prototype, "createNewItem").mockResolvedValue(noteId);
        const slot = column.querySelector<HTMLElement>(".board-new-item");
        await act(async () => {
            slot?.click();
            await flush();
        });

        const editor = slot?.querySelector<HTMLTextAreaElement>("textarea");
        if (!editor) throw new Error("expected the new-item editor to be open");
        editor.value = "Another";
        await act(async () => {
            editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
            await flush();
        });

        expect(document.activeElement).toBe(editor);
    });

    /**
     * The editor used to hand focus back to whatever held it before it opened, which for a card
     * whose editor was opened for it is a different card: that one lit up on the way past.
     */
    it("closes a card editor onto its own card, not the one focus came from", async () => {
        const { container } = await setup();
        const columns = container.querySelectorAll<HTMLElement>(".board-column");
        const from = columns[0].querySelector<HTMLElement>(".board-note");
        const edited = columns[1].querySelector<HTMLElement>(".board-note");
        if (!from || !edited) throw new Error("expected a card in each of two columns");

        from.focus();
        const cameFrom = vi.spyOn(from, "focus");

        await act(async () => {
            edited.dispatchEvent(new KeyboardEvent("keydown", { key: "F2", bubbles: true }));
            await flush();
        });

        const editor = edited.querySelector<HTMLTextAreaElement>("textarea");
        if (!editor) throw new Error("expected the card editor to be open");

        await act(async () => {
            editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
            await flush();
        });

        expect(document.activeElement).toBe(edited);
        expect(cameFrom).not.toHaveBeenCalled();
    });

    /**
     * The footer editor stays open between cards, so it is left behind with something typed in it
     * often enough that saving on the way out would make cards nobody asked for.
     */
    it("gives up what is typed in the new-item editor when it loses focus", async () => {
        const { container } = await setup();
        // Cleared: the spy outlives the test that first stood it up, and its calls with it.
        const created = vi.spyOn(BoardApi.prototype, "createNewItem")
            .mockResolvedValue(undefined);
        created.mockClear();
        const slot = container.querySelectorAll<HTMLElement>(".board-column")[1]
            .querySelector<HTMLElement>(".board-new-item");

        await act(async () => {
            slot?.click();
            await flush();
        });

        const editor = slot?.querySelector<HTMLTextAreaElement>("textarea");
        if (!editor) throw new Error("expected the new-item editor to be open");

        editor.value = "Half a thought";
        await act(async () => {
            editor.dispatchEvent(new FocusEvent("blur"));
            editor.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
            await flush();
        });

        expect(created).not.toHaveBeenCalled();
        expect(slot?.querySelector("textarea")).toBeNull();
        expect(slot?.classList.contains("editing")).toBe(false);

        // What was typed is waiting in the editor when it is opened again.
        await act(async () => {
            slot?.click();
            await flush();
        });
        expect(slot?.querySelector<HTMLTextAreaElement>("textarea")?.value)
            .toBe("Half a thought");
    });

    /**
     * Columns are added in runs as a board is set up, so the editor stays where it is with an empty
     * field rather than closing and having to be opened again for the next one.
     */
    it("clears the add-column editor on Enter, and closes it when it loses focus", async () => {
        const { container } = await setup();
        const added = vi.spyOn(BoardApi.prototype, "addNewColumn").mockResolvedValue(true);
        const slot = container.querySelector<HTMLElement>(".board-add-column");

        await act(async () => {
            slot?.click();
            await flush();
        });

        const editor = slot?.querySelector<HTMLInputElement>("input");
        if (!editor) throw new Error("expected the add-column editor to be open");

        editor.value = "Blocked";
        await act(async () => {
            editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
            await flush();
        });

        expect(added).toHaveBeenCalledWith("Blocked", false, undefined);
        expect(slot?.querySelector("input")).toBe(editor);
        expect(editor.value).toBe("");
        expect(document.activeElement).toBe(editor);

        // Left alone, it goes back to being a button, and nothing is added from what it held.
        added.mockClear();
        editor.value = "Half a name";
        await act(async () => {
            editor.dispatchEvent(new FocusEvent("blur"));
            editor.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
            await flush();
        });

        expect(added).not.toHaveBeenCalled();
        expect(slot?.querySelector("input")).toBeNull();
        expect(slot?.classList.contains("editing")).toBe(false);
    });

    /**
     * The button beside the field changes face as the field is typed into, and the field takes its
     * value from a prop: a render that fed the old one back took the first character with it.
     */
    it("keeps what is typed into the add-column field", async () => {
        const { container } = await setup();
        const slot = container.querySelector<HTMLElement>(".board-add-column");

        await act(async () => {
            slot?.click();
            await flush();
        });

        const editor = slot?.querySelector<HTMLInputElement>("input");
        if (!editor) throw new Error("expected the add-column editor to be open");

        await type(editor, "B");
        expect(editor.value).toBe("B");

        await type(editor, "Blocked");
        expect(editor.value).toBe("Blocked");
    });

    /**
     * The same picker the column's own heading carries, so a column is given its icon as it is
     * named. It is kept for the next column, as the card editor keeps its own.
     */
    it("makes a column with the icon picked in the editor, and keeps it for the next", async () => {
        const { container } = await setup();
        const added = vi.spyOn(BoardApi.prototype, "addNewColumn").mockResolvedValue(true);
        added.mockClear();
        const slot = container.querySelector<HTMLElement>(".board-add-column");

        await act(async () => {
            slot?.click();
            await flush();
        });

        const editor = slot?.querySelector<HTMLInputElement>("input");
        if (!editor) throw new Error("expected the add-column editor to be open");
        // What a column is drawn with, until something else is picked.
        expect(slot?.querySelector(".title-editor-icon button")?.className)
            .toContain(DEFAULT_COLUMN_ICON);

        await act(async () => {
            slot?.querySelector<HTMLElement>(".title-editor-icon button")?.click();
            await flush();
        });
        await type(editor, "Starred");
        await act(async () => {
            editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
            await flush();
        });

        expect(added).toHaveBeenCalledWith("Starred", false, PICKED_ICON);
        expect(editor.value).toBe("");
        expect(slot?.querySelector(".title-editor-icon button")?.className).toContain(PICKED_ICON);
    });

    /** The same two ends a card's button offers, named for a board that runs across. */
    it("offers both ends of the board from the add-column button", async () => {
        const { container } = await setup();
        const added = vi.spyOn(BoardApi.prototype, "addNewColumn").mockResolvedValue(true);
        const show = vi.spyOn(contextMenu, "show").mockImplementation(async () => {});
        const slot = container.querySelector<HTMLElement>(".board-add-column");

        await act(async () => {
            slot?.click();
            await flush();
        });

        const editor = slot?.querySelector<HTMLInputElement>("input");
        if (!editor) throw new Error("expected the add-column editor to be open");

        // Nothing typed is nothing to create, so there is no button standing there at all.
        expect(slot?.querySelector(".title-editor-submit")).toBeNull();

        await type(editor, "Blocked");
        const button = slot?.querySelector<HTMLElement>(".title-editor-submit");
        if (!button) throw new Error("expected the button beside the field");
        button.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));

        const opened = show.mock.calls.at(-1)?.[0];
        const entries = (opened?.items ?? []).flatMap(item =>
            item && "title" in item && "handler" in item
                ? [ { title: item.title, icon: "uiIcon" in item ? item.uiIcon : undefined,
                      shortcut: "shortcut" in item ? item.shortcut : undefined,
                      handler: item.handler } ]
                : []);
        expect(entries.map(entry => [ entry.title, entry.icon, entry.shortcut ])).toEqual([
            [ "board_view.create-column-at-start", "bx bx-horizontal-left", "Shift+Enter" ],
            [ "board_view.create-column-at-end", "bx bx-horizontal-right", "Enter" ]
        ]);
        // The button stands at the board's right edge, where a menu drawn rightwards is pushed
        // back over it.
        expect(opened?.orientation).toBe("left");

        await act(async () => {
            entries[0]?.handler?.({} as never, {} as never);
            await flush();
        });
        expect(added).toHaveBeenCalledWith("Blocked", true, undefined);
        expect(editor.value).toBe("");

        // Shift+Enter says the same thing from the field itself.
        added.mockClear();
        await type(editor, "Also first");
        await act(async () => {
            editor.dispatchEvent(new KeyboardEvent("keydown",
                { key: "Enter", shiftKey: true, bubbles: true }));
            await flush();
        });
        expect(added).toHaveBeenCalledWith("Also first", true, undefined);

        show.mockRestore();
    });

    /**
     * The same as Enter, for a reader who would rather press something: pressing it must not take
     * focus out of the field first, since losing focus is what closes the editor.
     */
    it("makes a card from the button inside the new-item editor, and clears it", async () => {
        const { container } = await setup();
        const created = vi.spyOn(BoardApi.prototype, "createNewItem")
            .mockResolvedValue(undefined);
        created.mockClear();
        const slot = container.querySelectorAll<HTMLElement>(".board-column")[1]
            .querySelector<HTMLElement>(".board-new-item");

        await act(async () => {
            slot?.click();
            await flush();
        });

        const editor = slot?.querySelector<HTMLTextAreaElement>("textarea");
        const submit = slot?.querySelector<HTMLElement>(".title-editor-submit");
        if (!editor || !submit) throw new Error("expected the editor and its button");

        await type(editor, "From the button");
        await act(async () => {
            submit.dispatchEvent(new MouseEvent("click", { bubbles: true }));
            await flush();
        });

        expect(created).toHaveBeenCalledWith("Doing", "From the button", "bottom", undefined, textTemplate());
        expect(editor.value).toBe("");
        expect(slot?.querySelector("textarea")).toBe(editor);
        expect(document.activeElement).toBe(editor);
    });

    /**
     * The pill at the foot of the new-card field names what the card will be made from. It offers
     * what the board offers, and picking one is remembered: the next card is made from it, and so
     * is the next editor opened.
     */
    it("makes a card from the template picked in the pill, and remembers it", async () => {
        const { container } = await setup();
        const created = vi.spyOn(BoardApi.prototype, "createNewItem")
            .mockResolvedValue(undefined);
        created.mockClear();
        const slot = container.querySelectorAll<HTMLElement>(".board-column")[1]
            .querySelector<HTMLElement>(".board-new-item");

        await act(async () => {
            slot?.click();
            await flush();
        });

        const editor = slot?.querySelector<HTMLTextAreaElement>("textarea");
        const pill = slot?.querySelector<HTMLElement>(".card-template-pill button");
        if (!editor || !pill) throw new Error("expected the editor and its template pill");

        // The first the board offers, until something else is picked.
        expect(pill.textContent).toContain("Text");

        await act(async () => {
            pill.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
            $(pill.closest(".dropdown") as HTMLElement).trigger("show.bs.dropdown");
            await flush();
        });

        // The menu is portalled to the page, and the boards this file rendered before left theirs
        // behind, so it is the last one that belongs to the board under test.
        const menu = [ ...document.querySelectorAll<HTMLElement>(".card-template-pill") ].at(-1);
        const items = [ ...(menu?.querySelectorAll<HTMLElement>(".dropdown-item") ?? []) ];
        expect(items.map(item => item.textContent?.trim())).toEqual([
            "Text", "Markdown", "Canvas", "Spreadsheet", "board_view.more-templates"
        ]);
        // The one a card would be made from is ticked, rather than standing out by its background.
        expect(items.map(item => !!item.querySelector(".card-template-current")))
            .toEqual([ true, false, false, false, false ]);
        expect(items.some(item => item.classList.contains("active"))).toBe(false);

        await act(async () => {
            items[2].click();
            await flush();
        });

        // Stored on the board, so the next editor opens on it as well.
        expect(saved.at(-1)?.template).toBe("type:canvas:application/json");
        expect([ ...(menu?.querySelectorAll(".dropdown-item") ?? []) ]
            .map(item => !!item.querySelector(".card-template-current")))
            .toEqual([ false, false, true, false, false ]);

        await type(editor, "Drawn");
        await act(async () => {
            editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
            await flush();
        });

        expect(created).toHaveBeenCalledWith("Doing", "Drawn", "bottom", undefined,
            expect.objectContaining({ id: "type:canvas:application/json" }));
        expect(slot?.querySelector(".card-template-pill button")?.textContent).toContain("Canvas");
    });

    /**
     * Opening the pill's menu takes focus off the field: Bootstrap focuses the toggle it opens
     * from. Losing focus is what closes this editor, so the editor would take the menu down with
     * itself the moment it was opened, and the toggle would then find nothing to open.
     */
    it("stays open while the template pill's menu has the focus", async () => {
        const { container } = await setup();
        const created = vi.spyOn(BoardApi.prototype, "createNewItem")
            .mockResolvedValue(undefined);
        created.mockClear();
        const slot = container.querySelectorAll<HTMLElement>(".board-column")[1]
            .querySelector<HTMLElement>(".board-new-item");

        await act(async () => {
            slot?.click();
            await flush();
        });

        const editor = slot?.querySelector<HTMLTextAreaElement>("textarea");
        const pill = slot?.querySelector<HTMLElement>(".card-template-pill button");
        if (!editor || !pill) throw new Error("expected the editor and its pill");
        await type(editor, "Still here");

        await act(async () => {
            pill.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
            $(pill.closest(".dropdown") as HTMLElement).trigger("show.bs.dropdown");
            editor.dispatchEvent(new FocusEvent("blur"));
            editor.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
            await flush();
        });

        expect(slot?.querySelector("textarea")).toBe(editor);
        expect(editor.value).toBe("Still here");
        expect(created).not.toHaveBeenCalled();

        // Once the menu is done with, the field has the focus again.
        await act(async () => {
            $(pill.closest(".dropdown") as HTMLElement).trigger("hide.bs.dropdown");
            await flush();
        });
        expect(document.activeElement).toBe(editor);
    });

    /**
     * A board outlives the templates it read: one made while it stands would never be offered, and
     * one deleted would go on being offered. A template is a note carrying `#template`, so a change
     * to one of those attributes is what sends the board back for the list.
     */
    it("reads the templates again when one is made or taken away", async () => {
        const { host } = await setup();
        const before = templateReads;

        // A change to something else leaves the list where it is.
        await act(async () => {
            await host.handleEvent("entitiesReloaded", { loadResults: attributeChanged("status") });
            await flush();
        });
        expect(templateReads).toBe(before);

        await act(async () => {
            await host.handleEvent("entitiesReloaded", { loadResults: attributeChanged("template") });
            await flush();
        });
        expect(templateReads).toBe(before + 1);

        // And a note that stops being a template, which is the same row with `isDeleted` set.
        await act(async () => {
            await host.handleEvent("entitiesReloaded",
                { loadResults: attributeChanged("template", "someNote", true) });
            await flush();
        });
        expect(templateReads).toBe(before + 2);
    });

    /**
     * A template's icon is what the picker and the pill show, and an icon is a label on the note
     * rather than part of the note row: the change is reported as an attribute changing, which is
     * not what a reloaded note reads as. The label is not always `iconClass`, so any label on a
     * note the board offers sends it back for the list. Notes it offers nothing from are its own.
     */
    it("reads the templates again when one it offers is given another icon", async () => {
        const reading = vi.mocked(getNoteTypeOptions);
        const stockAnswer = reading.getMockImplementation();
        const template = {
            id: "template:tmpl1",
            title: "My template",
            icon: "bx bx-star",
            group: "user",
            options: { type: "text", mime: "text/html", templateNoteId: "tmpl1" }
        } as NoteTypeOption;
        reading.mockImplementation(async () => [ ...NOTE_TYPE_OPTIONS, template ]);

        try {
            const { host } = await setup();
            const before = reading.mock.calls.length;

            // An icon given to a note the board offers nothing from is not its business.
            await act(async () => {
                await host.handleEvent("entitiesReloaded",
                    { loadResults: attributeChanged("iconClass") });
                await flush();
            });
            expect(reading.mock.calls.length).toBe(before);

            await act(async () => {
                await host.handleEvent("entitiesReloaded",
                    { loadResults: attributeChanged("iconClass", "tmpl1") });
                await flush();
            });
            expect(reading.mock.calls.length).toBe(before + 1);

            // And an icon taken away again, which is the same row with `isDeleted` set.
            await act(async () => {
                await host.handleEvent("entitiesReloaded",
                    { loadResults: attributeChanged("iconClass", "tmpl1", true) });
                await flush();
            });
            expect(reading.mock.calls.length).toBe(before + 2);

            // A note with no icon of its own wears its workspace's, which is another label again.
            await act(async () => {
                await host.handleEvent("entitiesReloaded",
                    { loadResults: attributeChanged("workspaceIconClass", "tmpl1") });
                await flush();
            });
            expect(reading.mock.calls.length).toBe(before + 3);
        } finally {
            reading.mockImplementation(stockAnswer ?? (async () => NOTE_TYPE_OPTIONS));
        }
    });

    /**
     * Two reads can be in flight at once: the one the board makes as it arrives, and one a template
     * being made or deleted asks for. The server need not answer in the order it was asked, so the
     * answer to the older read is not what the board is left offering.
     */
    it("keeps the newest reading of what a card can be made from", async () => {
        const answers: Answer[] = [];
        const reading = vi.mocked(getNoteTypeOptions);
        const stockAnswer = reading.getMockImplementation();
        reading.mockImplementation(() =>
            new Promise((resolve, reject) => { answers.push({ resolve, reject }); }));

        try {
            // Both reads are made, and neither has been answered.
            const { host, container } = await setup();
            await act(async () => {
                await host.handleEvent("entitiesReloaded",
                    { loadResults: attributeChanged("template") });
                await flush();
            });
            expect(answers.length).toBe(2);

            // The newer read is answered first, and the older one after it, with nothing at all.
            await act(async () => {
                answers[1].resolve(NOTE_TYPE_OPTIONS);
                answers[0].resolve([]);
                await flush();
            });

            // The pill names what a card would be made from, which the older answer has none of.
            expect(await pillNames(container)).toContain("Text");
        } finally {
            reading.mockImplementation(stockAnswer ?? (async () => NOTE_TYPE_OPTIONS));
        }
    });

    /**
     * A read that fails leaves no answer at all, so what an older read answered is what the board
     * has: it is taken rather than thrown away for a newer read that came back with nothing.
     */
    it("takes an older answer when the newer read fails", async () => {
        const answers: Answer[] = [];
        const reading = vi.mocked(getNoteTypeOptions);
        const stockAnswer = reading.getMockImplementation();
        reading.mockImplementation(() =>
            new Promise((resolve, reject) => { answers.push({ resolve, reject }); }));

        try {
            const { host, container } = await setup();
            await act(async () => {
                await host.handleEvent("entitiesReloaded",
                    { loadResults: attributeChanged("template") });
                await flush();
            });
            expect(answers.length).toBe(2);

            await act(async () => {
                answers[1].reject(new Error("offline"));
                answers[0].resolve(NOTE_TYPE_OPTIONS);
                await flush();
            });

            expect(await pillNames(container)).toContain("Text");
        } finally {
            reading.mockImplementation(stockAnswer ?? (async () => NOTE_TYPE_OPTIONS));
        }
    });

    /** The pill's last entry leads where the board's own menu does: how the board is set up. */
    it("opens the board's properties from the pill, listing what it offers in order", async () => {
        const { container } = await setup();
        const slot = container.querySelectorAll<HTMLElement>(".board-column")[1]
            .querySelector<HTMLElement>(".board-new-item");

        await act(async () => {
            slot?.click();
            await flush();
        });

        const pill = slot?.querySelector<HTMLElement>(".card-template-pill button");
        if (!pill) throw new Error("expected the template pill");
        await act(async () => {
            pill.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
            $(pill.closest(".dropdown") as HTMLElement).trigger("show.bs.dropdown");
            await flush();
        });

        const menus = [ ...document.querySelectorAll<HTMLElement>(".card-template-pill") ];
        const more = [ ...(menus.at(-1)?.querySelectorAll<HTMLElement>(".dropdown-item") ?? []) ]
            .find(item => item.textContent?.includes("more-templates"));
        if (!more) throw new Error("expected a way to the dialog");

        await act(async () => {
            more.click();
            await flush();
        });
        // The card reads what a note can be made from as it is drawn, which takes a moment.
        await act(async () => { await flush(); });

        // The last of them: a dialog portalled to the page outlives the board that drew it here.
        const dialog = [ ...document.querySelectorAll<HTMLElement>(".board-properties-dialog") ]
            .at(-1);
        expect(dialog).toBeTruthy();

        // What the board offers, in the order it stores them, each carried by a grip of its own.
        const templates = dialog?.querySelector<HTMLElement>(".template-selection-card");
        const named = [ ...(templates?.querySelectorAll(".template-selection-name") ?? []) ]
            .map(element => element.textContent);
        expect(named).toEqual([ "Text", "Markdown", "Canvas", "Spreadsheet" ]);
        expect(templates?.querySelectorAll(".tn-sortable-grip").length).toBe(4);
        expect(templates?.querySelectorAll(".tn-sortable-adder").length).toBe(2);

        // And the attributes the cards show, which the same dialog arranges.
        expect(dialog?.querySelector(".promoted-attributes-card")).toBeTruthy();

        await dismiss(dialog);
    });

    /**
     * The icon stands inside the field, at its head, and is what the card is made with. It is kept
     * between cards, unlike the title: a run of cards is often a run of the same kind of card.
     */
    it("makes a card with the icon picked in the editor, and keeps it for the next", async () => {
        const { container } = await setup();
        const created = vi.spyOn(BoardApi.prototype, "createNewItem")
            .mockResolvedValue(undefined);
        created.mockClear();
        const slot = container.querySelectorAll<HTMLElement>(".board-column")[1]
            .querySelector<HTMLElement>(".board-new-item");

        await act(async () => {
            slot?.click();
            await flush();
        });

        const editor = slot?.querySelector<HTMLTextAreaElement>("textarea");
        const picker = slot?.querySelector<HTMLElement>(".title-editor-icon");
        if (!editor || !picker) throw new Error("expected the editor and its icon");

        // What a text note is drawn with, until something else is picked.
        expect(picker.querySelector("button")?.className).toContain("bx bx-note");

        await pickIcon(slot);
        expect(slot?.querySelector(".title-editor-icon button")?.className)
            .toContain(PICKED_ICON);

        await type(editor, "Starred");
        await act(async () => {
            editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
            await flush();
        });

        expect(created).toHaveBeenCalledWith("Doing", "Starred", "bottom", PICKED_ICON, textTemplate());
        // The title goes, the icon stays.
        expect(editor.value).toBe("");
        expect(slot?.querySelector(".title-editor-icon button")?.className)
            .toContain(PICKED_ICON);
    });

    /**
     * The picker takes focus with it, and losing focus is what closes the editor: it would take the
     * picker down with itself the moment it was opened.
     */
    it("stays open while the icon picker has the focus", async () => {
        const { container } = await setup();
        const created = vi.spyOn(BoardApi.prototype, "createNewItem")
            .mockResolvedValue(undefined);
        // The spy outlives the test that made it, and with it what it was called with there.
        created.mockClear();
        const slot = container.querySelectorAll<HTMLElement>(".board-column")[1]
            .querySelector<HTMLElement>(".board-new-item");

        await act(async () => {
            slot?.click();
            await flush();
        });

        const editor = slot?.querySelector<HTMLTextAreaElement>("textarea");
        if (!editor) throw new Error("expected the new-item editor to be open");
        await type(editor, "Still here");

        await act(async () => {
            slot?.querySelector<HTMLElement>(".picker-open")?.click();
            editor.dispatchEvent(new FocusEvent("blur"));
            editor.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
            await flush();
        });

        expect(slot?.querySelector("textarea")).toBe(editor);
        expect(editor.value).toBe("Still here");
        expect(created).not.toHaveBeenCalled();

        // The blur that would have ended the edit is spent, so the field is focused again.
        await act(async () => {
            slot?.querySelector<HTMLElement>(".picker-close")?.click();
            await flush();
        });
        expect(document.activeElement).toBe(editor);
    });

    /** Renaming a card makes nothing, so the button that creates is not offered beside it. */
    it("offers no create button while a card's title is edited", async () => {
        const { container } = await setup();
        const card = container.querySelectorAll<HTMLElement>(".board-column")[1]
            .querySelector<HTMLElement>(".board-note");
        if (!card) throw new Error("expected a card");

        await act(async () => {
            card.dispatchEvent(new KeyboardEvent("keydown", { key: "F2", bubbles: true }));
            await flush();
        });

        const editor = card.querySelector<HTMLTextAreaElement>("textarea");
        if (!editor) throw new Error("expected the title editor");

        await type(editor, "Renamed");
        expect(card.querySelector(".title-editor-submit")).toBeNull();
        // The icon is offered all the same, which is what the editor is dressed for.
        expect(card.querySelector(".title-editor-icon")).toBeTruthy();
    });

    /** The same picker on a card being renamed, which writes the icon onto the card itself. */
    it("writes the icon picked while a card's title is edited", async () => {
        const { container } = await setup();
        const setLabel = vi.spyOn(attributes, "setLabel").mockResolvedValue(undefined);
        const card = container.querySelectorAll<HTMLElement>(".board-column")[1]
            .querySelector<HTMLElement>(".board-note");
        const noteId = card?.getAttribute("data-note-id");
        if (!card || !noteId) throw new Error("expected a card");

        await act(async () => {
            card.dispatchEvent(new KeyboardEvent("keydown", { key: "F2", bubbles: true }));
            await flush();
        });
        expect(card.querySelector("textarea")).toBeTruthy();

        await pickIcon(card);

        expect(setLabel).toHaveBeenCalledWith(noteId, "iconClass", PICKED_ICON);
        setLabel.mockRestore();
    });

    /** Takes an icon from the picker standing in the given editor. */
    async function pickIcon(host: HTMLElement | null | undefined) {
        const button = host?.querySelector<HTMLElement>(".title-editor-icon button");
        if (!button) throw new Error("expected an icon beside the field");

        await act(async () => {
            button.click();
            await flush();
        });
    }

    /**
     * Cards are made at the end of a column, and at its head for the reader adding what comes next
     * rather than what comes last. Both ends are reached from the field: Enter for the end, and
     * Shift+Enter or the button's own menu for the head.
     */
    it("makes a card at the head of the column on Shift+Enter", async () => {
        const { container } = await setup();
        const created = vi.spyOn(BoardApi.prototype, "createNewItem")
            .mockResolvedValue(undefined);
        created.mockClear();
        const slot = container.querySelectorAll<HTMLElement>(".board-column")[1]
            .querySelector<HTMLElement>(".board-new-item");

        await act(async () => {
            slot?.click();
            await flush();
        });

        const editor = slot?.querySelector<HTMLTextAreaElement>("textarea");
        if (!editor) throw new Error("expected the new-item editor to be open");

        await type(editor, "On top");
        await act(async () => {
            editor.dispatchEvent(new KeyboardEvent("keydown",
                { key: "Enter", shiftKey: true, bubbles: true }));
            await flush();
        });

        expect(created).toHaveBeenCalledWith("Doing", "On top", "top", undefined, textTemplate());
        // The field is emptied for the next one, as it is for a card made at the end.
        expect(editor.value).toBe("");
    });

    it("offers both ends of the column from the button's own menu", async () => {
        const { container } = await setup();
        const created = vi.spyOn(BoardApi.prototype, "createNewItem")
            .mockResolvedValue(undefined);
        created.mockClear();
        const show = vi.spyOn(contextMenu, "show").mockImplementation(async () => {});
        const slot = container.querySelectorAll<HTMLElement>(".board-column")[1]
            .querySelector<HTMLElement>(".board-new-item");

        await act(async () => {
            slot?.click();
            await flush();
        });

        const editor = slot?.querySelector<HTMLTextAreaElement>("textarea");
        const button = slot?.querySelector<HTMLElement>(".title-editor-submit");
        if (!editor || !button) throw new Error("expected the editor and its button");

        // Nothing typed: there is nowhere to put a card that is not being made.
        button.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
        expect(show).not.toHaveBeenCalled();

        await type(editor, "Either end");
        button.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));

        const items = show.mock.calls.at(-1)?.[0].items ?? [];
        const entries = items.flatMap(item => item && "title" in item && "handler" in item
            ? [ { title: item.title, shortcut: "shortcut" in item ? item.shortcut : undefined,
                  handler: item.handler } ]
            : []);
        expect(entries.map(entry => [ entry.title, entry.shortcut ])).toEqual([
            [ "board_view.create-at-top", "Shift+Enter" ],
            [ "board_view.create-at-bottom", "Enter" ]
        ]);

        await act(async () => {
            entries[0]?.handler?.({} as never, {} as never);
            await flush();
        });
        expect(created).toHaveBeenCalledWith("Doing", "Either end", "top", undefined, textTemplate());
        expect(editor.value).toBe("");

        show.mockRestore();
    });

    /** A finger has no second button, so it holds the create button to reach the same menu. */
    it("opens the placement menu on a hold, and gives it up for a scroll", async () => {
        const { container } = await setup();
        const show = vi.spyOn(contextMenu, "show").mockImplementation(async () => {});
        const slot = container.querySelectorAll<HTMLElement>(".board-column")[1]
            .querySelector<HTMLElement>(".board-new-item");

        await act(async () => {
            slot?.click();
            await flush();
        });

        const editor = slot?.querySelector<HTMLTextAreaElement>("textarea");
        const button = slot?.querySelector<HTMLElement>(".title-editor-submit");
        if (!editor || !button) throw new Error("expected the editor and its button");
        await type(editor, "Held");

        // Only now: the board is drawn through timers of its own, which would never come round.
        vi.useFakeTimers();

        const press = (type: string, at: number, pointerType = "touch") =>
            button.dispatchEvent(new PointerEvent(type, {
                bubbles: true, pointerType, clientX: at, clientY: at
            }));

        // A finger that walks away is scrolling the board, and the menu is not what it asked for.
        press("pointerdown", 0);
        press("pointermove", 40);
        vi.advanceTimersByTime(1000);
        expect(show).not.toHaveBeenCalled();

        press("pointerdown", 0);
        vi.advanceTimersByTime(1000);
        expect(show).toHaveBeenCalled();

        // The press ends in a click of its own, which must not reach the page and close the menu.
        const reached = vi.fn();
        document.addEventListener("click", reached);
        button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        document.removeEventListener("click", reached);
        expect(reached).not.toHaveBeenCalled();

        // A mouse has its own way there, so holding it down offers nothing.
        show.mockClear();
        press("pointerdown", 0, "mouse");
        vi.advanceTimersByTime(1000);
        expect(show).not.toHaveBeenCalled();

        vi.useRealTimers();
        show.mockRestore();
    });

    /**
     * With nothing typed there is nothing to save, so the button reaches for a note that exists
     * already instead, and goes back to making one as soon as the field holds anything.
     */
    it("offers an existing note from the new-item button while the field is empty", async () => {
        const { container } = await setup();
        const chosen = vi.spyOn(dialog, "chooseNote").mockResolvedValue("existing");
        const added = vi.spyOn(BoardApi.prototype, "addExistingItem").mockResolvedValue(true);
        const slot = container.querySelectorAll<HTMLElement>(".board-column")[1]
            .querySelector<HTMLElement>(".board-new-item");

        await act(async () => {
            slot?.click();
            await flush();
        });

        const editor = slot?.querySelector<HTMLTextAreaElement>("textarea");
        const button = () => slot?.querySelector<HTMLElement>(".title-editor-submit");
        if (!editor) throw new Error("expected the editor");
        expect(button()?.className).toContain("bx-folder-open");

        await act(async () => {
            slot?.querySelector<HTMLElement>(".title-editor-submit")
                ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
            await flush();
        });
        expect(chosen).toHaveBeenCalled();
        // No place given: the field below a column adds the note at the end of it.
        expect(added).toHaveBeenCalledWith("Doing", "existing", undefined);

        await type(editor, "Typed");
        expect(button()?.className).toContain("bx-plus-circle");
    });

    it("starts the new item off with the character typed on its button", async () => {
        const { container } = await setup();
        const slot = container.querySelectorAll<HTMLElement>(".board-column")[1]
            .querySelector<HTMLElement>(".board-new-item");

        await act(async () => {
            slot?.dispatchEvent(new KeyboardEvent("keydown", { key: "R", bubbles: true }));
            await flush();
        });

        const editor = slot?.querySelector<HTMLTextAreaElement>("textarea");
        expect(editor?.value).toBe("R");
        // After the character rather than over it, so the next key carries on.
        expect([ editor?.selectionStart, editor?.selectionEnd ]).toEqual([ 1, 1 ]);
    });

    it("opens the new item empty for Enter, and ignores keys that are not characters", async () => {
        const { container } = await setup();
        const slot = container.querySelectorAll<HTMLElement>(".board-column")[1]
            .querySelector<HTMLElement>(".board-new-item");

        for (const key of [ "Tab", "ArrowRight", "F2" ]) {
            await act(async () => {
                slot?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
                await flush();
            });
        }
        expect(slot?.querySelector("textarea")).toBeNull();

        await act(async () => {
            slot?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
            await flush();
        });
        expect(slot?.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("");
    });

    /**
     * Both boards record the very same rename, so the failing one cannot tell its own record from
     * the live one by looking at it. Each board keeps a map of its own, and the undo writes into
     * the one it recorded itself in, which nothing reads any more.
     */
    it("does not undo the next board's identical rename when the last one fails", async () => {
        const { container } = await setup();

        // Both renames are held open, so both records are live when the first one fails.
        let rejectFirst: (reason: Error) => void = () => {};
        let resolveSecond: () => void = () => {};
        vi.mocked(executeBulkActions)
            .mockImplementationOnce(() => new Promise((_r, reject) => { rejectFirst = reject; }))
            .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }));

        // "Done" on both boards, so neither record can be told from the other by its contents.
        await renameColumnAt(container, 2, "Renamed");

        const other = buildNote({
            title: "Other board",
            "#collection": "",
            "#viewType": "board",
            children: [
                { title: "Fourth", "#status": "Doing" },
                { title: "Fifth", "#status": "Done" }
            ]
        });
        const showOther = async () => {
            await act(async () => {
                render(
                    <ParentComponent.Provider value={new Component()}>
                        <Harness
                            note={other}
                            noteIds={[ ...other.getChildNoteIds() ]}
                            initialConfig={{ columns: [ { value: "Doing" }, { value: "Done" } ] }}
                        />
                    </ParentComponent.Provider>,
                    container
                );
                await flush();
            });
            await act(async () => { await flush(); });
        };

        await showOther();
        await renameColumnAt(container, 1, "Renamed");

        await act(async () => {
            rejectFirst(new Error("offline"));
            await flush();
        });

        // Rendered again, which is what reads the record the failed rename could have taken away.
        await showOther();
        expect(columnTitles(container)).toEqual([ "Doing", "Renamed" ]);

        resolveSecond();
    });

    it("says so when what was typed could not be saved", async () => {
        const { container } = await setup();
        const error = vi.spyOn(toast, "showError").mockImplementation(() => {});
        vi.spyOn(server, "put").mockRejectedValueOnce(new Error("offline"));

        await renameSecondColumn(container, "Renamed");
        await act(async () => { await flush(); });

        expect(error).toHaveBeenCalledWith("board_view.save-error");
    });

    it("lets an IME finish composing before taking the Enter as a save", async () => {
        const { container } = await setup();
        const header = container.querySelectorAll<HTMLElement>(".board-column h3")[1];

        await act(async () => {
            startEditingTitle(header.closest(".board-column") as HTMLElement);
            await flush();
        });

        const input = header.querySelector<HTMLInputElement>("input");
        if (!input) throw new Error("expected the title editor");

        // The Enter that commits a CJK conversion must not also close the editor.
        await act(async () => {
            input.focus();
            input.value = "Composing";
            input.dispatchEvent(new KeyboardEvent("keydown", {
                key: "Enter", isComposing: true, bubbles: true, cancelable: true
            }));
            await flush();
        });

        expect(header.querySelector("input")).toBeTruthy();
        expect(saved).toHaveLength(0);
    });

    it("keeps the cards of the renamed column under it", async () => {
        const { container } = await setup();

        await renameSecondColumn(container, "In Progress");

        const cards = [ ...container.querySelectorAll<HTMLElement>(".board-column") ]
            .map(column => [ ...column.querySelectorAll(".board-note .title") ]
                .map(el => el.textContent));
        expect(cards).toEqual([ [ "First" ], [ "Second" ], [ "Third" ] ]);
    });
});

describe("Board editors and menus", () => {
    let container: HTMLElement | undefined;

    beforeEach(() => {
        saved.length = 0;
        vi.restoreAllMocks();
        vi.spyOn(server, "put").mockResolvedValue(undefined);
    });

    afterEach(() => {
        if (container) {
            render(null, container);
            container.remove();
            container = undefined;
        }
    });

    it("opens the add-column editor with Enter, and names the column typed into it", async () => {
        const board = await renderBoard();
        const slot = board.querySelector<HTMLElement>(".board-add-column");

        await act(async () => {
            slot?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
            await flush();
        });

        const input = slot?.querySelector<HTMLInputElement>("input");
        if (!input) throw new Error("expected the column-name editor");

        await act(async () => {
            input.focus();
            input.value = "Blocked";
            input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
            await flush();
        });
        await act(async () => { await flush(); });

        expect(saved.at(-1)?.columns?.map(column => column.value))
            .toEqual([ "To Do", "Done", "Blocked" ]);
    });

    it("says so rather than adding a column the board already has", async () => {
        const board = await renderBoard();
        const message = vi.spyOn(toast, "showMessage").mockImplementation(() => {});

        await addColumnNamed(board, "Done");

        expect(message).toHaveBeenCalled();
        expect(saved).toHaveLength(0);
    });

    it("leaves the title alone when the editor is dismissed with Escape", async () => {
        const board = await renderBoard();
        const header = board.querySelectorAll<HTMLElement>(".board-column h3")[0];

        await act(async () => {
            header.focus();
            header.dispatchEvent(new KeyboardEvent("keydown", { key: "F2", bubbles: true }));
            await flush();
        });

        const input = header.querySelector<HTMLInputElement>("input");
        if (!input) throw new Error("expected the title editor");

        await act(async () => {
            input.focus();
            input.value = "Renamed away";
            input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
            await flush();
        });
        await act(async () => { await flush(); });

        expect(saved).toHaveLength(0);
        expect(columnTitles(board)).toEqual([ "To Do", "Done" ]);
    });

    it("opens the column menu from its button as well as from a right click", async () => {
        const board = await renderBoard();
        const show = vi.spyOn(contextMenu, "show").mockImplementation(async () => {});

        await act(async () => {
            board.querySelector<HTMLElement>(".board-column .column-menu")?.click();
            await flush();
        });

        expect(show).toHaveBeenCalled();
    });

    it("puts a column beside another from the menu, ready to be named", async () => {
        const board = await renderBoard();
        const show = vi.spyOn(contextMenu, "show").mockImplementation(async () => {});

        board.querySelector(".board-column h3")
            ?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));

        const parent = (show.mock.calls.at(-1)?.[0].items ?? [])
            .find(item => item && "uiIcon" in item && item.uiIcon === "bx bx-columns");
        if (!parent || !("items" in parent)) throw new Error("expected an add-column entry");

        const after = (parent.items ?? [])[1];
        if (!after || !("handler" in after)) throw new Error("expected an after entry");

        await act(async () => {
            after.handler?.(after, {} as never);
            await flush();
        });
        await act(async () => { await flush(); });

        expect(saved.at(-1)?.columns?.map(column => column.value))
            .toEqual([ "To Do", "board_view.new-column", "Done" ]);
        // The column it made is the one waiting to be named.
        expect(board.querySelectorAll(".board-column")[1].querySelector("input")).toBeTruthy();
    });

    it("keeps a wheel inside a scrolling column from also scrolling the board", async () => {
        const board = await renderBoard();
        const content = board.querySelector<HTMLElement>(".board-column-content");
        if (!content) throw new Error("expected a scrollable column body");

        Object.defineProperty(content, "scrollHeight", { value: 900, configurable: true });
        Object.defineProperty(content, "clientHeight", { value: 300, configurable: true });

        let reachedBoard = false;
        board.addEventListener("wheel", () => { reachedBoard = true; });
        await act(async () => {
            content.dispatchEvent(new Event("wheel", { bubbles: true }));
            await flush();
        });

        expect(reachedBoard).toBe(false);
    });

    /** Types a name into the add-column editor and commits it by blurring. */
    async function addColumnNamed(board: HTMLElement, name: string) {
        const slot = board.querySelector<HTMLElement>(".board-add-column");
        await act(async () => {
            slot?.click();
            await flush();
        });

        const input = slot?.querySelector<HTMLInputElement>("input");
        if (!input) throw new Error("expected the column-name editor");

        await act(async () => {
            input.focus();
            input.value = name;
            input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
            await flush();
        });
        await act(async () => { await flush(); });
    }

    async function renderBoard() {
        const note = buildNote({
            title: "Board",
            "#collection": "",
            "#viewType": "board",
            children: [
                { title: "First", "#status": "To Do" },
                { title: "Second", "#status": "Done" }
            ]
        });

        const mountPoint = document.createElement("div");
        container = mountPoint;
        document.body.appendChild(mountPoint);

        await act(async () => {
            render(
                <ParentComponent.Provider value={new Component()}>
                    <Harness
                        note={note}
                        noteIds={[ ...note.getChildNoteIds() ]}
                        initialConfig={{ columns: [ { value: "To Do" }, { value: "Done" } ] }}
                    />
                </ParentComponent.Provider>,
                mountPoint
            );
        });
        await act(async () => { await flush(); });

        return mountPoint;
    }
});

describe("Board grouped by a relation", () => {
    let container: HTMLElement | undefined;

    afterEach(() => {
        if (container) {
            render(null, container);
            container.remove();
            container = undefined;
        }
    });

    it("names its columns with a link to the note each stands for", async () => {
        const { board } = await renderRelationBoard();

        // The note's own icon is what a relation column shows, so it offers no picker of its own.
        expect(board.querySelector(".board-column h3 a")).toBeTruthy();
        expect(board.querySelector(".board-column h3 > .column-icon")).toBeNull();
    });

    it("picks a note rather than typing a name when a column is renamed", async () => {
        const { board } = await renderRelationBoard();
        const header = board.querySelector<HTMLElement>(".board-column h3");

        await act(async () => {
            header?.dispatchEvent(new KeyboardEvent("keydown", { key: "F2", bubbles: true }));
            await flush();
        });

        // The note picker, not the plain text box a label column is renamed through. Dismissing it
        // is the autocomplete's own jQuery binding, which does not answer keys under happy-dom.
        expect(header?.querySelector("input.note-autocomplete")).toBeTruthy();
    });

    async function renderRelationBoard() {
        const target = buildNote({ title: "In progress" });
        const note = buildNote({
            title: "Board",
            "#collection": "",
            "#viewType": "board",
            "#board:groupBy": "~status",
            children: [ { title: "First", "~status": target.noteId } ]
        });

        const mountPoint = document.createElement("div");
        container = mountPoint;
        document.body.appendChild(mountPoint);

        await act(async () => {
            render(
                <ParentComponent.Provider value={new Component()}>
                    <BoardView
                        note={note}
                        notePath={`root/${note.noteId}`}
                        noteIds={[ ...note.getChildNoteIds() ]}
                        highlightedTokens={null}
                        viewConfig={{ columns: [ { value: target.noteId } ] }}
                        saveConfig={() => {}}
                        media="screen"
                        onReady={() => {}}
                    />
                </ParentComponent.Provider>,
                mountPoint
            );
        });
        await act(async () => { await flush(); });
        // The link resolves its note path before it renders, which lands a tick later.
        await act(async () => { await flush(); });

        return { board: mountPoint, target };
    }
});

describe("the promoted attributes a card shows", () => {
    let container: HTMLElement;
    let drawn = 0;

    afterEach(() => {
        render(null, container);
        container.remove();
    });

    it("draws every one of them until the board's config arranges them", async () => {
        await draw();

        expect(pills()).toEqual([ "Due: 2026-01-01", "owner: Ada" ]);
    });

    it("draws them in the stored order, and leaves out what is hidden", async () => {
        await draw([ { name: "owner" }, { name: "dueDate", hidden: true } ]);

        expect(pills()).toEqual([ "owner: Ada" ]);
    });

    it("draws an attribute the config has never named, after the ones it has", async () => {
        await draw([ { name: "owner" } ]);

        expect(pills()).toEqual([ "owner: Ada", "Due: 2026-01-01" ]);
    });

    /** A board defining two promoted labels, one card carrying a value for each. */
    async function draw(promotedAttributes?: { name: string, hidden?: boolean }[]) {
        // The cache keeps what a note id was built with, so a card of its own is what keeps this
        // test's values off the one the test before it drew.
        const card = `promotedCard${++drawn}`;
        const note = buildNote({
            title: "Board",
            "#collection": "",
            "#viewType": "board",
            "#label:dueDate(inheritable)": "promoted,alias=Due,single,text",
            "#label:owner(inheritable)": "promoted,single,text",
            children: [
                { id: card, title: "First", "#status": "To Do", "#dueDate": "2026-01-01",
                    "#owner": "Ada" }
            ]
        });

        container = document.body.appendChild(document.createElement("div"));
        await act(async () => {
            render(
                <ParentComponent.Provider value={new Component()}>
                    <Harness
                        note={note}
                        noteIds={[ ...note.getChildNoteIds() ]}
                        initialConfig={{ columns: [ { value: "To Do" } ], promotedAttributes }}
                    />
                </ParentComponent.Provider>,
                container
            );
        });
        await act(async () => { await flush(); });
    }

    function pills() {
        return [ ...container.querySelectorAll(".board-note .user-attribute") ]
            .map(element => element.textContent);
    }
});
