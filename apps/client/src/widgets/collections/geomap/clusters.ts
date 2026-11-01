import { AddLayerObject, type FilterSpecification, type GeoJSONSource, type GeoJSONSourceSpecification, type Map as MapLibreGLMap, type MapGeoJSONFeature, type MapMouseEvent } from "maplibre-gl";
import { useEffect } from "preact/hooks";

export const CLUSTER_LAYER = "clusters-layer";
export const CLUSTER_COUNT_LAYER = "cluster-count-layer";

/** Both layers a clustered source needs, in the order they have to come off the map. */
export const CLUSTER_LAYERS = [ CLUSTER_LAYER, CLUSTER_COUNT_LAYER ];

/**
 * What makes a source gather the notes that are drawn too near one another.
 *
 * Spread into the source rather than kept here as a source of its own: the groups and the notes they
 * are made of have to come out of the same data, so this is a property of the markers' source and
 * not something that can stand beside it.
 */
export const CLUSTER_SOURCE_OPTIONS = {
    cluster: true,
    /**
     * How near two notes have to be, on screen, before they are drawn as one.
     *
     * Tighter than MapLibre's own default of 50, which swallowed notes that were nowhere near each
     * other and made the map look as though it were losing them as it zoomed. Obsidian's Map View,
     * the closest thing to a reference for this, settles at 25 — worth going further still if a
     * bubble ever feels like it is standing for notes that plainly belong apart.
     */
    clusterRadius: 35,
    /** The zoom past which notes are always drawn one by one, however crowded they are. */
    clusterMaxZoom: 14
} satisfies Partial<GeoJSONSourceSpecification>;

/**
 * The filter a layer drawing notes one by one has to carry.
 *
 * A clustered source hands its groups out through the same source as the notes it left alone, and a
 * group carries none of a note's properties — no icon to stamp, no title to place. A layer that
 * draws every feature therefore draws nothing at all for a group, which is what made crowded notes
 * read as vanishing rather than as being gathered up.
 */
export const UNCLUSTERED_ONLY: FilterSpecification = [ "!", [ "has", "point_count" ] ];

/** Its opposite, for the layers that draw the groups themselves. */
const CLUSTERED_ONLY: FilterSpecification = [ "has", "point_count" ];

/** What an uncoloured pin is filled with, which a bubble starts from so the two read as a family. */
const BASE_COLOR = "#2A81CB";

/**
 * The bubble a group of notes is drawn as, growing and deepening with how many it stands for.
 *
 * Unlike a title, it is not painted per theme: a saturated fill inside a pale ring carries its own
 * contrast, and reads over a dark map as well as over a light one. The steps are what tell a pair of
 * notes from a hundred at a glance — a bubble of one size for every group would say only "more than
 * one here", which the map already says by drawing a bubble at all.
 */
const CLUSTER_PAINT = {
    "circle-color": [ "step", [ "get", "point_count" ], BASE_COLOR, 10, "#1B5E96", 50, "#10426B" ],
    "circle-radius": [ "step", [ "get", "point_count" ], 15, 10, 20, 50, 26 ],
    "circle-stroke-width": 2,
    "circle-stroke-color": "rgba(255, 255, 255, 0.9)"
} satisfies Extract<AddLayerObject, { type: "circle" }>["paint"];

/**
 * Puts the bubbles and their counts on the map, above whatever draws the notes themselves.
 *
 * Called from the same place the markers are installed rather than from a component of its own: a
 * layer cannot be added before the source it draws from, and that source is put up asynchronously,
 * once the markers have been built and the style has loaded. A second component listening for the
 * same style load would be racing that one for which of them ran first.
 */
export function installClusterLayers(map: MapLibreGLMap, source: string) {
    // Above the pins: a bubble stands for several notes and a pin for one, so where the two overlap
    // it is the pin that should give way.
    if (!map.getLayer(CLUSTER_LAYER)) {
        map.addLayer({
            id: CLUSTER_LAYER,
            type: "circle",
            source,
            filter: CLUSTERED_ONLY,
            paint: CLUSTER_PAINT
        });
    }

    if (!map.getLayer(CLUSTER_COUNT_LAYER)) {
        map.addLayer({
            id: CLUSTER_COUNT_LAYER,
            type: "symbol",
            source,
            filter: CLUSTERED_ONLY,
            layout: {
                // Abbreviated rather than exact: past a few hundred the digits outgrow the bubble,
                // and "1.2k" is as much as the number is being read for anyway.
                "text-field": [ "get", "point_count_abbreviated" ],
                "text-font": [ "Open Sans Regular" ],
                "text-size": 12,
                // The count is the only thing a bubble says, so it is never allowed to lose a
                // placement contest against a neighbouring title — a bubble drawn without its number
                // is a blob that means nothing. It takes no part in placement either, so it cannot
                // push a title off the map in turn.
                "text-allow-overlap": true,
                "text-ignore-placement": true
            },
            paint: {
                "text-color": "#fff",
                // The smallest bubbles are the palest, and white on that blue alone is thin at this
                // size. Haloed the way a title is, so the count is legible on every step of the ramp
                // rather than only on the deep ones.
                "text-halo-color": "rgba(0, 0, 0, 0.25)",
                "text-halo-width": 1
            }
        });
    }
}

/**
 * Opening a group, which is the only thing that can be done to one.
 *
 * Without this a bubble is a dead pixel: the notes it stands for cannot be hovered, opened or
 * right-clicked while they are inside it, so the only way at them would be to guess how far to zoom
 * in. Safe to call before the layers are up — MapLibre keeps a listener for a layer that does not
 * exist yet and starts delivering to it once one does.
 *
 * @param enabled whether this map gathers its notes at all, and whether a bubble is this map's to act
 *                on for the moment. A map that gathers nothing has no bubbles to click, and one armed
 *                for placement has a click that belongs to the placement — zooming into the group as
 *                well would both put the marker down and step in on top of it. Either way the cursor
 *                is left to whatever else on the map wants to set it.
 */
export function useClusterExpansion(map: MapLibreGLMap | null, source: string, enabled: boolean) {
    useEffect(() => {
        if (!map || !enabled) return;

        async function onClick(e: MapMouseEvent & { features?: MapGeoJSONFeature[] }) {
            const feature = e.features?.[0];
            const clusterSource = map?.getSource<GeoJSONSource>(source);
            if (!feature || !clusterSource || feature.geometry.type !== "Point") return;

            // The zoom at which this particular group comes apart, which only the source knows —
            // stepping in by a fixed amount would either overshoot a loose group or leave a tight
            // one still gathered, and a click that visibly does nothing reads as a broken map.
            const zoom = await clusterSource.getClusterExpansionZoom(feature.properties.cluster_id);
            map?.easeTo({ center: feature.geometry.coordinates as [number, number], zoom });
        }

        // A bubble is a thing to be clicked, and says so before it is.
        function onEnter() {
            if (map) map.getCanvas().style.cursor = "pointer";
        }
        function onLeave() {
            if (map) map.getCanvas().style.cursor = "";
        }

        map.on("click", CLUSTER_LAYER, onClick);
        map.on("mouseenter", CLUSTER_LAYER, onEnter);
        map.on("mouseleave", CLUSTER_LAYER, onLeave);

        return () => {
            map.off("click", CLUSTER_LAYER, onClick);
            map.off("mouseenter", CLUSTER_LAYER, onEnter);
            map.off("mouseleave", CLUSTER_LAYER, onLeave);
            // The pointer is put back by hand, as it is for the markers (see `useMarkerOpening`): a
            // cursor set on the canvas is an inline style and outranks any rule, so a pointer left
            // behind here would sit over the crosshair the map wears while it waits to be told a
            // place — and the `mouseleave` that would have cleared it is no longer listened for.
            onLeave();
        };
    }, [ map, source, enabled ]);
}
