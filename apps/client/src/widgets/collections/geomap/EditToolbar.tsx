import "./EditToolbar.css";

import { useContext } from "preact/hooks";

import { t } from "../../../services/i18n";
import OverlayControlGroup, { OverlayControlButton } from "../../react/OverlayControlGroup";
import { ParentMap } from "./map";

interface EditToolbarProps {
    /** The map may not be edited, which is every one of these buttons refused at once. */
    isReadOnly: boolean;
    /** The map is armed for the next click to place a new note, which the button wears as held
     *  down (see `active` on {@link OverlayControlButton}). */
    placing: boolean;
    /** Arms the map for a note to be placed, or stands it down again — the visible counterpart of
     *  the Escape the instruction toast offers (see index.tsx). */
    onTogglePlacement: () => void;
    /** Asks for a GPX file and brings it onto the map (see `addGpxTrack` in index.tsx). */
    onAddGpxTrack: () => void;
}

/**
 * The editing actions, standing in the middle of the map's foot on an {@link OverlayControlGroup} of
 * their own — the surface every group over this map stands on: adding a marker and bringing in a GPX
 * track today, with room along the row for whatever editing the map comes to offer next.
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

    // No group over a map that could not be drawn (see the WebGL fallback in map.tsx).
    if (!map) return null;

    return (
        <OverlayControlGroup className="geo-edit-toolbar" placement="bottom-center" overCanvas>
            {/* The pin a note dropped on the map wears (see GEO_MARKER_ICON in commons) — the
                button shows the very thing it drops, which is also the ghost that will follow the
                pointer once armed. The words beside it are what names the button; the tooltip says
                at more length what it does. */}
            <OverlayControlButton
                title={placing ? t("geo-map.create-child-note-cancel") : t("geo-map.create-child-note-title")}
                icon="bx-pin"
                text={placing ? t("geo-map.add-marker-cancel") : t("geo-map.add-marker")}
                className="geo-add-marker-button"
                active={placing}
                disabled={isReadOnly}
                onClick={onTogglePlacement}
            />
            <OverlayControlButton
                title={t("geo-map.add-gpx-track")}
                icon="bx-trip"
                disabled={isReadOnly}
                onClick={onAddGpxTrack}
            />
        </OverlayControlGroup>
    );
}
