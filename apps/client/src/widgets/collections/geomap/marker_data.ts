import { MutableRef, useEffect } from "preact/hooks";

import FNote from "../../../entities/fnote";
import { useChildNotes } from "../../react/hooks";
import { LOCATION_ATTRIBUTE } from ".";
import { buildMarkerIcon, svgToImage } from "./marker_renderer";

const DEFAULT_MARKER_COLOR = "#2A81CB";

// SVG marker pin shape (replaces the Leaflet marker PNG).
export const MARKER_SVG = "foo"; // TODO: Fix
const iconSvgCache = new Map<string, string>();

export function useMarkerData(note: FNote | null | undefined, apiRef: MutableRef<maplibregl.Map>) {
    const childNotes = useChildNotes(note?.noteId);

    async function refresh() {
        const map = apiRef.current as maplibregl.Map | undefined;
        if (!map) return;


        async function ensureIcon(color: string, iconClass: string) {
            const key = `marker-${color}-${iconClass}`;

            if (!iconSvgCache.has(key)) {
                const svg = await buildMarkerIcon(color, iconClass);
                iconSvgCache.set(key, svg);
            }

            return key;
        }

        const features: maplibregl.GeoJSONFeature[] = [];
        for (const childNote of childNotes) {
            const location = childNote.getLabelValue(LOCATION_ATTRIBUTE);
            const latLng = location?.split(",", 2).map((el) => parseFloat(el)) as [ number, number ] | undefined;
            if (!latLng) continue;
            latLng.reverse();

            const color = childNote.getLabelValue("color") ?? DEFAULT_MARKER_COLOR;
            features.push({
                type: "Feature",
                geometry: {
                    type: "Point",
                    coordinates: latLng
                },
                properties: {
                    id: childNote.noteId,
                    name: childNote.title,
                    icon: await ensureIcon(color, childNote.getIcon())
                }
            });
        }

        // Build all the icons.
        await Promise.all(iconSvgCache.entries().map(async ([ key, svg ]) => {
            const image = await svgToImage(svg);
            map.addImage(key, image, {
                pixelRatio: window.devicePixelRatio
            });
        }));

        map.addSource("points", {
            type: "geojson",
            data: {
                type: "FeatureCollection",
                features
            }
        });
        map.addLayer({
            id: "points-layer",
            type: "symbol",
            source: "points",
            layout: {
                "icon-image": [ "get", "icon" ],
                "icon-size": 1,
                "icon-anchor": "bottom",
                "icon-allow-overlap": true
            }
        });
    }

    useEffect(() => {
        refresh();
    }, [ apiRef, childNotes ]);
}
