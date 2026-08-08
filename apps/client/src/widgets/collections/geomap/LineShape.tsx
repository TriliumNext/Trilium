import { useContext, useEffect } from "preact/hooks";

import { MapStyleLoaded, ParentMap } from "./map";

interface LineShapeProps {
    /** The note the line belongs to, which is what its source and layer are named after. */
    noteId: string;
    /** `[lng, lat]` pairs, as {@link parseGeoShape} hands them over. */
    coordinates: [number, number][];
    /** What the line is drawn in — the note's own colour, as a track's would be. */
    color: string;
}

/**
 * A line drawn onto the map by hand, read back off its note's `#geoShape` label (see shapes.ts).
 *
 * The GPX track's little sibling: the same source-and-line-layer shape, the same put-it-back-on-
 * every-style-load dance, without the file, the flags or the name written along it — a spike's
 * worth of track. What a track has that this does not yet: the label layer, the widened hit line
 * the context menu needs, and the marks. Each is a straight lift from {@link GpxTrack} when its
 * turn comes.
 */
export function LineShape({ noteId, coordinates, color }: LineShapeProps) {
    const parentMap = useContext(ParentMap);
    const styleLoaded = useContext(MapStyleLoaded);

    // The coordinates as a dependency the effect can compare: the array is rebuilt on every parse
    // of the label, so handing it over as-is would tear the line down and put it back per render.
    const coordinatesKey = coordinates.flat().join(",");

    useEffect(() => {
        if (!parentMap) return;
        const map = parentMap;

        const sourceId = lineShapeSourceId(noteId);
        const layerId = `shape-line-${noteId}`;

        // The line lives in the map style, which setStyle() wipes for a URL-named vector style
        // (keepAdditions cannot carry what it never saw; see map.tsx) — so it is put back on every
        // style load, and each piece only if it is missing, exactly as a track is.
        function addLineLayers() {
            try {
                if (!map.getSource(sourceId)) {
                    map.addSource(sourceId, {
                        type: "geojson",
                        data: {
                            type: "Feature",
                            // The note the line stands for, carried in the feature the way a
                            // track's is, for whatever comes to hit-test shapes.
                            properties: { id: noteId },
                            geometry: {
                                type: "LineString",
                                coordinates
                            }
                        }
                    });
                }

                if (!map.getLayer(layerId)) {
                    map.addLayer({
                        id: layerId,
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
            } catch (e) {
                // Only worth a word if the style was ready and it still would not take the line.
                if (styleLoaded) {
                    console.warn("Geo map: could not draw a shape —", e);
                }
            }
        }

        if (styleLoaded) {
            addLineLayers();
        }
        map.on("style.load", addLineLayers);

        return () => {
            map.off("style.load", addLineLayers);
            try {
                // The layer before the source it draws from: one still in use cannot be removed.
                if (map.getLayer(layerId)) {
                    map.removeLayer(layerId);
                }
                if (map.getSource(sourceId)) {
                    map.removeSource(sourceId);
                }
            } catch {
                // The map may already have been removed.
            }
        };
    }, [ parentMap, styleLoaded, noteId, coordinatesKey, color ]);

    return <div />;
}

/**
 * The one source a shape's layers draw from, named for whoever needs to read the shape back off
 * the map — as a track's is (see `trackSourceId`).
 */
export function lineShapeSourceId(noteId: string) {
    return `shape-source-${noteId}`;
}
