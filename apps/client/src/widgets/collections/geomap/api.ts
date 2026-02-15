import type { GeoMouseEvent } from "./map";
import { LOCATION_ATTRIBUTE } from ".";
import attributes from "../../../services/attributes";
import { prompt } from "../../../services/dialog";
import server from "../../../services/server";
import { t } from "../../../services/i18n";
import { CreateChildrenResponse } from "@triliumnext/commons";

const CHILD_NOTE_ICON = "bx bx-pin";

export async function moveMarker(noteId: string, latLng: { lat: number; lng: number } | null) {
    const value = latLng ? [latLng.lat, latLng.lng].join(",") : "";
    await attributes.setLabel(noteId, LOCATION_ATTRIBUTE, value);
}

export async function createNewNote(noteId: string, e: GeoMouseEvent) {
    const title = await prompt({ message: t("relation_map.enter_title_of_new_note"), defaultValue: t("relation_map.default_new_note_title") });

    if (title?.trim()) {
        const { note } = await server.post<CreateChildrenResponse>(`notes/${noteId}/children?target=into`, {
            title,
            content: "",
            type: "text"
        });
        attributes.setLabel(note.noteId, "iconClass", CHILD_NOTE_ICON);
        moveMarker(note.noteId, e.latlng);
    }
}
