/**
 * What the geo map writes when something is put on it (see api.ts): the note a placement click
 * creates, and the note a GPX file is brought in as. Both go through the ordinary note-creation
 * service; what is checked here is what they ask it for.
 */
import { describe, expect, it, vi } from "vitest";

import note_create from "../../../services/note_create";
import { buildNote } from "../../../test/easy-froca";
import { createNewNote, importGpxTrack } from "./api";

vi.mock("../../../services/note_create", () => ({
    default: { createNote: vi.fn(async () => ({ note: { noteId: "created" }, branch: null })) }
}));

const createNote = vi.mocked(note_create.createNote);

describe("geo map api", () => {
    it("creates a placed note under the stock name, located where the click landed", async () => {
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
            // Nothing is asked first — the name is typed over in the pane, not answered in a modal.
            activate: false,
            attributes: expect.arrayContaining([
                { type: "label", name: "geolocation", value: "48.85,2.36" },
                { type: "label", name: "iconClass", value: "bx bx-pin" }
            ])
        }));
    });

    it("brings a GPX file in as a file note the map draws tracks by", async () => {
        const parent = buildNote({ title: "The map" });
        const file = new File([ "<gpx><trk/></gpx>" ], "sunday-ride.gpx");

        const created = await importGpxTrack(parent, file);

        expect(created).toEqual({ noteId: "created" });
        expect(createNote).toHaveBeenCalledWith(parent.noteId, expect.objectContaining({
            title: "sunday-ride.gpx",
            content: "<gpx><trk/></gpx>",
            type: "file",
            // Pinned rather than read off the file: a browser reports no type for a .gpx, and this
            // is the one mime the map recognises a track by (see NoteGpxTrackWrapper).
            mime: "application/gpx+xml",
            activate: false,
            attributes: [ { type: "label", name: "originalFileName", value: "sunday-ride.gpx" } ]
        }));
    });
});
