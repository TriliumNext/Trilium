import { AttributeRow } from "@triliumnext/commons";

import FNote, { type NoteType } from "../../../entities/fnote";
import attributes from "../../../services/attributes";
import dialog from "../../../services/dialog";
import { t } from "../../../services/i18n";
import note_create from "../../../services/note_create";
import { deleteNoteOrBranch } from "../../../services/note_deletion";
import { GPX_MIME } from "./GpxTrack";
import type { GeoMouseEvent } from "./map";
import { LOCATION_ATTRIBUTE } from "./Markers";

/** The type a note put on the map is created as, and so what a template handed to it must match. */
export const MARKER_NOTE_TYPE: NoteType = "text";

export async function moveMarker(noteId: string, latLng: { lat: number; lng: number } | null) {
    const value = latLng ? [latLng.lat, latLng.lng].join(",") : "";
    await attributes.setLabel(noteId, LOCATION_ATTRIBUTE, value);
}

/**
 * Takes a note off the map, having asked first, and offers to delete it while it is at it.
 *
 * The offer is the point. A marker put down by mistake used to leave a note behind that the map no
 * longer showed and the reader had to go hunting for in the tree — taking a note off the map and
 * getting rid of it are different wishes, and only one of them was granted. What deleting would
 * actually cost is the dialog's to work out and to say (see confirmDeleteNoteBoxWithNote); all this
 * has to know is which branch the map holds the note by.
 *
 * A track is the exception, and is deleted or left alone: its line is drawn from the note's own file
 * rather than from a location written on it, so there is no taking it off the map and keeping it —
 * the note is the track. That is also why it is not offered under the same name (see ContextMenus).
 */
export async function removeFromMap(note: FNote, mapNote: FNote) {
    const isTrack = note.mime === GPX_MIME;
    // The map's own branch for the note, which is how a note the map merely shows — cloned in from
    // elsewhere, and clone-able out again — is told from one that lives here and nowhere else.
    const branchId = note.parentToBranch[mapNote.noteId] ?? null;

    const result = await dialog.confirmDeleteNoteBoxWithNote(
        note.title,
        { noteId: note.noteId, branchId },
        {
            message: t(isTrack ? "geo-map-context.delete-note-confirmation" : "geo-map-context.remove-from-map-confirmation",
                { title: note.title }),
            mustDeleteNote: isTrack
        }
    );

    if (typeof result !== "object" || !result.confirmed) {
        return;
    }

    if (result.isDeleteNoteChecked) {
        await deleteNoteOrBranch(note.noteId, branchId);
    } else {
        await moveMarker(note.noteId, null);
    }
}

/**
 * Brings a GPX file onto the map as a child note, and hands the note back.
 *
 * Created directly rather than sent through the import pipeline: an import's success is announced
 * app-wide and navigates the active tab to what it made, which here would carry the user off the
 * very map the track was added to. The note a track lives in is simple enough to make in place — a
 * file note whose content is the file's text.
 *
 * The mime is pinned to what the map draws tracks by (see NoteGpxTrackWrapper in index.tsx) rather
 * than read off the file: a browser reports no type at all for a `.gpx`, and an import that guessed
 * wrong left the user hunting the File-type field for why their track never appeared — the user
 * guide has a step for exactly that.
 */
export async function importGpxTrack(parentNote: FNote, file: File) {
    const { note } = await note_create.createNote(parentNote.noteId, {
        // Without its extension, as an imported file is titled (see getNoteTitle in core). The whole
        // name is kept on the label below.
        title: file.name.replace(/\.gpx$/i, ""),
        content: await file.text(),
        type: "file",
        mime: "application/gpx+xml",
        activate: false,
        isProtected: parentNote.isProtected,
        attributes: [
            { type: "label", name: "originalFileName", value: file.name }
        ]
    });

    return note;
}

/**
 * Creates a note where the click landed, and hands it back for the pane to open on.
 *
 * No title is asked for first. A modal between the click and the note was the wrong way round: it
 * blocked the map to ask for the one thing the detail pane is made for editing. The note is created
 * unnamed instead, and the caller opens the pane on it with the name it was given selected —
 * naming the place is typing over it (see index.tsx).
 */
export async function createNewNote(parentNote: FNote, e: GeoMouseEvent) {
    return createNoteAt(parentNote, [ e.latlng.lat, e.latlng.lng ]);
}

/**
 * Turns a place into a note of the map's own, named as the place is named.
 *
 * Unlike a note dropped by clicking the map, this one usually arrives with a name worth keeping, so
 * the detail pane opens on it as it stands rather than with the title picked out to be typed over
 * (see `isNew` in DetailPane).
 *
 * A place named only by where it stands is the exception: a point read out of the search bar is
 * called by its own coordinates, which is no title for a note. It takes the name a placed marker
 * takes instead, and the pane opens on it the same way (see `keepPlaceAsMarker` in index).
 */
export async function createNoteForPlace(parentNote: FNote, place: PlaceToKeep) {
    const title = place.unnamed ? undefined : place.name;

    return createNoteAt(parentNote, [ place.lat, place.lng ], title, place.icon);
}

/** What keeping a place as a marker needs of it: where it stands, what to call it there, and what
 *  kind of place it is. */
interface PlaceToKeep {
    name: string;
    lat: number;
    lng: number;
    unnamed?: boolean;
    /**
     * The boxicons class the place is drawn under, as `GeoSearchResult.icon` gives it. Absent where
     * neither the geocoder nor the tile says what kind of place it is.
     */
    icon?: string;
}

/**
 * Creates a located note under the map.
 *
 * A note with no name of its own is created without one rather than under a name of the map's
 * choosing, which is what leaves the naming to the server: an unnamed note takes the name every
 * new note takes — the one the tree's + button gives — and a map labelled `#titleTemplate` names
 * its markers by that instead.
 *
 * `icon` is what the place is already drawn under — a cart for a supermarket, a flag for a country
 * (see placeIcon in osm_icons) — so the marker keeps the icon the panel offered it under. A note
 * dropped by clicking the map has no such place behind it and is given no icon at all:
 * `getNoteIcon` draws a note carrying a location as a pin, which leaves an icon the map hands down
 * through `#child:iconClass` or a template to apply instead.
 */
async function createNoteAt(
    parentNote: FNote, [ lat, lng ]: [number, number], title?: string, icon?: string) {
    const noteAttributes: Omit<AttributeRow, "noteId" | "attributeId">[] = [
        { type: "label", name: LOCATION_ATTRIBUTE, value: [ lat, lng ].join(",") }
    ];
    if (icon) {
        noteAttributes.push({ type: "label", name: "iconClass", value: icon });
    }

    const { note } = await note_create.createNote(parentNote.noteId, {
        title,
        content: "",
        type: MARKER_NOTE_TYPE,
        activate: false,
        isProtected: parentNote.isProtected,
        attributes: noteAttributes
    });

    return note;
}
