import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
    askForCard, type ColumnWindow, computeWindow, estimateFor, forgetWindowHeights,
    NOMINAL_CARD_HEIGHT, resolveHeights, REVEAL_CARD, type RevealCardDetail, sameWindow,
    useColumnWindow, type WindowInput
} from "./windowing";

/** A column of uniform cards, which makes every offset in a test arithmetic. */
function column(count: number, height = 100, spacing = 10): Omit<WindowInput, "scrollTop"> {
    return { heights: Array(count).fill(height), spacing, viewport: 500 };
}

describe("computeWindow", () => {
    it("draws nothing for a column holding nothing", () => {
        expect(computeWindow({ heights: [], spacing: 10, scrollTop: 0, viewport: 500 }))
            .toEqual({ from: 0, until: 0, above: 0, below: 0 });
    });

    it("draws the whole of a column that fits, with no spacer at either end", () => {
        const win = computeWindow({ ...column(4), scrollTop: 0, overscan: 0, chunk: 1 });
        expect(win).toEqual({ from: 0, until: 4, above: 0, below: 0 });
    });

    it("draws what the area shows plus the overscan, and stands the spacers on the rest", () => {
        // Cards are 110px apart. At 1000px down, the area covers cards 9 through 13.
        const win = computeWindow({ ...column(100), scrollTop: 1000, overscan: 0, chunk: 1 });

        expect(win.from).toBe(9);
        expect(win.until).toBe(14);
        expect(win.above).toBe(9 * 110);
        expect(win.below).toBe((100 - 14) * 110);
        // What the spacers and the drawn cards stand at together is the column's own height.
        expect(win.above + (win.until - win.from) * 110 + win.below).toBe(100 * 110);
    });

    it("widens the window by the overscan at both ends", () => {
        const tight = computeWindow({ ...column(100), scrollTop: 1000, overscan: 0, chunk: 1 });
        const loose = computeWindow({ ...column(100), scrollTop: 1000, overscan: 220, chunk: 1 });

        expect(loose.from).toBe(tight.from - 2);
        expect(loose.until).toBe(tight.until + 2);
    });

    it("rounds the edges outwards to whole chunks, so scrolling by a card redraws nothing", () => {
        const first = computeWindow({ ...column(500), scrollTop: 1000, overscan: 0, chunk: 25 });
        const nudged = computeWindow({ ...column(500), scrollTop: 1050, overscan: 0, chunk: 25 });

        expect(first.from % 25).toBe(0);
        expect(first.until % 25).toBe(0);
        expect(sameWindow(first, nudged)).toBe(true);
    });

    it("moves the window on once the reader has passed a chunk", () => {
        const near = computeWindow({ ...column(500), scrollTop: 1000, overscan: 0, chunk: 25 });
        const far = computeWindow({ ...column(500), scrollTop: 6000, overscan: 0, chunk: 25 });

        expect(sameWindow(near, far)).toBe(false);
        expect(far.from).toBeGreaterThan(near.from);
    });

    it("keeps the top spacer at nothing while the reader is at the top", () => {
        const win = computeWindow({ ...column(500), scrollTop: 0, overscan: 800, chunk: 25 });
        expect(win.from).toBe(0);
        expect(win.above).toBe(0);
    });

    it("keeps the foot spacer at nothing once the last card is drawn", () => {
        const heights = Array(500).fill(100);
        const total = 500 * 110;
        const win = computeWindow({
            heights, spacing: 10, viewport: 500, scrollTop: total - 500, overscan: 0, chunk: 25
        });

        expect(win.until).toBe(500);
        expect(win.below).toBe(0);
    });

    it("draws the last cards rather than nothing when scrolled past the end", () => {
        const win = computeWindow({
            ...column(300), scrollTop: 999_999, overscan: 0, chunk: 25
        });

        expect(win.until).toBe(300);
        expect(win.from).toBeLessThan(300);
        expect(win.below).toBe(0);
    });

    it("draws from the top for a scroll position above it", () => {
        const win = computeWindow({ ...column(300), scrollTop: -200, overscan: 0, chunk: 25 });
        expect(win.from).toBe(0);
        expect(win.above).toBe(0);
    });

    it("counts cards of differing heights rather than assuming one height", () => {
        const heights = [ 50, 300, 50, 300, 50 ];
        const win = computeWindow({
            heights, spacing: 0, viewport: 100, scrollTop: 350, overscan: 0, chunk: 1
        });

        // 350px down is inside the third card, which begins at 350.
        expect(win.from).toBe(2);
        expect(win.above).toBe(350);
        expect(win.above + heights.slice(win.from, win.until).reduce((a, b) => a + b, 0)
            + win.below).toBe(750);
    });

    it("adds up to the column's own height at every scroll position", () => {
        const heights = Array.from({ length: 200 }, (_, i) => 40 + (i % 7) * 15);
        const total = heights.reduce((sum, h) => sum + h + 9, 0);

        for (let scrollTop = 0; scrollTop < total; scrollTop += 137) {
            const win = computeWindow({
                heights, spacing: 9, viewport: 600, scrollTop, overscan: 300, chunk: 25
            });
            const drawn = heights.slice(win.from, win.until)
                .reduce((sum, h) => sum + h + 9, 0);
            expect(win.above + drawn + win.below).toBe(total);
        }
    });
});

describe("resolveHeights", () => {
    it("uses the nominal height while nothing has been measured", () => {
        expect(resolveHeights([ "a", "b" ], new Map()))
            .toEqual([ NOMINAL_CARD_HEIGHT, NOMINAL_CARD_HEIGHT ]);
    });

    it("uses what was measured, and the figure it is given for the rest", () => {
        const measured = new Map([ [ "a", 80 ], [ "c", 120 ] ]);
        expect(resolveHeights([ "a", "b", "c", "d" ], measured, 90))
            .toEqual([ 80, 90, 120, 90 ]);
    });
});

describe("estimateFor", () => {
    const ids = (count: number, from = 0) =>
        Array.from({ length: count }, (_, i) => `n${from + i}`);
    const measuredAt = (count: number, height: number, from = 0) =>
        new Map(ids(count, from).map((id) => [ id, height ] as const));

    it("answers nothing until enough of the column's own cards have been measured", () => {
        expect(estimateFor(ids(50), measuredAt(2, 200), undefined)).toBeUndefined();
    });

    it("settles on the average of the column's measured cards", () => {
        expect(estimateFor(ids(50), measuredAt(12, 100), undefined)).toBe(100);
    });

    /**
     * The spacer above the window is counted from this and is what holds the reader's place: a
     * figure that kept being revised would slide the column while they read it.
     */
    it("answers back what a column has already settled on", () => {
        const measured = new Map<string, number>(measuredAt(40, 500));
        expect(estimateFor(ids(50), measured, 100)).toBe(100);
    });

    /**
     * Two boards, or two columns of one board, can carry different attributes and stand at quite
     * different heights. Counting one column's cards at another's average puts its spacers, its
     * scrollbar and its scroll destinations all in the wrong place.
     */
    it("counts only the cards the column holds, not every card measured anywhere", () => {
        const measured = new Map<string, number>([
            // A tall column measured earlier, whose cards this one does not hold.
            ...measuredAt(40, 500, 100),
            ...measuredAt(12, 60)
        ]);

        expect(estimateFor(ids(50), measured, undefined)).toBe(60);
    });
});

describe("askForCard", () => {
    it("raises the ask on the board, naming the column, the card and how soon it is wanted", () => {
        const board = document.createElement("div");
        document.body.appendChild(board);
        const seen: RevealCardDetail[] = [];
        board.addEventListener(REVEAL_CARD, (e) =>
            seen.push((e as CustomEvent<RevealCardDetail>).detail));

        askForCard(board, "To Do", 42);
        askForCard(board, "Done", 7, true);
        board.remove();

        expect(seen).toEqual([
            { column: "To Do", index: 42, immediate: false },
            { column: "Done", index: 7, immediate: true }
        ]);
    });
});

describe("sameWindow", () => {
    it("compares the cards drawn and not the spacers around them", () => {
        const a = { from: 0, until: 25, above: 0, below: 100 };
        const b = { from: 0, until: 25, above: 0, below: 250 };
        const c = { from: 25, until: 50, above: 0, below: 100 };

        expect(sameWindow(a, b)).toBe(true);
        expect(sameWindow(a, c)).toBe(false);
    });
});

describe("useColumnWindow", () => {
    let host: HTMLElement | undefined;
    let area: HTMLElement | undefined;

    beforeEach(() => {
        forgetWindowHeights();
        host = document.createElement("div");
        area = document.createElement("div");
        document.body.appendChild(host);
        document.body.appendChild(area);
        // happy-dom lays nothing out, so the area is told what it stands at.
        Object.defineProperty(area, "clientHeight", { value: 600, configurable: true });
    });

    afterEach(() => {
        if (host) render(null, host);
        host?.remove();
        area?.remove();
        host = undefined;
        area = undefined;
    });

    /** Renders a probe that does nothing but report what the hook hands back. */
    async function probe(noteIds: string[], enabled = true) {
        const seen: ReturnType<typeof useColumnWindow>[] = [];
        const ref = { current: area ?? null };

        function Probe() {
            seen.push(useColumnWindow(ref, noteIds, enabled));
            return null;
        }


        await act(async () => {
            render(<Probe />, host ?? document.body);
        });
        return { seen, last: () => seen[seen.length - 1] };
    }

    const ids = (count: number) => Array.from({ length: count }, (_, i) => `note${i}`);

    it("draws every card of a column it is switched off for", async () => {
        const { last } = await probe(ids(500), false);
        expect(last().bounds).toEqual({ from: 0, until: 500, above: 0, below: 0 });
        expect(last().windowChanged).toBe(false);
    });

    it("draws a slice of a column it is switched on for, with the rest in the spacers", async () => {
        const { last } = await probe(ids(500));
        const { bounds } = last();

        expect(bounds.from).toBe(0);
        expect(bounds.until).toBeGreaterThan(0);
        expect(bounds.until).toBeLessThan(500);
        expect(bounds.above).toBe(0);
        expect(bounds.below).toBeGreaterThan(0);
    });

    it("moves the window when the column is scrolled, and says that it changed", async () => {
        const { last } = await probe(ids(2000));
        const first = last().bounds;

        await act(async () => {
            if (area) area.scrollTop = 20_000;
            area?.dispatchEvent(new Event("scroll"));
        });

        const moved = last().bounds;
        expect(moved.from).toBeGreaterThan(first.from);
        expect(moved.above).toBeGreaterThan(first.above);
        // The flip has to be told, or it slides cards from places that named other cards.
        expect(last().windowChanged).toBe(true);
    });

    it("scrolls to a card the column is not drawing, placing it inside the area", async () => {
        const { last } = await probe(ids(2000));

        await act(async () => last().scrollToCard(400));

        // Cards stand at the nominal height until measured, so where card 400 begins is arithmetic.
        const perCard = NOMINAL_CARD_HEIGHT + 9;
        expect(area?.scrollTop).toBe(Math.max(0, 400 * perCard - 300));
    });

    it("leaves the scroll alone for a column it is switched off for", async () => {
        const { last } = await probe(ids(2000), false);
        if (area) area.scrollTop = 42;

        await act(async () => last().scrollToCard(400));

        expect(area?.scrollTop).toBe(42);
    });

    it("draws the card before the ask returns when it is wanted at once", async () => {
        const { last } = await probe(ids(2000));
        const before = last().bounds;

        // No act(): the point is that the window has moved by the time the call returns, which is
        // what lets a keyboard walk focus the card in the same keystroke.
        last().scrollToCard(400, true);

        expect(last().bounds.from).toBeGreaterThan(before.from);
    });

    it("counts a card at what it measures once the column has drawn it", async () => {
        const noteIds = ids(2000);
        const { last } = await probe(noteIds);
        const tall = last().bounds.below;

        // The cards the column drew, standing taller than the nominal height it assumed.
        await act(async () => {
            for (const noteId of noteIds.slice(0, 30)) {
                const card = document.createElement("div");
                card.className = "board-note";
                card.dataset.noteId = noteId;
                Object.defineProperty(card, "offsetHeight", { value: 200, configurable: true });
                area?.appendChild(card);
            }
            if (area) area.scrollTop = 1;
            area?.dispatchEvent(new Event("scroll"));
        });

        // A taller column has more of itself left below the window than it was counted at.
        expect(last().bounds.below).toBeGreaterThan(tall);
    });

    it("leaves the window alone for a scroll that stays inside the chunk it is drawing", async () => {
        const { last } = await probe(ids(2000));
        const first = last().bounds;

        await act(async () => {
            if (area) area.scrollTop = 1;
            area?.dispatchEvent(new Event("scroll"));
        });

        expect(last().bounds.from).toBe(first.from);
        expect(last().windowChanged).toBe(false);
    });
});
