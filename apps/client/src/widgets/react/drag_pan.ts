import { RefObject } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import { isMobile } from "../../services/utils";
import { useTrackedElement } from "./hooks";

/** How much of the speed survives each frame once the pointer is up. */
const FRICTION = 0.94;

/** Below this speed, in pixels per millisecond, the glide has nothing left to show. */
const MIN_VELOCITY = 0.02;

/** How far back the speed is measured, so a pause before releasing ends the gesture still. */
const VELOCITY_WINDOW_MS = 100;

export interface DragPanOptions {
    /**
     * Whether a press here starts a pan. Defaults to the container's own background, which is
     * whatever its children leave uncovered.
     */
    canStart?: (target: HTMLElement, container: HTMLElement) => boolean;
    /** Whether to offer panning at all. */
    disabled?: boolean;
}

export interface DragPanState {
    /** Whether the content is wider than the container, and so has anywhere to be panned. */
    isPannable: boolean;
    /** Whether a pan is under way. */
    isPanning: boolean;
}

/**
 * Pans a horizontally scrolling container by dragging its background, with a glide after the
 * pointer is up.
 *
 * Touch devices scroll it by dragging already, so this is left to pointers that cannot.
 *
 * @param ref the scrolling container.
 * @param options which presses start a pan, and whether to offer it at all.
 */
export function useDragPan(ref: RefObject<HTMLElement>, options: DragPanOptions = {}): DragPanState {
    const { canStart, disabled } = options;
    const [ isPannable, setPannable ] = useState(false);
    const [ isPanning, setPanning ] = useState(false);
    const glideRef = useRef<number>();

    // A ref holds no render of its own, so an effect keyed on one never hears the element arrive.
    // Containers drawn only once their content has loaded are the ordinary case, so the element is
    // tracked in state instead. Set only when it actually changes, so this settles in one pass.
    const element = useTrackedElement(ref);

    const stopGlide = useCallback(() => {
        if (glideRef.current !== undefined) {
            cancelAnimationFrame(glideRef.current);
            glideRef.current = undefined;
        }
    }, []);

    useEffect(() => {
        const container = element;
        if (!container || disabled || isMobile()) return;

        const measure = () => setPannable(container.scrollWidth > container.clientWidth);
        measure();

        // Enough to keep the cursor honest: the width is read again when the pan is asked for, so a
        // measurement this misses cannot let a pan start where there is nowhere to go.
        const observer = new ResizeObserver(measure);
        observer.observe(container);

        let pointerId: number | undefined;
        let lastX = 0;
        let lastAt = 0;
        let velocity = 0;

        const onPointerDown = (event: PointerEvent) => {
            const target = event.target as HTMLElement | null;
            if (event.button !== 0 || !target) return;

            const starts = canStart ? canStart(target, container) : target === container;
            if (!starts || container.scrollWidth <= container.clientWidth) return;

            stopGlide();
            pointerId = event.pointerId;
            lastX = event.clientX;
            lastAt = event.timeStamp;
            velocity = 0;
            setPanning(true);
            container.setPointerCapture?.(event.pointerId);
            // The press would otherwise start a selection, which the drag then extends.
            event.preventDefault();
        };

        const onPointerMove = (event: PointerEvent) => {
            if (event.pointerId !== pointerId) return;

            const dx = event.clientX - lastX;
            const elapsed = event.timeStamp - lastAt;
            container.scrollLeft -= dx;

            // Measured over the last stretch only, so a drag that stops before the release glides
            // no further than it was going.
            if (elapsed > 0) {
                velocity = elapsed > VELOCITY_WINDOW_MS ? 0 : dx / elapsed;
                lastAt = event.timeStamp;
            }
            lastX = event.clientX;
        };

        const glide = () => {
            let previous = performance.now();

            const step = (now: number) => {
                const elapsed = now - previous;
                previous = now;

                const before = container.scrollLeft;
                container.scrollLeft -= velocity * elapsed;
                velocity *= FRICTION ** (elapsed / 16);

                // An end of the board is as far as the glide goes: the scroller clamps what it is
                // given, so nothing moves however much speed is left.
                const moved = container.scrollLeft !== before;
                glideRef.current = moved && Math.abs(velocity) > MIN_VELOCITY
                    ? requestAnimationFrame(step)
                    : undefined;
            };

            glideRef.current = requestAnimationFrame(step);
        };

        const onPointerUp = (event: PointerEvent) => {
            if (event.pointerId !== pointerId) return;

            pointerId = undefined;
            setPanning(false);
            container.releasePointerCapture?.(event.pointerId);

            // A cancelled gesture is not a release: the pointer was taken away rather than let go,
            // so the board stops where it stands instead of carrying the movement on.
            const cancelled = event.type === "pointercancel";
            if (!cancelled && Math.abs(velocity) > MIN_VELOCITY) {
                glide();
            }
        };

        container.addEventListener("pointerdown", onPointerDown);
        container.addEventListener("pointermove", onPointerMove);
        container.addEventListener("pointerup", onPointerUp);
        container.addEventListener("pointercancel", onPointerUp);

        return () => {
            observer.disconnect();
            stopGlide();
            container.removeEventListener("pointerdown", onPointerDown);
            container.removeEventListener("pointermove", onPointerMove);
            container.removeEventListener("pointerup", onPointerUp);
            container.removeEventListener("pointercancel", onPointerUp);
        };
    }, [ element, canStart, disabled, stopGlide ]);

    return { isPannable, isPanning };
}
