import type { GeoJSONSource, Map as MapLibreGLMap } from "maplibre-gl";
import { useContext, useEffect } from "preact/hooks";

import { CLUSTER_LAYER } from "./clusters";
import { MapStyleLoaded, ParentMap } from "./map";
import { MARKER_LAYER, SELECTION_LAYER } from "./Markers";
import type { ImageSpace } from "./space";

const RULER_SOURCE = "image-rulers";
const GRID_LAYER = "image-rulers-grid";
const TICK_LAYER = "image-rulers-ticks";
const LABEL_LAYER = "image-rulers-labels";

/** The screen distance labels are spaced at, at least: the step is the next round number past it. */
const LABEL_SPACING_PX = 90;
/** How far a tick reaches out from the image's edge, in screen pixels. */
const TICK_LENGTH_PX = 6;
/** The gap between a tick's end and its label, in screen pixels. */
const LABEL_GAP_PX = 3;
/** The most ticks along one axis, far more than fit on a screen at the 90-pixel spacing. */
const MAX_TICKS = 1000;

/**
 * Coordinate rulers along an image map's edges, in the map's own coordinates (see
 * `#map:imageBounds`): a tick and a label at every round value on the top and left edges, bare ticks
 * on the bottom and right ones, and faint grid lines across the image.
 *
 * Drawn by MapLibre as one GeoJSON source, so the rulers move with the image. The step and the
 * ticks' length depend on the zoom, so the data is rebuilt as the map zooms.
 */
export default function ImageRulers({ space, isDarkTheme }: { space: ImageSpace; isDarkTheme: boolean }) {
    const map = useContext(ParentMap);
    const styleLoaded = useContext(MapStyleLoaded);

    useEffect(() => {
        if (!map || !styleLoaded) return;

        const colors = rulerColors(map.getContainer(), isDarkTheme);
        const build = () => rulerFeatures(space, screenScale(map, space));

        function add() {
            if (!map) return;
            try {
                if (!map.getSource(RULER_SOURCE)) {
                    map.addSource(RULER_SOURCE, { type: "geojson", data: build() });
                }

                // Under the markers, which are added either before or after these.
                const beforeId = [ CLUSTER_LAYER, SELECTION_LAYER, MARKER_LAYER ].find((id) => map.getLayer(id));
                if (!map.getLayer(GRID_LAYER)) {
                    map.addLayer({
                        id: GRID_LAYER,
                        type: "line",
                        source: RULER_SOURCE,
                        filter: [ "==", [ "get", "kind" ], "grid" ],
                        paint: { "line-color": colors.grid, "line-width": 1 }
                    }, beforeId);
                }
                if (!map.getLayer(TICK_LAYER)) {
                    map.addLayer({
                        id: TICK_LAYER,
                        type: "line",
                        source: RULER_SOURCE,
                        filter: [ "==", [ "get", "kind" ], "tick" ],
                        paint: { "line-color": colors.text, "line-width": 1 }
                    }, beforeId);
                }
                if (!map.getLayer(LABEL_LAYER)) {
                    map.addLayer({
                        id: LABEL_LAYER,
                        type: "symbol",
                        source: RULER_SOURCE,
                        filter: [ "==", [ "get", "kind" ], "label" ],
                        layout: {
                            "text-field": [ "get", "label" ],
                            "text-font": [ "Open Sans Regular" ],
                            "text-size": 11,
                            "text-anchor": [ "get", "anchor" ],
                            // Spaced by the step already, and never to be dropped for a marker's title.
                            "text-allow-overlap": true,
                            "text-ignore-placement": true
                        },
                        paint: {
                            "text-color": colors.text,
                            "text-halo-color": colors.halo,
                            "text-halo-width": 1
                        }
                    }, beforeId);
                }
            } catch (e) {
                console.warn("Geo map: could not draw the rulers —", e);
            }
        }

        // One rebuild per frame, however many zoom events arrive in it.
        let frame = 0;
        function update() {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => map?.getSource<GeoJSONSource>(RULER_SOURCE)?.setData(build()));
        }

        add();
        map.on("style.load", add);
        map.on("zoom", update);

        return () => {
            cancelAnimationFrame(frame);
            map.off("style.load", add);
            map.off("zoom", update);
            try {
                for (const layer of [ LABEL_LAYER, TICK_LAYER, GRID_LAYER ]) {
                    if (map.getLayer(layer)) {
                        map.removeLayer(layer);
                    }
                }
                if (map.getSource(RULER_SOURCE)) {
                    map.removeSource(RULER_SOURCE);
                }
            } catch {
                // The map may already have been removed.
            }
        };
    }, [ map, styleLoaded, space, isDarkTheme ]);

    return null;
}

/**
 * The rulers as GeoJSON: grid lines across the image, ticks out from its edges and a label past
 * every tick on the top and left edges.
 *
 * Built in the image's pixels, measured from its top-left corner, and converted to `[lng, lat]`
 * last, so flipped axes and axes of different scales need no special handling.
 *
 * @param screenPerImagePixel how many screen pixels one pixel of the image takes at the current zoom.
 */
export function rulerFeatures(space: ImageSpace, screenPerImagePixel: number): GeoJSON.FeatureCollection {
    const { size: { width, height }, extent: { topLeft: [ left, top ], bottomRight: [ right, bottom ] } } = space;
    const tick = TICK_LENGTH_PX / screenPerImagePixel;
    const labelAt = (TICK_LENGTH_PX + LABEL_GAP_PX) / screenPerImagePixel;
    const features: GeoJSON.Feature[] = [];

    const line = (kind: "grid" | "tick", from: [number, number], to: [number, number]) => features.push({
        type: "Feature",
        properties: { kind },
        geometry: { type: "LineString", coordinates: [ space.pixelToLngLat(from), space.pixelToLngLat(to) ] }
    });
    const label = (text: string, anchor: "bottom" | "right", at: [number, number]) => features.push({
        type: "Feature",
        properties: { kind: "label", label: text, anchor },
        geometry: { type: "Point", coordinates: space.pixelToLngLat(at) }
    });

    for (const { value, text } of axisTicks(left, right, width, screenPerImagePixel)) {
        const x = ((value - left) / (right - left)) * width;
        line("grid", [ x, 0 ], [ x, height ]);
        line("tick", [ x, 0 ], [ x, -tick ]);
        line("tick", [ x, height ], [ x, height + tick ]);
        label(text, "bottom", [ x, -labelAt ]);
    }

    for (const { value, text } of axisTicks(top, bottom, height, screenPerImagePixel)) {
        const y = ((value - top) / (bottom - top)) * height;
        line("grid", [ 0, y ], [ width, y ]);
        line("tick", [ 0, y ], [ -tick, y ]);
        line("tick", [ width, y ], [ width + tick, y ]);
        label(text, "right", [ -labelAt, y ]);
    }

    // The image's outline, which the ticks stand on.
    const corners: [number, number][] = [ [ 0, 0 ], [ width, 0 ], [ width, height ], [ 0, height ], [ 0, 0 ] ];
    features.push({
        type: "Feature",
        properties: { kind: "tick" },
        geometry: { type: "LineString", coordinates: corners.map(space.pixelToLngLat) }
    });

    return { type: "FeatureCollection", features };
}

/**
 * The round values along one axis that get a tick, from the edge at `from` to the one at `to` (either
 * way round), with the text each is labeled with.
 */
export function axisTicks(from: number, to: number, pixels: number, screenPerImagePixel: number) {
    const unitsPerScreenPixel = Math.abs(to - from) / pixels / screenPerImagePixel;
    const step = niceStep(unitsPerScreenPixel * LABEL_SPACING_PX);
    const decimals = Math.max(0, Math.ceil(-Math.log10(step)));
    const low = Math.min(from, to);
    const high = Math.max(from, to);

    const ticks: { value: number; text: string }[] = [];
    // A hair of slack, so an edge that falls on a round value keeps its tick despite rounding.
    const slack = step * 1e-9;
    const first = Math.ceil((low - slack) / step) * step;
    // Counted from the first tick, since far from zero `first / step + 1` can round back to itself.
    const count = Math.min(Math.floor((high + slack - first) / step), MAX_TICKS);
    for (let i = 0; i <= count; i++) {
        const value = Number((first + i * step).toFixed(decimals));
        // `+ 0` turns a negative zero into a plain one, which would otherwise print as "-0".
        ticks.push({ value, text: String(value + 0) });
    }
    return ticks;
}

/** The smallest of 1, 2 and 5 times a power of ten that is at least `raw`. */
export function niceStep(raw: number) {
    const power = 10 ** Math.floor(Math.log10(raw));
    const fraction = raw / power;
    const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
    return nice * power;
}

/** How many screen pixels a pixel of the image takes at the map's current zoom. */
function screenScale(map: MapLibreGLMap, space: ImageSpace) {
    const start = map.project(space.pixelToLngLat([ 0, 0 ]));
    const end = map.project(space.pixelToLngLat([ space.size.width, 0 ]));
    return Math.hypot(end.x - start.x, end.y - start.y) / space.size.width;
}

/**
 * The ticks and labels stand mostly outside the image, over the page around it, so they take the
 * app's own text colors. The grid lines lie over the image, so they follow `#map:darkStyle`.
 */
function rulerColors(container: HTMLElement, isDarkTheme: boolean) {
    const style = getComputedStyle(container);
    return {
        text: style.getPropertyValue("--main-text-color").trim() || "#333",
        halo: style.getPropertyValue("--main-background-color").trim() || "#fff",
        grid: isDarkTheme ? "rgba(255, 255, 255, 0.2)" : "rgba(0, 0, 0, 0.15)"
    };
}
