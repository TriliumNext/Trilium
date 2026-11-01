/** The element at the top of a scrolled container, and how far its top is from the container's. */
export interface ScrollAnchor {
    element: Element;
    offset: number;
}

/**
 * Finds the innermost block at the top edge of `container`. With `previous`, the anchor found last
 * time, each level searches from it instead of from the first child.
 */
export function findScrollAnchor(
    container: HTMLElement,
    previous?: Element | null
): ScrollAnchor | null {
    const top = container.getBoundingClientRect().top;
    let anchor: ScrollAnchor | null = null;
    let parent: Element = container;

    for (;;) {
        const found = findFirstChildPastEdge(parent, top, getChildContaining(parent, previous));
        if (!found) break;

        anchor = { element: found.element, offset: found.rect.top - top };
        if (found.rect.top >= top) break;
        parent = found.element;
    }

    return anchor;
}

/** Scrolls `container` so that the anchor's element is back at its recorded offset. */
export function restoreScrollAnchor(container: HTMLElement, { element, offset }: ScrollAnchor) {
    if (!container.contains(element)) return;

    const top = container.getBoundingClientRect().top;
    const drift = element.getBoundingClientRect().top - top - offset;
    if (Math.abs(drift) < 1) return;

    // `behavior: "instant"` overrides the container's `scroll-behavior: smooth`.
    container.scrollTo({ top: container.scrollTop + drift, behavior: "instant" });
}

interface PlacedElement {
    element: Element;
    rect: DOMRect;
}

/**
 * Finds the first block among the children of `parent` that reaches past `top`. A usable `start`
 * limits the search to the siblings between it and the edge; otherwise all children are scanned.
 */
function findFirstChildPastEdge(
    parent: Element,
    top: number,
    start: Element | null
): PlacedElement | null {
    const startRect = start && getAnchorableRect(start);
    if (!start || !startRect) return scanForward(parent.firstElementChild, top);
    if (startRect.bottom <= top) return scanForward(start.nextElementSibling, top);

    let first: PlacedElement = { element: start, rect: startRect };
    let sibling = start.previousElementSibling;
    while (sibling) {
        const rect = getAnchorableRect(sibling);
        if (rect && rect.bottom <= top) break;
        if (rect) first = { element: sibling, rect };
        sibling = sibling.previousElementSibling;
    }
    return first;
}

function scanForward(from: Element | null, top: number): PlacedElement | null {
    for (let element = from; element; element = element.nextElementSibling) {
        const rect = element.getBoundingClientRect();
        if (rect.bottom > top && getAnchorableRect(element, rect)) return { element, rect };
    }
    return null;
}

/** Returns the box of `element` when it can anchor the scroll position: a visible in-flow block. */
function getAnchorableRect(element: Element, rect = element.getBoundingClientRect()) {
    if (rect.width === 0 && rect.height === 0) return null;

    const style = getComputedStyle(element);
    const isInline = style.display.startsWith("inline");
    if (isInline || UNANCHORED_POSITIONS.includes(style.position)) return null;
    return rect;
}

/** Returns the child of `parent` that is or holds `element`, if any. */
function getChildContaining(parent: Element, element: Element | null | undefined): Element | null {
    for (let current = element; current; current = current.parentElement) {
        if (current.parentElement === parent) return current;
    }
    return null;
}

/** Positions whose boxes do not move with the content around them. */
const UNANCHORED_POSITIONS = [ "absolute", "fixed", "sticky" ];
