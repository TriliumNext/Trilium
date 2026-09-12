import "./ScrollableLabel.css";

import clsx from "clsx";
import type { ComponentChildren } from "preact";
import { useCallback, useEffect, useRef } from "preact/hooks";

import { useScrollFade } from "./scroll_fade";

/** How fast a label reads itself out, in pixels a second: walking pace for the eye, not a marquee. */
const AUTO_SCROLL_SPEED = 30;

interface ScrollableLabelProps {
    children?: ComponentChildren;
    className?: string;
    /**
     * Walk the line to its end on its own, so what is cut off is read without being asked for. It
     * stops at the end rather than looping or coming back, and the first sign of the reader taking
     * over hands it to them for good: what they were reading must not slide out from under them.
     *
     * For a line that is shown rather than reached for, and where nothing is lost by it moving. Not
     * for one the reader is picking a part out of.
     */
    autoScroll?: boolean;
}

/**
 * A single line of text too long for its box, which the reader swipes along rather than losing the end
 * of. What is cut off fades out at whichever edge it continues past, so the line says that it goes on
 * — the ellipsis of a label that can actually be read to the end.
 *
 * For where a name has to be given in full and there is no width to give it in: a phone, a narrow
 * pane, a strip along the foot of a chart. A label that fits behaves as any other, showing no fade
 * and taking no swipe.
 */
export default function ScrollableLabel({ children, className, autoScroll }: ScrollableLabelProps) {
    const ref = useRef<HTMLDivElement>(null);
    // The walk below starts over whenever the overflow changes, which is what walks a label whose
    // words arrived after it did, a path waiting on its titles, without asking the caller to say so
    // and without restarting on a render that changed nothing.
    const { className: fadeClass, overflow } = useScrollFade(ref, { direction: "horizontal" });
    // Set by the reader's own first scroll, and cleared only by a remount, which is what a new label
    // is: a walk they interrupted must not start again while the same line is still on screen. A
    // consumer whose label changes what it names keys it, so the new one arrives with a fresh walk.
    const handedOver = useRef(false);
    const handOver = useCallback(() => {
        handedOver.current = true;
    }, []);

    useEffect(() => {
        const element = ref.current;

        // Handed over stays handed over: this effect runs again whenever the line's length changes,
        // and a box resized under the reader — a rotation, a keyboard opening, a pane dragged — must
        // not take the line back off them, which restarting from the beginning would.
        if (!autoScroll || !element || handedOver.current || prefersReducedMotion()) {
            return;
        }

        element.scrollLeft = 0;

        // Read once rather than per frame: a right-to-left line travels towards negative offsets, so
        // the same distance is applied with the sign its direction gives it.
        const sign = getComputedStyle(element).direction === "rtl" ? -1 : 1;
        let travelled = 0;
        let previous: number | undefined;
        let frame = 0;

        // Advanced by elapsed time rather than by a step per frame, so the line reads at one pace
        // whatever the display refreshes at, and a frame the browser skipped is made up for. Written
        // out before it is asked for, so that the element read above stays narrowed inside it.
        const step = (now: number) => {
            // Tested here rather than only before asking for the next frame: the frame already in
            // hand when the reader took over would otherwise move the line one last time, under them.
            if (handedOver.current) {
                return;
            }

            const total = element.scrollWidth - element.clientWidth;

            if (previous !== undefined) {
                travelled = Math.min(travelled + (now - previous) * AUTO_SCROLL_SPEED / 1000, total);
                element.scrollLeft = sign * travelled;
            }

            previous = now;

            // The end is where it stops: there is nothing further to read, and a line that came back
            // to its start would be read as a new one arriving.
            if (travelled < total) {
                frame = requestAnimationFrame(step);
            }
        };

        frame = requestAnimationFrame(step);

        return () => cancelAnimationFrame(frame);
        // Restarted when the line's length changes rather than when its markup does, so a label
        // rendered again with the same words is left walking where it was.
    }, [ autoScroll, overflow ]);

    return (
        <div
            ref={ref}
            className={clsx("scrollable-label", fadeClass, className)}
            // The gesture rather than the scrolling it causes: a pointer going down on the label, or a
            // wheel over it, says the reader has taken over before the line has moved an inch. Which
            // is also why this is not read off the scroll events, where the walk's own scrolling and
            // the reader's would have to be told apart by their arithmetic.
            onPointerDown={autoScroll ? handOver : undefined}
            onWheel={autoScroll ? handOver : undefined}
        >{children}</div>
    );
}

/** A line that moves on its own is the thing this setting is there to ask for less of. */
function prefersReducedMotion() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
