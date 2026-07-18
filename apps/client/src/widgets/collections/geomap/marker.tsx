import { useContext, useEffect } from "preact/hooks";
import { ParentMap } from "./map";
import L, { DivIcon, GPXOptions, Icon, LatLng, Marker as LeafletMarker, LeafletMouseEvent, marker, MarkerOptions } from "leaflet";
import "leaflet-gpx";

export interface MarkerProps {
    coordinates: [ number, number ];
    icon?: Icon | DivIcon;
    onClick?: () => void;
    onMouseDown?: (e: MouseEvent) => void;
    onDragged?: ((newCoordinates: LatLng) => void);
    onContextMenu: (e: LeafletMouseEvent) => void;
    draggable?: boolean;
}

export default function Marker({ coordinates, icon, draggable, onClick, onDragged, onMouseDown, onContextMenu }: MarkerProps) {
    const parentMap = useContext(ParentMap);

    useEffect(() => {
        if (!parentMap) return;

        const options: MarkerOptions = { icon };
        if (draggable) {
            options.draggable = true;
            options.autoPan = true;
            options.autoPanSpeed = 5;
        }

        const newMarker = marker(coordinates, options);

        if (onClick) {
            newMarker.on("click", () => onClick());
        }

        if (onMouseDown) {
            newMarker.on("mousedown", e => onMouseDown(e.originalEvent));
        }

        if (onDragged) {
            newMarker.on("moveend", e => {
                const coordinates = (e.target as LeafletMarker).getLatLng();
                onDragged(coordinates);
            });
        }

        if (onContextMenu) {
            newMarker.on("contextmenu", e => onContextMenu(e))
        }

        newMarker.addTo(parentMap);

        return () => newMarker.removeFrom(parentMap);
    }, [ parentMap, coordinates, onMouseDown, onDragged, icon ]);

    return (<div />)
}

export function GpxTrack({ gpxXmlString, options }: { gpxXmlString: string, options: GPXOptions }) {
    const parentMap = useContext(ParentMap);

    useEffect(() => {
        if (!parentMap) return;

        // Use the runtime-augmented `L.GPX` (added by the `leaflet-gpx` side-effect import)
        // rather than a named `{ GPX }` import: in production the Rollup CJS→ESM interop binds
        // named imports to a static facade that never reflects leaflet-gpx's runtime mutation,
        // so `new GPX()` throws "GPX is not a constructor". `L` is leaflet's real export object,
        // which leaflet-gpx actually patches. See TriliumNext/Trilium#10236.
        const track = new L.GPX(gpxXmlString, options);
        track.addTo(parentMap);

        return () => track.removeFrom(parentMap);
    }, [ parentMap, gpxXmlString, options ]);

    return <div />;
}
