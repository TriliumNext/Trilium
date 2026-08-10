/**
 * An event still being decided on: the range the reader dragged out, standing for a note that does
 * not exist yet. Nothing is created until the draft is committed (see GhostPopover), so a ghost
 * dismissed costs nothing — no note to clean up, no tombstone in the sync history.
 */
export interface EventDraft {
    startDate: string;
    endDate?: string | null;
    startTime?: string | null;
    endTime?: string | null;
}

/** A point in viewport coordinates — where a click or a drag's end fell, anchoring a popover
 *  beside it where nothing better can be found on the grid (see the anchor helpers). */
export interface AnchorPoint {
    x: number;
    y: number;
}

/**
 * Which event the view's popovers stand for: the note of a chip clicked, held by the event
 * popover, or a range just dragged out whose note is yet to be, held by the ghost (see
 * {@link EventDraft}).
 *
 * Owned by the calendar view rather than by either popover, because each is only one of the ways
 * in, and state a popover kept to itself could not be set from the code that hands selections
 * over — a committed ghost becomes the event popover's note, at the ghost's own anchor.
 */
export type CalendarSelection =
    | { noteId: string; anchor: AnchorPoint | null }
    | { draft: EventDraft; anchor: AnchorPoint | null };

/**
 * The piece of the grid a popover is stood beside, narrowed to what can be stood beside at all.
 *
 * A popover stands to one side of its anchor, which asks that there be a side. An event running the
 * length of a week — or a range dragged across one — is drawn as a piece as wide as the grid, and
 * the far edge of that is nowhere near the press that opened the popover: the card lands at the
 * other end of the month, which is how a popover comes to appear over the note tree. Where the grid
 * is as wide as the window, it lands nowhere at all — neither side has the room for a card, and
 * Popper keeps a popover within the viewport only along the axis it was placed on (the vertical
 * one, for a card standing to the left or the right; see Popover), so the card is put outside the
 * screen entirely and only its shadow is ever seen.
 *
 * So a piece wider than the card that stands beside it is narrowed to the press within it: the
 * popover appears where the eye already is, with the grid's own room on either side of it. Where
 * nothing named a point — a popover re-anchored rather than pressed for (see followLink) — the
 * piece is narrowed to the edge the card stands away from, which is the start of the span.
 */
export function narrowAnchorRect(rect: DOMRect, point: AnchorPoint | null): DOMRect {
    if (rect.width <= MAX_ANCHOR_WIDTH) {
        return rect;
    }

    const x = point
        ? Math.min(Math.max(point.x, rect.left), rect.right)
        : (glob.isRtl ? rect.right : rect.left);

    // The row's own height is kept: the card is aligned with the piece it belongs to rather than
    // with the height of the press, which is where the eye is looking either way.
    return new DOMRect(x, rect.top, 0, rect.height);
}

/** How wide a piece may be and still be stood beside: the width of the widest card the calendar
 *  anchors — the event popover's 480px, the ghost's own being narrower (see their CSS). The
 *  popover's full width rather than the lesser one a narrow window leaves it: a piece that wide on
 *  a window that narrow fills it, and the card is then placed by the viewport whatever anchor it is
 *  handed. */
const MAX_ANCHOR_WIDTH = 480;
