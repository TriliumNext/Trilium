import { type CardBox, type ColumnBox } from "./drag_geometry";
import { type ColumnModel } from "./windowing";

/** What a drag measures once at its start, and reads for the rest of the gesture. */
export interface BoardMeasurement {
    /** The columns as drawn, in order, for {@link columnAt} and {@link columnInsertionIndex}. */
    columns: ColumnBox[];
    /** Each column's card area, which a point has to be read against to place a card in it. */
    areas: Map<string, HTMLElement>;
}

/**
 * Measures every column on the board, and the cards in each of them.
 *
 * Called once when a drag starts. A gesture reads two rectangles per move afterwards, whatever the
 * board holds, where measuring per move would read one for every card on it.
 *
 * @param withCards whether to measure the cards as well, which only a card is placed against. A
 * column is placed against the column boxes alone, and reading a rectangle per card for one is a
 * pass over the whole board that nothing goes on to look at.
 */
export function measureBoard(container: HTMLElement, withCards = true): BoardMeasurement {
    const origin = container.getBoundingClientRect().left - container.scrollLeft;
    const columns: ColumnBox[] = [];
    const areas = new Map<string, HTMLElement>();

    // The copy being carried is a column too, and measuring again mid-drag would count it as a
    // place to drop into, one past every place the board actually has.
    const drawn = container.querySelectorAll<HTMLElement>(".board-column:not(.board-drag-preview)");

    for (const element of drawn) {
        const value = element.dataset.column ?? "";
        const rect = element.getBoundingClientRect();
        // A strip holds its cards in the page but draws none of them: they measure nothing, and a
        // card carried over one goes to the front of whatever it holds.
        const area = element.classList.contains("collapsed")
            ? null
            : element.querySelector<HTMLElement>(".board-column-content");

        if (area) {
            areas.set(value, area);
        }

        columns.push({
            value,
            left: rect.left - origin,
            width: rect.width,
            top: rect.top,
            height: rect.height,
            origin: withCards ? contentOrigin(area) : 0,
            cards: withCards ? measureCards(area) : []
        });
    }

    return { columns, areas };
}

/**
 * Where a column's first card begins, in the space {@link toAreaY} reads a point into.
 *
 * Read from the leading `.board-window-spacer`, which begins where the cards do whether or not the
 * column is windowed. Read once per gesture: the padding does not change while one runs.
 */
function contentOrigin(area: HTMLElement | null) {
    const spacer = area?.querySelector<HTMLElement>(".board-window-spacer");
    if (!area || !spacer) {
        return 0;
    }

    return spacer.getBoundingClientRect().top
        - (area.getBoundingClientRect().top - area.scrollTop);
}

/** A point in the board's content space, which its horizontal scrolling does not move columns in. */
export function toBoardX(container: HTMLElement, clientX: number): number {
    return clientX - container.getBoundingClientRect().left + container.scrollLeft;
}

/**
 * The place a carried card would take in a windowed column, counted from what the column lays its
 * cards out with rather than from the page.
 *
 * Matches {@link cardInsertionIndex} for a fully rendered column, and treats the dragged card the
 * same way: it is out of the flow while held, so the cards below it shift up one place and the
 * index is converted back afterwards.
 *
 * Computed per pointer move rather than once per gesture. An auto-scroll moves the window onto
 * cards the gesture had only estimated, and an index computed from those estimates drifts further
 * from the drop placeholder the longer the scroll runs.
 *
 * @param carrying the place the carried card holds here, or `undefined` if it came from elsewhere.
 */
export function placeInModel(model: ColumnModel, y: number, carrying: number | undefined): number {
    const { heights, spacing } = model;
    let offset = 0;
    /** How many cards have been passed, excluding the dragged one. */
    let place = 0;

    for (const [ index, height ] of heights.entries()) {
        if (index === carrying) {
            continue;
        }

        const foot = offset + height;
        const isLast = index === heights.length - 1
            || (carrying === heights.length - 1 && index === heights.length - 2);
        // The next slot begins halfway into the gap below a card.
        const boundary = isLast ? foot : foot + spacing / 2;
        if (y < boundary) {
            return carrying !== undefined && place >= carrying ? place + 1 : place;
        }

        offset = foot + spacing;
        place++;
    }

    return carrying !== undefined && place >= carrying ? place + 1 : place;
}

/**
 * A point in a card area's content space, which that column's vertical scrolling does not move its
 * cards in.
 */
export function toAreaY(area: HTMLElement, clientY: number): number {
    return clientY - area.getBoundingClientRect().top + area.scrollTop;
}

/**
 * What each card measures, kept by note so that a column can be placed against without reading a
 * rectangle for every card in it.
 *
 * A height holds until the card's own content changes, which {@link measureCards} checks for, or
 * until the window does, which drops the lot.
 */
const heights = new Map<string, number>();

/** What stands between two cards, which is one rule the board over and so is read once. */
let spacing: number | undefined;

/**
 * What stands between two cards, which is what a gap takes up on top of the card it stands for.
 * Nothing until a column has been measured, which a drag does before it opens any gap.
 */
export function cardSpacing() {
    return spacing ?? 0;
}

/** Drops what has been measured, for a window whose size has changed under it. */
export function forgetCardHeights() {
    heights.clear();
    spacing = undefined;
}

/**
 * The cards of one column, in the area's content space.
 *
 * A card whose height is known is placed by counting up from the one above it rather than by
 * reading a rectangle of its own, which on a column of thousands is the whole cost of a drag. The
 * dragged card is counted with the rest, so the index this leads to names a place in the list the
 * board holds.
 */
function measureCards(area: HTMLElement | null): CardBox[] {
    if (!area) {
        return [];
    }

    const counted = countCards(area, false);
    const { cards, elements } = counted;
    // The last card the column actually draws, which in a windowed one is not the last it holds.
    const last = counted.drawnFrom + elements.length - 1;

    // A card whose title or attributes changed stands a different height, and nothing says so, so
    // where the last card really is settles whether what was remembered still holds.
    if (counted.borrowed && elements.length > 1 && cards[last]) {
        const at = elements[elements.length - 1].getBoundingClientRect().top - counted.top;
        if (Math.abs(at - cards[last].top) > 1) {
            for (const element of elements) {
                heights.delete(element.dataset.noteId ?? "");
            }

            return countCards(area, true).cards;
        }
    }

    return cards;
}

/**
 * Walks a column's cards, reading what is not known and counting up from what is.
 *
 * @param readEvery whether to read every card rather than the first and the unknown ones alone.
 */
function countCards(area: HTMLElement, readEvery: boolean) {
    const top = area.getBoundingClientRect().top - area.scrollTop;
    const cards: CardBox[] = [];
    // A windowed column renders a slice of its cards. Boxes for the unrendered ones are added
    // above and below, so an index here is a position in the column, not among the visible cards.
    const window = readWindow(area);
    const elements: HTMLElement[] = [];
    /** Where the next card stands if it has to be counted rather than read. */
    let next = 0;
    /** The foot of the last card read, which the next one read settles the spacing against. */
    let foot: number | undefined;
    /** Whether where the column's cards begin has been read yet. */
    let anchored = false;
    /** Whether any card's height came from what was remembered rather than from the page. */
    let borrowed = false;

    for (const child of area.children) {
        if (!(child instanceof HTMLElement)) {
            continue;
        }

        if (!child.classList.contains("board-note")) {
            continue;
        }

        const noteId = child.dataset.noteId ?? "";
        let height = heights.get(noteId);
        let at: number | undefined;

        // The first card is always read, whatever is known of it: where a column's cards begin is
        // its own, and the ones under it are counted up from there. A card whose height is not
        // known yet is read as well, and remembered.
        if (height === undefined || !anchored || readEvery) {
            const box = child.getBoundingClientRect();
            height = box.height;
            at = box.top - top;
            anchored = true;
            if (noteId && box.height) {
                heights.set(noteId, box.height);
            }
            if (spacing === undefined && foot !== undefined) {
                spacing = at - foot;
            }
            foot = at + height;
        } else {
            borrowed = true;
        }

        const stands = at ?? next;
        cards.push({ top: stands, height });
        elements.push(child);
        next = stands + height + (spacing ?? 0);
    }

    if (!window) {
        return { cards, elements, borrowed, top, drawnFrom: 0 };
    }

    // Spread the unrendered cards evenly across the spacer covering them. Precise enough for a
    // drop, which can only land where the reader can see, and it keeps every index in column terms.
    const above = spread(window.from, 0, window.above);
    const below = spread(
        window.total - window.from - cards.length,
        window.above + (cards.length ? next - window.above : 0),
        window.below);

    return { cards: [ ...above, ...cards, ...below ], elements, borrowed, top, drawnFrom: window.from };
}

/** The window a column states on its card area, or nothing where it draws every card. */
function readWindow(area: HTMLElement) {
    const stated = area.dataset.windowCount;
    const total = stated === undefined ? Number.NaN : Number(stated);
    if (!Number.isFinite(total)) {
        return undefined;
    }

    const spacers = area.querySelectorAll<HTMLElement>(".board-window-spacer");
    return {
        from: Number(area.dataset.windowFrom ?? "0") || 0,
        total,
        above: spacers[0]?.offsetHeight ?? 0,
        below: spacers[1]?.offsetHeight ?? 0
    };
}

/** Returns `count` boxes spread evenly across `span` pixels, for cards a column does not render. */
function spread(count: number, from: number, span: number): CardBox[] {
    if (count <= 0) {
        return [];
    }

    const each = span / count;
    return Array.from({ length: count }, (_, index) => ({
        top: from + index * each,
        height: Math.max(0, each - (spacing ?? 0))
    }));
}
