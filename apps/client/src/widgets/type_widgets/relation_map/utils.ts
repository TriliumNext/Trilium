import { t } from "../../../services/i18n";


export function noteIdToId(noteId: string) {
    return `rel-map-note-${noteId}`;
}

export function idToNoteId(id: string) {
    return id.substr(13);
}

/** How far, in pixels, the pointer can move between press and release for the click to count. */
export const CLICK_TOLERANCE = 4;

export function getZoom(container: HTMLDivElement) {
    const transform = window.getComputedStyle(container).transform;
    if (transform === "none") {
        return 1;
    }

    const matrixRegex = /matrix\((-?\d*\.?\d+),\s*0,\s*0,\s*-?\d*\.?\d+,\s*-?\d*\.?\d+,\s*-?\d*\.?\d+\)/;
    const matches = transform.match(matrixRegex);

    if (!matches) {
        throw new Error(t("relation_map.cannot_match_transform", { transform }));
    }

    return parseFloat(matches[1]);
}

export function getMousePosition(evt: MouseEvent, container: HTMLDivElement, zoom: number) {
    const rect = container.getBoundingClientRect();

    return {
        x: ((evt.clientX ?? 0) - rect.left) / zoom,
        y: ((evt.clientY ?? 0) - rect.top) / zoom
    };
}

/** Must agree with `--relation-map-pane-width` in NotePane.css. */
export const PANE_WIDTH = 380;

/** Must agree with `--relation-map-inset` in NotePane.css. */
const MAP_INSET = 10;

/** How far into the map the pane reaches from its trailing edge: its width plus the inset. */
const PANE_REACH = PANE_WIDTH + MAP_INSET;

/** Must agree with the pane's `bottom` in NotePane.css, which clears the toolbars at the foot. */
const MAP_FOOT = 2 * MAP_INSET + 28;

/** Minimum gap between a revealed box and the edges of the visible area. */
const AIR = 20;

/** If the map leaves less than this width beside the pane, the pane is ignored and the box is only
 *  kept within the map. */
const MIN_UNCOVERED_WIDTH = 200;

interface Rect {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

/**
 * How far to pan the map so that `box` is in the part of the map not covered by the note pane, or
 * `null` when it already is. Each axis on which the box does not fit is centred in that part;
 * an axis on which it fits is left alone.
 *
 * Both rectangles are in page coordinates, as `getBoundingClientRect()` gives them, which is also
 * what `PanZoom.moveBy()` takes.
 */
export function revealOffset(box: Rect, map: Rect, isRtl: boolean) {
    const paneReach = map.right - map.left - PANE_REACH >= MIN_UNCOVERED_WIDTH ? PANE_REACH : 0;
    const visible = {
        left: map.left + (isRtl ? paneReach : 0) + AIR,
        right: map.right - (isRtl ? 0 : paneReach) - AIR,
        top: map.top + AIR,
        bottom: map.bottom - MAP_FOOT - AIR
    };

    const dx = box.left >= visible.left && box.right <= visible.right
        ? 0
        : (visible.left + visible.right) / 2 - (box.left + box.right) / 2;
    const dy = box.top >= visible.top && box.bottom <= visible.bottom
        ? 0
        : (visible.top + visible.bottom) / 2 - (box.top + box.bottom) / 2;

    return dx || dy ? { dx, dy } : null;
}
