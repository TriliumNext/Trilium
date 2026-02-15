import { MutableRef, useEffect } from "preact/hooks";

import FNote from "../../../entities/fnote";
import { useChildNotes } from "../../react/hooks";
import { LOCATION_ATTRIBUTE } from ".";

const DEFAULT_MARKER_COLOR = "#2A81CB";

// SVG marker pin shape (replaces the Leaflet marker PNG).
export const MARKER_SVG = buildMarkerIcon();

function buildMarkerIcon(color = DEFAULT_MARKER_COLOR) {
    return `\
<svg width="25" height="41" viewBox="0 0 25 41" xmlns="http://www.w3.org/2000/svg">
<path d="M12.5 0C5.6 0 0 5.6 0 12.5C0 21.9 12.5 41 12.5 41S25 21.9 25 12.5C25 5.6 19.4 0 12.5 0Z" fill="${color}" />
<circle cx="12.5" cy="12.5" r="8" fill="white" />
</svg>
    `;
}

export function useMarkerData(note: FNote | null | undefined, apiRef: MutableRef<maplibregl.Map>) {
    const childNotes = useChildNotes(note?.noteId);

    async function refresh() {
        const map = apiRef.current as maplibregl.Map | undefined;
        if (!map) return;

        const iconSvgCache = new Map<string, string>();

        function ensureIcon(color: string) {
            const key = `marker-${color}`;

            if (!iconSvgCache.has(key)) {
                const svg = buildMarkerIcon(color);
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
                    icon: ensureIcon(color)
                }
            });
        }

        // Build all the icons.
        await Promise.all(iconSvgCache.entries().map(async ([ key, svg ]) => {
            const image = await svgToImage(svg);
            map.addImage(key, image);
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

function svgToImage(svgString){
    return new Promise<HTMLImageElement>(resolve => {
        const svgBlob = new Blob([svgString], { type: "image/svg+xml" });
        const url = URL.createObjectURL(svgBlob);

        const img = new Image();

        img.onload = () => {
            URL.revokeObjectURL(url);
            resolve(img);
        };

        img.src = url;
    });
}
