import { useLayoutEffect, useRef } from "preact/hooks";

import type { MediaGallery } from "./gallery";
import type { MediaViewerApi } from "./MediaViewer";

export type MediaViewerControl =
    | "zoomIn" | "zoomOut" | "reset" | "fullscreen"
    | "panUp" | "panDown" | "panLeft" | "panRight";

/** Continuous keyboard zoom rate, as a per-second relative ratio fed to {@link MediaViewerApi.zoomBy}. */
const ZOOM_RATE = 2.5;
/** Continuous keyboard pan speed, in CSS pixels per second. */
const PAN_SPEED = 1200;
/** Pan speed multiplier while Shift is held. */
const PAN_FAST_FACTOR = 2.5;

/**
 * Maps a physical key (`KeyboardEvent.code`) to a viewer control, independent of modifiers — so the
 * zoom/reset keys work with or without Ctrl/Cmd. Using `code` keeps it keyboard-layout independent.
 */
export function codeToControl(code: string): MediaViewerControl | null {
    switch (code) {
        case "Equal": case "NumpadAdd": case "KeyE": return "zoomIn";
        case "Minus": case "NumpadSubtract": case "KeyQ": return "zoomOut";
        case "Slash": case "NumpadDivide": return "reset";
        case "KeyF": return "fullscreen";
        case "ArrowUp": case "KeyW": return "panUp";
        case "ArrowDown": case "KeyS": return "panDown";
        case "ArrowLeft": case "KeyA": return "panLeft";
        case "ArrowRight": case "KeyD": return "panRight";
        default: return null;
    }
}

/**
 * Pan delta (in image-translation pixels) for the held direction controls. An arrow/WASD key moves
 * the *view* that way (Right reveals the right side), so the image translates the opposite way.
 * Scaled by elapsed time, so the speed is frame-rate independent; Shift speeds it up.
 */
export function getPanDelta(controls: Iterable<MediaViewerControl>, shiftKey: boolean, dtSeconds: number): { dx: number; dy: number } {
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

/**
 * Wires keyboard zoom (`+`/`-`/`E`/`Q`, reset on `/`), pan (arrows / WASD, Shift to speed up) and the
 * fullscreen toggle (`F`) onto the focusable `elementRef`, driving a {@link MediaViewerApi}. While
 * keys are held it runs a requestAnimationFrame loop for smooth, frame-rate-independent motion. Only
 * active while the element holds focus — except `Escape`, which is claimed at the document capture
 * phase while fullscreen (so it exits the viewer before Bootstrap modals or the app can react), and
 * horizontal arrows, which become gallery navigation while fullscreen at the fitted zoom.
 */
export function useMediaViewerKeyboard(
    apiRef: { current: MediaViewerApi | null },
    elementRef: { current: HTMLElement | null },
    gallery: MediaGallery
) {
    // The gallery is a fresh object every render; going through a ref keeps the listeners (and the
    // held-key state) alive across re-renders — mid-hold re-binding would drop the pressed keys.
    const galleryRef = useRef(gallery);
    galleryRef.current = gallery;

    useLayoutEffect(() => {
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
            const controls: MediaViewerControl[] = [];
            for (const code of heldCodes) {
                const control = codeToControl(code);
                if (control && control !== "reset" && control !== "fullscreen") controls.push(control);
            }
            return controls;
        };

        const tick = (time: number) => {
            const dt = lastTime ? Math.min((time - lastTime) / 1000, 0.05) : 0;
            lastTime = time;

            const api = apiRef.current;
            const controls = activeControls();
            if (api && dt > 0 && controls.length) {
                if (controls.includes("zoomIn")) api.zoomBy(ZOOM_RATE * dt);
                if (controls.includes("zoomOut")) api.zoomBy(-ZOOM_RATE * dt);

                const { dx, dy } = getPanDelta(controls, shift, dt);
                if (dx || dy) api.moveBy(dx, dy);
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
            const api = apiRef.current;
            if (control === "reset") {
                api?.reset();
                return;
            }
            if (control === "fullscreen") {
                api?.toggleFullscreen();
                return;
            }
            // Fullscreen at the fitted zoom reads as a gallery, so ←/→ flip through it; once zoomed
            // in there is something to pan, and the arrows go back to panning (A/D always pan).
            const currentGallery = galleryRef.current;
            if ((control === "panLeft" || control === "panRight") && api?.isFullscreen() && api.isAtFit()
                && (e.code === "ArrowLeft" || e.code === "ArrowRight") && currentGallery.items.length > 1) {
                if (control === "panLeft") currentGallery.navigatePrevious();
                else currentGallery.navigateNext();
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

        // Focus on pointer release (capture phase). Viewer.js calls preventDefault on pointerdown
        // for dragging, which both stops propagation and reverts a focus set during the press — so
        // we focus on the capture-phase pointerup, once the press has been fully handled.
        const onPointerUp = () => element.focus();

        // Escape must work regardless of where focus is while fullscreen, and must win over
        // Bootstrap's modal-close handling (the popup editor can host the viewer) — hence document
        // capture phase. Outside fullscreen it is left completely untouched.
        const onDocumentKeyDown = (e: KeyboardEvent) => {
            if (e.code !== "Escape") return;
            const api = apiRef.current;
            if (!api?.isFullscreen()) return;
            e.preventDefault();
            e.stopPropagation();
            api.toggleFullscreen();
        };

        element.addEventListener("keydown", onKeyDown);
        element.addEventListener("keyup", onKeyUp);
        element.addEventListener("blur", onBlur);
        element.addEventListener("pointerup", onPointerUp, true);
        document.addEventListener("keydown", onDocumentKeyDown, true);

        return () => {
            element.removeEventListener("keydown", onKeyDown);
            element.removeEventListener("keyup", onKeyUp);
            element.removeEventListener("blur", onBlur);
            element.removeEventListener("pointerup", onPointerUp, true);
            document.removeEventListener("keydown", onDocumentKeyDown, true);
            stop();
        };
    }, [ apiRef, elementRef ]);
}
