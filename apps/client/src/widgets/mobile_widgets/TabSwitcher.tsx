import "./TabSwitcher.css";

import { createPortal, type RefObject } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

import appContext from "../../components/app_context";
import { LaunchBarActionButton, LauncherNoteProps } from "../launch_bar/launch_bar_widgets";
import type NoteContext from "../../components/note_context";
import { useTriliumEvents } from "../react/hooks/events";
import { preloadLazyModule, useLazyModule } from "../react/LazyComponent";
import { isTabSwipeActive, type SwipeDirection, TabSwipe } from "./tab_swipe";

/** How far a finger travels sideways across the launch bar before it is taken for a swipe. */
const SWIPE_START = 10;
/** How long a finger can rest before release and still count as a flick. */
const FLICK_WINDOW = 100;
/** The least travel a whole slide takes, so a press by the edge does not throw the slide across. */
const MIN_ROOM = 48;

export default function TabSwitcher({ launcherNote }: LauncherNoteProps) {
    const [ shown, setShown ] = useState(false);
    // The grid stays mounted once opened, so it can animate closed.
    const [ opened, setOpened ] = useState(false);
    const mainNoteContexts = useMainNoteContexts();

    return (
        <>
            <LaunchBarActionButton
                launcherNote={launcherNote}
                className="mobile-tab-switcher"
                icon="bx bx-rectangle"
                text="Tabs"
                onClick={() => {
                    setOpened(true);
                    setShown(true);
                }}
                onPointerEnter={preloadTabBarModal}
                onFocus={preloadTabBarModal}
                data-tab-count={mainNoteContexts.length > 99 ? "∞" : mainNoteContexts.length}
            />
            {opened && createPortal(<LazyTabBarModal mainNoteContexts={mainNoteContexts} shown={shown} setShown={setShown} />, document.body)}
        </>
    );
}

// The grid of tabs, with the previews it renders, loads once the button is about to be tapped.
const loadTabBarModal = () => import("./TabBarModal");
const preloadTabBarModal = () => preloadLazyModule(loadTabBarModal);

function LazyTabBarModal(props: { mainNoteContexts: NoteContext[], shown: boolean, setShown: (shown: boolean) => void }) {
    const tabBarModal = useLazyModule(loadTabBarModal);
    return tabBarModal && <tabBarModal.default {...props} />;
}

interface SwipeGesture {
    pointerId: number;
    x: number;
    y: number;
    lastX: number;
    lastTime: number;
    /** How fast, in px/ms, the finger last moved toward the other tab. */
    velocity: number;
    swipe?: TabSwipe;
    /** How far the finger can travel toward the other tab before it reaches the edge of the screen. */
    room?: number;
}

/**
 * Slides to the next or the previous tab as a finger swipes sideways anywhere on the launch bar, while
 * the bar fits all its launchers: one that scrolls sideways keeps that drag for scrolling. The click
 * that ends a swipe reaches none of the bar's buttons. A swipe that starts on the bar follows the
 * pointer off it, since a mouse, unlike a finger, does not keep sending its events to the bar.
 */
/** Lets a finger swipe across the launch bar between tabs, for as long as it is mounted. */
export function LaunchBarTabSwipe({ containerRef }: { containerRef: RefObject<HTMLElement | null> }) {
    useLaunchBarTabSwipe(containerRef, true);
    return null;
}

export function useLaunchBarTabSwipe(containerRef: RefObject<HTMLElement | null>, enabled: boolean) {
    const swipe = useTabSwipe();
    const swipeRef = useRef(swipe);
    swipeRef.current = swipe;

    useEffect(() => {
        const container = containerRef.current;
        if (!enabled || !container) return;
        const bar = container.closest<HTMLElement>("#launcher-pane") ?? container;

        // The class also sets `touch-action`, which the browser reads before the press reaches us.
        const updateSwipeable = () => {
            const isSwipeable = container.scrollWidth <= container.clientWidth;
            bar.classList.toggle("tab-swipe", isSwipeable);
            return isSwipeable;
        };
        const onPointerDown = (e: PointerEvent) => {
            const hasOtherTabs = appContext.tabManager.getMainNoteContexts().length > 1;
            if (updateSwipeable() && hasOtherTabs) swipeRef.current.onPointerDown(e);
        };
        const onPointerMove = (e: PointerEvent) => swipeRef.current.onPointerMove(e);
        const onPointerEnd = (e: PointerEvent) => swipeRef.current.onPointerEnd(e);
        const onClickCapture = (e: MouseEvent) => {
            if (!swipeRef.current.takeSwipe()) return;
            e.preventDefault();
            e.stopPropagation();
        };

        const observer = new ResizeObserver(updateSwipeable);
        observer.observe(container);
        for (const launcher of container.children) {
            observer.observe(launcher);
        }
        updateSwipeable();
        bar.addEventListener("pointerdown", onPointerDown);
        window.addEventListener("pointermove", onPointerMove);
        window.addEventListener("pointerup", onPointerEnd);
        window.addEventListener("pointercancel", onPointerEnd);
        bar.addEventListener("click", onClickCapture, { capture: true });
        return () => {
            observer.disconnect();
            bar.classList.remove("tab-swipe");
            bar.removeEventListener("pointerdown", onPointerDown);
            window.removeEventListener("pointermove", onPointerMove);
            window.removeEventListener("pointerup", onPointerEnd);
            window.removeEventListener("pointercancel", onPointerEnd);
            bar.removeEventListener("click", onClickCapture, { capture: true });
            swipeRef.current.cancel();
        };
    }, [ containerRef, enabled ]);
}

/**
 * Slides to the next or the previous tab as a finger swipes sideways, following the finger until it
 * lifts. The click that ends a swipe is not a tap, so `takeSwipe()` tells the caller to drop it.
 */
function useTabSwipe() {
    const gestureRef = useRef<SwipeGesture | null>(null);
    const swipedRef = useRef(false);

    return {
        onPointerDown(e: PointerEvent) {
            swipedRef.current = false;
            const canSwipe = e.isPrimary && !isTabSwipeActive();
            gestureRef.current = canSwipe ? {
                pointerId: e.pointerId,
                x: e.clientX,
                y: e.clientY,
                lastX: e.clientX,
                lastTime: e.timeStamp,
                velocity: 0
            } : null;
        },
        onPointerMove(e: PointerEvent) {
            const gesture = gestureRef.current;
            if (!gesture || gesture.pointerId !== e.pointerId) return;

            const dx = e.clientX - gesture.x;
            if (!gesture.swipe) {
                const dy = e.clientY - gesture.y;
                const direction = getSwipeDirection(dx, dy, glob.isRtl);
                if (!direction) {
                    if (Math.abs(dy) > SWIPE_START) gestureRef.current = null;
                    return;
                }
                gesture.swipe = new TabSwipe(direction);
                gesture.room = getRoom(gesture.x, gesture.swipe.slide);
                swipedRef.current = true;
            }

            const toward = gesture.swipe.slide === "left" ? -1 : 1;
            const elapsed = e.timeStamp - gesture.lastTime;
            if (elapsed > 0) gesture.velocity = toward * (e.clientX - gesture.lastX) / elapsed;
            gesture.lastX = e.clientX;
            gesture.lastTime = e.timeStamp;
            gesture.swipe.move(toward * dx / (gesture.room ?? window.innerWidth));
        },
        onPointerEnd(e: PointerEvent) {
            const gesture = gestureRef.current;
            if (!gesture || gesture.pointerId !== e.pointerId) return;
            gestureRef.current = null;
            if (!gesture.swipe) return;

            const isFlick = e.type === "pointerup" && e.timeStamp - gesture.lastTime <= FLICK_WINDOW;
            gesture.swipe.release(isFlick ? gesture.velocity : 0, gesture.room);
        },
        /** Settles a running swipe where it stands, as when the pointer lifts slowly. */
        cancel() {
            const gesture = gestureRef.current;
            gestureRef.current = null;
            gesture?.swipe?.release(0, gesture.room);
        },
        takeSwipe() {
            const swiped = swipedRef.current;
            swipedRef.current = false;
            return swiped;
        }
    };
}

/** The tab a finger moving by `dx`, `dy` swipes toward, once it has moved far and level enough. */
export function getSwipeDirection(dx: number, dy: number, isRtl: boolean): SwipeDirection | undefined {
    if (Math.abs(dx) < SWIPE_START || Math.abs(dx) < 2 * Math.abs(dy)) return;
    // A swipe toward the start brings in the next tab from the end, as in Safari.
    return (dx < 0) !== isRtl ? "next" : "previous";
}

/**
 * How far a finger pressed at `x` travels for the slide to go all the way to the other tab: up to the
 * edge it heads for, which can be close by.
 */
function getRoom(x: number, slide: "left" | "right") {
    return Math.max(MIN_ROOM, slide === "left" ? x : window.innerWidth - x);
}


/**
 * The tabs, or none before the startup creates the tab manager, which can come after the launch bar
 * renders. The tabs it restores then arrive through `newNoteContextCreated`.
 */
function useMainNoteContexts() {
    const [ noteContexts, setNoteContexts ] = useState(getMainNoteContexts);

    useTriliumEvents([ "newNoteContextCreated", "noteContextRemoved" ] , () => {
        setNoteContexts(getMainNoteContexts());
    });

    return noteContexts;
}

function getMainNoteContexts() {
    return appContext.tabManager?.getMainNoteContexts() ?? [];
}
