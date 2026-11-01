/**
 * Which of the map's notes it actually files, which is the one thing about deleting them that is the
 * map's own business — what follows from the answer is the app's (see services/note_deletion.ts).
 *
 * A map holds two kinds of note and looks like it holds one: the notes it made itself hang under it
 * in the tree, while the notes dragged onto it live wherever they lived and are merely named in the
 * map's content.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import froca from "../../../services/froca";
import * as noteDeletion from "../../../services/note_deletion";
import server from "../../../services/server";
import toast from "../../../services/toast";
import { buildNote } from "../../../test/easy-froca";
import RelationMapApi, { type ClientRelation, MapData } from "./api";

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

describe("RelationMapApi relations and placements", () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    /** A map of `a` and `b` with an `author` relation from `a` to `b`, recording each change. */
    function build() {
        buildNote({ id: "themap", title: "The map" });
        const data: MapData = {
            notes: [ { noteId: "a", x: 0, y: 0 }, { noteId: "b", x: 100, y: 0 } ],
            transform: { x: 0, y: 0, scale: 1 }
        };
        const changes: boolean[] = [];
        const api = new RelationMapApi(froca.notes["themap"], data, (_data, refreshUi) => changes.push(refreshUi));
        const relation: ClientRelation = {
            attributeId: "rel", sourceNoteId: "a", targetNoteId: "b", name: "author", type: "uniDirectional", render: true
        };
        api.loadRelations([ relation ]);
        return {
            api, data, changes,
            put: vi.spyOn(server, "put").mockResolvedValue(undefined),
            remove: vi.spyOn(server, "remove").mockResolvedValue(undefined)
        };
    }

    it("connects two notes under a cleaned name, once", async () => {
        const { api, put, changes } = build();

        expect(await api.connect("has child", "a", "b")).toBe(true);
        expect(put).toHaveBeenCalledWith("notes/a/relations/haschild/to/b");
        expect(await api.connect("author", "a", "b")).toBe(false);
        expect(put).toHaveBeenCalledTimes(1);
        expect(changes).toEqual([ true ]);
    });

    it("renames a relation unless the new name is taken or the relation is unknown", async () => {
        const { api, put, remove } = build();
        expect(api.getRelationName("rel")).toBe("author");

        expect(await api.renameRelation("rel", "editor")).toBe(true);
        expect(put).toHaveBeenCalledWith("notes/a/relations/editor/to/b");
        expect(remove).toHaveBeenCalledWith("notes/a/relations/author/to/b");

        expect(await api.renameRelation("rel", "author")).toBe(false);
        expect(await api.renameRelation("unknown", "editor")).toBe(false);
        expect(put).toHaveBeenCalledTimes(1);
    });

    it("removes a known relation from its source note", async () => {
        const { api, remove, changes } = build();

        await api.removeRelation("rel");
        await api.removeRelation("unknown");
        expect(remove.mock.calls).toEqual([ [ "notes/a/relations/author/to/b" ] ]);
        expect(changes).toEqual([ true, true ]);
    });

    it("adds, moves and drops boxes, reporting whether the boxes change", () => {
        const { api, data, changes } = build();
        const showError = vi.spyOn(toast, "showError").mockImplementation(() => {});
        const logError = vi.fn();
        vi.stubGlobal("logError", logError);

        api.addMultipleNotes([]);
        api.addMultipleNotes([ { noteId: "a", title: "A", x: 5, y: 5 }, { noteId: "c", title: "C", x: 200, y: 0 } ]);
        expect(showError).toHaveBeenCalledTimes(1);
        api.createItem({ noteId: "d", x: 0, y: 100 });
        expect(data.notes.map((note) => note.noteId)).toEqual([ "a", "b", "c", "d" ]);

        api.moveNote("b", 150, 50);
        api.moveNote("unknown", 0, 0);
        expect(data.notes[1]).toEqual({ noteId: "b", x: 150, y: 50 });
        expect(logError).toHaveBeenCalledTimes(1);

        api.cleanupOtherNotes([ "a", "b", "c", "d" ]);
        api.cleanupOtherNotes([ "a", "c" ]);
        expect(data.notes.map((note) => note.noteId)).toEqual([ "a", "c" ]);
        expect(changes).toEqual([ true, true, false, true ]);
    });
});
