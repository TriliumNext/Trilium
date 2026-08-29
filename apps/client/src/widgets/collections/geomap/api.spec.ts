/**
 * What the geo map writes when something is put on it or taken off it (see api.ts): the note a
 * placement click creates, the note a searched place is kept as, the note a GPX file is brought in
 * as, and what becomes of a marker the reader is done with. All go through the ordinary note
 * services; what is checked here is what they are asked for.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import attributes from "../../../services/attributes";
import dialog from "../../../services/dialog";
import note_create from "../../../services/note_create";
import { deleteNoteOrBranch } from "../../../services/note_deletion";
import { buildNote } from "../../../test/easy-froca";
import { createNewNote, createNoteForPlace, importGpxTrack, moveMarker, removeFromMap } from "./api";

vi.mock("../../../services/note_create", () => ({
    default: { createNote: vi.fn(async () => ({ note: { noteId: "created" }, branch: null })) }
}));

vi.mock("../../../services/attributes", () => ({ default: { setLabel: vi.fn(async () => {}) } }));
vi.mock("../../../services/note_deletion", () => ({ deleteNoteOrBranch: vi.fn(async () => {}) }));
vi.mock("../../../services/dialog", () => ({
    default: { confirmDeleteNoteBoxWithNote: vi.fn() }
}));

const createNote = vi.mocked(note_create.createNote);
const setLabel = vi.mocked(attributes.setLabel);
const confirmDelete = vi.mocked(dialog.confirmDeleteNoteBoxWithNote);

// What each of these asks for is what is checked, so what an earlier one asked for is noise.
beforeEach(() => vi.clearAllMocks());

describe("geo map api", () => {
    it("leaves a placed note to be named as any new note is, where the click landed", async () => {
        const parent = buildNote({ title: "The map" });

        const created = await createNewNote(parent, {
            latlng: { lat: 48.85, lng: 2.36 },
            originalEvent: new MouseEvent("click"),
            point: { x: 0, y: 0 } as never
        });

        // Handed back for the pane to open on (see createNoteAt in index.tsx).
        expect(created).toEqual({ noteId: "created" });
        expect(createNote).toHaveBeenCalledWith(parent.noteId, expect.objectContaining({
            type: "text",
            // No name is sent, which is what leaves the naming where every other new note's is: the
            // server's, and so a `#titleTemplate` on the map's if it carries one.
            title: undefined,
            // Nothing is asked first — the name is typed over in the pane, not answered in a modal.
            activate: false,
            // The location and nothing else. No icon is written onto the marker: getNoteIcon draws
            // a note carrying a location as a pin, so an icon the map hands down through
            // `#child:iconClass` or a template is what the marker wears instead.
            attributes: [
                { type: "label", name: "geolocation", value: "48.85,2.36" }
            ]
        }));
    });

    it("names a note for a searched place as the place is named, and stands it there", async () => {
        const parent = buildNote({ title: "The map" });

        const created = await createNoteForPlace(
            parent, { name: "Jumbo", lat: 45.796, lng: 24.147, icon: "bx bx-cart" });

        expect(created).toEqual({ noteId: "created" });
        expect(createNote).toHaveBeenCalledWith(parent.noteId, expect.objectContaining({
            // Named already, unlike a note dropped by clicking: the geocoder named the place.
            title: "Jumbo",
            type: "text",
            activate: false,
            attributes: expect.arrayContaining([
                { type: "label", name: "geolocation", value: "45.796,24.147" },
                // The kind of place it is, which is what the panel offered it under (see
                // PlacePanel): a supermarket kept as a marker stays a supermarket.
                { type: "label", name: "iconClass", value: "bx bx-cart" }
            ])
        }));
    });

    it("writes no icon for a place of no stated kind, which leaves it drawn as a pin", async () => {
        const parent = buildNote({ title: "The map" });

        // Neither the geocoder nor the tile said what kind of place it is (see placeIcon), so there
        // is nothing to keep the marker under and getNoteIcon draws it as a pin.
        await createNoteForPlace(parent, { name: "Somewhere", lat: 45.796, lng: 24.147 });

        expect(createNote).toHaveBeenCalledWith(parent.noteId, expect.objectContaining({
            attributes: [
                { type: "label", name: "geolocation", value: "45.796,24.147" }
            ]
        }));
    });

    it("leaves a note kept from a bare point to be named as a placed one is", async () => {
        const parent = buildNote({ title: "The map" });

        // A point read out of the search bar is called by its own coordinates, which is no title.
        const created = await createNoteForPlace(
            parent, { name: "45.796, 24.147", lat: 45.796, lng: 24.147, unnamed: true });

        expect(created).toEqual({ noteId: "created" });
        expect(createNote).toHaveBeenCalledWith(parent.noteId, expect.objectContaining({
            title: undefined,
            attributes: expect.arrayContaining([
                { type: "label", name: "geolocation", value: "45.796,24.147" }
            ])
        }));
    });

    it("brings a GPX file in as a file note the map draws tracks by", async () => {
        const parent = buildNote({ title: "The map" });
        const file = new File([ "<gpx><trk/></gpx>" ], "sunday-ride.gpx");

        const created = await importGpxTrack(parent, file);

        expect(created).toEqual({ noteId: "created" });
        expect(createNote).toHaveBeenCalledWith(parent.noteId, expect.objectContaining({
            // Titled without the extension, as an imported file is; the whole name stays on the label.
            title: "sunday-ride",
            content: "<gpx><trk/></gpx>",
            type: "file",
            // Pinned rather than read off the file: a browser reports no type for a .gpx, and this
            // is the one mime the map recognises a track by (see NoteGpxTrackWrapper).
            mime: "application/gpx+xml",
            activate: false,
            attributes: [ { type: "label", name: "originalFileName", value: "sunday-ride.gpx" } ]
        }));
    });

    it("writes a marker's location, and empties it to take the marker off the map", async () => {
        await moveMarker("note1", { lat: 45.796, lng: 24.147 });
        expect(setLabel).toHaveBeenLastCalledWith("note1", "geolocation", "45.796,24.147");

        // An empty value is what leaves the note in place with no marker standing for it.
        await moveMarker("note1", null);
        expect(setLabel).toHaveBeenLastCalledWith("note1", "geolocation", "");
    });

    describe("taking a marker off the map", () => {
        it("deletes the note where that is what the reader agreed to", async () => {
            const map = buildNote({ title: "The map" });
            const note = buildNote({ title: "A place" });
            confirmDelete.mockResolvedValue({ confirmed: true, isDeleteNoteChecked: true });

            await removeFromMap(note, map);

            expect(deleteNoteOrBranch).toHaveBeenCalledWith(note.noteId, null);
            expect(setLabel).not.toHaveBeenCalledWith(note.noteId, "geolocation", "");
        });

        it("keeps the note and clears its location where the reader only wanted it off the map", async () => {
            const map = buildNote({ title: "The map" });
            const note = buildNote({ title: "A place" });
            confirmDelete.mockResolvedValue({ confirmed: true, isDeleteNoteChecked: false });

            await removeFromMap(note, map);

            expect(setLabel).toHaveBeenLastCalledWith(note.noteId, "geolocation", "");
        });

        it("leaves the marker alone where the reader changed their mind", async () => {
            const map = buildNote({ title: "The map" });
            const note = buildNote({ title: "A place" });
            confirmDelete.mockResolvedValue({ confirmed: false, isDeleteNoteChecked: false });

            await removeFromMap(note, map);

            expect(deleteNoteOrBranch).not.toHaveBeenCalled();
            expect(setLabel).not.toHaveBeenCalled();
        });
    });
});
