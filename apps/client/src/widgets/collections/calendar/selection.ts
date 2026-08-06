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
