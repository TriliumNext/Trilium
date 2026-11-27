import { afterEach, describe, expect, it, vi } from "vitest";

import type BNote from "../becca/entities/bnote.js";
import attributeService from "./attributes.js";
import { getContext } from "./context.js";
import dateNotesService from "./date_notes.js";
import noteService from "./notes.js";
import optionService from "./options.js";

let counter = 0;

function createCalendarRoot(labels: string[] = []): BNote {
    counter++;
    return getContext().init(() => {
        const { note } = noteService.createNewNote({
            parentNoteId: "root", title: `date-notes-root-${counter}`, content: "", type: "text"
        });
        for (const label of labels) {
            attributeService.createLabel(note.noteId, label);
        }
        return note;
    });
}

function inContext<T>(cb: () => T) {
    return getContext().init(cb);
}

describe("date_notes (real DB)", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("builds year, quarter, month, week and day notes with their templates", () => {
        const root = createCalendarRoot([ "enableQuarterNote", "enableWeekNote" ]);
        const template = inContext(() => noteService.createNewNote({
            parentNoteId: "root", title: "date-notes-template", content: "", type: "text"
        }).note);
        inContext(() => {
            const relations = [
                "yearTemplate", "quarterTemplate", "monthTemplate", "weekTemplate", "dateTemplate"
            ];
            for (const relation of relations) {
                attributeService.createRelation(root.noteId, relation, template.noteId);
            }
        });

        // 2025-W05 runs from Monday 27 January to Sunday 2 February.
        const dayNote = inContext(() => dateNotesService.getDayNote("2025-01-30", root));
        const weekNote = dayNote.getParentNotes()[0];
        const monthNote = weekNote.getParentNotes()
            .find((note) => note.hasLabel("monthNote", "2025-01"));
        const quarterNote = monthNote?.getParentNotes()[0];
        const yearNote = quarterNote?.getParentNotes()[0];

        expect(dayNote.getLabelValue("dateNote")).toBe("2025-01-30");
        expect(weekNote.getLabelValue("weekNote")).toBe("2025-W05");
        expect(quarterNote?.getLabelValue("quarterNote")).toBe("2025-Q1");
        expect(yearNote?.getLabelValue("yearNote")).toBe("2025");
        expect(yearNote?.getParentNotes()[0]).toBe(root);
        for (const note of [ dayNote, weekNote, monthNote, quarterNote, yearNote ]) {
            expect(note?.getRelationValue("template")).toBe(template.noteId);
        }
        // The week spans two months, so it is cloned into February too.
        expect(weekNote.getParentNotes().map((note) => note.getLabelValue("monthNote")).sort())
            .toStrictEqual([ "2025-01", "2025-02" ]);

        // Existing week and quarter notes are reused.
        const otherDay = inContext(() => dateNotesService.getDayNote("2025-01-28", root));
        expect(otherDay.getParentNotes()[0]).toBe(weekNote);
        expect(inContext(() => dateNotesService.getQuarterNote("2025-Q1", root))).toBe(quarterNote);

        // A week within one month has a single parent.
        const midMonthWeek = inContext(() => dateNotesService.getWeekNote("2025-W03", root));
        expect(midMonthWeek?.getParentNotes()).toHaveLength(1);
    });

    it("creates today's note", () => {
        const root = createCalendarRoot();
        const today = inContext(() => dateNotesService.getTodayNote(root));
        expect(today.getLabelValue("dateNote")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("falls back to the default week settings when the options are missing", () => {
        const root = createCalendarRoot([ "enableWeekNote" ]);
        vi.spyOn(optionService, "getOptionOrNull").mockReturnValue(null);

        // 2025-01-01 is a Wednesday; weeks start on Monday by default.
        const firstDay = inContext(() => dateNotesService.getWeekFirstDayNote("2025-01-01", root));
        expect(firstDay.getLabelValue("dateNote")).toBe("2024-12-30");
        expect(firstDay.getParentNotes()[0].getLabelValue("weekNote")).toBe("2025-W01");
    });

    it("creates unprotected journal notes under a protected root, outside a session", () => {
        const root = createCalendarRoot();
        root.isProtected = true;
        try {
            const yearNote = inContext(() => dateNotesService.getYearNote("2031-05-05", root));
            expect(yearNote.isProtected).toBe(false);
        } finally {
            root.isProtected = false;
        }
    });
});
