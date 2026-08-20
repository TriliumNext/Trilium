import { describe, expect, it } from "vitest";

import FBranch from "../../../entities/fbranch";
import froca from "../../../services/froca";
import { buildNote } from "../../../test/easy-froca";
import { noteColumnRemoved } from "./columns";
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

    it("drops a column the board removed when it resurrects through the mirror", async () => {
        const parentNote = buildNote({
            title: "Board",
            "#collection": "",
            "#viewType": "board",
            children: [
                { id: "mirror-board-note", title: "Only note", "#status": "Kept" }
            ]
        });
        // What removeColumn leaves behind when its definition write is still in flight: the
        // notes have dropped the value, the stale definition options will resurrect it, and the
        // persisted mirror still carries it.
        noteColumnRemoved(parentNote.noteId, "Deleted");

        const mirror = await getBoardData(
            parentNote, "status",
            { columns: [ { value: "Kept" }, { value: "Deleted" } ] },
            false, [ "Kept", "Deleted" ], true
        );
        // The stale definition still names it, so the resolved list does too (transiently),
        // but the persisted input leg was filtered — the write-back below is what the stale
        // definition produced, and it is the last time Deleted can appear anywhere.
        expect(mirror.columns).toEqual([ "Kept", "Deleted" ]);
        expect(mirror.newPersistedData?.columns).toEqual(
            [ { value: "Kept" }, { value: "Deleted" } ]
        );

        // Once the definition write lands, nothing names the removed column anymore.
        const settled = await getBoardData(
            parentNote, "status",
            { columns: [ { value: "Kept" } ] },
            false, [ "Kept" ], true
        );
        expect(settled.columns).toEqual([ "Kept" ] as string[]);

        // A board that does not own its definition keeps attachment-borne columns: its
        // persisted list is the arrangement itself, not a mirror, and nothing is marked.
        const unmirrored = await getBoardData(
            parentNote, "status",
            { columns: [ { value: "Kept" }, { value: "Arranged" } ] },
            false, [ "Kept" ], false
        );
        expect(unmirrored.columns).toEqual([ "Kept", "Arranged" ]);
    });

    it("clears the removal mark once a note carries the value again", async () => {
        const parentNote = buildNote({
            title: "Board",
            "#collection": "",
            "#viewType": "board",
            children: [
                { id: "mirror-board-note-3", title: "Back again", "#status": "Kept" }
            ]
        });
        // The column was deleted in this session; another surface has since put
        // a note back into that status, and the persisted mirror still names it.
        noteColumnRemoved(parentNote.noteId, "Kept");

        const afterRecreation = await getBoardData(
            parentNote, "status",
            { columns: [ { value: "Kept" } ] },
            false, [], true
        );
        expect(afterRecreation.columns).toEqual([ "Kept" ]);
    });

    it("keeps a brand-new empty column that is in no source yet (#11100 review)", async () => {
        const parentNote = buildNote({
            title: "Board",
            "#collection": "",
            "#viewType": "board",
            children: [
                { id: "mirror-board-note-2", title: "Only note", "#status": "Kept" }
            ]
        });
        // addNewColumn saved the config; the definition write has not landed, no note
        // carries the value. The mirror filter must not eat it.
        const added = await getBoardData(
            parentNote, "status",
            { columns: [ { value: "Kept" }, { value: "New Column" } ] },
            false, [ "Kept" ], true
        );
        expect(added.columns).toEqual([ "Kept", "New Column" ]);
    });
});
