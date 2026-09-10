import { describe, expect, it } from "vitest";

import {
    type CardBox, cardInsertionIndex, columnAt, type ColumnBox, columnCovers,
    columnInsertionIndex, columnStandsAside, movesColumn
} from "./drag_geometry";

/** Three 100px columns with a 20px gap, standing 400 tall from the top of the page. */
function columns(cards: Record<string, CardBox[]> = {}): ColumnBox[] {
    return [ "To Do", "Doing", "Done" ].map((value, index) => ({
        value,
        left: index * 120,
        width: 100,
        top: 0,
        origin: 0,
        height: 400,
        cards: cards[value] ?? []
    }));
}

/** Cards of the given heights, stacked from the top of the card area. */
function stack(...heights: number[]): CardBox[] {
    let top = 0;
    return heights.map((height) => {
        const card = { top, height };
        top += height;
        return card;
    });
}

describe("columnAt", () => {
    it("answers with the column the point stands in", () => {
        const board = columns();

        expect(columnAt(board, 0)?.value).toBe("To Do");
        expect(columnAt(board, 99)?.value).toBe("To Do");
        expect(columnAt(board, 120)?.value).toBe("Doing");
        expect(columnAt(board, 299)?.value).toBe("Done");
    });

    /** The board leaves a gap between columns, which a drag passes through. */
    it("answers with the nearer column for a point in the gap between two", () => {
        const board = columns();

        expect(columnAt(board, 104)?.value).toBe("To Do");
        expect(columnAt(board, 116)?.value).toBe("Doing");
    });

    /** Held past an end while the board scrolls itself, the drag still has somewhere to go. */
    it("answers with the end column for a point beyond the board", () => {
        const board = columns();

        expect(columnAt(board, -500)?.value).toBe("To Do");
        expect(columnAt(board, 5000)?.value).toBe("Done");
    });

    it("answers with nothing for a board of no columns", () => {
        expect(columnAt([], 50)).toBeUndefined();
    });
});

describe("columnCovers", () => {
    /** The gap beside a column is answered for by it, and is not part of it. */
    it("tells standing on a column from being nearest to it", () => {
        const [ first, second ] = columns();

        expect(columnCovers(first, 0, 200)).toBe(true);
        expect(columnCovers(first, 99, 200)).toBe(true);
        expect(columnCovers(first, 100, 200)).toBe(false);
        expect(columnCovers(first, 104, 200)).toBe(false);
        expect(columnAt(columns(), 104)?.value).toBe("To Do");

        expect(columnCovers(second, 120, 200)).toBe(true);
        expect(columnCovers(second, -5000, 200)).toBe(false);
    });

    /**
     * A collapsed column is only as tall as its heading, and the empty space below it belongs to
     * no column the reader can see.
     */
    it("tells the column from the empty space below a short one", () => {
        const strip: ColumnBox = {
            value: "Parked", left: 0, width: 36, top: 0, height: 90, origin: 0, cards: []
        };

        expect(columnCovers(strip, 18, 0)).toBe(true);
        expect(columnCovers(strip, 18, 89)).toBe(true);
        expect(columnCovers(strip, 18, 90)).toBe(false);
        expect(columnCovers(strip, 18, 300)).toBe(false);
        // Still the nearest column, so a card held there has somewhere to go.
        expect(columnAt([ strip ], 18)?.value).toBe("Parked");
    });
});

describe("cardInsertionIndex", () => {
    it("places the card in the place its top edge has reached", () => {
        const cards = stack(50, 50, 50);

        expect(cardInsertionIndex(cards, 0)).toBe(0);
        expect(cardInsertionIndex(cards, 49)).toBe(0);
        // The line between one place and the next runs where one card ends and the next begins.
        expect(cardInsertionIndex(cards, 51)).toBe(1);
        expect(cardInsertionIndex(cards, 99)).toBe(1);
        expect(cardInsertionIndex(cards, 101)).toBe(2);
    });

    it("places the card at the end when it is held below them all", () => {
        expect(cardInsertionIndex(stack(50, 50, 50), 500)).toBe(3);
        expect(cardInsertionIndex(stack(50), 40)).toBe(0);
        expect(cardInsertionIndex(stack(50), 60)).toBe(1);
    });

    it("places the card first in a column holding none", () => {
        expect(cardInsertionIndex([], 0)).toBe(0);
        expect(cardInsertionIndex([], 500)).toBe(0);
    });

    /** Cards are not all one height: a tall one's place reaches much further down. */
    it("counts each card's own height rather than a shared one", () => {
        const cards = stack(20, 200, 20);

        expect(cardInsertionIndex(cards, 19)).toBe(0);
        expect(cardInsertionIndex(cards, 21)).toBe(1);
        // The tall card runs from 20 to 220, and its place runs with it.
        expect(cardInsertionIndex(cards, 219)).toBe(1);
        expect(cardInsertionIndex(cards, 221)).toBe(2);
    });

    /** A point above the first card is above every place it could take. */
    it("places the card first when it is held above the card area", () => {
        expect(cardInsertionIndex(stack(50, 50), -80)).toBe(0);
    });
});

describe("columnInsertionIndex", () => {
    it("places the column before the one it is held over the left half of", () => {
        const board = columns();

        expect(columnInsertionIndex(board, 0)).toBe(0);
        expect(columnInsertionIndex(board, 49)).toBe(0);
        expect(columnInsertionIndex(board, 51)).toBe(1);
        expect(columnInsertionIndex(board, 169)).toBe(1);
        expect(columnInsertionIndex(board, 171)).toBe(2);
    });

    it("places the column at the end when it is held past them all", () => {
        expect(columnInsertionIndex(columns(), 5000)).toBe(3);
    });

    it("places the column first on a board holding none", () => {
        expect(columnInsertionIndex([], 50)).toBe(0);
    });

    /** The gap belongs to whichever half of a column it borders, as any other point does. */
    it("counts the gap between two columns as past the left one", () => {
        expect(columnInsertionIndex(columns(), 110)).toBe(1);
    });
});

describe("movesColumn", () => {
    /** A column dropped either side of where it stands lands where it started. */
    it("knows the two places that leave a column where it is", () => {
        expect(movesColumn(1, 1)).toBe(false);
        expect(movesColumn(1, 2)).toBe(false);

        expect(movesColumn(1, 0)).toBe(true);
        expect(movesColumn(1, 3)).toBe(true);
    });

    it("knows the ends", () => {
        expect(movesColumn(0, 0)).toBe(false);
        expect(movesColumn(0, 1)).toBe(false);
        expect(movesColumn(0, 2)).toBe(true);
    });
});

describe("columnStandsAside", () => {
    // Six columns, the third one carried, each standing 266px wide with the gap after it.
    const aside = (index: number, to: number | null) => columnStandsAside(index, 2, to, 266);

    it("moves the columns between where it left and where it lands, and no others", () => {
        // Carried to the right: the ones it passes close up behind it.
        expect([ 0, 1, 2, 3, 4, 5 ].map(index => aside(index, 5)))
            .toEqual([ 0, 0, 0, -266, -266, 0 ]);

        // Carried to the left: the ones it passes stand aside for it.
        expect([ 0, 1, 2, 3, 4, 5 ].map(index => aside(index, 0)))
            .toEqual([ 266, 266, 0, 0, 0, 0 ]);
    });

    it("holds everything still where the column would land back in its own place", () => {
        expect([ 0, 1, 2, 3, 4, 5 ].map(index => aside(index, 2))).toEqual([ 0, 0, 0, 0, 0, 0 ]);
        // The place just after its own is the same place: it is the only column out of the row.
        expect([ 0, 1, 2, 3, 4, 5 ].map(index => aside(index, 3))).toEqual([ 0, 0, 0, 0, 0, 0 ]);
    });

    it("holds everything still while the column is over nowhere it could land", () => {
        expect([ 0, 1, 2, 3, 4, 5 ].map(index => aside(index, null))).toEqual([ 0, 0, 0, 0, 0, 0 ]);
    });

    it("counts the place past the last column as the end of the row", () => {
        expect([ 0, 1, 2, 3, 4, 5 ].map(index => aside(index, 6)))
            .toEqual([ 0, 0, 0, -266, -266, -266 ]);
    });
});
