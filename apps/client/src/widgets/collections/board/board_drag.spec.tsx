import { render } from "preact";
import { useRef } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    type BoardDragCallbacks, type DraggedCard, type DropPosition, useBoardDrag
} from "./board_drag";

describe("useBoardDrag, carrying a card", () => {
    let container: HTMLElement | undefined;
    let board: HTMLElement;
    let calls: {
        start: DraggedCard[],
        move: { position: unknown | null, inside: boolean }[],
        end: { card: unknown, position: unknown }[],
        columnStart: { column: string, index: number, size: unknown }[],
        columnMove: (number | null)[],
        columnEnd: { from: number, to: number | null }[]
    };

    beforeEach(() => {
        vi.useFakeTimers();
        calls = {
            start: [], move: [], end: [], columnStart: [], columnMove: [], columnEnd: []
        };
    });

    afterEach(() => {
        vi.useRealTimers();
        if (container) {
            render(null, container);
            container.remove();
            container = undefined;
        }
    });

    it("takes hold once the mouse has moved, and not before", () => {
        setup();

        press(card("n1"), 50, 60);
        expect(calls.start).toHaveLength(0);

        // Within the threshold: still a click, not a drag.
        move(52, 60);
        expect(calls.start).toHaveLength(0);

        move(70, 60);
        expect(calls.start)
            .toEqual([
                { noteId: "n1", noteIds: [ "n1" ], fromColumn: "To Do", index: 0, height: 50 }
            ]);
    });

    it("carries a selection as one card naming how many are on the move", () => {
        setup({ carried: [ "n1", "n2", "n3" ] });

        press(card("n1"), 50, 60);
        move(90, 90);

        expect(calls.start[0]?.noteIds).toEqual([ "n1", "n2", "n3" ]);
        // A blank card holding the count, rather than a copy of the one under the pointer.
        const copy = preview();
        expect(copy?.classList.contains("board-drag-count")).toBe(true);
        expect(copy?.textContent).toBe("3");
        expect(copy?.querySelector(".title")).toBeNull();
    });

    /**
     * A mouse drag is followed by a click on whatever the press and the release have in common,
     * which for a card carried anywhere is the board itself. Left to stand, letting a card go
     * would also read as a click on the board, which is a gesture of its own.
     */
    it("takes the click a mouse drag is followed by", () => {
        setup();
        const reached = vi.fn();
        board.addEventListener("click", reached);

        press(card("n1"), 50, 60);
        move(90, 90);
        release(90, 90);

        const click = new MouseEvent("click", { bubbles: true, cancelable: true });
        card("n2").dispatchEvent(click);

        expect(reached).not.toHaveBeenCalled();
        expect(click.defaultPrevented).toBe(true);

        // The one click, and no more: a press of the reader's own still counts.
        const later = new MouseEvent("click", { bubbles: true, cancelable: true });
        card("n2").dispatchEvent(later);
        expect(reached).toHaveBeenCalledTimes(1);
    });

    /**
     * The gap holds the space the cards will fill, so the column they land in is already the size
     * it will be. Sized for one of them, it would resize around the rest as they arrive.
     */
    it("holds a gap the size of everything being carried", () => {
        setup({ carried: [ "n1", "n2" ] });

        press(card("n1"), 50, 60);
        move(90, 90);

        // Both cards stand 50 tall, and the stylesheet the spacing comes from is not loaded here.
        expect(calls.start[0]?.height).toBe(100);
    });

    /** Two cards on the move leave one card behind the copy. */
    it("stacks one card behind a pair", () => {
        setup({ carried: [ "n1", "n2" ] });

        press(card("n1"), 50, 60);
        move(90, 90);

        expect(preview()?.dataset.layers).toBe("2");
        expect(preview()?.textContent).toBe("2");
    });

    /**
     * The stack says a set is on the move and the number says how big it is, so the stack stops at
     * the depth the stylesheet draws however many cards are carried.
     */
    it("stacks no deeper than three, whatever the selection holds", () => {
        setup({ carried: [ "n1", "n2", "n3", "n4", "n5" ] });

        press(card("n1"), 50, 60);
        move(90, 90);

        expect(preview()?.dataset.layers).toBe("3");
        expect(preview()?.textContent).toBe("5");
    });

    it("carries a copy under the pointer without redrawing the board", () => {
        setup();
        const element = card("n1");

        press(element, 50, 60);
        move(90, 90);
        act(() => { vi.advanceTimersByTime(20); });

        // Shrunk as it is carried, written with the movement so neither can overwrite the other.
        expect(preview()?.style.transform).toBe("translate3d(40px, 30px, 0) scale(0.9)");
        // The card itself is left where it stands, and is not the thing being moved.
        expect(element.style.transform).toBe("");
    });

    /**
     * The copy stands inside the board, so the board's own styling reaches it, and is placed
     * against the window, which the column's scrolling cannot cut off.
     */
    it("lifts the copy out of the column and hides the card behind it", () => {
        setup();
        const element = card("n1");

        press(element, 50, 60);
        move(90, 90);

        const copy = preview();
        // In the layer, not among the board's own children, which Preact places.
        expect(copy?.parentElement).toBe(layer());
        expect(copy?.className).toContain("board-note");
        expect(copy?.style.width).toBe("100px");
        expect(copy?.style.left).toBe("0px");
        // Only one card answers to the id, so nothing looking one up finds the copy.
        expect(copy?.getAttribute("data-note-id")).toBeNull();
        // What the card offers is left behind with it.
        expect(copy?.querySelector(".edit-icon")).toBeNull();
        expect(element.querySelector(".edit-icon")).not.toBeNull();
        expect(element.style.display).toBe("none");
    });

    it("puts the card back and takes the copy away once the gesture is over", () => {
        setup();
        const element = card("n1");

        press(element, 50, 60);
        move(90, 90);
        release(90, 90);

        expect(preview()).toBeNull();
        expect(element.style.display).toBe("");
    });

    it("reports where the card would land, and only when that changes", () => {
        setup();

        press(card("n1"), 50, 60);
        // Taken 20 below its own top edge, so its top stands at 100 on the page, which is 60 into
        // the card area: below the card that is left standing there once this one is picked up, so
        // it goes after it rather than before it.
        move(120, 120);
        act(() => { vi.advanceTimersByTime(20); });
        expect(calls.move.at(-1)?.position).toEqual({ column: "To Do", index: 2 });

        // Still over the same place: nothing is reported again.
        const reported = calls.move.length;
        move(122, 122);
        act(() => { vi.advanceTimersByTime(20); });
        expect(calls.move).toHaveLength(reported);

        // Over the second column, below its only card.
        move(320, 200);
        act(() => { vi.advanceTimersByTime(20); });
        expect(calls.move.at(-1)?.position).toEqual({ column: "Doing", index: 1 });
    });

    /**
     * The columns run 0 to 100 and 200 to 300, so 100 to 200 is between them and is answered for by
     * the nearer of the two without the card standing on either. Only resting on one opens a
     * collapsed column, which is why the two are told apart.
     */
    it("says whether the card stands on the column or merely nearest to it", () => {
        setup();
        const reported = () => calls.move.at(-1);

        press(card("n1"), 50, 60);

        // Between them, nearer the second.
        move(170, 100);
        act(() => { vi.advanceTimersByTime(600); });
        expect(reported()).toMatchObject({ position: { column: "Doing" }, inside: false });

        // Past the last column, which still answers for it so the card has somewhere to go.
        move(320, 100);
        act(() => { vi.advanceTimersByTime(600); });
        expect(reported()).toMatchObject({ position: { column: "Doing" }, inside: false });

        // Standing on it at last, once it has rested there.
        move(250, 100);
        act(() => { vi.advanceTimersByTime(600); });
        expect(reported()).toMatchObject({ position: { column: "Doing" }, inside: true });
    });

    /** Crossing a column on the way somewhere else leaves it as it was found. */
    it("counts a rest on the column, not a passage over it", () => {
        setup();

        press(card("n1"), 50, 60);
        move(250, 100);
        act(() => { vi.advanceTimersByTime(200); });
        expect(calls.move.at(-1)).toMatchObject({ inside: false });

        // Off again before the rest was long enough, so the column it crossed was never stood on.
        // Where it came to rest instead is its own affair, and does count.
        move(50, 100);
        act(() => { vi.advanceTimersByTime(600); });
        expect(calls.move.filter(call =>
            call.inside && (call.position as DropPosition | null)?.column === "Doing")).toEqual([]);
        expect(calls.move.at(-1)).toMatchObject({ position: { column: "To Do" }, inside: true });
    });

    /** The empty space below a collapsed column's heading is not the column. */
    it("does not count the space below a column that is shorter than the board", () => {
        setup();
        // A strip, as a collapsed column is drawn: only as tall as its heading.
        const strip = board.querySelectorAll<HTMLElement>(".board-column")[1];
        strip.getBoundingClientRect = () => ({
            left: 200, top: 0, width: 100, height: 80, right: 300, bottom: 80
        }) as DOMRect;

        press(card("n1"), 50, 60);
        // Held over it, but below where it ends: still the column it would land in, not stood on.
        move(250, 300);
        act(() => { vi.advanceTimersByTime(600); });
        expect(calls.move.at(-1)).toMatchObject({ position: { column: "Doing" }, inside: false });

        // Brought up onto the heading itself.
        move(250, 60);
        act(() => { vi.advanceTimersByTime(600); });
        expect(calls.move.at(-1)).toMatchObject({ inside: true });
    });

    /**
     * The reader takes hold of a card wherever they press, and it is the card's own top edge the
     * gap opens at. Held low in a tall card, the pointer is well below where the card's top sits.
     */
    it("places the card by its top edge, not by where it was taken hold of", () => {
        setup();

        // Taken by its very bottom, so its top stands 48 above the pointer from here on.
        press(card("n1"), 50, 88);
        move(50, 120);
        act(() => { vi.advanceTimersByTime(20); });
        const heldLow = calls.move.at(-1)?.position;

        release(50, 150);
        calls.move.length = 0;

        // Taken by its very top: the same pointer place leaves its top far lower down.
        press(card("n1"), 50, 42);
        move(50, 120);
        act(() => { vi.advanceTimersByTime(20); });

        // One pointer place, two grips, and the card lands where the card is rather than where the
        // pointer is: taken by its foot it sits a place higher than taken by its head.
        expect(heldLow).toEqual({ column: "To Do", index: 1 });
        expect(calls.move.at(-1)?.position).toEqual({ column: "To Do", index: 2 });
    });

    /** Held at the board's edge, the board walks along under what is carried. */
    it("walks the board along while a card is held at its edge", () => {
        setup();
        // The board runs to 500 on screen and holds twice that.
        Object.defineProperty(board, "clientWidth", { value: 500, configurable: true });
        Object.defineProperty(board, "scrollWidth", { value: 1000, configurable: true });
        board.scrollLeft = 100;

        press(card("n1"), 50, 60);
        move(490, 100);
        act(() => { vi.advanceTimersByTime(200); });

        expect(board.scrollLeft).toBeGreaterThan(100);
    });

    it("stops walking it once the gesture is over", () => {
        setup();
        Object.defineProperty(board, "clientWidth", { value: 500, configurable: true });
        Object.defineProperty(board, "scrollWidth", { value: 1000, configurable: true });
        board.scrollLeft = 100;

        press(card("n1"), 50, 60);
        move(490, 100);
        act(() => { vi.advanceTimersByTime(100); });
        release(490, 100);

        const reached = board.scrollLeft;
        act(() => { vi.advanceTimersByTime(500); });
        expect(board.scrollLeft).toBe(reached);
    });

    it("hands the last place it reported to the drop", () => {
        setup();

        press(card("n1"), 50, 60);
        move(320, 200);
        act(() => { vi.advanceTimersByTime(20); });
        release(320, 200);

        expect(calls.end).toEqual([ {
            card: { noteId: "n1", noteIds: [ "n1" ], fromColumn: "To Do", index: 0, height: 50 },
            position: { column: "Doing", index: 1 }
        } ]);
    });

    /** A finger resting is a drag; a finger moving off is the column being scrolled. */
    it("waits for a finger to rest before carrying anything", () => {
        setup();

        press(card("n1"), 100, 100, "touch");
        expect(calls.start).toHaveLength(0);

        act(() => { vi.advanceTimersByTime(399); });
        expect(calls.start).toHaveLength(0);

        act(() => { vi.advanceTimersByTime(2); });
        expect(calls.start).toHaveLength(1);
    });

    it("lets a finger that moves off scroll instead of carrying the card", () => {
        setup();

        press(card("n1"), 100, 100, "touch");
        move(100, 140);
        act(() => { vi.advanceTimersByTime(1000); });

        expect(calls.start).toHaveLength(0);
        expect(calls.end).toHaveLength(0);
    });

    /** The same press carries the card, so the menu it would otherwise open is left out. */
    /** A press that never became a drag is a click, and the click has to reach what was pressed. */
    it("takes the pointer only once something is being carried", () => {
        setup();
        const captured: number[] = [];
        board.setPointerCapture = (id: number) => { captured.push(id); };

        press(card("n1"), 50, 60);
        expect(captured).toEqual([]);

        move(90, 90);
        expect(captured).toEqual([ 1 ]);
    });

    /** A tap asks for the menu, the long press being how a finger picks a card up instead. */
    it("asks a card for its menu when it is tapped", () => {
        setup();
        const element = card("n1");
        const menus: string[] = [];
        element.addEventListener("contextmenu", () => menus.push("card"));

        press(element, 50, 60, "touch");
        release(50, 62, "touch");

        expect(menus).toEqual([ "card" ]);
    });

    /** The heading answers for a column's menu, the column itself holding no handler. */
    it("asks a column's heading for its menu when it is tapped", () => {
        setup();
        const heading = board.querySelector<HTMLElement>(".board-column h3");
        if (!heading) throw new Error("expected a heading");
        const menus: string[] = [];
        heading.addEventListener("contextmenu", () => menus.push("heading"));

        press(heading, 10, 10, "touch");
        release(11, 11, "touch");

        expect(menus).toEqual([ "heading" ]);
    });

    /**
     * A finger has no second button, so a tap is what asks for a menu. The strip is the one place
     * where a tap already means something else: it opens the column, its menu being on the button
     * the strip carries.
     */
    it("leaves a tap on a collapsed column to open it", () => {
        setup();
        const heading = board.querySelector<HTMLElement>(".board-column h3");
        const column = heading?.closest<HTMLElement>(".board-column");
        if (!heading || !column) throw new Error("expected a heading");
        column.classList.add("collapsed");

        const menus: string[] = [];
        const clicks: string[] = [];
        heading.addEventListener("contextmenu", () => menus.push("heading"));
        board.addEventListener("click", () => clicks.push("click"));

        press(heading, 10, 10, "touch");
        release(11, 11, "touch");
        heading.dispatchEvent(new MouseEvent("click", { bubbles: true }));

        expect(menus).toEqual([]);
        expect(clicks).toEqual([ "click" ]);
    });

    it("leaves the click a tap also lands unanswered", () => {
        setup();
        const element = card("n1");
        const clicks: boolean[] = [];
        board.addEventListener("click", (event) => clicks.push(event.defaultPrevented));

        press(element, 50, 60, "touch");
        release(50, 62, "touch");
        act(() => {
            element.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
        });

        expect(clicks).toEqual([]);
    });

    /**
     * A browser follows a tap with mouse events for pages that know nothing of touch. They land on
     * the menu the tap just opened, right under the finger, and the first of them takes it back off
     * again. They are made from `touchend`, so that is where they are refused.
     */
    it("refuses the mouse events a browser would make from a tap", () => {
        setup();

        press(card("n1"), 50, 60, "touch");
        release(50, 62, "touch");

        const followed = new Event("touchend", { bubbles: true, cancelable: true });
        act(() => { document.dispatchEvent(followed); });
        expect(followed.defaultPrevented).toBe(true);

        // Once only: the next touch of the reader's own is theirs to have.
        const later = new Event("touchend", { bubbles: true, cancelable: true });
        act(() => { document.dispatchEvent(later); });
        expect(later.defaultPrevented).toBe(false);
    });

    /** A press that became a drag is not a tap, and its `touchend` is the browser's to answer. */
    it("leaves the touch that carried a card alone", () => {
        setup();

        press(card("n1"), 50, 60, "touch");
        act(() => { vi.advanceTimersByTime(500); });
        move(250, 100);
        release(250, 100, "touch");

        const followed = new Event("touchend", { bubbles: true, cancelable: true });
        act(() => { document.dispatchEvent(followed); });
        expect(followed.defaultPrevented).toBe(false);
    });

    it("leaves a mouse click alone, which is not a tap", () => {
        setup();
        const element = card("n1");
        const menus: string[] = [];
        element.addEventListener("contextmenu", () => menus.push("card"));

        press(element, 50, 60);
        release(50, 60);

        expect(menus).toEqual([]);
    });

    it("keeps a finger's press from opening the menu as well", () => {
        setup();
        const element = card("n1");

        press(element, 100, 100, "touch");
        const swallowed = new Event("contextmenu", { bubbles: true, cancelable: true });
        act(() => { element.dispatchEvent(swallowed); });
        expect(swallowed.defaultPrevented).toBe(true);
    });

    it("leaves a right click's menu alone", () => {
        setup();
        const element = card("n1");

        press(element, 50, 60);
        const allowed = new Event("contextmenu", { bubbles: true, cancelable: true });
        act(() => { element.dispatchEvent(allowed); });
        expect(allowed.defaultPrevented).toBe(false);
    });

    /** A column heading's menu is the only way to reach what it offers on a touch screen. */
    it("leaves a press away from a card with its menu", () => {
        setup();
        const heading = board.querySelector<HTMLElement>(".board-column");
        if (!heading) throw new Error("expected a column");

        press(heading, 50, 60, "touch");
        const allowed = new Event("contextmenu", { bubbles: true, cancelable: true });
        act(() => { heading.dispatchEvent(allowed); });
        expect(allowed.defaultPrevented).toBe(false);
    });

    it("calls the gesture off on Escape, with nowhere to land", () => {
        setup();
        const element = card("n1");

        press(element, 50, 60);
        move(320, 200);
        act(() => { vi.advanceTimersByTime(20); });

        act(() => {
            document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        });

        expect(calls.end).toEqual([ {
            card: { noteId: "n1", noteIds: [ "n1" ], fromColumn: "To Do", index: 0, height: 50 },
            position: null
        } ]);
        expect(element.style.transform).toBe("");
    });

    it("calls the gesture off when the pointer is taken away", () => {
        setup();

        press(card("n1"), 50, 60);
        move(320, 200);
        act(() => { vi.advanceTimersByTime(20); });
        act(() => { board.dispatchEvent(pointer("pointercancel", 320, 200, "mouse")); });

        expect(calls.end.at(-1)).toMatchObject({ position: null });
    });

    it("says nothing at all for a press that never became a drag", () => {
        setup();

        press(card("n1"), 50, 60);
        release(100, 100);

        expect(calls.start).toHaveLength(0);
        expect(calls.end).toHaveLength(0);
    });

    /** The card's own controls keep their press: an editor is not a handle. */
    it("leaves a press on something the card offers alone", () => {
        setup();
        const element = card("n1");
        const button = document.createElement("button");
        element.appendChild(button);

        press(button, 50, 60);
        move(200, 100);

        expect(calls.start).toHaveLength(0);
    });

    it("offers nothing while it is switched off", () => {
        setup({ disabled: true });

        press(card("n1"), 50, 60);
        move(200, 100);

        expect(calls.start).toHaveLength(0);
    });

    describe("the drag Ctrl hands to the browser", () => {
        /**
         * Nothing else reaches the note tree or a board in another split, so a Ctrl press makes the
         * card natively draggable and stands back. `draggable` is set on the press rather than kept
         * on the card, or every ordinary drag would become a native one.
         */
        it("makes the card draggable and opens no gesture of its own", () => {
            setup();
            const element = card("n1");
            // `toBeFalsy`, not `toBe(false)`: happy-dom does not reflect the `draggable` attribute
            // onto the property, so an element nothing has set it on reads undefined.
            expect(element.draggable).toBeFalsy();

            press(element, 50, 60, "mouse", { ctrlKey: true });
            expect(element.draggable).toBe(true);

            move(90, 90);
            expect(calls.start).toHaveLength(0);
        });

        it("puts `draggable` back, whether the press became a drag or stayed a click", () => {
            setup();
            const element = card("n1");

            press(element, 50, 60, "mouse", { ctrlKey: true });
            act(() => { element.dispatchEvent(new Event("dragend", { bubbles: true })); });
            expect(element.draggable).toBe(false);

            // A Ctrl click that never moved delivers no `dragend`, so the release clears it.
            press(element, 50, 60, "mouse", { ctrlKey: true });
            release(50, 60);
            expect(element.draggable).toBe(false);
        });

        it("leaves an ordinary press to the board's own gesture", () => {
            setup();
            const element = card("n1");

            press(element, 50, 60);
            move(90, 90);

            expect(element.draggable).toBeFalsy();
            expect(calls.start).toHaveLength(1);
        });
    });

    describe("carrying a column", () => {
        it("takes hold of it by its heading, and says what it measures", () => {
            setup();

            press(heading(0), 10, 10);
            move(120, 10);

            expect(calls.columnStart)
                .toEqual([ { column: "To Do", index: 0, size: { width: 100, height: 400 } } ]);
            // Nothing was taken for a card, the press having landed on the heading.
            expect(calls.start).toHaveLength(0);
        });

        it("cuts the copy it carries to a set height", () => {
            setup();
            const column = board.querySelector<HTMLElement>(".board-column");

            press(heading(0), 10, 10);
            move(120, 10);

            const copy = board.querySelector<HTMLElement>(".board-column.board-drag-preview");
            expect(copy?.style.maxHeight).toBe("150px");
            expect(copy?.style.height).toBe("");
            expect(copy?.style.width).toBe("100px");
            expect(column?.style.display).toBe("none");
        });

        it("carries the tint of the column a card came from, and none where there is none", () => {
            setup();

            press(card("n1"), 10, 10);
            move(60, 10);
            const tinted = board.querySelector<HTMLElement>(".board-note.board-drag-preview");
            expect(tinted?.classList.contains("column-tinted")).toBe(true);
            expect(tinted?.style.getPropertyValue("--board-column-custom-hue")).toBe("210");
            release(60, 10);

            press(card("n3"), 210, 10);
            move(260, 10);
            const plain = board.querySelector<HTMLElement>(".board-note.board-drag-preview");
            expect(plain?.classList.contains("column-tinted")).toBe(false);
            release(260, 10);
        });

        it("reports the place it would take, counting the columns as they stand", () => {
            setup();

            press(heading(0), 10, 10);
            // The column's middle stands 40 right of the pointer, and short of the second
            // column's own middle at 250.
            move(200, 10);
            act(() => { vi.advanceTimersByTime(20); });
            expect(calls.columnMove.at(-1)).toBe(1);

            move(280, 10);
            act(() => { vi.advanceTimersByTime(20); });
            expect(calls.columnMove.at(-1)).toBe(2);

            release(280, 10);
            expect(calls.columnEnd).toEqual([ { from: 0, to: 2 } ]);
        });

        it("hands back nothing for a gesture called off", () => {
            setup();

            press(heading(0), 10, 10);
            move(280, 10);
            act(() => {
                document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
            });

            expect(calls.columnEnd).toEqual([ { from: 0, to: null } ]);
            expect(board.querySelector(".board-drag-preview")).toBeNull();
        });

        function heading(index: number) {
            const element = [ ...board.querySelectorAll<HTMLElement>(".board-column h3") ][index];
            if (!element) throw new Error(`no heading ${index}`);
            return element;
        }
    });

    /**
     * Two 100px columns, 200 apart, each card 50 tall. The first holds two cards, the second one.
     * happy-dom lays nothing out, so every box is declared.
     */
    function setup({ disabled = false, carried }: {
        disabled?: boolean,
        /** The cards a press answers with, for the tests about carrying a selection. */
        carried?: string[]
    } = {}) {
        const mountPoint = document.createElement("div");
        container = mountPoint;
        document.body.appendChild(mountPoint);

        const callbacks: BoardDragCallbacks = {
            carriedWith: (noteId) => carried ?? [ noteId ],
            onCardStart: (card) => calls.start.push(card),
            onCardMove: (position, inside) => calls.move.push({ position, inside }),
            onCardEnd: (card, position) => calls.end.push({ card, position }),
            onColumnStart: (column, index, size) => calls.columnStart.push({ column, index, size }),
            onColumnMove: (index) => calls.columnMove.push(index),
            onColumnEnd: (from, to) => calls.columnEnd.push({ from, to })
        };

        function Harness() {
            const ref = useRef<HTMLDivElement>(null);
            useBoardDrag(ref, callbacks, disabled);
            return <div ref={ref} className="board-view-container" />;
        }

        act(() => { render(<Harness />, mountPoint); });
        board = mountPoint.firstElementChild as HTMLElement;
        board.appendChild(Object.assign(document.createElement("div"), {
            className: "board-drag-layer"
        }));
        place(board, 0, 0, 500, 400);
        // Writable: the board walks itself along while something is held at its edge.
        Object.defineProperty(board, "scrollLeft", { value: 0, configurable: true, writable: true });

        for (const [ index, cards ] of [ [ "n1", "n2" ], [ "n3" ] ].entries()) {
            const column = document.createElement("div");
            column.className = "board-column";
            column.dataset.column = [ "To Do", "Doing" ][index];
            // The first column is tinted, the second is not, so a copy can be checked against both.
            if (index === 0) {
                column.classList.add("with-hue");
                column.style.setProperty("--board-column-custom-hue", "210");
            }
            board.appendChild(column);
            place(column, index * 200, 0, 100, 400);

            const heading = document.createElement("h3");
            column.appendChild(heading);
            place(heading, index * 200, 0, 100, 40);

            const area = document.createElement("div");
            area.className = "board-column-content";
            column.appendChild(area);
            place(area, index * 200, 40, 100, 360);
            Object.defineProperty(area, "scrollTop", {
                value: 0, configurable: true, writable: true
            });

            for (const [ position, noteId ] of cards.entries()) {
                const note = document.createElement("div");
                note.className = "board-note";
                note.dataset.noteId = noteId;
                note.appendChild(Object.assign(document.createElement("span"), {
                    className: "edit-icon"
                }));
                area.appendChild(note);
                place(note, index * 200, 40 + position * 60, 100, 50);
            }
        }

        // Attached from an effect, which Preact defers past the render.
        act(() => { vi.advanceTimersByTime(20); });
    }

    function preview() {
        return board.querySelector<HTMLElement>(".board-drag-preview");
    }

    function layer() {
        return board.querySelector<HTMLElement>(".board-drag-layer");
    }

    function card(noteId: string) {
        const element = board.querySelector<HTMLElement>(`.board-note[data-note-id="${noteId}"]`);
        if (!element) throw new Error(`no card ${noteId}`);
        return element;
    }

    function place(element: HTMLElement, left: number, top: number, width: number, height: number) {
        element.getBoundingClientRect = () => ({
            left, top, width, height, right: left + width, bottom: top + height
        }) as DOMRect;
    }

    function pointer(
        type: string, clientX: number, clientY: number, pointerType: string,
        modifiers: { ctrlKey?: boolean } = {}
    ) {
        const event = new Event(type, { bubbles: true, cancelable: true });
        for (const [ name, value ] of Object.entries({
            clientX, clientY, pointerId: 1, button: 0, pointerType, ...modifiers
        })) {
            Object.defineProperty(event, name, { value, configurable: true });
        }
        return event;
    }

    function press(
        target: HTMLElement, x: number, y: number, pointerType = "mouse",
        modifiers: { ctrlKey?: boolean } = {}
    ) {
        act(() => {
            target.dispatchEvent(pointer("pointerdown", x, y, pointerType, modifiers));
        });
    }

    function move(x: number, y: number, pointerType = "mouse") {
        act(() => { board.dispatchEvent(pointer("pointermove", x, y, pointerType)); });
    }

    function release(x: number, y: number, pointerType = "mouse") {
        act(() => { board.dispatchEvent(pointer("pointerup", x, y, pointerType)); });
    }
});
