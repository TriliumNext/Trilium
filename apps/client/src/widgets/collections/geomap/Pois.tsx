import "./Pois.css";

import { type AllPaintProperties, type ExpressionSpecification, type InterpolationSpecification, type Map as MapLibreGLMap, type MapGeoJSONFeature, type MapMouseEvent, Popup } from "maplibre-gl";
import { useContext, useEffect } from "preact/hooks";

import { CLUSTER_LAYERS } from "./clusters";
import type { GeoSearchResult } from "./geocoding";
import { trackHitLayers } from "./GpxTrack";
import { MapStyleLoaded, ParentMap } from "./map";
import { MARKER_LAYER } from "./Markers";
import { placeIcon } from "./osm_icons";
import { PLACE_LAYER, PLACE_MARKER_COLOR } from "./PlaceMarker";

/** The source layer the vector styles draw shops, cafes and the rest of the base map's places from. */
const POI_SOURCE_LAYER = "pois";

/**
 * The zoom a place answers a click from. The styles put their places on at zoom 16 but fade them in
 * over the zoom that follows, and a place that cannot yet be seen is not one anybody means to click.
 */
const MIN_POI_ZOOM = 17;

/**
 * How solid a place that answers a click is drawn. The styles hold their places at a fraction of
 * this, which is what keeps them a background; a place that can be kept is not one.
 */
const CLICKABLE_OPACITY = 0.95;

/**
 * How long the pointer has to rest on a place before its name is shown.
 *
 * Shorter than the wait a marker's preview sits out, that one reading a note from the server while
 * this is already in hand — but long enough that sweeping the pointer down a high street does not
 * name every shop on the way past.
 */
const TOOLTIP_DELAY = 200;

/** How far the name stands above the place's icon, which is drawn at half size by the styles. */
const TOOLTIP_OFFSET = 10;

/**
 * The OSM keys a tile classifies a place by, in the order the styles draw them. A feature carries at
 * most a few of these, and the first one present is what the place is.
 */
const POI_TAG_KEYS = [
    "amenity",
    "leisure",
    "tourism",
    "shop",
    "man_made",
    "historic",
    "emergency",
    "highway",
    "office"
];

interface PoisProps {
    /** A click is armed to place a marker, so it does not also mean "tell me about this place". */
    placing: boolean;
    /** Reports the place clicked on the base map, for the caller to stand the map on. */
    onPick(place: GeoSearchResult): void;
}

/**
 * Makes the places the base map already draws — a cafe, a pharmacy, a museum — answer a click.
 *
 * The vector styles draw them from the `pois` source layer, which carries each place's name and the
 * OSM tags that say what kind of place it is. Both are read out of the tile the map has already
 * downloaded, so a click costs no request and the place can be kept as a marker without typing its
 * name (see `keepPlaceAsMarker` in index.tsx).
 *
 * Nothing to draw of its own: a picked place is handed back and stands under the same pin and panel a
 * searched one does (see PlaceMarker and PlacePanel).
 *
 * The raster layer has its places baked into the image and Neutrino carries none, so there is nothing
 * to hit-test under either and a click falls through to what it meant before.
 */
export default function Pois({ placing, onPick }: PoisProps) {
    const parentMap = useContext(ParentMap);
    const styleLoaded = useContext(MapStyleLoaded);

    useEffect(() => {
        if (!parentMap || placing) return;
        // Aliased so the narrowing above carries into the handler below.
        const map = parentMap;

        const onClick = (e: MapMouseEvent) => {
            if (map.getZoom() < MIN_POI_ZOOM || isOwnUnderPointer(map, e.point)) return;

            const layers = poiLayers(map);
            if (!layers.length) return;

            const place = poiFromFeature(map.queryRenderedFeatures(e.point, { layers })[0]);
            if (place) {
                onPick(place);
            }
        };

        map.on("click", onClick);
        return () => { map.off("click", onClick); };
    }, [ parentMap, placing, onPick ]);

    /**
     * The name of the place under the pointer, and the pointer itself saying it can be clicked.
     *
     * The styles draw a place as a bare icon: they carry its name but put no label on the map for it,
     * and turning those labels on would set them against the titles of the map's own markers, which
     * give way to whatever is placed before them (see `text-optional` in Markers). Shown on hover
     * instead, the name costs the map nothing until it is asked for.
     */
    useEffect(() => {
        if (!parentMap || placing) return;
        // Aliased so the narrowing above carries into the functions below.
        const map = parentMap;

        const tooltip = new Popup({
            closeButton: false,
            closeOnClick: false,
            // Otherwise MapLibre puts the caret in the popup as it opens, taking the focus out of
            // whatever the user was typing in (see Tooltips).
            focusAfterOpen: false,
            offset: TOOLTIP_OFFSET,
            className: "place-tooltip"
        });

        let bound: string[] = [];
        // The place under the pointer, which is what keeps a name from being shown twice over and
        // from coming back after a click until the pointer has left and returned.
        let hovered: string | null = null;
        let showTimer: ReturnType<typeof setTimeout> | undefined;

        const setCursor = (cursor: string) => { map.getCanvas().style.cursor = cursor; };

        function hide() {
            clearTimeout(showTimer);
            tooltip.remove();
        }

        function onMouseMove(e: MapMouseEvent & { features?: MapGeoJSONFeature[] }) {
            // A marker, a cluster or a track stands above the base map, and owns the pointer along
            // with the click while it does.
            if (map.getZoom() < MIN_POI_ZOOM || isOwnUnderPointer(map, e.point)) {
                hovered = null;
                hide();
                return;
            }

            const place = poiFromFeature(e.features?.[0]);
            if (!place) {
                // A place with no name answers no click either, so the pointer offers none.
                hovered = null;
                setCursor("");
                hide();
                return;
            }

            setCursor("pointer");
            // Watched by the move rather than by `mouseenter`, which fires on entering the layer
            // rather than the place: the pointer crossing from one place to the next never leaves
            // the layer, and the first name would stay up over the second.
            if (place.id === hovered) return;

            hovered = place.id;
            hide();
            showTimer = setTimeout(() => {
                tooltip
                    .setLngLat([ place.lng, place.lat ])
                    .setDOMContent(placeLabel(place))
                    .addTo(map);
            }, TOOLTIP_DELAY);
        }

        function onMouseLeave() {
            hovered = null;
            setCursor("");
            hide();
        }

        /**
         * Puts the name away because the map was clicked, whatever the click was for. `hovered` is
         * kept rather than cleared, which is what stops the name coming back over the panel the
         * click has just opened: the place stays the one under the pointer until the pointer leaves.
         */
        function dismiss() {
            hide();
        }

        function unbind() {
            if (bound.length) {
                map.off("mousemove", bound, onMouseMove);
                map.off("mouseleave", bound, onMouseLeave);
            }
            bound = [];
        }

        function bind() {
            unbind();
            bound = poiLayers(map);
            if (bound.length) {
                map.on("mousemove", bound, onMouseMove);
                map.on("mouseleave", bound, onMouseLeave);
            }
        }

        bind();
        // Switching the style replaces every layer the handlers were bound to.
        map.on("style.load", bind);
        map.on("click", dismiss);

        return () => {
            map.off("style.load", bind);
            map.off("click", dismiss);
            unbind();
            hide();
            // The pointer is put back by hand, since this can be torn down while it sits on a place
            // and the `mouseleave` that would have cleared it is no longer listened for.
            setCursor("");
        };
    }, [ parentMap, placing, styleLoaded ]);

    /**
     * Draws the places that answer a click in the colour a place is pinned in, so which of them do
     * is read off the map rather than found by hovering each in turn.
     *
     * Composed over what the style painted rather than replacing it, so the places that answer no
     * click -- an unnamed bench, anything at a zoom too far out to pick from -- keep the grey the
     * style drew them in and stand as the background they are.
     */
    useEffect(() => {
        if (!parentMap) return;
        // Aliased so the narrowing above carries into the functions below.
        const map = parentMap;
        // What the style painted its places with, to be put back when this is taken off. Either
        // may be absent, a style being composable in one and not the other.
        let painted: {
            layer: string;
            color?: AllPaintProperties["icon-color"];
            opacity?: AllPaintProperties["icon-opacity"];
        }[] = [];

        /** Puts back what the style painted, for a map that keeps its layers after this goes. */
        function restore() {
            for (const { layer, color, opacity } of painted) {
                try {
                    if (!map.getLayer(layer)) continue;
                    if (color !== undefined) map.setPaintProperty(layer, "icon-color", color);
                    if (opacity !== undefined) map.setPaintProperty(layer, "icon-opacity", opacity);
                } catch {
                    // The style has moved on, and took the layer with it.
                }
            }
            painted = [];
        }

        function tint() {
            // Forgotten rather than put back: a style paints its places itself, and writing the
            // colours of the style before it over them is how the wrong grey lands on a dark map.
            painted = [];

            for (const layer of poiLayers(map)) {
                const color = map.getPaintProperty(layer, "icon-color");
                const opacity = map.getPaintProperty(layer, "icon-opacity");
                // Only a plain colour can be composed with: the old function syntax a style may
                // paint with is an object rather than an expression, and cannot stand inside one.
                const tinted = typeof color === "string" ? clickableTint(color) : null;
                const solid = clickableOpacity(opacity);
                if (!tinted && !solid) continue;

                try {
                    if (tinted) map.setPaintProperty(layer, "icon-color", tinted);
                    if (solid) map.setPaintProperty(layer, "icon-opacity", solid);
                    painted.push({
                        layer,
                        color: tinted ? color : undefined,
                        opacity: solid ? opacity : undefined
                    });
                } catch (e) {
                    console.warn("Geo map: could not draw the places that answer a click --", e);
                }
            }
        }

        tint();
        // Switching the style paints its places afresh.
        map.on("style.load", tint);

        return () => {
            map.off("style.load", tint);
            restore();
        };
    }, [ parentMap, styleLoaded ]);

    return null;
}

/**
 * The place a tile feature stands for, or `null` where it is not one worth standing the map on.
 *
 * A place with no name is skipped: what names a marker would be the bare OSM tag, and "Bench" is not
 * what anyone means to keep. The click then falls through to what it meant before.
 */
export function poiFromFeature(feature: MapGeoJSONFeature | undefined): GeoSearchResult | null {
    if (feature?.geometry.type !== "Point") {
        return null;
    }

    const properties = feature.properties ?? {};
    // The styles load their English variant, so a place is named the way the rest of the map is.
    const name = String(properties.name_en || properties.name || "").trim();
    if (!name) {
        return null;
    }

    const [ lng, lat ] = feature.geometry.coordinates;
    const category = POI_TAG_KEYS.find((key) => properties[key]);

    return {
        id: `poi:${feature.id ?? `${lng},${lat}`}`,
        name,
        // A tile carries no address, so the panel has nothing to say under the name (see PlacePanel).
        label: name,
        lat,
        lng,
        icon: placeIcon({ category, type: category ? String(properties[category]) : undefined })
    };
}

/**
 * The layers of the current style that draw places, for hit-testing against.
 *
 * Read off the style each time rather than remembered: the styles name these layers differently, and
 * `queryRenderedFeatures` answers nothing at all — rather than skipping the one it cannot find — if a
 * single named layer is missing.
 */
export function poiLayers(map: MapLibreGLMap) {
    return map.getLayersOrder().filter((id) => map.getLayer(id)?.sourceLayer === POI_SOURCE_LAYER);
}

/**
 * Whether the map has something of its own under the pointer — a marker, a cluster, a track or the
 * pin of a place already in hand. Those stand above the base map and answer for it.
 */
function isOwnUnderPointer(map: MapLibreGLMap, point: MapMouseEvent["point"]) {
    const own = [ MARKER_LAYER, PLACE_LAYER, ...CLUSTER_LAYERS, ...trackHitLayers(map) ]
        .filter((id) => map.getLayer(id));

    return own.length > 0 && map.queryRenderedFeatures(point, { layers: own }).length > 0;
}

/**
 * What a place is drawn in: the colour a picked place is pinned in where it answers a click, and
 * `styleColor` -- what the style painted it -- where it does not.
 *
 * The two conditions are the ones the click itself asks (see the click handler above): the map has
 * to be zoomed in far enough for a place to be picked, and the place has to carry a name.
 *
 * The zoom is asked at the top of the expression rather than beside the name, MapLibre taking
 * `["zoom"]` only as the input of an outermost `step` or `interpolate`. What each zoom is drawn in
 * is where the name is then asked about.
 */
export function clickableTint(styleColor: string): ExpressionSpecification {
    return [
        "step",
        [ "zoom" ],
        styleColor,
        MIN_POI_ZOOM, [ "case", namedPlace(), PLACE_MARKER_COLOR, styleColor ]
    ];
}

/**
 * How solid a place is drawn: what the style asked for, with the places that answer a click brought
 * up to nearly solid at the zooms they can be picked from. `null` where the style asks for something
 * this cannot be read out of, and the layer is then left as it is.
 *
 * The styles paint this with the old function syntax -- `{stops: [[16, 0], [17, 0.4]]}` -- which is
 * an object rather than an expression and so cannot be composed with. It is read and rebuilt as the
 * expression saying the same thing, rather than written out here from what the styles say today: a
 * style is fetched now rather than shipped (see map_layer), and one that lifts its places out of the
 * background on its own should not be argued with about how far.
 */
export function clickableOpacity(styleOpacity: unknown): ExpressionSpecification | null {
    // A flat number has no zoom to it, so the raise is stepped in where the colour is (see
    // `clickableTint`) rather than standing at every zoom the style draws its places at.
    if (typeof styleOpacity === "number") {
        return [
            "step",
            [ "zoom" ],
            styleOpacity,
            MIN_POI_ZOOM, [ "case", namedPlace(), CLICKABLE_OPACITY, styleOpacity ]
        ];
    }

    const ramp = readRamp(styleOpacity);
    if (!ramp) {
        return null;
    }

    const { stops, interpolation } = ramp;
    const raised: (number | ExpressionSpecification)[][] = stops.map(([ zoom, value ]) => [
        zoom,
        zoom >= MIN_POI_ZOOM ? [ "case", namedPlace(), CLICKABLE_OPACITY, value ] : value
    ]);

    // A ramp that has finished climbing before a place can be picked says nothing about the zooms
    // that matter here, so the raise is added as a stop of its own at the first zoom that does.
    const [ lastZoom, lastValue ] = stops[stops.length - 1];
    if (lastZoom < MIN_POI_ZOOM) {
        raised.push([ MIN_POI_ZOOM, [ "case", namedPlace(), CLICKABLE_OPACITY, lastValue ] ]);
    }

    return [ "interpolate", interpolation, [ "zoom" ], ...raised.flat() ];
}

/** Whether a place carries a name, which is what it would be kept under (see `poiFromFeature`). */
function namedPlace(): ExpressionSpecification {
    return [ "to-boolean", [ "coalesce", [ "get", "name_en" ], [ "get", "name" ] ] ];
}

/**
 * The zoom ramp behind the old function syntax -- its stops and how it reads between them -- or
 * `null` for anything that is not one of numbers.
 */
function readRamp(value: unknown) {
    if (!value || typeof value !== "object" || !("stops" in value)) {
        return null;
    }

    const { stops, base } = value as { stops?: unknown; base?: unknown };
    if (!Array.isArray(stops) || !stops.length) {
        return null;
    }

    const read: [number, number][] = [];
    for (const stop of stops) {
        if (!Array.isArray(stop) || typeof stop[0] !== "number" || typeof stop[1] !== "number") {
            return null;
        }
        read.push([ stop[0], stop[1] ]);
    }

    // A base of one climbs evenly, which is what `linear` says; anything else is the curve the old
    // syntax spells `base`.
    const interpolation: InterpolationSpecification = typeof base === "number" && base !== 1
        ? [ "exponential", base ]
        : [ "linear" ];

    return { stops: read, interpolation };
}

/** The name of a place and the icon it would wear as a marker, as the tooltip shows them. */
function placeLabel(place: GeoSearchResult) {
    const label = document.createElement("span");
    label.className = "place-tooltip-label";

    if (place.icon) {
        const icon = document.createElement("i");
        icon.className = place.icon;
        label.appendChild(icon);
    }

    const name = document.createElement("span");
    // A place is named by whatever OpenStreetMap holds, which is not ours to read as markup.
    name.textContent = place.name;
    label.appendChild(name);

    return label;
}
