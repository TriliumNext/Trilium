import "@triliumnext/commons/src/lib/scroll_fade.css";

import {
    getScrollFadeClasses, NO_SCROLL_FADE, type ScrollFadeWatch, type ScrollFadeWatchOptions,
    watchScrollFade
} from "@triliumnext/commons";
import { CSSProperties, RefObject } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import { useTrackedElement } from "./hooks";

export interface ScrollFadeOptions extends ScrollFadeWatchOptions {
    /** How long a fade takes to arrive and to leave, in milliseconds. */
    duration?: number;
}

export interface ScrollFade {
    /** The classes of the scroll container. */
    className: string;
    /** The size and duration of the fade, as CSS custom properties. */
    style: CSSProperties;
    /** How much of the content lies outside the box, along the scrolling axis. */
    overflow: number;
    /** Measures again, for content that changes without a resize or a DOM mutation. */
    measure: () => void;
}

/**
 * Fades the edges a scroll container continues past, so the reader can tell there is more without
 * reading the scrollbar.
 *
 * @param ref the scroll container.
 * @param options which way it scrolls, how far each fade reaches and how long it takes.
 */
export function useScrollFade(ref: RefObject<HTMLElement | null>, options: ScrollFadeOptions = {}): ScrollFade {
    const { direction = "vertical", size, duration, minOverflow } = options;
    const [ state, setState ] = useState(NO_SCROLL_FADE);
    const watchRef = useRef<ScrollFadeWatch | null>(null);

    const element = useTrackedElement(ref);

    useEffect(() => {
        if (!element) return;

        const watch = watchScrollFade(element, setState, { direction, size, minOverflow });
        watchRef.current = watch;
        return () => {
            watch.disconnect();
            watchRef.current = null;
        };
    }, [ element, direction, size, minOverflow ]);

    const measure = useCallback(() => watchRef.current?.measure(), []);

    return {
        className: getScrollFadeClasses(direction, state).join(" "),
        style: {
            ...(size !== undefined && { "--scroll-fade-size": `${size}px` }),
            ...(duration !== undefined && { "--scroll-fade-duration": `${duration}ms` })
        } as CSSProperties,
        overflow: state.overflow,
        measure
    };
}
