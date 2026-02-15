import { MutableRef, useEffect } from "preact/hooks";

import FNote from "../../../entities/fnote";
import { useChildNotes } from "../../react/hooks";
import { LOCATION_ATTRIBUTE } from ".";

const DEFAULT_MARKER_COLOR = "#2A81CB";

// SVG marker pin shape (replaces the Leaflet marker PNG).
export const MARKER_SVG = "foo"; // TODO: Fix

async function buildMarkerIcon(color = DEFAULT_MARKER_COLOR, iconClass: string, scale = window.devicePixelRatio || 1) {
    const iconUrl = await snapshotIcon(iconClass, 16 * scale);
    return `\
<svg width="${25 * scale}" height="${41 * scale}" viewBox="0 0 25 41" xmlns="http://www.w3.org/2000/svg">
<path d="M12.5 0C5.6 0 0 5.6 0 12.5C0 21.9 12.5 41 12.5 41S25 21.9 25 12.5C25 5.6 19.4 0 12.5 0Z" fill="${color}" />
<circle cx="12.5" cy="12.5" r="8" fill="white" />
<image href="${iconUrl}" x="4.5" y="4.5" width="16" height="16" preserveAspectRatio="xMidYMid meet" />
</svg>
    `;
}

async function snapshotIcon(iconClass: string, size: number) {
    await document.fonts.ready;
    const glyph = getGlyphFromClass(iconClass);
    const rendered = renderMarkerCanvas({
        color: "black",
        glyph,
        size
    });
    return rendered?.toDataURL();
}

function renderMarkerCanvas({
    color,
    glyph,   // e.g. "\uf123"
    size = 32,
    scale = window.devicePixelRatio || 1
}) {
    const canvas = document.createElement("canvas");

    // High-DPI canvas
    canvas.width = size * scale;
    canvas.height = size * scale;

    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    // Scale for retina
    ctx.scale(scale, scale);

    ctx.clearRect(0, 0, size, size);

    // Set font
    ctx.font = `${size}px ${glyph.fontFamily}`;
    ctx.fillStyle = color;

    // Measure glyph
    const metrics = ctx.measureText(glyph.content);

    const glyphWidth =
    metrics.actualBoundingBoxLeft +
    metrics.actualBoundingBoxRight;

    const glyphHeight =
    metrics.actualBoundingBoxAscent +
    metrics.actualBoundingBoxDescent;

    // Center position
    const x = (size - glyphWidth) / 2 + metrics.actualBoundingBoxLeft;
    const y = (size - glyphHeight) / 2 + metrics.actualBoundingBoxAscent;

    // Draw
    ctx.fillText(glyph.content, x, y);

    return canvas;
}

function getGlyphFromClass(iconClass: string) {
    const el = document.createElement("span");
    el.className = iconClass;

    document.body.appendChild(el);

    const style = window.getComputedStyle(el, "::before");
    const content = style.getPropertyValue("content");
    const fontFamily = style.getPropertyValue("font-family");

    document.body.removeChild(el);

    if (!content || content === "none") {
        return null;
    }

    // content is usually quoted like: '"\f123"'
    return {
        fontFamily,
        content: content.replace(/^["']|["']$/g, "")
    };
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
