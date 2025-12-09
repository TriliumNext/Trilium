import { useEffect, useImperativeHandle, useRef, useState } from "preact/hooks";
import L, { control, LatLng, Layer, LeafletMouseEvent } from "leaflet";
import "leaflet/dist/leaflet.css";
import { MAP_LAYERS } from "./map_layer";
import { ComponentChildren, createContext, RefObject } from "preact";
import { useElementSize, useSyncedRef } from "../../react/hooks";

export const ParentMap = createContext<L.Map | null>(null);

interface MapProps {
    apiRef?: RefObject<L.Map | null>;
    containerRef?: RefObject<HTMLDivElement>;
    coordinates: LatLng | [number, number];
    zoom: number;
    layerName: string;
    viewportChanged: (coordinates: LatLng, zoom: number) => void;
    children: ComponentChildren;
    onClick?: (e: LeafletMouseEvent) => void;
    onContextMenu?: (e: LeafletMouseEvent) => void;
    onZoom?: () => void;
    scale: boolean;
}

export default function Map({ coordinates, zoom, layerName, viewportChanged, children, onClick, onContextMenu, scale, apiRef, containerRef: _containerRef, onZoom }: MapProps) {
    const mapRef = useRef<L.Map>(null);
    const containerRef = useSyncedRef<HTMLDivElement>(_containerRef);

    useImperativeHandle(apiRef ?? null, () => mapRef.current);

    useEffect(() => {
        if (!containerRef.current) return;
        const mapInstance = L.map(containerRef.current, {
            worldCopyJump: false,
            maxBounds: [
                [-90, -180],
                [90, 180]
            ],
            minZoom: 2
        });

        mapRef.current = mapInstance;
        return () => {
            mapInstance.off();
            mapInstance.remove();
        };
    }, []);

    // Load the layer asynchronously.
    const [ layer, setLayer ] = useState<Layer>();
    useEffect(() => {
        async function load() {
            const layerData = MAP_LAYERS[layerName];

            if (layerData.type === "vector") {
                const style = (typeof layerData.style === "string" ? layerData.style : await layerData.style());
                await import("@maplibre/maplibre-gl-leaflet");

                setLayer(L.maplibreGL({
                    style: style as any
                }));
            } else {
                setLayer(L.tileLayer(layerData.url, {
                    attribution: layerData.attribution,
                    detectRetina: true,
                    noWrap: true
                }));
            }
        }

        load();
    }, [ layerName ]);

    // Attach layer to the map.
    useEffect(() => {
        const map = mapRef.current;
        const layerToAdd = layer;
        if (!map || !layerToAdd) return;
        layerToAdd.addTo(map);
        return () => layerToAdd.removeFrom(map);
    }, [ mapRef, layer ]);

    // React to coordinate changes.
    useEffect(() => {
        if (!mapRef.current) return;
        mapRef.current.setView(coordinates, zoom);
    }, [ mapRef, coordinates, zoom ]);

    // Viewport callback.
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;

        const updateFn = () => viewportChanged(map.getBounds().getCenter(), map.getZoom());
        map.on("moveend", updateFn);
        map.on("zoomend", updateFn);

        return () => {
            map.off("moveend", updateFn);
            map.off("zoomend", updateFn);
        };
    }, [ mapRef, viewportChanged ]);

    useEffect(() => {
        if (onClick && mapRef.current) {
            mapRef.current.on("click", onClick);
            return () => mapRef.current?.off("click", onClick);
        }
    }, [ mapRef, onClick ]);

    useEffect(() => {
        if (onContextMenu && mapRef.current) {
            mapRef.current.on("contextmenu", onContextMenu);
            return () => mapRef.current?.off("contextmenu", onContextMenu);
        }
    }, [ mapRef, onContextMenu ]);

    useEffect(() => {
        if (onZoom && mapRef.current) {
            mapRef.current.on("zoom", onZoom);
            return () => mapRef.current?.off("zoom", onZoom);
        }
    }, [ mapRef, onZoom ]);

    // Scale
    useEffect(() => {
        const map = mapRef.current;
        if (!scale || !map) return;
        const scaleControl  = control.scale();
        scaleControl.addTo(map);
        return () => scaleControl.remove();
    }, [ mapRef, scale ]);

    // Adapt to container size changes.
    const size = useElementSize(containerRef);
    useEffect(() => {
        mapRef.current?.invalidateSize();
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
