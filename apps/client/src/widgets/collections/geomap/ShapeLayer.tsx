import type { Map as MapLibreGLMap } from "maplibre-gl";
import { useContext, useEffect } from "preact/hooks";

import { MapStyleLoaded, ParentMap } from "./map";
import { circleRing, closeRing, type GeoShape, serializeGeoShape } from "./shapes";

/**
 * The prefixes a shape's layer ids start with. Every shape adds layers of its own, so
 * {@link shapeHitLayers} matches these against the style's layer order instead of naming layers.
 */
const STROKE_LAYER_PREFIX = "shape-stroke-";
const FILL_LAYER_PREFIX = "shape-fill-";
const HIT_LAYER_PREFIX = "shape-hit-";

/** Width in pixels of the transparent line that takes pointer hits on a shape's boundary. */
const HIT_WIDTH = 20;

interface ShapeLayerProps {
    /** The note the shape belongs to, which is what its source and layers are named after. */
    noteId: string;
    /** The shape off the note's label, as {@link parseGeoShape} hands it over. */
    shape: GeoShape;
    /** What the shape is drawn in — the note's own colour, as a track's would be. */
    color: string;
}

/**
 * A shape drawn onto the map by hand, read back off its note's `#geoShape` label (see shapes.ts).
 *
 * The GPX track's little sibling: the same source-and-layers arrangement, the same put-it-back-on-
 * every-style-load dance, without the file, the flags or the name written along it. A line is its
 * stroke alone; an area wears a wash of its colour under the same stroke, which is its boundary
 * drawn the way the line is. A transparent wide line over the boundary takes the pointer hits that
 * select the shape (see {@link shapeHitLayers}). What a track has that this does not yet: the label
 * layer and the marks. Each is a straight lift from {@link GpxTrack} when its turn comes.
 */
export function ShapeLayer({ noteId, shape, color }: ShapeLayerProps) {
    const parentMap = useContext(ParentMap);
    const styleLoaded = useContext(MapStyleLoaded);

    // The shape as a dependency the effect can compare: the object is rebuilt on every parse of
    // the label, so handing it over as-is would tear the layers down and put them back per render.
    // Its label spelling is exactly such a comparison — one string, stable across parses.
    const shapeKey = serializeGeoShape(shape);

    useEffect(() => {
        if (!parentMap) return;
        const map = parentMap;

        const sourceId = shapeSourceId(noteId);
        const strokeLayerId = `${STROKE_LAYER_PREFIX}${noteId}`;
        const fillLayerId = `${FILL_LAYER_PREFIX}${noteId}`;
        const hitLayerId = `${HIT_LAYER_PREFIX}${noteId}`;
        const hasArea = shape.type !== "line";

        // The shape lives in the map style, which setStyle() wipes for a URL-named vector style
        // (keepAdditions cannot carry what it never saw; see map.tsx) — so it is put back on every
        // style load, and each piece only if it is missing, exactly as a track is.
        function addShapeLayers() {
            try {
                if (!map.getSource(sourceId)) {
                    map.addSource(sourceId, {
                        type: "geojson",
                        data: {
                            type: "Feature",
                            // The note the shape stands for, carried in the feature the way a
                            // track's is, for whatever comes to hit-test shapes.
                            properties: { id: noteId },
                            geometry: shape.type === "line"
                                ? { type: "LineString", coordinates: shape.coordinates }
                                // An area is its ring closed back up — the ring the label spells
                                // for a polygon, or the one walked out of a circle's two numbers.
                                : { type: "Polygon", coordinates: [ closeRing(
                                    shape.type === "circle"
                                        ? circleRing(shape.center, shape.radiusMeters)
                                        : shape.coordinates
                                ) ] }
                        }
                    });
                }

                // The wash before the stroke, so the boundary is drawn over it rather than under.
                if (hasArea && !map.getLayer(fillLayerId)) {
                    map.addLayer({
                        id: fillLayerId,
                        type: "fill",
                        source: sourceId,
                        paint: {
                            "fill-color": color,
                            "fill-opacity": 0.15
                        }
                    });
                }

                if (!map.getLayer(strokeLayerId)) {
                    map.addLayer({
                        id: strokeLayerId,
                        type: "line",
                        source: sourceId,
                        layout: {
                            // Otherwise a line doubling back meets its own corners as spikes,
                            // and ends in a flat stub.
                            "line-join": "round",
                            "line-cap": "round"
                        },
                        paint: {
                            "line-color": color,
                            "line-width": 3
                        }
                    });
                }

                // Takes the pointer hits on the boundary, the 3px stroke being too thin to click
                // reliably. Drawn at zero opacity rather than hidden: MapLibre drops a layer from
                // queryRenderedFeatures() for `visibility: none` but not for being invisible.
                if (!map.getLayer(hitLayerId)) {
                    map.addLayer({
                        id: hitLayerId,
                        type: "line",
                        source: sourceId,
                        paint: {
                            "line-color": color,
                            "line-opacity": 0,
                            "line-width": HIT_WIDTH
                        }
                    });
                }
            } catch (e) {
                // Only worth a word if the style was ready and it still would not take the shape.
                if (styleLoaded) {
                    console.warn("Geo map: could not draw a shape —", e);
                }
            }
        }

        if (styleLoaded) {
            addShapeLayers();
        }
        map.on("style.load", addShapeLayers);

        return () => {
            map.off("style.load", addShapeLayers);
            try {
                // Every layer before the source they draw from: one still in use cannot be removed.
                for (const layer of [ hitLayerId, strokeLayerId, fillLayerId ]) {
                    if (map.getLayer(layer)) {
                        map.removeLayer(layer);
                    }
                }
                if (map.getSource(sourceId)) {
                    map.removeSource(sourceId);
                }
            } catch {
                // The map may already have been removed.
            }
        };
    }, [ parentMap, styleLoaded, noteId, shapeKey, color ]);

    return <div />;
}

/**
 * The one source a shape's layers draw from, named for whoever needs to read the shape back off
 * the map — as a track's is (see `trackSourceId`).
 */
export function shapeSourceId(noteId: string) {
    return `shape-source-${noteId}`;
}

/**
 * The layers that take pointer hits for the shapes on the map: each shape's widened boundary, plus
 * the fill of an area so that a click inside a polygon selects it. Each feature carries its note id.
 *
 * Read off the style on every call rather than cached, as `trackHitLayers()` is: a shape's layers
 * come and go with its note, and `queryRenderedFeatures()` returns nothing at all if a single named
 * layer is missing.
 */
export function shapeHitLayers(map: MapLibreGLMap) {
    return map.getLayersOrder().filter((id) => id.startsWith(HIT_LAYER_PREFIX) || id.startsWith(FILL_LAYER_PREFIX));
}
