import { describe, expect, it } from "vitest";

import FBranch from "../../../entities/fbranch";
import froca from "../../../services/froca";
import { buildNote } from "../../../test/easy-froca";
import { getBoardData } from "./data";

describe("Board data", () => {
    it("deduplicates cloned notes", async () => {
        const parentNote = buildNote({
            title: "Board",
            "#collection": "",
            "#viewType": "board",
            children: [
                { id: "note1", title: "First note", "#status": "To Do" },
                { id: "note2", title: "Second note", "#status": "In progress" },
                { id: "note3", title: "Third note", "#status": "Done" }
            ]
        });
        const branch = new FBranch(froca, {
            branchId: "note1_note2",
            notePosition: 10,
            fromSearchNote: false,
            noteId: "note2",
            parentNoteId: "note1"
        });
        froca.branches["note1_note2"] = branch;
        froca.getNoteFromCache("note1")!.addChild("note2", "note1_note2", false);
        const data = await getBoardData(parentNote, "status", {}, false);
        const noteIds = [...data.byColumn.values()].flat().map(item => item.note.noteId);
        expect(noteIds.length).toBe(3);
    });

    it("drops a deleted column resurrected through the mirror when the board owns its definition (#11100)", async () => {
        const parentNote = buildNote({
            title: "Board",
            "#collection": "",
            "#viewType": "board",
            children: [
                { id: "mirror-board-note", title: "Only note", "#status": "Kept" }
            ]
        });

        // The persisted attachment still lists the deleted column — the refresh raced the
        // definition write and wrote it back — while the definition and the notes have dropped it.
        const mirror = await getBoardData(parentNote, "status", { columns: [ { value: "Kept" }, { value: "Deleted" } ] }, false, [ "Kept" ], true);
        expect(mirror.columns).toEqual([ "Kept" ]);
        expect(mirror.newPersistedData?.columns).toEqual([ { value: "Kept" } ]);

        // A board that does not own its definition keeps the attachment-borne column.
        const unmirrored = await getBoardData(parentNote, "status", { columns: [ { value: "Kept" }, { value: "Arranged" } ] }, false, [ "Kept" ], false);
        expect(unmirrored.columns).toEqual([ "Kept", "Arranged" ]);
    });
});
