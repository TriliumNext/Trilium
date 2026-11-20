import { revealElement } from "../services/bookmark_jump";
import { scrollRectIntoView } from "../services/highlight_matches";
import type { RailMetrics } from "./scroll_rail";

/**
 * A place `offset` px down the scrolled content of `within`, for content with no element per line.
 */
export interface ScrollRailOffsetTarget {
    within: Element;
    offset: number;
}

/** What a marker of the scroll rail points at. `null` points at nothing. */
export type ScrollRailTarget = Element | Range | ScrollRailOffsetTarget | null;

/** What an owner gives the scroll rail: the targets of its markers, and what each one does. */
export interface ScrollRailSource {
    /** The target of each marker. Reads no geometry: the rail measures the targets. */
    readTargets(): ScrollRailTarget[];
    /**
     * Runs on a click on marker `index`, in place of the jump. `false` declines, and the jump runs.
     */
    onClick?(index: number): boolean | void;
    /** The tooltip of marker `index`. */
    getTooltip?(index: number): string | undefined;
}

export type ScrollRailChange = "retire" | "refresh" | "refreshLater" | "emphasize";

/** A set of markers. Its owner publishes it once as note context data, then drives it here. */
export class ScrollRailLayer {

    /** Raised by every change of the markers. Lines read at an older generation are retired. */
    generation = 0;
    /** Whether the source must not be read until `refresh()`. */
    isPaused = false;
    /** The marker drawn thicker, or `null`. */
    emphasized: number | null = null;
    private readonly listeners = new Set<(change: ScrollRailChange) => void>();

    constructor(readonly source: ScrollRailSource) {}

    /**
     * Retires the lines before an operation changes the markers: they stop calling the source, the
     * reads already asked for are dropped, and the source is not read again until `refresh()`.
     */
    retire() {
        this.generation++;
        this.isPaused = true;
        this.notify("retire");
    }

    /** Retires the lines and requests a read after the next paint. Ends a pause of `retire()`. */
    refresh() {
        this.generation++;
        this.isPaused = false;
        this.notify("refresh");
    }

    /**
     * Retires the lines and requests one read once these calls pause, for markers that change
     * while the user types. Does not end a pause of `retire()`.
     */
    refreshLater() {
        this.generation++;
        this.notify("refreshLater");
    }

    /** Draws marker `index` of the current lines thicker, with no read. `null` draws none so. */
    emphasize(index: number | null) {
        if (index === this.emphasized) return;
        this.emphasized = index;
        this.notify("emphasize");
    }

    /** Calls `listener` on every change, until the returned function is called. */
    subscribe(listener: (change: ScrollRailChange) => void) {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    private notify(change: ScrollRailChange) {
        for (const listener of this.listeners) {
            listener(change);
        }
    }

}

/** The rows of a layer's lines on the rail. */
export interface RowSet {
    /** One per row with a line, sorted by `y`, with the first marker that lands on it. */
    rows: { y: number; first: number }[];
    /** The row of each marker, `null` for a marker with no place. */
    markerRows: (number | null)[];
}

/** A layer as the pointer and the drawing see it. */
export interface DrawnLayer {
    rows: RowSet;
    /** The marker drawn thicker, `null` while the lines are retired. */
    emphasized: number | null;
}

/** Above this many targets, a `Range` is measured by the element that contains its start. */
export const RANGE_MEASURE_LIMIT = 500;
/** Line thickness, and the inset of a line from each side of the rail, in CSS px. */
export const LINE_SIZE = { thin: 2, thick: 4, inset: 1 };

/**
 * The row of the place `offset` px down the scroller's content, in CSS px down the track.
 */
export function toRow(offset: number, { railHeight, scrollHeight }: RailMetrics) {
    const row = Math.round(offset / Math.max(scrollHeight, 1) * railHeight);
    return Math.min(Math.max(row, 0), Math.max(Math.floor(railHeight) - 1, 0));
}

/** The rows of `places`, the places of a layer's markers. A row keeps the first marker on it. */
export function toRows(places: (number | null)[], metrics: RailMetrics): RowSet {
    const firstByRow = new Map<number, number>();
    const markerRows = places.map((place, index) => {
        if (place === null) return null;
        const y = toRow(place, metrics);
        if (!firstByRow.has(y)) {
            firstByRow.set(y, index);
        }
        return y;
    });
    const rows = [ ...firstByRow ].map(([ y, first ]) => ({ y, first })).sort((a, b) => a.y - b.y);
    return { rows, markerRows };
}

/**
 * The marker of the line nearest to `y` within `distance`, over `layers` in drawing order. Where
 * layers are as near, the one drawn on top wins. A row shared by several markers gives the
 * emphasized marker when it is on that row, else the first.
 */
export function findRow(layers: DrawnLayer[], y: number, distance: number) {
    let found: { layer: number; marker: number; gap: number } | null = null;
    for (const [ layer, { rows, emphasized } ] of layers.entries()) {
        const row = findNearestRow(rows.rows, y);
        if (!row) continue;

        const gap = Math.abs(row.y - y);
        if (gap > distance || (found && gap > found.gap)) continue;
        const isEmphasizedHere = emphasized !== null && rows.markerRows[emphasized] === row.y;
        found = { layer, marker: isEmphasizedHere ? emphasized : row.first, gap };
    }
    return found && { layer: found.layer, marker: found.marker };
}

/**
 * Maps the client Y `top`, inside the box of a clipping element, into that box by content offset.
 */
export function mapIntoClip(top: number, box: ClipBox) {
    return box.top + (top - box.top + box.scrollTop) * box.clientHeight / box.scrollHeight;
}

/** The layers of the rail to draw, in drawing order. */
export interface PaintedLayer extends DrawnLayer {
    color: string;
    emphasisColor: string;
}

/**
 * Draws the lines of `layers` on `context`, whose canvas is `width` by `height` CSS px at
 * `ratio` device pixels per CSS px. Every rectangle is snapped to device pixels.
 */
export function drawRows(
    context: Pick<CanvasRenderingContext2D, "clearRect" | "fillRect" | "fillStyle">,
    { width, height, ratio }: { width: number; height: number; ratio: number },
    layers: PaintedLayer[]
) {
    const deviceHeight = Math.round(height * ratio);
    const left = Math.round(LINE_SIZE.inset * ratio);
    const right = Math.round((width - LINE_SIZE.inset) * ratio);
    const fillLine = (y: number, size: number) => {
        const thickness = Math.max(Math.round(size * ratio), 1);
        const top = Math.round(y * ratio - thickness / 2);
        context.fillRect(left, Math.min(Math.max(top, 0), deviceHeight - thickness),
            right - left, thickness);
    };

    context.clearRect(0, 0, Math.round(width * ratio), deviceHeight);
    for (const { rows, color } of layers) {
        context.fillStyle = color;
        for (const row of rows.rows) {
            fillLine(row.y, LINE_SIZE.thin);
        }
    }
    for (const { rows, emphasized, emphasisColor } of layers) {
        const y = emphasized === null ? null : rows.markerRows[emphasized] ?? null;
        if (y !== null) {
            context.fillStyle = emphasisColor;
            fillLine(y, LINE_SIZE.thick);
        }
    }
}

/** The box of an element that clips its content, in client coordinates. */
export interface ClipBox {
    top: number;
    scrollTop: number;
    clientHeight: number;
    scrollHeight: number;
}

/**
 * Places targets in the content of `scroller`, for the lines of the rail. Caches what it reads
 * per element, so it serves one read only.
 */
export class ScrollRailLocator {

    private readonly visibility = new Map<Element, boolean>();
    private readonly rects = new Map<Element, DOMRect>();
    private readonly clips = new Map<Element, ClipBox | null>();
    /** The client Y of the top of the scroller's content. */
    private readonly origin: number;

    /** With `isByElement`, a `Range` is measured by the element that contains its start. */
    constructor(private readonly scroller: Element, private readonly isByElement = false) {
        this.origin = scroller.getBoundingClientRect().top + scroller.clientTop
            - scroller.scrollTop;
    }

    /**
     * The place of `target`, in px down the scroller's content, or `null` when it names nothing.
     */
    locate(target: ScrollRailTarget): number | null {
        const element = getTargetElement(target, this.scroller);
        if (!element || !target) return null;

        if (!this.isVisible(element)) {
            const standIn = this.findStandIn(element);
            return standIn ? this.mapUp(this.getRect(standIn).top, standIn.parentElement) : null;
        }
        if (target instanceof Range) {
            const top = this.isByElement
                ? this.getRect(element).top
                : target.getBoundingClientRect().top;
            return this.mapUp(top, element);
        }
        if (target instanceof Element) {
            return this.mapUp(this.getRect(element).top, element.parentElement);
        }

        const clip = this.getClip(element);
        const top = clip
            ? mapIntoClip(clip.top - clip.scrollTop + target.offset, clip)
            : this.getRect(element).top + element.clientTop + target.offset;
        return this.mapUp(top, element.parentElement);
    }

    /** Maps the client Y `top` through each clipping element from `from` up to the scroller. */
    private mapUp(top: number, from: Element | null) {
        let mapped = top;
        for (let element = from; element && element !== this.scroller;
            element = element.parentElement) {
            const clip = this.getClip(element);
            if (clip) {
                mapped = mapIntoClip(mapped, clip);
            }
        }
        return mapped - this.origin;
    }

    /**
     * The element shown in place of the hidden `element`: the nearest previous sibling of its
     * topmost hidden ancestor that shows, else the nearest ancestor with a box.
     */
    private findStandIn(element: Element) {
        let hidden = element;
        for (let parent = element.parentElement;
            parent && parent !== this.scroller && !this.isVisible(parent);
            parent = parent.parentElement) {
            hidden = parent;
        }
        for (let sibling = hidden.previousElementSibling; sibling;
            sibling = sibling.previousElementSibling) {
            if (this.hasBox(sibling)) return sibling;
        }
        for (let parent = hidden.parentElement; parent && parent !== this.scroller;
            parent = parent.parentElement) {
            if (this.hasBox(parent)) return parent;
        }
        return null;
    }

    /**
     * Whether `element` shows with a height, which a `display: contents` element and the host of
     * the rail have not.
     */
    private hasBox(element: Element) {
        return this.isVisible(element) && this.getRect(element).height > 0;
    }

    private isVisible(element: Element) {
        let isVisible = this.visibility.get(element);
        if (isVisible === undefined) {
            isVisible = element.checkVisibility();
            this.visibility.set(element, isVisible);
        }
        return isVisible;
    }

    private getRect(element: Element) {
        let rect = this.rects.get(element);
        if (!rect) {
            rect = element.getBoundingClientRect();
            this.rects.set(element, rect);
        }
        return rect;
    }

    /** The box of `element` while it clips content that overflows it, else `null`. */
    private getClip(element: Element) {
        let clip = this.clips.get(element);
        if (clip === undefined) {
            clip = element.scrollHeight > element.clientHeight
                && getComputedStyle(element).overflowY !== "visible"
                ? {
                    top: this.getRect(element).top + element.clientTop,
                    scrollTop: element.scrollTop,
                    clientHeight: element.clientHeight,
                    scrollHeight: element.scrollHeight
                }
                : null;
            this.clips.set(element, clip);
        }
        return clip;
    }

}

/**
 * Goes to `target` as "Search in note" goes to a match: reveals it, then centers it in each
 * scrolling box around it, innermost first, with no smooth scrolling. A target that stays hidden,
 * or that a box which cannot scroll cuts off, is centered where its line is drawn. A target that
 * names nothing gives no jump.
 */
export function goToTarget(target: ScrollRailTarget, scroller: HTMLElement) {
    const element = getTargetElement(target, scroller);
    if (!element || !target) return;

    revealElement(element, scroller);
    if (element.checkVisibility() && !isCutOff(element, scroller)) {
        if (target instanceof Range || target instanceof Element) {
            const from = target instanceof Element ? element.parentElement : element;
            scrollRectIntoView(from, () => target.getBoundingClientRect(), "instant");
            return;
        }

        const { within, offset } = target;
        within.scrollTo({ top: offset - within.clientHeight / 2, behavior: "instant" });
        scrollRectIntoView(within.parentElement, () => {
            const box = within.getBoundingClientRect();
            return {
                left: box.left,
                width: box.width,
                top: box.top + within.clientTop + offset - within.scrollTop,
                height: 0
            };
        }, "instant");
        return;
    }

    const place = new ScrollRailLocator(scroller).locate(target);
    if (place !== null) {
        scroller.scrollTo({ top: place - scroller.clientHeight / 2, behavior: "instant" });
    }
}

/**
 * The element of `target` while it is connected inside `scroller`, else `null`. A collapsed range
 * names nothing: a match is never empty, so its text is gone.
 */
export function getTargetElement(target: ScrollRailTarget, scroller: Element) {
    let element: Element | null;
    if (!target) {
        return null;
    } else if (target instanceof Range) {
        if (target.collapsed) return null;
        const node = target.startContainer;
        element = node instanceof Element ? node : node.parentElement;
    } else if (target instanceof Element) {
        element = target;
    } else {
        element = target.within;
    }
    return element?.isConnected && scroller.contains(element) ? element : null;
}

/** Whether an element between `element` and `scroller` clips it and cannot scroll. */
function isCutOff(element: Element, scroller: Element) {
    for (let ancestor = element.parentElement; ancestor && ancestor !== scroller;
        ancestor = ancestor.parentElement) {
        if (ancestor.scrollHeight <= ancestor.clientHeight) continue;
        const { overflowY } = getComputedStyle(ancestor);
        if (overflowY === "hidden" || overflowY === "clip") return true;
    }
    return false;
}

/** The row of `rows`, sorted by `y`, nearest to `y`. */
function findNearestRow(rows: RowSet["rows"], y: number) {
    let low = 0;
    let high = rows.length - 1;
    while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (rows[middle].y < y) {
            low = middle + 1;
        } else {
            high = middle;
        }
    }
    const after = rows[low];
    const before = rows[low - 1];
    if (!before) return after;
    if (!after) return before;
    return y - before.y <= after.y - y ? before : after;
}
