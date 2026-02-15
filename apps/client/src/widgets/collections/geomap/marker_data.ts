import { MutableRef, useEffect } from "preact/hooks";

import FNote from "../../../entities/fnote";
import { useChildNotes } from "../../react/hooks";
import { LOCATION_ATTRIBUTE } from ".";

// SVG marker pin shape (replaces the Leaflet marker PNG).
export const MARKER_SVG = `<svg width="25" height="41" viewBox="0 0 25 41" xmlns="http://www.w3.org/2000/svg">` +
    `<path d="M12.5 0C5.6 0 0 5.6 0 12.5C0 21.9 12.5 41 12.5 41S25 21.9 25 12.5C25 5.6 19.4 0 12.5 0Z" fill="#2A81CB" />` +
    `<circle cx="12.5" cy="12.5" r="8" fill="white" />` +
    `</svg>`;

export function useMarkerData(note: FNote | null | undefined, apiRef: MutableRef<maplibregl.Map>) {
    const childNotes = useChildNotes(note?.noteId);

    useEffect(() => {
        const map = apiRef.current as maplibregl.Map | undefined;
        if (!map) return;

        svgToImage(MARKER_SVG, (img) => {
            map.addImage("custom-marker", img, {
                pixelRatio: window.devicePixelRatio
            });
        });

        const features: maplibregl.GeoJSONFeature[] = [];
        for (const childNote of childNotes) {
            const location = childNote.getLabelValue(LOCATION_ATTRIBUTE);
            const latLng = location?.split(",", 2).map((el) => parseFloat(el)) as [ number, number ] | undefined;
            if (!latLng) continue;
            latLng.reverse();

            features.push({
                type: "Feature",
                geometry: {
                    type: "Point",
                    coordinates: latLng
                },
                properties: {
                    id: childNote.noteId,
                    name: childNote.title,
                }
            });
        }

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
                "icon-image": "custom-marker",
                "icon-size": 1,
                "icon-anchor": "bottom",
                "icon-allow-overlap": true
            }
        });

        return () => {
            map.removeLayer("points-layer");
            map.removeSource("points");
        };
    }, [ apiRef, childNotes ]);
}

function svgToImage(svgString, callback) {
    const svgBlob = new Blob([svgString], { type: "image/svg+xml" });
    const url = URL.createObjectURL(svgBlob);

    const img = new Image();

    img.onload = () => {
        URL.revokeObjectURL(url);
        callback(img);
    };

    img.src = url;
}
