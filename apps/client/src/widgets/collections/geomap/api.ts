import type { LatLng, LeafletMouseEvent } from "leaflet";

import FNote from "../../../entities/fnote";
import attributes from "../../../services/attributes";
import { prompt } from "../../../services/dialog";
import { t } from "../../../services/i18n";
import note_create from "../../../services/note_create";
import { LOCATION_ATTRIBUTE } from ".";

const CHILD_NOTE_ICON = "bx bx-pin";

export async function moveMarker(noteId: string, latLng: LatLng | null) {
    const value = latLng ? [latLng.lat, latLng.lng].join(",") : "";
    await attributes.setLabel(noteId, LOCATION_ATTRIBUTE, value);
}

export async function createNewNote(parentNote: FNote, e: LeafletMouseEvent) {
    const title = await prompt({ message: t("relation_map.enter_title_of_new_note"), defaultValue: t("relation_map.default_new_note_title") });

    if (title?.trim()) {
        await note_create.createNote(parentNote.noteId, {
            title,
            content: "",
            type: "text",
            activate: false,
            isProtected: parentNote.isProtected,
            attributes: [
                { type: "label", name: LOCATION_ATTRIBUTE, value: [e.latlng.lat, e.latlng.lng].join(",") },
                { type: "label", name: "iconClass", value: CHILD_NOTE_ICON }
            ]
        });
    }
}
