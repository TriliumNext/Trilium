import { describe, expect,it } from "vitest";

import FBranch from "../../../entities/fbranch";
import FNote from "../../../entities/fnote";
import froca from "../../../services/froca";
import { buildNote } from "../../../test/easy-froca";
import { calculateBoardProgress, ColumnMap, getBoardData } from "./data";

function makeColumnMap(columns: Array<[string, number]>): ColumnMap {
    return new Map(
        columns.map(([name, count]) => [
            name,
            Array.from({ length: count }, () => ({
                branch: {} as FBranch,
                note: {} as FNote
            }))
        ])
    );
}

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

    it("calculates progress based on done columns", () => {
        const byColumn = makeColumnMap([
            [ "Done", 2 ],
            [ "In Progress", 1 ],
            [ "Completed", 1 ]
        ]);

        const progress = calculateBoardProgress(byColumn, "Done,completed");
        expect(progress.totalItems).toBe(4);
        expect(progress.completedItems).toBe(3);
        expect(progress.percentage).toBe(75);
    });

    it("normalizes done columns and board columns with trim/case-insensitive matching", () => {
        const byColumn = makeColumnMap([
            [ "Done ", 2 ],
            [ " in progress", 1 ],
            [ " COMPLETED ", 1 ]
        ]);

        const progress = calculateBoardProgress(byColumn, " done , completed ");
        expect(progress.totalItems).toBe(4);
        expect(progress.completedItems).toBe(3);
        expect(progress.percentage).toBe(75);
    });

    it("returns zero progress for empty boards", () => {
        const byColumn = new Map<string, { branch: FBranch; note: FNote }[]>() as ColumnMap;
        const progress = calculateBoardProgress(byColumn, "Done");

        expect(progress.totalItems).toBe(0);
        expect(progress.completedItems).toBe(0);
        expect(progress.percentage).toBe(0);
    });
});
