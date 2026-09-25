import "./scroll_fade.css";

import clsx from "clsx";
import { RefObject } from "preact";
import { CSSProperties } from "preact/compat";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import { useTrackedElement } from "./hooks";

/** Fractional scroll offsets are reported at sub-pixel precision, so an edge is never tested exactly. */
const EDGE_EPSILON = 1;

/** How far a fade reaches from an edge when the caller names no size. Matches `scroll_fade.css`. */
const DEFAULT_FADE_SIZE = 20;

export interface ScrollFadeOptions {
    /** Which way the container scrolls. */
    direction?: "horizontal" | "vertical";
    /** How far the fade reaches from each edge, in pixels. */
    size?: number;
    /** How long a fade takes to arrive and to leave, in milliseconds. */
    duration?: number;
    /**
     * The least a container has to scroll for its edges to be faded at all, in pixels.
     *
     * Defaults to the fade's own size, a fade reaching further than the container can scroll
     * covering more than it hides. Lower it where a few hidden pixels still have to be reported,
     * such as a line of text cut off by a character.
     */
    minOverflow?: number;
}

export interface ScrollFade {
    /** Goes on the scroll container, alongside whatever else it wears. */
    className: string;
    /** Carries the size and duration, which CSS reads as lengths and times. */
    style: CSSProperties;
    /** How much of the content lies outside the box, along the scrolling axis. */
    overflow: number;
    /** Re-measures, for content that changes without the DOM or the box saying so. */
    measure: () => void;
}

/**
 * Fades the edges a scroll container continues past, so the reader can tell there is more without
 * reading the scrollbar.
 *
 * @param ref the scroll container.
 * @param options which way it scrolls, how far each fade reaches and how long it takes.
 */
export function useScrollFade(ref: RefObject<HTMLElement>, options: ScrollFadeOptions = {}): ScrollFade {
    const {
        direction = "vertical", size, duration, minOverflow = size ?? DEFAULT_FADE_SIZE
    } = options;
    const [ fades, setFades ] = useState({ start: false, end: false });
    const [ overflow, setOverflow ] = useState(0);
    const frameRef = useRef<number>();

    const element = useTrackedElement(ref);

    const measure = useCallback(() => {
        if (!element) return;

        const horizontal = direction === "horizontal";
        // Read as a distance travelled rather than as a coordinate: a right-to-left page scrolls the
        // same content towards negative offsets, and both ends ask the same question either way.
        const travelled = Math.abs(horizontal ? element.scrollLeft : element.scrollTop);
        const total = horizontal
            ? element.scrollWidth - element.clientWidth
            : element.scrollHeight - element.clientHeight;

        setOverflow(total);
        setFades((current) => {
            const isFaded = total > minOverflow;
            const next = {
                start: isFaded && travelled > EDGE_EPSILON,
                end: isFaded && travelled < total - EDGE_EPSILON
            };
            return current.start === next.start && current.end === next.end ? current : next;
        });
    }, [ element, direction, minOverflow ]);

    useEffect(() => {
        if (!element) return;

        // Coalesced, for the observers alone: a batch of cards arriving fires one per change, and
        // each measurement reads a layout the last one just invalidated. A scroll is measured as it
        // happens, so the fade keeps up with the finger rather than trailing it by a frame.
        const request = () => {
            if (frameRef.current === undefined) {
                frameRef.current = requestAnimationFrame(() => {
                    frameRef.current = undefined;
                    measure();
                });
            }
        };

        measure();

        // The box is resized by everything from a window to a pane being dragged; the content grows
        // and shrinks without either, which no resize reports.
        const resize = new ResizeObserver(request);
        resize.observe(element);

        // The children too: one of them growing changes how much there is to scroll while the box
        // it grows inside keeps its size, and an animated height is not a change to the page that
        // anything else here would hear about.
        const watchChildren = () => {
            for (const child of element.children) {
                resize.observe(child);
            }
        };
        watchChildren();

        const mutations = new MutationObserver(() => {
            watchChildren();
            request();
        });
        mutations.observe(element, { childList: true, subtree: true, characterData: true });
        element.addEventListener("scroll", measure, { passive: true });

        return () => {
            resize.disconnect();
            mutations.disconnect();
            element.removeEventListener("scroll", measure);
            if (frameRef.current !== undefined) {
                cancelAnimationFrame(frameRef.current);
                frameRef.current = undefined;
            }
        };
    }, [ element, measure ]);

    return {
        className: clsx("scroll-fade", `scroll-fade-${direction}`, {
            "scroll-fade-start": fades.start,
            "scroll-fade-end": fades.end
        }),
        style: {
            ...(size !== undefined && { "--scroll-fade-size": `${size}px` }),
            ...(duration !== undefined && { "--scroll-fade-duration": `${duration}ms` })
        } as CSSProperties,
        overflow,
        measure
    };
}
