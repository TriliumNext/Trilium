/**
 * The board's drag and drop, which is hand-rolled on the HTML5 events rather than a library: a card
 * moved within the board, and a note dragged in from the tree, cloned or moved depending on
 * whether the board already holds it.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Component from "../../../components/component";
import branches from "../../../services/branches";
import server from "../../../services/server";
import { buildNote } from "../../../test/easy-froca";
import { TREE_CLIPBOARD_TYPE } from "../../note_tree";
import { ParentComponent } from "../../react/react_utils";
import BoardView, { BoardViewData } from ".";
import { CARD_CLIPBOARD_TYPE } from "./card";

vi.mock("../../../services/branches", () => ({
    default: {
        cloneNoteToParentNote: vi.fn(async () => {}),
        cloneNoteAfter: vi.fn(async () => {}),
        moveAfterBranch: vi.fn(async () => {}),
        moveBeforeBranch: vi.fn(async () => {})
    }
}));

/** What Preact registers each handler as where the DOM knows no property of that name. */
const PREACT_DRAG_EVENTS = {
    dragover: "DragOver",
    dragleave: "DragLeave",
    drop: "Drop"
} as const;

describe("Board drag and drop", () => {
    let container: HTMLElement | undefined;

    beforeEach(() => {
        vi.restoreAllMocks();
        vi.mocked(branches.cloneNoteToParentNote).mockClear();
        vi.mocked(branches.cloneNoteAfter).mockClear();
        vi.mocked(branches.moveAfterBranch).mockClear();
        vi.mocked(branches.moveBeforeBranch).mockClear();
        vi.spyOn(server, "put").mockResolvedValue(undefined);
    });

    afterEach(() => {
        if (container) {
            render(null, container);
            container.remove();
            container = undefined;
        }
    });

    it("marks the card a drop would land before, from where the pointer is", async () => {
        const { columns } = await renderBoard();

        // Above the middle of the second card, so the drop lands between the two.
        await drag(columns[0], "dragover", { types: [ CARD_CLIPBOARD_TYPE ] }, 120);

        const placeholders = [ ...columns[0].querySelectorAll(".board-column-content > *") ]
            .map(child => child.className);
        expect(placeholders[1]).toContain("board-drop-placeholder");
    });

    it("clears the mark once the pointer leaves the column altogether", async () => {
        const { columns } = await renderBoard();

        await drag(columns[0], "dragover", { types: [ CARD_CLIPBOARD_TYPE ] }, 120);
        expect(columns[0].querySelector(".board-drop-placeholder")).toBeTruthy();

        await drag(columns[0], "dragleave", { types: [] });
        expect(columns[0].querySelector(".board-drop-placeholder")).toBeNull();
    });

    it("ignores a drag carrying something the board has no use for", async () => {
        const { columns } = await renderBoard();

        await drag(columns[0], "dragover", { types: [ "text/uri-list" ] }, 120);

        expect(columns[0].querySelector(".board-drop-placeholder")).toBeNull();
    });

    it("moves a card dropped from another column of the same board", async () => {
        const { columns, cards } = await renderBoard();
        const payload = {
            noteId: cards[0].noteId,
            branchId: cards[0].branchId,
            fromColumn: "To Do",
            index: 0
        };

        await drag(columns[0], "dragover", { types: [ CARD_CLIPBOARD_TYPE ] }, 120);
        await drag(columns[0], "drop", {
            types: [ CARD_CLIPBOARD_TYPE ],
            data: { [CARD_CLIPBOARD_TYPE]: JSON.stringify(payload) }
        });

        expect(branches.moveBeforeBranch)
            .toHaveBeenCalledWith([ cards[0].branchId ], cards[1].branchId);
    });

    it("clones a note dragged in from the tree, which the board does not hold", async () => {
        const { columns } = await renderBoard();
        const stranger = buildNote({ title: "Stranger" });

        await drag(columns[0], "dragover", { types: [ TREE_CLIPBOARD_TYPE ] }, 0);
        await drag(columns[0], "drop", {
            types: [ TREE_CLIPBOARD_TYPE ],
            data: { text: JSON.stringify([ { noteId: stranger.noteId, branchId: "far" } ]) }
        });

        // Dropped above every card, so it goes in as the first rather than after one.
        expect(branches.cloneNoteToParentNote)
            .toHaveBeenCalledWith(stranger.noteId, expect.any(String));
        expect(branches.cloneNoteAfter).not.toHaveBeenCalled();
    });

    it("clones it after the card it was dropped below", async () => {
        const { columns } = await renderBoard();
        const stranger = buildNote({ title: "Stranger" });

        await drag(columns[0], "dragover", { types: [ TREE_CLIPBOARD_TYPE ] }, 120);
        await drag(columns[0], "drop", {
            types: [ TREE_CLIPBOARD_TYPE ],
            data: { text: JSON.stringify([ { noteId: stranger.noteId, branchId: "far" } ]) }
        });

        expect(branches.cloneNoteAfter).toHaveBeenCalled();
        expect(branches.cloneNoteToParentNote).not.toHaveBeenCalled();
    });

    it("moves rather than clones a note the board already holds", async () => {
        const { columns, cards } = await renderBoard();

        await drag(columns[0], "dragover", { types: [ TREE_CLIPBOARD_TYPE ] }, 120);
        await drag(columns[0], "drop", {
            types: [ TREE_CLIPBOARD_TYPE ],
            data: { text: JSON.stringify([ { ...cards[0] } ]) }
        });

        expect(branches.moveAfterBranch).toHaveBeenCalled();
        expect(branches.cloneNoteToParentNote).not.toHaveBeenCalled();
        expect(branches.cloneNoteAfter).not.toHaveBeenCalled();
    });

    it("does nothing for a drop carrying nothing it can read", async () => {
        const { columns } = await renderBoard();

        await drag(columns[0], "dragover", { types: [ CARD_CLIPBOARD_TYPE ] }, 120);
        await drag(columns[0], "drop", {
            types: [ CARD_CLIPBOARD_TYPE ],
            data: { [CARD_CLIPBOARD_TYPE]: "not json at all" }
        });
        await drag(columns[0], "drop", { types: [ CARD_CLIPBOARD_TYPE ], data: {} });

        expect(branches.moveBeforeBranch).not.toHaveBeenCalled();
        expect(branches.moveAfterBranch).not.toHaveBeenCalled();
    });

    /** A board of one column of two cards, each given a height the pointer can be placed in. */
    async function renderBoard() {
        const note = buildNote({
            title: "Board",
            "#collection": "",
            "#viewType": "board",
            children: [
                { title: "First", "#status": "To Do" },
                { title: "Second", "#status": "To Do" }
            ]
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
                        viewConfig={{ columns: [ { value: "To Do" } ] }}
                        saveConfig={() => {}}
                        media="screen"
                        onReady={() => {}}
                    />
                </ParentComponent.Provider>,
                mountPoint
            );
        });
        await settle();

        const columns = [ ...mountPoint.querySelectorAll<HTMLElement>(".board-column") ];
        // happy-dom lays nothing out, so the cards are given the geometry the drop maths reads.
        for (const [ index, card ] of [ ...columns[0].querySelectorAll(".board-note") ].entries()) {
            card.getBoundingClientRect = () => ({
                top: index * 100, height: 100
            }) as DOMRect;
        }

        const cards = note.getChildBranches()
            .map(branch => ({ noteId: branch.noteId, branchId: branch.branchId }));

        return { note, columns, cards };
    }

    /** Dispatches one of the drag events, with the clipboard the board reads its payload from. */
    async function drag(
        target: HTMLElement,
        type: "dragover" | "dragleave" | "drop",
        clipboard: { types: string[], data?: Record<string, string> },
        clientY = 0
    ) {
        // happy-dom defines no `ondragover`/`ondrop` on elements, and Preact falls back to the
        // prop's own casing where the DOM knows no lowercase one. A `dragover` reaches nothing.
        const known = `on${type}` in document.createElement("div");
        const event = new Event(known ? type : PREACT_DRAG_EVENTS[type], {
            bubbles: true,
            cancelable: true
        });
        // Defined rather than assigned: these are accessors on the event, which a plain assignment
        // does not get past.
        for (const [ name, value ] of Object.entries({
            clientY,
            relatedTarget: null,
            dataTransfer: {
                types: clipboard.types,
                getData: (dataType: string) => clipboard.data?.[dataType] ?? ""
            }
        })) {
            Object.defineProperty(event, name, { value, configurable: true });
        }

        await act(async () => {
            target.dispatchEvent(event);
            await settle();
        });
    }

    function settle() {
        return new Promise((resolve) => setTimeout(resolve));
    }
});

describe("Board column reordering", () => {
    let container: HTMLElement | undefined;
    const saved: BoardViewData[] = [];

    beforeEach(() => {
        saved.length = 0;
        vi.spyOn(server, "put").mockResolvedValue(undefined);
    });

    afterEach(() => {
        if (container) {
            render(null, container);
            container.remove();
            container = undefined;
        }
    });

    it("drops a column to the right of the one it was let go over", async () => {
        const { columns, board } = await renderColumns();

        await dragColumn(columns[0], "dragstart");
        // Past the middle of the last column, which spans 200 to 300, so it lands after it.
        await dragColumn(columns[2], "dragover", 280);
        await dragColumn(board, "drop");

        expect(saved.at(-1)?.columns?.map(column => column.value))
            .toEqual([ "Doing", "Done", "To Do" ]);
    });

    it("drops it to the left when let go over the first half of a column", async () => {
        const { columns, board } = await renderColumns();

        await dragColumn(columns[2], "dragstart");
        // Short of the middle of the second column, which spans 100 to 200.
        await dragColumn(columns[1], "dragover", 120);
        await dragColumn(board, "drop");

        expect(saved.at(-1)?.columns?.map(column => column.value))
            .toEqual([ "To Do", "Done", "Doing" ]);
    });

    it("hides the column being dragged, and shows it again once let go", async () => {
        const { columns } = await renderColumns();

        await dragColumn(columns[0], "dragstart");
        expect(columns[0].style.display).toBe("none");

        await dragColumn(columns[0], "dragend");
        expect(columns[0].style.display).not.toBe("none");
    });

    it("saves nothing for a column let go where it already was", async () => {
        const { columns, board } = await renderColumns();

        await dragColumn(columns[1], "dragstart");
        await dragColumn(columns[1], "dragover", 120);
        await dragColumn(board, "drop");

        expect(saved).toHaveLength(0);
    });

    /** A board of three columns, each given the geometry the drop maths reads. */
    async function renderColumns() {
        const note = buildNote({
            title: "Board",
            "#collection": "",
            "#viewType": "board",
            children: [
                { title: "First", "#status": "To Do" },
                { title: "Second", "#status": "Doing" },
                { title: "Third", "#status": "Done" }
            ]
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
                        viewConfig={{
                            columns: [ { value: "To Do" }, { value: "Doing" }, { value: "Done" } ]
                        }}
                        saveConfig={(config) => saved.push(config)}
                        media="screen"
                        onReady={() => {}}
                    />
                </ParentComponent.Provider>,
                mountPoint
            );
        });
        await settle();

        const columns = [ ...mountPoint.querySelectorAll<HTMLElement>(".board-column") ];
        for (const [ index, column ] of columns.entries()) {
            column.getBoundingClientRect = () => ({
                left: index * 100, width: 100
            }) as DOMRect;
        }

        const board = mountPoint.querySelector<HTMLElement>(".board-view-container");
        if (!board) throw new Error("expected the board container");

        return { columns, board };
    }

    /** Drags by the header, which is the handle, and drops on the board the columns stand in. */
    async function dragColumn(
        target: HTMLElement,
        type: "dragstart" | "dragover" | "dragend" | "drop",
        clientX = 0
    ) {
        const cased = {
            dragstart: "DragStart", dragover: "DragOver", dragend: "DragEnd", drop: "Drop"
        }[type];
        const event = new Event(`on${type}` in target ? type : cased, {
            bubbles: true,
            cancelable: true
        });

        for (const [ name, value ] of Object.entries({
            clientX,
            dataTransfer: { effectAllowed: "", types: [], setData: () => {}, getData: () => "" }
        })) {
            Object.defineProperty(event, name, { value, configurable: true });
        }

        const from = type === "dragstart" || type === "dragend"
            ? target.querySelector("h3") ?? target
            : target;

        await act(async () => {
            from.dispatchEvent(event);
            await settle();
        });
    }

    function settle() {
        return new Promise((resolve) => setTimeout(resolve));
    }
});
