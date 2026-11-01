import "./GhostPin.css";

import { GEO_MARKER_ICON } from "@triliumnext/commons";
import type { MapMouseEvent } from "maplibre-gl";
import { useContext, useEffect, useRef } from "preact/hooks";

import FNote from "../../../entities/fnote";
import { MARKER_NOTE_TYPE } from "./api";
import { ParentMap } from "./map";
import { DEFAULT_MARKER_COLOR, drawMarkerImage } from "./Markers";

/**
 * The pin that rides under the pointer while the map is armed for placement, so the click is
 * preceded by a picture of what it will do: the crosshair says a place is wanted, and this says
 * what will stand on it.
 *
 * Drawn with the very image the symbol layer would stamp there (see {@link drawMarkerImage}) and
 * translucent, so it reads as an offer rather than as a marker already standing.
 *
 * A marker being moved wears its own colour and icon. One being created wears what the map would
 * give it — a `#child:iconClass`, a template, an inheritable label (see
 * {@link FNote.getLabelValueForNewChild}) — and the pin a located note is drawn under otherwise,
 * so a map that dresses its markers offers the marker it will actually drop.
 *
 * Positioned by hand off the map's `mousemove` rather than as a MapLibre marker: the ghost follows
 * the pointer, not a coordinate, so there is no lngLat for a marker to be held at.
 */
export default function GhostPin({ note, parentNote }: {
    /** The note being moved, whose pin the ghost wears — or none, for a note yet to be created. */
    note?: FNote;
    /** The map, which a note yet to be created takes its look from. */
    parentNote: FNote;
}) {
    const map = useContext(ParentMap);
    const elementRef = useRef<HTMLDivElement>(null);

    const color = note?.getLabelValue("color")
        ?? parentNote.getLabelValueForNewChild("color", MARKER_NOTE_TYPE)
        ?? DEFAULT_MARKER_COLOR;
    const iconClass = note?.getIcon()
        ?? parentNote.getLabelValueForNewChild("iconClass", MARKER_NOTE_TYPE)
        ?? GEO_MARKER_ICON;

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
