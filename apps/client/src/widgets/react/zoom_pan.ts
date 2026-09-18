import type { RefObject } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { ReactZoomPanPinchRef } from "react-zoom-pan-pinch";

interface ZoomPanPinchOptions {
    /** Passed through to `TransformWrapper`, and used here for `canZoomIn`/`canZoomOut`. */
    minScale: number;
    maxScale: number;
    /** Resets `scale` to 1 when this value changes, for a wrapper the caller remounts. */
    resetOn?: unknown;
    /** Called with the new scale after every transform, for values the caller derives from it. */
    onScaleChange?: (scale: number) => void;
}

/**
 * Drives a react-zoom-pan-pinch instance. Returns the ref for `TransformWrapper`, the current
 * scale, whether each step has room left, and `zoomIn`/`zoomOut`/`reset`.
 *
 * Pass `onTransform` to the wrapper so `scale` tracks buttons, wheel, pinch and double click alike.
 * `wheel` disables the library's own wheel handler in favour of {@link useZoomPanWheel}.
 */
export function useZoomPanPinch({ minScale, maxScale, resetOn, onScaleChange }: ZoomPanPinchOptions) {
    const ref = useRef<ReactZoomPanPinchRef>(null);
    const [ scale, setScale ] = useState(1);

    // Read through a ref so a caller can pass a fresh closure without rewiring the wrapper.
    const onScaleChangeRef = useRef(onScaleChange);
    useEffect(() => { onScaleChangeRef.current = onScaleChange; });

    useEffect(() => { setScale(1); }, [ resetOn ]);

    const onTransform = useCallback((_ref: ReactZoomPanPinchRef, state: { scale: number }) => {
        setScale(state.scale);
        onScaleChangeRef.current?.(state.scale);
    }, []);

    return {
        ref,
        scale,
        onTransform,
        wheel: { disabled: true },
        canZoomIn: scale < maxScale * (1 - ZOOM_LIMIT_TOLERANCE),
        canZoomOut: scale > minScale * (1 + ZOOM_LIMIT_TOLERANCE),
        zoomIn: () => ref.current?.zoomIn(zoomStep(currentScale(ref), "in")),
        zoomOut: () => ref.current?.zoomOut(zoomStep(currentScale(ref), "out")),
        reset: () => ref.current?.resetTransform()
    };
}

/**
 * Zooms the content on a wheel notch, anchored on the pointer, in place of the library's own wheel
 * handler.
 *
 * That handler adds `step * |deltaY|` to the current scale (`handleWheelZoom`). One step cannot be
 * both the `scale * (k - 1)` a notch in needs and the `scale * (1 - 1 / k)` a notch back needs, so a
 * notch each way lands at `1 - k²` of the starting scale and scrubbing shrinks the view. The library
 * picks its step before it reads the event, so no value of `wheel.step` fixes that; this reads the
 * direction from `deltaY` and computes a target scale instead.
 *
 * `zoomIn`/`zoomOut` take the increment up to that target, so the library still clamps to
 * `minScale`/`maxScale` and recomputes its bounds. It zooms toward the middle of the view, so the
 * `setTransform` that follows re-anchors the content under the pointer.
 */
export function useZoomPanWheel(apiRef: RefObject<ReactZoomPanPinchRef>, element: HTMLElement | null) {
    useEffect(() => {
        if (!element) return;

        const onWheel = (event: WheelEvent) => {
            const api = apiRef.current;
            // A purely horizontal wheel means no zoom; leave the event for anything else to use.
            if (!api || event.deltaY === 0) return;
            event.preventDefault();

            const { scale, positionX, positionY } = api.instance.state;
            const target = wheelTargetScale(scale, event.deltaY, event.deltaMode);
            if (target > scale) api.zoomIn(target - scale, 0);
            else api.zoomOut(scale - target, 0);

            const rect = api.instance.wrapperComponent?.getBoundingClientRect();
            if (!rect) return;

            const zoomed = api.instance.state.scale;
            const anchored = zoomToPointPosition(
                scale, positionX, positionY, zoomed,
                event.clientX - rect.left, event.clientY - rect.top
            );
            const bounds = api.instance.bounds;
            const { x, y } = bounds ? clampPan(anchored.x, anchored.y, bounds) : anchored;
            api.setTransform(x, y, zoomed, 0);
        };

        element.addEventListener("wheel", onWheel, { passive: false });
        return () => element.removeEventListener("wheel", onWheel);
    }, [ apiRef, element ]);
}

/** What one press of a zoom step multiplies the scale by. */
const ZOOM_STEP = 1.2;
/** What one wheel notch multiplies the scale by. Below {@link ZOOM_STEP}: notches arrive in bursts. */
const WHEEL_STEP = 1.1;
/** The pixel `deltaY` of one mouse-wheel notch. A trackpad reports a fraction of this per event. */
const WHEEL_NOTCH_DELTA = 100;
/**
 * The pixels one unit of `deltaY` is worth, indexed by `WheelEvent.deltaMode`: pixels, lines, pages.
 *
 * Chromium reports pixels, but Firefox reports lines on Windows and Linux, three to a notch. Without
 * this a notch there moves the scale by a thirtieth of a notch's worth.
 */
const WHEEL_DELTA_MODE_PIXELS = [ 1, WHEEL_NOTCH_DELTA / 3, WHEEL_NOTCH_DELTA * 3 ];
/** The scale the content is fitted to its pane at, which the readout calls 100%. */
const FITTED_SCALE = 1;
/**
 * How near a bound counts as reaching it. `animate()` computes its last frame as `scale + diff * 1`,
 * which can land one float's width short of the bound.
 */
const ZOOM_LIMIT_TOLERANCE = 1e-6;

/**
 * The increment that takes `scale` one {@link ZOOM_STEP} in the given direction.
 *
 * react-zoom-pan-pinch adds the step to the current scale rather than multiplying by it (see
 * `handleCalculateButtonZoom`), so a fixed step changes the view far more at a small scale than at a
 * large one: from a fitted view, one press of a 0.5 step reaches a `minScale` of 0.5, and 98 more
 * are needed to reach a `maxScale` of 50. Scaling the step by the current scale keeps every press
 * the same proportion of the view.
 */
export function zoomStep(scale: number, direction: "in" | "out") {
    return direction === "in" ? scale * (ZOOM_STEP - 1) : scale * (1 - 1 / ZOOM_STEP);
}

/**
 * The scale one wheel notch takes `scale` to. Multiplies or divides by {@link WHEEL_STEP}, so a notch
 * each way returns to the starting scale. A fractional notch moves the scale by that fraction of the
 * step, which is how a trackpad reports.
 *
 * `deltaMode` is `WheelEvent.deltaMode`, which says what unit `deltaY` is in (see
 * {@link WHEEL_DELTA_MODE_PIXELS}).
 *
 * A notch that would step over {@link FITTED_SCALE} lands on it instead. Multiplying by a factor
 * only reverses exactly when the `deltaY` scrolled each way adds up the same, and it does not:
 * Firefox accelerates a fast wheel (`mousewheel.acceleration.*`) and a trackpad reports whatever the
 * finger did. Any mismatch leaves the ladder a percent or two off, and the factor then keeps it
 * there — 99% and 109% rather than 100% and 110% — so the fitted view needs a detent to stay
 * reachable. Scrolling away from it is untouched, so the detent never holds the content back.
 */
export function wheelTargetScale(scale: number, deltaY: number, deltaMode = 0) {
    const pixels = deltaY * (WHEEL_DELTA_MODE_PIXELS[deltaMode] ?? 1);
    const factor = WHEEL_STEP ** (Math.abs(pixels) / WHEEL_NOTCH_DELTA);
    const target = pixels < 0 ? scale * factor : scale / factor;

    const stepsOver = Math.sign(scale - FITTED_SCALE) * Math.sign(target - FITTED_SCALE) < 0;
    return stepsOver ? FITTED_SCALE : target;
}

interface PanBounds { minPositionX: number; maxPositionX: number; minPositionY: number; maxPositionY: number; }

/** Clamps a candidate content position to the library's computed pan bounds. */
export function clampPan(x: number, y: number, bounds: PanBounds): { x: number; y: number } {
    return {
        x: Math.min(Math.max(x, bounds.minPositionX), bounds.maxPositionX),
        y: Math.min(Math.max(y, bounds.minPositionY), bounds.maxPositionY)
    };
}

/**
 * The content translation that keeps a viewport point fixed across a scale change — i.e. a zoom
 * anchored on (`cursorX`, `cursorY`) (wrapper-local pixels) rather than the viewport centre.
 * `scale0`/`posX0`/`posY0` describe the transform before zooming to `scale1`.
 */
export function zoomToPointPosition(scale0: number, posX0: number, posY0: number, scale1: number, cursorX: number, cursorY: number): { x: number; y: number } {
    const contentX = (cursorX - posX0) / scale0;
    const contentY = (cursorY - posY0) / scale0;
    return { x: cursorX - contentX * scale1, y: cursorY - contentY * scale1 };
}

/** The instance's live scale. Read at click time rather than render time, so the step is current. */
function currentScale(ref: RefObject<ReactZoomPanPinchRef>) {
    return ref.current?.instance?.state?.scale ?? 1;
}
