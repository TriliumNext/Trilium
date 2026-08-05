import "./EditToolbar.css";

import { useContext, useRef } from "preact/hooks";

import { t } from "../../../services/i18n";
import { useStaticTooltip } from "../../react/hooks";
import { ParentMap } from "./map";

interface EditToolbarProps {
    /** The map may not be edited, which is every one of these buttons refused at once. */
    isReadOnly: boolean;
    /** The map is armed for the next click to place a new note, which the button wears as held
     *  down (see the overlay buttons' active styling in theme-next/forms.css). */
    placing: boolean;
    /** Arms the map for a note to be placed, or stands it down again — the visible counterpart of
     *  the Escape the instruction toast offers (see index.tsx). */
    onTogglePlacement: () => void;
    /** Asks for a GPX file and brings it onto the map (see `addGpxTrack` in index.tsx). */
    onAddGpxTrack: () => void;
}

/**
 * The editing actions, standing in the middle of the map's foot on a control group of their own
 * (`tn-overlay-control-group`, the surface every group over this map stands on): adding a marker and
 * bringing in a GPX track today, with room along the row for whatever editing the map comes to offer
 * next.
 *
 * A group of its own rather than more buttons on {@link MapToolbar}: that one is the camera — how
 * close in the map is drawn, how much screen it gets — and what changes the map is another kind of
 * thing. The middle of the foot is the stretch left free, the corners being spoken for: the scale
 * and the attribution lead, the camera group trails, and the detail pane holds the trailing edge.
 *
 * Adding a marker is the one thing a collection map is for, so the + carries its name in words
 * rather than standing as a bare glyph — and while the map is armed, the words say what a second
 * press does. It stands on the map rather than in the collection bar above it because the map alone
 * is what goes fullscreen (see MapToolbar): the collection bar stays behind, and while the button
 * lived there, a fullscreen map could only be added to through its right-click menu.
 */
export default function EditToolbar({ isReadOnly, placing, onTogglePlacement, onAddGpxTrack }: EditToolbarProps) {
    const map = useContext(ParentMap);
    const addMarkerRef = useRef<HTMLButtonElement>(null);
    const gpxRef = useRef<HTMLButtonElement>(null);

    // Standing at the foot of the map, the tooltips open away from that edge, where they would
    // otherwise fall off.
    useStaticTooltip(addMarkerRef, {
        title: placing ? t("geo-map.create-child-note-cancel") : t("geo-map.create-child-note-title"),
        placement: "top"
    });
    useStaticTooltip(gpxRef, { title: t("geo-map.add-gpx-track"), placement: "top" });

    // No group over a map that could not be drawn (see the WebGL fallback in map.tsx).
    if (!map) return null;

    return (
        <div
            className="geo-edit-toolbar tn-overlay-control-group"
            /* Keep a press on the controls from reaching the canvas underneath, which would
               otherwise take it for the start of a drag. */
            onMouseDown={(e) => e.stopPropagation()}
        >
            <button
                ref={addMarkerRef}
                type="button"
                className={`tn-overlay-text-button geo-add-marker-button ${placing ? "active" : ""}`}
                disabled={isReadOnly}
                onClick={onTogglePlacement}
            >
                {/* The pin a note dropped on the map wears (see CHILD_NOTE_ICON in api.ts) — the
                    button shows the very thing it drops, which is also the ghost that will follow
                    the pointer once armed. A child rather than a class on the button: the boxicons
                    class sets the icon font on whatever wears it, and the words beside it are to
                    stay words. */}
                <span className="bx bx-pin" aria-hidden="true"></span>
                {placing ? t("geo-map.add-marker-cancel") : t("geo-map.add-marker")}
            </button>
            <button
                ref={gpxRef}
                type="button"
                className="tn-overlay-icon-button bx bx-trip"
                aria-label={t("geo-map.add-gpx-track")}
                disabled={isReadOnly}
                onClick={onAddGpxTrack}
            />
        </div>
    );
}
