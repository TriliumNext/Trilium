import type { Ref, RefObject } from "preact";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";

import SpacedUpdate, { type StateCallback } from "../../../services/spaced_update";
import { isTablet, onTabletChange } from "../../../services/utils";
import { createHoldContextMenu } from "../../hold_context_menu";

let uniqueNameCounter = 0;

/**
 * Generates a name that no other caller in the page gets, which stays the same across renders.
 *
 * <p>
 * Generally used to assign names to inputs that are unique, especially useful for widgets inside tabs.
 *
 * @param prefix a prefix to add to the unique name.
 * @returns a name with the given prefix and a number appended to it.
 */
export function useUniqueName(prefix?: string) {
    return useMemo(() => `${prefix ? `${prefix}-` : ""}unique-${++uniqueNameCounter}`, [ prefix ]);
}

/**
 * Attaches a {@link ResizeObserver} to the given ref and reads the bounding client rect whenever it changes.
 *
 * @param ref a ref to a {@link HTMLElement} to determine the size and observe the changes in size.
 * @returns the size of the element, reacting to changes.
 */
export function useElementSize(ref: RefObject<HTMLElement | null>) {
    const [ size, setSize ] = useState<DOMRect | undefined>(ref.current?.getBoundingClientRect());

    useEffect(() => {
        if (!ref.current) {
            return;
        }

        function onResize() {
            setSize(ref.current?.getBoundingClientRect());
        }

        const element = ref.current;
        const resizeObserver = new ResizeObserver(onResize);
        resizeObserver.observe(element);
        return () => {
            resizeObserver.unobserve(element);
            resizeObserver.disconnect();
        };
    }, [ ref ]);

    return size;
}

/**
 * Returns a function that runs a callback at once while the element of `ref` is shown, and
 * otherwise once it is shown again, for example when its tab is selected. While the element is
 * hidden, only the last callback runs, so a stale result must be dropped before it is passed.
 * Without an element, or with one that is not in the page yet, the callback runs at once.
 */
export function useWhenShown(ref: RefObject<Element | null> | undefined) {
    const waitingRef =
        useRef<{ callback: () => void; observer: ResizeObserver } | undefined>(undefined);
    useEffect(() => () => waitingRef.current?.observer.disconnect(), []);

    return useCallback((callback: () => void) => {
        const element = ref?.current;
        const waiting = waitingRef.current;
        if (!element || isShown(element)) {
            waiting?.observer.disconnect();
            waitingRef.current = undefined;
            callback();
        } else if (waiting) {
            waiting.callback = callback;
        } else {
            // A `ResizeObserver` first reports a hidden element once it is shown.
            const observer = new ResizeObserver(() => {
                const current = waitingRef.current;
                if (current && isShown(element)) {
                    observer.disconnect();
                    waitingRef.current = undefined;
                    current.callback();
                }
            });
            waitingRef.current = { callback, observer };
            observer.observe(element);
        }
    }, [ ref ]);
}

/**
 * The id of the heading of `headings`, in document order, that is being read: the last one whose
 * element starts above a line 100 px below the top of `scrollingContainer`.
 */
export function useActiveHeading<T extends { id: string }>({
    headings, scrollingContainer, getHeadingElement
}: {
    headings: T[];
    scrollingContainer: HTMLElement | null;
    getHeadingElement: (heading: T) => HTMLElement | null
}) {
    const headingsRef = useRef(headings);
    const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null);

    useEffect(() => {
        headingsRef.current = headings;
    }, [headings]);

    useEffect(() => {
        if (!scrollingContainer) {
            setActiveHeadingId(null);
            return;
        }

        const activeLineY = scrollingContainer.getBoundingClientRect().top + 100;
        let timeoutId: number | undefined;

        function updateActiveHeading() {
            let activeHeading: T | null = null;

            for (const heading of headingsRef.current) {
                const headingEl = getHeadingElement(heading);
                // A heading in a collapsed section has no place on the page.
                if (headingEl && !headingEl.checkVisibility({ visibilityProperty: true })) {
                    continue;
                }

                if (headingEl && headingEl.getBoundingClientRect().top <= activeLineY) {
                    activeHeading = heading;
                } else {
                    break;
                }
            }

            setActiveHeadingId(prev =>
                prev === activeHeading?.id ? prev : activeHeading?.id ?? null
            );
        }

        function handleScroll() {
            window.clearTimeout(timeoutId);
            timeoutId = window.setTimeout(updateActiveHeading, 100);
        }

        scrollingContainer.addEventListener("scroll", handleScroll);

        updateActiveHeading();

        return () => {
            window.clearTimeout(timeoutId);
            scrollingContainer.removeEventListener("scroll", handleScroll);
        };
        // getHeadingElement must re-subscribe the listener: when a rebuild replaces the editor,
        // .scrolling-container is an ancestor of the editor root and stays the same element, so
        // scrollingContainer alone would keep the listener mapping through the destroyed editor.
    }, [scrollingContainer, getHeadingElement]);

    return activeHeadingId;
}

/** Whether `element` is laid out, or not in the page yet. */
function isShown(element: Element) {
    return !element.isConnected || element.checkVisibility();
}

/**
 * Whether an element has the screen to itself, and the way to give it or take it back.
 *
 * The state follows the browser rather than the button, so a screen left by pressing Escape — which
 * nothing asks us for — is still noticed.
 *
 * @param element the element to put on a screen of its own, or `null` while there is none yet.
 * @param onChange called once the screen has changed, either way, and after the state has been
 *                 updated. Where something has to be measured across the change, take it in the
 *                 handler passed to `toggle` and spend it here.
 * @returns whether the element is currently fullscreen, and a toggle that resolves to whether the
 *          screen actually changed — a request the browser refuses (no user gesture behind it, a
 *          policy against it) leaves the view exactly as it was.
 */
/**
 * Whether any part of an element is on screen, for something that floats over the page on the
 * element's account and has no business there once the element is scrolled out of sight.
 *
 * Watched only while `enabled`, and true whenever it is not: an element that is not being watched
 * is taken as on screen, and watching starts from that until the observer says otherwise.
 */
export function useIsOnScreen(ref: RefObject<Element | null>, enabled: boolean) {
    const [ isOnScreen, setIsOnScreen ] = useState(true);

    useEffect(() => {
        const element = ref.current;
        if (!enabled || !element) {
            setIsOnScreen(true);
            return;
        }

        const observer = new IntersectionObserver(
            ([ entry ]) => setIsOnScreen(entry.isIntersecting));
        observer.observe(element);
        return () => observer.disconnect();
    }, [ ref, enabled ]);

    return isOnScreen;
}

/**
 * Puts `className` on the parent of the element in `ref` while `enabled` holds, for a parent laid
 * out by what the component renders, such as a legacy `ScrollingContainer`. The parent is read when
 * `enabled` turns true: a legacy container renders its Preact children into a fragment first.
 */
export function useParentClass(
    ref: RefObject<HTMLElement | null>, className: string, enabled: boolean
) {
    useLayoutEffect(() => {
        const parent = ref.current?.parentElement;
        if (!enabled || !parent) return;
        parent.classList.add(className);
        return () => parent.classList.remove(className);
    }, [ ref, className, enabled ]);
}

/**
 * Puts `className` on `body` while at least one mounted component enables it, for an element whose
 * style depends on a state it has no DOM relation to.
 */
export function useBodyClass(className: string, enabled: boolean) {
    useLayoutEffect(() => {
        if (!enabled) return;
        bodyClassCounts.set(className, (bodyClassCounts.get(className) ?? 0) + 1);
        document.body.classList.add(className);
        return () => {
            const remaining = (bodyClassCounts.get(className) ?? 1) - 1;
            if (remaining > 0) {
                bodyClassCounts.set(className, remaining);
                return;
            }
            bodyClassCounts.delete(className);
            document.body.classList.remove(className);
        };
    }, [ className, enabled ]);
}

/** How many mounted components enable each class of {@link useBodyClass}. */
const bodyClassCounts = new Map<string, number>();

/**
 * Whether an element holds the focus anywhere in the document and, given `selector`, sits in an
 * element that matches it. Unlike {@link useFocusWithin}, it needs no element of its own.
 */
export function useDocumentFocus(selector?: string) {
    const [ isFocused, setIsFocused ] = useState(() => isFocusIn(document.activeElement, selector));

    useEffect(() => {
        // During `focusout`, `relatedTarget` is the element that receives the focus, if any.
        const update = (e: FocusEvent) => {
            setIsFocused(isFocusIn(e.type === "focusin" ? e.target : e.relatedTarget, selector));
        };
        document.addEventListener("focusin", update);
        document.addEventListener("focusout", update);
        return () => {
            document.removeEventListener("focusin", update);
            document.removeEventListener("focusout", update);
        };
    }, [ selector ]);

    return isFocused;
}

function isFocusIn(target: EventTarget | null, selector: string | undefined) {
    return target instanceof Element && target !== document.body
        && (!selector || !!target.closest(selector));
}

/**
 * Whether the focus is in the element, including in an `<iframe>` or a `<webview>` inside it,
 * which the document reports as its `activeElement`. Switching to another window keeps the value.
 */
export function useFocusWithin(ref: RefObject<HTMLElement | null>) {
    const [ isFocusWithin, setIsFocusWithin ] = useState(false);

    useEffect(() => {
        const element = ref.current;
        if (!element) return;

        let timer: number | undefined;
        const update = () => setIsFocusWithin(element.contains(document.activeElement));
        // Reads the focus once it has moved: during `focusout`, the active element is the body.
        const updateLater = () => {
            window.clearTimeout(timer);
            timer = window.setTimeout(update);
        };

        update();
        element.addEventListener("focusin", update);
        element.addEventListener("focusout", updateLater);
        // A frame taking or returning the focus fires no focus event inside the document. The
        // text editor dispatches `focus` and `blur` at a frame in an embed that the focus moves to
        // or from, which only a capturing listener hears.
        element.addEventListener("focus", update, true);
        element.addEventListener("blur", updateLater, true);
        window.addEventListener("blur", updateLater);
        window.addEventListener("focus", updateLater);
        return () => {
            window.clearTimeout(timer);
            element.removeEventListener("focusin", update);
            element.removeEventListener("focusout", updateLater);
            element.removeEventListener("focus", update, true);
            element.removeEventListener("blur", updateLater, true);
            window.removeEventListener("blur", updateLater);
            window.removeEventListener("focus", updateLater);
        };
    }, [ ref ]);

    return isFocusWithin;
}

/**
 * `value`, held at true for `ms` after it turns false, for something that leaves the page with an
 * animation: what draws it keeps drawing it that long, and tells it that it is leaving.
 */
export function useLingeringTrue(value: boolean, ms: number) {
    const [ isLingering, setIsLingering ] = useState(value);

    useEffect(() => {
        if (value) {
            setIsLingering(true);
            return;
        }

        const timer = window.setTimeout(() => setIsLingering(false), ms);
        return () => window.clearTimeout(timer);
    }, [ value, ms ]);

    return value || isLingering;
}

export function useFullscreen(element: HTMLElement | null | undefined, onChange?: () => void): [ boolean, () => Promise<boolean> ] {
    const [ isFullscreen, setFullscreen ] = useState(() => !!element && document.fullscreenElement === element);
    // Read afresh on every change rather than closed over, so that a listener bound once follows a
    // handler the caller hands over anew on each render.
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;

    useEffect(() => {
        if (!element) return;

        const onFullscreenChange = () => {
            setFullscreen(document.fullscreenElement === element);
            onChangeRef.current?.();
        };

        document.addEventListener("fullscreenchange", onFullscreenChange);
        return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
    }, [ element ]);

    const toggle = useCallback(async () => {
        if (!element) return false;

        try {
            await (document.fullscreenElement ? document.exitFullscreen() : element.requestFullscreen());
            return true;
        } catch (e) {
            console.warn("Could not change the fullscreen state:", e);
            return false;
        }
    }, [ element ]);

    return [ isFullscreen, toggle ];
}

/**
 * Obtains the inner width and height of the window, as well as reacts to changes in size.
 *
 * @returns the width and height of the window.
 */
export function useWindowSize() {
    const [ size, setSize ] = useState<{ windowWidth: number, windowHeight: number }>({
        windowWidth: window.innerWidth,
        windowHeight: window.innerHeight
    });

    useEffect(() => {
        function onResize() {
            setSize({
                windowWidth: window.innerWidth,
                windowHeight: window.innerHeight
            });
        }

        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
    }, []);

    return size;
}

/** {@link isTablet}, following the viewport as a foldable folds or a window is resized. */
export function useIsTablet() {
    const [ tablet, setTablet ] = useState(isTablet);

    useEffect(() => {
        setTablet(isTablet());
        return onTabletChange(() => setTablet(isTablet()));
    }, []);

    return tablet;
}

/** Whether the CSS media `query` matches, following it as the window changes. */
export function useMediaQuery(query: string) {
    const [ matches, setMatches ] = useState(() => window.matchMedia(query).matches);

    useEffect(() => {
        const mediaQuery = window.matchMedia(query);
        const update = () => setMatches(mediaQuery.matches);
        update();
        mediaQuery.addEventListener("change", update);
        return () => mediaQuery.removeEventListener("change", update);
    }, [ query ]);

    return matches;
}

/**
 * The element a ref points at, as state, so an effect keyed on it runs once the element is there.
 *
 * Filling a ref triggers no render, so an effect that reads `ref.current` in its dependencies never
 * hears the element arrive. Containers drawn only once their content has loaded are the ordinary
 * case for that.
 */
export function useTrackedElement<T extends HTMLElement>(ref: RefObject<T | null>): T | null {
    const [ element, setElement ] = useState<T | null>(null);

    // Every render, and set only where it changed, so this settles in one further pass.
    useLayoutEffect(() => {
        if (ref.current !== element) {
            setElement(ref.current);
        }
    });

    return element;
}

export function useSyncedRef<T>(
    externalRef?: Ref<T>,
    initialValue: T | null = null
): RefObject<T | null> {
    const ref = useRef<T>(initialValue);

    // A layout effect, so that the external ref holds the element before any parent's `useEffect`
    // reads it, as a ref passed straight to the element would.
    useLayoutEffect(() => {
        if (typeof externalRef === "function") {
            externalRef(ref.current);
        } else if (externalRef) {
            externalRef.current = ref.current;
        }
    }, [ ref, externalRef ]);

    return ref;
}

/**
 * Long-press + contextmenu handler bundle. `contextmenu` covers desktop right-click and
 * Android Chrome long-press; explicit touch handlers cover iOS/WKWebView where
 * `contextmenu` doesn't fire on long-press.
 *
 * Returns props to spread onto the target element: `onContextMenu`, `onTouchStart`,
 * `onTouchMove`, `onTouchEnd`, `onTouchCancel`. When a long-press fires, the
 * follow-up synthesized click is suppressed via `preventDefault` on `touchend`.
 */
export function useLongPressContextMenu(handler: (e: MouseEvent) => void, holdMs = 400) {
    const timerRef = useRef<number | null>(null);
    const firedRef = useRef(false);

    const clear = useCallback(() => {
        if (timerRef.current !== null) {
            window.clearTimeout(timerRef.current);
            timerRef.current = null;
        }
    }, []);

    useEffect(() => clear, [clear]);

    const onTouchStart = useCallback(
        (e: TouchEvent) => {
            firedRef.current = false;
            clear();
            const touch = e.touches[0];
            if (!touch) return;
            const pageX = touch.pageX;
            const pageY = touch.pageY;
            const target = e.target;
            timerRef.current = window.setTimeout(() => {
                firedRef.current = true;
                handler({
                    pageX,
                    pageY,
                    target,
                    preventDefault: () => {},
                    stopPropagation: () => {}
                } as unknown as MouseEvent);
            }, holdMs);
        },
        [handler, holdMs, clear]
    );

    const onTouchMove = useCallback(() => clear(), [clear]);

    const onTouchEnd = useCallback(
        (e: TouchEvent) => {
            clear();
            if (firedRef.current) {
                // Suppress the synthesized click that would otherwise follow touchend.
                e.preventDefault();
                firedRef.current = false;
            }
        },
        [clear]
    );

    return {
        onContextMenu: handler,
        onTouchStart,
        onTouchMove,
        onTouchEnd,
        onTouchCancel: clear
    };
}

/**
 * Calls `handler` on a right-click, and when a press stays on the element for `holdMs`; see
 * {@link createHoldContextMenu}.
 *
 * Returns props to spread onto the target element.
 */
export function useHoldContextMenu(handler: (e: MouseEvent) => void, holdMs = 500) {
    const handlerRef = useRef(handler);
    useEffect(() => {
        handlerRef.current = handler;
    }, [ handler ]);

    const hold = useMemo(
        () => createHoldContextMenu((e) => handlerRef.current(e), holdMs),
        [ holdMs ]
    );
    useEffect(() => () => hold.dispose(), [ hold ]);

    return {
        onContextMenu: hold.onContextMenu,
        onPointerDown: hold.onPointerDown,
        onPointerMove: hold.onPointerMove,
        onPointerUp: hold.cancel,
        onPointerLeave: hold.cancel,
        onPointerCancel: hold.cancel,
        onClickCapture: hold.onClickCapture
    };
}

export function useResizeObserver(ref: RefObject<HTMLElement | null>, callback: () => void) {
    const resizeObserver = useRef<ResizeObserver>(null);
    useEffect(() => {
        resizeObserver.current?.disconnect();
        const observer = new ResizeObserver(callback);
        resizeObserver.current = observer;

        if (ref.current) {
            observer.observe(ref.current);
        }

        return () => observer.disconnect();
    }, [ callback, ref ]);
}

export type DelayedVisibilityPhase = "hidden" | "visible" | "stalled";

export interface DelayedVisibilityOpts {
    /** The indicator is never shown if `active` clears within this window (fast loads never flash). */
    graceMs?: number;
    /** Once shown, the indicator stays at least this long, even if `active` clears sooner (no two-frame flicker). */
    minVisibleMs?: number;
    /** After this much continuous activity the phase escalates to "stalled" so the UI can offer a retry. */
    stalledMs?: number;
}

/**
 * Drives a flicker-free loading indicator from a boolean "is loading" signal:
 *
 * - **grace period**: nothing is shown if loading finishes within {@link DelayedVisibilityOpts.graceMs},
 *   so fast loads never flash a loading state;
 * - **minimum visibility**: once shown, the indicator stays for at least
 *   {@link DelayedVisibilityOpts.minVisibleMs}, preventing a skeleton that appears for two frames;
 * - **escalation**: after {@link DelayedVisibilityOpts.stalledMs} of continuous loading the phase
 *   becomes `"stalled"`, letting the UI switch to a "still loading / retry" presentation.
 */
export function useDelayedVisibility(active: boolean, { graceMs = 150, minVisibleMs = 280, stalledMs = 8000 }: DelayedVisibilityOpts = {}): DelayedVisibilityPhase {
    const [ phase, setPhase ] = useState<DelayedVisibilityPhase>("hidden");
    const shownAtRef = useRef(0);

    useEffect(() => {
        if (active) {
            if (phase === "hidden") {
                const graceTimer = setTimeout(() => {
                    shownAtRef.current = Date.now();
                    setPhase("visible");
                }, graceMs);
                return () => clearTimeout(graceTimer);
            }

            if (phase === "visible") {
                const stalledTimer = setTimeout(
                    () => setPhase("stalled"),
                    Math.max(0, shownAtRef.current + stalledMs - Date.now())
                );
                return () => clearTimeout(stalledTimer);
            }
        } else if (phase !== "hidden") {
            const hideTimer = setTimeout(
                () => setPhase("hidden"),
                Math.max(0, shownAtRef.current + minVisibleMs - Date.now())
            );
            return () => clearTimeout(hideTimer);
        }
    }, [ active, phase, graceMs, minVisibleMs, stalledMs ]);

    return phase;
}

/**
 * A `SpacedUpdate` that runs the latest `callback` at most once per `interval`, as a title or a
 * field saves while being typed in.
 */
export function useSpacedUpdate(callback: () => void | Promise<void>, interval = 1000, stateCallback?: StateCallback) {
    const callbackRef = useRef(callback);
    const stateCallbackRef = useRef(stateCallback);
    const spacedUpdateRef = useRef<SpacedUpdate>(new SpacedUpdate(
        () => callbackRef.current(),
        interval,
        (state) => stateCallbackRef.current?.(state)
    ));

    // Update callback ref when it changes
    useEffect(() => {
        callbackRef.current = callback;
    }, [ callback ]);

    // Update state callback when it changes.
    useEffect(() => {
        stateCallbackRef.current = stateCallback;
    }, [ stateCallback ]);

    // Update interval if it changes
    useEffect(() => {
        spacedUpdateRef.current?.setUpdateInterval(interval);
    }, [ interval ]);

    return spacedUpdateRef.current;
}

/**
 * Trails `value` by `delay`, so a field being typed in does not fire a request per keystroke.
 *
 * For a reading that costs the server real work and is only worth taking once the user has stopped
 * changing what it is a reading of.
 */
export function useDebouncedValue<T>(value: T, delay: number): T {
    const [ settled, setSettled ] = useState(value);

    useEffect(() => {
        const timer = setTimeout(() => setSettled(value), delay);
        return () => clearTimeout(timer);
    }, [ value, delay ]);

    return settled;
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
