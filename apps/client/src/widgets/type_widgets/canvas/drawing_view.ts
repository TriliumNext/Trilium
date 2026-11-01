import { getCommonBounds } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, NormalizedZoomValue } from "@excalidraw/excalidraw/types";

/** Excalidraw's zoom limits, from its own zoom buttons. */
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 30;

export type DrawingView = Pick<AppState, "zoom" | "scrollX" | "scrollY">;

/**
 * The view of a drawing `width` by `height` that saved none, such as one converted from an image:
 * its content fit in the drawing and centered. `null` without content or a size.
 */
export function getFittedView(
    elements: readonly ExcalidrawElement[],
    width: number,
    height: number
): DrawingView | null {
    const shown = elements.filter((element) => !element.isDeleted);
    if (!shown.length || !width || !height) return null;

    return fitView(getCommonBounds(shown), width, height);
}

/**
 * `view` moved so that it centers the content of a drawing `width` by `height` at the same zoom, as
 * Excalidraw's `scrollToContent()` does. `null` without content.
 */
export function getCenteredView(
    elements: readonly ExcalidrawElement[],
    view: DrawingView,
    width: number,
    height: number
): DrawingView | null {
    const shown = elements.filter((element) => !element.isDeleted);
    if (!shown.length) return null;

    const [ minX, minY, maxX, maxY ] = getCommonBounds(shown);
    const zoom = view.zoom.value;
    return {
        zoom: view.zoom,
        scrollX: width / 2 / zoom - (minX + maxX) / 2,
        scrollY: height / 2 / zoom - (minY + maxY) / 2
    };
}

/**
 * The view of a drawing over a locked image, such as one converted from an image, kept inside the
 * image: zoomed out no further than the whole image and moved back within its edges. `null` when
 * the view is inside, or when the bottom shape of the drawing is not a locked image.
 */
export function getBoundedView(
    elements: readonly ExcalidrawElement[],
    appState: AppState
): DrawingView | null {
    const area = getBoundingImage(elements);
    const { width, height, zoom, scrollX, scrollY } = appState;
    if (!area || !width || !height) return null;

    const [ minX, minY, maxX, maxY ] = getCommonBounds([ area ]);
    const fitted = fitView([ minX, minY, maxX, maxY ], width, height);
    if (zoom.value < fitted.zoom.value) return fitted;

    const view = {
        zoom,
        scrollX: clampScroll(scrollX, minX, maxX, width / zoom.value),
        scrollY: clampScroll(scrollY, minY, maxY, height / zoom.value)
    };
    const isInside = Math.abs(view.scrollX - scrollX) < EPSILON
        && Math.abs(view.scrollY - scrollY) < EPSILON;
    return isInside ? null : view;
}

/** The locked image at the bottom of a drawing, which bounds its view, or `null`. */
function getBoundingImage(elements: readonly ExcalidrawElement[]) {
    const area = elements.find((element) => !element.isDeleted);
    return area?.type === "image" && area.locked ? area : null;
}

const EPSILON = 1e-6;

/** The view of a drawing `width` by `height` that shows the box from `minX` to `maxY` whole. */
function fitView(
    [ minX, minY, maxX, maxY ]: readonly [ number, number, number, number ],
    width: number,
    height: number
): DrawingView {
    const fit = Math.min(width / (maxX - minX), height / (maxY - minY));
    const zoom = Math.min(Math.max(fit, MIN_ZOOM), MAX_ZOOM);
    return {
        zoom: { value: zoom as NormalizedZoomValue },
        scrollX: width / 2 / zoom - (minX + maxX) / 2,
        scrollY: height / 2 / zoom - (minY + maxY) / 2
    };
}

/**
 * The scroll along one axis that keeps a view `size` long between `min` and `max`, centered when
 * the view is longer.
 */
function clampScroll(scroll: number, min: number, max: number, size: number) {
    if (size >= max - min) return size / 2 - (min + max) / 2;
    return -Math.min(Math.max(-scroll, min), max - size);
}
