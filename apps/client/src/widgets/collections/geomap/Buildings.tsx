import { type AddLayerObject, type Map as MapLibreGLMap } from "maplibre-gl";
import { useContext, useEffect } from "preact/hooks";

import { ParentMap, useMapPitch } from "./map";

/**
 * The source every built-in vector style draws from, and the only one known to carry the heights
 * below. A map on the raster layer, or on a style named by URL, has no such source and is left flat.
 */
const SHORTBREAD_SOURCE = "versatiles-shortbread";
const BUILDINGS_SOURCE_LAYER = "buildings";
export const BUILDINGS_LAYER = "buildings-3d";

/** Where the tiles begin carrying footprints at all — Shortbread draws them from zoom 14. */
const BUILDINGS_MIN_ZOOM = 14;

/**
 * The height a building whose own is missing is stood up at, in metres — a two-storey house, which
 * is what most of an unsurveyed town turns out to be.
 *
 * Rarely reached: the tiles already fall back to this themselves, and every tile sampled from
 * Manhattan to rural Iowa carried a height on all of its buildings. It is here because the height
 * is an *experimental* extension of the Shortbread schema rather than part of it (see the note on
 * {@link buildingsLayer}), so a build of the tiles without it must not stand every building on the
 * map up to nothing.
 */
const ASSUMED_HEIGHT = 5;

/**
 * The buildings of the map underneath, stood up to the height they are in the world.
 *
 * Only while the view is leaned over. Standing them up on a map looked straight down at buys
 * nothing — a roof seen from above is the footprint the style already draws — and costs the doubled
 * draw of the flat fill this hides plus a per-building extrusion, so a map nobody tilts pays for
 * none of it. It also means the 3D button now changes the map rather than only the angle it is seen
 * from, which is what that button promises.
 */
export default function Buildings({ isDarkTheme }: { isDarkTheme: boolean }) {
    const map = useContext(ParentMap);
    const pitch = useMapPitch(map);
    // However the view was leaned over — the button, or Ctrl and a drag. Before the hook's first
    // report, which follows the very next tick, what the map already says it is.
    const tilted = (pitch ?? map?.getPitch() ?? 0) > 0;

    useEffect(() => {
        if (!map || !tilted) return;

        // A style is a world of its own and switching one takes every layer on the map with it, so
        // this has to run again on each style load rather than only when the view is first leaned
        // over. `keepAdditions` (see map.tsx) does carry this layer across, but it appends what it
        // carries above everything in the incoming style — labels included — and the flat fill it
        // hides belongs to the outgoing style and is not the one that needs hiding now. Installing
        // again settles both.
        const onStyleLoad = () => install(map, isDarkTheme);
        map.on("style.load", onStyleLoad);

        // A map that has been removed has no style, and asking one for a layer is not a no-op but a
        // crash. The map is removed by the component above this one, whose cleanup Preact runs
        // before this one's, so on a note switch this cleanup is always handed a dead map — the
        // same reasoning as in Markers, and the same flag.
        let mapRemoved = false;
        const onMapRemove = () => { mapRemoved = true; };
        map.on("remove", onMapRemove);

        install(map, isDarkTheme);

        return () => {
            map.off("style.load", onStyleLoad);
            map.off("remove", onMapRemove);
            if (mapRemoved) return;
            uninstall(map);
        };
    }, [ map, tilted, isDarkTheme ]);

    return null;
}

/**
 * Puts the layer up and takes the flat one down, on a style that has something to draw from.
 *
 * Removing a layer that is already there rather than leaving it be: it may have been carried over
 * from the last style, in which case it is both in the wrong place in the draw order and painted
 * for the wrong map. Adding it afresh settles both without a separate path for each.
 */
function install(map: MapLibreGLMap, isDarkTheme: boolean) {
    // Taken down before the style is asked whether it has anything to put up, so that what this
    // leaves behind is the same either way: the layer stands only where there is a source under it.
    if (map.getLayer(BUILDINGS_LAYER)) {
        map.removeLayer(BUILDINGS_LAYER);
    }

    if (!map.getSource(SHORTBREAD_SOURCE)) return;
    // Under the style's own labels rather than over them: a place name buried behind a tower reads
    // as a missing label, and every 3D map worth copying puts its names on top. Under the markers
    // too, as a consequence — they are symbol layers added after the style's own.
    map.addLayer(buildingsLayer(isDarkTheme), firstSymbolLayer(map));

    for (const id of flatBuildingLayers(map)) {
        map.setLayoutProperty(id, "visibility", "none");
    }
}

/** Takes the standing buildings back down and gives the flat ones back. */
function uninstall(map: MapLibreGLMap) {
    if (map.getLayer(BUILDINGS_LAYER)) {
        map.removeLayer(BUILDINGS_LAYER);
    }

    for (const id of flatBuildingLayers(map)) {
        map.setLayoutProperty(id, "visibility", "visible");
    }
}

/**
 * The layer that stands the buildings up.
 *
 * `height` and `min_height` are not part of the Shortbread schema the styles are built against —
 * that documents a single `dummy` property and nothing else. They are a VersaTiles extension whose
 * own documentation calls it experimental and reserves the right to rename or drop it without
 * bumping the schema version, which is what the fallback height is for: the layer has to degrade to
 * a townful of two-storey blocks rather than to a flat grey plain should that day come.
 *
 * `min_height` is where a building starts rather than where it stands — the upper half of a tower
 * that widens at the base is a separate footprint beginning where the base ends. Its companion
 * `hide_3d` marks the footprints that such parts are cut out of, which are to be left down: drawn
 * as well, they would stand a solid block in the space the parts describe.
 */
function buildingsLayer(isDarkTheme: boolean): AddLayerObject {
    return {
        id: BUILDINGS_LAYER,
        type: "fill-extrusion",
        source: SHORTBREAD_SOURCE,
        "source-layer": BUILDINGS_SOURCE_LAYER,
        minzoom: BUILDINGS_MIN_ZOOM,
        filter: [ "!=", [ "get", "hide_3d" ], true ],
        paint: {
            // Darker than it looks: MapLibre lights the walls, so the colour asked for is the
            // shadowed side rather than the one that ends up on screen.
            "fill-extrusion-color": isDarkTheme ? "#1b2027" : "#d8d3cc",
            "fill-extrusion-height": [ "coalesce", [ "get", "height" ], ASSUMED_HEIGHT ],
            "fill-extrusion-base": [ "coalesce", [ "get", "min_height" ], 0 ],
            // Faded in across the zoom the footprints arrive at, as the flat fill this replaces is
            // (see the styles' own `building` layer): buildings appearing all at once at a zoom
            // boundary reads as the map glitching rather than as detail arriving.
            "fill-extrusion-opacity": [
                "interpolate", [ "linear" ], [ "zoom" ],
                BUILDINGS_MIN_ZOOM, 0,
                BUILDINGS_MIN_ZOOM + 1, 1
            ]
            // `fill-extrusion-vertical-gradient` is left at its default of true, which shades the
            // walls down their height and is what keeps a block of flats from reading as a slab of
            // one flat colour.
        }
    };
}

/**
 * The style's own flat drawing of the same footprints, which the standing ones replace.
 *
 * Found by what they draw rather than by name: the five built-in styles do not agree on how many
 * such layers they have — four carry an outline beneath the fill and one does not — and a style
 * named by URL is not ours to know the names in at all.
 */
function flatBuildingLayers(map: MapLibreGLMap): string[] {
    return map.getStyle().layers
        .filter((layer) => "source-layer" in layer
            && layer["source-layer"] === BUILDINGS_SOURCE_LAYER
            && layer.type === "fill")
        .map((layer) => layer.id);
}

/**
 * What the buildings are to stand under: the first thing the style draws text or an icon with.
 *
 * Undefined where the style draws neither, which MapLibre reads as the top of the map — the right
 * answer for a style with no labels to be buried behind.
 */
function firstSymbolLayer(map: MapLibreGLMap): string | undefined {
    return map.getStyle().layers.find((layer) => layer.type === "symbol")?.id;
}
