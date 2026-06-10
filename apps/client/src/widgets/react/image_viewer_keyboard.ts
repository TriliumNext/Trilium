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
                if (controls.includes("zoomIn")) api.zoomIn(ZOOM_RATE * dt, 0);
                if (controls.includes("zoomOut")) api.zoomOut(ZOOM_RATE * dt, 0);

                const { dx, dy } = getPanDelta(controls, shift, dt);
                if (dx || dy) {
                    const { scale, positionX, positionY } = api.instance.state;
                    const bounds = api.instance.bounds;
                    if (bounds) {
                        const next = clampPan(positionX + dx, positionY + dy, bounds);
                        api.setTransform(next.x, next.y, scale, 0);
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
