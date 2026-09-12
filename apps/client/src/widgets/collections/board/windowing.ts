/**
 * Picks which of a column's cards to render, for columns holding more than the page can carry.
 *
 * Without this the board renders every card of every column. The cost is the `.board-note` element
 * itself, not its contents: the page's CSS rules are matched against each one, so a column of
 * 10,000 cards costs hundreds of milliseconds per style recalculation. Rendering only the visible
 * cards, with a spacer div for the rest, brings scrolling, dragging and hovering back to 60fps.
 */

import { RefObject } from "preact";
import { flushSync } from "preact/compat";
import {
    useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState
} from "preact/hooks";

import { cardSpacing } from "./drag_measure";

/** Height assumed for a card before it is measured: one line of title plus its padding. */
export const NOMINAL_CARD_HEIGHT = 64;

/** Extra pixels rendered past each edge of the area, so a scroll has cards ready. */
export const OVERSCAN_PX = 800;

/** The window's edges move in steps of this many cards, batching re-renders. */
export const WINDOW_CHUNK = 25;

/** Minimum cards in a column before windowing is worth its complexity. */
export const WINDOW_THRESHOLD = 120;

export interface ColumnWindow {
    /** Index of the first card rendered. */
    from: number;
    /** Index one past the last card rendered. */
    until: number;
    /** Height of the spacer above the rendered cards, in pixels. */
    above: number;
    /** Height of the spacer below them, in pixels. */
    below: number;
}

export interface WindowInput {
    /** Height of each card, in the column's own order. */
    heights: readonly number[];
    /** Vertical gap between one card and the next. */
    spacing: number;
    scrollTop: number;
    /** Height of the scrolling area the cards are rendered in. */
    viewport: number;
    overscan?: number;
    /** Cards per step of the window's edges. Pass 1 in a test to disable batching. */
    chunk?: number;
}

/**
 * Returns the cards to render at a scroll position, and the height of the spacer at each end.
 *
 * `from` and `until` are rounded outwards to whole chunks, so scrolling by one card does not
 * re-render the column: the window changes only after the reader passes a chunk.
 */
export function computeWindow({
    heights, spacing, scrollTop, viewport, overscan = OVERSCAN_PX, chunk = WINDOW_CHUNK
}: WindowInput): ColumnWindow {
    const count = heights.length;
    if (count === 0) {
        return { from: 0, until: 0, above: 0, below: 0 };
    }

    const top = scrollTop - overscan;
    const bottom = scrollTop + viewport + overscan;
    let first = count;
    let last = -1;
    let offset = 0;
    /** Offset of each card, accumulated once so neither edge is computed twice. */
    const edges: number[] = [];

    for (const [index, height] of heights.entries()) {
        edges.push(offset);
        const foot = offset + height;
        if (foot > top && first === count) {
            first = index;
        }
        if (offset < bottom) {
            last = index;
        }
        offset += height + spacing;
    }
    edges.push(offset);

    // A column that has shrunk can leave `scrollTop` past its own end, where no card matches.
    // Render the last chunk instead, so the column is never blank.
    if (last < 0 || first > last) {
        first = Math.max(0, count - 1);
        last = count - 1;
    }

    const from = Math.max(0, Math.floor(first / chunk) * chunk);
    const until = Math.min(count, Math.ceil((last + 1) / chunk) * chunk);

    return {
        from,
        until,
        above: edges[from] ?? 0,
        // The last rendered card supplies its own bottom margin, so the spacer covers only what
        // follows it.
        below: Math.max(0, (edges[count] ?? 0) - (edges[until] ?? edges[count] ?? 0))
    };
}

/**
 * Returns each card's height: the measured value where there is one, `nominal` otherwise.
 */
export function resolveHeights(
    noteIds: readonly string[],
    measured: ReadonlyMap<string, number>,
    nominal = NOMINAL_CARD_HEIGHT
): number[] {
    return noteIds.map((noteId) => measured.get(noteId) ?? nominal);
}

/**
 * Returns the height to assume for a column's unmeasured cards, averaged over its measured ones.
 *
 * Averages only `noteIds`, not every card the page has measured. Two boards, or two columns of one
 * board, can have different promoted attributes and so different heights; using another column's
 * average gives the wrong spacer heights, scrollbar length and `scrollToCard` destinations.
 *
 * Returns `undefined` until `ESTIMATE_SAMPLE` cards are measured. The caller then keeps the first
 * value: `bounds.above` derives from it and holds the reader's scroll position, so changing it
 * later shifts the column under them.
 *
 * @param held a value the column already settled on, returned unchanged.
 */
export function estimateFor(
    noteIds: readonly string[],
    measured: ReadonlyMap<string, number>,
    held: number | undefined
) {
    if (held !== undefined) {
        return held;
    }

    let total = 0;
    let seen = 0;
    for (const noteId of noteIds) {
        const height = measured.get(noteId);
        if (height !== undefined) {
            total += height;
            seen++;
        }
    }

    return seen >= ESTIMATE_SAMPLE ? total / seen : undefined;
}

/** How many of a column's cards are measured before what the rest are counted at is settled. */
const ESTIMATE_SAMPLE = 12;

/**
 * Incremented by `forgetWindowHeights` so each column recomputes its estimate instead of keeping
 * one measured at a column width the board no longer has.
 */
let generation = 0;

/**
 * Returns whether two windows render the same cards.
 *
 * Ignores `above` and `below`: they derive from the heights, and a measurement that only corrects
 * them must not count as a re-render.
 */
export function sameWindow(a: ColumnWindow, b: ColumnWindow) {
    return a.from === b.from && a.until === b.until;
}

/**
 * Tracks which cards a column renders, following its scroll position and its measured heights.
 *
 * Measures each card as it is rendered and caches the height by note id, so a card seen once uses
 * its real height afterwards. A correction above the viewport shifts the content below it, so
 * `scrollTop` is adjusted by the same amount in that frame.
 *
 * @param areaRef the column's scrolling element.
 * @param noteIds the column's cards, in order.
 * @param enabled whether to window this column at all.
 */
export function useColumnWindow(
    areaRef: RefObject<HTMLElement>,
    noteIds: readonly string[],
    enabled: boolean
) {
    const [ revision, setRevision ] = useState(0);
    const [ scroll, setScroll ] = useState({ top: 0, viewport: 0 });
    /** Height this column assumes for its unmeasured cards, once its own have settled it. */
    const estimate = useRef<{ at: number, value?: number }>({ at: generation });
    if (estimate.current.at !== generation) {
        estimate.current = { at: generation };
    }
    estimate.current.value = estimateFor(noteIds, cardHeights, estimate.current.value);

    const settled = estimate.current.value;
    const heights = useMemo(
        () => resolveHeights(noteIds, cardHeights, settled ?? NOMINAL_CARD_HEIGHT),
        // `revision` tracks `cardHeights`, which is mutated outside the render.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [ noteIds, revision, settled ]);
    const spacing = cardSpacing() || DEFAULT_SPACING;

    const bounds = useMemo(() => (enabled
        ? computeWindow({
            heights, spacing, scrollTop: scroll.top, viewport: scroll.viewport
        })
        : { from: 0, until: noteIds.length, above: 0, below: 0 }
    ), [ enabled, heights, spacing, scroll.top, scroll.viewport, noteIds.length ]);

    /** The previous commit's window, to distinguish a window change from a spacer correction. */
    const drawn = useRef(bounds);
    const changed = enabled && !sameWindow(drawn.current, bounds);
    drawn.current = bounds;

    // Reads the scroll position in the listener rather than from state, so the window keeps up
    // with the pointer instead of trailing it by a frame.
    useEffect(() => {
        const area = areaRef.current;
        if (!area || !enabled) return;

        const read = () => setScroll((current) => (
            current.top === area.scrollTop && current.viewport === area.clientHeight
                ? current
                : { top: area.scrollTop, viewport: area.clientHeight }));

        read();
        area.addEventListener("scroll", read, { passive: true });
        const resize = new ResizeObserver(read);
        resize.observe(area);

        return () => {
            area.removeEventListener("scroll", read);
            resize.disconnect();
        };
    }, [ areaRef, enabled ]);

    /** The previous `above` and `from`, used to detect an estimate correction. */
    const above = useRef({ from: bounds.from, height: bounds.above });
    useLayoutEffect(() => {
        const area = areaRef.current;
        if (!area || !enabled) {
            above.current = { from: bounds.from, height: bounds.above };
            return;
        }

        // Correcting the estimate changes `bounds.above`, which shifts every card below it, so
        // `scrollTop` moves by the same amount to keep the viewport on the same cards.
        //
        // Only when `bounds.from` is unchanged. A window that moved because the reader scrolled
        // has a different `above` by rights, and their scroll position is already correct.
        const held = above.current;
        const shift = held.from === bounds.from ? bounds.above - held.height : 0;
        above.current = { from: bounds.from, height: bounds.above };
        if (Math.abs(shift) > 1 && area.scrollTop > 0) {
            area.scrollTop += shift;
        }

        let corrected = false;
        for (const card of area.querySelectorAll<HTMLElement>(".board-note")) {
            const noteId = card.dataset.noteId;
            const height = card.offsetHeight;
            // A card with its title editor open is taller than the card itself, and a dragged one
            // is out of the flow with no height.
            if (!noteId || !height || card.classList.contains("editing")) continue;

            const known = cardHeights.get(noteId);
            if (known === undefined || Math.abs(known - height) > 0.5) {
                cardHeights.set(noteId, height);
                corrected = true;
            }
        }

        if (corrected) {
            setRevision((r) => r + 1);
        }
    });

    // Republished after each commit, so `placeInModel` reads the current heights rather than the
    // ones measured when a drag started.
    useLayoutEffect(() => {
        const area = areaRef.current;
        if (!area) return;

        if (enabled) {
            models.set(area, { heights, spacing });
        } else {
            models.delete(area);
        }
    }, [ areaRef, enabled, heights, spacing ]);

    /**
     * Scrolls a card into the window, for one created outside it. The scroll moves the window,
     * and the offset comes from the same `heights`.
     */
    const scrollToCard = useCallback((index: number, immediate = false) => {
        const area = areaRef.current;
        if (!area || !enabled) return;

        let offset = 0;
        for (const [ at, height ] of heights.entries()) {
            if (at >= index) break;
            offset += height + spacing;
        }

        // Placed a little above the foot of the area, so the card is not left under its own edge.
        area.scrollTop = Math.max(0, offset - area.clientHeight / 2);

        // Set here rather than left to the scroll event the write above raises: that event
        // arrives a frame later, and the card must be drawn for this call to have any effect.
        const moved = { top: area.scrollTop, viewport: area.clientHeight };
        if (immediate) {
            // Drawn before this returns, for a keyboard walk that focuses the card in the same
            // keystroke.
            flushSync(() => setScroll(moved));
        } else {
            setScroll(moved);
        }
    }, [ areaRef, enabled, heights, spacing ]);

    return { bounds, windowChanged: changed, scrollToCard };
}

/**
 * The heights a column lays its cards out from, and the gap between one card and the next.
 *
 * Published so a drag can compute where a card would land without reading the DOM. The DOM is
 * wrong mid-gesture: the dragged card is out of the flow, the drop placeholder overlays the cards,
 * and the ones below it are offset by a transform.
 */
export interface ColumnModel {
    heights: readonly number[];
    spacing: number;
}

/** Returns the model a column renders with, or `undefined` if it renders every card. */
export function getColumnModel(area: HTMLElement) {
    return models.get(area);
}

const models = new WeakMap<HTMLElement, ColumnModel>();

/**
 * Raises {@link REVEAL_CARD} so the column drawing `column` scrolls a card into view.
 *
 * The keyboard walks a column by index and can step onto a card outside the window, which is not
 * in the page to be focused. The column handles the event by scrolling to it, which draws it.
 */
export function askForCard(
    container: HTMLElement, column: string, index: number, immediate = false
) {
    container.dispatchEvent(new CustomEvent(REVEAL_CARD, { detail: { column, index, immediate } }));
}

/** The event {@link askForCard} raises, which a windowed column listens for. */
export const REVEAL_CARD = "board:reveal-card";

export interface RevealCardDetail {
    column: string;
    index: number;
    /**
     * Whether the card must be in the page by the time {@link askForCard} returns.
     *
     * For a keyboard walk, which has to focus it in the same keystroke: focus left on nothing
     * while a frame is waited for makes the next key find no card to walk from, and the browser
     * scrolls the board instead. Not set when the call is made from a layout effect, where
     * drawing again in the middle of a commit is not safe.
     */
    immediate?: boolean;
}

/** Clears the measured heights, for a window resize that changes card widths. */
export function forgetWindowHeights() {
    cardHeights.clear();
    generation++;
}

/**
 * Measured height of each card, by note id, for the lifetime of the page.
 *
 * Shared across boards: a note has the same height wherever it is rendered, so a column opened for
 * the first time can reuse heights measured elsewhere.
 */
const cardHeights = new Map<string, number>();

/** Gap between two cards before a drag measures it. Matches `.board-note`'s bottom margin. */
const DEFAULT_SPACING = 9;
