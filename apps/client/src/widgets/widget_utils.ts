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
