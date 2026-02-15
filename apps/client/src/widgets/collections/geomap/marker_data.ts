import { snapdom } from "@zumer/snapdom";
import { MutableRef, useEffect } from "preact/hooks";

import FNote from "../../../entities/fnote";
import { useChildNotes } from "../../react/hooks";
import { LOCATION_ATTRIBUTE } from ".";

const DEFAULT_MARKER_COLOR = "#2A81CB";

// SVG marker pin shape (replaces the Leaflet marker PNG).
export const MARKER_SVG = "foo"; // TODO: Fix

async function buildMarkerIcon(color = DEFAULT_MARKER_COLOR, iconClass: string) {
    const iconUrl = await snapshotIcon(iconClass);
    return `\
<svg width="25" height="41" viewBox="0 0 25 41" xmlns="http://www.w3.org/2000/svg">
<path d="M12.5 0C5.6 0 0 5.6 0 12.5C0 21.9 12.5 41 12.5 41S25 21.9 25 12.5C25 5.6 19.4 0 12.5 0Z" fill="${color}" />
<circle cx="12.5" cy="12.5" r="8" fill="white" />
<image href="${iconUrl}" x="4.5" y="4.5" width="16" height="16" preserveAspectRatio="xMidYMid meet" />
</svg>
    `;
}

async function snapshotIcon(iconClass: string) {
    const wrapper = document.createElement("div");

    wrapper.style.width = "20px";
    wrapper.style.height = "20px";
    wrapper.style.display = "flex";
    wrapper.style.alignItems = "center";
    wrapper.style.justifyContent = "center";

    const iconEl = document.createElement("span");
    iconEl.className = iconClass;
    iconEl.style.fontSize = "20px";
    iconEl.style.lineHeight = "1";
    iconEl.style.display = "inline-block";
    iconEl.style.color = "black";

    wrapper.appendChild(iconEl);

    // Important: attach to DOM
    document.body.appendChild(wrapper);

    const icon = await snapdom(wrapper, {
        backgroundColor: "transparent"
    });

    document.body.removeChild(wrapper);
    return icon.url;
}

export function useMarkerData(note: FNote | null | undefined, apiRef: MutableRef<maplibregl.Map>) {
    const childNotes = useChildNotes(note?.noteId);

    async function refresh() {
        const map = apiRef.current as maplibregl.Map | undefined;
        if (!map) return;

        const iconSvgCache = new Map<string, string>();

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
        document.body.appendChild(img);
    });
}
