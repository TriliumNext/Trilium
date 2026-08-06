/**
 * Which of the map's notes it actually files, which is the one thing about deleting them that is the
 * map's own business — what follows from the answer is the app's (see services/note_deletion.ts).
 *
 * A map holds two kinds of note and looks like it holds one: the notes it made itself hang under it
 * in the tree, while the notes dragged onto it live wherever they lived and are merely named in the
 * map's content.
 */
import { describe, expect, it, vi } from "vitest";

import froca from "../../../services/froca";
import * as noteDeletion from "../../../services/note_deletion";
import { buildNote } from "../../../test/easy-froca";
import RelationMapApi, { MapData } from "./api";

vi.mock("../../../services/i18n", () => ({ t: (key: string) => key }));

/** A map holding the given note, whose content changes this reports rather than saves. */
function mapOf(noteId: string) {
    const data: MapData = { notes: [ { noteId, x: 0, y: 0 } ], transform: { x: 0, y: 0, scale: 1 } };
    return { api: new RelationMapApi(froca.notes["themap"], data, () => {}), data };
}

describe("RelationMapApi", () => {
    it("names the branch of a note it made, and none for a note dragged onto it", () => {
        buildNote({ id: "themap", title: "The map", children: [ { id: "made", title: "Made here" } ] });
        buildNote({ id: "elsewhere", title: "Elsewhere", children: [ { id: "dragged", title: "Dragged on" } ] });
        const { api } = mapOf("made");

        expect(api.branchIdFor("made")).toBe("themap_made");
        expect(api.branchIdFor("dragged")).toBeNull();
        // Nor for a note that has since gone from froca entirely.
        expect(api.branchIdFor("vanished")).toBeNull();
    });

    describe("removeItem", () => {
        it("hands the note and the map's branch for it to the app's own deletion", async () => {
            buildNote({ id: "themap", title: "The map", children: [ { id: "made", title: "Made here" } ] });
            const deletion = vi.spyOn(noteDeletion, "deleteNoteOrBranch").mockResolvedValue(undefined);
            const { api, data } = mapOf("made");

            try {
                await api.removeItem("made", true);

                expect(deletion).toHaveBeenCalledWith("made", "themap_made");
                // And off the map itself, which is the half that happens either way.
                expect(data.notes).toEqual([]);
            } finally {
                deletion.mockRestore();
            }
        });

        it("touches the tree not at all where the note is only being taken off the map", async () => {
            buildNote({ id: "themap", title: "The map", children: [ { id: "made", title: "Made here" } ] });
            const deletion = vi.spyOn(noteDeletion, "deleteNoteOrBranch").mockResolvedValue(undefined);
            const { api, data } = mapOf("made");

            try {
                await api.removeItem("made", false);

                expect(deletion).not.toHaveBeenCalled();
                expect(data.notes).toEqual([]);
            } finally {
                deletion.mockRestore();
            }
        });
    });
});
