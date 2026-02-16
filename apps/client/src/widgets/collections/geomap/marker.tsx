import { Marker as MapLibreMarker } from "maplibre-gl";
import { useContext, useEffect, useRef } from "preact/hooks";

import { GeoMouseEvent,ParentMap } from "./map";

export interface MarkerProps {
    coordinates: [ number, number ];
    iconHtml?: string;
    iconSize?: [number, number];
    iconAnchor?: [number, number];
    onClick?: () => void;
    onMouseDown?: (e: MouseEvent) => void;
    onDragged?: ((newCoordinates: { lat: number; lng: number }) => void);
    onContextMenu: (e: GeoMouseEvent) => void;
    draggable?: boolean;
}

export default function Marker({ coordinates, iconHtml, iconSize, iconAnchor, draggable, onClick, onDragged, onMouseDown, onContextMenu }: MarkerProps) {
    const parentMap = useContext(ParentMap);
    const markerRef = useRef<MapLibreMarker>(null);

    useEffect(() => {
        if (!parentMap) return;

        const el = document.createElement("div");
        el.className = "geo-marker";
        if (iconHtml) {
            el.innerHTML = iconHtml;
        }
        if (iconSize) {
            el.style.width = `${iconSize[0]}px`;
            el.style.height = `${iconSize[1]}px`;
        }

        const newMarker = new MapLibreMarker({
            element: el,
            draggable: !!draggable,
            anchor: "bottom"
        })
            .setLngLat([coordinates[1], coordinates[0]])
            .addTo(parentMap);

        markerRef.current = newMarker;

        if (onClick) {
            el.addEventListener("click", (e) => {
                e.stopPropagation();
                onClick();
            });
        }

        if (onMouseDown) {
            el.addEventListener("mousedown", (e) => {
                if (e.button === 1) {
                    e.stopPropagation();
                    onMouseDown(e);
                }
            });
        }

        if (onDragged) {
            newMarker.on("dragend", () => {
                const lngLat = newMarker.getLngLat();
                onDragged({ lat: lngLat.lat, lng: lngLat.lng });
            });
        }

        if (onContextMenu) {
            el.addEventListener("contextmenu", (e) => {
                e.stopPropagation();
                e.preventDefault();
                const lngLat = newMarker.getLngLat();
                onContextMenu({
                    latlng: { lat: lngLat.lat, lng: lngLat.lng },
                    originalEvent: e
                });
            });
        }

        return () => {
            newMarker.remove();
            markerRef.current = null;
        };
    }, [ parentMap, coordinates, onMouseDown, onDragged, iconHtml ]);

    return (<div />);
}

export interface GpxTrackProps {
    gpxXmlString: string;
    trackColor?: string;
    startIconHtml?: string;
    endIconHtml?: string;
    waypointIconHtml?: string;
}

export function GpxTrack({ gpxXmlString, trackColor, startIconHtml, endIconHtml, waypointIconHtml }: GpxTrackProps) {
    const parentMap = useContext(ParentMap);

    useEffect(() => {
        if (!parentMap) return;

        const markers: MapLibreMarker[] = [];
        const sourceId = `gpx-source-${Math.random().toString(36).slice(2)}`;
        const layerId = `gpx-layer-${sourceId}`;

        function addGpxToMap() {
            const parser = new DOMParser();
            const gpxDoc = parser.parseFromString(gpxXmlString, "application/xml");

            // Parse tracks.
            const coordinates: [number, number][] = [];
            const trackPoints = gpxDoc.querySelectorAll("trkpt, rtept");
            for (const pt of trackPoints) {
                const lat = parseFloat(pt.getAttribute("lat") ?? "0");
                const lon = parseFloat(pt.getAttribute("lon") ?? "0");
                coordinates.push([lon, lat]);
            }

            // Add GeoJSON line for the track.
            if (coordinates.length > 0) {
                parentMap.addSource(sourceId, {
                    type: "geojson",
                    data: {
                        type: "Feature",
                        properties: {},
                        geometry: {
                            type: "LineString",
                            coordinates
                        }
                    }
                });

                parentMap.addLayer({
                    id: layerId,
                    type: "line",
                    source: sourceId,
                    paint: {
                        "line-color": trackColor ?? "blue",
                        "line-width": 3
                    }
                });

                // Start marker
                if (startIconHtml) {
                    const startEl = document.createElement("div");
                    startEl.className = "geo-marker";
                    startEl.innerHTML = startIconHtml;
                    const startMarker = new MapLibreMarker({ element: startEl, anchor: "bottom" })
                        .setLngLat(coordinates[0])
                        .addTo(parentMap);
                    markers.push(startMarker);
                }

                // End marker
                if (endIconHtml && coordinates.length > 1) {
                    const endEl = document.createElement("div");
                    endEl.className = "geo-marker";
                    endEl.innerHTML = endIconHtml;
                    const endMarker = new MapLibreMarker({ element: endEl, anchor: "bottom" })
                        .setLngLat(coordinates[coordinates.length - 1])
                        .addTo(parentMap);
                    markers.push(endMarker);
                }
            }

            // Parse waypoints.
            const waypoints = gpxDoc.querySelectorAll("wpt");
            for (const wpt of waypoints) {
                const lat = parseFloat(wpt.getAttribute("lat") ?? "0");
                const lon = parseFloat(wpt.getAttribute("lon") ?? "0");
                if (waypointIconHtml) {
                    const wptEl = document.createElement("div");
                    wptEl.className = "geo-marker";
                    wptEl.innerHTML = waypointIconHtml;
                    const wptMarker = new MapLibreMarker({ element: wptEl, anchor: "bottom" })
                        .setLngLat([lon, lat])
                        .addTo(parentMap);
                    markers.push(wptMarker);
                }
            }
        }

        if (parentMap.isStyleLoaded()) {
            addGpxToMap();
        } else {
            parentMap.once("style.load", addGpxToMap);
        }

        return () => {
            for (const m of markers) {
                m.remove();
            }
            try {
                if (parentMap.getLayer(layerId)) {
                    parentMap.removeLayer(layerId);
                }
                if (parentMap.getSource(sourceId)) {
                    parentMap.removeSource(sourceId);
                }
            } catch {
                // Map may be already removed.
            }
        };
    }, [ parentMap, gpxXmlString, trackColor, startIconHtml, endIconHtml, waypointIconHtml ]);

    return <div />;
}
