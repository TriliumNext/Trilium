import "./SlidePages.css";

import clsx from "clsx";
import { ComponentChildren } from "preact";
import { useRef, useState } from "preact/hooks";

interface SlidePagesProps<T extends string> {
    /** The page to show. Changing it slides the one before it out and this one in. */
    current: T;
    /** Every page in the order they are visited: further along means the slide goes forwards. */
    order: readonly T[];
    /**
     * Whether the pages keep their place in the flow.
     *
     * Off by default, which fills the container and suits pages that are each the size of the
     * screen. On, only the page leaving is taken out of the flow, so the container follows the
     * height of whatever is arriving — for steps within a screen, which are rarely the same size.
     */
    inFlow?: boolean;
    className?: string;
    /** Renders a page. Called for the one leaving as well, for as long as it is still on screen. */
    children: (page: T) => ComponentChildren;
}

/**
 * Slides from one page to the next, forwards or backwards depending on which way through `order` the
 * change went.
 *
 * The direction is worked out rather than asked for, so a caller only ever says which page it is on
 * and going back looks like going back without anything having to remember that it did.
 */
export default function SlidePages<T extends string>({ current, order, inFlow, className, children }: SlidePagesProps<T>) {
    const shown = useRef(current);
    const leavingRef = useRef<{ page: T; direction: Direction } | null>(null);
    const [ , redraw ] = useState(0);

    // Worked out while rendering the page being arrived at rather than in an effect afterwards: a
    // pass that drew the new page before the slide had started would put it in its final place and
    // then jump it back to slide in from there.
    if (shown.current !== current) {
        leavingRef.current = { page: shown.current, direction: directionBetween(order, shown.current, current) };
        shown.current = current;
    }

    const leaving = leavingRef.current;

    return (
        <div className={clsx("slide-pages", className, { "slide-pages-in-flow": inFlow })}>
            {leaving && (
                <div
                    class={`slide-page slide-out-${leaving.direction}`}
                    onAnimationEnd={(e) => {
                        // Animation events bubble, so anything inside the page that animates would
                        // otherwise end the slide early: the page leaving is dropped and the one
                        // arriving loses its class mid-flight, snapping into place.
                        if (e.target !== e.currentTarget) {
                            return;
                        }

                        leavingRef.current = null;
                        redraw((pass) => pass + 1);
                    }}
                >
                    {children(leaving.page)}
                </div>
            )}

            {/* Keyed, so arriving at a page mounts it rather than reusing what was there before it. */}
            <div class={`slide-page ${leaving ? `slide-in-${leaving.direction}` : "slide-current"}`} key={current}>
                {children(current)}
            </div>
        </div>
    );
}

type Direction = "forward" | "backward";

/** Which way through `order` the move went. A page that is not in the order counts as forwards. */
function directionBetween<T extends string>(order: readonly T[], from: T, to: T): Direction {
    return order.indexOf(to) > order.indexOf(from) ? "forward" : "backward";
}
