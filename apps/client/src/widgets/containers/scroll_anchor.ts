/** The element at the top of a scrolled container, and how far its top is from the container's. */
export interface ScrollAnchor {
    element: Element;
    offset: number;
}

/**
 * Finds the innermost block at the top edge of `container`: the first child that reaches past the
 * edge, descending into it while the edge cuts through it.
 */
export function findScrollAnchor(container: HTMLElement): ScrollAnchor | null {
    const top = container.getBoundingClientRect().top;
    let anchor: ScrollAnchor | null = null;
    let parent: Element = container;

    descend: for (;;) {
        for (const child of parent.children) {
            const rect = child.getBoundingClientRect();
            if (rect.bottom <= top || (rect.width === 0 && rect.height === 0)) continue;

            const style = getComputedStyle(child);
            const isInline = style.display.startsWith("inline");
            if (isInline || UNANCHORED_POSITIONS.includes(style.position)) continue;

            anchor = { element: child, offset: rect.top - top };
            if (rect.top >= top) break descend;

            parent = child;
            continue descend;
        }
        break;
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

/** Positions whose boxes do not move with the content around them. */
const UNANCHORED_POSITIONS = [ "absolute", "fixed", "sticky" ];
