import "./MapToolbar.css";

import { t } from "../../../services/i18n";
import OverlayControlGroup, { OverlayControlButton, ZoomControls } from "../../react/OverlayControlGroup";

/** What the buttons ask for, which is what the map itself answers (see `useMapZoom` in RelationMap.tsx). */
export type MapCommand = "relationMapResetZoomIn" | "relationMapResetZoomOut" | "relationMapResetPanZoom" | "relationMapFitToView";

interface MapToolbarProps {
    /** The scale the map is drawn at, and whether each zoom step has room left. */
    zoom: { scale: number; canZoomIn: boolean; canZoomOut: boolean };
    onCommand: (command: MapCommand) => void;
}

/**
 * The controls standing in the corner of a relation map: how close in it is drawn, and the way back
 * to where it started.
 *
 * They stand on the {@link OverlayControlGroup} the image viewer's zoom buttons stand on (see
 * {@link ImageViewer}), as the other two maps' controls and the diagram preview's do, in place of the
 * three buttons that floated above the note. The readout between the steps says the scale the way
 * those do — a hundred being the map drawn at its own size — and pressed, takes the map back there
 * and to the corner it started in, which is what the button wearing a crop mark did.
 *
 * What the three do is asked for as commands rather than done here — the same commands a script can
 * trigger (`api.triggerCommand`), which is why they outlive the floating buttons that were the other
 * caller. The map itself is only read from: for the scale to show, and for the ends of its range,
 * which is what leaves a step with nothing left to give disabled.
 */
export default function MapToolbar({ zoom, onCommand }: MapToolbarProps) {
    return (
        <OverlayControlGroup className="relation-map-toolbar" placement="bottom-end">
            <ZoomControls
                percent={zoom.scale * 100}
                canZoomIn={zoom.canZoomIn}
                canZoomOut={zoom.canZoomOut}
                onZoomIn={() => onCommand("relationMapResetZoomIn")}
                onZoomOut={() => onCommand("relationMapResetZoomOut")}
                onReset={() => onCommand("relationMapResetPanZoom")}
            />
            <OverlayControlButton
                title={t("relation_map.fit_to_view")}
                icon="bx-scan"
                onClick={() => onCommand("relationMapFitToView")}
            />
        </OverlayControlGroup>
    );
}

interface EditToolbarProps {
    /** The map may not be edited, which is every one of these buttons refused at once. */
    isReadOnly: boolean;
    /** Whether the map is in placement mode. The button is shown as pressed while it is. */
    placing: boolean;
    /** Turns placement mode on or off (see `useNotePlacement` in RelationMap.tsx). */
    onTogglePlacement: () => void;
}

/**
 * The editing actions, standing in the middle of the map's foot on a group of their own — adding a
 * note today, with room along the row for whatever editing the map comes to offer next.
 *
 * A group of its own rather than more buttons on {@link MapToolbar}, as on the geo map: that one is
 * the camera — how close in the map is drawn and where it stands — and what changes the map is
 * another kind of thing. The middle of the foot is where the geo map's editing stands too, and it
 * keeps the two apart at any width: a group pinned to the corner opposite would meet the camera on a
 * narrow pane. Beside it in this module rather than in one of its own, as the mind map's two bars
 * are: a group of one button is not a file's worth, and the two are read together.
 *
 * Adding a note is the one thing this map is edited by, so the button carries its name in words
 * rather than standing as a bare glyph, as the geo map's does. It wears the mark a note wears — the
 * very thing a press drops on the map, as the geo map's + wears the pin it drops — rather than the
 * folder-and-plus it wore among the floating buttons: a folder is what a note wearing no mark of
 * its own is drawn as once it has children (see `getNoteIcon` in commons), which is neither what this
 * makes nor what lands on the map. The adding is said by the words beside it, there being no
 * note-and-plus in the icon set, and that leaves the mark unlike the + of the zoom step opposite.
 *
 * It stands on the map rather than in the note's own bar of actions, where it was: what it starts is
 * finished by a click on the map, so it belongs beside the canvas that answers it. In placement mode
 * the button is shown as pressed, and pressing it again turns placement mode off.
 */
export function EditToolbar({ isReadOnly, placing, onTogglePlacement }: EditToolbarProps) {
    return (
        <OverlayControlGroup className="relation-map-edit-toolbar" placement="bottom-center">
            <OverlayControlButton
                title={placing ? t("relation_map_buttons.create_child_note_cancel_title") : t("relation_map_buttons.create_child_note_title")}
                icon="bx-note"
                text={placing ? t("relation_map_buttons.create_child_note_cancel_text") : t("relation_map_buttons.create_child_note_text")}
                className="relation-map-add-note-button"
                disabled={isReadOnly}
                active={placing}
                onClick={onTogglePlacement}
            />
        </OverlayControlGroup>
    );
}

