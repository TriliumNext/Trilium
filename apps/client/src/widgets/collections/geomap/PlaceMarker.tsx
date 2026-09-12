import { useContext, useEffect } from "preact/hooks";

import { MapStyleLoaded, ParentMap } from "./map";
import { buildMarkerImage, LABEL_LAYOUT, LABEL_PAINT, MARKER_SHADOW_PADDING, markerImageId } from "./Markers";

/** The colour the pin is drawn in, so a searched place is not read as one of the map's own notes. */
export const PLACE_MARKER_COLOR = "#E8833A";

/** The icon inside that pin, for a place whose kind the geocoder does not say. */
export const PLACE_MARKER_ICON = "bx bx-search";

export const PLACE_SOURCE = "searched-place";
export const PLACE_LAYER = "searched-place-layer";

export const OUTLINE_SOURCE = "searched-place-outline";
export const OUTLINE_FILL_LAYER = "searched-place-outline-fill";
export const OUTLINE_LINE_LAYER = "searched-place-outline-line";

/** How much of the map shows through the boundary's fill, which is a tint rather than a covering. */
const OUTLINE_FILL_OPACITY = 0.12;

interface PlaceMarkerProps {
    /** Where the place stands, as `[lng, lat]`. */
    center: [number, number];
    /** What the pin is labelled with: the place's own name rather than its full address. */
    name: string;
    /** Whether the map's style is a dark one, which decides how the label is drawn (see Markers). */
    isDarkTheme: boolean;
    /** A boxicons class saying what kind of place it is, drawn inside the pin (see osm_icons). */
    icon?: string;
    /** The ground the place covers, for one that is an area rather than a point. */
    outline?: GeoJSON.Geometry;
}

/**
 * The pin standing on a place taken from the geocoder.
 *
 * A symbol layer of its own rather than a feature among the notes': that layer is built from the
 * notes and reloaded with them, and a searched place is neither. It goes through the same pin
 * rasterizer and the same label layout and paint the note markers use (see Markers), so it is drawn
 * as a marker of the map rather than as something laid over it — the name included, which follows
 * the style from light to dark as every other label on the map does.
 *
 * A place that covers ground rather than standing at a point — a country, a county — also has that
 * ground drawn under the pin, in the pin's own colour so the two read as one answer.
 */
export default function PlaceMarker({ center, name, isDarkTheme, icon, outline }: PlaceMarkerProps) {
    const parentMap = useContext(ParentMap);
    const styleLoaded = useContext(MapStyleLoaded);

    useEffect(() => {
        if (!parentMap) return;
        // Aliased so the narrowing above carries into the nested function below.
        const map = parentMap;
        const iconClass = icon ?? PLACE_MARKER_ICON;
        const imageId = markerImageId(PLACE_MARKER_COLOR, iconClass);
        let cancelled = false;
        let image: HTMLImageElement | null = null;

        function addLayer() {
            const pin = image;
            if (cancelled || !pin) return;

            try {
                if (map.getLayer(PLACE_LAYER)) return;

                if (!map.hasImage(imageId)) {
                    map.addImage(imageId, pin, { pixelRatio: window.devicePixelRatio || 1 });
                }

                map.addSource(PLACE_SOURCE, {
                    type: "geojson",
                    data: {
                        type: "Feature",
                        geometry: { type: "Point", coordinates: center },
                        properties: { name }
                    }
                });

                map.addLayer({
                    id: PLACE_LAYER,
                    type: "symbol",
                    source: PLACE_SOURCE,
                    layout: {
                        "icon-image": imageId,
                        "icon-size": 1,
                        "icon-anchor": "bottom",
                        // The image carries padding for its shadow, pushed back down by exactly that
                        // much so the tip stands on the coordinate — as the note pins are.
                        "icon-offset": [ 0, MARKER_SHADOW_PADDING ],
                        ...LABEL_LAYOUT,
                        // Neither the pin nor its name gives way to a crowded map: this is the one
                        // thing on it the user has just asked to be shown, and it stands only until
                        // they have done with it.
                        "icon-allow-overlap": true,
                        "text-allow-overlap": true
                    },
                    paint: {
                        ...LABEL_PAINT[isDarkTheme ? "dark" : "light"],
                        "text-halo-width": 2,
                        "text-halo-blur": 1
                    }
                });
            } catch (e) {
                // Only worth a word if the style was ready and it still would not take the pin.
                if (styleLoaded) {
                    console.warn("Geo map: could not pin the searched place —", e);
                }
            }
        }

        buildMarkerImage(PLACE_MARKER_COLOR, iconClass).then((built) => {
            if (cancelled) return;
            image = built;
            if (styleLoaded) {
                addLayer();
            }
        });

        if (styleLoaded) {
            addLayer();
        }
        map.on("style.load", addLayer);

        return () => {
            cancelled = true;
            map.off("style.load", addLayer);
            try {
                // The layer before the source it draws from: one still in use cannot be removed.
                if (map.getLayer(PLACE_LAYER)) {
                    map.removeLayer(PLACE_LAYER);
                }
                if (map.getSource(PLACE_SOURCE)) {
                    map.removeSource(PLACE_SOURCE);
                }
            } catch {
                // The map may already have been removed.
            }
        };
    }, [ parentMap, styleLoaded, center, name, isDarkTheme, icon ]);

    useEffect(() => {
        if (!parentMap || !outline) return;
        // Aliased so the narrowing above carries into the nested function below.
        const map = parentMap;
        const geometry = outline;

        function addOutline() {
            try {
                if (map.getLayer(OUTLINE_FILL_LAYER)) return;

                map.addSource(OUTLINE_SOURCE, {
                    type: "geojson",
                    data: { type: "Feature", geometry, properties: {} }
                });

                // Under the pin, which would otherwise be buried by the boundary drawn around it.
                // The pin's layer is only there once its image has been rasterized, so where it is
                // not yet, the boundary goes on top and the pin is added above it in its turn.
                const beforeId = map.getLayer(PLACE_LAYER) ? PLACE_LAYER : undefined;

                map.addLayer({
                    id: OUTLINE_FILL_LAYER,
                    type: "fill",
                    source: OUTLINE_SOURCE,
                    paint: {
                        "fill-color": PLACE_MARKER_COLOR,
                        "fill-opacity": OUTLINE_FILL_OPACITY
                    }
                }, beforeId);

                map.addLayer({
                    id: OUTLINE_LINE_LAYER,
                    type: "line",
                    source: OUTLINE_SOURCE,
                    paint: {
                        "line-color": PLACE_MARKER_COLOR,
                        "line-width": 2
                    }
                }, beforeId);
            } catch (e) {
                if (styleLoaded) {
                    console.warn("Geo map: could not draw the searched place's boundary —", e);
                }
            }
        }

        if (styleLoaded) {
            addOutline();
        }
        map.on("style.load", addOutline);

        return () => {
            map.off("style.load", addOutline);
            try {
                for (const layer of [ OUTLINE_FILL_LAYER, OUTLINE_LINE_LAYER ]) {
                    if (map.getLayer(layer)) {
                        map.removeLayer(layer);
                    }
                }
                if (map.getSource(OUTLINE_SOURCE)) {
                    map.removeSource(OUTLINE_SOURCE);
                }
            } catch {
                // The map may already have been removed.
            }
        };
    }, [ parentMap, styleLoaded, outline ]);

    return null;
}
