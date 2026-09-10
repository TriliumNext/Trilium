import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { cardInsertionIndex, columnAt } from "./drag_geometry";
import {
    forgetCardHeights, measureBoard, placeInModel, toAreaY, toBoardX
} from "./drag_measure";

let container: HTMLElement | undefined;

// What has been measured outlives one board, which is the point of it, so each test starts with
// nothing remembered.
beforeEach(forgetCardHeights);

afterEach(() => {
    container?.remove();
    container = undefined;
});

/**
 * happy-dom lays nothing out, so every box is declared. The board is placed 50px into the page and
 * scrolled 200px along, which is what tells a content-space measurement from a viewport one.
 */
function buildBoard({ scrollLeft = 200, areaScrollTop = 20, cardCounts = [ 2, 1 ] } = {}) {
    container = document.createElement("div");
    container.className = "board-view-container";
    document.body.appendChild(container);
    place(container, { left: 50, top: 0, width: 500, height: 400 });
    Object.defineProperty(container, "scrollLeft", { value: scrollLeft, configurable: true });

    for (const [ index, cards ] of cardCounts.entries()) {
        const column = document.createElement("div");
        column.className = "board-column";
        column.dataset.column = [ "To Do", "Doing", "Done" ][index];
        container.appendChild(column);
        // On screen the columns have already been scrolled 200px to the left.
        place(column, { left: 50 + index * 120 - scrollLeft, top: 0, width: 100, height: 400 });

        const area = document.createElement("div");
        area.className = "board-column-content";
        column.appendChild(area);
        place(area, { left: 0, top: 40, width: 100, height: 360 });
        Object.defineProperty(area, "scrollTop", { value: areaScrollTop, configurable: true });

        for (let card = 0; card < cards; card++) {
            const note = document.createElement("div");
            note.className = "board-note";
            note.dataset.noteId = `note-${index}-${card}`;
            area.appendChild(note);
            // Stated where the card stands in the area's content, then drawn where that leaves it
            // on screen once the area has been scrolled.
            place(note, {
                left: 0,
                top: 40 + cardContentTop(card) - areaScrollTop,
                width: 100,
                height: 50
            });
        }
    }

    return container;
}

/** Where card `index` stands in its area's content, whatever the area is scrolled to. */
function cardContentTop(index: number) {
    return 10 + index * 60;
}

function place(element: HTMLElement, box: { left: number, top: number, width: number, height: number }) {
    element.getBoundingClientRect = () => ({
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
        right: box.left + box.width,
        bottom: box.top + box.height
    }) as DOMRect;
}

describe("measureBoard", () => {
    it("leaves the copy being carried out of the columns it measures", () => {
        const board = buildBoard();
        const carried = board.querySelector<HTMLElement>(".board-column")?.cloneNode(true);
        if (!(carried instanceof HTMLElement)) throw new Error("expected a column to copy");

        carried.classList.add("board-drag-preview");
        board.appendChild(carried);
        place(carried, { left: 500, top: 0, width: 100, height: 400 });

        // One place per column drawn, and none for the copy: counting it would offer a place one
        // past every place the board has.
        expect(measureBoard(board).columns).toHaveLength(
            board.querySelectorAll(".board-column:not(.board-drag-preview)").length);
    });

    it("places the columns past the board's own scrolling", () => {
        const board = buildBoard();

        const { columns } = measureBoard(board);

        // On screen the first column starts at -150; in the board's content space it starts at 0.
        expect(columns.map((column) => ({ value: column.value, left: column.left })))
            .toEqual([ { value: "To Do", left: 0 }, { value: "Doing", left: 120 } ]);
    });

    it("places the cards past their own column's scrolling", () => {
        const expected = [ { top: 10, height: 50 }, { top: 70, height: 50 } ];

        // The same cards, drawn at different places on screen, measure to the same content.
        expect(measureBoard(buildBoard({ areaScrollTop: 0 })).columns[0].cards).toEqual(expected);
        container?.remove();
        expect(measureBoard(buildBoard({ areaScrollTop: 90 })).columns[0].cards).toEqual(expected);
    });

    it("reads the ends of a column once it knows what the cards between them measure", () => {
        const board = buildBoard({ cardCounts: [ 3, 2 ] });
        const expected = measureBoard(board).columns.map((column) => column.cards);

        const count = () => {
            let reads = 0;
            for (const note of board.querySelectorAll<HTMLElement>(".board-note")) {
                const box = note.getBoundingClientRect.bind(note);
                note.getBoundingClientRect = () => { reads++; return box(); };
            }

            return () => reads;
        };

        // Where a column's cards begin is still its own to say, so the first of them is read, and
        // the last says whether counting up from it still lands where the column does. The one
        // between them is placed by the count alone.
        let reads = count();
        expect(measureBoard(board).columns.map((column) => column.cards)).toEqual(expected);
        expect(reads()).toBe(4);
    });

    /**
     * Nothing announces that a card stands taller than it did: a title can grow a line and an
     * attribute can be promoted onto it while the board is open.
     */
    it("reads every card again once what it remembers no longer lands where the column does", () => {
        const board = buildBoard({ cardCounts: [ 3 ] });
        measureBoard(board);

        // The middle card grows, which moves the one under it. Counting up from the first would
        // put both of them 20px short, the height it remembers for the middle one being the old.
        const cards = board.querySelectorAll<HTMLElement>(".board-note");
        place(cards[1], { left: 0, top: 90, width: 100, height: 80 });
        place(cards[2], { left: 0, top: 180, width: 100, height: 50 });

        expect(measureBoard(board).columns[0].cards)
            .toEqual([ { top: 10, height: 50 }, { top: 70, height: 80 }, { top: 160, height: 50 } ]);
    });

    it("hands back each column's card area, and counts a column holding none", () => {
        const board = buildBoard({ cardCounts: [ 0, 1 ] });

        const { columns, areas } = measureBoard(board);

        expect(columns[0].cards).toEqual([]);
        expect(areas.get("To Do")).toBe(board.querySelector(".board-column-content"));
    });

    /**
     * A strip holds its cards in the page without drawing any of them, so there is nothing in it
     * to place a card against and a card carried over one goes to the front of what it holds.
     */
    it("counts a collapsed column as holding no cards, whatever it holds", () => {
        const board = buildBoard({ cardCounts: [ 3, 1 ] });
        board.querySelector(".board-column")?.classList.add("collapsed");

        const { columns, areas } = measureBoard(board);

        expect(board.querySelectorAll(".board-column")[0].querySelectorAll(".board-note"))
            .toHaveLength(3);
        expect(columns[0].cards).toEqual([]);
        expect(areas.has("To Do")).toBe(false);
    });

    it("counts a column with no card area as holding no cards", () => {
        const board = buildBoard();
        board.querySelector(".board-column-content")?.remove();

        const { columns, areas } = measureBoard(board);

        expect(columns[0].cards).toEqual([]);
        expect(areas.has("To Do")).toBe(false);
    });

    it("measures nothing for a board with no columns", () => {
        container = document.createElement("div");
        document.body.appendChild(container);
        place(container, { left: 0, top: 0, width: 100, height: 100 });

        expect(measureBoard(container).columns).toEqual([]);
    });
});

describe("reading a point against a measurement", () => {
    /** What a move does: two rectangles read, whatever the board holds. */
    it("finds the column and the place a card would take", () => {
        const board = buildBoard();
        const { columns, areas } = measureBoard(board);

        // Over the second column on screen, which starts at -30 and runs 100 wide.
        const column = columnAt(columns, toBoardX(board, 20));
        expect(column?.value).toBe("Doing");

        const area = areas.get("Doing");
        if (!area) throw new Error("expected a card area");

        // Its one card stands at 10 in the area's content and is 50 tall, so its place ends at 60.
        // The area is 20 scrolled and starts 40 down the page, so that end is at 80 on screen.
        expect(cardInsertionIndex(column?.cards ?? [], toAreaY(area, 70))).toBe(0);
        expect(cardInsertionIndex(column?.cards ?? [], toAreaY(area, 90))).toBe(1);
    });

    it("reads a point over the same column the same way however far the board is scrolled", () => {
        for (const scrollLeft of [ 0, 200, 640 ]) {
            const board = buildBoard({ scrollLeft });
            const { columns } = measureBoard(board);

            // Where the first column is drawn moves with the scrolling; what it measures to does
            // not, which is what leaves a measurement good for the whole gesture.
            const onScreen = 50 - scrollLeft + 10;
            expect(toBoardX(board, onScreen)).toBe(10);
            expect(columnAt(columns, toBoardX(board, onScreen))?.value).toBe("To Do");
            board.remove();
        }
    });
});

describe("placeInModel", () => {
    /** The boxes a column of these heights lays out, for comparing against the geometry. */
    const boxesOf = (heights: number[], spacing: number) => {
        let top = 0;
        return heights.map((height) => {
            const box = { top, height };
            top += height + spacing;
            return box;
        });
    };

    /**
     * The model has to answer exactly what the geometry answers from the boxes: it stands in for
     * reading the page, and a column that drifts between the two puts the gap somewhere the drop
     * does not go.
     */
    it("agrees with the geometry at every point down a column", () => {
        const heights = Array.from({ length: 40 }, (_, i) => 40 + (i % 5) * 20);
        const spacing = 9;
        const boxes = boxesOf(heights, spacing);
        const foot = boxes[boxes.length - 1].top + boxes[boxes.length - 1].height;

        for (let y = -20; y < foot + 40; y += 7) {
            expect(placeInModel({ heights, spacing }, y, undefined))
                .toBe(cardInsertionIndex(boxes, y));
        }
    });

    it("agrees with the geometry for a card carried within the same column", () => {
        const heights = Array.from({ length: 30 }, (_, i) => 50 + (i % 3) * 30);
        const spacing = 9;

        for (const carried of [ 0, 7, 29 ]) {
            // The carried card is out of the flow, so the column lays out without it.
            const rest = heights.filter((_, index) => index !== carried);
            const boxes = boxesOf(rest, spacing);
            const foot = boxes[boxes.length - 1].top + boxes[boxes.length - 1].height;

            for (let y = -20; y < foot + 40; y += 11) {
                const place = cardInsertionIndex(boxes, y);
                const expected = place >= carried ? place + 1 : place;
                expect(placeInModel({ heights, spacing }, y, carried)).toBe(expected);
            }
        }
    });

    it("puts a point above the column at the front and one below it at the back", () => {
        const model = { heights: [ 60, 60, 60 ], spacing: 10 };
        expect(placeInModel(model, -500, undefined)).toBe(0);
        expect(placeInModel(model, 99_999, undefined)).toBe(3);
    });

    it("answers for a column holding nothing", () => {
        expect(placeInModel({ heights: [], spacing: 9 }, 40, undefined)).toBe(0);
    });
});

describe("measuring a windowed column", () => {
    /**
     * A column that draws a slice of its cards states what it holds and where the slice begins, and
     * stands a spacer at either end for the rest. The measurement counts those in, so an index it
     * leads to names a place in the column rather than a place among the cards on screen.
     */
    function buildWindowed({ total = 100, from = 40, above = 2400, below = 3300 } = {}) {
        const board = buildBoard({ cardCounts: [ 2 ], areaScrollTop: 0 });
        const area = board.querySelector<HTMLElement>(".board-column-content");
        if (!area) throw new Error("expected a card area");

        area.dataset.windowCount = String(total);
        area.dataset.windowFrom = String(from);

        // The drawn cards stand below the spacer, which is where a windowed column draws them.
        for (const [ index, card ] of [ ...area.querySelectorAll<HTMLElement>(".board-note") ].entries()) {
            place(card, { left: 0, top: 40 + above + 10 + index * 60, width: 100, height: 50 });
        }
        for (const [ index, height ] of [ above, below ].entries()) {
            const spacer = document.createElement("div");
            spacer.className = "board-window-spacer";
            Object.defineProperty(spacer, "offsetHeight", { value: height, configurable: true });
            // The one above stands before the cards, the one below after them.
            if (index === 0) {
                area.insertBefore(spacer, area.firstChild);
            } else {
                area.appendChild(spacer);
            }
        }

        return board;
    }

    it("counts the cards the column is not drawing, so an index names a place in the column", () => {
        const board = buildWindowed();

        const [ column ] = measureBoard(board).columns;

        // Two drawn cards, and the rest of the hundred stood for by the spacers.
        expect(column.cards).toHaveLength(100);
        expect(column.cards[40].height).toBe(50);
        expect(column.cards[41].height).toBe(50);
    });

    it("stands the undrawn cards in order, above the drawn ones and below them", () => {
        const board = buildWindowed();

        const [ column ] = measureBoard(board).columns;
        const tops = column.cards.map((card) => card.top);

        expect(tops).toHaveLength(100);
        // Never doubles back: a drop read against these has to walk them in order.
        for (const [ index, top ] of tops.entries()) {
            if (index > 0) {
                expect(top).toBeGreaterThanOrEqual(tops[index - 1]);
            }
        }
        expect(tops[0]).toBe(0);
        expect(tops[39]).toBeLessThan(tops[40]);
    });

    it("measures a column drawing all of itself exactly as it always did", () => {
        const board = buildBoard({ cardCounts: [ 2 ], areaScrollTop: 0 });

        const [ column ] = measureBoard(board).columns;

        expect(column.cards).toHaveLength(2);
    });

    /**
     * A place counted from the heights alone starts at zero, while a point read into the area's
     * space starts at the column's own top padding. Losing that shifts every place by it, and a
     * point near a boundary lands in the slot below the one the gap is drawn at.
     */
    it("reports where the column's cards begin, which is its own padding", () => {
        const board = buildWindowed({ above: 2400 });
        const area = board.querySelector<HTMLElement>(".board-column-content");
        const spacer = area?.querySelector<HTMLElement>(".board-window-spacer");
        if (!area || !spacer) throw new Error("expected a spacer at the head of the cards");

        // The head spacer begins 8px into the area, which is what the column is padded by.
        place(spacer, { left: 0, top: 48, width: 100, height: 2400 });

        const [ column ] = measureBoard(board).columns;

        expect(column.origin).toBe(8);
    });

    it("reports no origin for a column measured without its cards", () => {
        const board = buildWindowed();

        const [ column ] = measureBoard(board, false).columns;

        expect(column.origin).toBe(0);
    });

    it("counts a column that states a window but is drawing none of it", () => {
        const board = buildWindowed({ total: 60, from: 60, above: 3600, below: 0 });
        const area = board.querySelector<HTMLElement>(".board-column-content");
        for (const card of area?.querySelectorAll(".board-note") ?? []) {
            card.remove();
        }

        const [ column ] = measureBoard(board).columns;

        expect(column.cards).toHaveLength(60);
    });
});
