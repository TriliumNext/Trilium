/**
 * References to a board's columns and cards: the links themselves, and what the board does when it
 * is opened by one.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Component from "../../../components/component";
import type NoteContext from "../../../components/note_context";
import attributes from "../../../services/attributes";
import type { ViewScope } from "../../../services/link";
import toast from "../../../services/toast";
import { buildNote } from "../../../test/easy-froca";
import { ParentComponent } from "../../react/react_utils";
import BoardView, { type BoardViewData } from ".";
import {
    cardReference, columnReference, COLUMN_ID_LENGTH, findColumnById, newColumnId, readColumnId,
    waitFor
} from "./reference";

vi.mock("../../../menus/link_context_menu", () => ({
    default: {
        getQuickEditItem: () => ({ title: "Quick edit" }),
        getOpenNoteItem: () => ({ title: "Open note", items: [] }),
        handleLinkContextMenuItem: () => {}
    }
}));

// i18next is never initialised under test, so every label would read as undefined.
vi.mock("../../../services/i18n", () => ({
    t: (key: string) => key,
    translationsInitializedPromise: Promise.resolve(),
    getCurrentLanguage: () => "en"
}));

const TODO_ID = "colTodo00001";
const DONE_ID = "colDone00001";
const HIGH_ID = "colHigh00001";

describe("board reference links", () => {
    it("names a column and a card in a note path the app can follow", () => {
        const label = { title: "To Do", icon: "bx bx-star", color: "#ff8800" };
        expect(columnReference("root/board123", TODO_ID, label)).toBe(
            `#root/board123?column=${TODO_ID}&columnTitle=To%20Do&columnIcon=bx%20bx-star`
            + "&columnColor=%23ff8800");
        // A column carrying no colour of its own leaves the parameter out.
        expect(columnReference("root/board123", DONE_ID, { title: "Done", icon: "bx bx-circle" }))
            .toBe(`#root/board123?column=${DONE_ID}&columnTitle=Done&columnIcon=bx%20bx-circle`);
        expect(cardReference("root/board123", "card00000001"))
            .toBe("#root/board123?card=card00000001");
    });

    it("escapes what a column id or title could otherwise end the parameter with", () => {
        expect(columnReference("root/board123", "a b&c=d", { title: "x&y", icon: "bx bx-circle" }))
            .toBe("#root/board123?column=a%20b%26c%3Dd&columnTitle=x%26y&columnIcon=bx%20bx-circle");
    });

    it("mints ids of a note id's length, and distinct ones", () => {
        const ids = new Set(Array.from({ length: 200 }, () => newColumnId()));
        expect(ids.size).toBe(200);
        for (const id of ids) {
            expect(id).toHaveLength(COLUMN_ID_LENGTH);
        }
    });
});

describe("finding a column by its id", () => {
    const config: BoardViewData = {
        columns: [ { value: "To Do", id: TODO_ID }, { value: "Done", id: DONE_ID } ],
        priorityViewColumns: [ { value: "High", id: HIGH_ID } ],
        template: "text"
    };

    it("names the grouping that owns the column, the default one included", () => {
        expect(findColumnById(config, TODO_ID)).toEqual({ groupBy: "status", value: "To Do" });
        expect(findColumnById(config, HIGH_ID)).toEqual({ groupBy: "priority", value: "High" });
    });

    it("answers with nothing for an id no grouping holds, and for no config at all", () => {
        expect(findColumnById(config, "colGone00001")).toBeUndefined();
        expect(findColumnById(config, "")).toBeUndefined();
        expect(findColumnById(undefined, TODO_ID)).toBeUndefined();
    });

    it("looks past the keys that hold something other than columns", () => {
        // `template` is a string, and a key whose value is not a list of columns must not be walked
        // as though it were.
        expect(() => findColumnById(config, TODO_ID)).not.toThrow();
        expect(findColumnById({ template: "text" } as BoardViewData, TODO_ID)).toBeUndefined();
    });

    it("reads the id stored for one grouping's column", () => {
        expect(readColumnId(config, "status", "To Do")).toBe(TODO_ID);
        expect(readColumnId(config, "priority", "High")).toBe(HIGH_ID);
        expect(readColumnId(config, "status", "High")).toBeUndefined();
        expect(readColumnId(undefined, "status", "To Do")).toBeUndefined();
    });
});

describe("waiting for what a reference names", () => {
    it("hands over the element as soon as one is found", async () => {
        const element = document.createElement("div");
        const found = vi.fn();
        let looks = 0;

        waitFor(() => (++looks < 3 ? null : element), found, () => false);
        await frames(5);

        expect(found).toHaveBeenCalledWith(element);
        expect(looks).toBe(3);
    });

    /**
     * `BoardView` is reused when the pane moves to another board, and two boards often name a
     * column the same, so a poll left running would reveal the wrong board's column.
     */
    it("stops looking once the board it was started for is gone", async () => {
        const element = document.createElement("div");
        const found = vi.fn();
        let looks = 0;
        let isGone = false;

        waitFor(() => (++looks < 4 ? null : element), found, () => isGone);
        await frames(2);
        isGone = true;
        const lookedBefore = looks;
        await frames(5);

        expect(found).not.toHaveBeenCalled();
        expect(looks).toBe(lookedBefore);
    });

    it("gives up rather than looking for ever", async () => {
        const found = vi.fn();
        let looks = 0;

        waitFor(() => { looks++; return null; }, found, () => false, 3);
        await frames(8);

        expect(found).not.toHaveBeenCalled();
        // The first look plus one for each retry.
        expect(looks).toBe(4);
    });
});

describe("opening a board by a reference", () => {
    let container: HTMLElement | undefined;
    let messages: string[] = [];
    let idSeed = 0;
    /** The component each mount was drawn under, for a test that draws a second board into it. */
    const mounted = new Map<HTMLElement, Component>();

    beforeEach(() => {
        vi.restoreAllMocks();
        messages = [];
        vi.spyOn(toast, "showMessage").mockImplementation((message) => {
            messages.push(String(message));
        });
        // happy-dom lays nothing out, so what a reveal scrolls is only ever asked for.
        vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
    });

    afterEach(() => {
        if (container) {
            render(null, container);
            container.remove();
            container = undefined;
        }
    });

    it("puts the focus on the column a reference names", async () => {
        const { mountPoint } = await renderBoard({ column: DONE_ID });

        expect(focusedColumn(mountPoint)).toBe("Done");
        expect(messages).toEqual([]);
    });

    it("clears the reference as it reads it, so a restored tab does not jump again", async () => {
        const { viewScope, mountPoint } = await renderBoard({ column: DONE_ID });

        expect(viewScope.column).toBeUndefined();
        expect(viewScope.card).toBeUndefined();

        // Nothing left to act on, so a later draw leaves the focus where the reader put it.
        mountPoint.querySelector<HTMLElement>(".board-column h3")?.focus();
        await settle();
        expect(focusedColumn(mountPoint)).toBe("To Do");
    });

    it("puts the focus on the card a reference names", async () => {
        const { mountPoint, second } = await renderBoard({ card: undefined }, (ids) => ({
            card: ids.second
        }));

        expect(document.activeElement).toBe(
            mountPoint.querySelector(`.board-note[data-note-id="${second}"]`));
    });

    it("opens a collapsed column a reference names, without storing it as open", async () => {
        const saved: BoardViewData[] = [];
        const { mountPoint } = await renderBoard({ column: DONE_ID }, undefined, {
            columns: [
                { value: "To Do", id: TODO_ID },
                { value: "Done", id: DONE_ID, collapsed: true }
            ]
        }, false, saved);

        expect(columnNamed(mountPoint, "Done")?.classList.contains("collapsed")).toBe(false);
        expect(focusedColumn(mountPoint)).toBe("Done");
        // A peek, so `collapsed` is left standing and the column shuts again on the next selection.
        expect(saved).toEqual([]);
    });

    it("opens a collapsed column to show the card inside it", async () => {
        const { mountPoint, second } = await renderBoard({}, (ids) => ({ card: ids.second }), {
            columns: [
                { value: "To Do", id: TODO_ID },
                { value: "Done", id: DONE_ID, collapsed: true }
            ]
        });

        const done = columnNamed(mountPoint, "Done");
        expect(done?.classList.contains("collapsed")).toBe(false);
        expect(document.activeElement).toBe(
            mountPoint.querySelector(`.board-note[data-note-id="${second}"]`));
    });

    it("switches the board to the grouping that owns the column", async () => {
        const setLabel = vi.spyOn(attributes, "setLabel").mockResolvedValue(undefined);

        await renderBoard({ column: HIGH_ID }, undefined, {
            columns: [ { value: "To Do", id: TODO_ID } ],
            priorityViewColumns: [ { value: "High", id: HIGH_ID } ]
        });

        expect(setLabel).toHaveBeenCalledWith(expect.any(String), "board:groupBy", "priority");
        // Asked for once, however many times the board draws while the label comes back.
        expect(setLabel.mock.calls.filter(([ , name ]) => name === "board:groupBy")).toHaveLength(1);
    });

    it("says so when the column a reference names is no longer on the board", async () => {
        await renderBoard({ column: "colGone00001" });

        expect(messages).toEqual([ "board_view.reference-column-missing" ]);
    });

    it("says an archived column is not being shown rather than waiting for it", async () => {
        await renderBoard({ column: DONE_ID }, undefined, {
            columns: [
                { value: "To Do", id: TODO_ID },
                { value: "Done", id: DONE_ID, archived: true }
            ]
        });

        expect(messages).toEqual([ "board_view.reference-archived" ]);
        expect(columnNamed(container as HTMLElement, "Done")).toBeFalsy();
    });

    it("says an archived card is not being shown", async () => {
        const { second } = await renderBoard({}, (ids) => ({ card: ids.second }), undefined, true);

        expect(messages).toEqual([ "board_view.reference-archived" ]);
        expect(second).toBeTruthy();
    });

    it("says a card the board does not hold at all is missing", async () => {
        await renderBoard({ card: "card99999999" });

        expect(messages).toEqual([ "board_view.reference-missing" ]);
    });

    /**
     * `BoardView` is drawn unkeyed, so moving from one board to another reuses the instance. A
     * reference that never settled, because the column it names is still being waited for, would
     * otherwise be taken up by whichever board came next.
     */
    it("drops a reference the board it was taken for has been left", async () => {
        // Its grouping is switched to, which the label never comes back for here, so the reference
        // is still waiting when the next board is drawn.
        vi.spyOn(attributes, "setLabel").mockResolvedValue(undefined);
        const { mountPoint, note } = await renderBoard({ column: HIGH_ID }, undefined, {
            columns: [ { value: "To Do", id: TODO_ID } ],
            priorityViewColumns: [ { value: "High", id: HIGH_ID } ]
        });

        const next = buildNote({
            title: "Other board",
            type: "book",
            "#collection": "",
            "#viewType": "board",
            children: [ { title: "Elsewhere", "#status": "High" } ]
        });
        expect(next.noteId).not.toBe(note.noteId);

        await act(async () => {
            render(
                <ParentComponent.Provider value={parentOf(mountPoint)}>
                    <BoardView
                        note={next}
                        notePath={`root/${next.noteId}`}
                        noteIds={[ ...next.getChildNoteIds() ]}
                        highlightedTokens={null}
                        viewConfig={{ columns: [ { value: "High", id: HIGH_ID } ] }}
                        saveConfig={() => {}}
                        media="screen"
                        onReady={() => {}}
                    />
                </ParentComponent.Provider>,
                mountPoint
            );
        });
        await settle();

        // The board that followed holds a column of that very id, and is left alone all the same.
        expect(focusedColumn(mountPoint)).toBeUndefined();
        expect(messages).toEqual([]);
    });

    /** The provider the board was mounted under, so the second render keeps the same one. */
    function parentOf(mountPoint: HTMLElement) {
        return mounted.get(mountPoint) as Component;
    }

    /**
     * Draws a board of two cards, one under each column, opened with the given view scope.
     *
     * @param scopeFor names a card by the ids the board was built with, which are only known once
     *                 the notes exist.
     */
    async function renderBoard(
        scope: ViewScope,
        scopeFor?: (ids: { first: string, second: string }) => ViewScope,
        config: BoardViewData = {
            columns: [ { value: "To Do", id: TODO_ID }, { value: "Done", id: DONE_ID } ]
        },
        archiveSecond = false,
        saved?: BoardViewData[]
    ) {
        const first = `refCard${idSeed++}`;
        const second = `refCard${idSeed++}`;
        const note = buildNote({
            title: "Board",
            type: "book",
            "#collection": "",
            "#viewType": "board",
            children: [
                { id: first, title: "First", "#status": "To Do" },
                {
                    id: second,
                    title: "Second",
                    "#status": "Done",
                    ...(archiveSecond ? { "#archived": "" } : {})
                }
            ]
        });

        const viewScope: ViewScope = { ...scope, ...(scopeFor?.({ first, second }) ?? {}) };
        const component = new Component();
        Object.assign(component, {
            noteContext: {
                viewScope,
                notePath: `root/${note.noteId}`,
                setContextData: () => {},
                clearContextData: () => {}
            } as unknown as NoteContext
        });

        const mountPoint = document.createElement("div");
        container = mountPoint;
        document.body.appendChild(mountPoint);

        await act(async () => {
            render(
                <ParentComponent.Provider value={component}>
                    <BoardView
                        note={note}
                        notePath={`root/${note.noteId}`}
                        noteIds={[ first, second ]}
                        highlightedTokens={null}
                        viewConfig={config}
                        saveConfig={(written) => saved?.push(written)}
                        media="screen"
                        onReady={() => {}}
                    />
                </ParentComponent.Provider>,
                mountPoint
            );
        });
        await settle();
        mounted.set(mountPoint, component);

        return { note, mountPoint, viewScope, first, second };
    }
});

/** The title of the column whose heading holds the focus, or nothing where none does. */
function focusedColumn(container: HTMLElement) {
    const heading = [ ...container.querySelectorAll<HTMLElement>(".board-column h3") ]
        .find(candidate => candidate === document.activeElement);
    return heading?.querySelector(".title")?.textContent ?? undefined;
}

function columnNamed(container: HTMLElement, title: string) {
    return [ ...container.querySelectorAll<HTMLElement>(".board-column") ]
        .find(column => column.querySelector(".title")?.textContent === title);
}

/**
 * Lets the board draw and the reveal find what it is waiting for: the reveal polls a frame at a
 * time, and the board resolves its columns a tick after it mounts.
 */
async function settle() {
    for (let round = 0; round < 6; round++) {
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve));
            await new Promise((resolve) => requestAnimationFrame(resolve));
        });
    }
}

/** Lets `requestAnimationFrame` callbacks run the given number of times. */
async function frames(count: number) {
    for (let round = 0; round < count; round++) {
        await act(async () => {
            await new Promise((resolve) => requestAnimationFrame(resolve));
        });
    }
}
