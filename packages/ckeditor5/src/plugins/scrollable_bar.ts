import {
    type ScrollFadeState, watchScrollFade
} from "@triliumnext/commons/src/lib/scroll_fade.js";

/** The classes of a scrollable bar, styled by `scrollable_bar.css`. */
export const SCROLLABLE_BAR_CLASSES = {
    bar: "scrollable-bar",
    overflowing: "scrollable-bar--overflowing",
    viewport: "scrollable-bar-viewport",
    edge: "scrollable-bar-edge",
    startEdge: "scrollable-bar-edge--start",
    endEdge: "scrollable-bar-edge--end",
    button: "scrollable-bar-button"
} as const;

/** The edge of the bar that a button scrolls toward: left or right, depending on the direction. */
export type ScrollableBarEdge = "start" | "end";

export interface ScrollableBarLabels {
    /** The label of the button that scrolls toward the start. */
    start: string;
    /** The label of the button that scrolls toward the end. */
    end: string;
}

export interface ScrollableBar {
    /**
     * Scrolls the viewport the least distance that shows all of `item`, or its start when it is
     * wider than the viewport. The scroll is animated unless motion is turned off.
     */
    reveal(item: Element, options?: { isAnimated?: boolean }): void;
    /** Stops watching the bar and removes its listeners. */
    disconnect(): void;
}

/**
 * Builds an empty scrollable bar: a single-row viewport for the items, between the two edges with
 * the buttons that scroll it. Add the items to `viewport`, then call {@link attachScrollableBar}.
 *
 * The module imports nothing from CKEditor, so pages that only display content can load it.
 */
export function createScrollableBar(document: Document, labels: ScrollableBarLabels) {
    const bar = document.createElement("div");
    bar.className = SCROLLABLE_BAR_CLASSES.bar;
    const viewport = document.createElement("div");
    viewport.className = SCROLLABLE_BAR_CLASSES.viewport;
    bar.append(
        createScrollableBarEdge(document, "start", labels.start),
        viewport,
        createScrollableBarEdge(document, "end", labels.end)
    );
    return { bar, viewport };
}

/**
 * Builds the space at one edge of a bar, with the button that scrolls toward that edge in its
 * center: an `icon-action` button with a Boxicons chevron, out of the tab order. A press anywhere
 * in the space counts as a press on the button.
 */
export function createScrollableBarEdge(
    document: Document,
    edge: ScrollableBarEdge,
    label: string
) {
    const isStart = edge === "start";
    const edgeClass = isStart ? SCROLLABLE_BAR_CLASSES.startEdge : SCROLLABLE_BAR_CLASSES.endEdge;
    const element = document.createElement("div");
    element.className = `${SCROLLABLE_BAR_CLASSES.edge} ${edgeClass}`;

    const button = document.createElement("button");
    button.type = "button";
    const icon = isStart ? "bx-chevron-left" : "bx-chevron-right";
    button.className = `icon-action bx ${icon} ${SCROLLABLE_BAR_CLASSES.button}`;
    button.tabIndex = -1;
    button.title = label;
    button.setAttribute("aria-label", label);
    element.append(button);
    return element;
}

/**
 * Makes `bar` scroll: its buttons show while the items do not fit the bar without them, and the
 * button of an edge that is reached is disabled. A click on a button scrolls by most of the
 * viewport's width; holding the button down scrolls continuously until it is released. A press on
 * the bar outside the viewport does not move the focus and does not reach the listeners of the
 * bar's ancestors, such as an editor's.
 *
 * Items size relative to the bar, in `cqi` units, not to the viewport, which the edges narrow.
 */
export function attachScrollableBar(bar: HTMLElement, viewport: HTMLElement): ScrollableBar {
    const document = bar.ownerDocument;
    let isRtl = false;
    let holdTimer: ReturnType<typeof setTimeout> | undefined;
    let holdFrame: number | undefined;
    /** Whether the press that ends with the next click scrolled while it was held. */
    let isClickHandled = false;

    const getDirection = (button: HTMLElement) => {
        const isTowardStart = !!button.closest(`.${SCROLLABLE_BAR_CLASSES.startEdge}`);
        return (isTowardStart ? -1 : 1) * (isRtl ? -1 : 1);
    };
    const stopHolding = () => {
        clearTimeout(holdTimer);
        if (holdFrame !== undefined) {
            cancelAnimationFrame(holdFrame);
        }
        holdTimer = undefined;
        holdFrame = undefined;
        document.removeEventListener("pointerup", stopHolding);
        document.removeEventListener("pointercancel", stopHolding);
    };
    const scrollWhileHeld = (button: HTMLButtonElement) => {
        isClickHandled = true;
        // `position` keeps the fraction of a pixel that `scrollLeft` can round away each step.
        let position = viewport.scrollLeft;
        let lastTime: number | null = null;
        const step = (time: number) => {
            if (button.disabled) {
                stopHolding();
                return;
            }
            const elapsed = lastTime === null ? 0 : time - lastTime;
            lastTime = time;
            position += getDirection(button) * HOLD_SPEED * elapsed / 1000;
            viewport.scrollLeft = position;
            holdFrame = requestAnimationFrame(step);
        };
        holdFrame = requestAnimationFrame(step);
    };

    const onPointerDown = (event: PointerEvent) => {
        if (viewport.contains(event.target as Node)) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        stopHolding();
        isClickHandled = false;
        const button = findButton(event);
        if (button && !button.disabled && event.button === 0) {
            holdTimer = setTimeout(() => scrollWhileHeld(button), HOLD_DELAY);
            document.addEventListener("pointerup", stopHolding);
            document.addEventListener("pointercancel", stopHolding);
        }
    };
    const onClick = (event: MouseEvent) => {
        const button = findButton(event);
        if (!button || button.disabled || isClickHandled) {
            isClickHandled = false;
            return;
        }
        viewport.scrollBy({
            left: getDirection(button) * viewport.clientWidth * PAGE_SHARE,
            behavior: getScrollBehavior(viewport)
        });
    };
    const showState = (state: ScrollFadeState) => {
        isRtl = state.isRtl;
        // The edges take their width from the viewport while they show.
        let overflow = state.overflow;
        for (const edge of bar.querySelectorAll<HTMLElement>(
            `:scope > .${SCROLLABLE_BAR_CLASSES.edge}`)) {
            overflow -= edge.offsetWidth;
        }
        bar.classList.toggle(SCROLLABLE_BAR_CLASSES.overflowing, overflow > MIN_OVERFLOW);
        const buttons = bar.querySelectorAll<HTMLButtonElement>(
            `:scope > .${SCROLLABLE_BAR_CLASSES.edge} > .${SCROLLABLE_BAR_CLASSES.button}`);
        for (const button of buttons) {
            const isStart = !!button.closest(`.${SCROLLABLE_BAR_CLASSES.startEdge}`);
            button.disabled = !(isStart ? state.isStartFaded : state.isEndFaded);
            // `icon-action` buttons look disabled through the class.
            button.classList.toggle("disabled", button.disabled);
        }
    };

    const watch = watchScrollFade(viewport, showState, {
        direction: "horizontal",
        minOverflow: MIN_OVERFLOW
    });
    bar.addEventListener("pointerdown", onPointerDown);
    bar.addEventListener("click", onClick);

    return {
        reveal(item, { isAnimated = true } = {}) {
            // A bar that has just been shown still has the buttons it had while hidden.
            watch.measure();
            const distance = getRevealDistance(
                viewport.getBoundingClientRect(), item.getBoundingClientRect(), isRtl);
            if (distance) {
                viewport.scrollBy({
                    left: distance,
                    behavior: isAnimated ? getScrollBehavior(viewport) : "instant"
                });
            }
        },
        disconnect() {
            stopHolding();
            watch.disconnect();
            bar.removeEventListener("pointerdown", onPointerDown);
            bar.removeEventListener("click", onClick);
            bar.classList.remove(SCROLLABLE_BAR_CLASSES.overflowing);
        }
    };
}

/** The share of the viewport's width that a button scrolls by. */
const PAGE_SHARE = 0.8;

/** Overflow up to this many pixels is rounding and shows no buttons. */
const MIN_OVERFLOW = 1;

/** How long a button is held down before it scrolls continuously, in milliseconds. */
const HOLD_DELAY = 300;

/** The speed of the continuous scroll while a button is held down, in pixels per second. */
const HOLD_SPEED = 900;

/** The button of the edge that `event` happened in. */
function findButton(event: Event) {
    const edge = (event.target as Element).closest(`.${SCROLLABLE_BAR_CLASSES.edge}`);
    return edge?.querySelector<HTMLButtonElement>(`.${SCROLLABLE_BAR_CLASSES.button}`);
}

/** The horizontal distance to scroll `box` by so that it shows `rect`, from its start edge. */
function getRevealDistance(box: DOMRect, rect: DOMRect, isRtl: boolean) {
    const pastLeft = rect.left - box.left;
    const pastRight = rect.right - box.right;
    if (isRtl) {
        if (pastRight > 0) {
            return pastRight;
        }
        return pastLeft < 0 ? Math.max(pastLeft, pastRight) : 0;
    }
    if (pastLeft < 0) {
        return pastLeft;
    }
    return pastRight > 0 ? Math.min(pastRight, pastLeft) : 0;
}

/** Smooth scrolling, unless Trilium's animations or the system's motion are turned off. */
function getScrollBehavior(element: Element): ScrollBehavior {
    const isReduced = element.ownerDocument.body.classList.contains("motion-disabled")
        || matchMedia("(prefers-reduced-motion: reduce)").matches;
    return isReduced ? "instant" : "smooth";
}
