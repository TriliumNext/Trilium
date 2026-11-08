/** Scroll offsets come at sub-pixel precision, so an edge is never tested exactly. */
const EDGE_EPSILON = 1;

/** How far a fade reaches from an edge when the caller names no size. Matches `scroll_fade.css`. */
export const DEFAULT_FADE_SIZE = 20;

/** Every class that {@link getScrollFadeClasses} can return. */
export const SCROLL_FADE_CLASSES: readonly string[] = [
    "scroll-fade",
    "scroll-fade-horizontal",
    "scroll-fade-vertical",
    "scroll-fade-start",
    "scroll-fade-end",
    "scroll-fade-rtl"
];

export type ScrollFadeDirection = "horizontal" | "vertical";

export interface ScrollFadeWatchOptions {
    /** Which way the container scrolls. */
    direction?: ScrollFadeDirection;
    /** How far the fade reaches from each edge, in pixels. */
    size?: number;
    /**
     * The least a container has to scroll for its edges to fade, in pixels. Defaults to the fade
     * size. Lower it where a few hidden pixels still need a fade, such as text cut off by one
     * character.
     */
    minOverflow?: number;
}

export interface ScrollFadeState {
    /** Whether content lies past the start edge. */
    isStartFaded: boolean;
    /** Whether content lies past the end edge. */
    isEndFaded: boolean;
    /** How much of the content lies outside the box along the scrolling axis, in pixels. */
    overflow: number;
    /** The size of the box along the scrolling axis, in pixels. */
    clientSize: number;
    /** Whether a horizontal container lays out right to left, with its start edge on the right. */
    isRtl: boolean;
}

/** The state of a container that has not been measured, or that fits its content. */
export const NO_SCROLL_FADE: ScrollFadeState = {
    isStartFaded: false,
    isEndFaded: false,
    overflow: 0,
    clientSize: 0,
    isRtl: false
};

export interface ScrollFadeWatch {
    /** Measures again, for content that changes without a resize or a DOM mutation. */
    measure(): void;
    /** Stops watching the container. */
    disconnect(): void;
}

/**
 * Watches the scroll container `element` and reports which of its edges `scroll_fade.css` fades.
 * Measures before it returns, then on every scroll, resize and content change. `onChange` runs
 * only when the state differs from the last one.
 */
export function watchScrollFade(
    element: HTMLElement,
    onChange: (state: ScrollFadeState) => void,
    options: ScrollFadeWatchOptions = {}
): ScrollFadeWatch {
    const { direction = "vertical", size, minOverflow = size ?? DEFAULT_FADE_SIZE } = options;
    const isHorizontal = direction === "horizontal";
    let state: ScrollFadeState | undefined;
    let frame: number | undefined;

    const measure = () => {
        // A right-to-left container scrolls towards negative offsets.
        const travelled = Math.abs(isHorizontal ? element.scrollLeft : element.scrollTop);
        const clientSize = isHorizontal ? element.clientWidth : element.clientHeight;
        const overflow = (isHorizontal ? element.scrollWidth : element.scrollHeight) - clientSize;
        const isFaded = overflow > minOverflow;
        const next: ScrollFadeState = {
            isStartFaded: isFaded && travelled > EDGE_EPSILON,
            isEndFaded: isFaded && travelled < overflow - EDGE_EPSILON,
            overflow,
            clientSize,
            isRtl: isHorizontal && getComputedStyle(element).direction === "rtl"
        };
        if (!state || !isSameState(state, next)) {
            state = next;
            onChange(next);
        }
    };

    // Observer callbacks share one measurement per frame. A scroll is measured at once.
    const requestMeasure = () => {
        frame ??= requestAnimationFrame(() => {
            frame = undefined;
            measure();
        });
    };

    // The children as well, since one of them can grow while the box keeps its size.
    const resizeObserver = new ResizeObserver(requestMeasure);
    const observeChildren = () => {
        for (const child of element.children) {
            resizeObserver.observe(child);
        }
    };
    const mutationObserver = new MutationObserver(() => {
        observeChildren();
        requestMeasure();
    });

    measure();
    resizeObserver.observe(element);
    observeChildren();
    mutationObserver.observe(element, { childList: true, subtree: true, characterData: true });
    element.addEventListener("scroll", measure, { passive: true });

    return {
        measure,
        disconnect() {
            resizeObserver.disconnect();
            mutationObserver.disconnect();
            element.removeEventListener("scroll", measure);
            if (frame !== undefined) {
                cancelAnimationFrame(frame);
                frame = undefined;
            }
        }
    };
}

/** The classes of `scroll_fade.css` for a container that scrolls in `direction`, in `state`. */
export function getScrollFadeClasses(direction: ScrollFadeDirection, state: ScrollFadeState) {
    const classes = [ "scroll-fade", `scroll-fade-${direction}` ];
    if (state.isStartFaded) {
        classes.push("scroll-fade-start");
    }
    if (state.isEndFaded) {
        classes.push("scroll-fade-end");
    }
    if (state.isRtl) {
        classes.push("scroll-fade-rtl");
    }
    return classes;
}

function isSameState(a: ScrollFadeState, b: ScrollFadeState) {
    return (Object.keys(a) as (keyof ScrollFadeState)[]).every((key) => a[key] === b[key]);
}
