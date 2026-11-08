/** The distance a pointer moves before a press becomes a drag, in pixels. */
const DRAG_THRESHOLD = 3;

export interface PointerTrackingOptions {
    /** Receives the client x of the pointer on each move, once it has moved past the threshold. */
    onMove: (clientX: number) => void;
    /** Ends the tracking when the pointer is released. */
    onEnd: (isMoved: boolean) => void;
    /** Ends the tracking on Escape, `pointercancel`, a lost capture or a press of another pointer. */
    onCancel: () => void;
}

/**
 * Follows the pointer pressed in `event` until it is released, with the pointer captured by
 * `element`. Returns a function that cancels the tracking.
 */
export function trackPointer(
    event: PointerEvent,
    element: Element,
    options: PointerTrackingOptions
) {
    const { pointerId, clientX: startX, clientY: startY } = event;
    let isMoved = false;
    let isActive = true;

    const onPointerMove = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) {
            return;
        }
        const distance = Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY);
        isMoved ||= distance >= DRAG_THRESHOLD;
        if (isMoved) {
            options.onMove(moveEvent.clientX);
        }
    };

    const onPointerUp = (upEvent: PointerEvent) => {
        if (upEvent.pointerId === pointerId) {
            stop();
            options.onEnd(isMoved);
        }
    };

    const onOtherPointerDown = (downEvent: PointerEvent) => {
        if (downEvent.pointerId !== pointerId) {
            cancel();
        }
    };

    const onPointerCancel = (cancelEvent: PointerEvent) => {
        if (cancelEvent.pointerId === pointerId) {
            cancel();
        }
    };

    const onKeyDown = (keyEvent: KeyboardEvent) => {
        if (keyEvent.key === "Escape") {
            keyEvent.preventDefault();
            keyEvent.stopPropagation();
            cancel();
        }
    };

    const stop = () => {
        isActive = false;
        window.removeEventListener("pointermove", onPointerMove, true);
        window.removeEventListener("pointerup", onPointerUp, true);
        window.removeEventListener("pointerdown", onOtherPointerDown, true);
        window.removeEventListener("pointercancel", onPointerCancel, true);
        window.removeEventListener("lostpointercapture", onPointerCancel, true);
        window.removeEventListener("keydown", onKeyDown, true);
    };

    const cancel = () => {
        if (isActive) {
            stop();
            options.onCancel();
        }
    };

    element.setPointerCapture(pointerId);
    window.addEventListener("pointermove", onPointerMove, true);
    window.addEventListener("pointerup", onPointerUp, true);
    window.addEventListener("pointerdown", onOtherPointerDown, true);
    window.addEventListener("pointercancel", onPointerCancel, true);
    window.addEventListener("lostpointercapture", onPointerCancel, true);
    window.addEventListener("keydown", onKeyDown, true);

    return cancel;
}
