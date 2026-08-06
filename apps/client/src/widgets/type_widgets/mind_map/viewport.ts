import type { MindElixirInstance } from "mind-elixir";

/** A point of the map, in the map's own coordinates — the ones a node is laid out in. */
export interface MapPoint {
    x: number;
    y: number;
}

/** What one step of the zoom buttons is worth, and how far they are allowed to carry the map. */
export interface ZoomLimits {
    /** How much the scale changes by in one step. */
    sensitivity: number;
    min: number;
    max: number;
}

/**
 * The scale the map takes on when zoomed one step in (`1`) or out (`-1`), or `null` where the step
 * would carry it past the end of the range it is allowed.
 *
 * Mind Elixir refuses such a step silently, so the same reckoning is done here to leave the button
 * for it disabled rather than idle. Only the end being moved towards is looked at, as the library
 * does: a map already drawn smaller than its own minimum — which is what fitting it to a small pane
 * leaves — can still be zoomed in from there.
 */
export function stepZoom(scale: number, direction: 1 | -1, { sensitivity, min, max }: ZoomLimits): number | null {
    const stepped = scale + direction * sensitivity;
    if (direction < 0 ? stepped < min : stepped > max) return null;
    return stepped;
}

/**
 * The point of the map that lies in the middle of the view.
 *
 * Read from the translation the map is drawn with rather than from where it lands on screen, that
 * being what {@link centerMapOn} writes back through and what Mind Elixir itself reckons in.
 */
export function readMapCenter(mind: MindElixirInstance): MapPoint {
    const { width, height } = mind.container.getBoundingClientRect();
    const { x, y } = parseMapTranslation(mind.map.style.transform);

    return {
        x: (width / 2 - x) / mind.scaleVal,
        y: (height / 2 - y) / mind.scaleVal
    };
}

/**
 * Moves the map so that the given point of it lies in the middle of the view, at whatever scale the
 * map is currently drawn at.
 *
 * Paired with {@link readMapCenter} across a change of the size of the view — going fullscreen and
 * coming back — where the map would otherwise keep the offset it had and slide off towards the
 * corner it is pinned to.
 */
export function centerMapOn(mind: MindElixirInstance, center: MapPoint) {
    const { width, height } = mind.container.getBoundingClientRect();
    const { x, y } = parseMapTranslation(mind.map.style.transform);

    mind.move(
        width / 2 - center.x * mind.scaleVal - x,
        height / 2 - center.y * mind.scaleVal - y
    );
}

/**
 * The offset a map is drawn at, taken from the `translate3d` Mind Elixir writes onto it — the one
 * form it ever writes, and the one its own `move` reads back. A map that has not been placed yet
 * carries no transform at all, which is the origin.
 */
export function parseMapTranslation(transform: string): MapPoint {
    const match = /translate3d\(([^,]+),\s*([^,)]+)/.exec(transform);
    const x = Number.parseFloat(match?.[1] ?? "");
    const y = Number.parseFloat(match?.[2] ?? "");

    return {
        x: Number.isFinite(x) ? x : 0,
        y: Number.isFinite(y) ? y : 0
    };
}
