import "./slide_animations.css";
import "./SlidePages.css";

import clsx from "clsx";
import { ComponentChildren } from "preact";
import { useCallback, useRef, useState } from "preact/hooks";

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
    const slide = useSlide(current);
    const leaving = slide.from !== undefined
        ? { page: slide.from, direction: directionBetween(order, slide.from, current) }
        : null;

    return (
        <div className={clsx("slide-pages", className, { "slide-pages-in-flow": inFlow })}>
            {leaving && (
                <div class={`slide-page slide-out-${leaving.direction}`} onAnimationEnd={slide.onAnimationEnd}>
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

/** The keyframes of slide_animations.css are named with this, which is how a slide's end is recognized. */
const SLIDE_ANIMATION_PREFIX = "tn-slide-";

export interface Slide<T> {
    /** What `current` replaced, while the slide from it runs, so both can be drawn; `undefined` at rest. */
    from: T | undefined;
    /**
     * Ends the slide at the end of one of slide_animations.css's animations. Other animations that
     * bubble up from inside the views, such as a spinner's, leave it running.
     */
    onAnimationEnd(e: AnimationEvent): void;
    /** Ends the slide at once, as for a view put back without the animation that would end it. */
    settle(): void;
}

/**
 * Keeps the value `current` replaced for as long as the slide between the two runs. A change while
 * `animated` is false, or with `motion-disabled`, where no animation runs to end it, switches at once.
 */
export function useSlide<T>(current: T, animated = true): Slide<T> {
    const shown = useRef(current);
    const from = useRef<T | undefined>(undefined);
    const [ , redraw ] = useState(0);

    // Worked out while rendering the view being arrived at rather than in an effect afterwards: a
    // pass that drew the new view before the slide had started would put it in its final place and
    // then jump it back to slide in from there.
    if (!Object.is(shown.current, current)) {
        const slides = animated && !document.body.classList.contains("motion-disabled");
        from.current = slides ? shown.current : undefined;
        shown.current = current;
    }

    const settle = useCallback(() => {
        if (from.current === undefined) return;
        from.current = undefined;
        redraw((pass) => pass + 1);
    }, []);

    const onAnimationEnd = useCallback((e: AnimationEvent) => {
        if (e.animationName?.startsWith(SLIDE_ANIMATION_PREFIX)) settle();
    }, [ settle ]);

    return { from: from.current, onAnimationEnd, settle };
}

type Direction = "forward" | "backward";

/** Which way through `order` the move went. A page that is not in the order counts as forwards. */
function directionBetween<T extends string>(order: readonly T[], from: T, to: T): Direction {
    return order.indexOf(to) > order.indexOf(from) ? "forward" : "backward";
}
