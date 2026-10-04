/** The axes that a resize changes. */
export interface ResizeAxes {
    width: boolean;
    height: boolean;
}

/** A size in pixels. An axis that is left out does not change, and a `null` width is full. */
export interface ResizeSize {
    width?: number | null;
    height?: number;
}

export interface ResizeGestureOptions {
    /** The pressed element, which captures the pointer. */
    handle: Element;
    axes: ResizeAxes;
    /** The element whose width changes. Its width is full once it reaches its parent's. */
    widthTarget: HTMLElement;
    /** Whether the width target is centered, so that its width changes on both sides. */
    isCentered: boolean;
    /** The element whose height changes. */
    heightTarget: HTMLElement;
    /** The smallest width, in pixels. */
    minWidth: number;
    /** The smallest height, in pixels. */
    minHeight: number;
    /** Shows the size while the pointer moves. */
    onPreview: (size: ResizeSize) => void;
    /** Saves the size at which the pointer is released. */
    onCommit: (size: ResizeSize) => void;
    /** Ends the gesture without a change, on Escape, a `pointercancel` or a lost capture. */
    onCancel: () => void;
    /** Ends the gesture when the pointer is released without moving. */
    onTap: () => void;
}

/** The distance a pointer moves before a press becomes a resize, in pixels. */
const DRAG_THRESHOLD = 3;

/** The distance from the top or bottom of the scroll container that scrolls it, in pixels. */
const AUTO_SCROLL_EDGE = 40;

/** The largest distance scrolled per frame, in pixels. */
const AUTO_SCROLL_STEP = 16;

/**
 * Resizes until the pointer pressed in `event` is released. The width grows towards the inline
 * end, or on both sides when centered, the height towards the bottom, and the scroll container
 * scrolls near its edges. Returns a function that cancels the gesture as Escape does, while it is
 * under way.
 */
export function startResizeGesture(event: PointerEvent, options: ResizeGestureOptions) {
    const { axes, widthTarget, heightTarget } = options;
    const { pointerId, clientX: startX, clientY: startY } = event;
    const startWidth = parseFloat(getComputedStyle(widthTarget).width);
    const startHeight = parseFloat(getComputedStyle(heightTarget).height);
    const maxWidth = getContainerWidth(widthTarget);
    const inlineDirection = getComputedStyle(widthTarget).direction === "rtl" ? -1 : 1;
    const widthFactor = inlineDirection * (options.isCentered ? 2 : 1);
    const scroller = findScrollContainer(heightTarget);
    const startScrollTop = scroller.scrollTop;

    let x = startX;
    let y = startY;
    let isMoved = false;
    let isActive = true;
    let frame = 0;

    options.handle.setPointerCapture(pointerId);

    const getSize = () => {
        const size: ResizeSize = {};
        if (axes.width) {
            const width = Math.max(startWidth + (x - startX) * widthFactor, options.minWidth);
            size.width = width >= maxWidth ? null : width;
        }
        if (axes.height) {
            const scrolled = scroller.scrollTop - startScrollTop;
            size.height = Math.max(startHeight + y - startY + scrolled, options.minHeight);
        }
        return size;
    };

    const update = () => {
        isMoved ||= Math.hypot(x - startX, y - startY) >= DRAG_THRESHOLD;
        if (isMoved) {
            options.onPreview(getSize());
        }
    };

    const scrollStep = () => {
        const step = isMoved ? getAutoScrollStep(scroller, y) : 0;
        if (step) {
            scroller.scrollTop += step;
            update();
        }
        frame = requestAnimationFrame(scrollStep);
    };

    const onPointerMove = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId === pointerId) {
            x = moveEvent.clientX;
            y = moveEvent.clientY;
            update();
        }
    };

    const onPointerUp = (upEvent: PointerEvent) => {
        if (upEvent.pointerId !== pointerId) {
            return;
        }
        stop();
        if (isMoved) {
            options.onCommit(getSize());
        } else {
            options.onTap();
        }
    };

    const onPointerCancel = (cancelEvent: PointerEvent) => {
        if (cancelEvent.pointerId === pointerId) {
            stop();
            options.onCancel();
        }
    };

    const onKeyDown = (keyEvent: KeyboardEvent) => {
        if (keyEvent.key === "Escape") {
            keyEvent.preventDefault();
            keyEvent.stopPropagation();
            stop();
            options.onCancel();
        }
    };

    const stop = () => {
        isActive = false;
        cancelAnimationFrame(frame);
        window.removeEventListener("pointermove", onPointerMove, true);
        window.removeEventListener("pointerup", onPointerUp, true);
        window.removeEventListener("pointercancel", onPointerCancel, true);
        window.removeEventListener("lostpointercapture", onPointerCancel, true);
        window.removeEventListener("keydown", onKeyDown, true);
    };

    window.addEventListener("pointermove", onPointerMove, true);
    window.addEventListener("pointerup", onPointerUp, true);
    window.addEventListener("pointercancel", onPointerCancel, true);
    // The handle loses the pointer when it leaves the page, as when its editor closes.
    window.addEventListener("lostpointercapture", onPointerCancel, true);
    window.addEventListener("keydown", onKeyDown, true);
    if (axes.height) {
        frame = requestAnimationFrame(scrollStep);
    }

    return () => {
        if (isActive) {
            stop();
            options.onCancel();
        }
    };
}

/** The width inside the padding of the parent of `element`. */
function getContainerWidth(element: HTMLElement) {
    const parent = element.parentElement ?? document.documentElement;
    const style = getComputedStyle(parent);
    return parent.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
}

/** The closest ancestor of `element` that scrolls vertically, or the document. */
function findScrollContainer(element: HTMLElement): Element {
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        if (/auto|scroll/.test(getComputedStyle(parent).overflowY)) {
            return parent;
        }
    }

    return document.documentElement;
}

/**
 * The distance to scroll `scroller` by while the pointer is at `y`: further the closer it is to
 * the top or bottom edge, and nothing away from them.
 */
function getAutoScrollStep(scroller: Element, y: number) {
    const { top, bottom } = scroller === document.documentElement
        ? { top: 0, bottom: window.innerHeight }
        : scroller.getBoundingClientRect();

    let depth = 0;
    if (y > bottom - AUTO_SCROLL_EDGE) {
        depth = y - (bottom - AUTO_SCROLL_EDGE);
    } else if (y < top + AUTO_SCROLL_EDGE) {
        depth = y - (top + AUTO_SCROLL_EDGE);
    }

    const ratio = Math.max(-1, Math.min(1, depth / AUTO_SCROLL_EDGE));
    return Math.round(ratio * AUTO_SCROLL_STEP);
}
