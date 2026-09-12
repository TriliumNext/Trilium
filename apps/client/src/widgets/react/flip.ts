import { RefObject } from "preact";
import { useCallback, useEffect, useLayoutEffect, useRef } from "preact/hooks";

/** How long a slide or a growth runs for. Matches the board's own CSS transitions. */
export const FLIP_DURATION_MS = 200;

/** How long until a slide or a growth has finished and the element it moved stands still. */
export const FLIP_SETTLE_MS = FLIP_DURATION_MS + 40;

/**
 * How far a child must move to count as having moved.
 *
 * `offsetTop` is a whole number, so sub-pixel layout above the list rounds some children one pixel
 * either way. Animating that draws a wave across the list for a change no one can see.
 */
const MIN_MOVE_PX = 4;

export interface FlipOptions {
    /** Which children to follow. */
    selector: string;
    /** The axis the children move along. Defaults to down the container. */
    axis?: "vertical" | "horizontal";
    /**
     * Whether a child that was not there before opens out from zero size instead of appearing at
     * full size. A predicate decides per child, for arrivals already shown some other way.
     */
    grow?: boolean | ((child: HTMLElement) => boolean);
    /**
     * Whether to leave the children where the browser puts them, stop measuring them, and forget
     * where they stood.
     *
     * For a container whose children are being rebuilt for reasons that are not moves: sliding
     * from a place recorded before such a rebuild animates it as a move.
     */
    disabled?: boolean;
    /**
     * Whether to stop measuring the children while keeping the places they were last measured at.
     *
     * For a container that is not taking part yet: its children still stand where they were
     * measured, so it slides them from there the moment it does take part. Where {@link disabled}
     * is set as well, the places are dropped: forgetting outranks remembering.
     */
    paused?: boolean;
}

/**
 * Slides a container's children from where they stood to where they now stand, and opens out the
 * ones that were not there before.
 *
 * The children are drawn in their new places, transformed back to the old ones for one frame and
 * released, which the CSS transition they already carry turns into a slide. A new child is
 * measured, collapsed to zero size and released the same way, so its neighbours are moved by the
 * growth rather than jumping.
 *
 * A position is read as `offsetTop`/`offsetLeft`, which neither scrolling nor a running slide's
 * transform changes, together with the `offsetParent` it was measured from: a different
 * `offsetParent` reports a different number for the same place.
 */
export function useFlip(
    ref: RefObject<HTMLElement>,
    { selector, axis = "vertical", grow, disabled, paused }: FlipOptions
) {
    // Written after every commit, so it holds where the children stood at the previous one.
    const seen = useRef(new Map<Element, Place>());
    /** Whether the container has been drawn once. Children of the first draw are not arrivals. */
    const drawn = useRef(false);
    /** Whether a growth is running, during which the children below it are already moving. */
    const settling = useRef(false);
    const settled = useRef<number>();

    const read = useCallback(() => {
        const places = new Map<Element, Place>();

        for (const child of ref.current?.querySelectorAll<HTMLElement>(selector) ?? []) {
            // A child out of the flow keeps an entry with `at: null` rather than none, so that
            // returning to the flow reads as a move and not as an arrival.
            const from = child.offsetParent;
            places.set(child, from
                ? { at: axis === "vertical" ? child.offsetTop : child.offsetLeft, from }
                : { at: null, from: null });
        }

        return places;
    }, [ ref, selector, axis ]);

    useLayoutEffect(() => {
        const container = ref.current;
        if (!container) {
            seen.current.clear();
            drawn.current = false;
            return;
        }

        // Measured only when a slide can come of it: reading one position forces a layout of the
        // whole document, which on a list of thousands is what this hook costs. A growth already
        // running is called off either way, since the frame it ends on reads the children again.
        if (paused || disabled) {
            window.clearTimeout(settled.current);
            settling.current = false;
            if (disabled) {
                seen.current.clear();
                drawn.current = false;
            }
            return;
        }

        const before = seen.current;
        const now = read();
        const moved: { child: HTMLElement, by: number }[] = [];
        const arrived: { child: HTMLElement, size: number }[] = [];

        // Read first and write after: a style written between two reads costs a fresh layout for
        // every child that follows it.
        for (const [ element, place ] of now) {
            const child = element as HTMLElement;
            const previous = before.get(child);

            if (place.at === null) {
                continue;
            }

            if (!previous) {
                const opens = typeof grow === "function" ? grow(child) : grow;
                if (opens && drawn.current) {
                    arrived.push({
                        child,
                        size: axis === "vertical" ? child.offsetHeight : child.offsetWidth
                    });
                }
            } else if (
                // Not while `settling` is set: a growth moves the children below it over the
                // frames that follow, so a commit in that window reads them part-way.
                !settling.current && previous.at !== null && previous.from === place.from
                    && Math.abs(previous.at - place.at) >= MIN_MOVE_PX
            ) {
                moved.push({ child, by: previous.at - place.at });
            }
        }

        // Stored as the places they settle at, so the next commit reads a running slide as its
        // destination rather than as a fresh move.
        seen.current = now;
        drawn.current = true;

        for (const { child, by } of moved) {
            slide(child, by, axis);
        }

        if (moved.length) {
            // Forces a layout so the browser applies the transforms just written, before the
            // frame that clears them. Without it both writes land in one style recalculation, the
            // transition has no starting point, and the move is drawn only at its destination.
            void container.offsetHeight;
        }

        if (!arrived.length) {
            return;
        }

        settling.current = true;
        for (const { child, size } of arrived) {
            open(child, size, axis);
        }

        void container.offsetHeight;

        // Re-read once the growth has finished, so the next commit measures against where the
        // children came to rest.
        window.clearTimeout(settled.current);
        settled.current = window.setTimeout(() => {
            settling.current = false;
            seen.current = read();
        }, FLIP_SETTLE_MS);
    });

    useEffect(() => () => window.clearTimeout(settled.current), []);
}

/** Where a child stood, `null` while out of the flow, and the `offsetParent` it was read from. */
interface Place {
    at: number | null;
    from: Element | null;
}

/** Transforms a child back to where it was, and releases it on the next frame. */
function slide(element: HTMLElement, offset: number, axis: Axis) {
    if (isStill()) {
        return;
    }

    element.style.transition = "none";
    element.style.transform = axis === "vertical"
        ? `translateY(${offset}px)`
        : `translateX(${offset}px)`;

    requestAnimationFrame(() => {
        if (element.isConnected) {
            element.style.transition = "";
            element.style.transform = "";
        }
    });
}

/**
 * Collapses a child to zero and releases it to the size it was measured at.
 *
 * The margins collapse with it: a child of no height still holds its margins open, which would
 * leave part of the jump the growth is there to remove.
 */
function open(element: HTMLElement, size: number, axis: Axis) {
    if (isStill()) {
        return;
    }

    const property = axis === "vertical" ? "height" : "width";
    const margin = axis === "vertical" ? "marginBlock" : "marginInline";

    element.style.transition = "none";
    element.style.overflow = "hidden";
    element.style[property] = "0px";
    element.style[margin] = "0px";

    requestAnimationFrame(() => {
        if (!element.isConnected) {
            return;
        }

        element.style.transition = `${property} ${FLIP_DURATION_MS}ms ease, `
            + `margin ${FLIP_DURATION_MS}ms ease`;
        element.style[property] = `${size}px`;
        // Cleared rather than set to a value: the stylesheet owns what the margins return to, and
        // the transition follows the computed value either way.
        element.style[margin] = "";

        window.setTimeout(() => {
            if (element.isConnected) {
                element.style.transition = "";
                element.style.overflow = "";
                element.style[property] = "";
            }
        }, FLIP_SETTLE_MS);
    });
}

type Axis = "vertical" | "horizontal";

function isStill() {
    return !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}
