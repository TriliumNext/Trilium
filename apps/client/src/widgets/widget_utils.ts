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

/**
 * The wheel's job over the tab row: while the row overflows, horizontal
 * scrolling keeps its established job; with nothing left to scroll, the wheel
 * switches to the adjacent tab instead (#11095, Firefox-style).
 *
 * Modifier keys stay with their owners (zoom, history, ...), and a wheel event
 * with no meaningful delta (a momentum tick) switches nothing.
 */
export function tabWheelAction(
    event: WheelEvent,
    container: HTMLElement
): "next" | "previous" | null {
    if (utils.isCtrlKey(event) || event.altKey || event.shiftKey) {
        return null;
    }
    if (container.scrollWidth <= container.clientWidth + 1) {
        const delta = event.deltaY + event.deltaX;
        if (Math.abs(delta) < 1) {
            return null;
        }
        return delta > 0 ? "next" : "previous";
    }
    return null;
}

export function onWheelHorizontalScroll(event: WheelEvent) {
    if (!event.currentTarget || utils.isCtrlKey(event) || event.altKey || event.shiftKey) {
        return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    (event.currentTarget as HTMLElement).scrollLeft += event.deltaY + event.deltaX;
}

export function getClosestNtxId(element: HTMLElement) {
    const closestNtxEl = element.closest<HTMLElement>("[data-ntx-id]");
    if (!closestNtxEl) return null;
    return closestNtxEl.dataset.ntxId ?? null;
}
