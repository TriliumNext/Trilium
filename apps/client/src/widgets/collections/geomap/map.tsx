import "maplibre-gl/dist/maplibre-gl.css";

import { Map as MapLibreGLMap, MapMouseEvent, NavigationControl, type Point, ScaleControl, StyleSpecification } from "maplibre-gl";
import { ComponentChildren, createContext, RefObject } from "preact";
import { useEffect, useImperativeHandle, useState } from "preact/hooks";

import { useElementSize, useSyncedRef } from "../../react/hooks";
import { MapLayer } from "./map_layer";

export interface GeoMouseEvent {
    latlng: { lat: number; lng: number };
    originalEvent: MouseEvent;
    point: Point;
}

export const ParentMap = createContext<MapLibreGLMap | null>(null);

interface MapProps {
    apiRef?: RefObject<MapLibreGLMap | null>;
    containerRef?: RefObject<HTMLDivElement>;
    coordinates: { lat: number; lng: number } | [number, number];
    zoom: number;
    layerData: MapLayer;
    viewportChanged: (coordinates: { lat: number; lng: number }, zoom: number) => void;
    children: ComponentChildren;
    onClick?: (e: GeoMouseEvent) => void;
    onContextMenu?: (e: GeoMouseEvent) => void;
    onZoom?: () => void;
    scale: boolean;
}

export function toMapLibreEvent(e: MapMouseEvent): GeoMouseEvent {
    return {
        latlng: { lat: e.lngLat.lat, lng: e.lngLat.lng },
        originalEvent: e.originalEvent,
        point: e.point
    };
}

export default function Map({ coordinates, zoom, layerData, viewportChanged, children, onClick, onContextMenu, scale, apiRef, containerRef: _containerRef, onZoom }: MapProps) {
    const [ map, setMap ] = useState<MapLibreGLMap | null>(null);
    const containerRef = useSyncedRef<HTMLDivElement>(_containerRef);

    useImperativeHandle(apiRef ?? null, () => map);

    // Initialize the map.
    useEffect(() => {
        if (!containerRef.current) return;

        let style: StyleSpecification | string;

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

        const mapInstance = new MapLibreGLMap({
            container: containerRef.current,
            style,
            center,
            zoom,
            minZoom: 1,
            renderWorldCopies: false
        });

        // Add navigation buttons.
        mapInstance.addControl(new NavigationControl({
            showCompass: false,
            showZoom: true
        }), "top-left");

        setMap(mapInstance);

        // Load async vector style if needed.
        if (layerData.type === "vector" && typeof layerData.style !== "string") {
            layerData.style().then(asyncStyle => {
                mapInstance.setStyle(asyncStyle as StyleSpecification);
            });
        }

        return () => {
            mapInstance.remove();
            setMap(null);
        };
    }, []);

    // React to layer changes.
    useEffect(() => {
        if (!map) return;

        if (layerData.type === "vector") {
            if (typeof layerData.style === "string") {
                map.setStyle(layerData.style);
            } else {
                layerData.style().then(asyncStyle => {
                    map.setStyle(asyncStyle as StyleSpecification);
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
    }, [ map, layerData ]);

    // React to coordinate changes.
    useEffect(() => {
        if (!map) return;
        const center = Array.isArray(coordinates)
            ? [coordinates[1], coordinates[0]] as [number, number]
            : [coordinates.lng, coordinates.lat] as [number, number];

        map.setCenter(center);
        map.setZoom(zoom);
    }, [ map, coordinates, zoom ]);

    // Viewport callback.
    useEffect(() => {
        if (!map) return;

        const updateFn = () => {
            const center = map.getCenter();
            viewportChanged({ lat: center.lat, lng: center.lng }, map.getZoom());
        };
        map.on("moveend", updateFn);

        return () => {
            map.off("moveend", updateFn);
        };
    }, [ map, viewportChanged ]);

    useEffect(() => {
        if (!onClick || !map) return;

        const handler = (e: MapMouseEvent) => onClick(toMapLibreEvent(e));
        map.on("click", handler);
        return () => { map.off("click", handler); };
    }, [ map, onClick ]);

    useEffect(() => {
        if (!onZoom || !map) return;

        map.on("zoom", onZoom);
        return () => { map.off("zoom", onZoom); };
    }, [ map, onZoom ]);

    // Scale
    useEffect(() => {
        if (!scale || !map) return;
        const scaleControl = new ScaleControl();
        map.addControl(scaleControl);
        return () => { map.removeControl(scaleControl); };
    }, [ map, scale ]);

    // Adapt to container size changes.
    const size = useElementSize(containerRef);
    useEffect(() => {
        map?.resize();
    }, [ map, size?.width, size?.height ]);

    return (
        <div
            ref={containerRef}
            className={`geo-map-container ${layerData.isDarkTheme ? "dark" : ""}`}
        >
            <ParentMap.Provider value={map}>
                {children}
            </ParentMap.Provider>
        </div>
    );
}
