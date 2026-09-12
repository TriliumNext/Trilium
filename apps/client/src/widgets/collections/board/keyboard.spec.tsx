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
import attributes from "../../../services/attributes";
import branches from "../../../services/branches";
import { FLIP_DURATION_MS, FLIP_SETTLE_MS } from "../../react/flip";
import contextMenu from "../../../menus/context_menu";
import froca from "../../../services/froca";
import server from "../../../services/server";
import { buildNote } from "../../../test/easy-froca";
import { ParentComponent } from "../../react/react_utils";
import BoardApi from "./api";
import BoardView, { BoardViewData } from ".";

vi.mock("../../../services/branches", () => ({
    default: {
        moveBeforeBranch: vi.fn(async () => {}),
        moveAfterBranch: vi.fn(async () => {}),
        cloneNoteToParentNote: vi.fn(async () => {}),
        cloneNoteAfter: vi.fn(async () => {}),
        deleteNotes: vi.fn(async () => {})
    }
}));

// The card menu opens with the link items on top, which want a tab manager this spec has none of.
vi.mock("../../../menus/link_context_menu", () => ({
    default: {
        getQuickEditItem: () => ({ title: "Quick edit" }),
        getOpenNoteItem: () => ({ title: "Open note", items: [] }),
        handleLinkContextMenuItem: vi.fn()
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
        vi.mocked(branches.deleteNotes).mockClear();
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
        vi.useRealTimers();
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

        /**
         * What a move sends focus to is carried back to where it came from and let go, which turns
         * the move into a slide. The browser scrolls to where a thing is drawn, so a scroll asked
         * for while that slide runs finds it where it started and leaves the column alone.
         */
        it("brings what it focuses into view once the slide it made has run", async () => {
            const board = await renderBoard();
            const seen = vi.fn();
            for (const card of board.querySelectorAll(".board-note")) {
                Object.defineProperty(card, "scrollIntoView", {
                    value: seen, configurable: true, writable: true
                });
            }

            // Only around the press: the board is drawn with timers of its own to wait for.
            vi.useFakeTimers();
            focusHeader(board, 0);
            press(board, "ArrowDown");
            expect(seen).not.toHaveBeenCalled();

            // Not while the slide is still running, which is the whole point of the wait.
            act(() => { vi.advanceTimersByTime(FLIP_DURATION_MS - 20); });
            expect(seen).not.toHaveBeenCalled();

            act(() => { vi.advanceTimersByTime(FLIP_SETTLE_MS); });
            expect(seen).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });
        });

        it("takes the column to its end for the last card, which a fade stands over", async () => {
            const board = await renderBoard();
            const content = board.querySelector<HTMLElement>(".board-column-content");
            if (!content) throw new Error("expected a scrollable column body");
            const seen = vi.fn();
            for (const card of board.querySelectorAll(".board-note")) {
                Object.defineProperty(card, "scrollIntoView", {
                    value: seen, configurable: true, writable: true
                });
            }
            Object.defineProperty(content, "scrollHeight", {
                value: 640, configurable: true, writable: true
            });
            content.scrollTop = 0;

            vi.useFakeTimers();
            focusHeader(board, 0);
            press(board, "ArrowDown");
            press(board, "ArrowDown");
            act(() => { vi.advanceTimersByTime(FLIP_SETTLE_MS + 10); });

            expect(focusedName(board)).toBe("Second");
            expect(content.scrollTop).toBe(640);
            // And still asked into view, which is what carries the board across to its column.
            expect(seen).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });
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
                press(board, "End", { ctrlKey: true });
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

    describe("the menu key", () => {
        it("asks the focused card and header for their own menus", async () => {
            const board = await renderBoard();
            const show = vi.spyOn(contextMenu, "show").mockResolvedValue(undefined);

            focusCard(board, 0, 0);
            press(board, "ContextMenu");
            expect(show).toHaveBeenCalledTimes(1);
            // The card menu, which is the only one offering to take a note off the board.
            expect(show.mock.calls[0][0].items.some(item =>
                item && "title" in item && item.title === "board_view.remove-from-board"
            )).toBe(true);

            focusHeader(board, 0);
            press(board, "ContextMenu");
            expect(show).toHaveBeenCalledTimes(2);
            expect(show.mock.calls[1][0].items.some(item =>
                item && "title" in item && item.title === "board_view.rename-column")).toBe(true);
        });

        it("leaves the key alone where nothing focused has a menu", async () => {
            const board = await renderBoard();
            const show = vi.spyOn(contextMenu, "show").mockResolvedValue(undefined);

            focusButton(board, 0);
            press(board, "ContextMenu");

            expect(show).not.toHaveBeenCalled();
        });
    });

    describe("taking a card off the board", () => {
        it("strips the grouping label with Delete, leaving the note where it is", async () => {
            const board = await renderBoard();
            const removed = noteOf(board, "First");
            const strip = vi.spyOn(attributes, "removeOwnedLabelByName").mockReturnValue(true);
            focusCard(board, 0, 0);

            press(board, "Delete");

            expect(strip)
                .toHaveBeenCalledWith(expect.objectContaining({ noteId: removed }), "status");
            expect(branches.deleteNotes).not.toHaveBeenCalled();
        });

        /**
         * The inbox holds the cards with no grouping value, so stripping the label would leave the
         * card there rather than off the board. The card's own menu leaves the entry out to match.
         */
        it("leaves Delete unanswered while the inbox column is drawn", async () => {
            const board = await renderBoard(undefined, undefined, [], true);
            const strip = vi.spyOn(attributes, "removeOwnedLabelByName").mockReturnValue(true);
            // The inbox is seeded at the front, so the first card stands in the column after it.
            focusCard(board, 1, 0);

            press(board, "Delete");

            expect(strip).not.toHaveBeenCalled();
            expect(branches.deleteNotes).not.toHaveBeenCalled();
        });

        /** Deleting the note is what takes it off a board drawing the inbox, so Shift still works. */
        it("still deletes the note with Shift and Delete while the inbox is drawn", async () => {
            const board = await renderBoard(undefined, undefined, [], true);
            focusCard(board, 1, 0);

            press(board, "Delete", { shiftKey: true });

            expect(branches.deleteNotes).toHaveBeenCalled();
        });

        it("deletes the note itself with Shift and Delete", async () => {
            const board = await renderBoard();
            const strip = vi.spyOn(attributes, "removeOwnedLabelByName").mockReturnValue(true);
            focusCard(board, 0, 0);

            press(board, "Delete", { shiftKey: true });

            expect(branches.deleteNotes).toHaveBeenCalledWith(
                [ branchOf(board, "First") ], false, false);
            expect(strip).not.toHaveBeenCalled();
        });

        /**
         * The card is about to go, so focus is handed on as the key is pressed rather than left to
         * the redraw: until the card goes it still holds focus, and a redraw reaching the board
         * first would take that for the reader having chosen where to be.
         */
        it("hands focus to the card below the one that goes, before it goes", async () => {
            const board = await renderBoard();
            vi.spyOn(attributes, "removeOwnedLabelByName").mockReturnValue(true);
            const removed = noteOf(board, "First");
            focusCard(board, 0, 0);

            press(board, "Delete");
            expect(focusedName(board)).toBe("Second");

            setStatus(removed, "");
            await redraw();
            expect(focusedName(board)).toBe("Second");
        });

        it("takes every picked-out card off the board, not only the focused one", async () => {
            const board = await renderBoard();
            const strip = vi.spyOn(attributes, "removeOwnedLabelByName").mockReturnValue(true);
            const first = noteOf(board, "First");
            const third = noteOf(board, "Third");
            pick(board, 0, 0);
            pick(board, 1, 0);
            focusCard(board, 0, 0);

            press(board, "Delete");
            await settleWrites();

            expect(strip)
                .toHaveBeenCalledWith(expect.objectContaining({ noteId: first }), "status");
            expect(strip)
                .toHaveBeenCalledWith(expect.objectContaining({ noteId: third }), "status");
            // The card that was never picked out stays where it is.
            expect(strip).toHaveBeenCalledTimes(2);
        });

        it("deletes every picked-out card with Shift and Delete, in one call", async () => {
            const board = await renderBoard();
            pick(board, 0, 0);
            pick(board, 0, 1);
            focusCard(board, 0, 0);

            press(board, "Delete", { shiftKey: true });

            expect(branches.deleteNotes).toHaveBeenCalledWith(
                [ branchOf(board, "First"), branchOf(board, "Second") ], false, false);
        });

        /**
         * The card beside the focused one can be leaving with it, so focus walks past the cards on
         * their way out rather than landing on one about to be drawn no more.
         */
        it("hands focus past the cards going with it", async () => {
            const board = await renderBoard();
            vi.spyOn(attributes, "removeOwnedLabelByName").mockReturnValue(true);
            pick(board, 0, 0);
            pick(board, 0, 1);
            focusCard(board, 0, 0);

            press(board, "Delete");

            // Both cards of the column are going, so what is left to take focus is its button.
            expect(document.activeElement?.classList.contains("board-new-item")).toBe(true);
        });

        /** A card the reader is standing on but has not picked out goes on its own. */
        it("leaves a selection the focused card is no part of alone", async () => {
            const board = await renderBoard();
            const strip = vi.spyOn(attributes, "removeOwnedLabelByName").mockReturnValue(true);
            const second = noteOf(board, "Second");
            pick(board, 0, 1);
            focusCard(board, 0, 0);

            press(board, "Delete");
            await settleWrites();

            expect(strip).toHaveBeenCalledTimes(1);
            expect(strip)
                .not.toHaveBeenCalledWith(expect.objectContaining({ noteId: second }), "status");
        });

        it("takes the whole column off the board from its header, asking first", async () => {
            const board = await renderBoard();
            const strip = vi.spyOn(attributes, "removeOwnedLabelByName").mockReturnValue(true);
            const remove = vi.spyOn(BoardApi.prototype, "confirmAndRemoveColumn")
                .mockResolvedValue(true);
            focusHeader(board, 0);

            press(board, "Delete");

            expect(remove).toHaveBeenCalledWith("To Do");
            // The cards in it are the column'"'"'s to take, not this key'"'"'s.
            expect(strip).not.toHaveBeenCalled();
            expect(branches.deleteNotes).not.toHaveBeenCalled();
        });

        /** Escalating a column would take every note in it, which nothing else here offers. */
        it("leaves Shift and Delete on a header unanswered", async () => {
            const board = await renderBoard();
            const remove = vi.spyOn(BoardApi.prototype, "confirmAndRemoveColumn")
                .mockResolvedValue(true);
            focusHeader(board, 0);

            press(board, "Delete", { shiftKey: true });

            expect(remove).not.toHaveBeenCalled();
            expect(branches.deleteNotes).not.toHaveBeenCalled();
        });
    });

    describe("walking a board with a collapsed column", () => {
        const columnAt = (board: HTMLElement, index: number) =>
            [ ...board.querySelectorAll<HTMLElement>(".board-column") ][index];

        /**
         * A collapsed column draws neither cards nor the button under them, so the walk has only
         * its header to land on. Landing nowhere would carry focus straight past the column.
         */
        it("lands on a collapsed column's header instead of passing it", async () => {
            const board = await renderBoard("Doing");
            focusCard(board, 0, 0);

            press(board, "ArrowRight");

            expect(document.activeElement).toBe(columnAt(board, 1).querySelector("h3"));
            // Landing on it is not opening it.
            expect(columnAt(board, 1).classList.contains("collapsed")).toBe(true);
        });

        it("walks back out of a collapsed header the way it came", async () => {
            const board = await renderBoard("Doing");
            focusCard(board, 0, 0);

            press(board, "ArrowRight");
            press(board, "ArrowLeft");

            expect(focusedName(board)).toBe("First");
        });

        it("opens the column with Space and steps onto its first card", async () => {
            const board = await renderBoard("Doing");
            focusHeader(board, 1);

            press(board, " ");
            await act(async () => { await flush(); });

            expect(columnAt(board, 1).classList.contains("collapsed")).toBe(false);
            expect(focusedName(board)).toBe("Third");
            // Opened by hand, so the column stays open rather than shutting behind the reader.
            expect(saved.at(-1)?.columns?.find(col => col.value === "Doing")?.collapsed)
                .toBeUndefined();
        });

        /** Nothing to step onto, so the column opens and focus stays where it was. */
        it("opens an empty column with Space and leaves focus on its header", async () => {
            const board = await renderBoard("Done");
            focusHeader(board, 2);

            press(board, " ");
            await act(async () => { await flush(); });

            expect(columnAt(board, 2).classList.contains("collapsed")).toBe(false);
            expect(document.activeElement).toBe(columnAt(board, 2).querySelector("h3"));
        });

        it("opens it with Enter too, the header being announced as a button", async () => {
            const board = await renderBoard("Doing");
            focusHeader(board, 1);

            press(board, "Enter");
            await act(async () => { await flush(); });

            expect(columnAt(board, 1).classList.contains("collapsed")).toBe(false);
            expect(focusedName(board)).toBe("Third");
        });

        it("leaves Space and Enter alone on a column that is not collapsed", async () => {
            const board = await renderBoard();
            focusHeader(board, 1);

            press(board, " ");
            press(board, "Enter");

            expect(document.activeElement).toBe(columnAt(board, 1).querySelector("h3"));
            expect(columnAt(board, 1).querySelectorAll(".board-note")).toHaveLength(1);
        });
    });

    describe("moving what is focused", () => {
        /**
         * A collapsed column draws no cards, so the card carried into it would have nothing to be
         * focused on. The column has to open as part of the move.
         */
        it("opens a collapsed column a card is carried into, and focuses the card there", async () => {
            const board = await renderBoard("Doing");
            const columnAt = (index: number) =>
                [ ...board.querySelectorAll<HTMLElement>(".board-column") ][index];

            expect(columnAt(1).classList.contains("collapsed")).toBe(true);

            focusCard(board, 0, 0);
            const moved = noteOf(board, "First");

            press(board, "ArrowRight", { ctrlKey: true });
            await redraw();

            // Open from the moment the move is asked for, not once the write has landed.
            expect(columnAt(1).classList.contains("collapsed")).toBe(false);

            setStatus(moved, "Doing");
            await redraw();

            expect(columnAt(1).classList.contains("collapsed")).toBe(false);
            expect(columnAt(1).querySelectorAll(".board-note")).toHaveLength(2);
            // The card that moved is what focus rests on, as for any other cross-column move.
            expect(columnOf(board, "First")).toBe(1);
            expect(focusedName(board)).toBe("First");
        });

        it("sends every picked-out card to the next column, and leaves them picked out", async () => {
            const board = await renderBoard();
            const write = vi.spyOn(attributes, "setLabel").mockResolvedValue(undefined);
            const first = noteOf(board, "First");
            const second = noteOf(board, "Second");
            pick(board, 0, 0);
            pick(board, 0, 1);
            focusCard(board, 0, 0);

            press(board, "ArrowRight", { ctrlKey: true });
            await settleWrites();

            expect(write).toHaveBeenCalledWith(first, "status", "Doing");
            expect(write).toHaveBeenCalledWith(second, "status", "Doing");
            // One placement for the set, against the card already at the end of that column.
            expect(branches.moveAfterBranch).toHaveBeenCalledExactlyOnceWith(
                [ branchOf(board, "First"), branchOf(board, "Second") ],
                branchOf(board, "Third"));
            expect(pickedNames(board)).toEqual([ "First", "Second" ]);
        });

        /**
         * A move is two writes, the grouping value and the branch position, and each lands a redraw
         * of its own. Drawn only by the first, the cards stand under their new column in the order
         * their old branches give them, and are seen to reorder a moment later.
         */
        it("draws the cards where the move will leave them, before the writes land", async () => {
            const board = await renderBoard();
            // Never answered, so what the board shows is only what it has drawn for itself.
            vi.spyOn(attributes, "setLabel").mockReturnValue(new Promise(() => {}));
            pick(board, 0, 0);
            pick(board, 0, 1);
            focusCard(board, 0, 0);

            press(board, "ArrowRight", { ctrlKey: true });

            // At the end of the column they join, after the card already standing there.
            expect(namesIn(board, 1)).toEqual([ "Third", "First", "Second" ]);
            expect(namesIn(board, 0)).toEqual([]);
        });

        /**
         * The set lands at the end of the column it joins, so the last of them is what the board
         * scrolls to: focus is what `reveal` follows, and the reader is left at the end of what
         * they sent rather than above it.
         */
        it("leaves focus on the last card of the set it has sent", async () => {
            const board = await renderBoard();
            vi.spyOn(attributes, "setLabel").mockResolvedValue(undefined);
            const first = noteOf(board, "First");
            const second = noteOf(board, "Second");
            pick(board, 0, 0);
            pick(board, 0, 1);
            focusCard(board, 0, 0);

            press(board, "ArrowRight", { ctrlKey: true });
            await settleWrites();

            setStatus(first, "Doing");
            setStatus(second, "Doing");
            await redraw();

            expect(focusedName(board)).toBe("Second");
        });

        /** Every card has a neighbour of its own, so there is no one column to send them all to. */
        it("does nothing while the picked-out cards stand in several columns", async () => {
            const board = await renderBoard();
            const write = vi.spyOn(attributes, "setLabel").mockResolvedValue(undefined);
            pick(board, 0, 0);
            pick(board, 1, 0);
            focusCard(board, 0, 0);

            press(board, "ArrowRight", { ctrlKey: true });
            await settleWrites();

            expect(write).not.toHaveBeenCalled();
            expect(pickedNames(board)).toEqual([ "First", "Third" ]);
        });

        /**
         * A move takes nothing away, so a selection the focused card is no part of is left where it
         * stands rather than given up as deleting gives it up.
         */
        it("sends a card that is not picked out on its own", async () => {
            const board = await renderBoard();
            const write = vi.spyOn(attributes, "setLabel").mockResolvedValue(undefined);
            pick(board, 0, 1);
            focusCard(board, 0, 0);

            press(board, "ArrowRight", { ctrlKey: true });
            await settleWrites();

            expect(write).toHaveBeenCalledExactlyOnceWith(noteOf(board, "First"), "status", "Doing");
            expect(pickedNames(board)).toEqual([ "Second" ]);
        });

        it("moves a card up its own column", async () => {
            const board = await renderBoard();
            focusCard(board, 0, 1);

            press(board, "ArrowUp", { ctrlKey: true });

            expect(branches.moveBeforeBranch)
                .toHaveBeenCalledWith([ branchOf(board, "Second") ], branchOf(board, "First"));
        });

        /**
         * A board of its own: the board draws a move as soon as it is asked for, so one press
         * moves the cards the next press is counted against.
         */
        it("moves a card down its own column", async () => {
            const board = await renderBoard();
            focusCard(board, 0, 0);

            press(board, "ArrowDown", { ctrlKey: true });

            // Placed past the card below it, which is the last, so it goes after that one.
            expect(branches.moveAfterBranch)
                .toHaveBeenCalledWith([ branchOf(board, "First") ], branchOf(board, "Second"));
        });

        /** A column of four, so a run of two has cards both above and below it. */
        const deepColumn = () => renderBoard(undefined, undefined, [ "To Do", "To Do" ]);

        it("moves a run of picked-out cards up and down as one", async () => {
            const board = await deepColumn();
            pick(board, 0, 0);
            pick(board, 0, 1);
            focusCard(board, 0, 0);

            // Already at the head, so there is nowhere above for the run to go.
            press(board, "ArrowUp", { ctrlKey: true });
            expect(branches.moveBeforeBranch).not.toHaveBeenCalled();
            expect(branches.moveAfterBranch).not.toHaveBeenCalled();

            // The whole run passes the card below it, in one call and in its own order.
            press(board, "ArrowDown", { ctrlKey: true });
            expect(branches.moveBeforeBranch).toHaveBeenCalledExactlyOnceWith(
                [ branchOf(board, "First"), branchOf(board, "Second") ],
                branchOf(board, "Fifth"));
        });

        it("sends a run of picked-out cards to either end of its column", async () => {
            const board = await deepColumn();
            pick(board, 0, 1);
            pick(board, 0, 2);
            focusCard(board, 0, 1);

            press(board, "End", { ctrlKey: true });
            expect(branches.moveAfterBranch).toHaveBeenCalledExactlyOnceWith(
                [ branchOf(board, "Second"), branchOf(board, "Fourth") ],
                branchOf(board, "Fifth"));

            press(board, "Home", { ctrlKey: true });
            expect(branches.moveBeforeBranch).toHaveBeenCalledExactlyOnceWith(
                [ branchOf(board, "Second"), branchOf(board, "Fourth") ],
                branchOf(board, "First"));
        });

        /**
         * A run is placed one branch at a time, each write landing a redraw of its own, so the
         * cards would be seen shuffling into place one after another.
         */
        it("draws a run where the move leaves it, before the writes land", async () => {
            const board = await deepColumn();
            // Never answered, so what the board shows is only what it has drawn for itself.
            vi.mocked(branches.moveBeforeBranch).mockReturnValue(new Promise(() => {}));
            pick(board, 0, 0);
            pick(board, 0, 1);
            focusCard(board, 0, 0);

            press(board, "ArrowDown", { ctrlKey: true });

            expect(namesIn(board, 0)).toEqual([ "Fourth", "First", "Second", "Fifth" ]);
        });

        /**
         * Cards with others of their own column between them have no one place to be moved to, and
         * a selection reaching into another column has no single order to keep.
         */
        it("moves nothing for picked-out cards that do not stand together", async () => {
            const board = await deepColumn();
            pick(board, 0, 0);
            pick(board, 0, 2);
            focusCard(board, 0, 0);

            for (const key of [ "ArrowDown", "ArrowUp", "Home", "End" ]) {
                press(board, key, { ctrlKey: true });
            }

            expect(branches.moveBeforeBranch).not.toHaveBeenCalled();
            expect(branches.moveAfterBranch).not.toHaveBeenCalled();
        });

        it("moves nothing up or down while the cards stand in several columns", async () => {
            const board = await deepColumn();
            pick(board, 0, 0);
            pick(board, 1, 0);
            focusCard(board, 0, 0);

            press(board, "ArrowDown", { ctrlKey: true });
            press(board, "End", { ctrlKey: true });

            expect(branches.moveBeforeBranch).not.toHaveBeenCalled();
            expect(branches.moveAfterBranch).not.toHaveBeenCalled();
        });

        /** A sorted column decides its own order, so there is nowhere for a card to be sent. */
        it("does not move a card up or down inside a sorted column", async () => {
            const board = await renderBoard(undefined, "title");
            focusCard(board, 0, 1);

            press(board, "ArrowUp", { ctrlKey: true });
            press(board, "Home", { ctrlKey: true });
            focusCard(board, 0, 0);
            press(board, "ArrowDown", { ctrlKey: true });
            press(board, "End", { ctrlKey: true });

            expect(branches.moveBeforeBranch).not.toHaveBeenCalled();
            expect(branches.moveAfterBranch).not.toHaveBeenCalled();
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

        it("sends a card to either end of its column with Ctrl and Home or End", async () => {
            const board = await renderBoard();
            focusCard(board, 0, 1);

            press(board, "Home", { ctrlKey: true });
            expect(branches.moveBeforeBranch).toHaveBeenCalled();

            focusCard(board, 0, 0);
            press(board, "End", { ctrlKey: true });
            expect(branches.moveAfterBranch).toHaveBeenCalled();
        });

        it("sends a card the whole way with Ctrl, Shift and a sideways arrow", async () => {
            const board = await renderBoard();
            focusCard(board, 1, 0);
            const moved = noteOf(board, "Second");

            press(board, "ArrowRight", { ctrlKey: true, shiftKey: true });
            setStatus(moved, "Done");
            await redraw();
            expect(columnOf(board, "Second")).toBe(2);

            press(board, "ArrowLeft", { ctrlKey: true, shiftKey: true });
            setStatus(moved, "To Do");
            await redraw();
            expect(columnOf(board, "Second")).toBe(0);
        });

        it("moves no card already standing at the end it is sent to", async () => {
            const board = await renderBoard();
            focusCard(board, 0, 0);

            press(board, "ArrowLeft", { ctrlKey: true, shiftKey: true });

            expect(branches.moveAfterBranch).not.toHaveBeenCalled();
            expect(columnOf(board, "First")).toBe(0);
        });

        it("does nothing at the edges it cannot move past", async () => {
            const board = await renderBoard();

            focusCard(board, 0, 0);
            press(board, "ArrowUp", { ctrlKey: true });
            press(board, "Home", { ctrlKey: true });
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

        it("puts a new column after the one focus is in, and before it with Shift", async () => {
            const board = await renderBoard();

            focusCard(board, 1, 0);
            press(board, "Enter", { ctrlKey: true });
            await act(async () => { await flush(); });
            expect(saved.at(-1)?.columns?.map(column => column.value))
                .toEqual([ "To Do", "Doing", "board_view.new-column", "Done" ]);

            focusHeader(board, 0);
            press(board, "Enter", { ctrlKey: true, shiftKey: true });
            await act(async () => { await flush(); });
            expect(saved.at(-1)?.columns?.map(column => column.value))
                .toEqual([
                    "board_view.new-column 2", "To Do", "Doing", "board_view.new-column", "Done"
                ]);
        });

        it("sends a column to either end with Ctrl, Alt and Home or End", async () => {
            const board = await renderBoard();

            focusHeader(board, 1);
            press(board, "Home", { ctrlKey: true, altKey: true });
            await act(async () => { await flush(); });
            expect(saved.at(-1)?.columns?.map(column => column.value))
                .toEqual([ "Doing", "To Do", "Done" ]);

            focusHeader(board, 0);
            press(board, "End", { ctrlKey: true, altKey: true });
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

    /** Space is the card's open gesture, so it redirects where a click on the card would. */
    it("jumps to the redirect target with Space", async () => {
        const board = await renderBoard(undefined, undefined, [], false, true);
        const open = vi.spyOn(appContext, "triggerCommand").mockReturnValue(undefined);
        const setNote = vi.fn();
        const previousTabManager = appContext.tabManager;
        appContext.tabManager = { getActiveContext: () => ({ setNote }) } as never;

        try {
            focusCard(board, 0, 0);
            press(board, " ");
        } finally {
            // Put back before the assertions: a stub left standing reaches every later test.
            appContext.tabManager = previousTabManager;
        }

        expect(setNote).toHaveBeenCalledWith("targetNote");
        expect(open).not.toHaveBeenCalled();
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
        options: { altKey?: boolean, ctrlKey?: boolean, shiftKey?: boolean } = {}
    ) {
        act(() => {
            document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", {
                key,
                altKey: options.altKey ?? false,
                ctrlKey: options.ctrlKey ?? false,
                shiftKey: options.shiftKey ?? false,
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

    /**
     * Lets a fan-out finish. The cards are written one after another, each awaiting the one before
     * it, so a single turn of the microtask queue reaches only the first of them.
     */
    async function settleWrites() {
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    }

    /** Picks a card out the way Ctrl and a click do. */
    function pick(board: HTMLElement, column: number, item: number) {
        const card = board.querySelectorAll(".board-column")[column]
            .querySelectorAll<HTMLElement>(".board-note")[item];
        act(() => {
            card.dispatchEvent(new MouseEvent(
                "click", { bubbles: true, cancelable: true, detail: 1, ctrlKey: true }));
        });
    }

    /** The cards of one column, by title, in the order the board draws them. */
    function namesIn(board: HTMLElement, column: number) {
        return [ ...board.querySelectorAll(".board-column")[column]
            .querySelectorAll(".board-note") ]
            .map((card) => card.querySelector(".title")?.textContent?.trim());
    }

    /** The cards picked out, by title, in the order the board draws them. */
    function pickedNames(board: HTMLElement) {
        return [ ...board.querySelectorAll(".board-note.selected") ]
            .map((card) => card.querySelector(".title")?.textContent?.trim());
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

    /**
     * Two columns of cards, one empty column, and the button that adds another.
     *
     * @param extra the cards to add beyond the three, each named by the column it stands in. Only
     * the tests about moving a run of them need a column deep enough to hold one.
     */
    async function renderBoard(
        collapsed?: string, orderBy?: string, extra: string[] = [], inbox = false,
        redirect = false
    ) {
        boardNote = buildNote({
            title: "Board",
            "#collection": "",
            "#viewType": "board",
            ...(inbox ? { "#enableInboxColumn": "true" } : {}),
            children: [
                {
                    title: "First",
                    "#status": "To Do",
                    ...(redirect ? { "~boardCardRedirectTo": "targetNote" } : {})
                },
                { title: "Second", "#status": "To Do" },
                { title: "Third", "#status": "Doing" },
                ...extra.map((status, at) => (
                    { title: [ "Fourth", "Fifth", "Sixth" ][at], "#status": status }))
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
                            columns: [ "To Do", "Doing", "Done" ].map(value => ({
                                value,
                                collapsed: value === collapsed ? true : undefined,
                                orderBy: value === "To Do" ? orderBy : undefined
                            }))
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

/**
 * A column of thousands draws only a slice of its cards, so walking it steps onto cards that are
 * not in the page. The keyboard names a card by the place it holds in the column and asks the
 * column to draw it, rather than counting the ones on screen.
 */
describe("Board keyboard over a windowed column", () => {
    let container: HTMLElement | undefined;
    const CARDS = 400;

    beforeEach(() => {
        vi.restoreAllMocks();
        vi.spyOn(server, "put").mockResolvedValue(undefined);
        vi.spyOn(server, "post").mockResolvedValue(undefined);
    });

    afterEach(() => {
        if (container) {
            render(null, container);
            container.remove();
            container = undefined;
        }
    });

    it("draws fewer cards than it holds, and states what it holds", async () => {
        const board = await renderBig();
        const area = board.querySelector<HTMLElement>(".board-column-content");

        expect(area?.dataset.windowCount).toBe(String(CARDS));
        expect(area?.querySelectorAll(".board-note").length).toBeLessThan(CARDS);
    });

    it("walks onto a card the column is not drawing, and focuses it", async () => {
        const board = await renderBig();
        const column = board.querySelector<HTMLElement>(".board-column");
        const drawn = [ ...(column?.querySelectorAll<HTMLElement>(".board-note") ?? []) ];
        const last = drawn[drawn.length - 1];
        if (!column || !last) throw new Error("expected the column to draw some cards");

        const beyond = Number(last.dataset.index) + 1;
        expect(column.querySelector(`.board-note[data-index="${beyond}"]`)).toBeNull();

        last.focus();
        await act(async () => {
            last.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
            await flush();
        });

        const arrived = column.querySelector<HTMLElement>(`.board-note[data-index="${beyond}"]`);
        expect(arrived).not.toBeNull();
        expect(document.activeElement).toBe(arrived);
    });

    it("takes End to the last card of the column, not the last one drawn", async () => {
        const board = await renderBig();
        const first = board.querySelector<HTMLElement>(".board-note");
        if (!first) throw new Error("expected a card");

        first.focus();
        await act(async () => {
            first.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
            await flush();
        });

        const focused = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>(".board-note");
        expect(focused?.dataset.index).toBe(String(CARDS - 1));
    });

    it("walks back up out of the window it moved to", async () => {
        const board = await renderBig();
        const first = board.querySelector<HTMLElement>(".board-note");
        if (!first) throw new Error("expected a card");

        first.focus();
        await act(async () => {
            first.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
            await flush();
        });

        const atEnd = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>(".board-note");
        if (!atEnd) throw new Error("expected End to land on a card");

        await act(async () => {
            atEnd.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
            await flush();
        });

        const home = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>(".board-note");
        expect(home?.dataset.index).toBe("0");
    });

    /**
     * The card lands at the end of a column that is not drawing its end, so there is nothing in the
     * page to focus. The board asks that column for it and focuses it once it has been drawn.
     */
    it("focuses a card sent into a column that is not drawing where it lands", async () => {
        const board = await renderBig();
        const columns = board.querySelectorAll<HTMLElement>(".board-column");
        const sent = columns[1]?.querySelector<HTMLElement>(".board-note");
        if (!sent) throw new Error("expected a card in the small column");

        const noteId = sent.dataset.noteId;
        sent.focus();
        await act(async () => {
            sent.dispatchEvent(new KeyboardEvent("keydown", {
                key: "ArrowLeft", ctrlKey: true, bubbles: true, cancelable: true
            }));
            await flush();
        });
        // The reveal waits for the column to draw the card, which takes a frame.
        await act(async () => { await frame(); await flush(); });
        await act(async () => { await frame(); await flush(); });

        const arrived = board.querySelector<HTMLElement>(`.board-note[data-note-id="${noteId}"]`);
        expect(arrived).not.toBeNull();
        expect(arrived?.closest(".board-column")).toBe(columns[0]);
        expect(document.activeElement).toBe(arrived);
    });

    function frame() {
        return new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    }

    async function renderBig() {
        const note = buildNote({
            title: "Big board",
            "#collection": "",
            "#viewType": "board",
            children: [
                ...Array.from({ length: CARDS }, (_, i) => ({
                    title: `Card ${i}`, "#status": "To Do"
                })),
                { title: "Only", "#status": "Doing" }
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
                            columns: [ { value: "To Do" }, { value: "Doing" } ]
                        }}
                        saveConfig={() => {}}
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
