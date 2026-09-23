import type { MapGeoJSONFeature, Map as MapLibreGLMap, Point } from "maplibre-gl";
import { useContext, useEffect } from "preact/hooks";

import froca from "../../../services/froca";
import { trackHitLayers } from "./GpxTrack";
import { useHoverName } from "./hover_name";
import { MapStyleLoaded, ParentMap } from "./map";
import { MARKER_LAYER } from "./Markers";
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
    /** The note the shape belongs to. Its source and layers are named after it. */
    noteId: string;
    /** The shape read off the note's label by {@link parseGeoShape}. */
    shape: GeoShape;
    /** The note's own color, which the shape is drawn in, as a track is. */
    color: string;
}

/**
 * A shape drawn onto the map by hand, read back off its note's `#geoShape` label (see shapes.ts).
 *
 * Built like {@link GpxTrack}: one source per note, with its layers re-added on every style load. A
 * line is drawn as its stroke alone, an area as a fill under the same stroke. A wide transparent
 * line over the boundary takes the pointer hits that select the shape (see {@link shapeHitLayers}).
 */
export function ShapeLayer({ noteId, shape, color }: ShapeLayerProps) {
    const parentMap = useContext(ParentMap);
    const styleLoaded = useContext(MapStyleLoaded);

    // parseGeoShape() rebuilds the object on every render, so the effect compares the label
    // spelling instead, which is stable across parses.
    const shapeKey = serializeGeoShape(shape);

    useEffect(() => {
        if (!parentMap) return;
        const map = parentMap;

        const sourceId = shapeSourceId(noteId);
        const strokeLayerId = `${STROKE_LAYER_PREFIX}${noteId}`;
        const fillLayerId = `${FILL_LAYER_PREFIX}${noteId}`;
        const hitLayerId = `${HIT_LAYER_PREFIX}${noteId}`;
        const hasArea = shape.type !== "line";

        // setStyle() wipes the shape for a URL-named vector style (keepAdditions cannot carry
        // what it never saw; see map.tsx), so every missing piece is re-added on each style load.
        function addShapeLayers() {
            try {
                if (!map.getSource(sourceId)) {
                    map.addSource(sourceId, {
                        type: "geojson",
                        data: {
                            type: "Feature",
                            // The note the shape belongs to, which featureAt() reads back.
                            properties: { id: noteId },
                            geometry: shape.type === "line"
                                ? { type: "LineString", coordinates: shape.coordinates }
                                // An area is its ring closed back up: a polygon's own points,
                                // or the ring walked out of a circle's centre and radius.
                                : { type: "Polygon", coordinates: [ closeRing(
                                    shape.type === "circle"
                                        ? circleRing(shape.center, shape.radiusMeters)
                                        : shape.coordinates
                                ) ] }
                        }
                    });
                }

                // Added before the stroke, so the boundary draws over the fill rather than under.
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
                            // Otherwise a line doubling back meets its own corners as spikes
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

                // Takes the pointer hits on the boundary, the 3px stroke being too thin to
                // click reliably. Drawn at zero opacity rather than hidden, since MapLibre drops a
                // layer from queryRenderedFeatures() for `visibility: none` but not for being
                // invisible.
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
                // Only worth reporting if the style was ready and still would not take the shape.
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
                // Layers before the source they draw from: a source still in use cannot be removed.
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
 * The name of the drawn shape under the pointer, shown once the pointer has rested on it.
 *
 * A shape carries no name on the map, unlike a marker's title under its pin or a track's along its
 * line. Shown on hover rather than drawn on the map, as the base map's places are (see Pois): a
 * shape starts out titled "New note", and a name over an area covers what it names.
 *
 * Mounted once for the whole map, one binding watching every shape's layers.
 */
export function ShapeNames() {
    const map = useContext(ParentMap);

    useHoverName(map, {
        layers: shapeHitLayers,
        answer: (e) => {
            if (!map) return null;

            // A marker or track over the shape is the smaller target and the one a click means
            // (see featureAt), and it sets its own cursor, so the shape defers to it.
            const feature = featureAt(map, e.point);
            if (!feature) return null;
            if (!isShapeFeature(feature)) return "deferred";

            const note = froca.getNoteFromCache(String(feature.properties.id));
            if (!note) return null;

            return {
                id: note.noteId,
                // Where the pointer came to rest, an area having no single point to anchor to.
                // The name stays there while the pointer remains on the same shape.
                lngLat: [ e.lngLat.lng, e.lngLat.lat ],
                icon: note.getIcon(),
                text: note.title
            };
        }
    });

    return null;
}

/** The single source a shape's layers draw from, named so callers can read the shape back off
 *  the map, as `trackSourceId` is. */
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

/**
 * The feature of one of the map's notes under a point, or `undefined` where none is hit.
 *
 * The shapes are queried separately because `queryRenderedFeatures()` returns features in drawing
 * order, not in `layers` order: an area's fill covers its interior and draws above the markers, so
 * one query would answer a click on a pin inside a polygon with the polygon. An empty `layers` list
 * matches nothing, so a map without shapes needs no guard.
 */
export function featureAt(map: MapLibreGLMap, point: Point): MapGeoJSONFeature | undefined {
    return map.queryRenderedFeatures(point, { layers: [ MARKER_LAYER, ...trackHitLayers(map) ] })[0]
        ?? map.queryRenderedFeatures(point, { layers: shapeHitLayers(map) })[0];
}

/** Whether {@link featureAt} returned a shape rather than a marker or a track. */
function isShapeFeature(feature: MapGeoJSONFeature) {
    return feature.layer.id.startsWith(HIT_LAYER_PREFIX) || feature.layer.id.startsWith(FILL_LAYER_PREFIX);
}
