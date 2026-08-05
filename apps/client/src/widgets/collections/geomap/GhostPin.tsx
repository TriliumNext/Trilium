import "./GhostPin.css";

import type { MapMouseEvent } from "maplibre-gl";
import { useContext, useEffect, useRef } from "preact/hooks";

import FNote from "../../../entities/fnote";
import { CHILD_NOTE_ICON } from "./api";
import { ParentMap } from "./map";
import { DEFAULT_MARKER_COLOR, drawMarkerImage } from "./Markers";

/**
 * The pin that rides under the pointer while the map is armed for placement, so the click is
 * preceded by a picture of what it will do: the crosshair says a place is wanted, and this says
 * what will stand on it.
 *
 * Drawn with the very image the symbol layer would stamp there (see {@link drawMarkerImage}) — the
 * note's own colour and icon for a marker being moved, the pin a new note is given for one being
 * created — and translucent, so it reads as an offer rather than as a marker already standing.
 *
 * Positioned by hand off the map's `mousemove` rather than as a MapLibre marker: the ghost follows
 * the pointer, not a coordinate, so there is no lngLat for a marker to be held at.
 */
export default function GhostPin({ note }: {
    /** The note being moved, whose pin the ghost wears — or none, for a note yet to be created. */
    note?: FNote;
}) {
    const map = useContext(ParentMap);
    const elementRef = useRef<HTMLDivElement>(null);

    const color = note?.getLabelValue("color") ?? DEFAULT_MARKER_COLOR;
    const iconClass = note?.getIcon() ?? CHILD_NOTE_ICON;

    // The pin image, drawn fresh rather than through the layer's cache: the cache keeps one <img>
    // element per look, and an element can only stand in one place — two maps split side by side,
    // both armed at once, would steal it from each other's ghost.
    useEffect(() => {
        const element = elementRef.current;
        if (!element) return;

        let cancelled = false;
        drawMarkerImage(color, iconClass).then((image) => {
            if (!cancelled && image) {
                element.replaceChildren(image);
            }
        });
        return () => { cancelled = true; };
    }, [ color, iconClass ]);

    // Following the pointer. Written straight onto the element rather than through state, so a
    // pointer being waved across the map is a style write per event and not a render per event.
    useEffect(() => {
        const element = elementRef.current;
        if (!map || !element) return;

        // Hidden until the pointer says where it is: the map does not remember where it last was,
        // so until the first move there is nowhere honest to draw the ghost.
        const follow = (e: MapMouseEvent) => {
            element.style.transform = `translate(${e.point.x}px, ${e.point.y}px)`;
            element.classList.add("visible");
        };
        // Gone with the pointer — which also covers it resting on the toolbar, since reaching
        // anything standing over the canvas is leaving the canvas.
        const hide = () => element.classList.remove("visible");

        map.on("mousemove", follow);
        map.on("mouseout", hide);
        return () => {
            map.off("mousemove", follow);
            map.off("mouseout", hide);
        };
    }, [ map ]);

    return <div ref={elementRef} className="geo-ghost-pin" aria-hidden="true" />;
}
