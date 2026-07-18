import { useEffect } from "preact/hooks";
import type { ReactZoomPanPinchRef } from "react-zoom-pan-pinch";

export type ImageViewerControl =
    | "zoomIn" | "zoomOut" | "reset"
    | "panUp" | "panDown" | "panLeft" | "panRight";

/** Continuous keyboard zoom rate, as a per-second exponent fed to the library's zoomIn/zoomOut. */
const ZOOM_RATE = 2.5;
/** Continuous keyboard pan speed, in CSS pixels per second. */
const PAN_SPEED = 1200;
/** Pan speed multiplier while Shift is held. */
const PAN_FAST_FACTOR = 2.5;

/**
 * Maps a physical key (`KeyboardEvent.code`) to a viewer control, independent of modifiers — so the
 * zoom/reset keys work with or without Ctrl/Cmd. Using `code` keeps it keyboard-layout independent.
 */
export function codeToControl(code: string): ImageViewerControl | null {
    switch (code) {
        case "Equal": case "NumpadAdd": case "KeyE": return "zoomIn";
        case "Minus": case "NumpadSubtract": case "KeyQ": return "zoomOut";
        case "Slash": case "NumpadDivide": return "reset";
        case "ArrowUp": case "KeyW": return "panUp";
        case "ArrowDown": case "KeyS": return "panDown";
        case "ArrowLeft": case "KeyA": return "panLeft";
        case "ArrowRight": case "KeyD": return "panRight";
        default: return null;
    }
}

/**
 * Pan delta (in content-translation pixels) for the held direction controls. An arrow/WASD key
 * moves the *view* that way (Right reveals the right side), so the content translates the opposite
 * way. Scaled by elapsed time, so the speed is frame-rate independent; Shift speeds it up.
 */
export function getPanDelta(controls: Iterable<ImageViewerControl>, shiftKey: boolean, dtSeconds: number): { dx: number; dy: number } {
    const held = controls instanceof Set ? controls : new Set(controls);
    const speed = PAN_SPEED * (shiftKey ? PAN_FAST_FACTOR : 1) * dtSeconds;
    let dx = 0;
    let dy = 0;
    if (held.has("panLeft")) dx += speed;
    if (held.has("panRight")) dx -= speed;
    if (held.has("panUp")) dy += speed;
    if (held.has("panDown")) dy -= speed;
    return { dx, dy };
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

/**
 * Wires keyboard zoom (`+`/`-`/`/`, with or without Ctrl/Cmd) and pan (arrows / WASD, Shift to speed
 * up) onto the focusable `elementRef`, driving the react-zoom-pan-pinch instance in `apiRef`. While
 * keys are held it runs a requestAnimationFrame loop that reuses the library's own
 * `zoomIn`/`zoomOut`/`setTransform`, so the motion is smooth and stays within the library's bounds.
 * Only active while the element is focused.
 */
export function useImageViewerKeyboard(
    apiRef: { current: ReactZoomPanPinchRef | null },
    elementRef: { current: HTMLElement | null }
) {
    useEffect(() => {
        const element = elementRef.current;
        if (!element) return;

        const heldCodes = new Set<string>();
        let shift = false;
        let rafId = 0;
        let lastTime = 0;

        const stop = () => {
            if (rafId) cancelAnimationFrame(rafId);
            rafId = 0;
            lastTime = 0;
        };

        const activeControls = () => {
            const controls: ImageViewerControl[] = [];
            for (const code of heldCodes) {
                const control = codeToControl(code);
                if (control && control !== "reset") controls.push(control);
            }
            return controls;
        };

        const tick = (time: number) => {
            const dt = lastTime ? Math.min((time - lastTime) / 1000, 0.05) : 0;
            lastTime = time;

            const api = apiRef.current;
            const controls = activeControls();
            if (api && dt > 0 && controls.length) {
                if (controls.includes("zoomIn") || controls.includes("zoomOut")) {
                    const { scale, positionX, positionY } = api.instance.state;
                    if (controls.includes("zoomIn")) api.zoomIn(ZOOM_RATE * dt, 0);
                    if (controls.includes("zoomOut")) api.zoomOut(ZOOM_RATE * dt, 0);
                    anchorZoomToCursor(api, scale, positionX, positionY);
                }

                const { dx, dy } = getPanDelta(controls, shift, dt);
                if (dx || dy) {
                    const { scale, positionX, positionY } = api.instance.state;
                    const bounds = api.instance.bounds;
                    if (bounds) {
                        const next = clampPan(positionX + dx, positionY + dy, bounds);
                        api.setTransform(next.x, next.y, scale, 0);
                        // Keyboard panning shifts the image under a held mouse cursor; re-anchor the
                        // drag so the new point under the cursor becomes its grab point.
                        reanchorPan(api, positionX, positionY);
                    }
                }
            }

            if (controls.length) rafId = requestAnimationFrame(tick);
            else stop();
        };

        const start = () => {
            if (!rafId) rafId = requestAnimationFrame(tick);
        };

        const onKeyDown = (e: KeyboardEvent) => {
            shift = e.shiftKey;
            const control = codeToControl(e.code);
            if (!control) return;
            // Claim the key so the browser (Ctrl +/-) and Trilium's global shortcuts
            // (arrow tree navigation, app zoom, quick search) don't also act on it.
            e.preventDefault();
            e.stopPropagation();
            if (control === "reset") {
                apiRef.current?.resetTransform();
                return;
            }
            heldCodes.add(e.code);
            start();
        };

        const onKeyUp = (e: KeyboardEvent) => {
            shift = e.shiftKey;
            heldCodes.delete(e.code);
        };

        const onBlur = () => {
            heldCodes.clear();
            stop();
        };

        // Focus on pointer release (capture phase). The library calls preventDefault on mousedown
        // for panning, which both stops propagation and reverts a focus set during the press — so we
        // focus on the capture-phase pointerup, once the press has been fully handled.
        const onPointerUp = () => element.focus();

        element.addEventListener("keydown", onKeyDown);
        element.addEventListener("keyup", onKeyUp);
        element.addEventListener("blur", onBlur);
        element.addEventListener("pointerup", onPointerUp, true);

        return () => {
            element.removeEventListener("keydown", onKeyDown);
            element.removeEventListener("keyup", onKeyUp);
            element.removeEventListener("blur", onBlur);
            element.removeEventListener("pointerup", onPointerUp, true);
            stop();
        };
    }, [ apiRef, elementRef ]);
}

/**
 * After a programmatic (keyboard) zoom, keeps a simultaneous mouse drag smooth and anchored on the
 * cursor. Two things otherwise fight a drag+zoom: the library zooms toward the viewport centre, not
 * the grabbed point; and it recomputes the pan position each mousemove from startCoords captured at
 * press time, discarding the zoom's shift. So while panning we relocate the freshly-scaled view to
 * keep the cursor's content-point fixed, then offset startCoords by that move so the drag carries on
 * from there. The cursor is recovered from the pan's own invariant (clientX = positionX +
 * startCoords.x), so no pointer tracking is needed. `scale0`/`posX0`/`posY0` are the transform before
 * the zoom; the new scale is read live from the instance.
 */
function anchorZoomToCursor(api: ReactZoomPanPinchRef, scale0: number, posX0: number, posY0: number) {
    const { startCoords, isPanning, state, wrapperComponent } = api.instance;
    if (!isPanning || !startCoords) return;

    const rect = wrapperComponent?.getBoundingClientRect();
    if (rect) {
        const cursorX = posX0 + startCoords.x - rect.left;
        const cursorY = posY0 + startCoords.y - rect.top;
        const { x, y } = zoomToPointPosition(scale0, posX0, posY0, state.scale, cursorX, cursorY);
        api.setTransform(x, y, state.scale, 0);
    }
    reanchorPan(api, posX0, posY0);
}

/**
 * Keeps an in-progress mouse drag smooth after a programmatic transform. The library recomputes the
 * pan position each mousemove from startCoords captured at press time, so without this the next move
 * would discard the keyboard zoom/pan's shift (snapping back). Offsetting startCoords by the position
 * change — from (`beforeX`, `beforeY`) to the live position — makes the drag continue from there.
 */
function reanchorPan(api: ReactZoomPanPinchRef, beforeX: number, beforeY: number) {
    const { startCoords, isPanning, state } = api.instance;
    if (!isPanning || !startCoords) return;
    startCoords.x -= state.positionX - beforeX;
    startCoords.y -= state.positionY - beforeY;
}
