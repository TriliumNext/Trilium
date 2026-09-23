/**
 * Scrolls a container while something is carried near its edge.
 *
 * A target names the container and which of the two axes it answers for, and several can be pulled
 * at once: a board's card carried into the bottom corner of its last column walks the board
 * sideways and the column down together, and a segment carried past the foot of a card walks
 * whatever the card is scrolled inside.
 */

/** How near an edge the pointer comes before the container starts to move, in pixels. */
const MARGIN = 60;

/** How fast it moves with the pointer at the very edge, in pixels a second. */
const SPEED = 1350;

export interface ScrollTarget {
    element: HTMLElement;
    axis: "x" | "y";
}

export interface EdgeScrollOptions {
    margin?: number;
    speed?: number;
    /**
     * What the pointer cannot be carried past at each edge of the screen, read afresh each frame.
     *
     * A container reaching under a fixed toolbar, or past the foot of the screen altogether, has an
     * edge no finger can reach: the pull is measured against what is left of it instead, so resting
     * against the toolbar pulls as hard as resting on the edge would.
     */
    reach?: () => Insets;
    /** Called after each frame that moved something, the places on screen having changed. */
    onScroll?: () => void;
}

/** How far in from each edge of the screen the pointer can be carried. */
export interface Insets {
    top: number;
    bottom: number;
    left: number;
    right: number;
}

/**
 * How hard a point pulls a box towards one of its edges.
 *
 * Answers -1 at the near edge and +1 at the far one, easing off to 0 at the inner limit of the
 * margin, so the pull grows as the pointer closes on the edge rather than switching on at it. A
 * point outside the box pulls at full strength, which is what carries something held beyond the
 * board along.
 *
 * @param near the box's near edge, and @param far its far one, along the axis in question.
 * @param position the point, in the same terms.
 * @param margin how far in from each edge the pull reaches.
 */
export function edgePull(near: number, far: number, position: number, margin: number): number {
    if (far - near <= margin * 2) {
        return 0;
    }

    if (position < near + margin) {
        return -Math.min(1, (near + margin - position) / margin);
    }

    if (position > far - margin) {
        return Math.min(1, (position - (far - margin)) / margin);
    }

    return 0;
}

/**
 * Moves a container along by a step of the walk.
 *
 * Asked for instantly however the container is styled: `scroll-behavior: smooth` would otherwise
 * make an animation of every frame's step, each one replacing the last before it had arrived, and
 * the walk would crawl at a fraction of the speed it was asked for. The app's own scrolling
 * containers are styled that way.
 */
function walk(element: HTMLElement, axis: "x" | "y", distance: number) {
    const to = axis === "x"
        ? { left: element.scrollLeft + distance }
        : { top: element.scrollTop + distance };

    if (element.scrollTo) {
        element.scrollTo({ ...to, behavior: "instant" });
        return;
    }

    if (axis === "x") {
        element.scrollLeft += distance;
    } else {
        element.scrollTop += distance;
    }
}

/** What the pointer can reach of the screen, which is the screen less whatever stands over it. */
function reachable(insets?: Insets) {
    const { top = 0, bottom = 0, left = 0, right = 0 } = insets ?? {};
    return new DOMRect(left, top,
        Math.max(0, window.innerWidth - left - right),
        Math.max(0, window.innerHeight - top - bottom));
}

/** What the two boxes have in common, which is as much of the container as the pointer reaches. */
function intersect(box: DOMRect, within: DOMRect) {
    const left = Math.max(box.left, within.left);
    const top = Math.max(box.top, within.top);
    return new DOMRect(left, top,
        Math.max(0, Math.min(box.right, within.right) - left),
        Math.max(0, Math.min(box.bottom, within.bottom) - top));
}

/** Whether a container has anywhere left to go in the given direction. */
export function canScroll(element: HTMLElement, axis: "x" | "y", pull: number): boolean {
    const [ offset, size, content ] = axis === "x"
        ? [ element.scrollLeft, element.clientWidth, element.scrollWidth ]
        : [ element.scrollTop, element.clientHeight, element.scrollHeight ];

    return pull < 0 ? offset > 0 : offset < content - size;
}

export function createEdgeScroller({
    margin = MARGIN, speed = SPEED, reach, onScroll
}: EdgeScrollOptions = {}) {
    let targets: ScrollTarget[] = [];
    let point = { x: 0, y: 0 };
    let frame: number | undefined;
    let previous = 0;

    const step = (now: number) => {
        const elapsed = Math.min(now - previous, 50);
        previous = now;
        let moved = false;

        const within = reachable(reach?.());

        for (const { element, axis } of targets) {
            // The page's own scroller is the window: its element's box is the whole document,
            // which starts above the screen as soon as anything has been scrolled.
            const box = element === document.scrollingElement
                ? within
                : intersect(element.getBoundingClientRect(), within);
            const pull = axis === "x"
                ? edgePull(box.left, box.right, point.x, margin)
                : edgePull(box.top, box.bottom, point.y, margin);

            if (!pull || !canScroll(element, axis, pull)) continue;

            walk(element, axis, pull * speed * elapsed / 1000);
            moved = true;
        }

        if (moved) {
            onScroll?.();
        }

        frame = targets.length ? requestAnimationFrame(step) : undefined;
    };

    return {
        /** Points it at the containers to walk along, and at where the pointer stands. */
        update(next: ScrollTarget[], clientX: number, clientY: number) {
            targets = next;
            point = { x: clientX, y: clientY };

            if (targets.length && frame === undefined) {
                previous = performance.now();
                frame = requestAnimationFrame(step);
            }
        },

        stop() {
            targets = [];
            if (frame !== undefined) {
                cancelAnimationFrame(frame);
                frame = undefined;
            }
        }
    };
}
