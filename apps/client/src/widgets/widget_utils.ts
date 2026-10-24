import utils from "../services/utils.js";

/**
 * Enables scrolling of a container horizontally using the mouse wheel, instead of having to use the scrollbar or keep Shift pressed.
 *
 * @param $container the jQuery-wrapped container element to enable horizontal scrolling for.
 */
export function setupHorizontalScrollViaWheel($container: JQuery<HTMLElement>) {
    $container.on("wheel", (event) => {
        onWheelHorizontalScroll(event.originalEvent as WheelEvent);
    });
}

export function onWheelHorizontalScroll(event: WheelEvent) {
    if (!event.currentTarget || utils.isCtrlKey(event) || event.altKey || event.shiftKey) {
        return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    (event.currentTarget as HTMLElement).scrollLeft += event.deltaY + event.deltaX;
}

/** The listeners returned by {@link createHoldContextMenu}. */
export interface HoldContextMenu {
    onContextMenu(e: MouseEvent): void;
    onPointerDown(e: PointerEvent): void;
    /** Cancels a pending hold. Listens to `pointerup`, `pointerleave` and `pointercancel`. */
    cancel(): void;
    /** Listens to `click` in the capture phase. */
    onClickCapture(e: MouseEvent): void;
    /** Cancels a pending hold and removes the listener a hold adds to `window`. */
    dispose(): void;
}

/**
 * Returns listeners that call `handler` on a right-click, and when a press of the primary button
 * or a finger stays on the element for `holdMs`. After a hold, the click that ends the press and
 * the `contextmenu` event Android raises for the same press do nothing.
 */
export function createHoldContextMenu(
    handler: (e: MouseEvent) => void,
    holdMs = 500
): HoldContextMenu {
    let timer: number | null = null;
    let isHeld = false;

    function cancel() {
        if (timer !== null) {
            window.clearTimeout(timer);
            timer = null;
        }
    }

    // The click of the press is dispatched in the same task as its `pointerup`, before the timeout.
    function endHold() {
        window.setTimeout(() => isHeld = false);
    }

    return {
        onContextMenu(e) {
            cancel();
            if (isHeld) {
                e.preventDefault();
                return;
            }
            handler(e);
        },
        onPointerDown(e) {
            isHeld = false;
            cancel();
            if (e.button !== 0) return;
            timer = window.setTimeout(() => {
                timer = null;
                isHeld = true;
                // The press can end off the element, which then receives no `pointerup`.
                window.addEventListener("pointerup", endHold, { capture: true, once: true });
                handler(e);
            }, holdMs);
        },
        cancel,
        onClickCapture(e) {
            if (!isHeld) return;
            e.preventDefault();
            e.stopImmediatePropagation();
        },
        dispose() {
            cancel();
            window.removeEventListener("pointerup", endHold, true);
        }
    };
}

/** Adds the listeners of {@link createHoldContextMenu} to `element`. */
export function setupHoldContextMenu(
    element: HTMLElement,
    handler: (e: MouseEvent) => void,
    holdMs = 500
) {
    const hold = createHoldContextMenu(handler, holdMs);
    element.addEventListener("contextmenu", hold.onContextMenu);
    element.addEventListener("pointerdown", hold.onPointerDown);
    element.addEventListener("pointerup", hold.cancel);
    element.addEventListener("pointerleave", hold.cancel);
    element.addEventListener("pointercancel", hold.cancel);
    element.addEventListener("click", hold.onClickCapture, { capture: true });
}

export function getClosestNtxId(element: HTMLElement) {
    const closestNtxEl = element.closest<HTMLElement>("[data-ntx-id]");
    if (!closestNtxEl) return null;
    return closestNtxEl.dataset.ntxId ?? null;
}
