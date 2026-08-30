/**
 * The board's keyboard: the arrows, Home and End walk it, the same with Alt move what is focused,
 * and Space opens a card. Driven through the rendered board rather than the hook, since where focus
 * lands and what it lands on is the whole of what these keys do.
 */
import $ from "jquery";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import appContext from "../../../components/app_context";
import Component from "../../../components/component";
import branches from "../../../services/branches";
import froca from "../../../services/froca";
import server from "../../../services/server";
import { buildNote } from "../../../test/easy-froca";
import { ParentComponent } from "../../react/react_utils";
import BoardView, { BoardViewData } from ".";

vi.mock("../../../services/branches", () => ({
    default: {
        moveBeforeBranch: vi.fn(async () => {}),
        moveAfterBranch: vi.fn(async () => {}),
        cloneNoteToParentNote: vi.fn(async () => {}),
        cloneNoteAfter: vi.fn(async () => {})
    }
}));

vi.mock("../../../services/i18n", () => ({
    t: (key: string) => key,
    translationsInitializedPromise: $.Deferred().resolve()
}));

describe("Board keyboard", () => {
    let container: HTMLElement | undefined;
    const saved: BoardViewData[] = [];

    beforeEach(() => {
        saved.length = 0;
        vi.restoreAllMocks();
        // A mocked module is not a spy, so restoring leaves its calls where the last test left.
        vi.mocked(branches.moveBeforeBranch).mockClear();
        vi.mocked(branches.moveAfterBranch).mockClear();
        vi.spyOn(server, "put").mockResolvedValue(undefined);
    });

    afterEach(() => {
        if (container) {
            render(null, container);
            container.remove();
            container = undefined;
        }
    });

    describe("moving about", () => {
        it("walks a column from its header, through its cards, to its button", async () => {
            const board = await renderBoard();
            focusHeader(board, 0);

            expect(press(board, "ArrowDown")).toBe("First");
            expect(press(board, "ArrowDown")).toBe("Second");
            expect(press(board, "ArrowDown")).toBe("board_view.new-item");

            // The button under the column is the end of it.
            press(board, "ArrowDown");
            expect(focusedName(board)).toBe("board_view.new-item");

            expect(press(board, "ArrowUp")).toBe("Second");
            expect(press(board, "ArrowUp")).toBe("First");
            expect(press(board, "ArrowUp")).toBe("To Do");

            // And its header is the start.
            press(board, "ArrowUp");
            expect(focusedName(board)).toBe("To Do");
        });

        it("crosses to the first card of the next column rather than to its header", async () => {
            const board = await renderBoard();
            focusHeader(board, 0);

            expect(press(board, "ArrowRight")).toBe("Third");
            expect(press(board, "ArrowLeft")).toBe("First");
        });

        it("offers the button of an empty column, and the one that adds a column", async () => {
            const board = await renderBoard();
            focusHeader(board, 2);

            // The third column is empty, so its button is what crossing into it reaches.
            expect(press(board, "ArrowLeft")).toBe("Third");
            expect(press(board, "ArrowRight")).toBe("board_view.new-item");
            expect(press(board, "ArrowRight")).toBe("board_view.add-column");
            expect(press(board, "ArrowRight")).toBe("board_view.add-column");
            expect(press(board, "ArrowLeft")).toBe("board_view.new-item");
        });

        it("jumps to the ends of a column with Home and End", async () => {
            const board = await renderBoard();
            focusHeader(board, 0);

            expect(press(board, "End")).toBe("Second");
            expect(press(board, "Home")).toBe("First");
        });

        /**
         * `Alt+Left` and `Alt+Right` are the app's own back and forward in note history, bound on
         * the document. A key the board answers must not also navigate away from it.
         */
        it("keeps the keys it answers from reaching what else is bound to them", async () => {
            const board = await renderBoard();
            const reachedDocument: string[] = [];
            const listener = (e: Event) => reachedDocument.push((e as KeyboardEvent).key);
            document.addEventListener("keydown", listener);

            try {
                focusCard(board, 0, 0);
                press(board, "ArrowDown");
                press(board, "ArrowRight", { ctrlKey: true });
                // Even at an edge it moves nothing from: the board owns the key while focused.
                focusCard(board, 0, 0);
                press(board, "ArrowLeft", { ctrlKey: true });
                press(board, "PageDown", { ctrlKey: true });
                press(board, "ArrowRight", { ctrlKey: true, altKey: true });
                press(board, " ");

                expect(reachedDocument).toEqual([]);
            } finally {
                document.removeEventListener("keydown", listener);
            }
        });

        /**
         * Going back and forward through notes is bound on the document with Alt and an arrow. A
         * board is no reason for it to stop working, so the board answers to Ctrl instead.
         */
        it("lets Alt and an arrow through to the app's own back and forward", async () => {
            const board = await renderBoard();
            const reachedDocument: string[] = [];
            const listener = (e: Event) => reachedDocument.push((e as KeyboardEvent).key);
            document.addEventListener("keydown", listener);

            try {
                focusCard(board, 0, 0);
                press(board, "ArrowLeft", { altKey: true });
                press(board, "ArrowRight", { altKey: true });

                expect(reachedDocument).toEqual([ "ArrowLeft", "ArrowRight" ]);
                expect(saved).toHaveLength(0);
            } finally {
                document.removeEventListener("keydown", listener);
            }
        });

        it("leaves the keys alone while a title is being edited", async () => {
            const board = await renderBoard();
            const header = board.querySelectorAll<HTMLElement>(".board-column h3")[0];

            await act(async () => {
                header.focus();
                header.dispatchEvent(new KeyboardEvent("keydown", { key: "F2", bubbles: true }));
                await flush();
            });

            const editor = header.querySelector<HTMLInputElement>("input");
            if (!editor) throw new Error("expected the title editor");
            editor.focus();

            editor.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
            expect(document.activeElement).toBe(editor);
        });
    });

    describe("moving what is focused", () => {
        it("moves a card up and down its own column", async () => {
            const board = await renderBoard();
            focusCard(board, 0, 1);

            press(board, "ArrowUp", { ctrlKey: true });
            expect(branches.moveBeforeBranch)
                .toHaveBeenCalledWith([ branchOf(board, "Second") ], branchOf(board, "First"));

            focusCard(board, 0, 0);
            press(board, "ArrowDown", { ctrlKey: true });
            // Placed past the card below it, which is the last, so it goes after that one.
            expect(branches.moveAfterBranch)
                .toHaveBeenCalledWith([ branchOf(board, "First") ], branchOf(board, "Second"));
        });

        it("sends a card to the end of the column beside it, keeping focus", async () => {
            const board = await renderBoard();
            focusCard(board, 0, 0);

            press(board, "ArrowRight", { ctrlKey: true });
            await act(async () => { await flush(); });

            const [ url, body ] = vi.mocked(server.put).mock.calls.at(-1) ?? [];
            expect(url).toBe(`notes/${noteOf(board, "First")}/set-attribute`);
            expect(body).toMatchObject({ name: "status", value: "Doing" });
            expect(branches.moveAfterBranch)
                .toHaveBeenCalledWith([ branchOf(board, "First") ], branchOf(board, "Third"));
        });

        /**
         * The card is drawn again under another parent, so its element is a new one and whatever
         * held focus is gone. Two writes go out, each landing a redraw of its own, and the card is
         * only where it was asked to be after the second.
         */
        it("keeps focus on a card once it has actually crossed to the other column", async () => {
            const board = await renderBoard();
            focusCard(board, 0, 0);
            const moved = noteOf(board, "First");

            press(board, "ArrowRight", { ctrlKey: true });

            // The first redraw arrives before the label the move writes has been applied.
            await redraw();
            expect(focusedName(board)).toBe("First");

            // The second carries it, and the card is drawn afresh in the column beside it.
            setStatus(moved, "Doing");
            await redraw();

            expect(columnOf(board, "First")).toBe(1);
            expect(focusedName(board)).toBe("First");
        });

        it("keeps focus on a card sent to the column on its left", async () => {
            const board = await renderBoard();
            focusCard(board, 1, 0);
            const moved = noteOf(board, "Third");

            press(board, "ArrowLeft", { ctrlKey: true });

            await redraw();
            setStatus(moved, "To Do");
            await redraw();

            expect(columnOf(board, "Third")).toBe(0);
            expect(focusedName(board)).toBe("Third");
        });

        it("carries the column from its header, which holds no card of its own", async () => {
            const board = await renderBoard();
            focusHeader(board, 0);

            press(board, "ArrowRight", { ctrlKey: true });

            expect(saved.at(-1)?.columns?.map(column => column.value))
                .toEqual([ "Doing", "To Do", "Done" ]);
            expect(focusedName(board)).toBe("To Do");
        });

        /**
         * A move still settling holds focus until its card arrives. Opening a note takes focus away
         * on purpose, and the hold would pull it straight back.
         */
        it("stops holding focus once the reader opens a note", async () => {
            const board = await renderBoard();
            const open = vi.spyOn(appContext, "triggerCommand").mockReturnValue(undefined);

            focusCard(board, 0, 0);
            press(board, "ArrowRight", { ctrlKey: true });
            press(board, " ");
            expect(open).toHaveBeenCalled();

            // Focus is let go of, so redrawing around the move does not take it back.
            const elsewhere = document.createElement("input");
            document.body.appendChild(elsewhere);
            elsewhere.focus();

            await redraw();
            expect(document.activeElement).toBe(elsewhere);
            elsewhere.remove();
        });

        it("keeps focus through the redraws that follow a card arriving", async () => {
            const board = await renderBoard();
            focusCard(board, 0, 0);
            const moved = noteOf(board, "First");

            press(board, "ArrowRight", { ctrlKey: true });
            setStatus(moved, "Doing");
            await redraw();
            expect(focusedName(board)).toBe("First");

            // The second write lands its own redraw, and more arrive from elsewhere.
            await redraw();
            await redraw();
            expect(focusedName(board)).toBe("First");
        });

        it("keeps focus on a card sent across and then straight back", async () => {
            const board = await renderBoard();
            focusCard(board, 0, 0);
            const moved = noteOf(board, "First");

            press(board, "ArrowRight", { ctrlKey: true });
            setStatus(moved, "Doing");
            await redraw();
            expect(columnOf(board, "First")).toBe(1);
            expect(focusedName(board)).toBe("First");

            press(board, "ArrowLeft", { ctrlKey: true });
            setStatus(moved, "To Do");
            await redraw();

            expect(columnOf(board, "First")).toBe(0);
            expect(focusedName(board)).toBe("First");
        });

        /**
         * Reordering keeps the card's element and moves it, and a browser blurs an element it
         * moves. happy-dom does not, so the blur is made here; without it the test would pass on
         * a board that loses focus in every browser there is.
         */
        it("takes focus back after a redraw has left it on nothing", async () => {
            const board = await renderBoard();
            focusCard(board, 0, 1);

            press(board, "ArrowUp", { ctrlKey: true });
            (document.activeElement as HTMLElement | null)?.blur();
            await redraw();

            expect(focusedName(board)).toBe("Second");
        });

        it("leaves focus where the reader has since put it", async () => {
            const board = await renderBoard();
            focusCard(board, 0, 1);

            press(board, "ArrowUp", { ctrlKey: true });
            focusHeader(board, 2);
            await redraw();

            expect(focusedName(board)).toBe("Done");
        });

        it("does nothing at the edges it cannot move past", async () => {
            const board = await renderBoard();

            focusCard(board, 0, 0);
            press(board, "ArrowUp", { ctrlKey: true });
            press(board, "PageUp", { ctrlKey: true });
            press(board, "ArrowLeft", { ctrlKey: true });

            focusButton(board, 1);
            press(board, "ArrowUp", { ctrlKey: true });
            press(board, "ArrowLeft", { ctrlKey: true });

            expect(branches.moveBeforeBranch).not.toHaveBeenCalled();
            expect(branches.moveAfterBranch).not.toHaveBeenCalled();
            expect(saved).toHaveLength(0);
        });

        it("moves the column from anywhere within it, keeping focus where it was", async () => {
            const board = await renderBoard();

            focusCard(board, 0, 1);
            press(board, "ArrowRight", { ctrlKey: true, altKey: true });
            expect(saved.at(-1)?.columns?.map(column => column.value))
                .toEqual([ "Doing", "To Do", "Done" ]);
            expect(focusedName(board)).toBe("Second");

            focusButton(board, 1);
            press(board, "ArrowLeft", { ctrlKey: true, altKey: true });
            expect(saved.at(-1)?.columns?.map(column => column.value))
                .toEqual([ "To Do", "Doing", "Done" ]);
            expect(focusedName(board)).toBe("board_view.new-item");
        });

        it("moves no column past either end, and none from the button that adds one", async () => {
            const board = await renderBoard();

            focusCard(board, 0, 0);
            press(board, "ArrowLeft", { ctrlKey: true, altKey: true });

            board.querySelector<HTMLElement>(".board-add-column")?.focus();
            press(board, "ArrowRight", { ctrlKey: true, altKey: true });

            expect(saved).toHaveLength(0);
        });

        it("moves the column its header stands on, keeping focus on that header", async () => {
            const board = await renderBoard();
            focusHeader(board, 0);

            press(board, "ArrowRight", { ctrlKey: true, altKey: true });
            await act(async () => { await flush(); });

            expect(saved.at(-1)?.columns?.map(column => column.value))
                .toEqual([ "Doing", "To Do", "Done" ]);
            expect(focusedName(board)).toBe("To Do");
        });

        it("sends a column to either end with the page keys", async () => {
            const board = await renderBoard();

            focusHeader(board, 1);
            press(board, "PageUp", { ctrlKey: true, altKey: true });
            await act(async () => { await flush(); });
            expect(saved.at(-1)?.columns?.map(column => column.value))
                .toEqual([ "Doing", "To Do", "Done" ]);

            focusHeader(board, 0);
            press(board, "PageDown", { ctrlKey: true, altKey: true });
            await act(async () => { await flush(); });
            expect(saved.at(-1)?.columns?.map(column => column.value))
                .toEqual([ "To Do", "Done", "Doing" ]);
        });
    });

    it("opens the card under the cursor with Space", async () => {
        const board = await renderBoard();
        const open = vi.spyOn(appContext, "triggerCommand").mockReturnValue(undefined);

        focusCard(board, 0, 0);
        press(board, " ");

        expect(open).toHaveBeenCalledWith("openInPopup", { noteIdOrPath: noteOf(board, "First") });
    });

    /** Which column a card is drawn in, counted as the reader sees them. */
    function columnOf(board: HTMLElement, title: string) {
        return [ ...board.querySelectorAll(".board-column") ]
            .findIndex(column => [ ...column.querySelectorAll(".board-note") ]
                .some(card => card.textContent?.includes(title)));
    }

    /** Applies a move the way the server's answer would, which nothing here waits for. */
    function setStatus(noteId: string | undefined, value: string) {
        for (const attribute of froca.getNoteFromCache(noteId ?? "")?.getAttributes() ?? []) {
            if (attribute.name === "status") {
                attribute.value = value;
            }
        }
    }

    /** Draws the board again, as the refresh that follows a write does. */
    async function redraw() {
        await act(async () => {
            render(
                <ParentComponent.Provider value={new Component()}>
                    <BoardView
                        note={boardNote}
                        notePath={`root/${boardNote.noteId}`}
                        noteIds={[ ...boardNote.getChildNoteIds() ]}
                        highlightedTokens={null}
                        viewConfig={{
                            columns: [ { value: "To Do" }, { value: "Doing" }, { value: "Done" } ]
                        }}
                        saveConfig={(config) => saved.push(config)}
                        media="screen"
                        onReady={() => {}}
                    />
                </ParentComponent.Provider>,
                container as HTMLElement
            );
            await flush();
        });
        await act(async () => { await flush(); });
    }

    /** Presses a key on whatever holds focus, answering with what holds it afterwards. */
    function press(
        board: HTMLElement,
        key: string,
        options: { altKey?: boolean, ctrlKey?: boolean } = {}
    ) {
        act(() => {
            document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", {
                key,
                altKey: options.altKey ?? false,
                ctrlKey: options.ctrlKey ?? false,
                bubbles: true,
                cancelable: true
            }));
        });

        return focusedName(board);
    }

    /**
     * What holds focus, named the way the reader would name it. Its own title where it has one, so
     * that a header is not read together with the count beside it.
     */
    function focusedName(board: HTMLElement) {
        const active = document.activeElement;
        if (!active || !board.contains(active)) return null;

        const named = active.querySelector(".title") ?? active;
        return named.textContent?.trim() ?? null;
    }

    function focusHeader(board: HTMLElement, column: number) {
        board.querySelectorAll<HTMLElement>(".board-column h3")[column].focus();
    }

    function focusCard(board: HTMLElement, column: number, item: number) {
        board.querySelectorAll(".board-column")[column]
            .querySelectorAll<HTMLElement>(".board-note")[item].focus();
    }

    function focusButton(board: HTMLElement, column: number) {
        board.querySelectorAll(".board-column")[column]
            .querySelector<HTMLElement>(".board-new-item")?.focus();
    }

    function noteOf(board: HTMLElement, title: string) {
        return [ ...board.querySelectorAll<HTMLElement>(".board-note") ]
            .find(card => card.textContent?.includes(title))?.dataset.noteId;
    }

    function branchOf(board: HTMLElement, title: string) {
        const noteId = noteOf(board, title);
        return [ ...boardNote.getChildBranches() ]
            .find(branch => branch.noteId === noteId)?.branchId;
    }

    let boardNote: ReturnType<typeof buildNote>;

    /** Two columns of cards, one empty column, and the button that adds another. */
    async function renderBoard() {
        boardNote = buildNote({
            title: "Board",
            "#collection": "",
            "#viewType": "board",
            children: [
                { title: "First", "#status": "To Do" },
                { title: "Second", "#status": "To Do" },
                { title: "Third", "#status": "Doing" }
            ]
        });

        const mountPoint = document.createElement("div");
        container = mountPoint;
        document.body.appendChild(mountPoint);

        await act(async () => {
            render(
                <ParentComponent.Provider value={new Component()}>
                    <BoardView
                        note={boardNote}
                        notePath={`root/${boardNote.noteId}`}
                        noteIds={[ ...boardNote.getChildNoteIds() ]}
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
        await act(async () => { await flush(); });

        return mountPoint;
    }

    function flush() {
        return new Promise((resolve) => setTimeout(resolve));
    }
});
