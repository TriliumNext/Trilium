import { it, describe, expect } from "vitest";
import { buildNote } from "../../../test/easy-froca";
import { getBoardData } from "./data";
import FBranch from "../../../entities/fbranch";
import froca from "../../../services/froca";

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
        const noteIds = Array.from(data.byColumn.values()).flat().map(item => item.note.noteId);
        expect(noteIds.length).toBe(3);
    });
});
