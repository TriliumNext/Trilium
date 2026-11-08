/**
 * The distance from an edge of a visible area that scrolls it, in pixels. Less than
 * `--ck-table-column-bar-end-gap`, so the last divider of a scrolled table rests outside it.
 */
const AUTO_SCROLL_EDGE = 40;
/** The largest distance scrolled per frame, in pixels. */
const AUTO_SCROLL_STEP = 16;

/** A box in the viewport, in pixels. */
export interface ClientBox {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

/** The box inside the borders and scroll bars of `element`, in the viewport. */
export function getClientBox(element: HTMLElement): ClientBox {
    if (element === document.documentElement) {
        return { left: 0, top: 0, right: element.clientWidth, bottom: element.clientHeight };
    }

    const rect = element.getBoundingClientRect();
    const left = rect.left + element.clientLeft;
    const top = rect.top + element.clientTop;
    return { left, top, right: left + element.clientWidth, bottom: top + element.clientHeight };
}

/**
 * The closest ancestor of `element` that scrolls vertically, or that clips it horizontally, or the
 * document.
 */
export function findScroller(
    element: HTMLElement,
    overflow: "overflowX" | "overflowY"
): HTMLElement {
    const pattern = overflow === "overflowX" ? /auto|scroll|hidden|clip/ : /auto|scroll/;
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        if (pattern.test(getComputedStyle(parent)[overflow])) {
            return parent;
        }
    }
    return document.documentElement;
}

/** The bottom of the visual viewport, which is above an on-screen keyboard. */
export function getViewportBottom() {
    const viewport = window.visualViewport;
    /* v8 ignore next 3 -- defensive: supported browsers have a visual viewport */
    if (!viewport) {
        return Infinity;
    }
    return viewport.offsetTop + viewport.height;
}

/** The part of the viewport that all `boxes` cover. See `isEmptyBox` for boxes that do not meet. */
export function intersectBoxes(first: ClientBox, ...others: ClientBox[]): ClientBox {
    let { left, top, right, bottom } = first;
    for (const box of others) {
        left = Math.max(left, box.left);
        top = Math.max(top, box.top);
        right = Math.min(right, box.right);
        bottom = Math.min(bottom, box.bottom);
    }
    return { left, top, right, bottom };
}

export function isEmptyBox({ left, top, right, bottom }: ClientBox) {
    return right <= left || bottom <= top;
}

export function isInsideBox(x: number, y: number, { left, top, right, bottom }: ClientBox) {
    return x >= left && x <= right && y >= top && y <= bottom;
}

/**
 * The distance to scroll by while the pointer is at `position`, between `start` and `end` of the
 * visible area: further the closer it is to either end, and nothing away from them.
 */
export function getAutoScrollStep(position: number, start: number, end: number) {
    let depth = 0;
    if (position > end - AUTO_SCROLL_EDGE) {
        depth = position - (end - AUTO_SCROLL_EDGE);
    } else if (position < start + AUTO_SCROLL_EDGE) {
        depth = position - (start + AUTO_SCROLL_EDGE);
    }

    const ratio = Math.max(-1, Math.min(1, depth / AUTO_SCROLL_EDGE));
    return Math.round(ratio * AUTO_SCROLL_STEP);
}
