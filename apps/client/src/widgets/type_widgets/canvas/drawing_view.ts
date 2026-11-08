import { CaptureUpdateAction, getCommonBounds } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type {
    AppState, ExcalidrawImperativeAPI, NormalizedZoomValue
} from "@excalidraw/excalidraw/types";
import type { DrawingFrame } from "@triliumnext/commons";

/** Excalidraw's zoom limits, from its own zoom buttons. */
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 30;
/** Excalidraw's zoom step, from its own zoom buttons. */
export const ZOOM_STEP = 0.1;

export type DrawingView = Pick<AppState, "zoom" | "scrollX" | "scrollY">;

/** The view of `appState`: its zoom and scroll. */
export function getDrawingView({ zoom, scrollX, scrollY }: DrawingView): DrawingView {
    return { zoom, scrollX, scrollY };
}

/** Whether `a` and `b` are the same view, to a millionth. */
export function isSameView(a: DrawingView, b: DrawingView) {
    return isClose(a.zoom.value, b.zoom.value)
        && isClose(a.scrollX, b.scrollX)
        && isClose(a.scrollY, b.scrollY);
}

/** Whether `a` and `b` are the same frame, to a millionth. */
export function isSameFrame(a: DrawingFrame, b: DrawingFrame) {
    return isClose(a.x, b.x) && isClose(a.y, b.y) && isClose(a.width, b.width)
        && isClose(a.height, b.height) && isClose(a.scale, b.scale);
}

/** The frame of a box `width` by `height` pixels that shows `view`, to thousandths. */
export function getFrame(view: DrawingView, width: number, height: number): DrawingFrame {
    const scale = view.zoom.value;
    return {
        x: round(-view.scrollX),
        y: round(-view.scrollY),
        width: round(width / scale),
        height: round(height / scale),
        scale: round(scale)
    };
}

/** The view that shows `frame` at its scale. */
export function getFrameView(frame: DrawingFrame): DrawingView {
    return {
        zoom: { value: frame.scale as NormalizedZoomValue },
        scrollX: -frame.x,
        scrollY: -frame.y
    };
}

/** `frame` widened or narrowed to `width` pixels at its scale, around its center. */
export function getWidenedFrame(frame: DrawingFrame, width: number): DrawingFrame {
    const frameWidth = width / frame.scale;
    return {
        ...frame,
        x: round(frame.x + (frame.width - frameWidth) / 2),
        width: round(frameWidth)
    };
}

/** The least a drawing shrinks to, as a fraction of the scale it was drawn at. */
export const MIN_FRAME_SCALE = 0.75;

/** The view that fills a box `width` pixels wide with `frame`, within Excalidraw's zoom limits. */
export function getFrameViewAt(frame: DrawingFrame, width: number): DrawingView {
    const zoom = Math.min(Math.max(width / frame.width, MIN_ZOOM), MAX_ZOOM);
    return {
        zoom: { value: zoom as NormalizedZoomValue },
        scrollX: -frame.x,
        scrollY: -frame.y
    };
}

/**
 * The shapes that Excalidraw's export takes the size of: those outside frames, and the frames,
 * which clip what they hold.
 */
export function getRootElements(elements: readonly ExcalidrawElement[]) {
    const frameIds = new Set(elements
        .filter((element) => element.type === "frame" || element.type === "magicframe")
        .map((element) => element.id));
    return elements.filter((element) => !element.frameId || !frameIds.has(element.frameId));
}

const appliedViews = new WeakMap<ExcalidrawImperativeAPI, DrawingView>();

/**
 * Shows `view` in `api` as a move of Trilium's own, such as a fit or a pan to a search result,
 * which {@link takeAppliedView} tells from a move by the user.
 */
export function applyDrawingView(api: ExcalidrawImperativeAPI, view: DrawingView) {
    appliedViews.set(api, view);
    api.updateScene({ appState: view, captureUpdate: CaptureUpdateAction.NEVER });
}

/** Whether `view` is the last one applied to `api`, which is then forgotten. */
export function takeAppliedView(api: ExcalidrawImperativeAPI, view: DrawingView) {
    const applied = appliedViews.get(api);
    if (!applied || !isSameView(applied, view)) return false;
    appliedViews.delete(api);
    return true;
}

/** The width that panels cover at the left and the right edge of a drawing. */
export interface CoveredSides {
    left: number;
    right: number;
}

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
 * The view of a drawing `width` by `height` that fits its content between the `covered` sides and
 * centers it there, as Excalidraw's "Zoom to fit all elements" does: zoomed in up to 100%, in
 * steps of {@link ZOOM_STEP}. Sides that cover the whole width are ignored. `null` without
 * content or a size.
 */
export function getZoomToFitView(
    elements: readonly ExcalidrawElement[],
    width: number,
    height: number,
    covered: CoveredSides = { left: 0, right: 0 }
): DrawingView | null {
    const shown = elements.filter((element) => !element.isDeleted);
    if (!shown.length || !width || !height) return null;

    const { left, right } = covered.left + covered.right < width ? covered : { left: 0, right: 0 };
    const freeWidth = width - left - right;
    const bounds = getCommonBounds(shown);
    const [ minX, minY, maxX, maxY ] = bounds;
    const fit = Math.min(freeWidth / (maxX - minX), height / (maxY - minY), 1);
    const factor = 1 / ZOOM_STEP;
    const zoom = Math.max(Math.floor(fit * factor) / factor, MIN_ZOOM);
    const view = centerView(bounds, zoom, freeWidth, height);
    return { ...view, scrollX: view.scrollX + left / zoom };
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

type Box = readonly [ number, number, number, number ];

/** The view of a drawing `width` by `height` that shows the box from `minX` to `maxY` whole. */
function fitView(box: Box, width: number, height: number): DrawingView {
    const [ minX, minY, maxX, maxY ] = box;
    const fit = Math.min(width / (maxX - minX), height / (maxY - minY));
    const zoom = Math.min(Math.max(fit, MIN_ZOOM), MAX_ZOOM);
    return centerView(box, zoom, width, height);
}

/** The view of a drawing `width` by `height` at `zoom`, centered on the box. */
function centerView(
    [ minX, minY, maxX, maxY ]: Box,
    zoom: number,
    width: number,
    height: number
): DrawingView {
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

function isClose(a: number, b: number) {
    return Math.abs(a - b) < EPSILON;
}

/** `value` to thousandths, never negative zero. */
function round(value: number) {
    const rounded = Math.round(value * 1000) / 1000;
    return rounded === 0 ? 0 : rounded;
}
