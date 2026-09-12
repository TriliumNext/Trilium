import { afterEach, describe, expect, it } from "vitest";

import { narrowAnchorRect } from "./selection";

describe("narrowAnchorRect", () => {
    afterEach(() => {
        window.glob.isRtl = false;
    });

    /** A chip of a day or two: narrow enough for a card to stand beside it as it is. */
    const chip = new DOMRect(700, 200, 150, 20);
    /** An event running the length of the week, drawn the width of a grid that fills the window. */
    const span = new DOMRect(20, 200, 1560, 20);

    it("leaves a piece that can be stood beside as it stands", () => {
        expect(narrowAnchorRect(chip, { x: 720, y: 205 })).toBe(chip);
        // Right up to the width of the widest card, which still leaves the grid's own room.
        expect(narrowAnchorRect(new DOMRect(700, 200, 480, 20), { x: 720, y: 205 })).toEqual(new DOMRect(700, 200, 480, 20));
        // A hair over it is narrowed, the card no longer having room to stand beside the piece.
        expect(narrowAnchorRect(new DOMRect(700, 200, 481, 20), { x: 720, y: 205 })).toEqual(new DOMRect(720, 200, 0, 20));
    });

    it("narrows a piece too wide to be stood beside to the press within it", () => {
        // The card lands beside the press rather than at the far end of the month, and has the
        // grid's own room on either side of it — which is what keeps it on the screen at all.
        expect(narrowAnchorRect(span, { x: 540, y: 205 })).toEqual(new DOMRect(540, 200, 0, 20));
    });

    it("keeps the press within the piece it belongs to", () => {
        // A press that named a piece other than the one drawn — the popover re-anchored to the
        // first chip of an event crossing rows, say — would otherwise carry the card off it.
        expect(narrowAnchorRect(span, { x: 5, y: 205 })).toEqual(new DOMRect(20, 200, 0, 20));
        expect(narrowAnchorRect(span, { x: 3000, y: 205 })).toEqual(new DOMRect(1580, 200, 0, 20));
    });

    it("stands at the start of a span nothing pressed on, whichever way the app reads", () => {
        expect(narrowAnchorRect(span, null)).toEqual(new DOMRect(20, 200, 0, 20));

        window.glob.isRtl = true;
        expect(narrowAnchorRect(span, null)).toEqual(new DOMRect(1580, 200, 0, 20));
    });
});
