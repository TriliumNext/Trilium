import "maplibre-gl/dist/maplibre-gl.css";

import maplibregl from "maplibre-gl";
import { ComponentChildren, createContext, RefObject } from "preact";
import { useEffect, useImperativeHandle, useRef } from "preact/hooks";

import { useElementSize, useSyncedRef } from "../../react/hooks";
import { MAP_LAYERS } from "./map_layer";

export interface GeoMouseEvent {
    latlng: { lat: number; lng: number };
    originalEvent: MouseEvent;
}

export const ParentMap = createContext<maplibregl.Map | null>(null);

interface MapProps {
    apiRef?: RefObject<maplibregl.Map | null>;
    containerRef?: RefObject<HTMLDivElement>;
    coordinates: { lat: number; lng: number } | [number, number];
    zoom: number;
    layerName: string;
    viewportChanged: (coordinates: { lat: number; lng: number }, zoom: number) => void;
    children: ComponentChildren;
    onClick?: (e: GeoMouseEvent) => void;
    onContextMenu?: (e: GeoMouseEvent) => void;
    onZoom?: () => void;
    scale: boolean;
}

function toMapLibreEvent(e: maplibregl.MapMouseEvent): GeoMouseEvent {
    return {
        latlng: { lat: e.lngLat.lat, lng: e.lngLat.lng },
        originalEvent: e.originalEvent
    };
}

export default function Map({ coordinates, zoom, layerName, viewportChanged, children, onClick, onContextMenu, scale, apiRef, containerRef: _containerRef, onZoom }: MapProps) {
    const mapRef = useRef<maplibregl.Map>(null);
    const containerRef = useSyncedRef<HTMLDivElement>(_containerRef);

    useImperativeHandle(apiRef ?? null, () => mapRef.current);

    // Initialize the map.
    useEffect(() => {
        if (!containerRef.current) return;

        const layerData = MAP_LAYERS[layerName];
        let style: maplibregl.StyleSpecification | string;

        if (layerData.type === "vector") {
            style = typeof layerData.style === "string"
                ? layerData.style
                : layerData.styleFallback;
        } else {
            style = {
                version: 8,
                sources: {
                    "raster-tiles": {
                        type: "raster",
                        tiles: [layerData.url],
                        tileSize: 256,
                        attribution: layerData.attribution
                    }
                },
                layers: [
                    {
                        id: "raster-layer",
                        type: "raster",
                        source: "raster-tiles"
                    }
                ]
            };
        }

        const center = Array.isArray(coordinates)
            ? [coordinates[1], coordinates[0]] as [number, number]
            : [coordinates.lng, coordinates.lat] as [number, number];

        const mapInstance = new maplibregl.Map({
            container: containerRef.current,
            style,
            center,
            zoom,
            minZoom: 1,
            renderWorldCopies: false
        });

        mapRef.current = mapInstance;

        // Load async vector style if needed.
        if (layerData.type === "vector" && typeof layerData.style !== "string") {
            layerData.style().then(asyncStyle => {
                mapInstance.setStyle(asyncStyle as maplibregl.StyleSpecification);
            });
        }

        return () => {
            mapInstance.remove();
            mapRef.current = null;
        };
    }, []);

    // React to layer changes.
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;

        const layerData = MAP_LAYERS[layerName];
        if (layerData.type === "vector") {
            if (typeof layerData.style === "string") {
                map.setStyle(layerData.style);
            } else {
                layerData.style().then(asyncStyle => {
                    map.setStyle(asyncStyle as maplibregl.StyleSpecification);
                });
            }
        } else {
            map.setStyle({
                version: 8,
                sources: {
                    "raster-tiles": {
                        type: "raster",
                        tiles: [layerData.url],
                        tileSize: 256,
                        attribution: layerData.attribution
                    }
                },
                layers: [
                    {
                        id: "raster-layer",
                        type: "raster",
                        source: "raster-tiles"
                    }
                ]
            });
        }
    }, [ layerName ]);

    // React to coordinate changes.
    useEffect(() => {
        if (!mapRef.current) return;

        const center = Array.isArray(coordinates)
            ? [coordinates[1], coordinates[0]] as [number, number]
            : [coordinates.lng, coordinates.lat] as [number, number];

        mapRef.current.setCenter(center);
        mapRef.current.setZoom(zoom);
    }, [ coordinates, zoom ]);

    // Viewport callback.
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;

        const updateFn = () => {
            const center = map.getCenter();
            viewportChanged({ lat: center.lat, lng: center.lng }, map.getZoom());
        };
        map.on("moveend", updateFn);

        return () => {
            map.off("moveend", updateFn);
        };
    }, [ viewportChanged ]);

    useEffect(() => {
        const map = mapRef.current;
        if (!onClick || !map) return;

        const handler = (e: maplibregl.MapMouseEvent) => onClick(toMapLibreEvent(e));
        map.on("click", handler);
        return () => { map.off("click", handler); };
    }, [ onClick ]);

    useEffect(() => {
        const map = mapRef.current;
        if (!onContextMenu || !map) return;

        const handler = (e: maplibregl.MapMouseEvent) => {
            e.preventDefault();
            onContextMenu(toMapLibreEvent(e));
        };
        map.on("contextmenu", handler);
        return () => { map.off("contextmenu", handler); };
    }, [ onContextMenu ]);

    useEffect(() => {
        const map = mapRef.current;
        if (!onZoom || !map) return;

        map.on("zoom", onZoom);
        return () => { map.off("zoom", onZoom); };
    }, [ onZoom ]);

    // Scale
    useEffect(() => {
        const map = mapRef.current;
        if (!scale || !map) return;
        const scaleControl = new maplibregl.ScaleControl();
        map.addControl(scaleControl);
        return () => { map.removeControl(scaleControl); };
    }, [ scale ]);

    // Adapt to container size changes.
    const size = useElementSize(containerRef);
    useEffect(() => {
        mapRef.current?.resize();
    }, [ size?.width, size?.height ]);

    return (
        <div
            ref={containerRef}
            className={`geo-map-container ${MAP_LAYERS[layerName].isDarkTheme ? "dark" : ""}`}
        >
            <ParentMap.Provider value={mapRef.current}>
                {children}
            </ParentMap.Provider>
        </div>
    );
}
