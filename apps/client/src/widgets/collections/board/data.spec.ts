import { describe, expect,it } from "vitest";

import FBranch from "../../../entities/fbranch";
import FNote from "../../../entities/fnote";
import froca from "../../../services/froca";
import { buildNote } from "../../../test/easy-froca";
import {
    calculateBoardProgress,
    calculateChecklistProgress,
    ColumnMap,
    formatRepeatPattern,
    getBoardData,
    getDueDateStatus
} from "./data";

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
});

describe("calculateChecklistProgress", () => {
    it("returns null for empty content", () => {
        expect(calculateChecklistProgress(null)).toBeNull();
        expect(calculateChecklistProgress("")).toBeNull();
        expect(calculateChecklistProgress(undefined)).toBeNull();
    });

    it("returns null when no checkboxes exist", () => {
        expect(calculateChecklistProgress("Just plain text")).toBeNull();
    });

    it("calculates progress for markdown checkboxes", () => {
        const content = `- [x] Task 1
- [ ] Task 2
- [x] Task 3`;
        const result = calculateChecklistProgress(content);
        expect(result).toEqual({ total: 3, checked: 2, percentage: 67 });
    });

    it("handles both asterisk and dash list markers", () => {
        const content = `* [x] Done
* [ ] Not done
- [X] Also done`;
        const result = calculateChecklistProgress(content);
        expect(result).toEqual({ total: 3, checked: 2, percentage: 67 });
    });

    it("returns 0% when no items are checked", () => {
        const content = "- [ ] Task 1\n- [ ] Task 2";
        const result = calculateChecklistProgress(content);
        expect(result).toEqual({ total: 2, checked: 0, percentage: 0 });
    });

    it("returns 100% when all items are checked", () => {
        const content = "- [x] Task 1\n- [x] Task 2";
        const result = calculateChecklistProgress(content);
        expect(result).toEqual({ total: 2, checked: 2, percentage: 100 });
    });
});

describe("calculateBoardProgress", () => {
    it("calculates progress based on done columns", () => {
        const byColumn = makeColumnMap([
            ["Done", 2],
            ["In Progress", 1],
            ["Completed", 1]
        ]);

        const progress = calculateBoardProgress(byColumn, "Done,completed");
        expect(progress.totalItems).toBe(4);
        expect(progress.completedItems).toBe(3);
        expect(progress.percentage).toBe(75);
    });

    it("normalizes done columns and board columns with trim/case-insensitive matching", () => {
        const byColumn = makeColumnMap([
            ["Done ", 2],
            [" in progress", 1],
            [" COMPLETED ", 1]
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

describe("getDueDateStatus", () => {
    it("returns unknown for null/undefined/invalid dates", () => {
        expect(getDueDateStatus(null)).toBe("unknown");
        expect(getDueDateStatus(undefined)).toBe("unknown");
        expect(getDueDateStatus("not-a-date")).toBe("unknown");
    });

    it("returns overdue for past dates", () => {
        const pastDate = new Date();
        pastDate.setDate(pastDate.getDate() - 1);
        expect(getDueDateStatus(pastDate.toISOString().split("T")[0])).toBe("overdue");
    });

    it("returns today for today's date", () => {
        const today = new Date().toISOString().split("T")[0];
        expect(getDueDateStatus(today)).toBe("today");
    });

    it("returns upcoming for future dates", () => {
        const futureDate = new Date();
        futureDate.setDate(futureDate.getDate() + 1);
        expect(getDueDateStatus(futureDate.toISOString().split("T")[0])).toBe("upcoming");
    });
});

describe("formatRepeatPattern", () => {
    it("returns null for null/undefined/empty input", () => {
        expect(formatRepeatPattern(null)).toBeNull();
        expect(formatRepeatPattern(undefined)).toBeNull();
    });

    it("formats known patterns", () => {
        expect(formatRepeatPattern("daily")).toBe("Daily");
        expect(formatRepeatPattern("weekly")).toBe("Weekly");
        expect(formatRepeatPattern("monthly")).toBe("Monthly");
        expect(formatRepeatPattern("quarterly")).toBe("Quarterly");
        expect(formatRepeatPattern("yearly")).toBe("Yearly");
        expect(formatRepeatPattern("weekdays")).toBe("Weekdays");
        expect(formatRepeatPattern("weekends")).toBe("Weekends");
        expect(formatRepeatPattern("biweekly")).toBe("Bi-weekly");
    });

    it("returns raw value for unknown patterns", () => {
        expect(formatRepeatPattern("custom")).toBe("custom");
    });

    it("is case-insensitive", () => {
        expect(formatRepeatPattern("DAILY")).toBe("Daily");
        expect(formatRepeatPattern("Daily")).toBe("Daily");
    });
});
